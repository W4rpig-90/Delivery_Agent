# ════════════════════════════════════════════════════════════════════
#  Donatto Resto-Bar — imagen del backend unificado (kiosko + admin + WhatsApp)
#  Base Debian slim (glibc) para que los binarios prebuilt de
#  better-sqlite3 y sharp instalen sin compilar. Incluye Chromium del
#  sistema para whatsapp-web.js (evita que puppeteer descargue el suyo).
# ════════════════════════════════════════════════════════════════════
FROM node:20-bookworm-slim

ENV NODE_ENV=production \
    TZ=America/Bogota \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Chromium + fuentes + tzdata (deps de puppeteer las arrastra el paquete chromium)
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      fonts-liberation \
      ca-certificates \
      tzdata \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Capa de dependencias (se cachea mientras package*.json no cambie)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Código de la aplicación
COPY . .

RUN chmod +x docker-entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
