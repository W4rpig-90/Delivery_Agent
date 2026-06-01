require("dotenv").config();
const path = require("path");

const KIOSK_ENABLED = (process.env.KIOSK_ENABLED || "true").toLowerCase() === "true";
const WHATSAPP_LOCAL_ENABLED = (process.env.WHATSAPP_LOCAL_ENABLED || "false").toLowerCase() === "true";
const connectorType = process.env.WHATSAPP_CONNECTOR || "web";

console.log("════════════════════════════════════");
console.log(`   🍽️  ${process.env.BRAND_NAME || "DONATTO RESTO-BAR"}`);
console.log("════════════════════════════════════");
console.log(`Kiosko: ${KIOSK_ENABLED ? "ON" : "OFF"} | WhatsApp local: ${WHATSAPP_LOCAL_ENABLED ? `ON (${connectorType})` : "OFF (usar n8n cloud)"}\n`);

if (KIOSK_ENABLED) {
  const { start } = require("./src/app");
  try {
    start();
  } catch (err) {
    console.error("[APP] No se pudo iniciar:", err.message);
    process.exit(1);
  }
}

if (WHATSAPP_LOCAL_ENABLED) {
  if (!process.env.GEMINI_API_KEY) {
    console.error("[ERROR] WHATSAPP_LOCAL_ENABLED=true pero falta GEMINI_API_KEY en .env");
    process.exit(1);
  }
  const connectorPath = path.join(__dirname, "services", "connectors", `${connectorType === "meta" ? "metaApi" : "whatsappWeb"}.js`);
  try {
    const connector = require(connectorPath);
    connector.initialize();
  } catch (err) {
    console.error(`[ERROR] No se pudo inicializar el conector ${connectorType}:`, err.message);
    process.exit(1);
  }
}

if (!KIOSK_ENABLED && !WHATSAPP_LOCAL_ENABLED) {
  console.warn("[Sistema] Nada que arrancar. Define KIOSK_ENABLED=true o WHATSAPP_LOCAL_ENABLED=true en .env");
  process.exit(0);
}

process.on("SIGINT", () => {
  console.log("\n[Sistema] Cerrando…");
  process.exit(0);
});

process.on("unhandledRejection", (reason) => {
  console.error("[ERROR] Promesa rechazada sin manejar:", reason);
});
