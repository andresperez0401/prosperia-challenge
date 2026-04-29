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
    });
    return resp.data.choices[0].message.content as string;
  }

  // TODO: Implementar extracción de información con IA del rawText
  async structure(rawText: string): Promise<Partial<ParsedReceipt>> {
    const systemPrompt = `You are a receipt/invoice OCR parser. Extract ALL structured data from the receipt text — including handwritten or messy ones — and return ONLY valid JSON matching this exact schema (use null for missing fields, never omit keys):
{
  "amount": number | null,
  "subtotalAmount": number | null,
  "taxAmount": number | null,
  "taxPercentage": number | null,
  "type": "expense" | "income",
  "currency": "USD" | "EUR" | "COP" | "PEN" | "CLP" | "MXN" | "PAB" | "ARS" | "GBP" | null,
  "date": "YYYY-MM-DD" | null,
  "paymentMethod": "CARD" | "CASH" | "TRANSFER" | "OTHER" | null,
  "description": string | null,
  "invoiceNumber": string | null,
  "vendorName": string | null,
  "vendorIdentifications": string[],
  "customerName": string | null,
  "customerIdentifications": string[],
  "items": [{ "description": string, "quantity": number, "unitPrice": number, "total": number }]
}
Extraction rules:
- Monetary values: plain numbers only, no symbols, no thousands separators (e.g. 10000 not "$10,000").
- taxPercentage: number only (e.g. 21 for "IVA 21%", 0 for "Impuesto (0%)").
- currency: detect from unambiguous signals — € → "EUR", £ → "GBP", "EUR" keyword → "EUR", "USD" keyword → "USD", "MXN"/"México" → "MXN", "COP"/"Colombia" → "COP", "PEN"/"S/" → "PEN". If only "$" with no other context, use null so the system decides.
- paymentMethod: map keywords — tarjeta/card/visa/mastercard → "CARD", efectivo/cash → "CASH", transferencia/transfer/banco/wire → "TRANSFER". Others → "OTHER".
- VENDOR vs CUSTOMER — CRITICAL distinction:
  * vendorName = WHO ISSUES the receipt (the business/seller). Usually at the top, with the tax ID right after.
  * customerName = WHO RECEIVES the receipt (the buyer). Found AFTER labels like "Cliente:", "Bill to:", "Facturado a:", "Sr./Sra.".
  * vendorIdentifications = tax IDs of the SELLER only (the one near the top).
  * customerIdentifications = tax IDs of the BUYER only (inside the customer block).
  * Never mix the two. If unsure who is who, set customer fields to null/[].
- items: THIS IS CRITICAL — scan EVERY line of the receipt for product/service rows. A row usually has: description, quantity, unit price, total. Even if columns are misaligned by OCR, extract what you can. Example row "Nuggets veganos 2 $2000 $4000" → {"description":"Nuggets veganos","quantity":2,"unitPrice":2000,"total":4000}. If ANY items exist, populate the array. Do NOT return an empty array if there are product lines.
- For HANDWRITTEN or MESSY receipts: be tolerant of OCR errors. If a number reads "1OO" treat as "100"; "$" near digits implies a price. Do your best to interpret approximate text.
- invoiceNumber: look for Factura/Invoice/No./Nº/Número/Folio/Ref labels.
- description: one-sentence summary of what was purchased, or null.
- Return ONLY the JSON object, no markdown, no explanation.`;

    let content: string;
    try {
      content = await this.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: rawText.slice(0, 3000) },
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

    const systemPrompt = `You are an accounting classifier. Given receipt text, pick the BEST matching account from the list below.

Available accounts:
[
${accountList}
]

Rules:
- You MUST always pick one account — never return null or empty.
- Choose the most semantically appropriate account for the goods/services described.
- If uncertain, pick the closest match (e.g. "Alimentación" for any food/drink, "Mantenimiento" for repairs).

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
