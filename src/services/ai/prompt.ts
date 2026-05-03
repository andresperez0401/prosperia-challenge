import { ParsedReceipt } from "../../types/receipt.js";
import { StructureInput, AccountOption } from "./ai.interface.js";

/**
 * Compact, strict extraction prompt. Token-optimized: short instructions,
 * relies on pre-extracted candidate arrays. ~600 tokens vs prior ~1.6k.
 */
export const STRUCTURE_SYSTEM_PROMPT = `Devuelve SOLO JSON válido. Sin markdown.

Extractor de facturas. Entradas:
- rawText, reconstructedText (opcional)
- rulesExtracted: hints de reglas
- totalCandidates {label,value,role:final|subtotal|tax|line|ambiguous}
- subtotalCandidates, taxCandidates {label,value}
- vendorCandidates[], customerCandidates[]
- identifications {value,section:vendor|customer|unknown,label}
- labeledFields {Emisor,Cliente,RUC,...}
- tableRows [{label,value}] (alineados por bbox del OCR; muy confiables)
- accounts ["id|name"]

Reglas:
1. amount = TOTAL FINAL (no subtotal/impuesto/línea/descuento/cambio/pago recibido).
2. subtotalAmount = antes de impuestos. taxAmount = impuesto total (0 si exento). taxPercentage = % (0 si exento).
3. vendorName = emisor. customerName = cliente. Asigna IDs por identifications.section. No mezcles.
4. invoiceNumber: nunca etiqueta (FECHA, FACTURA, INVOICE, CLIENTE, TOTAL).
5. recommendedAccountId: UN id de accounts (o null si no hay).
6. extraFields: Extrae metadatos adicionales (Ej. Dirección, Teléfono, Cajero, Terminal). Usa claves descriptivas en español.
7. Sin evidencia → null. No inventes.

amount:
- Prefiere role=final (TOTAL A PAGAR, TOTAL FACTURA, MONTO/IMPORTE TOTAL, GRAND TOTAL, AMOUNT/TOTAL DUE, NETO A PAGAR, TOTAL PAGADO).
- NUNCA role=tax|subtotal|line.
- Verifica subtotal+tax ≈ amount (±0.05). Si varios candidatos, elige el del resumen final que cuadre.

vendor vs cliente (genérico, multipaís):
- Vendedor: arriba del recibo, antes del bloque cliente. Etiquetas: Emisor|Vendedor|Proveedor|Issuer|Seller.
- Cliente: Cliente|Razón Social (tras marcador cliente o RIF/C.I./RUC Cliente)|Customer|Bill To|Sold To|Receptor|Comprador|Adquiriente|NIT Cliente.
- VE: "Razón Social" suele ser el cliente cuando va en bloque de cliente.
- PA: típico "Cliente: Nombre".
- No uses organismos fiscales, encabezados ni códigos de terminal como vendorName.
- NUNCA uses tipos de documento como vendorName: "FACTURA ELECTRONICA", "ELECTRONICA", "RECIBO", "INVOICE", "COMPROBANTE", "TICKET", "NOTA DE CREDITO/DEBITO", "DGI", "SENIAT" — tampoco si aparecen solas en su línea.
- vendorName NUNCA debe contener tras 4+ espacios consecutivos texto extra: corta ahí (es ruido de columna del OCR). Mismo rule para customerName.

currency: VES|USD|EUR|COP|MXN|ARS|CLP|PAB|PEN|null. Bs→VES, ITBMS/B/.→PAB, €→EUR, S/.→PEN, $→USD.
date: "YYYY-MM-DD" o null. paymentMethod: CARD|CASH|TRANSFER|OTHER|null.

Formato (exacto, no agregar campos, no incluir confidence):
{"amount":n|null,"subtotalAmount":n|null,"taxAmount":n|null,"taxPercentage":n|null,"type":"expense"|"income","currency":s|null,"date":s|null,"paymentMethod":s|null,"description":s|null,"invoiceNumber":s|null,"vendorName":s|null,"vendorIdentifications":[],"customerName":s|null,"customerIdentification":s|null,"items":[{"description":s,"quantity":n,"unitPrice":n,"total":n}],"extraFields":{},"recommendedAccountId":n|null,"recommendedAccountName":s|null}`;

/**
 * Build the user message — token-optimized payload.
 * - rawText capped at 8k chars (covers long multi-page invoices; final TOTAL block
 *   often lives at the end, so a tighter cap silently dropped it).
 * - reconstructedText always included when present (column alignment helps the AI
 *   pair labels with values, even on short tickets where char-diff is small).
 * - Empty arrays / null hint fields are stripped.
 * - rulesExtracted: only non-empty values are sent.
 * - accounts compacted to "id|name" strings.
 */
export function buildStructurePrompt(input: StructureInput): {
  systemPrompt: string;
  userContent: string;
} {
  const raw = input.rawText.slice(0, 8000);
  const recon = input.reconstructedText?.slice(0, 8000);
  const includeRecon = !!recon && recon !== raw;

  const compactRules = (() => {
    const src = input.partialFields ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src)) {
      if (v === null || v === undefined) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) continue;
      out[k] = v;
    }
    return out;
  })();

  const accounts = (input.accounts ?? []).map((a) => `${a.id}|${a.name}`);

  const payload: Record<string, unknown> = { rawText: raw };
  if (includeRecon) payload.reconstructedText = recon;
  if (Object.keys(compactRules).length) payload.rulesExtracted = compactRules;
  if (input.totalCandidates?.length) payload.totalCandidates = input.totalCandidates;
  if (input.subtotalCandidates?.length) payload.subtotalCandidates = input.subtotalCandidates;
  if (input.taxCandidates?.length) payload.taxCandidates = input.taxCandidates;
  if (input.vendorCandidates?.length) payload.vendorCandidates = input.vendorCandidates;
  if (input.customerCandidates?.length) payload.customerCandidates = input.customerCandidates;
  if (input.identifications?.length) payload.identifications = input.identifications;
  if (input.labeledFields && Object.keys(input.labeledFields).length)
    payload.labeledFields = input.labeledFields;
  if (input.tableRows?.length) payload.tableRows = input.tableRows.slice(0, 80);
  if (accounts.length) payload.accounts = accounts;
  if (input.warnings?.length) payload.warnings = input.warnings;

  return {
    systemPrompt: STRUCTURE_SYSTEM_PROMPT,
    userContent: JSON.stringify(payload),
  };
}

/** Parse + validate the AI's JSON response. Returns a ParsedReceipt-shaped partial. */
export function parseStructureJson(
  content: string,
  accounts: AccountOption[],
  validCurrencies: Set<string>,
): Partial<ParsedReceipt> {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    console.error("AI structure: failed to parse JSON:", content?.slice(0, 200));
    return {};
  }

  const validPaymentMethods = ["CARD", "CASH", "TRANSFER", "OTHER"];
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const strArr = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

  // Customer identification — prompt asks for a single string; accept array too for resilience.
  const rawCust = parsed.customerIdentification ?? (parsed as Record<string, unknown>).customerIdentifications;
  const customerIds = Array.isArray(rawCust)
    ? rawCust.filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    : typeof rawCust === "string" && rawCust.trim()
      ? [rawCust.trim()]
      : [];

  // Resolve recommendedAccountId → category (validate against accounts list)
  let category: number | null = null;
  const rawAccId = parsed.recommendedAccountId ?? (parsed as Record<string, unknown>).accountId;
  const accId =
    typeof rawAccId === "number"
      ? rawAccId
      : typeof rawAccId === "string" && /^\d+$/.test(rawAccId.trim())
        ? parseInt(rawAccId.trim(), 10)
        : null;
  if (accId !== null) {
    const match = accounts.find((a) => a.id === accId);
    if (match) category = match.id;
  }
  if (category === null) {
    const accName = str(parsed.recommendedAccountName ?? parsed.accountName);
    if (accName) {
      const norm = accName.toLowerCase();
      const match = accounts.find(
        (a) => a.name.toLowerCase() === norm || a.name.toLowerCase().includes(norm) || norm.includes(a.name.toLowerCase()),
      );
      if (match) category = match.id;
    }
  }

  const currencyRaw = str(parsed.currency);
  const currency =
    currencyRaw && validCurrencies.has(currencyRaw.toUpperCase()) ? currencyRaw.toUpperCase() : null;

  return {
    amount: num(parsed.amount),
    subtotalAmount: num(parsed.subtotalAmount),
    taxAmount: num(parsed.taxAmount),
    taxPercentage: num(parsed.taxPercentage),
    type: parsed.type === "income" ? "income" : "expense",
    currency,
    date: str(parsed.date),
    paymentMethod:
      typeof parsed.paymentMethod === "string" && validPaymentMethods.includes(parsed.paymentMethod)
        ? (parsed.paymentMethod as ParsedReceipt["paymentMethod"])
        : null,
    description: str(parsed.description),
    invoiceNumber: str(parsed.invoiceNumber),
    vendorName: str(parsed.vendorName),
    vendorIdentifications: strArr(parsed.vendorIdentifications),
    customerName: str(parsed.customerName),
    customerIdentifications: customerIds,
    items: Array.isArray(parsed.items) ? (parsed.items as ParsedReceipt["items"]) : [],
    extraFields:
      typeof parsed.extraFields === "object" && parsed.extraFields !== null
        ? (parsed.extraFields as Record<string, string | number>)
        : {},
    category,
  };
}
