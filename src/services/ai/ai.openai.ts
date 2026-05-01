import { AiProvider, StructureInput } from "./ai.interface.js";
import { ParsedReceipt } from "../../types/receipt.js";
import { prisma } from "../../db/client.js";
import { VALID_CURRENCIES } from "../parsing/detect.currency.js";
import { buildStructurePrompt, parseStructureJson } from "./prompt.js";
import axios from "axios";

export class OpenAiProvider implements AiProvider {
  private baseUrl: string;
  private token: string;

  constructor() {
    this.baseUrl = process.env.OPENAI_BASE_URL || "http://localhost:8080";
    this.token = process.env.PROSPERIA_TOKEN || "";
  }

  private async chat(
    messages: { role: string; content: string }[],
    responseFormat?: object,
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      model: "gpt-4o-mini",
      messages,
      temperature: 0,
    };
    if (responseFormat) payload.response_format = responseFormat;

    const resp = await axios.post(`${this.baseUrl}/openai/chat`, payload, {
      headers: { "X-Prosperia-Token": this.token },
      timeout: 15000,
    });
    return resp.data.choices[0].message.content as string;
  }

  async structure(input: StructureInput): Promise<Partial<ParsedReceipt>> {
    const { systemPrompt, userContent } = buildStructurePrompt(input);

    let content: string;
    try {
      content = await this.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        { type: "json_object" },
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("AI structure request failed:", msg);
      throw new Error(`OpenAI request failed: ${msg}`);
    }

    return parseStructureJson(content, input.accounts ?? [], VALID_CURRENCIES);
  }

  /** @deprecated structure() now also returns `category`. Kept as fallback path. */
  async categorize(input: {
    rawText: string;
    items?: ParsedReceipt["items"];
    vendorName?: string | null;
  }): Promise<Partial<ParsedReceipt>> {
    let accounts: { id: number; name: string; type: string }[] = [];
    try {
      accounts = await prisma.account.findMany({ select: { id: true, name: true, type: true } });
    } catch (err) {
      console.error("AI categorize: failed to load accounts:", err instanceof Error ? err.message : err);
      return {};
    }

    const accountList = accounts
      .map((a) => `${a.id}:${a.name}`)
      .join(", ");

    const systemPrompt = `Pick ONE account id from: [${accountList}].
Return JSON: {"accountId": <number>}.`;

    const ctxParts: string[] = [];
    if (input.vendorName) ctxParts.push(`Vendor: ${input.vendorName}`);
    if (input.items?.length) ctxParts.push(`Items: ${input.items.map((i) => i.description).join(", ")}`);
    ctxParts.push(input.rawText.slice(0, 800));

    let content: string;
    try {
      content = await this.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: ctxParts.join("\n") },
        ],
        { type: "json_object" },
      );
    } catch (err) {
      console.error("AI categorize request failed:", err instanceof Error ? err.message : err);
      return {};
    }

    try {
      const parsed = JSON.parse(content);
      const rawId = parsed.accountId;
      const accountId =
        typeof rawId === "number" ? rawId :
          typeof rawId === "string" && /^\d+$/.test(rawId.trim()) ? parseInt(rawId.trim(), 10) :
            null;
      const match = accounts.find((a) => a.id === accountId);
      return match ? { category: match.id } : {};
    } catch {
      return {};
    }
  }
}
