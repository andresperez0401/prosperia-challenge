import { AiProvider } from "./ai.interface.js";
import { MockAi } from "./ai.mock.js";
import { OpenAiProvider } from "./ai.openai.js";
import { DeepSeekProvider } from "./ai.deepseek.js";
import { FallbackAiProvider } from "./ai.fallback.js";

export function getAiProvider(): AiProvider {
  const provider = (process.env.AI_PROVIDER || "mock").toLowerCase();

  switch (provider) {
    case "openai":
      return new OpenAiProvider();
    case "deepseek":
      return new DeepSeekProvider();
    case "auto":
      // Automatic fallback: OpenAI → DeepSeek → Mock (retries at runtime)
      return new FallbackAiProvider();
    case "mock":
    default:
      return new MockAi();
  }
}
