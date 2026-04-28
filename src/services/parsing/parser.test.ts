import { describe, it, expect } from "vitest";
import {
  parseAmount,
  extractTotal,
  extractSubtotal,
  extractTax,
  extractTaxPercentage,
  extractDate,
  extractVendorName,
  extractVendorIds,
  reconcile,
  naiveParse,
} from "./parser.js";

describe("parseAmount", () => {
  it("handles US format", () => expect(parseAmount("1,234.56")).toBe(1234.56));
  it("handles EU/LATAM format", () => expect(parseAmount("1.234,56")).toBe(1234.56));
  it("handles plain integer", () => expect(parseAmount("1234")).toBe(1234));
  it("handles simple decimal", () => expect(parseAmount("12.50")).toBe(12.5));
  it("returns null for empty string", () => expect(parseAmount("")).toBeNull());
  it("returns null for non-numeric", () => expect(parseAmount("abc")).toBeNull());
});

describe("extractTotal", () => {
  it("extracts from 'total: $12.50'", () =>
    expect(extractTotal("total: $12.50")).toBe(12.5));
  it("extracts from 'total a pagar: 100.00'", () =>
    expect(extractTotal("total a pagar: 100.00")).toBe(100));
  it("extracts from 'grand total: 99.99'", () =>
    expect(extractTotal("grand total: 99.99")).toBe(99.99));
  it("returns null when no total present", () =>
    expect(extractTotal("no hay nada aqui")).toBeNull());
});

describe("extractSubtotal", () => {
  it("extracts from 'subtotal: 50.00'", () =>
    expect(extractSubtotal("subtotal: 50.00")).toBe(50));
  it("extracts from 'base imponible: 80.00'", () =>
    expect(extractSubtotal("base imponible: 80.00")).toBe(80));
  it("extracts from 'neto: 90.00'", () =>
    expect(extractSubtotal("neto: 90.00")).toBe(90));
});

describe("extractTax", () => {
  it("extracts IVA amount", () =>
    expect(extractTax("iva 12%: 12.00")).toBe(12));
  it("extracts tax amount", () =>
    expect(extractTax("tax: 8.50")).toBe(8.5));
  it("extracts IGV amount", () =>
    expect(extractTax("igv: 18.00")).toBe(18));
});

describe("extractTaxPercentage", () => {
  it("extracts 'iva 12%'", () =>
    expect(extractTaxPercentage("iva 12%")).toBe(12));
  it("extracts '19%'", () =>
    expect(extractTaxPercentage("total con 19% de iva")).toBe(19));
  it("returns null when no % present", () =>
    expect(extractTaxPercentage("sin impuesto")).toBeNull());
});

describe("extractDate", () => {
  it("parses YYYY-MM-DD", () =>
    expect(extractDate("fecha: 2024-03-15")).toBe("2024-03-15"));
  it("parses DD-MM-YYYY", () =>
    expect(extractDate("fecha: 15-03-2024")).toBe("2024-03-15"));
  it("parses 'DD de mes de YYYY'", () =>
    expect(extractDate("el 5 de enero de 2024")).toBe("2024-01-05"));
  it("returns null when no date", () =>
    expect(extractDate("sin fecha")).toBeNull());
});

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

describe("extractVendorIds", () => {
  it("extracts RUC Perú", () =>
    expect(extractVendorIds("ruc: 20123456789")).toEqual(["20123456789"]));
  it("extracts NIT Colombia", () =>
    expect(extractVendorIds("nit: 900123456-1")).toEqual(["900123456-1"]));
  it("extracts EIN USA", () =>
    expect(extractVendorIds("ein: 12-3456789")).toEqual(["12-3456789"]));
  it("returns empty array when no ids found", () =>
    expect(extractVendorIds("sin identificacion")).toEqual([]));
});

describe("reconcile", () => {
  it("keeps consistent values unchanged", () =>
    expect(reconcile(112, 100, 12, 12)).toEqual({ subtotal: 100, tax: 12 }));
  it("derives tax from subtotal + percentage", () =>
    expect(reconcile(112, 100, null, 12)).toEqual({ subtotal: 100, tax: 12 }));
  it("derives subtotal from total - tax", () =>
    expect(reconcile(112, null, 12, null)).toEqual({ subtotal: 100, tax: 12 }));
  it("derives tax from total - subtotal", () =>
    expect(reconcile(112, 100, null, null)).toEqual({ subtotal: 100, tax: 12 }));
  it("returns nulls when total is missing", () =>
    expect(reconcile(null, null, null, null)).toEqual({ subtotal: null, tax: null }));
});

describe("naiveParse (integration)", () => {
  it("extracts all fields from a full receipt text", () => {
    const raw = `RESTAURANTE LA 14
RUC: 20123456789
Fecha: 2024-06-15
Factura No: F-0012345

Subtotal:   80.00
IVA 12%:   9.60
Total:     89.60
Gracias por su visita`;

    const result = naiveParse(raw);
    expect(result.amount).toBe(89.6);
    expect(result.subtotalAmount).toBe(80);
    expect(result.taxAmount).toBeCloseTo(9.6, 1);
    expect(result.taxPercentage).toBe(12);
    expect(result.date).toBe("2024-06-15");
    expect(result.invoiceNumber).toBeTruthy();
    expect(result.vendorName).toBeTruthy();
    expect(result.vendorIdentifications).toContain("20123456789");
  });
});
