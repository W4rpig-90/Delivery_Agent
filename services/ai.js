/**
 * ai.js — Proveedor de IA unificado con configuración dinámica.
 *
 * Lee el modelo y las API keys desde data/instances/<BOT_SLUG>.json
 * en cada invocación, sin necesidad de reiniciar el bot.
 * Si el archivo no existe o un campo está vacío, hace fallback a process.env.
 *
 * Proveedores soportados:
 *   Gemini (Google)  · Claude (Anthropic)  · Groq  · DeepSeek
 *   Together AI      · Mistral AI          · OpenAI · Ollama (local)
 */

const fs   = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const INSTANCES_DIR = path.resolve(__dirname, "../data/instances");

// ─── Prompt del sistema ───────────────────────────────────────────────────
// Importado desde gemini.js para mantener consistencia mientras el sistema
// prompt no sea configurable por interfaz.
const { SYSTEM_PROMPT } = require("./gemini");

// ─── Config dinámica ──────────────────────────────────────────────────────
function getConfig() {
  const slug = process.env.BOT_SLUG || "donatto";
  const p    = path.join(INSTANCES_DIR, `${slug}.json`);
  let cfg    = {};
  try { if (fs.existsSync(p)) cfg = JSON.parse(fs.readFileSync(p, "utf8")); }
  catch {}

  const e = process.env;
  return {
    model:        cfg.AI_MODEL          || e.AI_MODEL          || "gemini-2.0-flash",
    geminiKey:    cfg.GEMINI_API_KEY    || e.GEMINI_API_KEY    || "",
    anthropicKey: cfg.ANTHROPIC_API_KEY || e.ANTHROPIC_API_KEY || "",
    groqKey:      cfg.GROQ_API_KEY      || e.GROQ_API_KEY      || "",
    openaiKey:    cfg.OPENAI_API_KEY    || e.OPENAI_API_KEY    || "",
    deepseekKey:  cfg.DEEPSEEK_API_KEY  || e.DEEPSEEK_API_KEY  || "",
    togetherKey:  cfg.TOGETHER_API_KEY  || e.TOGETHER_API_KEY  || "",
    mistralKey:   cfg.MISTRAL_API_KEY   || e.MISTRAL_API_KEY   || "",
    ollamaUrl:    cfg.OLLAMA_BASE_URL   || e.OLLAMA_BASE_URL   || "http://localhost:11434",
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────

// Convierte el historial interno [{role:"user"|"model", parts:[{text}]}]
// al formato OpenAI/Anthropic [{role:"user"|"assistant", content: string}]
function toMessages(history, userMessage) {
  const msgs = history.map(h => ({
    role:    h.role === "model" ? "assistant" : "user",
    content: h.parts.map(p => p.text).join(""),
  }));
  msgs.push({ role: "user", content: userMessage });
  return msgs;
}

// ─── Proveedor: Gemini ────────────────────────────────────────────────────
async function chatGemini(cfg, history, userMessage) {
  const genAI = new GoogleGenerativeAI(cfg.geminiKey);
  const model = genAI.getGenerativeModel({
    model: cfg.model,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { maxOutputTokens: 1024, temperature: 0.4 },
  });
  const session = model.startChat({ history });
  const result  = await session.sendMessage(userMessage);
  return result.response.text();
}

// ─── Proveedor: Anthropic (Claude) ───────────────────────────────────────
async function chatAnthropic(cfg, history, userMessage) {
  const messages = toMessages(history, userMessage);
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":          cfg.anthropicKey,
      "anthropic-version":  "2023-06-01",
      "content-type":       "application/json",
    },
    body: JSON.stringify({
      model:      cfg.model,
      max_tokens: 1024,
      system:     SYSTEM_PROMPT,
      messages,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.content[0].text;
}

// ─── Proveedor: OpenAI-compatible (Groq, DeepSeek, Together, Mistral, Ollama) ──
const GROQ_MODELS     = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "gemma2-9b-it", "mistral-7b-instruct-v0.2"];
const DEEPSEEK_MODELS = ["deepseek-chat", "deepseek-reasoner"];
const TOGETHER_MODELS = ["Qwen/Qwen2.5-72B-Instruct", "microsoft/Phi-4"];
const MISTRAL_MODELS  = ["mistral-large-latest", "mistral-small-latest"];

function resolveOpenAICompat(cfg) {
  const m = cfg.model;
  if (GROQ_MODELS.includes(m))     return { baseUrl: "https://api.groq.com/openai/v1",    key: cfg.groqKey };
  if (DEEPSEEK_MODELS.includes(m)) return { baseUrl: "https://api.deepseek.com/v1",        key: cfg.deepseekKey };
  if (TOGETHER_MODELS.includes(m)) return { baseUrl: "https://api.together.xyz/v1",        key: cfg.togetherKey };
  if (MISTRAL_MODELS.includes(m))  return { baseUrl: "https://api.mistral.ai/v1",          key: cfg.mistralKey };
  if (m === "gpt-4o" || m === "gpt-4o-mini") return { baseUrl: "https://api.openai.com/v1", key: cfg.openaiKey };
  if (m === "ollama")              return { baseUrl: `${cfg.ollamaUrl}/v1`,                 key: null };
  return                                  { baseUrl: "https://api.openai.com/v1",           key: cfg.openaiKey };
}

async function chatOpenAICompat(cfg, history, userMessage) {
  const { baseUrl, key } = resolveOpenAICompat(cfg);
  const modelId = cfg.model === "ollama"
    ? (process.env.OLLAMA_MODEL || "llama3")
    : cfg.model;

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...toMessages(history, userMessage),
  ];

  const headers = { "Content-Type": "application/json" };
  if (key) headers["Authorization"] = `Bearer ${key}`;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model: modelId, messages, max_tokens: 1024, temperature: 0.4 }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`AI API ${res.status}: ${t.slice(0, 300)}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// ─── Chat principal ───────────────────────────────────────────────────────
async function chat(history, userMessage) {
  const cfg = getConfig();
  const m   = cfg.model;

  console.log(`[AI] Proveedor: ${m}`);

  if (m.startsWith("claude-"))  return chatAnthropic(cfg, history, userMessage);
  if (m.startsWith("gemini-"))  return chatGemini(cfg, history, userMessage);
  return chatOpenAICompat(cfg, history, userMessage);
}

// ─── Audio (siempre usa Gemini — único proveedor con soporte nativo) ──────
async function chatWithAudio(history, audioBase64, mimeType) {
  const cfg = getConfig();

  if (!cfg.geminiKey) {
    return {
      transcription: "(nota de voz)",
      botResponse:   "Las notas de voz requieren una API key de Gemini configurada. Escribime tu mensaje 🙏",
    };
  }

  // Para audio usamos Gemini independientemente del modelo de texto configurado
  const audioModelId = cfg.model.startsWith("gemini-") ? cfg.model : "gemini-2.0-flash";
  const genAI = new GoogleGenerativeAI(cfg.geminiKey);
  const model = genAI.getGenerativeModel({
    model: audioModelId,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: { maxOutputTokens: 1024, temperature: 0.4 },
  });

  const chatSession = model.startChat({ history });
  const result = await chatSession.sendMessage([
    { inlineData: { mimeType: mimeType.split(";")[0].trim(), data: audioBase64 } },
    { text: "El cliente envió esta nota de voz. En la PRIMERA línea de tu respuesta escribí exactamente: [VOZ: <transcripción literal del audio>]. Luego respondé normalmente según el contenido del audio." },
  ]);

  const raw      = result.response.text();
  const vozMatch = raw.match(/^\[VOZ:\s*(.+?)\]/);
  return {
    transcription: vozMatch ? vozMatch[1].trim() : "(nota de voz)",
    botResponse:   raw.replace(/^\[VOZ:[^\]]*\]\s*/, "").trimStart(),
  };
}

module.exports = { chat, chatWithAudio };
