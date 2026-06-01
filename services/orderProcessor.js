const fs = require("fs");
const path = require("path");

const ORDERS_LOG = process.env.ORDERS_LOG_PATH || "./pedidos.log";

/**
 * Detecta si la respuesta de Gemini contiene la señal de pedido confirmado.
 * Gemini incluirá "PEDIDO CONFIRMADO" cuando el flujo de cierre esté completo.
 * @param {string} botResponse
 * @returns {boolean}
 */
function isOrderConfirmed(botResponse) {
  return botResponse.toUpperCase().includes("PEDIDO CONFIRMADO");
}

/**
 * Extrae el bloque de resumen de pedido (🛒 RESUMEN DE TU PEDIDO ... TOTAL) del historial.
 * Busca el mensaje del bot que contiene el resumen y devuelve solo la parte relevante.
 * @param {Array} history
 * @returns {string|null}
 */
function extractOrderSummary(history) {
  const reversed = [...history].reverse();
  for (const turn of reversed) {
    if (turn.role !== "model") continue;
    const text = turn.parts[0].text;
    if (!text.includes("RESUMEN DE TU PEDIDO")) continue;

    // Extraemos desde el encabezado del resumen hasta el TOTAL inclusive
    const match = text.match(/(🛒[\s\S]*?💰\s*\*TOTAL[^*\n]*\*)/i);
    if (match) return match[1].trim();

    // Fallback: todo lo que está antes de la pregunta de confirmación
    const cutIdx = text.indexOf("¿Confirmás");
    if (cutIdx > -1) return text.substring(0, cutIdx).trim();

    return text.trim();
  }
  return null;
}

/**
 * Genera el ticket de despacho en texto plano estructurado.
 * @param {string} phone  - Número del cliente
 * @param {Object} deliveryData - Datos de entrega y resumen del pedido
 * @returns {string} Ticket formateado
 */
function buildDispatchTicket(phone, deliveryData, ticketNumber = "") {
  const timestamp = new Date().toLocaleString("es-CO", {
    timeZone: process.env.TIMEZONE || "America/Bogota",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const brand = (process.env.BRAND_NAME || "Donatto Resto-Bar").toUpperCase();
  const orderSection = deliveryData.resumenPedido || "⚠️ Sin detalle de productos";

  const ticket = [
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    `🛵 *NUEVO PEDIDO - ${brand}*`,
    `📅 ${timestamp}`,
    ticketNumber ? `🎫 *DOMICILIO* — Ticket *${ticketNumber}*` : null,
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    `📱 *Cliente:* ${deliveryData.nombre || "Sin nombre"}`,
    `📞 *WhatsApp:* +${phone}`,
    `📍 *Dirección:* ${deliveryData.direccion || "Sin especificar"}`,
    `💳 *Pago:* ${deliveryData.metodoPago || "Sin especificar"}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    orderSection,
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
  ].filter(Boolean).join("\n");

  return ticket;
}

/**
 * Guarda el pedido en el archivo de log local.
 * @param {string} ticket
 */
function saveToLog(ticket) {
  const logPath = path.resolve(ORDERS_LOG);
  const entry = `\n${ticket}\n`;
  fs.appendFileSync(logPath, entry, "utf-8");
  console.log(`[OrderProcessor] Pedido guardado en ${logPath}`);
}

/**
 * Procesa el cierre del pedido: guarda el log y retorna el ticket
 * listo para enviar al número de despacho.
 *
 * @param {string} phone
 * @param {import('./sessionManager').Session} session
 * @returns {string} ticket listo para enviar
 */
function processOrder(phone, session) {
  const ticket = buildDispatchTicket(phone, session.deliveryData);
  saveToLog(ticket);
  return ticket;
}

/**
 * Extrae datos de entrega del texto generado por Gemini cuando el bot
 * los confirma. El bot está instruído para confirmar nombre, dirección
 * y método de pago antes de emitir "PEDIDO CONFIRMADO".
 *
 * Esta función hace un parsing básico; la fuente de verdad es el historial
 * de conversación que Gemini ya procesó.
 *
 * @param {string} conversationText - Concatenación del historial relevante
 * @param {Object} existing - Datos ya recopilados (para no pisar con undefined)
 * @returns {Object}
 */
function extractDeliveryData(history, existing = {}) {
  const data = { ...existing };
  const blacklist = ["completo", "de entrega", "de pago", "sin especificar", "donato", "donattos", "restaurante", "pizzería", "asistente", "virtual"];

  // Ampliamos la ventana a 20 turnos para cubrir conversaciones más largas
  const recentHistory = history.slice(-20);

  // ── 1. Extracción de NOMBRE ──────────────────────────────────────────────
  if (!data.nombre || blacklist.includes(data.nombre.toLowerCase())) {
    for (let i = 1; i < recentHistory.length; i++) {
      const prev = recentHistory[i - 1]; // turno anterior
      const curr = recentHistory[i];     // turno actual
      if (curr.role !== "user" || prev.role !== "model") continue;

      const botText = prev.parts[0].text.toLowerCase();
      // ¿El bot pidió datos de entrega, nombre, o dio instrucciones de cierre?
      const isAskingForData = botText.includes("nombre") || botText.includes("dirección") || 
                              botText.includes("entrega") || botText.includes("pasame") || 
                              botText.includes("decime") || botText.includes("datos");
      if (!isAskingForData) continue;

      const userLines = curr.parts[0].text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
      if (userLines.length === 0) continue;

      // Estrategia B (Mejorada): Tomamos la primera línea de un bloque si parece un nombre.
      const firstLine = userLines[0];
      // Un nombre no debería tener demasiados números ni símbolos (permitimos espacios y acentos)
      if (/^[A-ZÁÉÍÓÚÑa-záéíóúñ\s]{2,30}$/.test(firstLine) && !blacklist.some(b => firstLine.toLowerCase().includes(b))) {
        data.nombre = firstLine;
        break;
      }
    }
  }

  if (!data.nombre || blacklist.includes(data.nombre.toLowerCase())) {
    // Estrategia A: el bot usa el nombre al agradecer o confirmar los datos
    // Ej: "¡Muchas gracias, Lady!" / "Perfecto, Juan," / "Listo, Ana!"
    for (const turn of [...recentHistory].reverse()) {
      if (turn.role !== "model") continue;
      const text = turn.parts[0].text;
      const m = text.match(/(?:gracias|perfecto|listo|hola),\s*([A-ZÁÉÍÓÚÑa-záéíóúñ]{2,25})(?:[,!\s🎉✨]|$)/i);
      if (m) {
        const val = m[1].trim();
        const stopWords = ["por", "de", "tu", "te", "se", "lo", "la", "el", "un", "una", "que", "con", "su", "al", "del", "soy", "hay"];
        if (!blacklist.some(b => val.toLowerCase().includes(b)) && !stopWords.includes(val.toLowerCase())) {
          data.nombre = val;
          break;
        }
      }
    }
  }

  if (!data.nombre || blacklist.includes(data.nombre.toLowerCase())) {
    // Estrategia C (fallback): keywords explícitos en cualquier turno
    for (const turn of [...recentHistory].reverse()) {
      const text = turn.parts[0].text;
      const m = text.match(/(?:nombre|me llamo|soy)\s+(?:es\s+)?([A-ZÁÉÍÓÚÑa-záéíóúñ\s]{2,30})/i);
      if (m) {
        const val = m[1].trim();
        if (!blacklist.some(b => val.toLowerCase().includes(b))) {
          data.nombre = val;
          break;
        }
      }
    }
  }

  // ── Resto de campos (dirección y pago, sin cambios) ──────────────────────
  const reversedHistory = [...recentHistory].reverse();
  for (const turn of reversedHistory) {
    const text = turn.parts[0].text;

    // 2. Extracción de DIRECCIÓN
    if (!data.direccion || blacklist.includes(data.direccion.toLowerCase())) {
      const match = text.match(/(?:dirección|domicilio|calle|call|cra|carrera|vivo en|entregar en|camino a)[:\s*]+([^*.\n]{5,80})/i);
      if (match) {
        const val = match[1].trim();
        if (!blacklist.some(b => val.toLowerCase().includes(b))) {
          data.direccion = val;
        }
      }
    }

    // 3. Extracción de MÉTODO DE PAGO
    if (!data.metodoPago || data.metodoPago === "Sin especificar") {
      const match = text.match(/(efectivo|transferencia|mercado\s?pago|pagar con)/i);
      if (match) {
        const raw = match[0].toLowerCase();
        if (raw.includes("efectivo")) data.metodoPago = "Efectivo";
        else if (raw.includes("mercado")) data.metodoPago = "Mercado Pago";
        else if (raw.includes("transfer")) data.metodoPago = "Transferencia";
      }
    }
  }

  // 4. Extracción del RESUMEN DEL PEDIDO (lista de productos + total)
  const summary = extractOrderSummary(history);
  if (summary) data.resumenPedido = summary;

  // 5. Fallback de Bloque Estructurado (Nombre \n Dirección \n Pago)
  // Si tenemos un mensaje de 3 líneas y ya identificamos el nombre en la línea 1,
  // y la línea 3 parece un método de pago, la línea 2 es casi seguro la dirección.
  for (const turn of [...recentHistory].reverse()) {
    if (turn.role !== "user") continue;
    const lines = turn.parts[0].text.split("\n").map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length >= 2 && lines.length <= 4) {
      // Si ya tenemos el nombre y el pago pero no la dirección
      if (data.nombre && data.metodoPago && (!data.direccion || data.direccion === "Sin especificar")) {
        // Buscamos si este mensaje contiene el nombre recolectado
        if (lines[0].toLowerCase().includes(data.nombre.toLowerCase()) || data.nombre.toLowerCase().includes(lines[0].toLowerCase())) {
          // Si el nombre está en la línea 1, la línea 2 es la dirección
          data.direccion = lines[1];
        }
      }
    }
  }

  // Limpieza final de valores residuales
  if (data.nombre && blacklist.includes(data.nombre.toLowerCase())) data.nombre = undefined;
  if (data.direccion && blacklist.includes(data.direccion.toLowerCase())) data.direccion = undefined;

  return data;
}

/**
 * Extrae marcadores estructurados que Gemini emite al recolectar datos de entrega.
 * Devuelve los datos encontrados y la respuesta limpia (sin los marcadores).
 *
 * Marcadores esperados (al final del mensaje de Gemini):
 *   [DATO_NOMBRE:Juan Pérez]
 *   [DATO_DIR:Calle 12 # 34-56]
 *   [DATO_PAGO:Efectivo]
 *
 * @param {string} botResponse
 * @returns {{ data: Object, cleanResponse: string }}
 */
function extractMarkersFromResponse(botResponse) {
  const data = {};

  const nombreMatch = botResponse.match(/\[DATO_NOMBRE:([^\]]+)\]/i);
  if (nombreMatch) data.nombre = nombreMatch[1].trim();

  const dirMatch = botResponse.match(/\[DATO_DIR:([^\]]+)\]/i);
  if (dirMatch) data.direccion = dirMatch[1].trim();

  const pagoMatch = botResponse.match(/\[DATO_PAGO:([^\]]+)\]/i);
  if (pagoMatch) {
    const raw = pagoMatch[1].trim().toLowerCase();
    if (raw.includes("mercado")) data.metodoPago = "Mercado Pago";
    else if (raw.includes("transfer")) data.metodoPago = "Transferencia bancaria";
    else data.metodoPago = "Efectivo";
  }

  const cleanResponse = botResponse
    .replace(/\[DATO_NOMBRE:[^\]]*\]/gi, "")
    .replace(/\[DATO_DIR:[^\]]*\]/gi, "")
    .replace(/\[DATO_PAGO:[^\]]*\]/gi, "")
    .trimEnd();

  return { data, cleanResponse };
}

module.exports = {
  isOrderConfirmed,
  buildDispatchTicket,
  processOrder,
  extractDeliveryData,
  extractMarkersFromResponse,
};
