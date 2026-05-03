import { describe, it, expect } from "vitest";
import { extractTax } from "../../src/services/parsing/parser.js";

describe("extractTax", () => {
  it("extracts IVA amount", () =>
    expect(extractTax("iva 12%: 12.00")).toBe(12));
  it("extracts tax amount", () =>
    expect(extractTax("tax: 8.50")).toBe(8.5));
  it("extracts IGV amount", () =>
    expect(extractTax("igv: 18.00")).toBe(18));
});

describe("extractTax — percentage-then-amount format (IVA 21% 105€)", () => {
  it("does not capture percentage as amount in 'IVA 21% 105€'", () =>
    expect(extractTax("iva 21% 105€")).toBe(105));
  it("does not capture percentage in 'IVA 21 % 105 €' (spaces around %)", () =>
    expect(extractTax("iva 21 % 105 €")).toBe(105));
  it("extracts with explicit separator 'IVA (21%): 105'", () =>
    expect(extractTax("iva (21%): 105")).toBe(105));
  it("extracts 'IVA: 105' (no percentage)", () =>
    expect(extractTax("iva: 105")).toBe(105));
  it("does not return null for percentage + amount format", () =>
    expect(extractTax("iva 7% 35€")).toBe(35));
});
