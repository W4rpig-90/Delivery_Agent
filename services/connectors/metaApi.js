/**
 * Conector para la API Oficial de WhatsApp (Meta Cloud API)
 * Versión 2.0
 *
 * Variables de entorno requeridas:
 *   META_VERIFY_TOKEN   — token arbitrario que configurás en el dashboard de Meta
 *   META_ACCESS_TOKEN   — token de acceso permanente de la app de Meta
 *   META_PHONE_NUMBER_ID — ID del número de teléfono en Meta Business
 *   PORT                — puerto HTTP (default: 3000)
 */

const express = require("express");
const axios = require("axios");
const { chat } = require("../gemini");
const {
  getSession,
  addToHistory,
  closeSession,
} = require("../sessionManager");
const {
  isOrderConfirmed,
  processOrder,
  extractDeliveryData,
  extractMarkersFromResponse,
} = require("../orderProcessor");
const { upsertClient, saveOrder, parseTotalFromSummary } = require("../database");
const { printTicket } = require("../printer");

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN;
const ACCESS_TOKEN = process.env.META_ACCESS_TOKEN;
const PHONE_NUMBER_ID = process.env.META_PHONE_NUMBER_ID;
const DISPATCH_NUMBER = process.env.DISPATCH_NUMBER;
const PORT = process.env.PORT || 3000;

const GRAPH_API_URL = `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`;

// ─── Envío de mensajes ────────────────────────────────────────────────────────

async function sendText(to, text) {
  await axios.post(
    GRAPH_API_URL,
    {
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    },
    { headers: { Authorization: `Bearer ${ACCESS_TOKEN}` } }
  );
}

// ─── Procesamiento de mensajes ────────────────────────────────────────────────

async function handleTextMessage(phone, userText) {
  const session = getSession(phone);

  if (
    userText.toLowerCase() === "reiniciar" ||
    userText.toLowerCase() === "cancelar"
  ) {
    closeSession(phone);
    await sendText(phone, "Conversación reiniciada. ✨ Soy tu *Elite Style Consultant*. ¿En qué puedo asesorarte hoy?");
    return;
  }

  try {
    const botResponse = await chat(session.history, userText);
    const { data: markerData, cleanResponse } = extractMarkersFromResponse(botResponse);

    if (Object.keys(markerData).length > 0) {
      session.deliveryData = { ...session.deliveryData, ...markerData };
    }

    addToHistory(session, "user", userText);
    addToHistory(session, "model", cleanResponse);
    session.deliveryData = extractDeliveryData(session.history, session.deliveryData);

    await sendText(phone, cleanResponse);

    if (isOrderConfirmed(cleanResponse)) {
      await handleOrderConfirmed(phone, session, cleanResponse);
    }
  } catch (err) {
    console.error(`[META] Error procesando mensaje de +${phone}:`, err.message);
    await sendText(phone, "Hubo un error técnico 😓 Por favor intentá de nuevo.");
  }
}

async function handleOrderConfirmed(phone, session, botResponse = "") {
  const nameMatch = botResponse.match(/¡Perfecto,\s*([A-ZÁÉÍÓÚÑa-záéíóúñ]{2,25})/i);
  if (nameMatch) {
    session.deliveryData.nombre = nameMatch[1].trim();
  }

  const ticket = processOrder(phone, session);
  const { nombre, direccion, metodoPago, resumenPedido } = session.deliveryData;

  try {
    upsertClient(phone, nombre, direccion);
    saveOrder(
      phone,
      nombre,
      direccion,
      resumenPedido,
      parseTotalFromSummary(resumenPedido),
      metodoPago
    );
  } catch (err) {
    console.error("[DB] Error:", err.message);
  }

  const tasks = [printTicket(ticket)];

  // Reenviar ticket al número de despacho si está configurado
  if (DISPATCH_NUMBER) {
    tasks.push(sendText(DISPATCH_NUMBER, ticket));
  }

  await Promise.allSettled(tasks);
  closeSession(phone);
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

function initialize() {
  if (!VERIFY_TOKEN || !ACCESS_TOKEN || !PHONE_NUMBER_ID) {
    console.error(
      "[Meta API] Faltan variables de entorno: META_VERIFY_TOKEN, META_ACCESS_TOKEN, META_PHONE_NUMBER_ID"
    );
    process.exit(1);
  }

  const app = express();
  app.use(express.json());

  // Verificación del webhook (Meta llama a este endpoint al configurarlo)
  app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      console.log("[Meta API] Webhook verificado correctamente ✓");
      res.status(200).send(challenge);
    } else {
      console.warn("[Meta API] Verificación de webhook fallida — token incorrecto");
      res.sendStatus(403);
    }
  });

  // Recepción de mensajes entrantes
  app.post("/webhook", async (req, res) => {
    // Responder 200 inmediatamente para que Meta no reintente el envío
    res.sendStatus(200);

    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages?.length) continue;

        for (const msg of value.messages) {
          const phone = msg.from; // número en formato internacional sin +

          if (msg.type === "text") {
            const userText = msg.text?.body?.trim();
            if (userText) {
              console.log(`[META] +${phone}: ${userText.slice(0, 80)}`);
              await handleTextMessage(phone, userText);
            }
          } else {
            // Tipo de mensaje no soportado aún (imagen, sticker, etc.)
            await sendText(
              phone,
              "Por ahora solo proceso mensajes de texto. ¡Escribime tu pedido! 😊"
            );
          }
        }
      }
    }
  });

  app.listen(PORT, () => {
    console.log(`[Meta API] Servidor HTTP escuchando en puerto ${PORT} ✓`);
    console.log(`[Meta API] Webhook URL: http://<tu-dominio>/webhook`);
    console.log("[Meta API] Experiencia de lujo lista para recibir clientes de Meta Cloud API ✓");
  });
}

module.exports = { initialize };
