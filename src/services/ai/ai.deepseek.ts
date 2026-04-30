import { AiProvider } from "./ai.interface.js";
import { ParsedReceipt } from "../../types/receipt.js";
import { prisma } from "../../db/client.js";
import { VALID_CURRENCIES } from "../parsing/detect.currency.js";
import axios from "axios";

export class DeepSeekProvider implements AiProvider {
  private apiKey: string;

  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY || "";
    if (!this.apiKey) throw new Error("DEEPSEEK_API_KEY not configured");
  }

  private async chat(
    messages: { role: string; content: string }[],
    responseFormat?: object,
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      model: "deepseek-chat",
      messages,
      temperature: 0,
    };
    if (responseFormat) payload.response_format = responseFormat;

    const resp = await axios.post("https://api.deepseek.com/chat/completions", payload, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });
    return resp.data.choices[0].message.content as string;
  }

  async structure(input: {
    rawText: string;
    reconstructedText?: string;
    partialFields?: Partial<ParsedReceipt>;
    warnings?: string[];
    totalCandidates?: { label: string; value: number }[];
    labeledFields?: Record<string, string>;
  }): Promise<Partial<ParsedReceipt>> {
    const systemPrompt = `You are a highly advanced receipt/invoice OCR parser. Extract ALL structured data from the receipt text — including handwritten, messy, folded, or poorly OCR'd text — and return ONLY valid JSON matching this exact schema (use null for missing fields, never omit keys):
{
  "amount": number | null,
  "subtotalAmount": number | null,
  "taxAmount": number | null,
  "taxPercentage": number | null,
  "type": "expense" | "income",
  "currency": "USD" | "EUR" | "COP" | "PEN" | "CLP" | "MXN" | "PAB" | "ARS" | "VES" | null,
  "date": "YYYY-MM-DD" | null,
  "paymentMethod": "CARD" | "CASH" | "TRANSFER" | "OTHER" | null,
  "description": string | null,
  "invoiceNumber": string | null,
  "vendorName": string | null,
  "vendorIdentifications": string[],
  "customerName": string | null,
  "customerIdentifications": string[],
  "items": [{ "description": string, "quantity": number, "unitPrice": number, "total": number }],
  "extraFields": {}
}
You receive:
- rawText / reconstructedText: full OCR output — primary source of truth.
- labeledFields: key→value pairs found by regex label-matching (Emisor:, Cliente:, RUC:, etc.). HIGH CONFIDENCE — use directly for vendor/customer when present.
- totalCandidates: all lines containing "total" with extracted amounts — use to pick the correct final amount.
- rulesExtracted: fields already extracted by regex rules — use as hints, verify against rawText.

Extraction rules:
- Monetary values: return as plain javascript numbers with '.' as decimal separator. Parse comma/dot formats correctly (e.g. "15.212,97" → 15212.97, "9,652.21" → 9652.21). Remove ALL currency symbols.
- taxPercentage: number only (e.g. 16 for "IVA 16%"). Use 0 for exempt invoices.
- ZERO TAX — CRITICAL: If the invoice shows "EXENTO", "SIN IVA", "0%", "ITBMS 0%", "libre de impuesto", or if total == subtotal with NO tax label anywhere, return taxAmount: 0 and taxPercentage: 0. NEVER invent tax by computing (total - subtotal) unless the receipt explicitly shows a tax line (IVA, ITBMS, VAT, Impuesto). If there is no tax indicator whatsoever, set taxAmount: 0.
- subtotalAmount: If items are listed, compute subtotalAmount = sum(item totals). If an explicit tax rate exists, taxAmount = subtotalAmount * rate. If no tax label exists at all, taxAmount = 0.
- currency — STRICT rules, only these values allowed: VES, USD, EUR, COP, MXN, ARS, CLP, PAB, PEN.
  * "Bs" or "Bs." prefix → VES (Venezuelan bolívar)
  * "ITBMS", "B/.", "PAB", "Panamá"/"Panama" → PAB (Panamanian balboa)
  * "€" or "EUR" literal → EUR
  * "COP" or "Colombia" → COP
  * "MXN" or "México"/"Mexico" → MXN
  * "ARS" or "Argentina" → ARS
  * "CLP" or "Chile" → CLP
  * "PEN" or "S/." → PEN
  * "$" alone or "USD" → USD
  * NEVER return any other currency code. If unsure, return null.
- date: OCR splits dates across lines. If you see "FECHA:" near fragments like "04" then "11-2025" on the next line, reconstruct as "2025-11-04". Always output "YYYY-MM-DD" or null.
- amount — CRITICAL SELECTION LOGIC: You will receive a "totalCandidates" array with ALL lines containing the word "total" and their extracted amounts. Use these along with the full OCR text to determine the correct final amount. Rules for picking:
  1. Prefer lines labeled: "TOTAL A PAGAR", "TOTAL FACTURA", "MONTO TOTAL", "TOTAL GENERAL", "NETO A PAGAR", "GRAND TOTAL", "AMOUNT DUE", "TOTAL DUE" — these are the final customer-pays amounts.
  2. NEVER use a candidate labeled "TOTAL IVA", "TOTAL IMPUESTO", "TOTAL TAX", "TOTAL ITBMS", "SUBTOTAL" as the amount — these are partial values.
  3. The correct amount should satisfy: amount ≈ subtotalAmount + taxAmount (within rounding).
  4. If multiple "TOTAL" lines exist, the correct one is usually the LAST or the LARGEST (unless it's a tax-only total).
  5. Ignore the "alreadyExtracted.amount" if you see evidence in totalCandidates that it's wrong.
- paymentMethod: map keywords (tarjeta/card→CARD, efectivo/cash→CASH, transferencia/transfer/depósito→TRANSFER).
- vendorName — UNIVERSAL (any invoice type):
  * FIRST check labeledFields for keys: Emisor, Proveedor, Vendedor, "Razón Social Emisor" → use that value directly.
  * Thermal/ticket (no label): first recognizable business name near top. SKIP: terminal codes (DC1, POS-001, TERM1, REG-3), short alphanumeric codes (2-4 chars), document titles ("Comprobante Auxiliar...", "Factura de Operación Interna", "DGI"). Business names contain 3+ letters, often end in S.A., C.A., LTDA, INC, CORP, or are known brands.
  * Venezuela: "Razón Social" in the vendor block = vendorName. In Venezuela invoices, vendor section comes before "Datos del Cliente" or "Receptor".
  * NEVER use document types, government agency names, or terminal IDs as vendor.
- customerName: check labeledFields for: Cliente, Receptor, Comprador, Adquiriente. Venezuelan invoices: "Razón Social" in customer/receptor section = customerName. Retail tickets: null.
- vendorIdentifications: RUC/RFC/NIT/CUIT/RIF/CIF from vendor section. Venezuela: RIF J-XXXXXXX-X format.
- customerIdentifications: same ID types from customer section only. Venezuela: RIF of the buyer.
- ITBMS (Panama tax): "Exento" section with ITBMS=0.00 → taxAmount:0, taxPercentage:0. If ITBMS>0 → that is taxAmount. "Total Neto" → subtotalAmount.
- Thermal receipt tax: if no explicit tax label found but SUBT and TOTAL exist → taxAmount = TOTAL - SUBT. Look for "TAX", "ST TAX", "SALES TAX", "EXMT" (exempt amount), "ST 1/2/3" lines for tax breakdown.
- items: scan EVERY line for product/service rows. Include items from structured tables (Panama DGI: No., Descripción, Valor Item) and thermal receipt rows (item name + price). Never return empty array if products exist.
- extraFields: capture EVERYTHING not in the base schema — addresses, phone, CUFE, Protocolo de autorización, Punto de Facturación, DV, DGI URLs, cashier, terminal ID, authorization numbers, store number, payment breakdown, loyalty points, etc. Use descriptive Spanish keys. Be thorough.
- Return ONLY the JSON object, no markdown, no explanation.`;

    const userContent = JSON.stringify({
      rawText: input.rawText.slice(0, 10000),
      reconstructedText: input.reconstructedText?.slice(0, 10000),
      labeledFields: input.labeledFields ?? {},
      totalCandidates: input.totalCandidates ?? [],
      rulesExtracted: input.partialFields ?? {},
      warnings: input.warnings ?? []
    }, null, 2) + "\n\n(t=" + Date.now() + ")";

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
      console.error("DeepSeek structure request failed:", err instanceof Error ? err.message : err);
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
        currency: typeof parsed.currency === "string" && VALID_CURRENCIES.has(parsed.currency.toUpperCase()) ? parsed.currency.toUpperCase() : null,
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
      console.error("DeepSeek structure: failed to parse JSON response:", content?.slice(0, 200));
      return {};
    }
  }

  async categorize(input: {
    rawText: string;
    items?: ParsedReceipt["items"];
    vendorName?: string | null;
  }): Promise<Partial<ParsedReceipt>> {
    let accounts: { id: number; name: string; type: string }[] = [];
    try {
      accounts = await prisma.account.findMany({ select: { id: true, name: true, type: true } });
    } catch (err) {
      console.error("DeepSeek categorize: failed to load accounts:", err instanceof Error ? err.message : err);
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
      console.error("DeepSeek categorize request failed:", err instanceof Error ? err.message : err);
      return {};
    }

    try {
      const parsed = JSON.parse(content);
      const rawId = parsed.accountId;
      const accountId =
        typeof rawId === "number" ? rawId :
        typeof rawId === "string" && /^\d+$/.test(rawId.trim()) ? parseInt(rawId.trim(), 10) :
        null;

      let match = accounts.find((a) => a.id === accountId);
      if (!match && typeof parsed.accountName === "string") {
        const nameNorm = parsed.accountName.toLowerCase().trim();
        match = accounts.find((a) => a.name.toLowerCase().includes(nameNorm) || nameNorm.includes(a.name.toLowerCase()));
      }

      if (!match) {
        console.warn("DeepSeek categorize: no valid account found, ID:", rawId, "Name:", parsed.accountName);
        return {};
      }
      return { category: match.id };
    } catch {
      console.error("DeepSeek categorize: failed to parse JSON response:", content?.slice(0, 200));
      return {};
    }
  }
}
