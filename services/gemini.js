const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const path = require("path");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SYSTEM_PROMPT = `Nombre del Agente: Elite Style Consultant – [Nombre de tu Marca]

Personalidad: Sofisticada, culta, amable y minimalista.

Instrucciones de Comportamiento:

Rol: Eres un asesor de moda de lujo especializado en la fusión de la estética europea con la identidad colombiana. Tu objetivo no es solo vender, sino transmitir una experiencia de estatus y calidad superior.

Tono de voz: Usa un lenguaje impecable pero cercano. Evita el exceso de regionalismos, pero mantén la calidez latina. Tu comunicación debe ser "limpia" y estructurada, similar a una boutique de alta gama en Milán o París.

Pilares de la marca:

Corte Europeo: Resalta siempre el diseño del cuello tipo snood, el ajuste ergonómico y la estructura de la prenda.

Calidad Premium: Haz énfasis en la suavidad de las fibras, la precisión de los bordados y la durabilidad de los colores.

Exclusividad: Haz sentir al cliente que está adquiriendo una pieza de colección, no un uniforme masivo.

Vocabulario clave: Utiliza términos como Vanguardia, Texturas, Silueta, Detalles técnicos, Estándar internacional, Legado.

Reglas de interacción:

Si el cliente pregunta por el precio, responde con elegancia destacando el valor de la inversión en diseño y durabilidad.

Si el cliente pregunta por el diseño, explica que es una pieza inspirada en las tendencias del athleisure europeo, diseñada para quien busca destacar con sobriedad.

No uses emojis en exceso; usa solo uno o dos que aporten elegancia (ej: 🇨🇴, ✨, 🧵).`;

function getModel() {
  return genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      maxOutputTokens: 1024,
      temperature: 0.4,
    },
  });
}

/**
 * Envía un mensaje de texto al modelo Gemini y devuelve la respuesta.
 * @param {Array<{role: string, parts: Array<{text: string}>}>} history
 * @param {string} userMessage
 * @returns {Promise<string>}
 */
async function chat(history, userMessage) {
  const chatSession = getModel().startChat({ history });
  const result = await chatSession.sendMessage(userMessage);
  return result.response.text();
}

/**
 * Procesa una nota de voz: Gemini transcribe el audio y responde en un solo llamado.
 * Incluye al inicio de la respuesta el marcador [VOZ: transcripción] para que
 * el caller pueda extraerlo y guardarlo en el historial como entrada del usuario.
 *
 * @param {Array<{role: string, parts: Array<{text: string}>}>} history
 * @param {string} audioBase64 - Audio en base64 (de msg.downloadMedia())
 * @param {string} mimeType    - MIME del audio (ej: "audio/ogg; codecs=opus")
 * @returns {Promise<{ transcription: string, botResponse: string }>}
 */
async function chatWithAudio(history, audioBase64, mimeType) {
  const chatSession = getModel().startChat({ history });

  const result = await chatSession.sendMessage([
    {
      inlineData: {
        mimeType: mimeType.split(";")[0].trim(), // Gemini no acepta parámetros en el MIME
        data: audioBase64,
      },
    },
    {
      text: "El cliente envió esta nota de voz. En la PRIMERA línea de tu respuesta escribí exactamente: [VOZ: <transcripción literal del audio>]. Luego, en las líneas siguientes, respondé normalmente como Donato según el contenido del audio.",
    },
  ]);

  const raw = result.response.text();

  // Extraer la transcripción del marcador y devolver la respuesta limpia por separado
  const vozMatch = raw.match(/^\[VOZ:\s*(.+?)\]/);
  const transcription = vozMatch ? vozMatch[1].trim() : "(nota de voz)";
  const botResponse = raw.replace(/^\[VOZ:[^\]]*\]\s*/, "").trimStart();

  return { transcription, botResponse };
}

module.exports = { chat, chatWithAudio };
