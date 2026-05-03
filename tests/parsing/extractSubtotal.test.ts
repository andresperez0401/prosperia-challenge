import { describe, it, expect } from "vitest";
import { extractSubtotal } from "../../src/services/parsing/parser.js";

describe("extractSubtotal", () => {
  it("extracts from 'subtotal: 50.00'", () =>
    expect(extractSubtotal("subtotal: 50.00")).toBe(50));
  it("extracts from 'base imponible: 80.00'", () =>
    expect(extractSubtotal("base imponible: 80.00")).toBe(80));
  it("extracts from 'neto: 90.00'", () =>
    expect(extractSubtotal("neto: 90.00")).toBe(90));
  it("extracts 'subtotal500' with no separator (OCR column-merge)", () =>
    expect(extractSubtotal("subtotal500")).toBe(500));
  it("extracts 'subtotal 500€' with normal space", () =>
    expect(extractSubtotal("subtotal 500€")).toBe(500));
  it("extracts 'subtotal: 500' with colon", () =>
    expect(extractSubtotal("subtotal: 500")).toBe(500));
});
