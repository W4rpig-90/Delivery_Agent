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
let _instances  = [];

async function loadContainersAndStats() {
  await Promise.all([loadContainers(), loadStats()]);
}

async function loadContainers() {
  try {
    [_containers, _instances] = await Promise.all([
      api("GET", "/containers"),
      api("GET", "/instances").catch(() => []),
    ]);
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
  const drafts = _instances.filter(i => !i._running);
  if (!_containers.length && !drafts.length) {
    $("#bots-grid").innerHTML = `<div class="stat-placeholder">No se encontraron instancias de bot.</div>`;
    return;
  }
  $("#bots-grid").innerHTML = [
    ..._containers.map(c => botCard(c)),
    ...drafts.map(i => draftCard(i)),
  ].join("");
}

function botCard(c) {
  const s    = _statsMap[c.name];
  const sc   = SC[c.status] || "off";
  const sl   = SL[c.status] || c.statusText || c.status;
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
        <div class="bot-name">${esc(c.name)}${c.isPrimary ? ' <span style="font-size:11px;font-weight:400;color:var(--soft)">(principal)</span>' : ""}</div>
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
      <button class="btn-sec" data-clone="${esc(c.name)}">Clonar</button>
      ${!c.isPrimary ? `<button class="btn-sec" style="color:#e05;border-color:#e05" data-del-inst="${esc(c.name)}">Eliminar</button>` : ""}
    </div>
  </div>`;
}

function draftCard(inst) {
  return `
  <div class="bot-card" style="border-style:dashed;opacity:0.85">
    <div class="bot-head">
      <div class="bot-avatar">&#127829;</div>
      <div>
        <div class="bot-name">${esc(inst.name)} <span style="font-size:11px;font-weight:400;color:var(--soft)">(sin desplegar)</span></div>
        <div class="bot-meta">
          <span class="badge warn">Configurado</span>
          <span>:${esc(String(inst.KIOSK_PORT || "—"))}</span>
        </div>
      </div>
    </div>
    <div class="bot-actions">
      <button class="btn-primary" data-cfg="${esc(inst.name)}" data-draft="true">Configurar</button>
      <button class="btn-primary" data-deploy-inst="${esc(inst.name)}" style="background:var(--green,#1a7a4a)">&#9654; Desplegar</button>
      <button class="btn-sec" style="color:#e05;border-color:#e05" data-del-inst="${esc(inst.name)}">Eliminar</button>
    </div>
  </div>`;
}

// ─── Clone modal ──────────────────────────────────────
function openCloneModal(sourceName) {
  openModal("Nueva instancia", `
    <p style="font-size:13px;color:var(--soft);margin-bottom:16px">
      Crea un clon independiente de <strong>${esc(sourceName)}</strong> con su propia
      base de datos, menú y configuración.
    </p>
    <label>Nombre del negocio
      <input id="clone-brand" placeholder="El Vegetariano" autofocus />
    </label>
    <label>Slug (identificador único, sin espacios)
      <input id="clone-slug" placeholder="mi-restaurante" />
    </label>
    <label>Puerto del host (vacío = automático)
      <input id="clone-port" type="number" placeholder="auto" min="1024" max="65535" />
    </label>
    <p style="font-size:12px;color:var(--soft);margin-top:4px">
      Una vez creada, abre el panel Admin de la nueva instancia para ajustar el menú y los datos del negocio.
    </p>
    <div class="modal-actions">
      <button class="btn-sec" data-action="close-modal">Cancelar</button>
      <button class="btn-primary" id="do-clone-btn" data-source="${esc(sourceName)}">Crear instancia</button>
    </div>
  `);
}

async function doClone(sourceName) {
  const brand = ($("#clone-brand")?.value || "").trim();
  const slug  = ($("#clone-slug")?.value || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/^-+|-+$/g, "");
  const port  = parseInt($("#clone-port")?.value) || undefined;
  if (!brand || !slug) { toast("Nombre y slug son obligatorios", true); return; }

  const btn = $("#do-clone-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Creando…"; }
  try {
    const r = await api("POST", "/instances", { slug, brandName: brand, port, source: sourceName });
    closeModal();
    toast(`"${brand}" creada — configúrala y luego despliégala ✓`);
    setTimeout(loadContainersAndStats, 1000);
  } catch (ex) {
    toast(ex.message, true);
    if (btn) { btn.disabled = false; btn.textContent = "Crear instancia"; }
  }
}

async function deleteInstance(name) {
  if (!confirm(`¿Eliminar la instancia "${name}"?\n\nSe detendrá el contenedor y se borrará su configuración.\nLos datos (base de datos, imágenes) quedarán en el servidor.`)) return;
  try {
    await api("DELETE", `/instances/${name}`);
    toast(`Instancia "${name}" eliminada`);
    loadContainersAndStats();
  } catch (ex) { toast(ex.message, true); }
}

async function deployInstance(name) {
  if (!confirm(`¿Desplegar la instancia "${name}"?\nSe creará el contenedor Docker y arrancará en el puerto configurado.`)) return;
  try {
    const r = await api("POST", `/instances/${name}/deploy`);
    toast(`"${name}" desplegado en puerto ${r.port} ✓`);
    setTimeout(loadContainersAndStats, 4000);
  } catch (ex) { toast(ex.message, true); }
}

// ─── Config modal ─────────────────────────────────────
let _lastConfigName = null;
let _lastConfigIsPrimary = true;

async function openConfig(name, isPrimary) {
  _lastConfigName    = name;
  _lastConfigIsPrimary = isPrimary !== false;
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

    <div class="cfg-section">
      <div class="cfg-title" style="display:flex;justify-content:space-between;align-items:center">
        Usuarios del panel Admin
        <button class="btn-sec" style="flex:none;padding:4px 10px;font-size:12px" data-action="new-user">+ Nuevo usuario</button>
      </div>
      <div id="cfg-users-list" style="margin-top:8px"><em style="font-size:13px;color:var(--soft)">Cargando…</em></div>
    </div>

    ${!_lastConfigIsPrimary ? `
    <div class="cfg-section">
      <div class="cfg-title" style="display:flex;justify-content:space-between;align-items:center">
        Menú (JSON)
        <button class="btn-sec" style="flex:none;padding:4px 10px;font-size:12px" data-action="load-menu">Cargar menú actual</button>
      </div>
      <p style="font-size:12px;color:var(--soft);margin:4px 0 8px">
        Pega aquí el JSON del menú antes de desplegar. Formato: <code>{"categorias":[...]}</code>
      </p>
      <textarea id="cfg-menu-json" rows="8" style="font-family:monospace;font-size:12px;resize:vertical"
        placeholder='{"categorias": [...]}'></textarea>
    </div>` : ""}

    <div class="modal-actions">
      <button class="btn-sec" data-action="close-modal">Cancelar</button>
      <button class="btn-primary" data-save="${esc(name)}">Guardar configuración</button>
      ${!_lastConfigIsPrimary ? `<button class="btn-primary" data-deploy="${esc(name)}" style="background:var(--green,#1a7a4a)">Guardar y reiniciar</button>` : ""}
    </div>
  `);

  document.querySelector(".modal-card").classList.add("wide");
  renderUsersInModal();
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

async function loadMenuIntoModal(name) {
  const ta = $("#cfg-menu-json");
  if (!ta) return;
  ta.value = "Cargando…";
  try {
    const menu = await api("GET", `/instances/${name}/menu`);
    ta.value = menu ? JSON.stringify(menu, null, 2) : "";
  } catch { ta.value = ""; }
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
    toast(`"${name}" configurado ✓`);
    return true;
  } catch (ex) { toast(ex.message, true); return false; }
}

async function deployConfig(name) {
  // 1. Guardar config
  const ok = await saveConfig(name);
  if (!ok) return;

  // 2. Guardar menú si hay contenido en el textarea
  const ta = $("#cfg-menu-json");
  if (ta && ta.value.trim()) {
    try {
      const menu = JSON.parse(ta.value.trim());
      await api("PUT", `/instances/${name}/menu`, menu);
    } catch {
      toast("El JSON del menú es inválido — se guardó la config pero no se actualizó el menú", true);
      return;
    }
  }

  // 3. Desplegar contenedor
  const btn = $(`[data-deploy="${name}"]`);
  if (btn) { btn.disabled = true; btn.textContent = "Desplegando…"; }
  try {
    const r = await api("POST", `/instances/${name}/deploy`);
    closeModal();
    toast(`"${name}" desplegado en puerto ${r.port} ✓`);
    setTimeout(loadContainersAndStats, 4000);
  } catch (ex) {
    toast(ex.message, true);
    if (btn) { btn.disabled = false; btn.textContent = "Guardar y reiniciar"; }
  }
}

async function restartBot(name) {
  if (!confirm(`¿Reiniciar el bot "${name}"? Tardará unos segundos en volver.`)) return;
  try {
    await api("POST", `/containers/${name}/restart`);
    toast(`"${name}" reiniciando…`);
    setTimeout(loadContainersAndStats, 4000);
  } catch (ex) { toast(ex.message, true); }
}

// ─── Usuarios del panel Admin ─────────────────────────

async function renderUsersInModal() {
  const el = $("#cfg-users-list");
  if (!el) return;
  try {
    const users = await api("GET", "/users");
    if (!users.length) {
      el.innerHTML = '<p style="font-size:13px;color:var(--soft)">Sin usuarios. Crea el primero.</p>';
      return;
    }
    el.innerHTML = `
      <table class="users-table">
        <thead><tr><th>Usuario</th><th>Rol</th><th></th></tr></thead>
        <tbody>${users.map(u => `<tr>
          <td><strong>${esc(u.username)}</strong></td>
          <td><span class="ubadge ${u.role === "admin" ? "ubadge-admin" : "ubadge-op"}">
            ${u.role === "admin" ? "Administrador" : "Operador"}
          </span></td>
          <td class="user-actions">
            <button class="btn-sec btn-sm" data-edit-user="${u.id}"
              data-username="${esc(u.username)}" data-role="${esc(u.role)}">Editar</button>
            <button class="btn-sec btn-sm danger" data-del-user="${u.id}"
              data-username="${esc(u.username)}">Borrar</button>
          </td>
        </tr>`).join("")}</tbody>
      </table>`;
  } catch (ex) {
    el.innerHTML = `<p style="font-size:13px;color:var(--soft)">Error: ${esc(ex.message)}</p>`;
  }
}

function openNewUserModal() {
  openModal("Nuevo usuario", `
    <label>Nombre de usuario<input id="f-u-name" placeholder="operador1" autocomplete="off" /></label>
    <label>Contraseña (mín. 6 caracteres)<input id="f-u-pass" type="password" autocomplete="new-password" /></label>
    <label>Rol
      <select id="f-u-role">
        <option value="operator">Operador — gestión de pedidos + WhatsApp</option>
        <option value="admin">Administrador — acceso completo</option>
      </select>
    </label>
    <div class="modal-actions">
      <button class="btn-sec" data-action="back-to-cfg">← Volver</button>
      <button class="btn-primary" data-action="save-new-user">Crear usuario</button>
    </div>`);
}

function openEditUserModal(id, username, role) {
  openModal(`Editar: ${username}`, `
    <p style="font-size:13px;color:#6b6b70;margin-bottom:12px">Deja la contraseña vacía para no cambiarla.</p>
    <label>Nueva contraseña<input id="f-u-pass" type="password" autocomplete="new-password" placeholder="(sin cambios)" /></label>
    <label>Rol
      <select id="f-u-role">
        <option value="operator" ${role === "operator" ? "selected" : ""}>Operador — gestión de pedidos + WhatsApp</option>
        <option value="admin" ${role === "admin" ? "selected" : ""}>Administrador — acceso completo</option>
      </select>
    </label>
    <div class="modal-actions">
      <button class="btn-sec" data-action="back-to-cfg">← Volver</button>
      <button class="btn-primary" data-save-user="${id}">Guardar cambios</button>
    </div>`);
}

async function createUser() {
  const username = $("#f-u-name")?.value?.trim();
  const password = $("#f-u-pass")?.value;
  const role     = $("#f-u-role")?.value;
  if (!username || !password) { toast("Usuario y contraseña requeridos", true); return; }
  try {
    await api("POST", "/users", { username, password, role });
    toast(`Usuario "${username}" creado ✓`);
    if (_lastConfigName) openConfig(_lastConfigName);
  } catch (ex) { toast(ex.message, true); }
}

async function saveUser(id) {
  const password = $("#f-u-pass")?.value;
  const role     = $("#f-u-role")?.value;
  const body = { role };
  if (password) body.password = password;
  try {
    await api("PUT", `/users/${id}`, body);
    toast("Usuario actualizado ✓");
    // Go back to config modal (re-open last config)
    if (_lastConfigName) openConfig(_lastConfigName);
  } catch (ex) { toast(ex.message, true); }
}

async function deleteUser(id, username) {
  if (!confirm(`¿Eliminar al usuario "${username}"? Esta acción no se puede deshacer.`)) return;
  try {
    await api("DELETE", `/users/${id}`);
    toast(`"${username}" eliminado`);
    renderUsersInModal();
  } catch (ex) { toast(ex.message, true); }
}

// ─── Event delegation ─────────────────────────────────
document.addEventListener("click", async e => {
  const t = e.target.closest("[data-action],[data-cfg],[data-restart],[data-save],[data-deploy],[data-deploy-inst],[data-clone],[data-del-inst],[data-save-user],[data-edit-user],[data-del-user],[data-source]");
  if (!t) return;
  const d = t.dataset;

  if (d.action === "logout")        { await api("POST", "/logout").catch(() => {}); showLogin(); return; }
  if (d.action === "close-modal")   return closeModal();
  if (d.action === "back-to-cfg")   return _lastConfigName ? openConfig(_lastConfigName, _lastConfigIsPrimary) : closeModal();
  if (d.action === "new-user")      return openNewUserModal();
  if (d.action === "save-new-user") return createUser();
  if (d.action === "new-instance")  return openCloneModal("donatto");
  if (d.action === "load-menu")     return loadMenuIntoModal(_lastConfigName);

  if (d.cfg) {
    const container = _containers.find(c => c.name === d.cfg);
    const isPrimary = container ? container.isPrimary !== false : false;
    return openConfig(d.cfg, isPrimary);
  }
  if (d.restart)    return restartBot(d.restart);
  if (d.save)       { await saveConfig(d.save); closeModal(); return; }
  if (d.deploy)     return deployConfig(d.deploy);
  if (d.deployInst) return deployInstance(d.deployInst);
  if (d.clone)      return openCloneModal(d.clone);
  if (d.source)     return doClone(d.source);
  if (d.delInst)    return deleteInstance(d.delInst);
  if (d.saveUser)   return saveUser(d.saveUser);
  if (d.editUser)   return openEditUserModal(d.editUser, d.username, d.role);
  if (d.delUser)    return deleteUser(d.delUser, d.username);
});

checkSession();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/ops/sw.js").catch(() => {});
  });
}
