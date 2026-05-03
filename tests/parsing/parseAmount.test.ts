import { describe, it, expect } from "vitest";
import { parseAmount } from "../../src/services/parsing/parser.js";

describe("parseAmount", () => {
  it("handles US format", () => expect(parseAmount("1,234.56")).toBe(1234.56));
  it("handles EU/LATAM format", () => expect(parseAmount("1.234,56")).toBe(1234.56));
  it("handles plain integer", () => expect(parseAmount("1234")).toBe(1234));
  it("handles simple decimal", () => expect(parseAmount("12.50")).toBe(12.5));
  it("returns null for empty string", () => expect(parseAmount("")).toBeNull());
  it("returns null for non-numeric", () => expect(parseAmount("abc")).toBeNull());
  it("'1.000' as thousands in EU format (no decimals → thousands)", () =>
    expect(parseAmount("1.000")).toBe(1000));
  it("'500,00' as five hundred in EU format", () =>
    expect(parseAmount("500,00")).toBe(500));
  it("returns null for symbols-only string", () =>
    expect(parseAmount("€$")).toBeNull());
});
