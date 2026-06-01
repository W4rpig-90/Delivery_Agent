# 🍕 Donattos WhatsApp Chatbot

Bot automatizado de pedidos gastronómicos para WhatsApp. Powered by **Gemini 2.5 Flash** + **whatsapp-web.js**.

## Arquitectura

```
index.js                  ← Punto de entrada, cliente WhatsApp
services/
  gemini.js               ← Integración con Gemini 1.5 Flash (IA + historial)
  sessionManager.js       ← Carrito y estado por usuario (TTL: 45 min)
  orderProcessor.js       ← Validación, ticket de despacho y log
data/
  menu.json               ← Menú completo (precios, categorías, promos)
pedidos.log               ← Log de pedidos confirmados (generado automáticamente)
.wwebjs_auth/             ← Sesión de WhatsApp persistida (generado automáticamente)
```

---

## Requisitos

- **Node.js 18+**
- **Google Gemini API Key** (gratuita): [aistudio.google.com](https://aistudio.google.com/app/apikey)
- **Chromium / Google Chrome** (para Puppeteer — incluido por `whatsapp-web.js`)
- Un número de WhatsApp activo para vincular al bot

---

## Instalación

```bash
# 1. Clonar / descomprimir el proyecto
cd chatbot-donattos

# 2. Instalar dependencias
npm install

# 3. Configurar variables de entorno
cp .env.example .env
# Editá .env con tu GEMINI_API_KEY y DISPATCH_NUMBER

# 4. Iniciar el bot
npm start
```

Al iniciar por primera vez, verás un código QR en la terminal. Escanealo desde **WhatsApp → Dispositivos vinculados → Vincular dispositivo**.

La sesión queda guardada en `.wwebjs_auth/` y no necesitarás escanear el QR nuevamente a menos que cierres sesión desde el teléfono.

---

## Variables de entorno (`.env`)

| Variable | Requerida | Descripción |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | API Key de Google AI Studio |
| `DISPATCH_NUMBER` | ⚠️ | Número al que llegan los tickets (formato: `5491112345678`) |
| `BOT_NAME` | No | Nombre del bot (default: `Donattos Bot`) |
| `ORDERS_LOG_PATH` | No | Ruta del log de pedidos (default: `./pedidos.log`) |

---

## Comandos disponibles para el cliente

| Mensaje del cliente | Acción |
|---|---|
| Cualquier texto | Conversación con el bot (IA) |
| `reiniciar` | Limpia la sesión y el carrito |
| `cancelar` | Ídem `reiniciar` |

---

## Flujo de un pedido

```
Cliente escribe → Gemini procesa con menú en contexto → Bot responde
                                                              ↓
                                             Cliente agrega ítems al pedido
                                                              ↓
                                          Bot muestra RESUMEN FINAL con total
                                                              ↓
                                              Cliente confirma ("SÍ")
                                                              ↓
                                        Bot solicita: nombre, dirección, pago
                                                              ↓
                                           Bot emite "PEDIDO CONFIRMADO"
                                                              ↓
                               index.js detecta señal → processOrder()
                                        ↙                        ↘
                              Ticket enviado a              Guardado en
                              DISPATCH_NUMBER               pedidos.log
```

---

## Actualizar el menú

Editá [data/menu.json](data/menu.json). Los cambios se aplican al **próximo reinicio** del bot (el menú se carga al iniciar).

Para deshabilitar un ítem sin borrarlo: `"disponible": false`.

---

## Deploy en producción (VPS / servidor)

### Con PM2 (recomendado)

```bash
npm install -g pm2
pm2 start index.js --name donattos-bot
pm2 save
pm2 startup   # Para que arranque automáticamente al reiniciar el servidor
```

### Con Docker

```dockerfile
FROM node:20-slim
RUN apt-get update && apt-get install -y chromium --no-install-recommends
WORKDIR /app
COPY . .
RUN npm ci --omit=dev
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
CMD ["node", "index.js"]
```

> **Nota**: `whatsapp-web.js` requiere un proceso persistente con Chromium. No es compatible con hosting serverless (Vercel, Lambda) sin configuración especial.

---

## Consideraciones de costo

| Componente | Costo |
|---|---|
| **Gemini 2.5 Flash** | Gratis (1,500 RPD). Por encima: Consultar Google AI Studio |
| **VPS mínima** (ej: DigitalOcean Basic) | ~$6 USD/mes (1 vCPU, 1GB RAM) |
| **whatsapp-web.js** | Gratuito (open source) |

**Optimizaciones de costo implementadas**:
- System prompt con el menú inyectado una sola vez (Gemini lo cachea internamente)
- Historial limitado a 40 turnos por sesión (evita tokens ilimitados)
- `temperature: 0.4` reduce reintentaciones por respuestas incorrectas
- Sesiones con TTL de 45 min (libera memoria de sesiones abandonadas)

---

## Preguntas abiertas (para configurar)

1. **Stock**: ¿El bot debe verificar disponibilidad en tiempo real? → Requiere integrar una DB o API de stock.
2. **Pagos**: ¿Integrar pasarela (Mercado Pago)? → Requiere generar links de pago vía API de MP.
3. **Notificación de despacho**: ¿Grupo de WhatsApp en lugar de número individual? → Cambiar `DISPATCH_NUMBER` por el ID del grupo.
