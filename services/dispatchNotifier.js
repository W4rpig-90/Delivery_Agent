const axios = require("axios");

const N8N_WEBHOOK_URL = process.env.KIOSK_N8N_WEBHOOK_URL;
const META_TOKEN = process.env.META_ACCESS_TOKEN;
const META_PHONE_ID = process.env.META_PHONE_NUMBER_ID;
const DISPATCH_NUMBER = process.env.DISPATCH_NUMBER;

async function notifyDispatch({ ticket, payload }) {
  if (N8N_WEBHOOK_URL) {
    try {
      await axios.post(N8N_WEBHOOK_URL, { ticket, ...payload }, { timeout: 8000 });
      console.log("[NOTIFY] Pedido enviado al webhook n8n ✓");
      return { channel: "n8n" };
    } catch (err) {
      console.error("[NOTIFY] Falló webhook n8n:", err.message);
    }
  }

  if (META_TOKEN && META_PHONE_ID && DISPATCH_NUMBER) {
    try {
      const url = `https://graph.facebook.com/v21.0/${META_PHONE_ID}/messages`;
      await axios.post(url, {
        messaging_product: "whatsapp",
        to: DISPATCH_NUMBER,
        type: "text",
        text: { body: ticket.replace(/\*/g, "*") }
      }, {
        headers: { Authorization: `Bearer ${META_TOKEN}` },
        timeout: 8000
      });
      console.log("[NOTIFY] Pedido enviado a WhatsApp despacho directo ✓");
      return { channel: "whatsapp_direct" };
    } catch (err) {
      console.error("[NOTIFY] Falló WhatsApp directo:", err.response?.data || err.message);
    }
  }

  console.warn("[NOTIFY] Sin canales configurados — solo se imprime localmente.");
  return { channel: "none" };
}

module.exports = { notifyDispatch };
