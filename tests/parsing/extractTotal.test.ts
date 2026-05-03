import { describe, it, expect } from "vitest";
import { extractTotal } from "../../src/services/parsing/parser.js";

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
