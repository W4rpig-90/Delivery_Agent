/**
 * admin.routes.js — CRUD del panel de administración. Se monta bajo /api/admin
 * y TODO requiere sesión (requireAuth aplicado a nivel de router).
 *
 *   Categorías:  GET/POST /categories, PUT/DELETE /categories/:id
 *   Productos:   GET/POST /products,   PUT/DELETE /products/:id, POST /products/:id/image
 *   Settings:    GET/PUT  /settings
 *   Pagos:       GET /payments, PUT /payments/:id, POST /payments/:id/qr
 */

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const products = require("../repositories/products.repo");
const settings = require("../repositories/settings.repo");
const { upload, processAndSave, removeByPublicPath } = require("../services/uploadService");

const router = express.Router();
router.use(requireAuth);

// Whitelist de settings editables desde el panel
const EDITABLE_SETTINGS = new Set(["brand_name", "kitchen_number", "currency", "locale", "timezone"]);

function slugify(text) {
  return String(text).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "cat";
}

function toIntPrice(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

// multer con manejo de error amable (tamaño/tipo)
function uploadSingle(field) {
  const mw = upload.single(field);
  return (req, res, next) => mw(req, res, err => (err ? res.status(400).json({ error: err.message }) : next()));
}

// ─────────────── Categorías ───────────────

router.get("/categories", (_req, res) => res.json(products.listAllCategories()));

router.post("/categories", (req, res) => {
  const { name, emoji, sort_order, enabled } = req.body || {};
  if (!name) return res.status(400).json({ error: "nombre requerido" });
  try {
    const slug = slugify(req.body.slug || name);
    const id = products.createCategory({ slug, name, emoji, sort_order: sort_order ?? 0, enabled: enabled !== false });
    res.json({ ok: true, id, slug });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) return res.status(400).json({ error: "ya existe una categoría con ese slug" });
    throw err;
  }
});

router.put("/categories/:id", (req, res) => {
  const { name, emoji, sort_order, enabled } = req.body || {};
  if (!name) return res.status(400).json({ error: "nombre requerido" });
  products.updateCategory(Number(req.params.id), { name, emoji, sort_order, enabled: enabled !== false });
  res.json({ ok: true });
});

router.delete("/categories/:id", (req, res) => {
  products.deleteCategory(Number(req.params.id));
  res.json({ ok: true });
});

// ─────────────── Productos ───────────────

router.get("/products", (_req, res) => res.json(products.listAllProducts()));

router.post("/products", (req, res) => {
  const { category_id, name, description, available, sort_order } = req.body || {};
  const price_cop = toIntPrice(req.body.price_cop);
  if (!name) return res.status(400).json({ error: "nombre requerido" });
  if (price_cop === null) return res.status(400).json({ error: "precio inválido" });
  if (!products.categoryExists(Number(category_id))) return res.status(400).json({ error: "categoría inexistente" });

  const id = products.createProduct({
    category_id: Number(category_id), name, description: description || null,
    price_cop, available: available !== false, sort_order: sort_order ?? 0
  });
  res.json({ ok: true, id });
});

router.put("/products/:id", (req, res) => {
  const { category_id, name, description, available, sort_order } = req.body || {};
  const price_cop = toIntPrice(req.body.price_cop);
  if (!name) return res.status(400).json({ error: "nombre requerido" });
  if (price_cop === null) return res.status(400).json({ error: "precio inválido" });
  if (!products.categoryExists(Number(category_id))) return res.status(400).json({ error: "categoría inexistente" });

  products.updateProduct(Number(req.params.id), {
    category_id: Number(category_id), name, description: description || null,
    price_cop, available: available !== false, sort_order
  });
  res.json({ ok: true });
});

router.delete("/products/:id", (req, res) => {
  const existing = products.getProductById(Number(req.params.id));
  products.deleteProduct(Number(req.params.id));
  if (existing && existing.image) removeByPublicPath(existing.image);
  res.json({ ok: true });
});

router.post("/products/:id/image", uploadSingle("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "archivo 'image' requerido" });
  const id = Number(req.params.id);
  const current = products.listAllProducts().find(p => p.id === id);
  if (!current) return res.status(404).json({ error: "producto inexistente" });

  const publicPath = await processAndSave(req.file.buffer, "products");
  if (current.image) removeByPublicPath(current.image);
  products.setProductImage(id, publicPath);
  res.json({ ok: true, image: publicPath });
});

// ─────────────── Settings ───────────────

router.get("/settings", (_req, res) => res.json(settings.getAllSettings()));

router.put("/settings", (req, res) => {
  const body = req.body || {};
  const applied = {};
  for (const [k, v] of Object.entries(body)) {
    if (EDITABLE_SETTINGS.has(k)) { settings.setSetting(k, String(v)); applied[k] = String(v); }
  }
  res.json({ ok: true, applied });
});

// ─────────────── Métodos de pago ───────────────

router.get("/payments", (_req, res) => res.json(settings.listPaymentMethods()));

router.put("/payments/:id", (req, res) => {
  const { label, enabled } = req.body || {};
  const pm = settings.getPaymentMethodById(Number(req.params.id));
  if (!pm) return res.status(404).json({ error: "método de pago inexistente" });
  settings.updatePaymentMethod(pm.id, { label: label || pm.label, enabled: enabled !== false });
  res.json({ ok: true });
});

router.post("/payments/:id/qr", uploadSingle("qr"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "archivo 'qr' requerido" });
  const pm = settings.getPaymentMethodById(Number(req.params.id));
  if (!pm) return res.status(404).json({ error: "método de pago inexistente" });

  const publicPath = await processAndSave(req.file.buffer, "qr");
  if (pm.qr_image) removeByPublicPath(pm.qr_image);
  settings.setPaymentQr(pm.id, publicPath);
  res.json({ ok: true, qr_image: publicPath });
});

module.exports = router;
