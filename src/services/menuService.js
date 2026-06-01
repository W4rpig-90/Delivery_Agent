/**
 * menuService.js — arma la respuesta del menú para el kiosko desde la BASE DE DATOS
 * (reemplaza el antiguo loadMenu() que aplanaba menu.json en runtime).
 *
 * Mantiene la MISMA forma que esperaba el frontend del kiosko:
 *   { restaurante, moneda, categories:[{key,label,emoji}], items:[{id,category,...,price}],
 *     paymentsEnabled, paymentLabels, deliveryLabels }
 */

const { getMenuCategories, getAvailableProducts, getProductById } = require("../repositories/products.repo");
const { getSetting, getEnabledPayments } = require("../repositories/settings.repo");
const { DELIVERY_LABEL } = require("../../services/kioskTicket");

function buildMenuResponse() {
  const products = getAvailableProducts();

  const items = products.map(p => ({
    id: String(p.id),
    category: p.category,
    categoryLabel: p.categoryLabel,
    subcategory: null,
    subcategoryLabel: null,
    name: p.name,
    description: p.description || "",
    price: p.price,
    image: p.image || null
  }));

  // Solo categorías que tengan al menos un producto disponible
  const withItems = new Set(items.map(i => i.category));
  const categories = getMenuCategories()
    .filter(c => withItems.has(c.slug))
    .map(c => ({ key: c.slug, label: c.name, emoji: c.emoji }));

  const payments = getEnabledPayments();

  return {
    restaurante: { nombre: getSetting("brand_name", process.env.BRAND_NAME || "Donatto Resto-Bar") },
    moneda: getSetting("currency", "COP"),
    categories,
    items,
    paymentsEnabled: payments.map(p => p.code),
    paymentLabels: Object.fromEntries(payments.map(p => [p.code, p.label])),
    deliveryLabels: DELIVERY_LABEL
  };
}

/**
 * Valida y enriquece las líneas que envía el kiosko contra la DB.
 * @returns {{items:Array, errors:Array}}  items: [{id,name,price,qty,notes}]
 */
function validateAndEnrichItems(reqItems) {
  const errors = [];
  const items = [];

  if (!Array.isArray(reqItems) || reqItems.length === 0) {
    return { items, errors: ["items vacío"] };
  }

  for (const reqItem of reqItems) {
    const product = getProductById(parseInt(reqItem.id, 10));
    if (!product) { errors.push(`item desconocido: ${reqItem.id}`); continue; }
    if (!product.available) { errors.push(`agotado: ${product.name}`); continue; }

    const qty = parseInt(reqItem.qty, 10);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      errors.push(`cantidad inválida para ${product.name}`); continue;
    }

    items.push({
      id: product.id,
      name: product.name,
      price: product.price_cop,
      qty,
      notes: typeof reqItem.notes === "string" ? reqItem.notes.slice(0, 120) : null
    });
  }

  return { items, errors };
}

module.exports = { buildMenuResponse, validateAndEnrichItems };
