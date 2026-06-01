const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DB_PATH || "./donattos.db";

let db;

function getDB() {
  if (!db) {
    db = new Database(path.resolve(DB_PATH));
    db.pragma("journal_mode = WAL");
    initTables();
    migrateSchema();
    console.log(`[DB] Base de datos lista en ${path.resolve(DB_PATH)}`);
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clientes (
      telefono        TEXT PRIMARY KEY,
      nombre_completo TEXT,
      direccion       TEXT,
      creado_en       TEXT DEFAULT (datetime('now', '-5 hours'))
    );

    CREATE TABLE IF NOT EXISTS pedidos (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      telefono        TEXT NOT NULL,
      nombre_completo TEXT,
      direccion       TEXT,
      productos       TEXT,
      total           TEXT,
      metodo_pago     TEXT,
      fecha_pedido    TEXT DEFAULT (datetime('now', '-5 hours')),
      FOREIGN KEY (telefono) REFERENCES clientes(telefono)
    );

    CREATE TABLE IF NOT EXISTS ticket_counter (
      bucket   TEXT PRIMARY KEY,
      last_num INTEGER NOT NULL DEFAULT 0
    );
  `);
}

function migrateSchema() {
  const cols = db.prepare("PRAGMA table_info(pedidos)").all().map(c => c.name);
  const additions = [
    ["order_source", "TEXT DEFAULT 'whatsapp'"],
    ["delivery_type", "TEXT"],
    ["mesa", "TEXT"],
    ["ticket_number", "TEXT"],
    ["items_json", "TEXT"],
    ["subtotal_cop", "INTEGER"],
    ["status", "TEXT DEFAULT 'pending'"],
    ["notas", "TEXT"]
  ];
  for (const [name, ddl] of additions) {
    if (!cols.includes(name)) {
      db.exec(`ALTER TABLE pedidos ADD COLUMN ${name} ${ddl}`);
    }
  }
}

function upsertClient(telefono, nombre, direccion) {
  getDB().prepare(`
    INSERT OR IGNORE INTO clientes (telefono, nombre_completo, direccion)
    VALUES (?, ?, ?)
  `).run(telefono, nombre ?? null, direccion ?? null);
}

function saveOrder(telefono, nombre, direccion, productos, total, metodoPago) {
  const result = getDB().prepare(`
    INSERT INTO pedidos (telefono, nombre_completo, direccion, productos, total, metodo_pago, order_source)
    VALUES (?, ?, ?, ?, ?, ?, 'whatsapp')
  `).run(
    telefono,
    nombre ?? null,
    direccion ?? null,
    productos ?? null,
    total ?? null,
    metodoPago ?? null
  );
  return result.lastInsertRowid;
}

function parseTotalFromSummary(resumenPedido) {
  if (!resumenPedido) return null;
  const match = resumenPedido.match(/TOTAL[^$\d]*\$([\d.,]+)/i);
  return match ? `$${match[1]}` : null;
}

function nextTicketNumber(prefix = "K") {
  const today = new Date().toISOString().slice(0, 10);
  const bucket = `${prefix}-${today}`;
  const tx = getDB().transaction((bk) => {
    getDB().prepare("INSERT OR IGNORE INTO ticket_counter (bucket, last_num) VALUES (?, 0)").run(bk);
    getDB().prepare("UPDATE ticket_counter SET last_num = last_num + 1 WHERE bucket = ?").run(bk);
    return getDB().prepare("SELECT last_num FROM ticket_counter WHERE bucket = ?").get(bk).last_num;
  });
  const num = tx(bucket);
  return `${prefix}-${String(num).padStart(3, "0")}`;
}

function saveKioskOrder({ ticketNumber, customerName, items, subtotalCop, totalDisplay, paymentMethod, deliveryType, mesa, notas }) {
  const productosTxt = items
    .map(i => `${i.qty}x ${i.name} ($${formatCop(i.price * i.qty)})`)
    .join("; ");
  const pseudoPhone = `KIOSKO-${ticketNumber}`;
  const tx = getDB().transaction(() => {
    getDB().prepare(`INSERT OR IGNORE INTO clientes (telefono, nombre_completo) VALUES (?, ?)`)
      .run(pseudoPhone, customerName ?? null);
    return getDB().prepare(`
      INSERT INTO pedidos (
        telefono, nombre_completo, direccion, productos, total, metodo_pago,
        order_source, delivery_type, mesa, ticket_number, items_json, subtotal_cop, status, notas
      )
      VALUES (?, ?, ?, ?, ?, ?, 'kiosko', ?, ?, ?, ?, ?, 'pending', ?)
    `).run(
      pseudoPhone,
      customerName ?? null,
      null,
      productosTxt,
      totalDisplay,
      paymentMethod,
      deliveryType ?? null,
      mesa ?? null,
      ticketNumber,
      JSON.stringify(items),
      subtotalCop,
      notas ?? null
    ).lastInsertRowid;
  });
  return tx();
}

function formatCop(n) {
  return Math.round(n).toLocaleString("es-CO");
}

module.exports = {
  upsertClient,
  saveOrder,
  parseTotalFromSummary,
  saveKioskOrder,
  nextTicketNumber,
  formatCop
};
