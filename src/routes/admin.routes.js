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
const QRCode = require("qrcode");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { updateStatus } = require("../services/orderService");
const products = require("../repositories/products.repo");
const settings = require("../repositories/settings.repo");
const ordersRepo = require("../repositories/orders.repo");
const { upload, processAndSave, removeByPublicPath } = require("../services/uploadService");
const waState = require("../services/whatsappState");

const router = express.Router();
router.use(requireAuth);

// Settings: whitelist de claves editables y cuáles van como JSON
const EDITABLE_SETTINGS = new Set(["brand_name", "kitchen_number", "currency", "locale", "timezone", "dispatch_number", "business_hours"]);
const JSON_SETTINGS = new Set(["business_hours"]);

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

router.post("/categories", requireAdmin, (req, res) => {
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

router.put("/categories/:id", requireAdmin, (req, res) => {
  const { name, emoji, sort_order, enabled } = req.body || {};
  if (!name) return res.status(400).json({ error: "nombre requerido" });
  products.updateCategory(Number(req.params.id), { name, emoji, sort_order, enabled: enabled !== false });
  res.json({ ok: true });
});

router.delete("/categories/:id", requireAdmin, (req, res) => {
  products.deleteCategory(Number(req.params.id));
  res.json({ ok: true });
});

// ─────────────── Productos ───────────────

router.get("/products", (_req, res) => res.json(products.listAllProducts()));

router.post("/products", requireAdmin, (req, res) => {
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

router.put("/products/:id", requireAdmin, (req, res) => {
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

router.delete("/products/:id", requireAdmin, (req, res) => {
  const existing = products.getProductById(Number(req.params.id));
  products.deleteProduct(Number(req.params.id));
  if (existing && existing.image) removeByPublicPath(existing.image);
  res.json({ ok: true });
});

router.post("/products/:id/image", requireAdmin, uploadSingle("image"), async (req, res) => {
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

router.get("/settings", (_req, res) => {
  const s = settings.getAllSettings();
  for (const key of JSON_SETTINGS) {
    if (s[key]) try { s[key] = JSON.parse(s[key]); } catch { delete s[key]; }
  }
  res.json(s);
});

router.put("/settings", requireAdmin, (req, res) => {
  const body = req.body || {};
  const applied = {};
  for (const [k, v] of Object.entries(body)) {
    if (!EDITABLE_SETTINGS.has(k)) continue;
    const val = JSON_SETTINGS.has(k) ? JSON.stringify(v) : String(v);
    settings.setSetting(k, val);
    applied[k] = v;
  }
  res.json({ ok: true, applied });
});

// ─────────────── Métodos de pago ───────────────

router.get("/payments", (_req, res) => res.json(settings.listPaymentMethods()));

router.put("/payments/:id", requireAdmin, (req, res) => {
  const { label, enabled } = req.body || {};
  const pm = settings.getPaymentMethodById(Number(req.params.id));
  if (!pm) return res.status(404).json({ error: "método de pago inexistente" });
  settings.updatePaymentMethod(pm.id, { label: label || pm.label, enabled: enabled !== false });
  res.json({ ok: true });
});

router.post("/payments/:id/qr", requireAdmin, uploadSingle("qr"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "archivo 'qr' requerido" });
  const pm = settings.getPaymentMethodById(Number(req.params.id));
  if (!pm) return res.status(404).json({ error: "método de pago inexistente" });

  const publicPath = await processAndSave(req.file.buffer, "qr");
  if (pm.qr_image) removeByPublicPath(pm.qr_image);
  settings.setPaymentQr(pm.id, publicPath);
  res.json({ ok: true, qr_image: publicPath });
});

// ─────────────── Pedidos (dashboard) ───────────────

router.get("/orders/counts", (_req, res) => {
  res.json(ordersRepo.getOrderCountsByStatus());
});

router.get("/orders/active", (_req, res) => {
  res.json(ordersRepo.getActiveOrdersSummary());
});

router.put("/orders/:id/status", async (req, res) => {
  const { status } = req.body || {};
  if (!status) return res.status(400).json({ error: "status requerido" });
  try {
    const order = await updateStatus(Number(req.params.id), status);
    res.json({ ok: true, id: order.id, status: order.status });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/orders/export", (req, res) => {
  const period = req.query.period === "month" ? "month" : "day";
  const orders = ordersRepo.getOrdersForExport(period);

  const header = ["Ticket", "Fecha", "Canal", "Cliente", "Telefono", "Direccion", "Pago", "Total COP", "Estado"].join(",");
  const rows = orders.map(o => [
    o.ticket_number,
    `"${(o.created_at || "").replace(/"/g, '""')}"`,
    o.source,
    `"${(o.customer_name || "").replace(/"/g, '""')}"`,
    o.customer_phone || "",
    `"${(o.address || "").replace(/"/g, '""')}"`,
    o.payment_method || "",
    o.total_cop,
    o.status,
  ].join(","));

  const csv = [header, ...rows].join("\r\n");
  const date = new Date().toISOString().slice(0, 10);
  const label = period === "month" ? "mes" : "hoy";

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="ventas-${label}-${date}.csv"`);
  res.send("﻿" + csv); // BOM para que Excel lo abra correctamente
});

// ─────────────── WhatsApp ───────────────

router.get("/whatsapp/status", async (_req, res) => {
  const state = waState.getState();
  let qr_data_url = null;
  if (state.qr) {
    try { qr_data_url = await QRCode.toDataURL(state.qr, { margin: 2, scale: 6 }); } catch {}
  }
  res.json({ status: state.status, qr_data_url });
});

router.get("/whatsapp/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  async function send(state) {
    let qr_data_url = null;
    if (state.qr) {
      try { qr_data_url = await QRCode.toDataURL(state.qr, { margin: 2, scale: 6 }); } catch {}
    }
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ status: state.status, qr_data_url })}\n\n`);
    }
  }

  send(waState.getState());
  const unsub = waState.onChange(send);
  req.on("close", unsub);
});

module.exports = router;
