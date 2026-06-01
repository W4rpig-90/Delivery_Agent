/**
 * connection.js
 *
 * Conexión única (singleton) a la base de datos SQLite del sistema V4.
 * - Modo WAL: muchas lecturas concurrentes + escrituras rápidas (kiosko, WhatsApp, KDS).
 * - foreign_keys ON: SQLite NO las aplica por defecto; hay que activarlas por conexión.
 *
 * Ubicación de la DB: DB_PATH (env) o ./data/donattos.db por defecto.
 */

const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, "..", "..", "data", "donattos.db");

let db;

function getDB() {
  if (db) return db;

  // Asegura que el directorio exista (p. ej. ./data en un VPS/contenedor recién creado)
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  return db;
}

module.exports = { getDB, DB_PATH };
