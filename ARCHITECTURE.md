# Arquitectura del Proyecto: Donattos Chatbot

Este documento detalla la estructura técnica, las librerías y el funcionamiento del sistema automatizado de pedidos para Donattos.

## 1. Arquitectura General
El proyecto sigue una arquitectura **Modular y Basada en Servicios** construida sobre **Node.js**. El sistema está diseñado para ser reactivo, procesando mensajes en tiempo real y manteniendo el estado de la conversación para cada cliente de forma independiente.

### Flujo de Datos
1. **Entrada de Mensajes:** Capturados por `whatsapp-web.js` (soporta texto y audio).
2. **Procesamiento de Audio:** Si el mensaje es una nota de voz, se procesa mediante la API de Google Gemini para transcripción.
3. **Capa de Inteligencia (IA):** Google Gemini 1.5 Flash procesa el mensaje, el historial y el menú para generar una respuesta coherente.
4. **Gestión de Sesiones:** El sistema mantiene un historial de conversación y datos de entrega temporales en memoria.
5. **Persistencia:** Al confirmar un pedido, los datos del cliente y la venta se guardan en la base de datos local.
6. **Despacho e Impresión:** Se genera un ticket formateado que se envía a WhatsApp y a la impresora POS local.

---

## 2. Stack Tecnológico (Librerías)

| Librería | Función |
| :--- | :--- |
| **`whatsapp-web.js`** | Interfaz principal con WhatsApp (Protocolo Web). |
| **`@google/generative-ai`** | Integración con Gemini 1.5 Flash (Entendimiento de lenguaje natural y audio). |
| **`better-sqlite3`** | Motor de base de datos síncrono y de alto rendimiento para Node.js. |
| **`dotenv`** | Gestión de configuraciones y claves de API seguras. |
| **`qrcode-terminal`** | Visualización del código QR para autenticación en la terminal. |
| **`axios`** | Cliente HTTP para peticiones externas (si se requieren). |

---

## 3. Módulos y Servicios

### `index.js` (Punto de entrada)
Coordina los eventos de WhatsApp, gestiona la inicialización del cliente y dirige los mensajes entrantes hacia los servicios correspondientes.

### `services/gemini.js`
*   **Interacción:** Maneja el envío de prompts y la recepción de respuestas de la IA.
*   **Audio:** Implementa la lógica para convertir archivos de audio en texto procesable.
*   **Limpieza:** Filtra marcadores técnicos (como `[DATO_DIR:]`) para que el usuario final reciba solo texto limpio.

### `services/sessionManager.js`
*   Mantiene un objeto en memoria por cada cliente activo.
*   Almacena el historial de mensajes (contexto) y los datos parciales del pedido (nombre, dirección, pago).

### `services/orderProcessor.js`
*   **Extracción:** Utiliza lógica combinada (IA + RegEx) para capturar datos críticos de entrega.
*   **Generación de Ticket:** Crea la representación visual en texto del pedido para despacho.

### `services/database.js`
*   Implementa el esquema de base de datos.
*   **`upsertClient`:** Gestiona la agenda de clientes.
*   **`saveOrder`:** Registra las transacciones para control de ventas.

---

## 4. Base de Datos: SQLite (`donattos.db`)
El sistema utiliza **SQLite** a través de `better-sqlite3` por su simplicidad y velocidad en entornos locales.

### Tablas Principales:
*   **`clientes`**: Almacena `telefono`, `nombre` y `direccion`. Permite que el bot reconozca a clientes recurrentes.
*   **`pedidos`**: Almacena `id`, `cliente_telefono`, `resumen`, `total`, `metodo_pago` y `fecha`.

### Gestión de Datos:
*   Los datos se guardan de forma persistente pero la interacción inmediata se apoya en la memoria para mayor fluidez.
*   Se utiliza el concepto de **Upsert** para evitar duplicados en la lista de clientes.

---

## 5. Gestión de Configuración
Toda la configuración sensible se maneja a través de un archivo `.env`:
*   `GEMINI_API_KEY`: Acceso a la inteligencia artificial.
*   `DISPATCH_NUMBER`: Número de WhatsApp que recibe los tickets de cocina.
*   `PRINTER_NAME`: Identificador de la impresora térmica local.
