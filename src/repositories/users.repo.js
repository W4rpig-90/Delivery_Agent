/**
 * users.repo.js — usuarios del panel admin.
 */

const { getDB } = require("../db/connection");

function getUserByUsername(username) {
  return getDB().prepare("SELECT id, username, password_hash, role FROM users WHERE username = ?").get(username);
}

function updatePassword(id, passwordHash) {
  getDB().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
}

module.exports = { getUserByUsername, updatePassword };
