// ════════════ Pantalla de Cocina (KDS) · Donatto Resto-Bar ════════════

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const orders = new Map();     // id -> order
let ws = null;

const STATUS_LABEL = { pending: "Pendiente", accepted: "Aceptado", cooking: "Cocinando", ready: "Listo", entregado: "Entregado", sent: "Enviado", finalizado: "Finalizado" };

// Acciones disponibles según el estado actual
const NEXT_ACTIONS = {
  pending:    [{ t: "✅ Aceptar", s: "accepted", primary: true }, { t: "❌", s: "cancelled", ghost: true }],
  accepted:   [{ t: "👨‍🍳 Cocinando", s: "cooking", primary: true }, { t: "❌", s: "cancelled", ghost: true }],
  cooking:    [{ t: "🎉 Listo", s: "ready", primary: true }, { t: "🛵 Enviado", s: "sent" }],
  ready:      [{ t: "✅ Entregado", s: "entregado", primary: true }, { t: "✔ Cerrar", s: "closed" }],
  entregado:  [{ t: "🏁 Finalizar", s: "finalizado", primary: true }],
  sent:       [{ t: "🏁 Finalizar", s: "finalizado", primary: true }],
  finalizado: [],
};

// ───── API ─────
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(body); }
  const res = await fetch(path, opts);
  if (res.status === 401) { showLogin(); throw new Error("sesión expirada"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
function toast(msg, err) { const t = $("#toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); setTimeout(() => t.classList.add("hidden"), 2400); }

// ───── Sesión ─────
async function checkSession() {
  try { await api("GET", "/api/admin/me"); startBoard(); }
  catch { showLogin(); }
}
function showLogin() { $("#board-view").classList.add("hidden"); $("#login-view").classList.remove("hidden"); if (ws) { ws.close(); ws = null; } }
$("#login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("#login-error"); err.classList.add("hidden");
  try {
    await api("POST", "/api/admin/login", { username: $("#login-user").value, password: $("#login-pass").value });
    startBoard();
  } catch (ex) { err.textContent = ex.message; err.classList.remove("hidden"); }
});

// ───── Tablero ─────
async function startBoard() {
  $("#login-view").classList.add("hidden");
  $("#board-view").classList.remove("hidden");
  await loadOrders();
  connectWS();
}

async function loadOrders() {
  const list = await api("GET", "/api/kds/orders");
  orders.clear();
  for (const o of list) orders.set(o.id, o);
  render();
}

function upsertOrder(o) {
  if (["closed", "cancelled"].includes(o.status)) orders.delete(o.id);
  else orders.set(o.id, o);
  render();
}

function render() {
  const board = $("#board");
  const list = [...orders.values()].sort((a, b) => a.id - b.id);
  $("#order-count").textContent = list.length;
  $("#empty").classList.toggle("hidden", list.length > 0);
  board.innerHTML = list.map(cardHtml).join("");
}

function timeOf(s) { const m = String(s || "").match(/\d{2}:\d{2}/); return m ? m[0] : ""; }

function cardHtml(o) {
  const src = o.source === "kiosko"
    ? `🏪 Kiosko${o.mesa ? " · Mesa " + esc(o.mesa) : o.delivery_type === "para_llevar" ? " · Llevar" : ""}`
    : "🛵 Domicilio";

  let body;
  if (o.items && o.items.length) {
    body = `<div class="items">${o.items.map(i =>
      `<div class="item"><span class="q">${i.qty}×</span> ${esc(i.name_snapshot)}${i.notes ? `<span class="note">📝 ${esc(i.notes)}</span>` : ""}</div>`
    ).join("")}</div>`;
  } else if (o.ticket_text) {
    body = `<div class="items"><pre class="tt">${esc(o.ticket_text)}</pre></div>`;
  } else { body = ""; }

  const acts = (NEXT_ACTIONS[o.status] || [])
    .map(a => `<button class="act ${a.primary ? "primary" : ""}${a.ghost ? " ghost" : ""}" data-id="${o.id}" data-status="${a.s}">${a.t}</button>`)
    .join("");

  return `
    <div class="card" data-status="${o.status}">
      <div class="card-head">
        <span class="ticket">${esc(o.ticket_number || "#" + o.id)}</span>
        <span class="src">${src}</span>
      </div>
      <div class="meta">
        ${o.customer_name ? `<span>👤 <strong>${esc(o.customer_name)}</strong></span>` : ""}
        <span>🕒 ${timeOf(o.created_at)} · 💳 ${esc(o.payment_method || "—")}</span>
        ${o.address ? `<span>📍 ${esc(o.address)}</span>` : ""}
        <span class="status-pill ${o.status}">${STATUS_LABEL[o.status] || o.status}</span>
      </div>
      ${body}
      <div class="actions">${acts}</div>
    </div>`;
}

// Botones de estado
$("#board").addEventListener("click", async e => {
  const btn = e.target.closest(".act");
  if (!btn) return;
  const id = Number(btn.dataset.id), status = btn.dataset.status;
  if (status === "cancelled" && !confirm("¿Cancelar este pedido?")) return;
  btn.disabled = true;
  try {
    await api("POST", `/api/kds/orders/${id}/status`, { status });
    // El WS reflejará el cambio; si no llega, refrescamos.
  } catch (ex) { toast(ex.message, true); btn.disabled = false; }
});

// ───── WebSocket ─────
function connectWS() {
  if (ws) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);

  ws.onopen = () => { $("#conn").className = "conn on"; $("#conn").textContent = "●  en vivo"; };
  ws.onclose = () => {
    $("#conn").className = "conn off"; $("#conn").textContent = "●  reconectando…";
    ws = null;
    setTimeout(() => { if (!$("#board-view").classList.contains("hidden")) connectWS(); }, 2000);
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onmessage = ev => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.type === "order:new") { upsertOrder(m.payload); toast(`Nuevo pedido ${m.payload.ticket_number || ""}`); }
    else if (m.type === "order:status") { upsertOrder(m.payload); }
  };
}

checkSession();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/kds/sw.js").catch(() => {});
  });
}
