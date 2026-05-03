import { describe, it, expect } from "vitest";
import { extractTaxPercentage } from "../../src/services/parsing/parser.js";

describe("extractTaxPercentage", () => {
  it("extracts 'iva 12%'", () =>
    expect(extractTaxPercentage("iva 12%")).toBe(12));
  it("extracts '19%' from inline sentence", () =>
    expect(extractTaxPercentage("total con 19% de iva")).toBe(19));
  it("returns null when no % present", () =>
    expect(extractTaxPercentage("sin impuesto")).toBeNull());
});
