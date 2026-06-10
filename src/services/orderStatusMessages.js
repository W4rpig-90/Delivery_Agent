/**
 * orderStatusMessages.js — traduce las respuestas de la cocina (palabras clave)
 * a estados, y genera los mensajes que recibe el cliente final.
 *
 * Se usa con el conector whatsapp-web.js (sin botones interactivos): la cocina
 * responde con una palabra clave (ideal: citando el mensaje del pedido).
 */

function normalize(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}

// Palabra clave / número / emoji → estado
const KEYWORD_MAP = [
  { status: "accepted",  match: /\b(recibido|aceptad[oa]|acepto|aceptar|acepta|ok|dale|1)\b|✅/ },
  { status: "cooking",   match: /\b(preparando|en preparaci[oó]n|cocinando|cocina|2)\b|👨‍🍳|🍳/ },
  { status: "sent",      match: /\b(entregando|enviad[oa]|despachad[oa]|en camino|camino|salio|3)\b|🛵|🏍/ },
  { status: "ready",     match: /\b(list[oa]|lista para recoger|recoger|4)\b|🎉/ },
  { status: "cancelled", match: /\b(cancelar|cancelad[oa]|rechazar|rechazad[oa]|anular)\b|❌/ }
];

/** Devuelve el estado correspondiente a la respuesta de cocina, o null. */
function parseKitchenKeyword(text) {
  const t = normalize(text);
  if (!t) return null;
  for (const { status, match } of KEYWORD_MAP) {
    if (match.test(t)) return status;
  }
  return null;
}

/** Instrucciones que se anexan al ticket enviado a la cocina. */
function kitchenInstructions(ticketNumber) {
  return [
    "",
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    `↩️ *Responde a este mensaje* para actualizar el pedido *${ticketNumber}*:`,
    "✅ *recibido*   👨‍🍳 *preparando*   🛵 *entregando*",
    "❌ *cancelar* para rechazarlo"
  ].join("\n");
}

/** Mensaje que se envía al CLIENTE cuando cambia el estado. null = no notificar. */
function customerStatusMessage(order, status) {
  const ticket = order.ticket_number || "";
  const name = order.customer_name ? `, ${order.customer_name}` : "";
  switch (status) {
    case "accepted":
      return `✅ ¡Hola${name}! Tu pedido *${ticket}* fue *recibido* por la cocina. Ya comenzamos a prepararlo. 🍕`;
    case "cooking":
      return `👨‍🍳 Tu pedido *${ticket}* está *en preparación*. Ya casi está listo.`;
    case "ready":
      return `🎉 ¡Tu pedido *${ticket}* está *listo*! Pronto te llega.`;
    case "sent":
      return `🛵 ¡Tu pedido *${ticket}* va en camino! Ya está con el domiciliario. 🙌`;
    case "entregado":
      return `🙌 ¡Tu pedido *${ticket}* fue *entregado*! Que lo disfrutes. Gracias por tu compra. 🍕`;
    case "finalizado":
      return `🏁 ¡Pedido *${ticket}* finalizado! Gracias por tu visita. Vuelve pronto. 😊`;
    case "cancelled":
      return `❌ Lamentamos avisarte que tu pedido *${ticket}* fue *cancelado*. Escríbenos si necesitas ayuda.`;
    default:
      return null;
  }
}

module.exports = { parseKitchenKeyword, kitchenInstructions, customerStatusMessage };
