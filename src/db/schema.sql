-- ════════════════════════════════════════════════════════════════════════
--  Donatto Resto-Bar — Esquema relacional (V4 self-hosted)
--  Motor: SQLite (better-sqlite3, modo WAL).
--  Todo idempotente: CREATE TABLE IF NOT EXISTS.
--  Fechas en hora de Bogotá (UTC-5, sin horario de verano): datetime('now','-5 hours').
--  Precios SIEMPRE en pesos enteros (COP), sin decimales.
-- ════════════════════════════════════════════════════════════════════════

-- ─────────────── USUARIOS Y CONFIGURACIÓN ───────────────

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,                       -- scrypt: salt:hash (hex)
  role          TEXT NOT NULL DEFAULT 'admin',       -- 'admin' | 'cocina'
  created_at    TEXT DEFAULT (datetime('now','-5 hours'))
);

-- Config clave-valor: marca, número de cocina, moneda, horarios, etc.
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT,
  updated_at TEXT DEFAULT (datetime('now','-5 hours'))
);

-- Métodos de pago (efectivo / QR estático cargado desde el panel)
CREATE TABLE IF NOT EXISTS payment_methods (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  code       TEXT UNIQUE NOT NULL,                   -- 'efectivo','nequi','daviplata'
  label      TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'cash',           -- 'cash' | 'qr_static'
  qr_image   TEXT,                                   -- ruta relativa en /data/uploads/qr
  enabled    INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0
);

-- ─────────────── MENÚ ───────────────

CREATE TABLE IF NOT EXISTS categories (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  slug       TEXT UNIQUE NOT NULL,                   -- 'entradas','pizzas_autor'...
  name       TEXT NOT NULL,
  emoji      TEXT,
  image      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  enabled    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  sku         TEXT UNIQUE,                           -- código del menú original (E01...), opcional
  name        TEXT NOT NULL,
  description TEXT,
  price_cop   INTEGER NOT NULL,
  image       TEXT,
  available   INTEGER NOT NULL DEFAULT 1,            -- 0 = agotado (sin borrar)
  sort_order  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);

-- Grupos de modificadores (Tamaño, Extras, Punto de cocción…)
CREATE TABLE IF NOT EXISTS modifier_groups (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  min_select INTEGER NOT NULL DEFAULT 0,             -- 0 = opcional
  max_select INTEGER NOT NULL DEFAULT 1              -- 1 = radio; >1 = checkbox
);

CREATE TABLE IF NOT EXISTS modifiers (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id  INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  price_cop INTEGER NOT NULL DEFAULT 0,              -- delta sobre el precio base
  enabled   INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_modifiers_group ON modifiers(group_id);

-- Relación N:M producto ↔ grupos de modificadores
CREATE TABLE IF NOT EXISTS product_modifier_groups (
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  group_id   INTEGER NOT NULL REFERENCES modifier_groups(id) ON DELETE CASCADE,
  PRIMARY KEY (product_id, group_id)
);

-- ─────────────── CLIENTES Y PEDIDOS ───────────────

CREATE TABLE IF NOT EXISTS customers (
  phone      TEXT PRIMARY KEY,                       -- teléfono WhatsApp; o KIOSKO-<ticket>
  name       TEXT,
  address    TEXT,
  created_at TEXT DEFAULT (datetime('now','-5 hours'))
);

CREATE TABLE IF NOT EXISTS orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_number  TEXT,                               -- K-001 (kiosko) / W-001 (whatsapp)
  source         TEXT NOT NULL,                      -- 'kiosko' | 'whatsapp'
  status         TEXT NOT NULL DEFAULT 'pending',    -- pending|accepted|cooking|ready|sent|closed|cancelled
  customer_phone TEXT REFERENCES customers(phone),
  customer_name  TEXT,
  delivery_type  TEXT,                               -- 'mesa' | 'para_llevar' | 'domicilio'
  mesa           TEXT,
  address        TEXT,
  payment_method TEXT,
  subtotal_cop   INTEGER NOT NULL DEFAULT 0,
  total_cop      INTEGER NOT NULL DEFAULT 0,
  notes          TEXT,
  ticket_text    TEXT,                               -- ticket pre-renderizado (pedidos de WhatsApp con resumen de texto libre)
  wa_message_id  TEXT,                               -- id del mensaje enviado a cocina (para resolver respuestas citadas)
  printed_at     TEXT,                               -- NULL hasta que se imprime
  created_at     TEXT DEFAULT (datetime('now','-5 hours'))
);

CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

CREATE TABLE IF NOT EXISTS order_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id       INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id     INTEGER REFERENCES products(id),    -- puede quedar NULL si el producto se borra
  name_snapshot  TEXT NOT NULL,                      -- nombre congelado al momento de la venta
  unit_price_cop INTEGER NOT NULL,
  qty            INTEGER NOT NULL,
  notes          TEXT
);

CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);

CREATE TABLE IF NOT EXISTS order_item_modifiers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  name_snapshot TEXT NOT NULL,
  price_cop     INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_order_item_mods_item ON order_item_modifiers(order_item_id);

-- Auditoría de cambios de estado (alimenta las notificaciones al cliente)
CREATE TABLE IF NOT EXISTS order_status_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status     TEXT NOT NULL,
  changed_at TEXT DEFAULT (datetime('now','-5 hours'))
);

CREATE INDEX IF NOT EXISTS idx_status_history_order ON order_status_history(order_id);

-- Contador de tickets por día y prefijo (K-2026-05-31, W-2026-05-31)
CREATE TABLE IF NOT EXISTS ticket_counter (
  bucket   TEXT PRIMARY KEY,
  last_num INTEGER NOT NULL DEFAULT 0
);
