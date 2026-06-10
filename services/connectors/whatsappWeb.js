const { Client, LocalAuth } = require("whatsapp-web.js");
const qrcode = require("qrcode-terminal");
const { chat, chatWithAudio } = require("../ai");
const { getSession, addToHistory, closeSession } = require("../sessionManager");
const { isOrderConfirmed, buildDispatchTicket, extractDeliveryData, extractMarkersFromResponse } = require("../orderProcessor");
const { parseTotalFromSummary } = require("../database");

const ordersRepo = require("../../src/repositories/orders.repo");
const { createWhatsappOrder, updateStatus, setStatusNotifier } = require("../../src/services/orderService");
const { parseKitchenKeyword, kitchenInstructions } = require("../../src/services/orderStatusMessages");
const { setWaDispatchSender } = require("../dispatchNotifier");
const settingsRepo = require("../../src/repositories/settings.repo");
const waState = require("../../src/services/whatsappState");
const { isOpen, closedMessage } = require("../../src/services/businessHours");
const { touchMemory, buildContextBlock, updateAfterOrder } = require("../../src/repositories/customers.repo");

function getDispatchNumber() {
  try { return settingsRepo.getSetting("dispatch_number") || process.env.DISPATCH_NUMBER; }
  catch { return process.env.DISPATCH_NUMBER; }
}

const STATUS_LABEL = {
  accepted: "ACEPTADO ✅", cooking: "COCINANDO 👨‍🍳", ready: "LISTO 🎉",
  sent: "ENVIADO 🛵", cancelled: "CANCELADO ❌"
};

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    headless: true,
    // En Docker usa el Chromium del sistema (PUPPETEER_EXECUTABLE_PATH);
    // en dev nativo, el que trae puppeteer (undefined = por defecto).
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas", "--no-first-run", "--no-zygote", "--disable-gpu"],
  },
});

function parseTotalCop(summary) {
  const t = parseTotalFromSummary(summary); // "$10.000" | null
  return t ? parseInt(t.replace(/[^\d]/g, ""), 10) || 0 : 0;
}

function initialize() {
  console.log("Iniciando motor de WhatsApp Web...");
  console.log("Cargando navegador Puppeteer... (esto puede tardar unos segundos)\n");

  waState.setState({ status: "initializing", qr: null });

  setStatusNotifier(async (order, _status, message) => {
    if (!order.customer_phone || !message) return;
    // Resolvemos el WA ID del número para evitar "No LID for user"
    try {
      const numberId = await client.getNumberId(order.customer_phone);
      if (!numberId) {
        console.warn(`[WA] Número ${order.customer_phone} no encontrado en WhatsApp — notificación omitida`);
        return;
      }
      await client.sendMessage(numberId._serialized, message);
    } catch (err) {
      console.error(`[WA] Error enviando notificación de estado a ${order.customer_phone}:`, err.message);
    }
  });

  client.on("qr", (qr) => {
    console.log("\n[WhatsApp Web] Escaneá el siguiente código QR con tu teléfono:\n");
    qrcode.generate(qr, { small: true });
    waState.setState({ status: "qr", qr });
  });
  client.on("loading_screen", (p, m) => {
    console.log(`[WhatsApp Web] Cargando: ${p}% - ${m}`);
    // Solo regresa a "initializing" si todavía no hay QR ni sesión activa
    const cur = waState.getState().status;
    if (cur === "initializing" || cur === "disabled") {
      waState.setState({ status: "initializing", qr: null });
    }
  });
  client.on("authenticated", () => {
    console.log("[WhatsApp Web] Sesión recuperada ✓");
    waState.setState({ status: "connecting", qr: null });
  });
  client.on("ready", () => {
    const dn = getDispatchNumber();
    console.log(`\n[WhatsApp Web] Bot conectado y escuchando ✓`);
    console.log(`[Cocina] Despacho: ${dn || "(no configurado)"}\n`);
    waState.setState({ status: "ready", qr: null });

    // Registrar el sender de despacho para que dispatchNotifier lo use
    // (cubre pedidos de kiosko y otros canales que no pasan por handleOrderConfirmed)
    setWaDispatchSender(async (ticket) => {
      const dispatchNum = getDispatchNumber();
      if (!dispatchNum) throw new Error("DISPATCH_NUMBER no configurado");
      await client.sendMessage(`${dispatchNum}@c.us`, ticket);
    });
  });
  client.on("disconnected", (reason) => {
    console.log(`[WhatsApp Web] Desconectado: ${reason}`);
    waState.setState({ status: "disconnected", qr: null });
  });
  client.on("message", handleMessage);
  client.initialize();
}

async function handleMessage(msg) {
  if (msg.isGroupMsg || msg.from === "status@broadcast" || msg.fromMe) return;

  const phone = msg.from.replace(/@[^@]+$/, "");

  // ── Respuestas de la COCINA (despacho) ──
  const DISPATCH_NUMBER = getDispatchNumber();
  if (DISPATCH_NUMBER && phone === DISPATCH_NUMBER) {
    await handleKitchenReply(msg);
    return;
  }

  await handleCustomerMessage(msg, phone);
}

// ─────────────── Flujo de la COCINA ───────────────
async function handleKitchenReply(msg) {
  const text = msg.body?.trim();
  const status = parseKitchenKeyword(text);
  if (!status) return; // no es un comando de estado: ignorar

  // Resolver a qué pedido aplica
  let order = null;
  if (msg.hasQuotedMsg) {
    try {
      const quoted = await msg.getQuotedMessage();
      order = ordersRepo.getOrderByWaMessageId(quoted.id._serialized);
    } catch { /* sigue con otros métodos */ }
  }
  if (!order) {
    const m = text.match(/\b([WK]-\d{3})\b/i);
    if (m) order = ordersRepo.getOrderByTicketNumber(m[1].toUpperCase());
  }
  if (!order) {
    const active = ordersRepo.getActiveOrders("whatsapp");
    if (active.length === 1) order = active[0];
    else if (active.length > 1) {
      await msg.reply("⚠️ Hay varios pedidos activos. *Responde citando* el mensaje del pedido o incluye su ticket (ej: aceptado W-001).");
      return;
    }
  }
  if (!order) { await msg.reply("No encontré un pedido activo para actualizar."); return; }

  try {
    await updateStatus(order.id, status);
    await msg.reply(`✓ Pedido *${order.ticket_number}* → *${STATUS_LABEL[status] || status}*${status === "accepted" ? "\n🖨️ Ticket enviado a la impresora." : ""}`);
  } catch (err) {
    console.error("[COCINA] Error actualizando estado:", err.message);
    await msg.reply("No pude actualizar el pedido 😓");
  }
}

// ─────────────── Flujo del CLIENTE ───────────────
async function handleCustomerMessage(msg, phone) {
  if (!isOpen()) {
    await msg.reply(closedMessage()).catch(() => {});
    return;
  }

  const session = getSession(phone);

  // Registro de visita y contexto de memoria (primera vez en esta sesión)
  if (!session._memoryLoaded) {
    try { touchMemory(phone); } catch (err) { console.warn("[MEM] touchMemory:", err.message); }
    session._memoryLoaded = true;
  }
  const customerContext = buildContextBlock(phone);

  // Notas de voz
  if (msg.type === "ptt" || msg.type === "audio") {
    try {
      const media = await msg.downloadMedia();
      if (!media) { await msg.reply("No pude descargar tu nota de voz 😓 Escríbeme tu pedido."); return; }
      const { transcription, botResponse } = await chatWithAudio(session.history, media.data, media.mimetype, customerContext);
      const { data: markerData, cleanResponse } = extractMarkersFromResponse(botResponse);
      if (Object.keys(markerData).length > 0) session.deliveryData = { ...session.deliveryData, ...markerData };
      addToHistory(session, "user", transcription);
      addToHistory(session, "model", cleanResponse);
      session.deliveryData = extractDeliveryData(session.history, session.deliveryData);
      await msg.reply(`_🎤 "${transcription}"_\n\n${cleanResponse}`);
      if (isOrderConfirmed(cleanResponse)) await handleOrderConfirmed(phone, session, cleanResponse);
    } catch (err) {
      console.error("[AUDIO] Error:", err.message);
      await msg.reply("No pude procesar tu nota de voz 😓");
    }
    return;
  }

  const userText = msg.body?.trim();
  if (!userText) return;

  if (["reiniciar", "cancelar"].includes(userText.toLowerCase())) {
    closeSession(phone);
    await msg.reply("Conversación reiniciada. 👋");
    return;
  }

  try {
    const botResponse = await chat(session.history, userText, customerContext);
    const { data: markerData, cleanResponse } = extractMarkersFromResponse(botResponse);
    if (Object.keys(markerData).length > 0) session.deliveryData = { ...session.deliveryData, ...markerData };
    addToHistory(session, "user", userText);
    addToHistory(session, "model", cleanResponse);
    session.deliveryData = extractDeliveryData(session.history, session.deliveryData);
    await msg.reply(cleanResponse);
    if (isOrderConfirmed(cleanResponse)) await handleOrderConfirmed(phone, session, cleanResponse);
  } catch (err) {
    console.error("[ERROR]:", err.message);
    await msg.reply("Hubo un error técnico 😓");
  }
}

async function handleOrderConfirmed(phone, session, botResponse = "") {
  const nameMatch = botResponse.match(/¡Perfecto,\s*([A-ZÁÉÍÓÚÑa-záéíóúñ]{2,25})/i);
  if (nameMatch) session.deliveryData.nombre = nameMatch[1].trim();

  const dd = session.deliveryData;
  const totalCop = parseTotalCop(dd.resumenPedido);

  // 1. Crear pedido en 'pending' (NO imprime todavía)
  const order = createWhatsappOrder({
    phone,
    customerName: dd.nombre || null,
    address: dd.direccion || null,
    paymentMethod: dd.metodoPago || null,
    totalCop
  });

  // 2. Ticket de impresión (sin instrucciones) → se guarda para imprimir al aceptar
  const ticketText = buildDispatchTicket(phone, dd, order.ticket_number);
  ordersRepo.setTicketText(order.id, ticketText);

  // 3. Enviar a la cocina con instrucciones y guardar el id del mensaje (para respuestas citadas)
  const dispatchNum = getDispatchNumber();
  if (dispatchNum) {
    try {
      const sent = await client.sendMessage(
        `${dispatchNum}@c.us`,
        ticketText + "\n" + kitchenInstructions(order.ticket_number)
      );
      if (sent?.id?._serialized) ordersRepo.setWaMessageId(order.id, sent.id._serialized);
      console.log(`[DESPACHO] Ticket ${order.ticket_number} enviado a cocina (${dispatchNum}) ✓`);
    } catch (err) {
      console.error("[DESPACHO] No se pudo notificar a cocina:", err.message);
    }
  } else {
    console.warn("[DESPACHO] Sin número de despacho configurado — ticket no enviado.");
  }

  // 4. Guardar memoria del cliente (nombre, dirección, resumen del pedido)
  try {
    updateAfterOrder(phone, {
      name:         dd.nombre    || null,
      address:      dd.direccion || null,
      orderSummary: dd.resumenPedido ? dd.resumenPedido.slice(0, 200) : null,
    });
  } catch (err) {
    console.warn("[MEM] updateAfterOrder:", err.message);
  }

  // 5. Confirmar al cliente (sin imprimir: la impresión ocurre cuando cocina acepta)
  await client.sendMessage(`${phone}@c.us`,
    `🧾 ¡Listo${dd.nombre ? ", " + dd.nombre : ""}! Tu pedido *${order.ticket_number}* fue recibido. Apenas la cocina lo confirme te aviso. 🙌`
  ).catch(() => {});

  closeSession(phone);
}

module.exports = { initialize };
