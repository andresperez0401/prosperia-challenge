import { describe, it, expect } from "vitest";
import { naiveParse } from "../../src/services/parsing/parser.js";

// Real OCR output from samples/factura1.jpg — Panama DGI, ITBMS-exempt, two services with discount
const FACTURA1_OCR = `Comprobante Auxiliar de Factura Electronica
Factura de Operación Interna
Emisor: DERMA MEDICAL CENTER S.A.
RUC: 155726599-2-2022
DV: 45
Dirección: Calle Ramón H Jurado The Panama Clinic Torre B, Piso 23.
Tipo de Receptor: Consumidor final
Cliente: george Nauyok
RUC/Cédula/Pasaporte:
Número: 0000007838
Fecha de Emisión: 03/06/2025
https://dgi-fep.mef.gob.pa/Consultas/FacturasPorCUFE
Consulta Dr. Jessing 85.00 17.00 68.00 68.00
Harris
Destrucción lesiones 200.00 0.00 200.00 200.00
Valor Total 268.00
Desglose ITBMS
268.00 Exento 0.00
Monto Gravado ITBMS 0.00
Total Impuesto 0.00
Forma de Pago
Tarjeta de Crédito 268.00
TOTAL PAGADO 268.00
Vuelto 0.00`;

describe("naiveParse — synthetic receipt (integration)", () => {
  it("extracts all fields from a complete receipt text", () => {
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

describe("naiveParse — factura1 (DERMA MEDICAL CENTER, Panama DGI, ITBMS-exempt)", () => {
  it("amount = 268 (TOTAL PAGADO)", () =>
    expect(naiveParse(FACTURA1_OCR).amount).toBe(268));

  it("subtotal = 268 (Valor Total, exempt base)", () =>
    expect(naiveParse(FACTURA1_OCR).subtotalAmount).toBe(268));

  it("taxAmount = 0 (exempt)", () =>
    expect(naiveParse(FACTURA1_OCR).taxAmount).toBe(0));

  it("vendorName = DERMA MEDICAL CENTER S.A. (via labeled-field Emisor)", () =>
    expect(naiveParse(FACTURA1_OCR).vendorName).toBe("DERMA MEDICAL CENTER S.A."));

  it("customerName = george Nauyok", () =>
    expect(naiveParse(FACTURA1_OCR).customerName).toBe("george Nauyok"));

  it("invoiceNumber extracted from Número: 0000007838", () =>
    expect(naiveParse(FACTURA1_OCR).invoiceNumber).toBeTruthy());

  it("amount=268, subtotal=268, tax=0 in one call", () => {
    const r = naiveParse(FACTURA1_OCR);
    expect(r.amount).toBe(268);
    expect(r.subtotalAmount).toBe(268);
    expect(r.taxAmount).toBe(0);
  });
});
