# Manual de instalación — Delivery_Agent

Sistema de pedidos self-hosted: **kiosko de autoservicio + panel admin + pantalla
de cocina (KDS) + bot de WhatsApp + impresión térmica ESC/POS**. Backend unificado
en Node.js con SQLite, pensado para correr en un mini-PC o una VM en el local.

---

## ⚠️ Dónde correrlo (importante)

El sistema imprime enviando datos por **TCP directo a la impresora** (`PRINTER_IP:9100`)
en la red local. Por eso la máquina debe estar **en la misma LAN que la impresora**.

| Dónde | ¿Sirve? | Notas |
|---|---|---|
| Mini-PC bare-metal en el local | ✅ Mejor | Sin virtualización |
| **VM en un equipo del local** (Proxmox, VirtualBox, VMware, Hyper-V, UTM) | ✅ Sí | Usar **red en modo puente (bridged)**, NO NAT, para que tenga IP de la LAN |
| VPS en la nube | ⚠️ Parcial | Kiosko/admin/WhatsApp funcionan, pero **no imprime** en la impresora del local (NAT) |

### Especificaciones de la VM
- **SO:** Ubuntu Server 24.04 LTS (Debian-based)
- **CPU:** 2 vCPU · **RAM:** 4 GB mínimo (WhatsApp usa Chromium ~450 MB), 8 GB cómodo
- **Disco:** 20 GB sobre SSD
- **Red:** modo **puente (bridged)** + IP fija (reserva DHCP en el router)

---

## Instalación rápida (script)

```bash
git clone https://github.com/W4rpig-90/Delivery_Agent.git
cd Delivery_Agent
./setup.sh
```
El script instala Docker (si falta), genera el `.env` (te pregunta lo esencial y
crea el `SESSION_SECRET`), y levanta todo. Salta a [Después de instalar](#después-de-instalar).

---

## Opción A — Docker (manual)

### 1. Docker en la VM
```bash
sudo apt update && sudo apt upgrade -y
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER        # cerrar y reabrir sesión tras esto
```

### 2. Clonar
```bash
git clone https://github.com/W4rpig-90/Delivery_Agent.git
cd Delivery_Agent
```

### 3. Configurar `.env`
```bash
cp .env.example .env
nano .env
```
```ini
BRAND_NAME=Donatto Resto-Bar
KIOSK_ENABLED=true
KIOSK_PORT=3000

WHATSAPP_LOCAL_ENABLED=true
WHATSAPP_CONNECTOR=web
GEMINI_API_KEY=tu_api_key_de_gemini
DISPATCH_NUMBER=573104859728         # WhatsApp de la cocina (código país, sin +)

PRINTER_IP=192.168.1.50              # IP de la impresora térmica
PRINTER_PORT=9100

SESSION_SECRET=                      # genera uno (abajo)
ADMIN_USERNAME=admin
ADMIN_INITIAL_PASSWORD=una_clave_fuerte
```
Generar el secreto de sesión:
```bash
openssl rand -hex 32
# o:  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 4. Arrancar
```bash
docker compose up -d --build
```
Migra y siembra la base de datos sola. `restart: unless-stopped` → arranca solo
tras cortes de luz.

### 5. Vincular WhatsApp (1ª vez)
```bash
docker compose logs -f
```
Escanea el **QR** con el WhatsApp del negocio. La sesión queda en `./.wwebjs_auth`.

---

## Opción B — Nativa (sin Docker)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install -y nodejs chromium-browser

git clone https://github.com/W4rpig-90/Delivery_Agent.git && cd Delivery_Agent
npm ci
cp .env.example .env && nano .env
echo "PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser" >> .env

npm run db:migrate
npm start
```
Para que sobreviva reinicios:
```bash
sudo npm i -g pm2
pm2 start index.js --name donatto
pm2 save && pm2 startup     # seguir las instrucciones que imprime
```

---

## Después de instalar

### Accesos (desde cualquier dispositivo en la LAN)
Reemplaza `<IP-VM>` por la IP de la máquina:

| Interfaz | URL |
|---|---|
| 🍽️ Kiosko (tablet) | `http://<IP-VM>:3000/kiosko` |
| 🎛️ Admin | `http://<IP-VM>:3000/admin` |
| 👨‍🍳 Cocina (KDS) | `http://<IP-VM>:3000/kds` |

### Primeros pasos
1. Entra a `/admin` (`admin` / tu clave) y **cambia la contraseña**.
2. En **Pagos**: sube el QR (Nequi/Daviplata) y habilítalos.
3. En **Productos/Categorías**: ajusta el menú y sube imágenes.

### Cocina por WhatsApp
La cocina recibe cada pedido y responde **citando el mensaje** con:
`aceptado` · `cocinando` · `enviado` (o `aceptado W-001`).
Al **aceptar** se imprime el ticket y el cliente recibe el aviso.

> Regla de impresión: el **kiosko** imprime al confirmar; **WhatsApp** imprime
> solo cuando la cocina lo **acepta**.

---

## Operación y mantenimiento (Docker)

```bash
docker compose ps              # estado + healthcheck
docker compose logs -f         # logs en vivo
docker compose restart         # reiniciar
git pull && docker compose up -d --build   # actualizar
```

### Respaldo
Todo lo crítico vive en:
- `./data` → base de datos SQLite + imágenes subidas
- `./.wwebjs_auth` → sesión de WhatsApp

Cópialos periódicamente (p. ej. `tar czf backup.tgz data .wwebjs_auth`).

---

## Variables de entorno (referencia)

| Variable | Descripción |
|---|---|
| `BRAND_NAME` | Nombre del negocio (tickets, títulos) |
| `KIOSK_ENABLED` | `true` para servir kiosko/admin/KDS |
| `KIOSK_PORT` | Puerto HTTP (default 3000) |
| `WHATSAPP_LOCAL_ENABLED` | `true` para activar el bot |
| `WHATSAPP_CONNECTOR` | `web` (whatsapp-web.js, QR) |
| `GEMINI_API_KEY` | API key de Google Gemini |
| `DISPATCH_NUMBER` | WhatsApp de la cocina (código país, sin `+`) |
| `PRINTER_IP` / `PRINTER_PORT` | Impresora ESC/POS en la LAN (9100) |
| `SESSION_SECRET` | Secreto para firmar sesiones del admin |
| `ADMIN_USERNAME` / `ADMIN_INITIAL_PASSWORD` | Admin inicial (cámbialo tras entrar) |
| `DB_PATH` | Ruta de la base SQLite (default `./data/donattos.db`) |
