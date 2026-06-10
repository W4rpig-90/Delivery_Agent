/**
 * ops.routes.js — panel de operador: stats del VPS + gestión de instancias.
 * Monta en /api/ops. Auth separada vía OPS_PASSWORD (cookie ops_session).
 */

const express = require("express");
const http    = require("http");
const fs      = require("fs");
const path    = require("path");
const os      = require("os");
const crypto  = require("crypto");
const usersRepo    = require("../repositories/users.repo");
const { hashPassword } = require("../utils/password");

const router = express.Router();

// ─── Auth ──────────────────────────────────────────────────────────────────
const OPS_COOKIE = "ops_session";
const OPS_SECRET = process.env.SESSION_SECRET || "ops-secret-change-me";

function signSession(payload) {
  const data = JSON.stringify(payload);
  const sig  = crypto.createHmac("sha256", OPS_SECRET).update(data).digest("hex");
  return Buffer.from(data).toString("base64url") + "." + sig;
}

function verifySession(token) {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const b64 = token.slice(0, dot);
  const sig  = token.slice(dot + 1);
  try {
    const data     = Buffer.from(b64, "base64url").toString();
    const expected = crypto.createHmac("sha256", OPS_SECRET).update(data).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    return JSON.parse(data);
  } catch { return null; }
}

function parseCookies(str = "") {
  const out = {};
  for (const part of str.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    try { out[decodeURIComponent(part.slice(0, idx).trim())] = decodeURIComponent(part.slice(idx + 1).trim()); }
    catch {}
  }
  return out;
}

function requireOpsAuth(req, res, next) {
  const session = verifySession(parseCookies(req.headers.cookie)[OPS_COOKIE]);
  if (!session) return res.status(401).json({ error: "No autorizado" });
  req.opsUser = session;
  next();
}

// ─── Login / Logout / Me ───────────────────────────────────────────────────
router.post("/login", (req, res) => {
  const { password } = req.body || {};
  const OPS_PASSWORD = process.env.OPS_PASSWORD;
  if (!OPS_PASSWORD) return res.status(503).json({ error: "OPS_PASSWORD no configurado en el .env del servidor" });
  if (password !== OPS_PASSWORD) return res.status(401).json({ error: "Contraseña incorrecta" });
  const token = signSession({ role: "ops" });
  res.setHeader("Set-Cookie", `${OPS_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`);
  res.json({ ok: true });
});

router.post("/logout", (_req, res) => {
  res.setHeader("Set-Cookie", `${OPS_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
  res.json({ ok: true });
});

router.get("/me", requireOpsAuth, (_req, res) => res.json({ role: "ops" }));

// ─── Docker helper ─────────────────────────────────────────────────────────
function dockerRequest(method, apiPath, body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = http.request({
      socketPath: "/var/run/docker.sock",
      path: apiPath,
      method,
      headers: bodyStr
        ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) }
        : {},
    }, res => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ─── Stats del servidor ────────────────────────────────────────────────────
router.get("/server", requireOpsAuth, (req, res) => {
  try {
    // RAM — /proc/meminfo refleja la memoria del host en Docker sin namespace
    const mem = {};
    for (const line of fs.readFileSync("/proc/meminfo", "utf8").split("\n")) {
      const [k, v] = line.split(":");
      if (k && v) mem[k.trim()] = parseInt(v) * 1024; // kB → bytes
    }

    // Load average
    const lp = fs.readFileSync("/proc/loadavg", "utf8").trim().split(" ");
    const load = { one: parseFloat(lp[0]), five: parseFloat(lp[1]), fifteen: parseFloat(lp[2]) };

    // Uptime
    const uptime = parseFloat(fs.readFileSync("/proc/uptime", "utf8").split(" ")[0]);

    // Disco — /app/data está montado desde el host (mismo dispositivo)
    let disk = null;
    try {
      const st = fs.statfsSync("/app/data");
      disk = {
        total: st.bsize * st.blocks,
        free:  st.bsize * st.bfree,
        used:  st.bsize * (st.blocks - st.bfree),
      };
    } catch {}

    res.json({
      ram: {
        total: mem.MemTotal    || 0,
        used:  (mem.MemTotal   || 0) - (mem.MemAvailable || 0),
        free:  mem.MemAvailable || 0,
      },
      load,
      cpus: os.cpus().length,
      uptime,
      disk,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Lista de contenedores ─────────────────────────────────────────────────
router.get("/containers", requireOpsAuth, async (_req, res) => {
  try {
    const filter = encodeURIComponent(JSON.stringify({ label: ["donatto-bot=true"] }));
    const { body } = await dockerRequest("GET", `/containers/json?all=true&filters=${filter}`);
    if (!Array.isArray(body)) throw new Error("socket no disponible");
    const primary = process.env.BOT_SLUG || "donatto";
    res.json(body.map(c => ({
      id:         c.Id.slice(0, 12),
      name:       c.Labels?.["donatto-name"] || c.Names?.[0]?.replace("/", "") || "bot",
      status:     c.State,
      statusText: c.Status,
      ports:      (c.Ports || []).map(p => p.PublicPort).filter(Boolean),
      image:      c.Image,
      created:    c.Created,
      isPrimary:  (c.Labels?.["donatto-name"] || "") === primary,
    })));
  } catch {
    res.json([{
      id:        "local",
      name:      process.env.BOT_SLUG || "donatto",
      status:    "running",
      statusText:"Activo",
      ports:     [process.env.KIOSK_PORT || "3000"],
      image:     "donatto-resto-bar",
      created:   null,
      noSocket:  true,
      isPrimary: true,
    }]);
  }
});

// ─── Stats en tiempo real por contenedor ───────────────────────────────────
router.get("/stats", requireOpsAuth, async (_req, res) => {
  try {
    const filter = encodeURIComponent(JSON.stringify({ label: ["donatto-bot=true"] }));
    const { body: containers } = await dockerRequest("GET", `/containers/json?filters=${filter}`);
    if (!Array.isArray(containers)) return res.json([]);

    const stats = await Promise.all(containers.map(async c => {
      try {
        const { body: s } = await dockerRequest("GET", `/containers/${c.Id}/stats?stream=false`);
        const cpuDelta = (s.cpu_stats?.cpu_usage?.total_usage || 0) - (s.precpu_stats?.cpu_usage?.total_usage || 0);
        const sysDelta = (s.cpu_stats?.system_cpu_usage || 0) - (s.precpu_stats?.system_cpu_usage || 0);
        const numCpus  = s.cpu_stats?.online_cpus || s.cpu_stats?.cpu_usage?.percpu_usage?.length || 1;
        const cpuPct   = sysDelta > 0 ? (cpuDelta / sysDelta) * numCpus * 100 : 0;
        const nets     = Object.values(s.networks || {});
        return {
          name:      c.Labels?.["donatto-name"] || c.Names?.[0]?.replace("/", "") || "bot",
          cpu_pct:   Math.max(0, Math.round(cpuPct * 10) / 10),
          mem_used:  Math.max(0, (s.memory_stats?.usage || 0) - (s.memory_stats?.stats?.cache || 0)),
          mem_limit: s.memory_stats?.limit || 0,
          net_rx:    nets.reduce((a, n) => a + (n.rx_bytes || 0), 0),
          net_tx:    nets.reduce((a, n) => a + (n.tx_bytes || 0), 0),
        };
      } catch { return null; }
    }));
    res.json(stats.filter(Boolean));
  } catch { res.json([]); }
});

// ─── Config de instancia ───────────────────────────────────────────────────
const INSTANCES_DIR = path.resolve(__dirname, "../../data/instances");
if (!fs.existsSync(INSTANCES_DIR)) fs.mkdirSync(INSTANCES_DIR, { recursive: true });

function readConfig(name) {
  const p = path.join(INSTANCES_DIR, `${name}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}
function writeConfig(name, data) {
  fs.writeFileSync(path.join(INSTANCES_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

router.get("/instances", requireOpsAuth, async (_req, res) => {
  try {
    const files = fs.readdirSync(INSTANCES_DIR).filter(f => f.endsWith(".json"));
    const items = files.map(f => ({ name: f.replace(".json", ""), ...readConfig(f.replace(".json", "")) }));

    let runningSet = new Set();
    try {
      const filter = encodeURIComponent(JSON.stringify({ label: ["donatto-bot=true"] }));
      const { body } = await dockerRequest("GET", `/containers/json?all=true&filters=${filter}`);
      if (Array.isArray(body)) {
        for (const c of body) {
          if (c.State === "running" && c.Labels?.["donatto-name"]) runningSet.add(c.Labels["donatto-name"]);
        }
      }
    } catch {}

    res.json(items.map(i => ({ ...i, _running: runningSet.has(i.name) })));
  } catch { res.json([]); }
});

router.get("/instances/:name", requireOpsAuth, (req, res) => res.json(readConfig(req.params.name)));

router.put("/instances/:name", requireOpsAuth, (req, res) => {
  writeConfig(req.params.name, { ...readConfig(req.params.name), ...req.body });
  res.json({ ok: true });
});

// ─── Menú de instancia ────────────────────────────────────────────────────
router.get("/instances/:name/menu", requireOpsAuth, (req, res) => {
  const menuPath = path.join(INSTANCES_DIR, req.params.name, "data", "menu.json");
  if (!fs.existsSync(menuPath)) return res.json(null);
  try { res.json(JSON.parse(fs.readFileSync(menuPath, "utf8"))); }
  catch { res.status(400).json({ error: "menu.json inválido" }); }
});

router.put("/instances/:name/menu", requireOpsAuth, (req, res) => {
  const dir = path.join(INSTANCES_DIR, req.params.name, "data");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "menu.json"), JSON.stringify(req.body, null, 2));
  res.json({ ok: true });
});

// ─── Ciclo de vida de instancias ──────────────────────────────────────────

async function resolveHostDataPath() {
  try {
    const { body } = await dockerRequest("GET", `/containers/${os.hostname()}/json`);
    const m = (body.Mounts || []).find(m => m.Destination === "/app/data");
    return m?.Source || null;
  } catch { return null; }
}

async function deployInstanceContainer(slug, config) {
  const hostDataRoot = (await resolveHostDataPath()) || process.env.HOST_DATA_PATH || "/root/Delivery_Agent/data";
  const hostBase     = path.join(hostDataRoot, "instances", slug);
  const localBase    = path.resolve(__dirname, "../../data/instances", slug);

  for (const sub of ["data", ".wwebjs_auth", ".wwebjs_cache"])
    fs.mkdirSync(path.join(localBase, sub), { recursive: true });

  const containerName = `delivery-agent-${slug}`;
  const port          = String(config.KIOSK_PORT || "3001");

  try { await dockerRequest("POST", `/containers/${containerName}/stop`); } catch {}
  try { await dockerRequest("DELETE", `/containers/${containerName}?force=true`); } catch {}

  const reserved = new Set(["KIOSK_PORT", "BOT_SLUG"]);
  const envArr = Object.entries(config)
    .filter(([k, v]) => k === k.toUpperCase() && !reserved.has(k) && v != null && v !== "")
    .map(([k, v]) => `${k}=${v}`);
  envArr.push("KIOSK_PORT=3000", `BOT_SLUG=${slug}`);

  const { status, body: created } = await dockerRequest(
    "POST", `/containers/create?name=${containerName}`,
    {
      Image: "donatto-resto-bar:latest",
      Env: envArr,
      Labels: { "donatto-bot": "true", "donatto-name": slug },
      HostConfig: {
        PortBindings: { "3000/tcp": [{ HostIp: "127.0.0.1", HostPort: port }] },
        Binds: [
          `${hostBase}/data:/app/data`,
          `${hostBase}/.wwebjs_auth:/app/.wwebjs_auth`,
          `${hostBase}/.wwebjs_cache:/app/.wwebjs_cache`,
          `/var/run/docker.sock:/var/run/docker.sock`,
        ],
        RestartPolicy: { Name: "unless-stopped" },
        Init: true,
      },
      ExposedPorts: { "3000/tcp": {} },
    }
  );

  if (status >= 400) {
    const msg = typeof created === "string" ? created : (created?.message || JSON.stringify(created));
    throw new Error(msg);
  }
  await dockerRequest("POST", `/containers/${created.Id}/start`);
  return { containerName, port: Number(port) };
}

const CLONE_SENSITIVE_KEYS = new Set([
  "ANTHROPIC_API_KEY", "GEMINI_API_KEY", "GROQ_API_KEY", "OPENAI_API_KEY",
  "DEEPSEEK_API_KEY", "TOGETHER_API_KEY", "MISTRAL_API_KEY", "COHERE_API_KEY",
  "BOT_PHONE", "DISPATCH_NUMBER", "SESSION_SECRET", "ADMIN_INITIAL_PASSWORD",
  "KIOSK_PORT", "BRAND_NAME",
]);

router.post("/instances", requireOpsAuth, (req, res) => {
  const { slug, brandName, port, source } = req.body || {};
  if (!slug || !brandName) return res.status(400).json({ error: "slug y brandName requeridos" });
  if (!/^[a-z0-9][a-z0-9-]{0,29}$/.test(slug))
    return res.status(400).json({ error: "slug: solo minúsculas, dígitos y guiones (máx 30)" });

  const cfgPath = path.join(INSTANCES_DIR, `${slug}.json`);
  if (fs.existsSync(cfgPath)) return res.status(409).json({ error: "Ya existe una instancia con ese slug" });

  const usedPorts = new Set([Number(process.env.KIOSK_PORT) || 3000]);
  for (const f of fs.readdirSync(INSTANCES_DIR).filter(f => f.endsWith(".json"))) {
    const p = parseInt(readConfig(f.replace(".json", "")).KIOSK_PORT);
    if (p) usedPorts.add(p);
  }
  let assignedPort = port ? Number(port) : 3001;
  while (usedPorts.has(assignedPort)) assignedPort++;

  let config;
  if (source) {
    const srcCfg = readConfig(source);
    config = {};
    for (const [k, v] of Object.entries(srcCfg)) {
      if (!CLONE_SENSITIVE_KEYS.has(k)) config[k] = v;
    }
  } else {
    config = {
      WHATSAPP_LOCAL_ENABLED: "false",
      KIOSK_ENABLED:          "true",
      KIOSK_PAYMENTS:         "efectivo",
      TIMEZONE:               "America/Bogota",
    };
  }
  config.BRAND_NAME             = brandName;
  config.KIOSK_PORT             = String(assignedPort);
  config.SESSION_SECRET         = crypto.randomBytes(32).toString("hex");
  config.ADMIN_INITIAL_PASSWORD = "donatto2026";

  writeConfig(slug, config);

  // Copy source menu.json if cloning
  if (source) {
    const srcMenu = path.join(INSTANCES_DIR, source, "data", "menu.json");
    if (fs.existsSync(srcMenu)) {
      const destDir = path.join(INSTANCES_DIR, slug, "data");
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(srcMenu, path.join(destDir, "menu.json"));
    }
  }

  res.json({ ok: true, slug, port: assignedPort, deployed: false });
});

router.delete("/instances/:name", requireOpsAuth, async (req, res) => {
  const name    = req.params.name;
  const primary = process.env.BOT_SLUG || "donatto";
  if (name === primary) return res.status(403).json({ error: "No se puede eliminar la instancia primaria" });

  const containerName = `delivery-agent-${name}`;
  try { await dockerRequest("POST", `/containers/${containerName}/stop`); } catch {}
  try { await dockerRequest("DELETE", `/containers/${containerName}?force=true`); } catch {}

  const cfgPath = path.join(INSTANCES_DIR, `${name}.json`);
  if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);

  res.json({ ok: true });
});

router.post("/instances/:name/deploy", requireOpsAuth, async (req, res) => {
  const name   = req.params.name;
  const config = readConfig(name);
  if (!config.KIOSK_PORT) return res.status(400).json({ error: "Configura el puerto antes de desplegar" });
  try {
    const r = await deployInstanceContainer(name, config);
    res.json({ ok: true, ...r });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/containers/:name/restart", requireOpsAuth, async (req, res) => {
  const name = req.params.name;
  try {
    const filter = encodeURIComponent(JSON.stringify({ label: [`donatto-name=${name}`] }));
    const { body } = await dockerRequest("GET", `/containers/json?all=true&filters=${filter}`);
    if (!Array.isArray(body) || !body.length) return res.status(404).json({ error: "Contenedor no encontrado" });
    await dockerRequest("POST", `/containers/${body[0].Id}/restart`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Catálogo de modelos IA ────────────────────────────────────────────────
const AI_MODELS = [
  { category: "frontier",    provider: "Google",      name: "Gemini 2.0 Flash",   id: "gemini-2.0-flash",           key_var: "GEMINI_API_KEY",    key_url: "https://aistudio.google.com" },
  { category: "frontier",    provider: "Google",      name: "Gemini 1.5 Pro",     id: "gemini-1.5-pro",             key_var: "GEMINI_API_KEY",    key_url: "https://aistudio.google.com" },
  { category: "frontier",    provider: "Google",      name: "Gemini 1.5 Flash",   id: "gemini-1.5-flash",           key_var: "GEMINI_API_KEY",    key_url: "https://aistudio.google.com" },
  { category: "frontier",    provider: "Anthropic",   name: "Claude Sonnet 4.6",  id: "claude-sonnet-4-6",          key_var: "ANTHROPIC_API_KEY", key_url: "https://console.anthropic.com" },
  { category: "frontier",    provider: "Anthropic",   name: "Claude Haiku 4.5",   id: "claude-haiku-4-5-20251001",  key_var: "ANTHROPIC_API_KEY", key_url: "https://console.anthropic.com" },
  { category: "frontier",    provider: "Anthropic",   name: "Claude Opus 4.8",    id: "claude-opus-4-8",            key_var: "ANTHROPIC_API_KEY", key_url: "https://console.anthropic.com" },
  { category: "frontier",    provider: "OpenAI",      name: "GPT-4o",             id: "gpt-4o",                     key_var: "OPENAI_API_KEY",    key_url: "https://platform.openai.com" },
  { category: "frontier",    provider: "OpenAI",      name: "GPT-4o mini",        id: "gpt-4o-mini",                key_var: "OPENAI_API_KEY",    key_url: "https://platform.openai.com" },
  { category: "frontier",    provider: "Mistral AI",  name: "Mistral Large",      id: "mistral-large-latest",       key_var: "MISTRAL_API_KEY",   key_url: "https://console.mistral.ai" },
  { category: "frontier",    provider: "Mistral AI",  name: "Mistral Small",      id: "mistral-small-latest",       key_var: "MISTRAL_API_KEY",   key_url: "https://console.mistral.ai" },
  { category: "frontier",    provider: "Cohere",      name: "Command R+",         id: "command-r-plus",             key_var: "COHERE_API_KEY",    key_url: "https://dashboard.cohere.com" },
  { category: "open_source", provider: "Meta",        name: "Llama 3.3 70B",      id: "llama-3.3-70b-versatile",    key_var: "GROQ_API_KEY",      key_url: "https://console.groq.com",     via: "Groq" },
  { category: "open_source", provider: "Meta",        name: "Llama 3.1 8B",       id: "llama-3.1-8b-instant",       key_var: "GROQ_API_KEY",      key_url: "https://console.groq.com",     via: "Groq" },
  { category: "open_source", provider: "DeepSeek",    name: "DeepSeek V3",        id: "deepseek-chat",              key_var: "DEEPSEEK_API_KEY",  key_url: "https://platform.deepseek.com" },
  { category: "open_source", provider: "DeepSeek",    name: "DeepSeek R1",        id: "deepseek-reasoner",          key_var: "DEEPSEEK_API_KEY",  key_url: "https://platform.deepseek.com" },
  { category: "open_source", provider: "Alibaba",     name: "Qwen 2.5 72B",       id: "Qwen/Qwen2.5-72B-Instruct", key_var: "TOGETHER_API_KEY",  key_url: "https://api.together.ai",      via: "Together AI" },
  { category: "open_source", provider: "Microsoft",   name: "Phi-4",              id: "microsoft/Phi-4",            key_var: "TOGETHER_API_KEY",  key_url: "https://api.together.ai",      via: "Together AI" },
  { category: "open_source", provider: "Google",      name: "Gemma 2 9B",         id: "gemma2-9b-it",               key_var: "GROQ_API_KEY",      key_url: "https://console.groq.com",     via: "Groq" },
  { category: "open_source", provider: "Mistral AI",  name: "Mistral 7B",         id: "mistral-7b-instruct-v0.2",   key_var: "GROQ_API_KEY",      key_url: "https://console.groq.com",     via: "Groq" },
  { category: "open_source", provider: "Local",       name: "Ollama (local)",     id: "ollama",                     key_var: null,                key_url: "https://ollama.com",           via: "Ollama" },
];

router.get("/models", requireOpsAuth, (_req, res) => res.json(AI_MODELS));

// ─── Gestión de usuarios del panel admin ───────────────────────────────────

router.get("/users", requireOpsAuth, (_req, res) => {
  res.json(usersRepo.listUsers());
});

router.post("/users", requireOpsAuth, (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "usuario y contraseña requeridos" });
  if (!["admin", "operator"].includes(role)) return res.status(400).json({ error: "rol inválido (admin u operator)" });
  if (String(password).length < 6) return res.status(400).json({ error: "contraseña mínimo 6 caracteres" });
  if (usersRepo.userExists(String(username).trim())) return res.status(409).json({ error: "ese nombre de usuario ya existe" });
  const id = usersRepo.createUser({ username: String(username).trim(), passwordHash: hashPassword(String(password)), role });
  res.json({ ok: true, id });
});

router.put("/users/:id", requireOpsAuth, (req, res) => {
  const { password, role } = req.body || {};
  const id = Number(req.params.id);
  if (role !== undefined && !["admin", "operator"].includes(role)) {
    return res.status(400).json({ error: "rol inválido" });
  }
  if (password !== undefined && password !== "") {
    if (String(password).length < 6) return res.status(400).json({ error: "contraseña mínimo 6 caracteres" });
    usersRepo.updatePassword(id, hashPassword(String(password)));
  }
  if (role) usersRepo.setUserRole(id, role);
  res.json({ ok: true });
});

router.delete("/users/:id", requireOpsAuth, (req, res) => {
  const all = usersRepo.listUsers();
  const id = Number(req.params.id);
  const admins = all.filter(u => u.role === "admin");
  const target = all.find(u => u.id === id);
  if (target?.role === "admin" && admins.length <= 1) {
    return res.status(400).json({ error: "no se puede eliminar el último administrador" });
  }
  usersRepo.deleteUser(id);
  res.json({ ok: true });
});

module.exports = router;
