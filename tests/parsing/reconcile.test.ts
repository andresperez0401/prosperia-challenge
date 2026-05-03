import { describe, it, expect } from "vitest";
import { reconcile } from "../../src/services/parsing/parser.js";

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
  it("preserves subtotal and tax when total does not match (e.g. IRPF retention)", () =>
    expect(reconcile(500, 500, 105, 21)).toEqual({ subtotal: 500, tax: 105 }));
  it("does not derive negative tax when subtotal > total", () => {
    const result = reconcile(80, 100, null, null);
    expect(result.tax).toBeNull();
  });
});
