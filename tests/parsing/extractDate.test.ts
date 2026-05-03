import { describe, it, expect } from "vitest";
import { extractDate } from "../../src/services/parsing/parser.js";

describe("extractDate", () => {
  it("parses YYYY-MM-DD", () =>
    expect(extractDate("fecha: 2024-03-15")).toBe("2024-03-15"));
  it("parses DD-MM-YYYY", () =>
    expect(extractDate("fecha: 15-03-2024")).toBe("2024-03-15"));
  it("parses 'DD de mes de YYYY' (Spanish free text)", () =>
    expect(extractDate("el 5 de enero de 2024")).toBe("2024-01-05"));
  it("returns null when no date", () =>
    expect(extractDate("sin fecha")).toBeNull());
});
