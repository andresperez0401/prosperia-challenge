import "dotenv/config";
import { OpenAiProvider } from "../src/services/ai/ai.openai.js";

async function run() {
  const ai = new OpenAiProvider();
  console.log("Testing OpenAI provider...");
  try {
    const result = await ai.structure({
      rawText: "Factura de prueba\nTotal: $100.00\nIVA: $16.00",
      accounts: [{ id: 1, name: "General", type: "expense" }]
    });
    console.log("Result:", result);
  } catch (err) {
    console.error("Fatal Error:", err);
  }
}

run();
