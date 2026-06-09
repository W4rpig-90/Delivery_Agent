const axios = require("axios");

// Sender registrado por whatsappWeb.js cuando el cliente WA está listo.
// Firma: async (ticket: string) => void
let _waSender = null;
function setWaDispatchSender(fn) { _waSender = fn; }

async function notifyDispatch({ ticket, payload }) {
  const N8N_WEBHOOK_URL = process.env.KIOSK_N8N_WEBHOOK_URL;
  const META_TOKEN      = process.env.META_ACCESS_TOKEN;
  const META_PHONE_ID   = process.env.META_PHONE_NUMBER_ID;
  const DISPATCH_NUMBER = process.env.DISPATCH_NUMBER;

  // Canal 1: n8n webhook
  if (N8N_WEBHOOK_URL) {
    try {
      await axios.post(N8N_WEBHOOK_URL, { ticket, ...payload }, { timeout: 8000 });
      console.log("[NOTIFY] Pedido enviado al webhook n8n ✓");
      return { channel: "n8n" };
    } catch (err) {
      console.error("[NOTIFY] Falló webhook n8n:", err.message);
    }
  }

  // Canal 2: WhatsApp Business API (Meta)
  if (META_TOKEN && META_PHONE_ID && DISPATCH_NUMBER) {
    try {
      const url = `https://graph.facebook.com/v21.0/${META_PHONE_ID}/messages`;
      await axios.post(url, {
        messaging_product: "whatsapp",
        to: DISPATCH_NUMBER,
        type: "text",
        text: { body: ticket }
      }, { headers: { Authorization: `Bearer ${META_TOKEN}` }, timeout: 8000 });
      console.log("[NOTIFY] Pedido enviado a WhatsApp Business ✓");
      return { channel: "whatsapp_meta" };
    } catch (err) {
      console.error("[NOTIFY] Falló WhatsApp Business:", err.response?.data || err.message);
    }
  }

  // Canal 3: WhatsApp Web (cliente local — registrado por whatsappWeb.js)
  if (_waSender) {
    try {
      await _waSender(ticket);
      console.log("[NOTIFY] Pedido enviado a WhatsApp Web (cocina) ✓");
      return { channel: "whatsapp_web" };
    } catch (err) {
      console.error("[NOTIFY] Falló WhatsApp Web:", err.message);
    }
  }

  console.warn("[NOTIFY] Sin canales de despacho configurados — solo impresión local.");
  return { channel: "none" };
}

module.exports = { notifyDispatch, setWaDispatchSender };
