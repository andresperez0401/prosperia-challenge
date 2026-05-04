# Testing — Cómo Correr Pruebas

## Testing Framework

**Vitest** — Framework de testing ultrarrápido nativo para Vite/Node.js, ideal para TypeScript. En este proyecto usamos Vitest porque no requiere precompilar TypeScript ni configuración pesada.

## Correr Tests

```bash
# Todos los tests (se ejecuta una vez y da el resultado final)
npm test

# Watch mode (se queda escuchando y re-corre automáticamente al guardar un archivo)
npm run test:watch

# Un archivo específico
npx vitest tests/parsing/extractTotal.test.ts
```

## Estructura de Tests

Actualmente el sistema cuenta con **55 tests** enfocados en el corazón de la aplicación: la lógica de parsing y normalización de texto OCR. Estos viven dentro de la carpeta `tests/parsing/`.

```
tests/
  parsing/                     → un archivo por función del parser (10 archivos, 55 tests)
    parseAmount.test.ts          → normalización de montos
    extractTotal.test.ts         → extracción del total final
    extractSubtotal.test.ts      → extracción del subtotal / base imponible
    extractTax.test.ts           → extracción del monto de impuesto
    extractTaxPercentage.test.ts → extracción del porcentaje de impuesto
    extractDate.test.ts          → parseo de fechas en múltiples formatos
    extractVendorName.test.ts    → detección del nombre del comercio
    extractVendorIds.test.ts     → extracción de IDs fiscales (RUC, NIT, EIN)
    reconcile.test.ts            → matemática de validación financiera
    naiveParse.test.ts           → integración completa + factura real DGI Panamá
```

## Tests Existentes (Qué Prueban)

**`parseAmount`** — verifica que el normalizador de montos entiende los formatos europeo (`1.234,56`) y americano (`1,234.56`). También prueba enteros, decimales simples, strings vacíos y texto no numérico.

**`extractTotal`** — confirma que la función encuentra el total en frases como `"total: $12.50"`, `"total a pagar: 100.00"` y `"grand total: 99.99"`, y devuelve `null` cuando no hay ninguna.

**`extractSubtotal`** — prueba variantes de la etiqueta: `"subtotal: 50.00"`, `"base imponible: 80.00"`, `"neto: 90.00"`, y también el caso de fusión de columnas de OCR (`"subtotal500"` sin separador).

**`extractTax`** — verifica que extrae el monto del impuesto en formatos de IVA, tax, IGV, y que no confunde el porcentaje con el monto cuando aparece `"iva 21% 105€"`.

**`extractTaxPercentage`** — comprueba que lee el porcentaje de líneas como `"iva 12%"` o `"total con 19% de iva"`, y devuelve `null` si no hay porcentaje.

**`extractDate`** — cubre más de 20 formatos de fecha: `YYYY-MM-DD`, `DD-MM-YYYY`, formato libre en español (`"el 5 de enero de 2024"`), y devuelve `null` cuando no hay fecha.

**`extractVendorName`** — verifica que prefiere una línea en mayúsculas como nombre del comercio y que devuelve la primera línea no ruidosa.

**`extractVendorIds`** — extrae identificaciones fiscales: RUC Perú (`20123456789`), NIT Colombia (`900123456-1`), EIN USA (`12-3456789`), devolviendo array vacío si no encuentra.

**`reconcile`** — prueba la matemática de validación financiera: si tenemos dos de los tres valores (`subtotal`, `tax`, `total`), el tercero se puede calcular.

**`naiveParse` (integración)** — pasa un recibo completo de texto crudo y verifica que el parser genérico devuelva todos los campos correctamente (`amount`, `subtotalAmount`, `taxAmount`, `taxPercentage`, `date`, `invoiceNumber`, `vendorName` e `vendorIdentifications`) en un solo paso. Además incluye un test de **factura real (DGI Panamá)**.

## Escribir Nuevos Tests

### Template Básico (`vitest`)
```typescript
import { describe, it, expect } from "vitest";
import { parseAmount } from "../../src/services/parsing/parser.js";

describe("parseAmount", () => {
  it("debe extraer monto en formato EU", () => {
    const text = "15.212,97";
    const result = parseAmount(text);
    expect(result).toBe(15212.97);
  });

  it("debe retornar null si recibe basura", () => {
    const text = "sin monto aqui";
    const result = parseAmount(text);
    expect(result).toBeNull();
  });
});
```

### Buenas Prácticas

1. **Testea una función por archivo:** Mantén la convención de `tests/parsing/[nombreFuncion].test.ts`.
2. **Casos reales:** Si el OCR falla leyendo un recibo en producción, saca la línea problemática exacta del log, agrégala como test fallido, y luego arregla el parser para que la lea.
3. **Casos de prueba iterativos (`it.each`):** Vitest permite correr decenas de casos en una sola declaración para funciones de parsing:
   ```typescript
   it.each([
     ["15.212,97", 15212.97],
     ["1,234.56", 1234.56],
     ["100", 100],
   ])("debería parsear '%s' como %f", (input, expected) => {
     expect(parseAmount(input)).toBe(expected);
   });
   ```

## Solucionar Tests Fallidos

**"Cannot find module"**
- Asegúrate de importar desde `.js` al final aunque el archivo sea `.ts` (Requisito de Node ESM). Ej: `import { func } from "./file.js"`.

**Timeout en tests**
- Si implementas tests pesados de IA u OCR, aumenta el timeout en Vitest o mockea los servicios externos. Actualmente todos los tests son de parsing puro y tardan escasos milisegundos.
