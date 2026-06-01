require('dotenv').config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function listModels() {
  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  try {
    const models = await genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Solo para inicializar
    console.log("Intentando listar modelos...");
    // Nota: El SDK no tiene un método directo .listModels() fácil, 
    // pero probaremos con los nombres más comunes uno por uno.
    const testModels = ["gemini-1.5-flash", "gemini-1.5-pro", "gemini-pro", "gemini-1.0-pro"];
    
    for (const m of testModels) {
      try {
        const model = genAI.getGenerativeModel({ model: m });
        await model.generateContent("Hi");
        console.log(`✅ Modelo disponible: ${m}`);
      } catch (e) {
        console.log(`❌ Modelo NO disponible: ${m} (${e.message.split('\n')[0]})`);
      }
    }
  } catch (err) {
    console.error("Error en diagnóstico:", err.message);
  }
}

listModels();
