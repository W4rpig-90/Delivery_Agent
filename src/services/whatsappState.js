// Singleton: estado actual de la conexión WhatsApp.
// whatsappWeb.js escribe; admin.routes.js lee y transmite por SSE.

let _state = { status: "disabled", qr: null };
const _listeners = new Set();

function getState() { return { ..._state }; }

function setState(patch) {
  _state = { ..._state, ...patch };
  for (const cb of _listeners) cb(_state);
}

function onChange(cb) {
  _listeners.add(cb);
  return () => _listeners.delete(cb);
}

module.exports = { getState, setState, onChange };
