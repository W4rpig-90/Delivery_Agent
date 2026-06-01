/**
 * auth.routes.js — login / logout / sesión actual / cambio de contraseña.
 * Se monta bajo /api/admin.
 */

const express = require("express");
const { getUserByUsername, updatePassword } = require("../repositories/users.repo");
const { hashPassword, verifyPassword } = require("../utils/password");
const {
  createSessionToken, setSessionCookie, clearSessionCookie, requireAuth
} = require("../middleware/auth");

const router = express.Router();

router.post("/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "usuario y contraseña requeridos" });

  const user = getUserByUsername(String(username));
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: "credenciales inválidas" });
  }

  setSessionCookie(res, createSessionToken(user));
  res.json({ ok: true, username: user.username, role: user.role });
});

router.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ username: req.user.username, role: req.user.role });
});

router.post("/change-password", requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 6) {
    return res.status(400).json({ error: "la nueva contraseña debe tener al menos 6 caracteres" });
  }
  const user = getUserByUsername(req.user.username);
  if (!user || !verifyPassword(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: "contraseña actual incorrecta" });
  }
  updatePassword(user.id, hashPassword(newPassword));
  res.json({ ok: true });
});

module.exports = router;
