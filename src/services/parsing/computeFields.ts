/**
 * Infer missing financial fields using math: subtotalAmount + taxAmount ≈ amount.
 * Only fills fields that are currently null; never overwrites existing values.
 * taxAmount=0 is a valid value (exempt invoice) — treated as present, not missing.
 */

interface FieldInput {
  amount?: number | null;
  subtotalAmount?: number | null;
  taxAmount?: number | null;
  taxPercentage?: number | null;
}

interface FieldOutput {
  amount?: number;
  subtotalAmount?: number;
  taxAmount?: number;
  taxPercentage?: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

const hasVal = (v: number | null | undefined): v is number => v !== null && v !== undefined;

export function computeFields(f: FieldInput): FieldOutput {
  const a = f.amount ?? null;
  const s = f.subtotalAmount ?? null;
  const t = f.taxAmount ?? null;   // 0 is a valid "no tax" signal — keep as-is
  const p = f.taxPercentage ?? null;
  const out: FieldOutput = {};

  // All three present — validate triangle and derive percentage if missing
  if (hasVal(a) && hasVal(s) && hasVal(t)) {
    if (Math.abs(s + t - a) < 0.06 && !hasVal(p) && s > 0) {
      out.taxPercentage = round2((t / s) * 100);
    }
    return out;
  }

  // Two of three present — derive the missing one
  if (hasVal(a) && hasVal(s) && !hasVal(t)) {
    const tax = round2(a - s);
    // tax >= 0: 0 means exempt (amount == subtotal), still record it
    if (tax >= 0 && tax < a) {
      out.taxAmount = tax;
      if (s > 0 && tax > 0) out.taxPercentage = round2((tax / s) * 100);
      if (tax === 0) out.taxPercentage = 0;
    }
    return out;
  }

  if (hasVal(a) && hasVal(t) && !hasVal(s)) {
    const sub = round2(a - t);
    if (sub > 0 && sub < a) {
      out.subtotalAmount = sub;
      if (t > 0) out.taxPercentage = round2((t / sub) * 100);
    }
    return out;
  }

  if (hasVal(s) && hasVal(t) && !hasVal(a)) {
    out.amount = round2(s + t);
    if (s > 0 && t > 0) out.taxPercentage = round2((t / s) * 100);
    if (t === 0) out.taxPercentage = 0;
    return out;
  }

  // Use percentage to fill the rest — only when t is truly missing (null)
  if (hasVal(s) && hasVal(p) && !hasVal(t)) {
    const tax = round2((s * p) / 100);
    out.taxAmount = tax;
    out.amount = round2(s + tax);
    return out;
  }

  if (hasVal(a) && hasVal(p) && !hasVal(s) && !hasVal(t)) {
    // Only infer when percentage is nonzero — if p=0, amount IS the subtotal
    if (p === 0) {
      out.subtotalAmount = a;
      out.taxAmount = 0;
    } else {
      const sub = round2(a / (1 + p / 100));
      out.subtotalAmount = sub;
      out.taxAmount = round2(a - sub);
    }
    return out;
  }

  return out;
}
