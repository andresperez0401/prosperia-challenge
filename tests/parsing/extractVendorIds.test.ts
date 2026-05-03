import { describe, it, expect } from "vitest";
import { extractVendorIds } from "../../src/services/parsing/parser.js";

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
