/**
 * products.repo.js — acceso a categorías y productos del menú.
 */

const { getDB } = require("../db/connection");

function getMenuCategories() {
  return getDB().prepare(`
    SELECT id, slug, name, emoji
    FROM categories
    WHERE enabled = 1
    ORDER BY sort_order, name
  `).all();
}

function getAvailableProducts() {
  return getDB().prepare(`
    SELECT p.id, c.slug AS category, c.name AS categoryLabel,
           p.name, p.description, p.price_cop AS price, p.image
    FROM products p
    JOIN categories c ON c.id = p.category_id
    WHERE p.available = 1 AND c.enabled = 1
    ORDER BY c.sort_order, p.sort_order, p.name
  `).all();
}

/** Devuelve {id, name, price_cop, available} o undefined. Para validar pedidos. */
function getProductById(id) {
  return getDB().prepare(`
    SELECT id, name, price_cop, available
    FROM products WHERE id = ?
  `).get(id);
}

// ─────────────── ADMIN: categorías ───────────────

function listAllCategories() {
  return getDB().prepare(`
    SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
    FROM categories c ORDER BY c.sort_order, c.name
  `).all();
}

function createCategory({ slug, name, emoji = null, sort_order = 0, enabled = 1 }) {
  return getDB().prepare(`
    INSERT INTO categories (slug, name, emoji, sort_order, enabled)
    VALUES (?, ?, ?, ?, ?)
  `).run(slug, name, emoji, sort_order, enabled ? 1 : 0).lastInsertRowid;
}

function updateCategory(id, { name, emoji, sort_order, enabled }) {
  getDB().prepare(`
    UPDATE categories SET name = ?, emoji = ?, sort_order = ?, enabled = ?
    WHERE id = ?
  `).run(name, emoji ?? null, sort_order ?? 0, enabled ? 1 : 0, id);
}

function deleteCategory(id) {
  // ON DELETE CASCADE elimina sus productos
  getDB().prepare("DELETE FROM categories WHERE id = ?").run(id);
}

// ─────────────── ADMIN: productos ───────────────

function listAllProducts() {
  return getDB().prepare(`
    SELECT p.*, c.name AS category_name, c.slug AS category_slug
    FROM products p JOIN categories c ON c.id = p.category_id
    ORDER BY c.sort_order, p.sort_order, p.name
  `).all();
}

function createProduct({ category_id, name, description = null, price_cop, image = null, available = 1, sort_order = 0, sku = null }) {
  return getDB().prepare(`
    INSERT INTO products (category_id, sku, name, description, price_cop, image, available, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(category_id, sku, name, description, price_cop, image, available ? 1 : 0, sort_order).lastInsertRowid;
}

function updateProduct(id, { category_id, name, description, price_cop, available, sort_order }) {
  getDB().prepare(`
    UPDATE products SET category_id = ?, name = ?, description = ?, price_cop = ?, available = ?, sort_order = ?
    WHERE id = ?
  `).run(category_id, name, description ?? null, price_cop, available ? 1 : 0, sort_order ?? 0, id);
}

function deleteProduct(id) {
  getDB().prepare("DELETE FROM products WHERE id = ?").run(id);
}

function setProductImage(id, imagePath) {
  getDB().prepare("UPDATE products SET image = ? WHERE id = ?").run(imagePath, id);
}

function categoryExists(id) {
  return !!getDB().prepare("SELECT 1 FROM categories WHERE id = ?").get(id);
}

module.exports = {
  getMenuCategories,
  getAvailableProducts,
  getProductById,
  listAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listAllProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  setProductImage,
  categoryExists
};
