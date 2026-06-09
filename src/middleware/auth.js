/**
 * auth.js — sesión de admin sin dependencias.
 *
 * Estrategia: cookie firmada con HMAC-SHA256 (estilo JWT minimalista), sin store
 * en servidor. El token contiene username|role|exp y una firma. Se verifica en
 * cada request protegida. Ligero y suficiente para un panel de un solo local.
 *
 * IMPORTANTE: define SESSION_SECRET en .env para producción.
 */

const crypto = require("crypto");

const SECRET = process.env.SESSION_SECRET || "dev-insecure-secret-change-me";
const COOKIE_NAME = "donatto_session";
const MAX_AGE_MS = 1000 * 60 * 60 * 12; // 12 horas

if (SECRET === "dev-insecure-secret-change-me") {
  console.warn("[auth] ⚠ SESSION_SECRET no definido — usando secreto de desarrollo. Defínelo en .env para producción.");
}

function sign(payload) {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function createSessionToken(user) {
  const exp = Date.now() + MAX_AGE_MS;
  const payload = `${user.username}|${user.role}|${exp}`;
  const body = Buffer.from(payload).toString("base64url");
  return `${body}.${sign(payload)}`;
}

function verifySessionToken(token) {
  if (!token || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const payload = Buffer.from(body, "base64url").toString("utf-8");
  const expected = sign(payload);
  // Comparación en tiempo constante
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const [username, role, exp] = payload.split("|");
  if (!username || Date.now() > Number(exp)) return null;
  return { username, role };
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map(c => {
      const idx = c.indexOf("=");
      return [c.slice(0, idx).trim(), decodeURIComponent(c.slice(idx + 1))];
    })
  );
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? " Secure;" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(MAX_AGE_MS / 1000)}; SameSite=Lax;${secure}`
  );
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

/** Middleware: exige sesión válida; si no, 401. Adjunta req.user. */
function requireAuth(req, res, next) {
  const token = parseCookies(req)[COOKIE_NAME];
  const session = verifySessionToken(token);
  if (!session) return res.status(401).json({ error: "no autorizado" });
  req.user = session;
  next();
}

/** Middleware: exige rol 'admin'; si no, 403. Debe usarse después de requireAuth. */
function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") {
    return res.status(403).json({ error: "requiere permisos de administrador" });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  createSessionToken,
  verifySessionToken,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
  requireAdmin,
  parseCookies
};
