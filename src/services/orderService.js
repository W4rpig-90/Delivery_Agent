/**
 * orderService.js — lógica de negocio de pedidos y MÁQUINA DE ESTADOS.
 *
 * Regla de impresión (requisito central):
 *   - Kiosko: el pedido se crea YA en estado 'accepted' → imprime al crearse.
 *   - WhatsApp: se crea en 'pending' (NO imprime). Imprime solo cuando la cocina
 *     lo marca 'accepted' (Fase 5).
 * La impresión vive en UN SOLO lugar: se dispara cuando el pedido entra a
 * 'accepted' y aún no se ha impreso (printed_at IS NULL). Así ambos flujos
 * comparten exactamente la misma lógica.
 */

const ordersRepo = require("../repositories/orders.repo");
const { printTicket } = require("../../services/printer");
const { notifyDispatch } = require("../../services/dispatchNotifier");
const { buildKioskTicket } = require("../../services/kioskTicket");
const { customerStatusMessage } = require("./orderStatusMessages");
const orderBus = require("../orderEvents");

const VALID_STATUSES = ["pending", "accepted", "cooking", "ready", "entregado", "sent", "finalizado", "closed", "cancelled"];

// Notificador al cliente (lo registra el conector de WhatsApp, que tiene el client).
// Firma: async (order, status, message) => void
let statusNotifier = null;
function setStatusNotifier(fn) { statusNotifier = fn; }

function buildTicketFromOrder(order) {
  const items = order.items.map(i => ({
    qty: i.qty,
    name: i.name_snapshot,
    price: i.unit_price_cop,
    notes: i.notes
  }));
  // TODO Fase 5: ticket con encabezado propio para pedidos de WhatsApp (delivery).
  return buildKioskTicket({
    ticketNumber: order.ticket_number,
    customerName: order.customer_name,
    items,
    subtotalCop: order.subtotal_cop,
    paymentMethod: order.payment_method,
    deliveryType: order.delivery_type,
    mesa: order.mesa,
    notas: order.notes
  });
}

/**
 * Imprime el pedido si entró a 'accepted' y aún no se imprimió.
 * Construye el ticket siempre (lo devuelve aunque la impresora no esté configurada).
 * @returns {Promise<string>} texto del ticket
 */
async function printOrderIfNeeded(order) {
  // Pedidos de WhatsApp traen el ticket pre-renderizado (texto libre de la IA);
  // los de kiosko se arman desde sus líneas estructuradas.
  const ticket = order.ticket_text || buildTicketFromOrder(order);
  if (order.printed_at) return ticket; // ya impreso: idempotente
  try {
    await printTicket(ticket);
  } catch (err) {
    console.error("[orderService] Error de impresión:", err.message);
  }
  ordersRepo.markPrinted(order.id);
  return ticket;
}

/**
 * Crea un pedido de KIOSKO (auto-aceptado → imprime y notifica a cocina).
 * @param {object} input { items, customerName, customerPhone, deliveryType, mesa, paymentMethod, notas }
 * @returns {{ id, ticketNumber, subtotal }}
 */
function createKioskOrder(input) {
  const ticketNumber = ordersRepo.nextTicketNumber("K");
  const subtotal = input.items.reduce((s, i) => s + i.price * i.qty, 0);
  const rawPhone = (input.customerPhone || "").replace(/\D/g, "");
  const phone = rawPhone.length >= 7 ? (rawPhone.startsWith("57") ? rawPhone : "57" + rawPhone) : `KIOSKO-${ticketNumber}`;

  const id = ordersRepo.createOrder(
    {
      ticket_number: ticketNumber,
      source: "kiosko",
      status: "accepted",
      customer_phone: phone,
      customer_name: input.customerName ?? null,
      delivery_type: input.deliveryType ?? null,
      mesa: input.mesa ?? null,
      payment_method: input.paymentMethod,
      subtotal_cop: subtotal,
      total_cop: subtotal,
      notes: input.notas ?? null
    },
    input.items.map(i => ({
      product_id: i.id,
      name_snapshot: i.name,
      unit_price_cop: i.price,
      qty: i.qty,
      notes: i.notes ?? null,
      modifiers: i.modifiers || []
    }))
  );

  // Imprime + notifica a cocina sin bloquear la respuesta al cliente.
  const order = ordersRepo.getOrderWithItems(id);
  orderBus.emit("order:new", order);
  printOrderIfNeeded(order)
    .then(ticket =>
      notifyDispatch({ ticket, payload: { ...order, dbId: id } })
        .catch(err => console.error("[orderService] Notificación a cocina falló:", err.message))
    )
    .catch(err => console.error("[orderService] Post-creación falló:", err.message));

  return { id, ticketNumber, subtotal };
}

/**
 * Crea un pedido de WHATSAPP en estado 'pending' (NO imprime).
 * Imprimirá cuando la cocina lo marque 'accepted' (vía updateStatus).
 * @param {object} input { phone, customerName, address, paymentMethod, ticketText, totalCop }
 * @returns {object} pedido creado (con items)
 */
function createWhatsappOrder(input) {
  const ticketNumber = ordersRepo.nextTicketNumber("W");
  const total = Number(input.totalCop) || 0;

  const id = ordersRepo.createOrder(
    {
      ticket_number: ticketNumber,
      source: "whatsapp",
      status: "pending",
      customer_phone: input.phone,
      customer_name: input.customerName ?? null,
      delivery_type: "domicilio",
      address: input.address ?? null,
      payment_method: input.paymentMethod ?? null,
      subtotal_cop: total,
      total_cop: total,
      notes: null,
      ticket_text: input.ticketText ?? null
    },
    [] // sin líneas estructuradas: el detalle vive en ticket_text
  );

  const order = ordersRepo.getOrderWithItems(id);
  orderBus.emit("order:new", order);
  return order;
}

/**
 * Cambia el estado de un pedido. Si entra a 'accepted', dispara la impresión.
 * Para pedidos de WhatsApp con cliente real, notifica al cliente el cambio.
 */
async function updateStatus(orderId, newStatus) {
  if (!VALID_STATUSES.includes(newStatus)) {
    throw new Error(`estado inválido: ${newStatus}`);
  }
  ordersRepo.setStatus(orderId, newStatus);
  const order = ordersRepo.getOrderWithItems(orderId);
  if (!order) throw new Error(`pedido ${orderId} no existe`);

  if (newStatus === "accepted") {
    await printOrderIfNeeded(order);
  }

  orderBus.emit("order:status", order);

  // Notificar al cliente final (pedidos WhatsApp o kiosk con teléfono real)
  const isRealPhone = order.customer_phone && !String(order.customer_phone).startsWith("KIOSKO-");
  if (statusNotifier && isRealPhone) {
    const message = customerStatusMessage(order, newStatus);
    if (message) {
      try { await statusNotifier(order, newStatus, message); }
      catch (err) { console.error("[orderService] Notificación al cliente falló:", err.message); }
    }
  }

  return order;
}

module.exports = { createKioskOrder, createWhatsappOrder, updateStatus, setStatusNotifier, VALID_STATUSES };
