# Plan de Implementación v3.0: n8n Cloud ☁️

Este documento describe la transición del chatbot de una ejecución local (Node.js) a una orquestación en la nube utilizando **n8n Cloud**.

## 1. Arquitectura de la Solución
En esta versión, eliminamos la dependencia de hardware local.

*   **Gateway:** WhatsApp Business Cloud API (Meta).
*   **Orquestador:** n8n Cloud (Workflow).
*   **Inteligencia:** Google Gemini (vía nodos de AI de n8n).
*   **Memoria:** n8n Window Buffer Memory (almacenada en la base de datos de n8n).
*   **Base de Datos:** Google Sheets (Historial de pedidos y clientes).

## 2. Componentes del Workflow en n8n

### A. Recepción de Mensajes (Webhook)
*   Se configura un nodo de **Webhook** (POST) que Meta llamará cada vez que llegue un mensaje.
*   n8n Cloud nos da una URL pública segura (`https://tu-instancia.n8n.cloud/webhook/...`).

### B. Agente de IA (AI Agent Node)
*   **Prompt del Sistema:** Copiaremos el prompt de `services/gemini.js` adaptado para n8n.
*   **Herramientas (Tools):**
    *   `Consultar Menú`: Un nodo que lee el archivo `menu.json`.
    *   `Registrar Pedido`: Un nodo de Google Sheets que se activa cuando el agente confirma la compra.

### C. Persistencia (Google Sheets)
*   **Hoja Clientes:** `Teléfono`, `Nombre`, `Dirección`.
*   **Hoja Pedidos:** `ID`, `Fecha`, `Cliente`, `Resumen`, `Total`, `Estado`.

## 3. Ventajas de la Versión 3.0
1.  **Disponibilidad 24/7:** No depende de que tu PC esté encendida.
2.  **Escalabilidad:** Puede manejar múltiples conversaciones simultáneas sin latencia.
3.  **Panel de Control:** Google Sheets sirve como un "dashboard" gratuito para ver las ventas en tiempo real.
4.  **Mantenimiento Visual:** Es más fácil depurar errores viendo los nodos de n8n que leyendo logs en consola.

## 4. Próximos Pasos
1.  Importar el JSON del Workflow en n8n.
2.  Vincular las credenciales de WhatsApp Business y Google Sheets.
3.  Configurar el Webhook en el Dashboard de Meta con la nueva URL de n8n Cloud.
