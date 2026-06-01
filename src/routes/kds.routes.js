/**
 * kds.routes.js — API de la pantalla de cocina (KDS). Se monta bajo /api/kds
 * y requiere sesión (la misma del panel admin).
 *   GET  /api/kds/orders            → pedidos activos con líneas
 *   POST /api/kds/orders/:id/status → cambia el estado (dispara impresión/notificación)
 */

const express = require("express");
const { requireAuth } = require("../middleware/auth");
const { getActiveOrdersDetailed } = require("../repositories/orders.repo");
const { updateStatus, VALID_STATUSES } = require("../services/orderService");

const router = express.Router();
router.use(requireAuth);

router.get("/orders", (_req, res) => {
  res.json(getActiveOrdersDetailed());
});

router.post("/orders/:id/status", async (req, res) => {
  const { status } = req.body || {};
  if (!VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: "estado inválido" });
  }
  try {
    const order = await updateStatus(Number(req.params.id), status);
    res.json({ ok: true, status: order.status });
  } catch (err) {
    console.error("[KDS] Error cambiando estado:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
