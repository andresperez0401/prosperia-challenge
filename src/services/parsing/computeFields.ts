/**
 * Infer missing financial fields using math: subtotalAmount + taxAmount ≈ amount.
 * Only fills fields that are currently null; never overwrites existing values.
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

export function computeFields(f: FieldInput): FieldOutput {
  const a = f.amount ?? null;
  const s = f.subtotalAmount ?? null;
  const t = f.taxAmount ?? null;
  const p = f.taxPercentage ?? null;
  const out: FieldOutput = {};

  // All three present — validate triangle and derive percentage if missing
  if (a && s && t) {
    if (Math.abs(s + t - a) < 0.06 && !p && s > 0) {
      out.taxPercentage = round2((t / s) * 100);
    }
    return out;
  }

  // Two of the three present — derive the missing one
  if (a && s && !t) {
    const tax = round2(a - s);
    if (tax > 0 && tax < a) {
      out.taxAmount = tax;
      if (s > 0) out.taxPercentage = round2((tax / s) * 100);
    }
    return out;
  }

  if (a && t && !s) {
    const sub = round2(a - t);
    if (sub > 0 && sub < a) {
      out.subtotalAmount = sub;
      out.taxPercentage = round2((t / sub) * 100);
    }
    return out;
  }

  if (s && t && !a) {
    out.amount = round2(s + t);
    if (s > 0) out.taxPercentage = round2((t / s) * 100);
    return out;
  }

  // Use percentage to fill the rest
  if (s && p && !t) {
    const tax = round2((s * p) / 100);
    out.taxAmount = tax;
    out.amount = round2(s + tax);
    return out;
  }

  if (a && p && !s && !t) {
    const sub = round2(a / (1 + p / 100));
    out.subtotalAmount = sub;
    out.taxAmount = round2(a - sub);
    return out;
  }

  return out;
}
