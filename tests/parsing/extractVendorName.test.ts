import { describe, it, expect } from "vitest";
import { extractVendorName } from "../../src/services/parsing/parser.js";

describe("extractVendorName", () => {
  it("picks all-caps line as vendor name", () => {
    const text = "SUPERMERCADO XYZ\nfecha: 2024-01-01\ntotal: 100";
    expect(extractVendorName(text)).toBe("SUPERMERCADO XYZ");
  });
  it("falls back to first non-noise line", () => {
    const text = "Mi Tienda\nRUC: 123456\ntotal: 50";
    expect(extractVendorName(text)).toBeTruthy();
  });
});
