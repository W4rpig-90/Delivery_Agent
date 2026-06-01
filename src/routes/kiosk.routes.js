/**
 * kiosk.routes.js — API pública del kiosko. Se monta bajo /api.
 *   GET  /api/menu     → menú desde la DB
 *   POST /api/orders   → crea pedido de kiosko (auto-aceptado → imprime)
 */

const express = require("express");
const { buildMenuResponse, validateAndEnrichItems } = require("../services/menuService");
const { createKioskOrder } = require("../services/orderService");
const { getEnabledPayments } = require("../repositories/settings.repo");

const router = express.Router();
const fmt = n => "$" + Math.round(n).toLocaleString("es-CO");

function validateOrderMeta(body, enabledPayments) {
  const errors = [];
  if (!["mesa", "para_llevar"].includes(body.deliveryType)) errors.push("deliveryType inválido");
  if (body.deliveryType === "mesa" && !body.mesa) errors.push("mesa requerida cuando deliveryType=mesa");
  if (!enabledPayments.includes(body.paymentMethod)) errors.push(`método de pago no habilitado: ${body.paymentMethod}`);
  return errors;
}

router.get("/menu", (_req, res) => {
  try {
    res.json(buildMenuResponse());
  } catch (err) {
    console.error("[KIOSK] Error cargando menú:", err);
    res.status(500).json({ error: "no se pudo cargar el menú" });
  }
});

router.post("/orders", (req, res) => {
  const body = req.body || {};
  const enabledPayments = getEnabledPayments().map(p => p.code);

  const errors = validateOrderMeta(body, enabledPayments);
  const { items, errors: itemErrors } = validateAndEnrichItems(body.items);
  errors.push(...itemErrors);
  if (errors.length) return res.status(400).json({ errors });

  let result;
  try {
    result = createKioskOrder({
      items,
      customerName: (body.customerName || "").slice(0, 60) || null,
      deliveryType: body.deliveryType,
      mesa: body.deliveryType === "mesa" ? String(body.mesa).slice(0, 10) : null,
      paymentMethod: body.paymentMethod,
      notas: (body.notas || "").slice(0, 200) || null
    });
  } catch (err) {
    console.error("[KIOSK] Error guardando pedido:", err);
    return res.status(500).json({ errors: ["no se pudo guardar el pedido"] });
  }

  res.json({
    ok: true,
    ticketNumber: result.ticketNumber,
    total: fmt(result.subtotal),
    paymentMethod: body.paymentMethod,
    deliveryType: body.deliveryType,
    mesa: body.deliveryType === "mesa" ? String(body.mesa).slice(0, 10) : null,
    itemsCount: items.reduce((a, b) => a + b.qty, 0)
  });
});

module.exports = router;
