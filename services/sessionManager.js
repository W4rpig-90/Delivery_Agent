/**
 * sessionManager.js
 *
 * Gestiona el estado de la conversación y el carrito de cada usuario
 * en memoria (Map). Cada sesión vive mientras el proceso Node esté activo.
 * Para persistencia entre reinicios, reemplazá el Map por Redis o SQLite.
 */

// TTL: la sesión expira si el usuario no escribe en 45 minutos
const SESSION_TTL_MS = 45 * 60 * 1000;

// Map principal: phoneNumber (string) → Session object
const sessions = new Map();

/**
 * @typedef {Object} CartItem
 * @property {string} id       - ID del ítem del menú
 * @property {string} nombre   - Nombre del ítem
 * @property {number} cantidad
 * @property {number} precio   - Precio unitario
 * @property {string} [nota]   - Aclaración del cliente (ej: "sin cebolla")
 */

/**
 * @typedef {Object} Session
 * @property {string} phone
 * @property {Array<{role: string, parts: Array<{text: string}>}>} history - Historial para Gemini
 * @property {CartItem[]} cart
 * @property {'chatting'|'confirming'|'collecting_data'|'closed'} state
 * @property {{ nombre?: string, direccion?: string, metodoPago?: string }} deliveryData
 * @property {number} lastActivity - Timestamp unix
 */

/**
 * Obtiene o crea la sesión para un número de teléfono.
 * @param {string} phone
 * @returns {Session}
 */
function getSession(phone) {
  if (sessions.has(phone)) {
    const session = sessions.get(phone);
    // Si la sesión expiró, la reseteamos
    if (Date.now() - session.lastActivity > SESSION_TTL_MS) {
      sessions.delete(phone);
      return createSession(phone);
    }
    session.lastActivity = Date.now();
    return session;
  }
  return createSession(phone);
}

/**
 * Crea una sesión nueva limpia.
 * @param {string} phone
 * @returns {Session}
 */
function createSession(phone) {
  const session = {
    phone,
    history: [],
    cart: [],
    state: "chatting",
    deliveryData: {},
    lastActivity: Date.now(),
  };
  sessions.set(phone, session);
  return session;
}

/**
 * Agrega un turno al historial de la conversación (formato requerido por Gemini).
 * @param {Session} session
 * @param {'user'|'model'} role
 * @param {string} text
 */
function addToHistory(session, role, text) {
  session.history.push({ role, parts: [{ text }] });

  // Limitamos el historial a los últimos 40 turnos para controlar el uso de tokens.
  // 40 turnos ≈ 20 intercambios, suficiente para un pedido completo.
  // Esto evita que sesiones muy largas escalen el costo de tokens sin límite.
  if (session.history.length > 40) {
    session.history = session.history.slice(-40);
  }
}

/**
 * Limpia las sesiones que hayan expirado (llamar periódicamente si se desea).
 */
function cleanExpiredSessions() {
  const now = Date.now();
  for (const [phone, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TTL_MS) {
      sessions.delete(phone);
    }
  }
}

// Auto-limpieza cada 30 minutos para evitar fugas de memoria en producción
setInterval(cleanExpiredSessions, 30 * 60 * 1000);

/**
 * Cierra y elimina la sesión de un usuario.
 * @param {string} phone
 */
function closeSession(phone) {
  sessions.delete(phone);
}

/**
 * Devuelve un snapshot de todas las sesiones activas (útil para debugging).
 * @returns {number}
 */
function getActiveSessionCount() {
  return sessions.size;
}

module.exports = {
  getSession,
  addToHistory,
  closeSession,
  getActiveSessionCount,
};
