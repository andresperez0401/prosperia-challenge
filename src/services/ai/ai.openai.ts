import { AiProvider } from "./ai.interface.js";
import { ParsedReceipt } from "../../types/receipt.js";
import { prisma } from "../../db/client.js";
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

  async structure(input: {
    rawText: string;
    reconstructedText?: string;
    partialFields?: Partial<ParsedReceipt>;
    warnings?: string[];
  }): Promise<Partial<ParsedReceipt>> {
    const systemPrompt = `You are a highly advanced receipt/invoice OCR parser. Extract ALL structured data from the receipt text — including handwritten, messy, or poorly OCR'd text — and return ONLY valid JSON matching this exact schema (use null for missing fields, never omit keys):
{
  "amount": number | null,
  "subtotalAmount": number | null,
  "taxAmount": number | null,
  "taxPercentage": number | null,
  "type": "expense" | "income",
  "currency": "USD" | "EUR" | "COP" | "PEN" | "CLP" | "MXN" | "PAB" | "ARS" | "GBP" | "VES" | null,
  "date": "YYYY-MM-DD" | null,
  "paymentMethod": "CARD" | "CASH" | "TRANSFER" | "OTHER" | null,
  "description": string | null,
  "invoiceNumber": string | null,
  "vendorName": string | null,
  "vendorIdentifications": string[],
  "customerName": string | null,
  "customerIdentifications": string[],
  "items": [{ "description": string, "quantity": number, "unitPrice": number, "total": number }],
  "extraFields": { "type": "object", "description": "Key-value pairs of any other interesting data found (e.g. address, phone, cashier name, terminal, etc)" }
}
Extraction rules:
- You will receive the raw text, reconstructed text, and fields already extracted by rules.
- DO NOT overwrite already extracted fields unless they are obviously wrong or incomplete.
- Fill in any missing (null) fields.
- Monetary values: return as plain javascript numbers with '.' as decimal separator. You MUST parse comma/dot formats correctly (e.g. "15.212,97" → 15212.97, "9,652.21" → 9652.21). Remove ALL currency symbols.
- taxPercentage: number only (e.g. 16 for "IVA 16%").
- currency: CRITICAL — if ANY amount in the text uses the "Bs" or "Bs." prefix, ALWAYS return "VES". NEVER return "EUR" unless you see the literal "€" symbol or the word "EUR" in the text. Do not guess.
- date: OCR frequently splits dates across lines. If you see "FECHA:" or "Fecha:" near fragments like "04" on one line and "11-2025" on the next, reconstruct as "2025-11-04". Always output "YYYY-MM-DD" or null. Combine all nearby numeric fragments.
- subtotalAmount / taxAmount: If no explicit SUBTOTAL/IVA label is present but items are listed with individual prices — compute subtotalAmount = sum(item totals). If a tax rate appears (e.g. "IVA 16%"), set taxAmount = subtotalAmount * 0.16. If no rate found but total > subtotalAmount, set taxAmount = total - subtotalAmount. Do NOT leave both null when product lines exist.
- paymentMethod: map keywords.
- VENDOR vs CUSTOMER — CRITICAL distinction.
- items: THIS IS CRITICAL — scan EVERY line of the receipt for product/service rows. Do NOT return an empty array if there are any products listed.
- extraFields: Scan the text for ANY other useful information. Examples: "Dirección", "Teléfono", "Cajero", "Terminal", "Nº de Autorización", "Email", "Sitio Web", "Caja". Return them as descriptive keys in Spanish (e.g. { "Dirección": "Av Principal 123", "Cajero": "Juan Perez" }). Do NOT include fields that already exist in the base schema.
- Return ONLY the JSON object, no markdown, no explanation.`;

    const userContent = JSON.stringify({
      rawText: input.rawText.slice(0, 12000),
      reconstructedText: input.reconstructedText?.slice(0, 12000),
      alreadyExtracted: input.partialFields || {},
      warnings: input.warnings || []
    }, null, 2) + "\n\n(Bypass cache: " + Date.now() + ")";

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
      console.error("AI structure request failed:", err instanceof Error ? err.message : err);
      return {};
    }

    try {
      const parsed = JSON.parse(content);
      const validPaymentMethods = ["CARD", "CASH", "TRANSFER", "OTHER"];
      return {
        amount: typeof parsed.amount === "number" ? parsed.amount : null,
        subtotalAmount: typeof parsed.subtotalAmount === "number" ? parsed.subtotalAmount : null,
        taxAmount: typeof parsed.taxAmount === "number" ? parsed.taxAmount : null,
        taxPercentage: typeof parsed.taxPercentage === "number" ? parsed.taxPercentage : null,
        type: parsed.type === "income" ? "income" : "expense",
        currency: typeof parsed.currency === "string" ? parsed.currency : null,
        date: typeof parsed.date === "string" ? parsed.date : null,
        paymentMethod: validPaymentMethods.includes(parsed.paymentMethod) ? parsed.paymentMethod : null,
        description: typeof parsed.description === "string" ? parsed.description : null,
        invoiceNumber: typeof parsed.invoiceNumber === "string" ? parsed.invoiceNumber : null,
        vendorName: typeof parsed.vendorName === "string" ? parsed.vendorName : null,
        vendorIdentifications: Array.isArray(parsed.vendorIdentifications)
          ? parsed.vendorIdentifications.filter((x: unknown) => typeof x === "string")
          : [],
        customerName: typeof parsed.customerName === "string" ? parsed.customerName : null,
        customerIdentifications: Array.isArray(parsed.customerIdentifications)
          ? parsed.customerIdentifications.filter((x: unknown) => typeof x === "string")
          : [],
        items: Array.isArray(parsed.items) ? parsed.items : [],
        extraFields: typeof parsed.extraFields === "object" && parsed.extraFields !== null ? parsed.extraFields : {},
      };
    } catch {
      console.error("AI structure: failed to parse JSON response:", content?.slice(0, 200));
      return {};
    }
  }

  // TODO: Implementar categorize con openAI para que retorne la categoria/cuenta
  // a la que la factura debería ir destinada
  async categorize(input: {
    rawText: string;
    items?: ParsedReceipt["items"];
  }): Promise<Partial<ParsedReceipt>> {
    // Cargar cuentas de la DB para pasarlas como enum válido a la IA
    let accounts: { id: number; name: string; type: string }[] = [];
    try {
      accounts = await prisma.account.findMany({ select: { id: true, name: true, type: true } });
    } catch (err) {
      console.error("AI categorize: failed to load accounts:", err instanceof Error ? err.message : err);
      return {};
    }

    const accountList = accounts
      .map((a) => `  { "id": ${a.id}, "name": "${a.name}", "type": "${a.type}" }`)
      .join(",\n");

    const systemPrompt = `You are an expert accounting classifier. Given the receipt text, vendor name, and purchased items, pick the BEST matching account from the list below.

Available accounts:
[
${accountList}
]

Rules:
- You MUST always pick exactly ONE account — never return null or empty.
- Choose the most semantically appropriate account for the goods/services described.
- Consider the vendor name and the items to determine the category (e.g., clothing stores -> "Ropa/Vestimenta", supermarkets -> "Alimentación", hardware stores -> "Mantenimiento").
- If uncertain, pick the closest match. Look for keywords in the raw text if items are missing.

Return ONLY this JSON (no markdown, no explanation):
{"accountId": <number>, "accountName": "<name>"}

Both fields are required.`;

    // Construir contexto compacto para el categorizador (vendorName + items + texto)
    const ctxParts: string[] = [];
    if ((input as { vendorName?: string | null }).vendorName) {
      ctxParts.push(`Vendor: ${(input as { vendorName?: string | null }).vendorName}`);
    }
    if (input.items && input.items.length > 0) {
      ctxParts.push(`Items: ${input.items.map((i) => i.description).join(", ")}`);
    }
    ctxParts.push(input.rawText.slice(0, 1000));
    const userContent = ctxParts.join("\n");

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
      console.error("AI categorize request failed:", err instanceof Error ? err.message : err);
      return {};
    }

    try {
      const parsed = JSON.parse(content);

      // Aceptar accountId como número o string numérico
      const rawId = parsed.accountId;
      const accountId =
        typeof rawId === "number" ? rawId :
        typeof rawId === "string" && /^\d+$/.test(rawId.trim()) ? parseInt(rawId.trim(), 10) :
        null;

      // Primero buscar por ID exacto
      let match = accounts.find((a) => a.id === accountId);

      // Fallback: buscar por nombre si el AI devolvió accountName
      if (!match && typeof parsed.accountName === "string") {
        const nameNorm = parsed.accountName.toLowerCase().trim();
        match = accounts.find((a) => a.name.toLowerCase().includes(nameNorm) || nameNorm.includes(a.name.toLowerCase()));
      }

      if (!match) {
        console.warn("AI categorize: no valid account found, ID:", rawId, "Name:", parsed.accountName);
        return {};
      }
      return { category: match.id };
    } catch {
      console.error("AI categorize: failed to parse JSON response:", content?.slice(0, 200));
      return {};
    }
  }
}
