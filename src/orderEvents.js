/**
 * orderEvents.js — bus de eventos de pedidos (desacopla orderService del WS hub).
 *
 * Eventos:
 *   "order:new"     → pedido recién creado (kiosko o whatsapp)
 *   "order:status"  → cambio de estado de un pedido
 * Payload: el objeto del pedido (con items).
 */

const { EventEmitter } = require("events");

const bus = new EventEmitter();
bus.setMaxListeners(20);

module.exports = bus;
