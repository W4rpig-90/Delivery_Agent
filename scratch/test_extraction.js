const { extractDeliveryData } = require("../services/orderProcessor");

const history = [
  {
    role: "model",
    parts: [{ text: "¡Perfecto! El total es $15.000. ¿Confirmás el pedido? Respondé SÍ para proceder." }]
  },
  {
    role: "user",
    parts: [{ text: "si" }]
  },
  {
    role: "model",
    parts: [{ text: "¡Excelente decisión! 🍕 Para finalizar, por favor decime tu *nombre*, *dirección de entrega* y el *método de pago* (efectivo, transferencia o mercado pago)." }]
  },
  {
    role: "user",
    parts: [{ text: "Rayner\nCall 12 $ 12 -23\nEfectivo" }]
  }
];

const data = extractDeliveryData(history);
console.log("Datos extraídos:", JSON.stringify(data, null, 2));

if (data.nombre === "Rayner") {
  console.log("✅ Nombre extraído correctamente.");
} else {
  console.log("❌ Error al extraer nombre. Recibido:", data.nombre);
}

if (data.direccion && data.direccion.includes("Call 12")) {
  console.log("✅ Dirección extraída correctamente.");
} else {
  console.log("❌ Error al extraer dirección. Recibido:", data.direccion);
}

if (data.metodoPago === "Efectivo") {
  console.log("✅ Pago extraído correctamente.");
} else {
  console.log("❌ Error al extraer pago. Recibido:", data.metodoPago);
}
