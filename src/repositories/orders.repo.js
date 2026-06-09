/**
 * orders.repo.js — persistencia de pedidos, líneas, modificadores e historial de estado.
 *
 * Todas las escrituras de un pedido ocurren dentro de una transacción para
 * garantizar integridad (orders + order_items + order_item_modifiers + history).
 */

const { getDB } = require("../db/connection");

/** Contador de tickets por día y prefijo. Devuelve p.ej. "K-007". */
function nextTicketNumber(prefix = "K") {
  const db = getDB();
  const today = new Date().toISOString().slice(0, 10);
  const bucket = `${prefix}-${today}`;
  const tx = db.transaction(() => {
    db.prepare("INSERT OR IGNORE INTO ticket_counter (bucket, last_num) VALUES (?, 0)").run(bucket);
    db.prepare("UPDATE ticket_counter SET last_num = last_num + 1 WHERE bucket = ?").run(bucket);
    return db.prepare("SELECT last_num FROM ticket_counter WHERE bucket = ?").get(bucket).last_num;
  });
  return `${prefix}-${String(tx()).padStart(3, "0")}`;
}

/**
 * Crea un pedido completo.
 * @param {object} order  campos de la tabla orders
 * @param {Array}  items  [{ product_id, name_snapshot, unit_price_cop, qty, notes, modifiers:[{name,price_cop}] }]
 * @returns {number} id del pedido
 */
function createOrder(order, items = []) {
  const db = getDB();
  const tx = db.transaction(() => {
    if (order.customer_phone) {
      db.prepare(`INSERT OR IGNORE INTO customers (phone, name, address) VALUES (?, ?, ?)`)
        .run(order.customer_phone, order.customer_name ?? null, order.address ?? null);
    }

    const orderId = db.prepare(`
      INSERT INTO orders (
        ticket_number, source, status, customer_phone, customer_name,
        delivery_type, mesa, address, payment_method,
        subtotal_cop, total_cop, notes, wa_message_id
      ) VALUES (
        @ticket_number, @source, @status, @customer_phone, @customer_name,
        @delivery_type, @mesa, @address, @payment_method,
        @subtotal_cop, @total_cop, @notes, @wa_message_id
      )
    `).run({
      ticket_number: order.ticket_number ?? null,
      source: order.source,
      status: order.status ?? "pending",
      customer_phone: order.customer_phone ?? null,
      customer_name: order.customer_name ?? null,
      delivery_type: order.delivery_type ?? null,
      mesa: order.mesa ?? null,
      address: order.address ?? null,
      payment_method: order.payment_method ?? null,
      subtotal_cop: order.subtotal_cop ?? 0,
      total_cop: order.total_cop ?? 0,
      notes: order.notes ?? null,
      wa_message_id: order.wa_message_id ?? null
    }).lastInsertRowid;

    const insItem = db.prepare(`
      INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price_cop, qty, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insMod = db.prepare(`
      INSERT INTO order_item_modifiers (order_item_id, name_snapshot, price_cop)
      VALUES (?, ?, ?)
    `);
    for (const it of items) {
      const itemId = insItem.run(
        orderId, it.product_id ?? null, it.name_snapshot,
        it.unit_price_cop, it.qty, it.notes ?? null
      ).lastInsertRowid;
      for (const m of (it.modifiers || [])) {
        insMod.run(itemId, m.name_snapshot ?? m.name, m.price_cop ?? 0);
      }
    }

    db.prepare("INSERT INTO order_status_history (order_id, status) VALUES (?, ?)")
      .run(orderId, order.status ?? "pending");

    return orderId;
  });
  return tx();
}

/** Pedido con sus líneas (sin modificadores expandidos; se cargan aparte si hacen falta). */
function getOrderWithItems(id) {
  const db = getDB();
  const order = db.prepare("SELECT * FROM orders WHERE id = ?").get(id);
  if (!order) return null;
  order.items = db.prepare("SELECT * FROM order_items WHERE order_id = ? ORDER BY id").all(id);
  return order;
}

/** Busca un pedido por el id del mensaje de WhatsApp enviado a cocina (respuestas citadas). */
function getOrderByWaMessageId(waMessageId) {
  return getDB().prepare("SELECT * FROM orders WHERE wa_message_id = ?").get(waMessageId);
}

/** Busca un pedido por su número de ticket (p. ej. "W-001"). */
function getOrderByTicketNumber(ticketNumber) {
  return getDB().prepare("SELECT * FROM orders WHERE ticket_number = ?").get(ticketNumber);
}

/** Guarda el id del mensaje enviado a cocina, para resolver respuestas citadas. */
function setWaMessageId(orderId, waMessageId) {
  getDB().prepare("UPDATE orders SET wa_message_id = ? WHERE id = ?").run(waMessageId, orderId);
}

/** Guarda el ticket pre-renderizado (pedidos de WhatsApp). */
function setTicketText(orderId, ticketText) {
  getDB().prepare("UPDATE orders SET ticket_text = ? WHERE id = ?").run(ticketText, orderId);
}

/** Pedidos aún en curso (no cerrados ni cancelados), del más reciente al más antiguo. */
function getActiveOrders(source = null) {
  const base = "SELECT * FROM orders WHERE status NOT IN ('closed','cancelled')";
  const sql = source ? `${base} AND source = ? ORDER BY id DESC` : `${base} ORDER BY id DESC`;
  return source ? getDB().prepare(sql).all(source) : getDB().prepare(sql).all();
}

/** Pedidos activos con sus líneas, para el tablero de cocina (KDS). */
function getActiveOrdersDetailed() {
  const db = getDB();
  const orders = db.prepare(
    "SELECT * FROM orders WHERE status NOT IN ('closed','cancelled') ORDER BY id ASC"
  ).all();
  const itemsStmt = db.prepare(
    "SELECT name_snapshot, qty, unit_price_cop, notes FROM order_items WHERE order_id = ? ORDER BY id"
  );
  for (const o of orders) o.items = itemsStmt.all(o.id);
  return orders;
}

/** Cambia el estado y registra el historial. */
function setStatus(id, status) {
  const db = getDB();
  const tx = db.transaction(() => {
    db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, id);
    db.prepare("INSERT INTO order_status_history (order_id, status) VALUES (?, ?)").run(id, status);
  });
  tx();
}

/** Marca el pedido como impreso (timestamp Bogotá). */
function markPrinted(id) {
  getDB().prepare("UPDATE orders SET printed_at = datetime('now','-5 hours') WHERE id = ?").run(id);
}

/** Conteo de pedidos activos por estado — para el dashboard de /admin. */
function getOrderCountsByStatus() {
  const db = getDB();
  const rows = db.prepare(
    "SELECT status, COUNT(*) as cnt FROM orders WHERE status NOT IN ('closed','cancelled') GROUP BY status"
  ).all();
  const m = {};
  for (const r of rows) m[r.status] = r.cnt;
  return {
    pendientes:  m.pending  || 0,
    en_cocina:   (m.accepted || 0) + (m.cooking || 0) + (m.ready || 0),
    entregando:  m.sent     || 0,
  };
}

/** Pedidos del día o del mes para exportar a CSV (hora Bogotá). */
function getOrdersForExport(period) {
  const db = getDB();
  const filter = period === "month"
    ? "strftime('%Y-%m', created_at) = strftime('%Y-%m', datetime('now','-5 hours'))"
    : "date(created_at) = date(datetime('now','-5 hours'))";
  return db.prepare(`
    SELECT ticket_number, created_at, source, customer_name, customer_phone,
           address, payment_method, total_cop, status
    FROM orders
    WHERE ${filter}
    ORDER BY id DESC
  `).all();
}

/** Resumen de pedidos activos para el dashboard de /admin. */
function getActiveOrdersSummary() {
  const db = getDB();
  return db.prepare(`
    SELECT o.id, o.ticket_number, o.source, o.status,
           o.customer_name, o.customer_phone, o.total_cop,
           o.delivery_type, o.created_at,
           (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o
    WHERE o.status NOT IN ('closed','cancelled')
    ORDER BY o.id DESC
  `).all();
}

module.exports = {
  nextTicketNumber,
  createOrder,
  getOrderWithItems,
  getOrderByWaMessageId,
  getOrderByTicketNumber,
  setWaMessageId,
  setTicketText,
  getActiveOrders,
  getActiveOrdersDetailed,
  setStatus,
  markPrinted,
  getOrderCountsByStatus,
  getActiveOrdersSummary,
  getOrdersForExport,
};
