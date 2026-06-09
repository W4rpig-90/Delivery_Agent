/**
 * users.repo.js — usuarios del panel admin.
 */

const { getDB } = require("../db/connection");

function getUserByUsername(username) {
  return getDB().prepare("SELECT id, username, password_hash, role FROM users WHERE username = ?").get(username);
}

function listUsers() {
  return getDB().prepare("SELECT id, username, role FROM users ORDER BY id").all();
}

function userExists(username) {
  return !!getDB().prepare("SELECT 1 FROM users WHERE username = ?").get(username);
}

function createUser({ username, passwordHash, role }) {
  return getDB().prepare(
    "INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)"
  ).run(username, passwordHash, role || "operator").lastInsertRowid;
}

function updatePassword(id, passwordHash) {
  getDB().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
}

function setUserRole(id, role) {
  getDB().prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
}

function deleteUser(id) {
  getDB().prepare("DELETE FROM users WHERE id = ?").run(id);
}

module.exports = { getUserByUsername, listUsers, userExists, createUser, updatePassword, setUserRole, deleteUser };
