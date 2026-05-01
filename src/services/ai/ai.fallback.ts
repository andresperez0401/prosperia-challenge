import { AiProvider, StructureInput } from "./ai.interface.js";
import { ParsedReceipt } from "../../types/receipt.js";
import { OpenAiProvider } from "./ai.openai.js";
import { DeepSeekProvider } from "./ai.deepseek.js";
import { MockAi } from "./ai.mock.js";
import { logger } from "../../config/logger.js";

/** Chain of providers: try OpenAI → DeepSeek → Mock. Automatic fallback on errors. */
export class FallbackAiProvider implements AiProvider {
  private providers: AiProvider[] = [];

  constructor() {
    // Order matters: first provider is primary, last is always-available fallback
    try {
      this.providers.push(new OpenAiProvider());
    } catch (e) {
      logger.warn("OpenAI provider not available");
    }

    try {
      this.providers.push(new DeepSeekProvider());
    } catch (e) {
      logger.warn("DeepSeek provider not available");
    }

    // Mock always available
    this.providers.push(new MockAi());
  }

  async structure(input: StructureInput): Promise<Partial<ParsedReceipt>> {
    const warnings: string[] = [];
    for (let i = 0; i < this.providers.length; i++) {
      try {
        const result = await this.providers[i].structure(input);
        if (Object.keys(result).length > 0) {
          if (i > 0) {
            logger.info(`AI structure: using provider ${i + 1} (primary failed)`);
          }
          // Inject metadata so receipts.service.ts can read it
          (result as any)._aiProviderUsed = this.providers[i].constructor.name;
          if (warnings.length > 0) {
            (result as any)._aiWarnings = warnings;
          }
          return result;
        }
      } catch (err) {
        const name = this.providers[i].constructor.name;
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`${name}: ${msg}`);
        logger.warn({ msg: `${name}.structure failed`, error: msg });
        continue;
      }
    }
    return {
      // @ts-ignore
      _aiProviderUsed: "None (All Failed)",
      _aiWarnings: warnings
    };
  }

  async categorize(input: {
    rawText: string;
    items?: ParsedReceipt["items"];
    vendorName?: string | null;
  }): Promise<Partial<ParsedReceipt>> {
    for (let i = 0; i < this.providers.length; i++) {
      try {
        const result = await this.providers[i].categorize(input);
        if (Object.keys(result).length > 0) {
          if (i > 0) {
            logger.info(`AI categorize: using provider ${i + 1} (primary failed)`);
          }
          return result;
        }
      } catch (err) {
        const name = this.providers[i].constructor.name;
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn({ msg: `${name}.categorize failed`, error: msg });
        if (i === this.providers.length - 1) throw err;
        continue;
      }
    }
    return {};
  }
}
