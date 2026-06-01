/**
 * app.js — servidor HTTP unificado (kiosko + panel admin + estáticos + uploads).
 * Un solo proceso Express, un solo puerto. Reemplaza a services/kioskServer.js.
 */

const express = require("express");
const path = require("path");

const kioskRoutes = require("./routes/kiosk.routes");
const authRoutes = require("./routes/auth.routes");
const adminRoutes = require("./routes/admin.routes");
const kdsRoutes = require("./routes/kds.routes");
const wsHub = require("./ws/hub");
const { UPLOADS_DIR } = require("./services/uploadService");

const PORT = parseInt(process.env.KIOSK_PORT || process.env.PORT || "3000", 10);
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

function buildApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // Estáticos
  app.use("/kiosko", express.static(path.join(PUBLIC_DIR, "kiosko")));
  app.use("/admin", express.static(path.join(PUBLIC_DIR, "admin")));
  app.use("/kds", express.static(path.join(PUBLIC_DIR, "kds")));
  app.use("/uploads", express.static(UPLOADS_DIR));

  // API
  app.use("/api", kioskRoutes);        // /api/menu, /api/orders
  app.use("/api/admin", authRoutes);   // /login, /logout, /me, /change-password (público)
  app.use("/api/admin", adminRoutes);  // CRUD (requireAuth)
  app.use("/api/kds", kdsRoutes);      // tablero de cocina (requireAuth)

  app.get("/", (_req, res) => res.redirect("/kiosko"));
  app.get("/health", (_req, res) =>
    res.json({ ok: true, brand: process.env.BRAND_NAME || "Donatto Resto-Bar" })
  );

  // Manejador de errores final (uploads, etc.)
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    console.error("[APP] Error:", err.message);
    res.status(err.status || 500).json({ error: err.message || "error interno" });
  });

  return app;
}

function start() {
  const app = buildApp();
  const server = app.listen(PORT, () => {
    console.log(`[APP] Kiosko:  http://localhost:${PORT}/kiosko`);
    console.log(`[APP] Admin:   http://localhost:${PORT}/admin`);
    console.log(`[APP] Cocina:  http://localhost:${PORT}/kds`);
  });
  wsHub.attach(server);   // WebSocket de KDS en /ws (mismo puerto)
  return server;
}

module.exports = { buildApp, start };
