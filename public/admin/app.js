// ════════════ Panel Admin · Donatto Resto-Bar (vanilla JS) ════════════

const $ = s => document.querySelector(s);
const fmt = n => "$" + Number(n || 0).toLocaleString("es-CO");
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let categoriesCache = [];
let _currentRole = "admin";

// ───── API ─────
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch("/api/admin" + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || (data.errors || []).join(", ") || `HTTP ${res.status}`);
  return data;
}
async function apiForm(path, formData) {
  const res = await fetch("/api/admin" + path, { method: "POST", body: formData });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ───── UI helpers ─────
function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (isErr ? " err" : "");
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2600);
}
function openModal(title, html) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = html;
  $("#modal").classList.remove("hidden");
}
function closeModal() { $("#modal").classList.add("hidden"); }

let onFilePicked = null;
$("#file-input").addEventListener("change", e => {
  const file = e.target.files[0];
  e.target.value = "";
  if (file && onFilePicked) onFilePicked(file);
});
function pickFile(cb) { onFilePicked = cb; $("#file-input").click(); }

// ───── Sesión ─────
async function checkSession() {
  try { const me = await api("GET", "/me"); showApp(me); }
  catch { showLogin(); }
}
function showLogin() {
  disconnectOrdersWs();
  stopWaPoller();
  stopOrdersPoller();
  $("#app-view").classList.add("hidden");
  $("#login-view").classList.remove("hidden");
}
function showApp(me) {
  _currentRole = me.role === "operator" ? "operator" : "admin";
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  $("#who").textContent = me.username;

  if (_currentRole === "operator") {
    $("#role-badge").classList.remove("hidden");
    // Ocultar tabs de solo-admin
    ["products", "categories", "payments", "settings"].forEach(tab => {
      const btn = document.querySelector(`[data-tab="${tab}"]`);
      if (btn) btn.style.display = "none";
    });
    // Ocultar formulario de número de despacho
    const waForm = $("#whatsapp-form");
    if (waForm) waForm.style.display = "none";
    // Ir directo a pedidos
    switchTab("orders");
  } else {
    switchTab("products");
  }

  connectOrdersWs();
  loadAll();
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach(x => x.classList.toggle("active", x.dataset.tab === name));
  document.querySelectorAll(".tab-panel").forEach(x => x.classList.toggle("active", x.id === "tab-" + name));
}

$("#login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("#login-error"); err.classList.add("hidden");
  try {
    const me = await api("POST", "/login", { username: $("#login-user").value, password: $("#login-pass").value });
    showApp(me);
  } catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); }
});

// ───── Carga general ─────
async function loadAll() {
  const safe = fn => fn().catch(err => console.error("[loadAll]", err));
  const tasks = [safe(loadOrderDashboard), safe(loadWhatsapp)];
  if (_currentRole === "admin") tasks.push(safe(loadCategories), safe(loadProducts), safe(loadPayments), safe(loadSettings));
  await Promise.all(tasks);
}

// ───── WebSocket (tiempo real) ─────
let _ws = null;

function connectOrdersWs() {
  if (_ws && _ws.readyState <= 1) return;
  try {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    _ws = new WebSocket(`${proto}//${location.host}/ws`);
    _ws.onmessage = e => {
      try {
        const { type } = JSON.parse(e.data);
        if (type === "order:new" || type === "order:status") loadOrderDashboard();
      } catch {}
    };
    _ws.onclose = () => { _ws = null; setTimeout(connectOrdersWs, 4000); };
    _ws.onerror = () => {};
  } catch {}
}

function disconnectOrdersWs() {
  if (_ws) { try { _ws.close(); } catch {} _ws = null; }
}

// ───── Pedidos ─────
let _ordersPoller = null;

const STATUS_OPTIONS = [
  { value: "pending",   label: "⏳ Pendiente"      },
  { value: "accepted",  label: "✅ Recibido"       },
  { value: "cooking",   label: "👨‍🍳 En preparación" },
  { value: "sent",      label: "🛵 Entregando"     },
  { value: "cancelled", label: "❌ Cancelado"      },
];

const STATUS_CLS = {
  pending:   "status-pending",
  accepted:  "status-accepted",
  cooking:   "status-cooking",
  sent:      "status-sent",
  ready:     "status-ready",
  cancelled: "status-cancelled",
};

function timeAgo(createdAt) {
  const mins = Math.floor((Date.now() - new Date(createdAt + "Z").getTime()) / 60000);
  if (mins < 1) return "ahora";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60); return `${h}h ${mins % 60}m`;
}

async function loadOrderDashboard() {
  try {
    const [counts, orders] = await Promise.all([
      api("GET", "/orders/counts"),
      api("GET", "/orders/active"),
    ]);
    $("#count-pendientes").textContent = counts.pendientes;
    $("#count-cocina").textContent     = counts.en_cocina;
    $("#count-entregando").textContent = counts.entregando;
    const wrap = $("#orders-list");
    if (!orders.length) {
      wrap.innerHTML = '<p class="muted" style="padding:20px 0">No hay pedidos activos.</p>';
      return;
    }
    const opts = STATUS_OPTIONS.map(o => `<option value="${o.value}">${o.label}</option>`).join("");
    wrap.innerHTML = `
      <table class="grid orders-grid">
        <thead><tr><th>Ticket</th><th>Canal</th><th>Cliente</th><th>Items</th><th>Total</th><th>Estado</th><th>Hace</th></tr></thead>
        <tbody>${orders.map(o => {
          const src = o.source === "whatsapp" ? "📱 WA" : "🖥️ Kiosko";
          const who = o.customer_name || (o.customer_phone ? `+${o.customer_phone}` : "—");
          const extraOpt = STATUS_OPTIONS.some(s => s.value === o.status) ? "" :
            `<option value="${esc(o.status)}">${esc(o.status)}</option>`;
          return `<tr>
            <td><strong>${esc(o.ticket_number)}</strong></td>
            <td>${src}</td>
            <td>${esc(who)}</td>
            <td class="muted">${o.item_count}</td>
            <td>${fmt(o.total_cop)}</td>
            <td>
              <select class="status-select ${STATUS_CLS[o.status] || ""}"
                data-order-id="${o.id}" data-prev="${esc(o.status)}">
                ${extraOpt}${opts}
              </select>
            </td>
            <td class="muted">${timeAgo(o.created_at)}</td>
          </tr>`;
        }).join("")}</tbody>
      </table>`;
    // Set current value after render
    orders.forEach(o => {
      const sel = document.querySelector(`[data-order-id="${o.id}"]`);
      if (sel) sel.value = o.status;
    });
  } catch { /* sin pedidos activos */ }
}

async function changeOrderStatus(sel) {
  const orderId  = sel.dataset.orderId;
  const newStatus = sel.value;
  const prev = sel.dataset.prev;
  try {
    await api("PUT", `/orders/${orderId}/status`, { status: newStatus });
    sel.dataset.prev = newStatus;
    sel.className = `status-select ${STATUS_CLS[newStatus] || ""}`;
    toast("Estado actualizado ✓");
  } catch (ex) {
    sel.value = prev;
    toast(ex.message, true);
  }
}

function startOrdersPoller() {
  stopOrdersPoller();
  _ordersPoller = setInterval(loadOrderDashboard, 15000);
}
function stopOrdersPoller() {
  if (_ordersPoller) { clearInterval(_ordersPoller); _ordersPoller = null; }
}

function exportOrders(period) {
  window.location.href = `/api/admin/orders/export?period=${period}`;
}

// ───── Categorías ─────
async function loadCategories() {
  categoriesCache = await api("GET", "/categories");
  const body = $("#categories-body");
  body.innerHTML = categoriesCache.map(c => `
    <tr>
      <td>${c.sort_order}</td><td>${esc(c.emoji || "")}</td>
      <td><strong>${esc(c.name)}</strong></td><td class="muted">${esc(c.slug)}</td>
      <td>${c.product_count}</td>
      <td><span class="badge ${c.enabled ? "on" : "off"}">${c.enabled ? "Activa" : "Oculta"}</span></td>
      <td><div class="row-actions">
        <button class="btn-sm" data-edit-cat="${c.id}">Editar</button>
        <button class="btn-sm danger" data-del-cat="${c.id}">Borrar</button>
      </div></td>
    </tr>`).join("");
}
function categoryForm(cat) {
  const c = cat || { name: "", emoji: "", sort_order: 0, enabled: 1 };
  openModal(cat ? "Editar categoría" : "Nueva categoría", `
    <label>Nombre<input id="f-cat-name" value="${esc(c.name)}" /></label>
    <label>Emoji<input id="f-cat-emoji" value="${esc(c.emoji || "")}" maxlength="4" /></label>
    <label>Orden<input id="f-cat-order" type="number" value="${c.sort_order}" /></label>
    <label style="flex-direction:row;align-items:center;gap:8px"><input id="f-cat-enabled" type="checkbox" ${c.enabled ? "checked" : ""} style="width:auto"/> Visible en el kiosko</label>
    <div class="modal-actions">
      <button class="btn-sm" data-action="close-modal">Cancelar</button>
      <button class="primary" data-save-cat="${cat ? cat.id : ""}">Guardar</button>
    </div>`);
}
async function saveCategory(id) {
  const payload = {
    name: $("#f-cat-name").value.trim(),
    emoji: $("#f-cat-emoji").value.trim() || null,
    sort_order: parseInt($("#f-cat-order").value, 10) || 0,
    enabled: $("#f-cat-enabled").checked
  };
  try {
    if (id) await api("PUT", `/categories/${id}`, payload);
    else await api("POST", "/categories", payload);
    closeModal(); toast("Categoría guardada ✓"); await loadCategories(); await loadProducts();
  } catch (ex) { toast(ex.message, true); }
}

// ───── Productos ─────
async function loadProducts() {
  const products = await api("GET", "/products");
  const body = $("#products-body");
  body.innerHTML = products.map(p => `
    <tr>
      <td>${p.image ? `<img class="thumb" src="${esc(p.image)}" />` : `<div class="no-img">🍽️</div>`}</td>
      <td><strong>${esc(p.name)}</strong><br><span class="muted">${esc(p.description || "")}</span></td>
      <td>${esc(p.category_name)}</td>
      <td>${fmt(p.price_cop)}</td>
      <td><span class="badge ${p.available ? "on" : "off"}">${p.available ? "Disponible" : "Agotado"}</span></td>
      <td><div class="row-actions">
        <button class="btn-sm" data-img-prod="${p.id}">Imagen</button>
        <button class="btn-sm" data-edit-prod='${esc(JSON.stringify(p))}'>Editar</button>
        <button class="btn-sm danger" data-del-prod="${p.id}">Borrar</button>
      </div></td>
    </tr>`).join("");
}
function productForm(prod) {
  const p = prod || { category_id: categoriesCache[0]?.id, name: "", description: "", price_cop: "", available: 1, sort_order: 0 };
  const opts = categoriesCache.map(c => `<option value="${c.id}" ${c.id === p.category_id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  openModal(prod ? "Editar producto" : "Nuevo producto", `
    <label>Categoría<select id="f-prod-cat">${opts}</select></label>
    <label>Nombre<input id="f-prod-name" value="${esc(p.name)}" /></label>
    <label>Descripción<textarea id="f-prod-desc">${esc(p.description || "")}</textarea></label>
    <label>Precio (COP)<input id="f-prod-price" type="number" min="0" value="${p.price_cop}" /></label>
    <label>Orden<input id="f-prod-order" type="number" value="${p.sort_order || 0}" /></label>
    <label style="flex-direction:row;align-items:center;gap:8px"><input id="f-prod-avail" type="checkbox" ${p.available ? "checked" : ""} style="width:auto"/> Disponible</label>
    <div class="modal-actions">
      <button class="btn-sm" data-action="close-modal">Cancelar</button>
      <button class="primary" data-save-prod="${prod ? prod.id : ""}">Guardar</button>
    </div>`);
}
async function saveProduct(id) {
  const payload = {
    category_id: parseInt($("#f-prod-cat").value, 10),
    name: $("#f-prod-name").value.trim(),
    description: $("#f-prod-desc").value.trim() || null,
    price_cop: parseInt($("#f-prod-price").value, 10),
    sort_order: parseInt($("#f-prod-order").value, 10) || 0,
    available: $("#f-prod-avail").checked
  };
  try {
    if (id) await api("PUT", `/products/${id}`, payload);
    else await api("POST", "/products", payload);
    closeModal(); toast("Producto guardado ✓"); await loadProducts();
  } catch (ex) { toast(ex.message, true); }
}
function uploadProductImage(id) {
  pickFile(async file => {
    const fd = new FormData(); fd.append("image", file);
    try { await apiForm(`/products/${id}/image`, fd); toast("Imagen actualizada ✓"); await loadProducts(); }
    catch (ex) { toast(ex.message, true); }
  });
}

// ───── Pagos ─────
async function loadPayments() {
  const pms = await api("GET", "/payments");
  $("#payments-body").innerHTML = pms.map(pm => `
    <tr>
      <td class="muted">${esc(pm.code)}</td>
      <td><strong>${esc(pm.label)}</strong></td>
      <td>${pm.type === "qr_static" ? "QR" : "Efectivo"}</td>
      <td>${pm.qr_image ? `<img class="thumb" src="${esc(pm.qr_image)}" />` : (pm.type === "qr_static" ? "<span class='muted'>sin QR</span>" : "—")}</td>
      <td><span class="badge ${pm.enabled ? "on" : "off"}">${pm.enabled ? "Sí" : "No"}</span></td>
      <td><div class="row-actions">
        ${pm.type === "qr_static" ? `<button class="btn-sm" data-qr-pay="${pm.id}">Subir QR</button>` : ""}
        <button class="btn-sm" data-edit-pay='${esc(JSON.stringify(pm))}'>Editar</button>
      </div></td>
    </tr>`).join("");
}
function paymentForm(pm) {
  openModal("Editar método de pago", `
    <label>Etiqueta<input id="f-pay-label" value="${esc(pm.label)}" /></label>
    <label style="flex-direction:row;align-items:center;gap:8px"><input id="f-pay-enabled" type="checkbox" ${pm.enabled ? "checked" : ""} style="width:auto"/> Habilitado en el kiosko</label>
    <div class="modal-actions">
      <button class="btn-sm" data-action="close-modal">Cancelar</button>
      <button class="primary" data-save-pay="${pm.id}">Guardar</button>
    </div>`);
}
async function savePayment(id) {
  try {
    await api("PUT", `/payments/${id}`, { label: $("#f-pay-label").value.trim(), enabled: $("#f-pay-enabled").checked });
    closeModal(); toast("Método de pago guardado ✓"); await loadPayments();
  } catch (ex) { toast(ex.message, true); }
}
function uploadPaymentQr(id) {
  pickFile(async file => {
    const fd = new FormData(); fd.append("qr", file);
    try { await apiForm(`/payments/${id}/qr`, fd); toast("QR actualizado ✓"); await loadPayments(); }
    catch (ex) { toast(ex.message, true); }
  });
}

// ───── Ajustes + Horarios ─────
const DAYS_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAMES  = { mon: "Lunes", tue: "Martes", wed: "Miércoles", thu: "Jueves", fri: "Viernes", sat: "Sábado", sun: "Domingo" };
const DEF_HOURS  = {
  mon: { enabled: true,  open: "10:00", close: "22:00" },
  tue: { enabled: true,  open: "10:00", close: "22:00" },
  wed: { enabled: true,  open: "10:00", close: "22:00" },
  thu: { enabled: true,  open: "10:00", close: "22:00" },
  fri: { enabled: true,  open: "10:00", close: "22:00" },
  sat: { enabled: true,  open: "10:00", close: "23:00" },
  sun: { enabled: false, open: "10:00", close: "22:00" },
};

async function loadSettings() {
  const s = await api("GET", "/settings");
  const f = $("#settings-form");
  f.brand_name.value     = s.brand_name || "";
  f.kitchen_number.value = s.kitchen_number || "";
  f.currency.value       = s.currency || "COP";
  $("#brand-name").textContent = s.brand_name || "Donatto";
  renderHoursEditor(s.business_hours || DEF_HOURS);
}

function renderHoursEditor(hours) {
  const tbody = $("#hours-tbody");
  if (!tbody) return;
  tbody.innerHTML = DAYS_ORDER.map(day => {
    const cfg = (hours && hours[day]) ? hours[day] : DEF_HOURS[day];
    return `<tr>
      <td><input type="checkbox" class="hours-enabled" data-day="${day}" ${cfg.enabled ? "checked" : ""} /></td>
      <td class="hours-day">${DAY_NAMES[day]}</td>
      <td><input type="time" class="hours-open time-input" data-day="${day}" value="${cfg.open}" /></td>
      <td class="hours-sep">–</td>
      <td><input type="time" class="hours-close time-input" data-day="${day}" value="${cfg.close}" /></td>
    </tr>`;
  }).join("");
}

async function saveBusinessHours() {
  const hours = {};
  for (const day of DAYS_ORDER) {
    const en = document.querySelector(`.hours-enabled[data-day="${day}"]`);
    const op = document.querySelector(`.hours-open[data-day="${day}"]`);
    const cl = document.querySelector(`.hours-close[data-day="${day}"]`);
    if (!en) continue;
    hours[day] = { enabled: en.checked, open: op?.value || "10:00", close: cl?.value || "22:00" };
  }
  try {
    await api("PUT", "/settings", { business_hours: hours });
    const saved = $("#hours-saved");
    saved.classList.remove("hidden");
    setTimeout(() => saved.classList.add("hidden"), 2000);
  } catch (ex) { toast(ex.message, true); }
}

$("#settings-form").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api("PUT", "/settings", { brand_name: f.brand_name.value, kitchen_number: f.kitchen_number.value, currency: f.currency.value });
    $("#settings-saved").classList.remove("hidden");
    setTimeout(() => $("#settings-saved").classList.add("hidden"), 2000);
    await loadSettings();
  } catch (ex) { toast(ex.message, true); }
});

// ───── WhatsApp ─────
let _waPoller = null;

async function loadWhatsapp() {
  if (_currentRole === "admin") {
    const s = await api("GET", "/settings");
    const f = $("#whatsapp-form");
    if (f) f.dispatch_number.value = s.dispatch_number || "";
  }
  pollWaStatus();
  startWaPoller();
}

async function pollWaStatus() {
  try { renderWaState(await api("GET", "/whatsapp/status")); } catch {}
}

function startWaPoller() {
  stopWaPoller();
  _waPoller = setInterval(pollWaStatus, 3000);
}
function stopWaPoller() {
  if (_waPoller) { clearInterval(_waPoller); _waPoller = null; }
}

const WA_LABELS = {
  disabled:     ["Desactivado", "off"],
  initializing: ["Iniciando…",  "warn"],
  qr:           ["Esperando escaneo QR", "warn"],
  connecting:   ["Conectando…", "warn"],
  ready:        ["Conectado ✓", "on"],
  disconnected: ["Desconectado", "off"],
};

function renderWaState({ status, qr_data_url }) {
  const [label, cls] = WA_LABELS[status] || [status, "off"];
  const badge = $("#wa-status-badge");
  badge.textContent = label;
  badge.className = `badge ${cls}`;

  const qrWrap    = $("#wa-qr-wrap");
  const readyMsg  = $("#wa-ready-msg");
  const disabledMsg = $("#wa-disabled-msg");

  qrWrap.classList.toggle("hidden", status !== "qr");
  readyMsg.classList.toggle("hidden", status !== "ready");
  disabledMsg.classList.toggle("hidden", status !== "disabled");

  if (status === "qr" && qr_data_url) $("#wa-qr-img").src = qr_data_url;
}

const waForm = $("#whatsapp-form");
if (waForm) {
  waForm.addEventListener("submit", async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api("PUT", "/settings", { dispatch_number: f.dispatch_number.value.trim() });
      $("#wa-saved").classList.remove("hidden");
      setTimeout(() => $("#wa-saved").classList.add("hidden"), 2000);
    } catch (ex) { toast(ex.message, true); }
  });
}

// ───── Cambio de contraseña ─────
function changePasswordForm() {
  openModal("Cambiar contraseña", `
    <label>Contraseña actual<input id="f-cp-cur" type="password" /></label>
    <label>Nueva contraseña (mín. 6)<input id="f-cp-new" type="password" /></label>
    <div class="modal-actions">
      <button class="btn-sm" data-action="close-modal">Cancelar</button>
      <button class="primary" data-save-pass="1">Cambiar</button>
    </div>`);
}
async function changePassword() {
  try {
    await api("POST", "/change-password", { currentPassword: $("#f-cp-cur").value, newPassword: $("#f-cp-new").value });
    closeModal(); toast("Contraseña cambiada ✓");
  } catch (ex) { toast(ex.message, true); }
}

// ───── Delegación de eventos — click ─────
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-tab],[data-action],[data-edit-cat],[data-del-cat],[data-save-cat],[data-edit-prod],[data-del-prod],[data-save-prod],[data-img-prod],[data-edit-pay],[data-save-pay],[data-qr-pay],[data-save-pass]");
  if (!t) return;
  const d = t.dataset;

  if (d.tab) {
    switchTab(d.tab);
    if      (d.tab === "whatsapp")    { startWaPoller();   stopOrdersPoller();  loadWhatsapp(); }
    else if (d.tab === "orders")      { stopWaPoller();    loadOrderDashboard(); startOrdersPoller(); }
    else if (d.tab === "products")    { stopWaPoller();    stopOrdersPoller();  loadProducts(); }
    else if (d.tab === "categories")  { stopWaPoller();    stopOrdersPoller();  loadCategories(); }
    else if (d.tab === "payments")    { stopWaPoller();    stopOrdersPoller();  loadPayments(); }
    else if (d.tab === "settings")    { stopWaPoller();    stopOrdersPoller();  loadSettings(); }
    else                              { stopWaPoller();    stopOrdersPoller(); }
    return;
  }

  switch (d.action) {
    case "close-modal":     return closeModal();
    case "logout":          await api("POST", "/logout").catch(() => {}); return showLogin();
    case "change-pass":     return changePasswordForm();
    case "new-category":    return categoryForm(null);
    case "new-product":     return productForm(null);
    case "refresh-orders":  return loadOrderDashboard();
    case "export-day":      return exportOrders("day");
    case "export-month":    return exportOrders("month");
    case "save-hours":      return saveBusinessHours();
  }

  if (d.editCat) return categoryForm(categoriesCache.find(c => c.id === +d.editCat));
  if (d.delCat) {
    if (confirm("¿Borrar categoría y TODOS sus productos?")) {
      await api("DELETE", `/categories/${d.delCat}`).then(() => { toast("Categoría borrada"); loadCategories(); loadProducts(); }).catch(ex => toast(ex.message, true));
    }
    return;
  }
  if (d.saveCat !== undefined) return saveCategory(d.saveCat || null);

  if (d.editProd) return productForm(JSON.parse(d.editProd));
  if (d.delProd) {
    if (confirm("¿Borrar este producto?")) {
      await api("DELETE", `/products/${d.delProd}`).then(() => { toast("Producto borrado"); loadProducts(); }).catch(ex => toast(ex.message, true));
    }
    return;
  }
  if (d.saveProd !== undefined) return saveProduct(d.saveProd || null);
  if (d.imgProd) return uploadProductImage(d.imgProd);

  if (d.editPay) return paymentForm(JSON.parse(d.editPay));
  if (d.savePay) return savePayment(d.savePay);
  if (d.qrPay)   return uploadPaymentQr(d.qrPay);

  if (d.savePass) return changePassword();
});

// ───── Delegación de eventos — change (status select) ─────
document.addEventListener("change", async e => {
  const sel = e.target.closest(".status-select");
  if (sel) return changeOrderStatus(sel);
});

checkSession();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/admin/sw.js").catch(() => {});
  });
}
