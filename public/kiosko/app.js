// ───── Estado global ─────
const state = {
  menu: null,
  paymentsEnabled: ["efectivo"],
  paymentLabels: {},
  deliveryLabels: {},
  cart: new Map(),
  activeCategory: null,
  modalItem: null,
  modalQty: 1,
  deliveryType: null,
  paymentMethod: "efectivo",
  customerName: "",
  customerPhone: "",
  mesa: "",
  notas: "",
  _statusPollTimer: null,
  _currentTicket: null,
};

const STATUS_DISPLAY = {
  accepted:   { emoji: "✅", label: "Recibido — ¡la cocina ya lo vio!" },
  cooking:    { emoji: "👨‍🍳", label: "En preparación…" },
  ready:      { emoji: "🎉", label: "¡Tu pedido está listo! Pasa a recogerlo." },
  entregado:  { emoji: "🙌", label: "¡Entregado! Que lo disfrutes." },
  sent:       { emoji: "🛵", label: "¡En camino!" },
  finalizado: { emoji: "🏁", label: "¡Pedido finalizado! Gracias por tu visita." },
  cancelled:  { emoji: "❌", label: "Pedido cancelado. Habla con el personal." },
  closed:     { emoji: "✔",  label: "Pedido cerrado." },
};

const PAY_ICONS = { efectivo: "💵", qr_transferencia: "📱", datafono: "💳" };
const PAY_NAMES = { efectivo: "Efectivo", qr_transferencia: "QR / Transferencia", datafono: "Datáfono" };

// ───── Utilidades ─────
const fmt = n => "$" + Math.round(n).toLocaleString("es-CO");
const $ = sel => document.querySelector(sel);
const $$ = sel => document.querySelectorAll(sel);

function showScreen(id) {
  $$(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function showLoader(on) {
  document.getElementById("loader").classList.toggle("hidden", !on);
}

// ───── Carga inicial ─────
async function init() {
  showLoader(true);
  try {
    const res = await fetch("/api/menu");
    const data = await res.json();
    state.menu = data;
    state.paymentsEnabled = data.paymentsEnabled || ["efectivo"];
    state.paymentLabels = data.paymentLabels || {};
    state.deliveryLabels = data.deliveryLabels || {};
    if (data.categories.length > 0) state.activeCategory = data.categories[0].key;
    const brand = data.restaurante?.nombre;
    if (brand) {
      document.querySelectorAll(".brand, .brand-small").forEach(el => { el.textContent = brand; });
      document.title = brand + " — Kiosko";
    }
    renderCategories();
    renderProducts();
  } catch (err) {
    alert("No se pudo cargar el menú: " + err.message);
  } finally {
    showLoader(false);
  }
  bindActions();
}

// ───── Render ─────
function renderCategories() {
  const el = document.getElementById("categories");
  el.innerHTML = "";
  for (const cat of state.menu.categories) {
    const b = document.createElement("button");
    b.className = "cat-btn" + (cat.key === state.activeCategory ? " active" : "");
    b.textContent = cat.label;
    b.onclick = () => {
      state.activeCategory = cat.key;
      renderCategories();
      renderProducts();
    };
    el.appendChild(b);
  }
}

function renderProducts() {
  const el = document.getElementById("products");
  const items = state.menu.items.filter(i => i.category === state.activeCategory);
  el.innerHTML = "";

  let lastSub = null;
  for (const item of items) {
    if (item.subcategory && item.subcategory !== lastSub) {
      lastSub = item.subcategory;
      const h = document.createElement("div");
      h.style.gridColumn = "1/-1";
      h.style.fontWeight = "800";
      h.style.fontSize = "14px";
      h.style.textTransform = "uppercase";
      h.style.color = "var(--ink-soft)";
      h.style.letterSpacing = "1px";
      h.style.marginTop = "4px";
      h.textContent = item.subcategoryLabel || item.subcategory.replace(/_/g, " ");
      el.appendChild(h);
    }

    const card = document.createElement("div");
    card.className = "product-card";
    card.innerHTML = `
      <div class="product-name">${item.name}</div>
      <div class="product-desc">${item.description || ""}</div>
      <div class="product-bottom">
        <span class="product-price">${fmt(item.price)}</span>
        <button class="product-add">+ Agregar</button>
      </div>
    `;
    card.onclick = () => openItemModal(item);
    el.appendChild(card);
  }

  if (items.length === 0) {
    el.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--ink-soft)">Sin productos en esta categoría.</div>`;
  }
}

function updateCartBar() {
  const count = [...state.cart.values()].reduce((a, b) => a + b.qty, 0);
  const total = [...state.cart.values()].reduce((a, b) => a + b.qty * b.price, 0);
  document.getElementById("cart-count").textContent = count;
  document.getElementById("cart-bar-count").textContent = `${count} ${count === 1 ? "ítem" : "ítems"}`;
  document.getElementById("cart-bar-total").textContent = fmt(total);
}

function openItemModal(item) {
  state.modalItem = item;
  state.modalQty = 1;
  document.getElementById("modal-name").textContent = item.name;
  document.getElementById("modal-desc").textContent = item.description || "";
  document.getElementById("modal-price").textContent = fmt(item.price);
  document.getElementById("modal-qty").textContent = "1";
  document.getElementById("modal-item").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("modal-item").classList.add("hidden");
  state.modalItem = null;
}

function addToCart() {
  if (!state.modalItem) return;
  const it = state.modalItem;
  const existing = state.cart.get(it.id);
  if (existing) {
    existing.qty += state.modalQty;
  } else {
    state.cart.set(it.id, { id: it.id, name: it.name, price: it.price, qty: state.modalQty });
  }
  closeModal();
  updateCartBar();
}

function renderCart() {
  const list = document.getElementById("cart-list");
  list.innerHTML = "";
  if (state.cart.size === 0) {
    list.innerHTML = `<div class="cart-empty">Tu pedido está vacío.<br>Vuelve al menú y agrega productos.</div>`;
    document.getElementById("cart-total").textContent = fmt(0);
    return;
  }
  let total = 0;
  for (const it of state.cart.values()) {
    total += it.qty * it.price;
    const row = document.createElement("div");
    row.className = "cart-item";
    row.innerHTML = `
      <div class="cart-item-info">
        <div class="cart-item-name">${it.name}</div>
        <div class="cart-item-price">${fmt(it.price)} c/u</div>
      </div>
      <div class="cart-item-qty">
        <button class="btn-qty" data-cart-minus="${it.id}">−</button>
        <span class="cart-qty-value">${it.qty}</span>
        <button class="btn-qty" data-cart-plus="${it.id}">+</button>
      </div>
      <div class="cart-item-total">${fmt(it.qty * it.price)}</div>
    `;
    list.appendChild(row);
  }
  document.getElementById("cart-total").textContent = fmt(total);
}

function renderCheckout() {
  const items = [...state.cart.values()];
  const count = items.reduce((a, b) => a + b.qty, 0);
  const total = items.reduce((a, b) => a + b.qty * b.price, 0);
  document.getElementById("checkout-items-count").textContent = count;
  document.getElementById("checkout-total").textContent = fmt(total);

  document.getElementById("mesa-field").classList.toggle("hidden", state.deliveryType !== "mesa");

  const grid = document.getElementById("payment-methods");
  grid.innerHTML = "";
  const allOptions = ["efectivo", "qr_transferencia", "datafono"];
  for (const pm of allOptions) {
    const enabled = state.paymentsEnabled.includes(pm);
    const div = document.createElement("button");
    div.className = "pay-option" + (state.paymentMethod === pm ? " selected" : "") + (enabled ? "" : " disabled");
    div.innerHTML = `
      <span class="pay-icon">${PAY_ICONS[pm]}</span>
      <span>${PAY_NAMES[pm]}</span>
      ${enabled ? "" : '<span class="soon">Próximamente</span>'}
    `;
    if (enabled) {
      div.onclick = () => {
        state.paymentMethod = pm;
        renderCheckout();
      };
    }
    grid.appendChild(div);
  }

  document.getElementById("btn-confirm").disabled = count === 0 || !state.paymentsEnabled.includes(state.paymentMethod);
}

async function submitOrder() {
  state.customerName  = document.getElementById("customer-name").value.trim();
  state.customerPhone = document.getElementById("customer-phone").value.trim();
  state.mesa          = document.getElementById("mesa-number").value.trim();
  state.notas         = document.getElementById("order-notes").value.trim();

  if (state.deliveryType === "mesa" && !state.mesa) {
    alert("Por favor ingresa el número de mesa.");
    return;
  }

  const payload = {
    items: [...state.cart.values()].map(i => ({ id: i.id, qty: i.qty })),
    paymentMethod:  state.paymentMethod,
    deliveryType:   state.deliveryType,
    mesa:           state.mesa || null,
    customerName:   state.customerName  || null,
    customerPhone:  state.customerPhone || null,
    notas:          state.notas || null
  };

  showLoader(true);
  try {
    const res = await fetch("/api/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      alert("Error: " + (data.errors || []).join(", "));
      return;
    }
    showConfirmation(data);
  } catch (err) {
    alert("Error de red: " + err.message);
  } finally {
    showLoader(false);
  }
}

function showConfirmation(data) {
  document.getElementById("confirm-ticket").textContent = data.ticketNumber;
  const lines = [
    `<strong>${data.itemsCount}</strong> ítem${data.itemsCount === 1 ? "" : "s"} · Total <strong>${data.total}</strong>`,
    `Modalidad: <strong>${state.deliveryLabels[data.deliveryType] || data.deliveryType}</strong>${data.mesa ? ` (Mesa ${data.mesa})` : ""}`,
    `Pago: <strong>${state.paymentLabels[data.paymentMethod] || data.paymentMethod}</strong>`
  ];
  document.getElementById("confirm-details").innerHTML = lines.join("<br>");

  let inst = "";
  if (data.paymentMethod === "efectivo") {
    inst = "Pasa a caja a cancelar mostrando este número de ticket.";
  } else if (data.paymentMethod === "qr_transferencia") {
    inst = "Realiza la transferencia y muestra el comprobante en caja con tu número de ticket.";
  } else if (data.paymentMethod === "datafono") {
    inst = "Pasa a caja para realizar el pago con tarjeta mostrando este número de ticket.";
  }
  document.getElementById("confirm-instructions").textContent = inst;

  // Mostrar box de estado y arrancar polling
  state._currentTicket = data.ticketNumber;
  const statusBox = document.getElementById("order-status-box");
  statusBox.classList.remove("hidden");
  document.getElementById("order-status-emoji").textContent = "⏳";
  document.getElementById("order-status-label").textContent = "Esperando cocina…";
  startStatusPolling(data.ticketNumber);

  showScreen("screen-confirm");
}

function startStatusPolling(ticketNumber) {
  stopStatusPolling();
  let lastStatus = null;
  async function poll() {
    try {
      const r = await fetch(`/api/orders/status/${encodeURIComponent(ticketNumber)}`);
      if (!r.ok) return;
      const d = await r.json();
      if (d.status !== lastStatus) {
        lastStatus = d.status;
        const info = STATUS_DISPLAY[d.status] || { emoji: "⏳", label: d.label || d.status };
        document.getElementById("order-status-emoji").textContent = info.emoji;
        document.getElementById("order-status-label").textContent = info.label;
        if (["closed", "entregado", "finalizado", "cancelled"].includes(d.status)) stopStatusPolling();
      }
    } catch {}
  }
  poll();
  state._statusPollTimer = setInterval(poll, 5000);
}

function stopStatusPolling() {
  if (state._statusPollTimer) { clearInterval(state._statusPollTimer); state._statusPollTimer = null; }
}

function restart() {
  stopStatusPolling();
  state.cart.clear();
  state.deliveryType = null;
  state.paymentMethod = "efectivo";
  state.customerName  = "";
  state.customerPhone = "";
  state.mesa  = "";
  state.notas = "";
  state._currentTicket = null;
  document.getElementById("customer-name").value  = "";
  document.getElementById("customer-phone").value = "";
  document.getElementById("mesa-number").value    = "";
  document.getElementById("order-notes").value    = "";
  document.getElementById("order-status-box").classList.add("hidden");
  updateCartBar();
  showScreen("screen-welcome");
}

// ───── Bind ─────
function bindActions() {
  document.body.addEventListener("click", (e) => {
    const t = e.target.closest("[data-action], [data-mode], [data-cart-plus], [data-cart-minus]");
    if (!t) return;

    if (t.dataset.mode) {
      state.deliveryType = t.dataset.mode;
      document.getElementById("mode-badge").textContent = state.deliveryLabels[t.dataset.mode] || t.dataset.mode;
      showScreen("screen-menu");
      return;
    }

    if (t.dataset.cartPlus) {
      const item = state.cart.get(t.dataset.cartPlus);
      if (item) item.qty++;
      renderCart();
      updateCartBar();
      return;
    }

    if (t.dataset.cartMinus) {
      const item = state.cart.get(t.dataset.cartMinus);
      if (item) {
        item.qty--;
        if (item.qty <= 0) state.cart.delete(t.dataset.cartMinus);
      }
      renderCart();
      updateCartBar();
      return;
    }

    switch (t.dataset.action) {
      case "back-welcome": showScreen("screen-welcome"); break;
      case "back-menu": showScreen("screen-menu"); break;
      case "back-cart": showScreen("screen-cart"); renderCart(); break;
      case "open-cart":
        if (state.cart.size === 0) { alert("Aún no agregaste productos."); return; }
        renderCart(); showScreen("screen-cart"); break;
      case "clear-cart":
        if (confirm("¿Vaciar el pedido?")) { state.cart.clear(); updateCartBar(); renderCart(); }
        break;
      case "go-checkout":
        if (state.cart.size === 0) return;
        renderCheckout(); showScreen("screen-checkout"); break;
      case "submit-order": submitOrder(); break;
      case "restart": restart(); break;
      case "close-modal": closeModal(); break;
      case "qty-plus":
        if (state.modalQty < 50) state.modalQty++;
        document.getElementById("modal-qty").textContent = state.modalQty;
        break;
      case "qty-minus":
        if (state.modalQty > 1) state.modalQty--;
        document.getElementById("modal-qty").textContent = state.modalQty;
        break;
      case "add-to-cart": addToCart(); break;
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
