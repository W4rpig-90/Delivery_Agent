/**
 * password.js
 *
 * Hashing de contraseñas con scrypt (nativo de Node, sin dependencias).
 * Evita bcrypt (módulo nativo que hay que compilar). Formato almacenado:
 *   <salt_hex>:<derived_hex>
 */

const crypto = require("crypto");

const KEY_LEN = 64;

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.scryptSync(String(plain), salt, KEY_LEN).toString("hex");
  return `${salt}:${derived}`;
}

function verifyPassword(plain, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, derivedHex] = stored.split(":");
  const expected = Buffer.from(derivedHex, "hex");
  const actual = crypto.scryptSync(String(plain), salt, KEY_LEN);
  // timingSafeEqual exige buffers de igual longitud
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = { hashPassword, verifyPassword };
