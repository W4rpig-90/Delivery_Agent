# Kiosko in-store · Donatto Resto-Bar

Interfaz táctil estilo McDonald's para que los clientes en sitio tomen su propio pedido. Convive con el chatbot de WhatsApp/n8n que sigue manejando los pedidos a domicilio.

## Arquitectura

```
┌────────────┐   POST /api/orders    ┌──────────────┐
│  UI Kiosko │ ──────────────────►   │  Express     │
│  (touch)   │ ◄──── ticketNumber    │  (Node)      │
└────────────┘                       └──────┬───────┘
                                            │
              ┌─────────────────────────────┼─────────────────────────────┐
              ▼                             ▼                             ▼
      ┌──────────────┐            ┌──────────────────┐         ┌────────────────────┐
      │  SQLite      │            │  printer.js      │         │  notifyDispatch    │
      │  pedidos     │            │  ESC/POS TCP     │         │  ├─ n8n webhook    │
      │  (canónico)  │            │  192.168.x:9100  │         │  └─ Meta API (fb)  │
      └──────────────┘            └──────────────────┘         └────────┬───────────┘
                                                                         │
                                                                         ▼
                                                               ┌──────────────────────┐
                                                               │ WhatsApp despacho    │
                                                               │ +57 310 485 9728     │
                                                               └──────────────────────┘
```

El flujo de WhatsApp para domicilios sigue intacto en n8n (`v5-pro`), totalmente separado.

## Arrancar

```bash
cp .env.example .env   # primer setup
npm install            # si no se hizo aún
npm run kiosk          # solo kiosko (recomendado en producción)
# o
npm run kiosk:dev      # con hot-reload para desarrollo
```

UI disponible en `http://localhost:3000/kiosko`.

## Variables de entorno relevantes

| Variable | Default | Descripción |
|---|---|---|
| `KIOSK_ENABLED` | `true` | Arranca el server del kiosko |
| `KIOSK_PORT` | `3000` | Puerto HTTP del kiosko |
| `KIOSK_PAYMENTS` | `efectivo` | Métodos habilitados separados por coma. Disponibles: `efectivo`, `qr_transferencia`, `datafono` |
| `MENU_PATH` | `../Donattos chatbot Lasted/donatto_menu.json` | Ruta absoluta al menú JSON |
| `PRINTER_IP` | (vacío) | IP de impresora térmica ESC/POS. Si no se define, se omite la impresión sin error |
| `PRINTER_PORT` | `9100` | Puerto TCP de la impresora |
| `KIOSK_N8N_WEBHOOK_URL` | (vacío) | URL del webhook n8n para notificar despacho. Recomendado |
| `META_ACCESS_TOKEN` + `META_PHONE_NUMBER_ID` + `DISPATCH_NUMBER` | (vacío) | Fallback directo a WhatsApp Cloud API si no hay webhook n8n |

## Habilitar QR transferencia / Datáfono

Cuando estén listos los métodos adicionales:

```bash
KIOSK_PAYMENTS=efectivo,qr_transferencia,datafono
```

Los botones aparecerán activos en la UI sin tocar código. Para mostrar el QR de transferencia hay que extender la pantalla de confirmación (sección `showConfirmation` en `public/kiosko/app.js`) con la imagen del QR (sugerido: servir como `/kiosko/qr.png` y hacer un `<img>` condicional por `data.paymentMethod`).

## Endpoints

### `GET /api/menu`
Devuelve el menú normalizado (categorías + ítems con `id` estable). El frontend lo cachea internamente y los `id` son hashes md5 de `categoría::subcategoría::nombre` para sobrevivir reordenamientos.

### `POST /api/orders`
Body:
```json
{
  "items": [{"id": "<id del menú>", "qty": 2, "notes": "opcional"}],
  "paymentMethod": "efectivo",
  "deliveryType": "mesa" | "para_llevar",
  "mesa": "5",
  "customerName": "opcional",
  "notas": "opcional, para la cocina"
}
```
Respuesta:
```json
{ "ok": true, "ticketNumber": "K-001", "total": "$28.000", "itemsCount": 1, ... }
```

### `GET /health`
Smoke test.

## Numeración de tickets

`K-NNN` por día (reset diario, ver tabla `ticket_counter`).

## Esquema de DB (extensiones nuevas)

A `pedidos` se agregaron columnas no destructivas vía `ALTER TABLE` (migración automática al primer boot):
`order_source`, `delivery_type`, `mesa`, `ticket_number`, `items_json`, `subtotal_cop`, `status`, `notas`.

Los pedidos del kiosko llevan `order_source='kiosko'` y un cliente sintético con `telefono='KIOSKO-K-NNN'` para satisfacer el FK existente sin colisionar con clientes reales de WhatsApp.

## Convivencia con el flujo WhatsApp

Si querés correr WhatsApp local **además** del kiosko (por ejemplo en desarrollo):
```
KIOSK_ENABLED=true
WHATSAPP_LOCAL_ENABLED=true
GEMINI_API_KEY=...
```

En producción se asume que WhatsApp va por n8n cloud (`v5-pro`) y este server es solo para el kiosko.
