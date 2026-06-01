/**
 * migrate.js
 *
 * Migración + seed idempotente de la base de datos V4.
 * Ejecutar con:  npm run db:migrate   (o:  node src/db/migrate.js)
 *
 * Pasos:
 *   1. Aplica src/db/schema.sql (CREATE TABLE IF NOT EXISTS).
 *   2. Importa data/menu.json a categories/products (upsert por slug/sku).
 *   3. Siembra settings, payment_methods y un usuario admin inicial (si faltan).
 *
 * Es seguro correrlo muchas veces: no duplica ni pisa ediciones del panel admin
 * (salvo el menú, que se re-sincroniza desde el JSON por slug/sku).
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

const { getDB, DB_PATH } = require("./connection");
const { hashPassword } = require("../utils/password");

const SCHEMA_PATH = path.resolve(__dirname, "schema.sql");
const MENU_PATH = process.env.SEED_MENU_PATH || path.resolve(__dirname, "..", "..", "data", "menu.json");

// ─────────────── 1. Esquema ───────────────
function applySchema(db) {
  const sql = fs.readFileSync(SCHEMA_PATH, "utf-8");
  db.exec(sql);
  // Migración de columnas para DBs ya creadas (CREATE TABLE IF NOT EXISTS no las agrega)
  addColumnIfMissing(db, "orders", "ticket_text", "TEXT");
  console.log("[migrate] Esquema aplicado ✓");
}

function addColumnIfMissing(db, table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
    console.log(`[migrate] + columna ${table}.${column}`);
  }
}

// ─────────────── 2. Seed del menú ───────────────
function seedMenu(db) {
  if (!fs.existsSync(MENU_PATH)) {
    console.warn(`[migrate] menu.json no encontrado en ${MENU_PATH} — se omite seed de menú.`);
    return { cats: 0, prods: 0 };
  }

  const menu = JSON.parse(fs.readFileSync(MENU_PATH, "utf-8"));
  const categorias = menu.categorias || [];

  const upsertCategory = db.prepare(`
    INSERT INTO categories (slug, name, emoji, sort_order)
    VALUES (@slug, @name, @emoji, @sort_order)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      emoji = excluded.emoji,
      sort_order = excluded.sort_order
  `);
  const getCategoryId = db.prepare("SELECT id FROM categories WHERE slug = ?");

  // Upsert por sku cuando existe; si no, por (category_id, name) para no duplicar.
  const upsertProductBySku = db.prepare(`
    INSERT INTO products (category_id, sku, name, description, price_cop, sort_order)
    VALUES (@category_id, @sku, @name, @description, @price_cop, @sort_order)
    ON CONFLICT(sku) DO UPDATE SET
      category_id = excluded.category_id,
      name = excluded.name,
      description = excluded.description,
      price_cop = excluded.price_cop,
      sort_order = excluded.sort_order
  `);
  const findProductByName = db.prepare("SELECT id FROM products WHERE category_id = ? AND name = ?");
  const insertProductNoSku = db.prepare(`
    INSERT INTO products (category_id, name, description, price_cop, sort_order)
    VALUES (@category_id, @name, @description, @price_cop, @sort_order)
  `);
  const updateProductNoSku = db.prepare(`
    UPDATE products SET description = @description, price_cop = @price_cop, sort_order = @sort_order
    WHERE id = @id
  `);

  let cats = 0, prods = 0;

  const run = db.transaction(() => {
    categorias.forEach((cat, ci) => {
      const slug = cat.id || String(cat.nombre || `cat_${ci}`).toLowerCase().replace(/\s+/g, "_");
      upsertCategory.run({ slug, name: cat.nombre || slug, emoji: cat.emoji || null, sort_order: ci });
      const categoryId = getCategoryId.get(slug).id;
      cats++;

      (cat.items || []).forEach((item, ii) => {
        if (typeof item.precio !== "number") return; // se ignoran ítems sin precio simple
        const row = {
          category_id: categoryId,
          sku: item.id || null,
          name: item.nombre,
          description: item.descripcion || null,
          price_cop: Math.round(item.precio),
          sort_order: ii
        };
        if (row.sku) {
          upsertProductBySku.run(row);
        } else {
          const existing = findProductByName.get(categoryId, row.name);
          if (existing) updateProductNoSku.run({ ...row, id: existing.id });
          else insertProductNoSku.run(row);
        }
        prods++;
      });
    });
  });
  run();

  console.log(`[migrate] Menú sincronizado ✓  (${cats} categorías, ${prods} productos)`);
  return { cats, prods };
}

// ─────────────── 3. Seed de configuración ───────────────
function seedSettings(db) {
  const brand = process.env.BRAND_NAME || "Donatto Resto-Bar";
  const defaults = {
    brand_name: brand,
    currency: "COP",
    timezone: "America/Bogota",
    kitchen_number: process.env.DISPATCH_NUMBER || "",
    locale: "es-CO"
  };
  const stmt = db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)");
  for (const [k, v] of Object.entries(defaults)) stmt.run(k, v);
  console.log("[migrate] Settings base sembrados ✓");
}

function seedPaymentMethods(db) {
  const methods = [
    { code: "efectivo",  label: "Efectivo",  type: "cash",      enabled: 1, sort_order: 0 },
    { code: "nequi",     label: "Nequi",     type: "qr_static", enabled: 0, sort_order: 1 },
    { code: "daviplata", label: "Daviplata", type: "qr_static", enabled: 0, sort_order: 2 }
  ];
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO payment_methods (code, label, type, enabled, sort_order)
    VALUES (@code, @label, @type, @enabled, @sort_order)
  `);
  for (const m of methods) stmt.run(m);
  console.log("[migrate] Métodos de pago sembrados ✓  (QR deshabilitados hasta cargar imagen)");
}

function seedAdminUser(db) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM users").get().n;
  if (count > 0) {
    console.log("[migrate] Usuarios ya existen — no se crea admin.");
    return;
  }
  const username = process.env.ADMIN_USERNAME || "admin";
  const password = process.env.ADMIN_INITIAL_PASSWORD || "donatto2026";
  db.prepare("INSERT INTO users (username, password_hash, role) VALUES (?, ?, 'admin')")
    .run(username, hashPassword(password));
  console.log(`[migrate] Usuario admin creado ✓  (usuario: ${username} — CAMBIA la contraseña tras el primer login)`);
}

// ─────────────── Orquestación ───────────────
function migrate() {
  const db = getDB();
  console.log(`[migrate] DB: ${DB_PATH}`);
  applySchema(db);
  seedMenu(db);
  seedSettings(db);
  seedPaymentMethods(db);
  seedAdminUser(db);

  const counts = {
    categorias: db.prepare("SELECT COUNT(*) n FROM categories").get().n,
    productos: db.prepare("SELECT COUNT(*) n FROM products").get().n,
    pagos: db.prepare("SELECT COUNT(*) n FROM payment_methods").get().n,
    usuarios: db.prepare("SELECT COUNT(*) n FROM users").get().n
  };
  console.log("[migrate] Resumen:", counts);
  console.log("[migrate] Listo ✓");
}

if (require.main === module) {
  try {
    migrate();
    process.exit(0);
  } catch (err) {
    console.error("[migrate] ERROR:", err);
    process.exit(1);
  }
}

module.exports = { migrate, seedMenu };
