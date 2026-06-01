const { formatCop } = require("./database");

const TZ = process.env.TIMEZONE || "America/Bogota";
const BRAND = process.env.BRAND_NAME || "Donatto Resto-Bar";

const PAY_LABEL = {
  efectivo: "Efectivo (cobro en caja)",
  qr_transferencia: "QR / Transferencia",
  datafono: "Tarjeta (datáfono)"
};

const DELIVERY_LABEL = {
  mesa: "Mesa",
  para_llevar: "Para llevar",
  domicilio: "Domicilio"
};

function buildKioskTicket({ ticketNumber, customerName, items, subtotalCop, paymentMethod, deliveryType, mesa, notas }) {
  const ts = new Date().toLocaleString("es-CO", {
    timeZone: TZ,
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });

  const lines = [
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    `🍽️ *NUEVO PEDIDO - ${BRAND.toUpperCase()}*`,
    `📅 ${ts}`,
    `🏪 *KIOSKO* — Ticket *${ticketNumber}*`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    `👤 *Cliente:* ${customerName || "Cliente kiosko"}`,
    `🍴 *Modalidad:* ${DELIVERY_LABEL[deliveryType] || "Para llevar"}${mesa ? ` (Mesa ${mesa})` : ""}`,
    `💳 *Pago:* ${PAY_LABEL[paymentMethod] || paymentMethod}`,
    "━━━━━━━━━━━━━━━━━━━━━━━━━",
    "🛒 *RESUMEN DE TU PEDIDO*",
    ""
  ];

  for (const it of items) {
    const lineTotal = it.qty * it.price;
    lines.push(`• ${it.qty} x ${it.name}`);
    lines.push(`     $${formatCop(it.price)} c/u  →  $${formatCop(lineTotal)}`);
    if (it.notes) lines.push(`     Nota: ${it.notes}`);
  }

  lines.push("");
  lines.push(`💰 *TOTAL: $${formatCop(subtotalCop)}*`);
  if (notas) {
    lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━");
    lines.push(`📝 *Notas:* ${notas}`);
  }
  lines.push("━━━━━━━━━━━━━━━━━━━━━━━━━");

  return lines.join("\n");
}

module.exports = { buildKioskTicket, PAY_LABEL, DELIVERY_LABEL };
