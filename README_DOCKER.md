# Despliegue con Docker (mini-PC del local)

Sistema unificado **kiosko + panel admin + bot de WhatsApp + impresión**, en un
solo contenedor. Pensado para un mini-PC en el restaurante (Intel N100 8 GB o
Raspberry Pi 4 4 GB+, SSD, Ethernet a la impresora).

## 1. Requisitos
- Docker + Docker Compose en el mini-PC (Linux recomendado).
- La impresora térmica ESC/POS accesible por TCP en la LAN (puerto 9100).

## 2. Configurar `.env`
Copia el ejemplo y edítalo:
```bash
cp .env.example .env
```
Valores clave para producción:
```ini
BRAND_NAME=Donatto Resto-Bar
KIOSK_ENABLED=true
KIOSK_PORT=3000

# WhatsApp (conector web = QR, sin Meta Business)
WHATSAPP_LOCAL_ENABLED=true
WHATSAPP_CONNECTOR=web
GEMINI_API_KEY=tu_api_key
DISPATCH_NUMBER=573104859728     # WhatsApp de la cocina

# Impresora en la LAN
PRINTER_IP=192.168.1.50
PRINTER_PORT=9100

# Seguridad del panel admin (¡genera uno propio!)
SESSION_SECRET=pega_aqui_un_hex_aleatorio
ADMIN_USERNAME=admin
ADMIN_INITIAL_PASSWORD=cambia_esto
```
Genera el `SESSION_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. Arrancar
```bash
docker compose up -d --build
```
- Migra y siembra la base de datos automáticamente (idempotente).
- `restart: unless-stopped` → arranca solo tras un corte de luz o reinicio.

## 4. Vincular WhatsApp (solo la primera vez)
Mira los logs para escanear el **código QR**:
```bash
docker compose logs -f
```
Escanéalo desde WhatsApp del negocio. La sesión queda guardada en el volumen
`.wwebjs_auth/`, así que no hay que re-escanear en cada reinicio.

## 5. Usar
- **Kiosko:**  `http://<ip-del-mini-pc>:3000/kiosko`
- **Admin:**   `http://<ip-del-mini-pc>:3000/admin`  (usuario/clave del `.env`)
- **Cocina:** recibe los pedidos por WhatsApp y responde **citando** el mensaje:
  `aceptado` · `cocinando` · `enviado` (o `aceptado W-001`).

## 6. Operación
```bash
docker compose ps           # estado + healthcheck
docker compose logs -f      # logs en vivo
docker compose restart      # reiniciar
docker compose down         # detener
docker compose up -d --build   # actualizar tras cambios de código
```

## Notas
- **Datos persistentes:** todo vive en `./data` (SQLite + imágenes subidas) y
  `./.wwebjs_auth` (sesión WhatsApp). Respáldalos.
- **Impresión:** el contenedor (red bridge) alcanza la impresora en la LAN por su
  IP. Asegúrate de que `PRINTER_IP` sea fija (reserva DHCP en el router).
- **RAM:** con WhatsApp activo (Chromium) cuenta ~600 MB–1 GB; mini-PC de 4 GB+.
- **Desarrollo:** en tu equipo normalmente corre nativo (`npm run kiosk:dev`).
  Para Docker en dev:
  `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`
