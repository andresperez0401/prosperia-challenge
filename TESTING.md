# Testing — Cómo Correr Pruebas

## Testing Framework

**Jest** — Framework de testing para Node.js + TypeScript

## Correr Tests

```bash
# Todos los tests
npm test

# Un archivo específico
npm test -- parser.test.ts

# Con coverage (ver qué código está cubierto)
npm test -- --coverage

# Watch mode (re-corre al guardar)
npm test -- --watch

# Solo un test dentro de un archivo
npm test -- --testNamePattern="extractAmount"
```

## Estructura de Tests

```
tests/
├── unit/
│   ├── parser.test.ts           → Extracción de campos
│   ├── normalizers.test.ts      → Limpieza de datos
│   ├── computeFields.test.ts    → Validación matemática
│   ├── categorizer.test.ts      → Clasificación contable
│   └── ocr.test.ts              → Lectura de texto
│
├── integration/
│   └── pipeline.test.ts         → Flujo completo
│
└── fixtures/
    ├── receipts/                 → PDFs de prueba
    ├── images/                   → Imágenes de prueba
    └── mocks.ts                  → Datos mock
```

## Tests Existentes

### Parser Unit Tests (`tests/unit/parser.test.ts`)
✓ `extractAmount` — Detecta montos en múltiples formatos
✓ `extractSubtotal` — Encuentra subtotal
✓ `extractTax` — Extrae IVA
✓ `extractVendorName` — Detecta tienda
✓ `findDate` — Reconoce fechas (20+ formatos)
✓ `extractInvoiceNumber` — Número de factura
✓ `normalizeAmount` — Convierte strings a números

### Normalizers Unit Tests (`tests/unit/normalizers.test.ts`)
✓ `normalizeAmount` — EU ("15.212,97"), US ("1,234.56"), con moneda
✓ `normalizeDate` — Todos los formatos de fecha
✓ `detectCurrency` — Bs → VES, € → EUR, $ → USD
✓ `normalizeIdentification` — RIF, NIT, RUC, CIF

### OCR Unit Tests (`tests/unit/ocr.test.ts`)
✓ OCR mock sin Tesseract real
✓ Selecciona variante correcta por score
✓ Maneja múltiples PSMs (4, 6, 11)

### Integration Test (`tests/integration/pipeline.test.ts`)
✓ Flujo completo: PDF → OCR → Parsing → IA → DB
✓ Verifica que todos los campos se llenen
✓ Valida estructura de respuesta

### Compute Fields Tests (`tests/unit/computeFields.test.ts`)
✓ Calcula faltantes: subtotal + tax = total
✓ Tolerancia de 6 centavos
✓ No sobrescribe campos existentes

### Categorizer Tests (`tests/unit/categorizer.test.ts`)
✓ Heurística por keywords (uber → transporte)
✓ Fallback a DB si IA falla
✓ Fuzzy match para variantes

## Escribir Nuevos Tests

### Template Básico
```typescript
import { extractAmount } from "../src/services/parsing/parser";

describe("extractAmount", () => {
  it("debe extraer monto en formato EU", () => {
    const text = "TOTAL: 15.212,97";
    const result = extractAmount(text);
    expect(result).toBe(15212.97);
  });

  it("debe retornar null si no encuentra monto", () => {
    const text = "sin monto aqui";
    const result = extractAmount(text);
    expect(result).toBeNull();
  });
});
```

### Buenas Prácticas

1. **Test una cosa por test**
   ```typescript
   // ❌ Malo
   it("procesa factura completa", () => {
     // 10 assertions diferentes
   });

   // ✅ Bien
   it("extrae monto de factura", () => {
     expect(extractAmount("TOTAL: 100")).toBe(100);
   });
   ```

2. **Usa fixtures (datos de prueba)**
   ```typescript
   import { mockReceipt } from "../fixtures/mocks";

   it("valida estructura de factura", () => {
     expect(mockReceipt).toHaveProperty("amount");
   });
   ```

3. **Mock dependencias externas**
   ```typescript
   jest.mock("../services/ai");

   it("usa fallback si IA falla", async () => {
     const result = await categorize({ vendorName: "test" });
     expect(result.category).toBeDefined();
   });
   ```

4. **Tests parametrizados (múltiples casos)**
   ```typescript
   describe.each([
     ["15.212,97", 15212.97],
     ["1,234.56", 1234.56],
     ["100", 100],
   ])("normalizeAmount('%s')", (input, expected) => {
     expect(normalizeAmount(input)).toBe(expected);
   });
   ```

## Coverage (Cobertura de Código)

```bash
npm test -- --coverage
```

Genera reporte en `coverage/`:
- **Statements** — % de líneas ejecutadas
- **Branches** — % de if/else ejecutados
- **Functions** — % de funciones llamadas
- **Lines** — % de líneas de código

**Meta:** 80%+ de coverage en funciones críticas.

## Mocking

### Mock del OCR (sin Tesseract real)
```typescript
import { MockOcr } from "../src/services/ocr/ocr.mock";

const ocr = new MockOcr();
const result = await ocr.extractText("test.jpg");
```

### Mock de IA (sin API externa)
```typescript
process.env.AI_PROVIDER = "mock";

const ai = getAiProvider();
const result = await ai.structure({ rawText: "..." });
```

### Mock de Base de Datos (Prisma)
```typescript
jest.mock("../src/lib/prisma", () => ({
  receipt: {
    create: jest.fn().mockResolvedValue({ id: 1 }),
  },
}));
```

## Fixtures (Datos de Prueba)

```typescript
// tests/fixtures/receipts.ts
export const sampleReceipt = {
  rawText: "TOTAL: 15.212,97",
  parsed: {
    amount: 15212.97,
    vendorName: "BALU",
    currency: "VES",
  },
};
```

Úsalos en tests:
```typescript
import { sampleReceipt } from "../fixtures/receipts";

it("procesa factura de ejemplo", () => {
  const result = parseReceipt(sampleReceipt.rawText);
  expect(result.amount).toBe(sampleReceipt.parsed.amount);
});
```

## CI/CD Integration

En GitHub Actions (`.github/workflows/test.yml`):
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: "20"
      - run: npm install
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v3
```

## Solucionar Tests Fallidos

**"Cannot find module"**
- Verificar import paths (case-sensitive en Linux)
- Limpiar cache: `npm test -- --clearCache`

**Timeout en tests**
- Aumentar timeout: `jest.setTimeout(10000)`
- Mock dependencias lentas

**Mock no funciona**
- Verificar que mock esté antes de import
- Usar `jest.resetModules()` entre tests

**Tests de Tesseract fallan**
- Usar mock en lugar de OCR real
- O instalar Tesseract: `choco install tesseract-ocr`
