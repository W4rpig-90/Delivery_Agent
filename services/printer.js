/**
 * printer.js
 *
 * Envía tickets de pedido a una impresora POS térmica en la LAN
 * usando el protocolo ESC/POS sobre TCP (puerto 9100).
 *
 * Compatible con Epson, Star, Bixolon, y cualquier impresora
 * que soporte ESC/POS por red. No requiere dependencias externas.
 *
 * Variables de entorno requeridas:
 *   PRINTER_IP    IP de la impresora en la LAN (ej: 192.168.1.100)
 *   PRINTER_PORT  Puerto TCP (default: 9100)
 */

const net = require("net");

const PRINTER_IP = process.env.PRINTER_IP;
const PRINTER_PORT = parseInt(process.env.PRINTER_PORT || "9100", 10);
const CONNECT_TIMEOUT_MS = 5000;

// ─── Comandos ESC/POS ────────────────────────────────────────────────────────
const ESC = "\x1B";
const GS  = "\x1D";

const CMD = {
  INIT:           ESC + "@",           // Inicializar impresora
  BOLD_ON:        ESC + "\x45\x01",
  BOLD_OFF:       ESC + "\x45\x00",
  ALIGN_LEFT:     ESC + "\x61\x00",
  ALIGN_CENTER:   ESC + "\x61\x01",
  FONT_NORMAL:    ESC + "\x21\x00",    // Tamaño normal
  FONT_DOUBLE:    ESC + "\x21\x30",    // Doble alto+ancho (título)
  LF:             "\x0A",
  CUT:            GS  + "\x56\x41\x05", // Corte parcial con avance
};

// ─── Formateador ─────────────────────────────────────────────────────────────

/**
 * Convierte el ticket de texto (con markdown de WhatsApp) a bytes ESC/POS.
 * - Las líneas con *texto* se imprimen en negrita.
 * - La línea del encabezado principal usa fuente doble.
 * - Los separadores ━━━ se reemplazan por guiones ASCII (compatibilidad).
 * @param {string} ticketText
 * @returns {Buffer}
 */
function formatForPOS(ticketText) {
  const lines = ticketText.split("\n");
  const parts = [CMD.INIT, CMD.ALIGN_LEFT, CMD.FONT_NORMAL];

  for (const raw of lines) {
    // Reemplazar separadores Unicode por guiones ASCII
    const line = raw.replace(/━/g, "-");

    // Detectar si la línea tiene contenido en negrita (*...*)
    const hasBold = /\*[^*]+\*/.test(line);
    // Limpiar asteriscos de markdown
    const clean = line.replace(/\*/g, "");

    // Línea de título principal: fuente doble centrada
    if (clean.includes("NUEVO PEDIDO")) {
      parts.push(
        CMD.ALIGN_CENTER,
        CMD.FONT_DOUBLE,
        CMD.BOLD_ON,
        clean + CMD.LF,
        CMD.BOLD_OFF,
        CMD.FONT_NORMAL,
        CMD.ALIGN_LEFT
      );
    } else if (hasBold) {
      parts.push(CMD.BOLD_ON, clean + CMD.LF, CMD.BOLD_OFF);
    } else {
      parts.push(clean + CMD.LF);
    }
  }

  // Avance de papel y corte
  parts.push(CMD.LF, CMD.LF, CMD.LF, CMD.CUT);

  return Buffer.from(parts.join(""), "binary");
}

// ─── Función principal ───────────────────────────────────────────────────────

/**
 * Envía el ticket a la impresora POS por TCP.
 * Si PRINTER_IP no está configurado, la operación se omite sin error.
 * @param {string} ticketText - Texto del ticket (mismo que va al DISPATCH)
 * @returns {Promise<void>}
 */
function printTicket(ticketText) {
  if (!PRINTER_IP) {
    console.warn("[PRINTER] PRINTER_IP no configurado — impresión omitida.");
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const data = formatForPOS(ticketText);

    socket.setTimeout(CONNECT_TIMEOUT_MS);

    socket.connect(PRINTER_PORT, PRINTER_IP, () => {
      socket.write(data, () => {
        socket.destroy();
        console.log(`[PRINTER] Ticket impreso en ${PRINTER_IP}:${PRINTER_PORT} ✓`);
        resolve();
      });
    });

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error(`[PRINTER] Timeout conectando a ${PRINTER_IP}:${PRINTER_PORT}`));
    });

    socket.on("error", (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

module.exports = { printTicket };
