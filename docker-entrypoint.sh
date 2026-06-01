#!/bin/sh
# Migra/siembra la base de datos y arranca la app. Idempotente: seguro en cada reinicio.
set -e

echo "[entrypoint] Migrando base de datos..."
node src/db/migrate.js

echo "[entrypoint] Iniciando Donatto..."
# Si compose pasa un comando (p. ej. dev con --watch), úsalo; si no, arranca normal.
if [ "$#" -gt 0 ]; then
  exec "$@"
else
  exec node index.js
fi
