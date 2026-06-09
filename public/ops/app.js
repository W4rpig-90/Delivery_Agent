// ═══════════ Delivery Agent · Ops Dashboard ═══════════
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
);

// ─── API ──────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: {} };
  if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res  = await fetch("/api/ops" + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ─── UI helpers ───────────────────────────────────────
function toast(msg, isErr) {
  const t = $("#toast");
  t.textContent = msg;
  t.className = "toast" + (isErr ? " err" : "");
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2800);
}

function openModal(title, html) {
  $("#modal-title").textContent = title;
  $("#modal-body").innerHTML = html;
  $("#modal").classList.remove("hidden");
  document.querySelector(".modal-card").classList.remove("wide");
}
function closeModal() { $("#modal").classList.add("hidden"); }

function tsNow() {
  return new Date().toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ─── Session ──────────────────────────────────────────
async function checkSession() {
  try { await api("GET", "/me"); showDashboard(); }
  catch { showLogin(); }
}

function showLogin() {
  $("#login-view").classList.remove("hidden");
  $("#app-view").classList.add("hidden");
  stopPollers();
}

function showDashboard() {
  $("#login-view").classList.add("hidden");
  $("#app-view").classList.remove("hidden");
  startPollers();
}

$("#login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const err = $("#login-error");
  err.classList.add("hidden");
  try {
    await api("POST", "/login", { password: $("#login-pass").value });
    showDashboard();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.remove("hidden");
  }
});

// ─── Pollers ──────────────────────────────────────────
let _serverTimer = null;
let _statsTimer  = null;
let _botsTimer   = null;
let _models      = [];

function startPollers() {
  loadAll();
  _serverTimer = setInterval(loadServer,    10_000);
  _statsTimer  = setInterval(loadStats,     10_000);
  _botsTimer   = setInterval(loadContainers, 30_000);
}

function stopPollers() {
  [_serverTimer, _statsTimer, _botsTimer].forEach(t => t && clearInterval(t));
  _serverTimer = _statsTimer = _botsTimer = null;
}

async function loadAll() {
  await Promise.all([loadServer(), loadModels(), loadContainersAndStats()]);
}

async function loadModels() {
  try { _models = await api("GET", "/models"); } catch {}
}

// ─── Server stats ─────────────────────────────────────
function fmtBytes(b, dec = 1) {
  if (!b) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (b >= 1024 && i < units.length - 1) { b /= 1024; i++; }
  return b.toFixed(dec) + " " + units[i];
}

function fmtUptime(s) {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function gaugeCls(pct) {
  return pct > 85 ? "danger" : pct > 70 ? "warn" : "";
}

function statCard(label, value, sub, pct) {
  const cls = gaugeCls(pct);
  const w   = Math.min(Math.max(pct, 0), 100);
  return `
  <div class="stat-card">
    <div class="stat-lbl">${label}</div>
    <div class="stat-val">${value}</div>
    <div class="stat-sub">${sub}</div>
    <div class="gauge"><div class="gauge-fill ${cls}" style="width:${w}%"></div></div>
  </div>`;
}

function statCardPlain(label, value, sub) {
  return `
  <div class="stat-card">
    <div class="stat-lbl">${label}</div>
    <div class="stat-val">${value}</div>
    <div class="stat-sub">${sub}</div>
  </div>`;
}

async function loadServer() {
  try {
    const s = await api("GET", "/server");

    const ramPct  = s.ram.total ? Math.round(s.ram.used / s.ram.total * 100) : 0;
    const loadNorm = s.cpus ? Math.round(s.load.one / s.cpus * 100) : 0;

    let html = "";
    html += statCard(
      "RAM",
      `${ramPct}%`,
      `${fmtBytes(s.ram.used)} / ${fmtBytes(s.ram.total)}`,
      ramPct
    );
    html += statCard(
      "CPU Load (1m)",
      s.load.one.toFixed(2),
      `5m: ${s.load.five.toFixed(2)} &nbsp;·&nbsp; 15m: ${s.load.fifteen.toFixed(2)} &nbsp;·&nbsp; ${s.cpus} cores`,
      loadNorm
    );
    if (s.disk) {
      const diskPct = s.disk.total ? Math.round(s.disk.used / s.disk.total * 100) : 0;
      html += statCard(
        "Disco",
        `${diskPct}%`,
        `${fmtBytes(s.disk.used)} / ${fmtBytes(s.disk.total)}`,
        diskPct
      );
    }
    html += statCardPlain("Uptime", fmtUptime(s.uptime), "desde el último reinicio del VPS");

    $("#stats-grid").innerHTML = html;
    $("#stats-ts").textContent = `Actualizado ${tsNow()}`;
  } catch (err) {
    $("#stats-grid").innerHTML = `<div class="stat-placeholder">Error: ${esc(err.message)}</div>`;
  }
}

// ─── Containers + per-bot stats ───────────────────────
let _containers = [];
let _statsMap   = {};

async function loadContainersAndStats() {
  await Promise.all([loadContainers(), loadStats()]);
}

async function loadContainers() {
  try {
    _containers = await api("GET", "/containers");
    renderBots();
    $("#bots-ts").textContent = `Actualizado ${tsNow()}`;
  } catch {}
}

async function loadStats() {
  try {
    const stats = await api("GET", "/stats");
    _statsMap = Object.fromEntries(stats.map(s => [s.name, s]));
    renderBots();
  } catch {}
}

const SC = { running: "on", exited: "off", paused: "warn", restarting: "warn" };
const SL = { running: "Activo", exited: "Detenido", paused: "Pausado", restarting: "Reiniciando" };

function renderBots() {
  if (!_containers.length) {
    $("#bots-grid").innerHTML = `<div class="stat-placeholder">No se encontraron instancias de bot.</div>`;
    return;
  }
  $("#bots-grid").innerHTML = _containers.map(c => botCard(c)).join("");
}

function botCard(c) {
  const s   = _statsMap[c.name];
  const sc  = SC[c.status] || "off";
  const sl  = SL[c.status] || c.statusText || c.status;
  const port = c.ports.length ? c.ports[0] : "—";

  const cpuPct = s ? Math.min(s.cpu_pct, 100) : 0;
  const memPct = (s && s.mem_limit > 0) ? Math.round(s.mem_used / s.mem_limit * 100) : 0;

  const metricsHtml = s ? `
    <div class="metrics">
      <div class="metric">
        <div class="metric-hd"><span>CPU</span><span>${s.cpu_pct}%</span></div>
        <div class="metric-bar">
          <div class="metric-bar-fill ${gaugeCls(cpuPct)}" style="width:${cpuPct}%"></div>
        </div>
      </div>
      <div class="metric">
        <div class="metric-hd">
          <span>RAM</span>
          <span>${fmtBytes(s.mem_used)} / ${fmtBytes(s.mem_limit)}</span>
        </div>
        <div class="metric-bar">
          <div class="metric-bar-fill ${gaugeCls(memPct)}" style="width:${memPct}%"></div>
        </div>
      </div>
      <div class="net-row">
        <span title="Red recibido">&#8595; ${fmtBytes(s.net_rx)}</span>
        <span title="Red enviado">&#8593; ${fmtBytes(s.net_tx)}</span>
      </div>
    </div>` : "";

  return `
  <div class="bot-card">
    <div class="bot-head">
      <div class="bot-avatar">&#127829;</div>
      <div>
        <div class="bot-name">${esc(c.name)}</div>
        <div class="bot-meta">
          <span class="badge ${sc}">${sl}</span>
          <span>:${esc(String(port))}</span>
        </div>
      </div>
    </div>
    ${metricsHtml}
    <div class="bot-actions">
      <button class="btn-primary" data-cfg="${esc(c.name)}">Configurar</button>
      <button class="btn-sec" data-restart="${esc(c.name)}"
        ${c.noSocket ? "disabled title='Docker socket no disponible'" : ""}>Reiniciar</button>
    </div>
  </div>`;
}

// ─── Config modal ─────────────────────────────────────
async function openConfig(name) {
  const [cfg] = await Promise.all([
    api("GET", `/instances/${name}`).catch(() => ({})),
  ]);
  const models = _models.length
    ? _models
    : await api("GET", "/models").catch(() => []);
  if (models.length) _models = models;

  const frontier    = models.filter(m => m.category === "frontier");
  const open_source = models.filter(m => m.category === "open_source");

  const sel   = models.find(m => m.id === cfg.AI_MODEL) || models[0] || {};
  const keyVar = sel.key_var || "";

  const modelOpts = `
    <optgroup label="── Frontera (propietarios) ──">
      ${frontier.map(m => `
        <option value="${esc(m.id)}"
          data-key="${esc(m.key_var || "")}"
          data-url="${esc(m.key_url || "")}"
          data-via="${esc(m.via || "")}"
          ${cfg.AI_MODEL === m.id ? "selected" : ""}>
          ${esc(m.provider)} · ${esc(m.name)}
        </option>`).join("")}
    </optgroup>
    <optgroup label="── Open Source ──">
      ${open_source.map(m => `
        <option value="${esc(m.id)}"
          data-key="${esc(m.key_var || "")}"
          data-url="${esc(m.key_url || "")}"
          data-via="${esc(m.via || "")}"
          ${cfg.AI_MODEL === m.id ? "selected" : ""}>
          ${esc(m.provider)} · ${esc(m.name)}${m.via ? " (" + m.via + ")" : ""}
        </option>`).join("")}
    </optgroup>`;

  openModal(`Configuración: ${name}`, `
    <div class="cfg-section">
      <div class="cfg-title">Identidad</div>
      <label>Nombre del negocio
        <input id="cfg-brand" value="${esc(cfg.BRAND_NAME || "")}" placeholder="Mi Restaurante" />
      </label>
      <div class="cfg-row">
        <label>Nombre del bot
          <input id="cfg-bot-name" value="${esc(cfg.BOT_NAME || "")}" placeholder="Bot" />
        </label>
        <label>Teléfono del bot
          <input id="cfg-bot-phone" value="${esc(cfg.BOT_PHONE || "")}" placeholder="573200000000" />
        </label>
      </div>
      <div class="cfg-row">
        <label>Puerto
          <input id="cfg-port" type="number" value="${esc(cfg.KIOSK_PORT || "3000")}" />
        </label>
        <label>Zona horaria
          <input id="cfg-tz" value="${esc(cfg.TIMEZONE || "America/Bogota")}" />
        </label>
      </div>
    </div>

    <div class="cfg-section">
      <div class="cfg-title">WhatsApp</div>
      <label>Número de despacho (cocina)
        <input id="cfg-dispatch" value="${esc(cfg.DISPATCH_NUMBER || "")}" placeholder="573100000000" />
      </label>
      <label style="flex-direction:row;align-items:center;gap:8px;margin-top:4px">
        <input id="cfg-wa-enabled" type="checkbox" style="width:auto"
          ${cfg.WHATSAPP_LOCAL_ENABLED === "true" ? "checked" : ""} />
        Bot WhatsApp habilitado en este servidor
      </label>
    </div>

    <div class="cfg-section">
      <div class="cfg-title">Inteligencia Artificial</div>
      <label>Modelo
        <select id="cfg-ai-model" onchange="onModelChange(this)">${modelOpts}</select>
      </label>
      <div id="cfg-ai-key-wrap" ${!keyVar ? "style='display:none'" : ""}>
        <label id="cfg-ai-key-label">${esc(keyVar)}${sel.via ? " · vía " + sel.via : ""}
          <input id="cfg-ai-key" type="password"
            value="${esc(cfg[keyVar] || "")}" placeholder="API Key" autocomplete="off" />
        </label>
        <div class="model-key-hint">
          Obtener clave: <a href="${esc(sel.key_url || "")}" target="_blank" rel="noopener">${esc(sel.key_url || "")}</a>
        </div>
      </div>
      <div id="cfg-ollama-wrap" style="display:none">
        <label>Ollama Base URL
          <input id="cfg-ollama-url" value="${esc(cfg.OLLAMA_BASE_URL || "http://localhost:11434")}" />
        </label>
      </div>
    </div>

    <div class="cfg-section">
      <div class="cfg-title">Kiosko</div>
      <label style="flex-direction:row;align-items:center;gap:8px">
        <input id="cfg-kiosk-enabled" type="checkbox" style="width:auto"
          ${cfg.KIOSK_ENABLED !== "false" ? "checked" : ""} />
        Kiosko habilitado
      </label>
      <label>Métodos de pago (separados por coma)
        <input id="cfg-payments" value="${esc(cfg.KIOSK_PAYMENTS || "efectivo")}"
          placeholder="efectivo,qr_transferencia" />
      </label>
      <label>Webhook n8n (notificaciones)
        <input id="cfg-n8n" value="${esc(cfg.KIOSK_N8N_WEBHOOK_URL || "")}" placeholder="https://..." />
      </label>
    </div>

    <div class="cfg-section">
      <div class="cfg-title">Impresora POS (opcional)</div>
      <div class="cfg-row">
        <label>IP
          <input id="cfg-printer-ip" value="${esc(cfg.PRINTER_IP || "")}" placeholder="192.168.1.100" />
        </label>
        <label>Puerto
          <input id="cfg-printer-port" type="number" value="${esc(cfg.PRINTER_PORT || "9100")}" />
        </label>
      </div>
    </div>

    <div class="modal-actions">
      <button class="btn-sec" data-action="close-modal">Cancelar</button>
      <button class="btn-primary" data-save="${esc(name)}">Guardar configuración</button>
    </div>
  `);

  document.querySelector(".modal-card").classList.add("wide");
}

function onModelChange(sel) {
  const opt      = sel.options[sel.selectedIndex];
  const keyVar   = opt.dataset.key;
  const keyUrl   = opt.dataset.url;
  const keyVia   = opt.dataset.via;
  const isOllama = sel.value === "ollama";

  const keyWrap    = $("#cfg-ai-key-wrap");
  const ollamaWrap = $("#cfg-ollama-wrap");
  const keyLabel   = $("#cfg-ai-key-label");
  const hint       = keyWrap?.querySelector(".model-key-hint a");

  keyWrap.style.display    = (!isOllama && keyVar) ? "" : "none";
  ollamaWrap.style.display = isOllama ? "" : "none";

  if (keyLabel && keyVar) {
    keyLabel.childNodes[0].textContent = `${keyVar}${keyVia ? " · vía " + keyVia : ""} `;
  }
  if (hint && keyUrl) { hint.href = keyUrl; hint.textContent = keyUrl; }
}

async function saveConfig(name) {
  const sel      = $("#cfg-ai-model");
  const opt      = sel?.options[sel.selectedIndex];
  const keyVar   = opt?.dataset.key || "";
  const aiModel  = sel?.value || "";
  const isOllama = aiModel === "ollama";

  const payload = {
    BRAND_NAME:             ($("#cfg-brand")?.value || "").trim(),
    BOT_NAME:               ($("#cfg-bot-name")?.value || "").trim(),
    BOT_PHONE:              ($("#cfg-bot-phone")?.value || "").trim(),
    KIOSK_PORT:             ($("#cfg-port")?.value || "3000").trim(),
    TIMEZONE:               ($("#cfg-tz")?.value || "America/Bogota").trim(),
    DISPATCH_NUMBER:        ($("#cfg-dispatch")?.value || "").trim(),
    WHATSAPP_LOCAL_ENABLED: String(!!$("#cfg-wa-enabled")?.checked),
    AI_MODEL:               aiModel,
    KIOSK_ENABLED:          String(!!$("#cfg-kiosk-enabled")?.checked),
    KIOSK_PAYMENTS:         ($("#cfg-payments")?.value || "efectivo").trim(),
    KIOSK_N8N_WEBHOOK_URL:  ($("#cfg-n8n")?.value || "").trim(),
    PRINTER_IP:             ($("#cfg-printer-ip")?.value || "").trim(),
    PRINTER_PORT:           ($("#cfg-printer-port")?.value || "9100").trim(),
  };

  if (isOllama) {
    payload.OLLAMA_BASE_URL = ($("#cfg-ollama-url")?.value || "").trim();
  } else if (keyVar) {
    const v = ($("#cfg-ai-key")?.value || "").trim();
    if (v) payload[keyVar] = v;
  }

  try {
    await api("PUT", `/instances/${name}`, payload);
    closeModal();
    toast(`"${name}" configurado ✓`);
  } catch (ex) { toast(ex.message, true); }
}

async function restartBot(name) {
  if (!confirm(`¿Reiniciar el bot "${name}"? Tardará unos segundos en volver.`)) return;
  try {
    await api("POST", `/containers/${name}/restart`);
    toast(`"${name}" reiniciando…`);
    setTimeout(loadContainersAndStats, 4000);
  } catch (ex) { toast(ex.message, true); }
}

// ─── Event delegation ─────────────────────────────────
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-action],[data-cfg],[data-restart],[data-save]");
  if (!t) return;
  const d = t.dataset;

  if (d.action === "logout") {
    await api("POST", "/logout").catch(() => {});
    showLogin();
    return;
  }
  if (d.action === "close-modal") return closeModal();
  if (d.cfg)     return openConfig(d.cfg);
  if (d.restart) return restartBot(d.restart);
  if (d.save)    return saveConfig(d.save);
});

checkSession();
