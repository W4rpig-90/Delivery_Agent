/**
 * settings.repo.js — config clave-valor y métodos de pago.
 */

const { getDB } = require("../db/connection");

function getSetting(key, fallback = null) {
  const row = getDB().prepare("SELECT value FROM settings WHERE key = ?").get(key);
  return row ? row.value : fallback;
}

function getAllSettings() {
  const rows = getDB().prepare("SELECT key, value FROM settings").all();
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

function getEnabledPayments() {
  return getDB().prepare(`
    SELECT code, label, type, qr_image
    FROM payment_methods
    WHERE enabled = 1
    ORDER BY sort_order, label
  `).all();
}

// ─────────────── ADMIN ───────────────

function setSetting(key, value) {
  getDB().prepare(`
    INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now','-5 hours'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value);
}

function listPaymentMethods() {
  return getDB().prepare("SELECT * FROM payment_methods ORDER BY sort_order, label").all();
}

function getPaymentMethodById(id) {
  return getDB().prepare("SELECT * FROM payment_methods WHERE id = ?").get(id);
}

function updatePaymentMethod(id, { label, enabled }) {
  getDB().prepare("UPDATE payment_methods SET label = ?, enabled = ? WHERE id = ?")
    .run(label, enabled ? 1 : 0, id);
}

function setPaymentQr(id, qrImagePath) {
  getDB().prepare("UPDATE payment_methods SET qr_image = ? WHERE id = ?").run(qrImagePath, id);
}

module.exports = {
  getSetting,
  getAllSettings,
  getEnabledPayments,
  setSetting,
  listPaymentMethods,
  getPaymentMethodById,
  updatePaymentMethod,
  setPaymentQr
};
