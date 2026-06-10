/**
 * customers.repo.js — CRUD de clientes y su memoria para el bot de WhatsApp.
 */

const { getDB } = require("../db/connection");

function getMemory(phone) {
  if (!phone || phone.startsWith("KIOSKO-")) return null;
  return getDB().prepare("SELECT * FROM customer_memory WHERE phone = ?").get(phone) || null;
}

/**
 * Registra o actualiza la memoria de un cliente al iniciar una conversación.
 * Incrementa visit_count y actualiza last_seen.
 */
function touchMemory(phone, hints = {}) {
  if (!phone || phone.startsWith("KIOSKO-")) return;
  const db = getDB();
  const existing = db.prepare("SELECT phone FROM customer_memory WHERE phone = ?").get(phone);

  if (existing) {
    db.prepare(`
      UPDATE customer_memory
      SET visit_count    = visit_count + 1,
          last_seen      = datetime('now','-5 hours'),
          preferred_name = COALESCE(NULLIF(@name, ''), preferred_name),
          address_hint   = COALESCE(NULLIF(@address, ''), address_hint),
          updated_at     = datetime('now','-5 hours')
      WHERE phone = @phone
    `).run({ phone, name: hints.name || "", address: hints.address || "" });
  } else {
    db.prepare("INSERT OR IGNORE INTO customers (phone, name, address) VALUES (?, ?, ?)")
      .run(phone, hints.name || null, hints.address || null);
    db.prepare(`
      INSERT INTO customer_memory (phone, preferred_name, visit_count, last_seen, address_hint, updated_at)
      VALUES (@phone, @name, 1, datetime('now','-5 hours'), @address, datetime('now','-5 hours'))
    `).run({ phone, name: hints.name || null, address: hints.address || null });
  }
}

/**
 * Actualiza la memoria después de confirmar un pedido.
 */
function updateAfterOrder(phone, data = {}) {
  if (!phone || phone.startsWith("KIOSKO-")) return;
  const db = getDB();

  db.prepare("INSERT OR IGNORE INTO customers (phone, name, address) VALUES (?, ?, ?)")
    .run(phone, data.name || null, data.address || null);

  db.prepare(`
    INSERT INTO customer_memory
      (phone, preferred_name, visit_count, last_seen, last_order_summary, address_hint, updated_at)
    VALUES
      (@phone, @name, 1, datetime('now','-5 hours'), @orderSummary, @address, datetime('now','-5 hours'))
    ON CONFLICT(phone) DO UPDATE SET
      preferred_name     = COALESCE(NULLIF(@name, ''), preferred_name),
      last_order_summary = COALESCE(NULLIF(@orderSummary, ''), last_order_summary),
      address_hint       = COALESCE(NULLIF(@address, ''), address_hint),
      updated_at         = datetime('now','-5 hours')
  `).run({
    phone,
    name:         data.name         || null,
    orderSummary: data.orderSummary || null,
    address:      data.address      || null,
  });
}

/**
 * Construye un bloque de contexto en texto plano para el prompt del bot.
 * Devuelve "" si no hay datos relevantes.
 */
function buildContextBlock(phone) {
  const mem = getMemory(phone);
  if (!mem) return "";

  const lines = [];
  if (mem.preferred_name)     lines.push(`• Nombre: ${mem.preferred_name}`);
  if (mem.visit_count > 1)    lines.push(`• Visitas previas: ${mem.visit_count - 1}`);
  if (mem.last_seen)          lines.push(`• Última vez: ${mem.last_seen.slice(0, 10)}`);
  if (mem.last_order_summary) lines.push(`• Último pedido: ${mem.last_order_summary}`);
  if (mem.address_hint)       lines.push(`• Dirección habitual: ${mem.address_hint}`);
  if (mem.notes)              lines.push(`• Nota interna: ${mem.notes}`);

  if (!lines.length) return "";
  return `\n\n[CONTEXTO PRIVADO DEL CLIENTE — Solo para tu uso, NO lo menciones textualmente]\n${lines.join("\n")}\n[FIN CONTEXTO]`;
}

module.exports = { getMemory, touchMemory, updateAfterOrder, buildContextBlock };
