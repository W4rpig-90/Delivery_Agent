/**
 * hub.js — servidor WebSocket para la pantalla de cocina (KDS) en tiempo real.
 *
 * - Se adjunta al mismo servidor HTTP (ruta /ws), sin abrir otro puerto.
 * - Autentica el handshake con la cookie de sesión del admin (misma sesión).
 * - Reenvía a los clientes los eventos del bus de pedidos (order:new / order:status).
 */

const { WebSocketServer } = require("ws");
const orderBus = require("../orderEvents");
const { verifySessionToken, parseCookies, COOKIE_NAME } = require("../middleware/auth");

let wss = null;

function attach(server) {
  wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    if (!req.url || !req.url.startsWith("/ws")) { socket.destroy(); return; }

    const token = parseCookies(req)[COOKIE_NAME];
    const session = verifySessionToken(token);
    if (!session) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
      ws.user = session;
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", ws => {
    ws.send(JSON.stringify({ type: "hello", user: ws.user.username }));
    ws.on("error", () => {});
  });

  orderBus.on("order:new", order => broadcast("order:new", order));
  orderBus.on("order:status", order => broadcast("order:status", order));

  console.log("[WS] Hub de KDS listo en /ws");
}

function broadcast(type, payload) {
  if (!wss) return;
  const msg = JSON.stringify({ type, payload });
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
}

module.exports = { attach, broadcast };
