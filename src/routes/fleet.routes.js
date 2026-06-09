/**
 * fleet.routes.js — gestión de instancias de bot en el VPS.
 * Monta en /api/admin/fleet (solo admin).
 *
 * Requiere que el contenedor tenga montado /var/run/docker.sock
 * y que cada bot corra con labels: donatto-bot=true, donatto-name=<slug>.
 */

const express = require("express");
const http    = require("http");
const fs      = require("fs");
const path    = require("path");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// ─── Directorio de configs por instancia ───────────────────────────────────
const INSTANCES_DIR = path.resolve(__dirname, "../../data/instances");
if (!fs.existsSync(INSTANCES_DIR)) fs.mkdirSync(INSTANCES_DIR, { recursive: true });

function readConfig(name) {
  const p = path.join(INSTANCES_DIR, `${name}.json`);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : {};
}
function writeConfig(name, data) {
  fs.writeFileSync(path.join(INSTANCES_DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

// ─── Catálogo de modelos IA ─────────────────────────────────────────────────
const AI_MODELS = [
  // Frontera (propietarios)
  { category: "frontier", provider: "Google",     name: "Gemini 2.0 Flash",     id: "gemini-2.0-flash",              key_var: "GEMINI_API_KEY",    key_url: "https://aistudio.google.com" },
  { category: "frontier", provider: "Google",     name: "Gemini 1.5 Pro",       id: "gemini-1.5-pro",                key_var: "GEMINI_API_KEY",    key_url: "https://aistudio.google.com" },
  { category: "frontier", provider: "Google",     name: "Gemini 1.5 Flash",     id: "gemini-1.5-flash",              key_var: "GEMINI_API_KEY",    key_url: "https://aistudio.google.com" },
  { category: "frontier", provider: "Anthropic",  name: "Claude Sonnet 4.6",    id: "claude-sonnet-4-6",             key_var: "ANTHROPIC_API_KEY", key_url: "https://console.anthropic.com" },
  { category: "frontier", provider: "Anthropic",  name: "Claude Haiku 4.5",     id: "claude-haiku-4-5-20251001",     key_var: "ANTHROPIC_API_KEY", key_url: "https://console.anthropic.com" },
  { category: "frontier", provider: "Anthropic",  name: "Claude Opus 4.8",      id: "claude-opus-4-8",               key_var: "ANTHROPIC_API_KEY", key_url: "https://console.anthropic.com" },
  { category: "frontier", provider: "OpenAI",     name: "GPT-4o",               id: "gpt-4o",                        key_var: "OPENAI_API_KEY",    key_url: "https://platform.openai.com" },
  { category: "frontier", provider: "OpenAI",     name: "GPT-4o mini",          id: "gpt-4o-mini",                   key_var: "OPENAI_API_KEY",    key_url: "https://platform.openai.com" },
  { category: "frontier", provider: "Mistral AI", name: "Mistral Large",        id: "mistral-large-latest",          key_var: "MISTRAL_API_KEY",   key_url: "https://console.mistral.ai" },
  { category: "frontier", provider: "Mistral AI", name: "Mistral Small",        id: "mistral-small-latest",          key_var: "MISTRAL_API_KEY",   key_url: "https://console.mistral.ai" },
  { category: "frontier", provider: "Cohere",     name: "Command R+",           id: "command-r-plus",                key_var: "COHERE_API_KEY",    key_url: "https://dashboard.cohere.com" },
  // Open source
  { category: "open_source", provider: "Meta",      name: "Llama 3.3 70B",     id: "llama-3.3-70b-versatile",       key_var: "GROQ_API_KEY",      key_url: "https://console.groq.com",    via: "Groq" },
  { category: "open_source", provider: "Meta",      name: "Llama 3.1 8B",      id: "llama-3.1-8b-instant",          key_var: "GROQ_API_KEY",      key_url: "https://console.groq.com",    via: "Groq" },
  { category: "open_source", provider: "DeepSeek",  name: "DeepSeek V3",       id: "deepseek-chat",                 key_var: "DEEPSEEK_API_KEY",  key_url: "https://platform.deepseek.com" },
  { category: "open_source", provider: "DeepSeek",  name: "DeepSeek R1",       id: "deepseek-reasoner",             key_var: "DEEPSEEK_API_KEY",  key_url: "https://platform.deepseek.com" },
  { category: "open_source", provider: "Alibaba",   name: "Qwen 2.5 72B",      id: "Qwen/Qwen2.5-72B-Instruct",    key_var: "TOGETHER_API_KEY",  key_url: "https://api.together.ai",     via: "Together AI" },
  { category: "open_source", provider: "Microsoft", name: "Phi-4",             id: "microsoft/Phi-4",               key_var: "TOGETHER_API_KEY",  key_url: "https://api.together.ai",     via: "Together AI" },
  { category: "open_source", provider: "Google",    name: "Gemma 2 9B",        id: "gemma2-9b-it",                  key_var: "GROQ_API_KEY",      key_url: "https://console.groq.com",    via: "Groq" },
  { category: "open_source", provider: "Mistral AI",name: "Mistral 7B",        id: "mistral-7b-instruct-v0.2",      key_var: "GROQ_API_KEY",      key_url: "https://console.groq.com",    via: "Groq" },
  { category: "open_source", provider: "Local",     name: "Ollama (local)",    id: "ollama",                        key_var: null,                key_url: "https://ollama.com",          via: "Ollama" },
];

router.get("/models", (_req, res) => res.json(AI_MODELS));

// ─── Docker socket helper ───────────────────────────────────────────────────
function dockerRequest(method, apiPath, body = null) {
  return new Promise((resolve, reject) => {
    const bodyStr = body ? JSON.stringify(body) : null;
    const req = http.request({
      socketPath: "/var/run/docker.sock",
      path: apiPath,
      method,
      headers: bodyStr ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(bodyStr) } : {},
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

// ─── Listar contenedores ────────────────────────────────────────────────────
router.get("/containers", async (_req, res) => {
  try {
    const filter = encodeURIComponent(JSON.stringify({ label: ["donatto-bot=true"] }));
    const { body } = await dockerRequest("GET", `/containers/json?all=true&filters=${filter}`);
    if (!Array.isArray(body)) throw new Error("respuesta inesperada del socket");

    const instances = body.map(c => ({
      id:         c.Id.slice(0, 12),
      name:       c.Labels?.["donatto-name"] || c.Names?.[0]?.replace("/", "") || "bot",
      status:     c.State,
      statusText: c.Status,
      ports:      c.Ports?.map(p => p.PublicPort).filter(Boolean) ?? [],
      image:      c.Image,
      created:    c.Created,
    }));
    res.json(instances);
  } catch {
    // Fallback: sin Docker socket — devuelve el bot actual como instancia única
    res.json([{
      id:         "local",
      name:       process.env.BRAND_NAME?.toLowerCase().replace(/\s+/g, "-") || "donatto",
      status:     "running",
      statusText: "Activo",
      ports:      [process.env.KIOSK_PORT || "3000"],
      image:      "donatto-resto-bar",
      created:    null,
      noSocket:   true,
    }]);
  }
});

// ─── Config de instancia ────────────────────────────────────────────────────
router.get("/instances/:name", (req, res) => res.json(readConfig(req.params.name)));

router.put("/instances/:name", (req, res) => {
  const cfg = { ...readConfig(req.params.name), ...req.body };
  writeConfig(req.params.name, cfg);
  res.json({ ok: true });
});

// ─── Reiniciar contenedor ───────────────────────────────────────────────────
router.post("/containers/:name/restart", async (req, res) => {
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

module.exports = router;
