# Mini-Prosperia — Documento de Arquitectura

> Este documento describe el flujo completo de la aplicación: desde que el servidor arranca hasta que una factura queda persistida en base de datos con todos sus campos extraídos, categorizados y listos para contabilidad.

---

## Tabla de contenidos

1. [Stack tecnológico](#1-stack-tecnológico)
2. [Estructura de carpetas](#2-estructura-de-carpetas)
3. [Arranque del servidor](#3-arranque-del-servidor)
4. [Rutas y endpoints](#4-rutas-y-endpoints)
5. [Flujo completo de procesamiento](#5-flujo-completo-de-procesamiento)
6. [Paso 1 — Subida de archivo (Multer)](#6-paso-1--subida-de-archivo-multer)
7. [Paso 2 — OCR: extracción de texto](#7-paso-2--ocr-extracción-de-texto)
8. [Paso 3 — Parser de reglas (regex)](#8-paso-3--parser-de-reglas-regex)
9. [Paso 4 — IA: estructuración de campos](#9-paso-4--ia-estructuración-de-campos)
10. [Paso 5 — Categorización contable](#10-paso-5--categorización-contable)
11. [Paso 6 — Detección de divisa](#11-paso-6--detección-de-divisa)
12. [Paso 7 — Persistencia en base de datos](#12-paso-7--persistencia-en-base-de-datos)
13. [¿Quién vende y quién compra? (Vendor vs Customer)](#13-quién-vende-y-quién-compra-vendor-vs-customer)
14. [Reconciliación financiera](#14-reconciliación-financiera)
15. [Modelo de base de datos](#15-modelo-de-base-de-datos)
16. [Patrón de providers (OCR e IA)](#16-patrón-de-providers-ocr-e-ia)
17. [UI — Interfaz web](#17-ui--interfaz-web)
18. [Tests](#18-tests)
19. [Variables de entorno](#19-variables-de-entorno)
20. [Diagrama de arquitectura](#20-diagrama-de-arquitectura)

---

## 1. Stack tecnológico

| Capa | Tecnología | Rol |
|---|---|---|
| Runtime | Node.js + TypeScript | Servidor y lógica de negocio |
| Framework HTTP | Express.js | Routing y middleware |
| Base de datos | PostgreSQL (Neon / local) | Persistencia |
| ORM | Prisma | Modelos, migraciones y queries |
| OCR | Tesseract.js | Extracción de texto de imágenes |
| PDF | pdf-parse | Extracción de texto de PDFs |
| IA | OpenAI gpt-4o-mini (vía relay) | Estructuración y categorización |
| Upload | Multer | Recepción de archivos multipart |
| Logs | Pino | Logging estructurado |
| Tests | Vitest | Tests unitarios e integración |

---

## 2. Estructura de carpetas

```
src/
├── app.ts                          ← Configura Express, monta rutas y error handler
├── server.ts                       ← Punto de entrada: carga .env y arranca el puerto
├── config/
│   ├── env.ts                      ← Lee y tipifica variables de entorno
│   └── logger.ts                   ← Configura Pino (pretty en dev, JSON en prod)
├── db/
│   └── client.ts                   ← Instancia única de PrismaClient (singleton)
├── controllers/
│   ├── receipts.controller.ts      ← Maneja POST /api/receipts, GET /:id, POST /:id/reparse
│   └── transactions.controller.ts  ← Maneja POST /api/transactions
├── routes/
│   ├── receipts.routes.ts          ← Conecta rutas → middleware Multer → controller
│   └── transactions.routes.ts      ← Conecta ruta → controller
├── services/
│   ├── receipts.service.ts         ← ORQUESTADOR: coordina OCR → parser → IA → DB
│   ├── ocr/
│   │   ├── ocr.interface.ts        ← Contrato: extractText(filePath, mimeType)
│   │   ├── ocr.tesseract.ts        ← Implementación real con Tesseract.js
│   │   ├── ocr.mock.ts             ← Implementación mock para tests
│   │   └── index.ts                ← Factory: elige provider según OCR_PROVIDER
│   ├── ai/
│   │   ├── ai.interface.ts         ← Contrato: structure(text) + categorize(input)
│   │   ├── ai.openai.ts            ← Implementación real vía relay HTTP
│   │   ├── ai.mock.ts              ← Implementación mock con regex básico
│   │   └── index.ts                ← Factory: elige provider según AI_PROVIDER
│   └── parsing/
│       ├── parser.ts               ← Extracción por regex (determinístico, sin costo)
│       ├── parser.test.ts          ← Tests unitarios del parser
│       └── categorizer.ts          ← Heurística de palabras clave como fallback
├── types/
│   └── receipt.ts                  ← Tipos ParsedReceipt e Item
└── utils/
    └── errors.ts                   ← HttpError con status code
```

---

## 3. Arranque del servidor

```
src/server.ts
│
├── dotenv.config()           ← Carga variables del archivo .env
├── import app from ./app     ← Importa la app Express ya configurada
└── app.listen(PORT)          ← Abre el puerto (default: 3010 en dev, 3000 en .env.example)
```

`src/app.ts` monta en este orden:
1. `express.json()` — parsea cuerpos JSON
2. `express.static("public")` — sirve el formulario HTML desde `/`
3. `GET /health` — responde `{ ok: true }` para checks de disponibilidad
4. `POST|GET /api/receipts` — lógica principal
5. `POST /api/transactions` — CRUD básico de transacciones
6. Error handler global — captura cualquier excepción de controllers y responde con JSON

---

## 4. Rutas y endpoints

### Recibos

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/receipts` | Sube un archivo (imagen o PDF), lo procesa y persiste |
| `GET` | `/api/receipts/:id` | Devuelve un recibo ya procesado por su ID |
| `POST` | `/api/receipts/:id/reparse` | Reprocesa un recibo existente (útil para debug) |

### Transacciones

| Método | Ruta | Descripción |
|---|---|---|
| `POST` | `/api/transactions` | Crea una transacción manualmente (CRUD base) |

### UI

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/` | Sirve el formulario web (`public/index.html`) |
| `GET` | `/health` | Health check |

---

## 5. Flujo completo de procesamiento

Este es el viaje completo de una factura, desde que el usuario la sube hasta que queda guardada:

```
Usuario sube archivo desde el form web o con curl
        │
        ▼
[Express] POST /api/receipts
        │  middleware: multer.single("file")
        │  → guarda el archivo en ./uploads/
        ▼
[receipts.controller.ts] createReceipt()
        │  valida que exista req.file
        │  extrae filePath, originalName, mimeType, size
        ▼
[receipts.service.ts] processReceipt()
        │
        ├─ PASO 1: getOcrProvider() → TesseractOcr | MockOcr
        │          ocr.extractText({ filePath, mimeType })
        │          → { text: string, confidence: number }
        │
        ├─ PASO 2: naiveParse(ocrOut.text)
        │          → base: Partial<ParsedReceipt>  (regex, sin costo, ~1ms)
        │
        ├─ PASO 3: getAiProvider() → OpenAiProvider | MockAi
        │          ai.structure(ocrOut.text)
        │          → aiStruct: Partial<ParsedReceipt>  (GPT-4o-mini)
        │
        ├─ PASO 4: ai.categorize({ rawText, items, vendorName })
        │          ↳ fallback: categorize(rawText)  ← palabras clave
        │          ↳ fallback final: primer Account de tipo expense en DB
        │          → categoryId: number
        │
        ├─ PASO 5: detectCurrency(rawText, aiStruct.currency)
        │          → currency: "EUR" | "USD" | "MXN" | ...
        │
        ├─ PASO 6: merge aiStruct ?? base  (IA tiene prioridad sobre regex)
        │          construye el objeto json final
        │
        └─ PASO 7: prisma.receipt.create({ data: { json, rawText, ... } })
                   → Receipt guardado en PostgreSQL
                   → se devuelve al controller → res.status(201).json(saved)
```

---

## 6. Paso 1 — Subida de archivo (Multer)

**Archivo:** `src/routes/receipts.routes.ts`

```typescript
const upload = multer({ dest: "uploads/" });
router.post("/", upload.single("file"), createReceipt);
```

- Multer recibe el multipart/form-data con campo `file`
- Guarda el archivo en `./uploads/` con un nombre aleatorio (sin extensión)
- Expone `req.file.path`, `req.file.originalname`, `req.file.mimetype`, `req.file.size` al controller
- Soporta imágenes (JPEG, PNG, WEBP) y PDFs

El controller llama inmediatamente a `processReceipt(filePath, meta)` pasando la ruta absoluta del archivo temporal.

---

## 7. Paso 2 — OCR: extracción de texto

**Archivo:** `src/services/ocr/ocr.tesseract.ts`

El OCR convierte la imagen o PDF en texto plano (`rawText`) que el resto del sistema puede procesar.

### 7.1 Selección del provider

```typescript
// src/services/ocr/index.ts
OCR_PROVIDER=tesseract  →  new TesseractOcr()
OCR_PROVIDER=mock       →  new MockOcr()     ← devuelve texto fijo para tests
```

### 7.2 Flujo para imágenes (JPEG, PNG, etc.)

Se ejecutan **dos pasadas** con distintas configuraciones de Tesseract y se elige la que produce mejor score:

```
extractFromImage(filePath)
│
├─ Pasada A: PSM.SINGLE_BLOCK
│  → óptimo para facturas impresas y bien estructuradas
│  → score = media ponderada de confidence (heurística interna)
│
├─ Pasada B: PSM.SPARSE_TEXT
│  → óptimo para recibos manuscritos o con texto disperso
│  → score calculado igual que A
│
└─ Devuelve el resultado con mayor score
   → { text: string, confidence: number }
```

Ambas pasadas usan el paquete de idiomas `eng+spa` (inglés + español), lo que permite reconocer correctamente:
- Palabras en español: "Subtotal", "Fecha", "Factura"
- Palabras en inglés: "Invoice", "Total", "Tax"
- Caracteres especiales: €, ñ, á, é, í, ó, ú

### 7.3 Flujo para PDFs

```
extractFromPdf(filePath)
│
└─ pdf-parse extrae el texto directamente del PDF digital
   → Mucho más rápido y preciso que OCR si el PDF tiene texto incrustado
   → confidence se infiere a 0.95 si hay texto, 0.1 si no
```

Si un PDF es solo una imagen escaneada (sin texto real), pdf-parse devuelve texto vacío y el sistema debería escalarlo a OCR visual. En la versión actual, si el texto extraído está vacío o es muy corto, el confidence será bajo y la IA compensará.

### 7.4 Output del OCR

```typescript
{ text: string, confidence: number }
// Ejemplo:
{
  text: "BORCELLE\nFecha: 15/08/2030\nDiseño web  1  100€  100€\nSubtotal  500€\nIVA 21%  105€\nTotal  500€",
  confidence: 0.87
}
```

---

## 8. Paso 3 — Parser de reglas (regex)

**Archivo:** `src/services/parsing/parser.ts`

El parser transforma el texto plano del OCR en un objeto `Partial<ParsedReceipt>` usando expresiones regulares. Es la primera línea de extracción: rápida (~1ms), sin costo y determinística.

### 8.1 Normalización previa

```typescript
const norm = rawText
  .replace(/\t|\r/g, " ")      // tabs y CR → espacio
  .replace(/[ ]{2,}/g, " ")    // múltiples espacios → uno solo
  .toLowerCase();               // minúsculas para matching case-insensitive
```

El texto original (con mayúsculas) se preserva para campos donde las mayúsculas importan (vendorName, customerName).

### 8.2 Extracción del total (`amount`)

Prueba patrones en orden de especificidad, devuelve el primer match:

```
1. "total a pagar: 500"
2. "importe total: 500"
3. "grand total: 500"
4. "amount due: 500"
5. "^total: 500"       ← anclado a inicio de línea (evita subtotal)
6. "\btotal\b ... 500" ← \b evita matchear dentro de "subtotal"
```

### 8.3 Extracción del subtotal (`subtotalAmount`)

```
1. "subtotal 500" o "subtotal: 500"   ← separador opcional para OCR que fusiona columnas
2. "sub total: 500"
3. "base imponible: 500"
4. "base gravable: 500"
5. "neto: 500"
```

> **Importante:** El separador entre "Subtotal" y el número es opcional (`[:\s=]?`). Esto resuelve el caso donde el OCR fusiona columnas de una tabla y produce "Subtotal500€" sin espacio.

### 8.4 Extracción del impuesto (`taxAmount`)

Este campo tenía el bug más crítico. La lógica anterior capturaba "21" (el porcentaje) en lugar de "105" (el monto en euros) para textos como "IVA 21% 105€". La lógica corregida usa 3 patrones en cascada:

```
Patrón 1: "IVA 21% 105€"  o  "IVA (21%): 105€"
          → Requiere que el % aparezca ANTES del monto
          → Garantiza que "21" (porcentaje) nunca sea capturado como monto

Patrón 2: "IVA: 105€"
          → Solo acepta dos puntos como separador (no whitespace)
          → Evita false positives cuando el monto va pegado al nombre

Patrón 3: "IVA 105€"
          → Solo whitespace como separador
          → Lookahead negativo: NO captura si lo que sigue es "dígitos+%"
          → Ejemplo: "IVA 21%" → no captura / "IVA 105€" → sí captura
```

### 8.5 Extracción del porcentaje de impuesto (`taxPercentage`)

```
1. "IVA 21%"    → captura "21"
2. "21% IVA"    → captura "21" (orden inverso)
3. Cualquier "21%" aislado con word boundaries
```

El resultado se valida: debe ser un número entre 0.01 y 100.

### 8.6 Extracción de fecha (`date`)

Tres formatos soportados, output siempre en `YYYY-MM-DD`:

```
"2024-03-15"  →  YYYY-MM-DD  →  "2024-03-15"
"15-03-2024"  →  DD-MM-YYYY  →  "2024-03-15"
"15 de marzo de 2024"  →  texto español  →  "2024-03-15"
```

El mapa de meses en español permite parsear los 12 meses: enero, febrero, ..., diciembre.

### 8.7 Extracción de número de factura (`invoiceNumber`)

Busca etiquetas como: `Factura`, `Invoice`, `Recibo`, `Nº`, `No.`, `Comprobante`, `Folio`, `Ticket`, `Ref`, seguidas de un identificador alfanumérico de al menos 3 caracteres.

```
"Factura No: F-0012345"  →  "F-0012345"
"Invoice #INV-2024-001"  →  "INV-2024-001"
```

### 8.8 Extracción del nombre del vendor

Estrategia de 3 pasos, en orden de confianza:

**Estrategia 1 — Ancla en tax ID:**
```
1. Encuentra la primera línea con NIT/RUC/CIF/EIN/etc.
2. Sube hasta 3 líneas hacia arriba recolectando candidatos
3. Un candidato válido NO es: fecha, teléfono, email, URL, dirección, ruido
4. Une los candidatos y limpia tokens basura ("FACTURA DE VENTA", etc.)
```

Ejemplo:
```
BORCELLE             ← candidato (línea -2)
Belén Castillo       ← candidato (línea -1)  ← resultado: "BORCELLE Belén Castillo"
CIF: B12345678       ← ancla
```

**Estrategia 2 — Primera línea en mayúsculas:**
Si no hay tax ID, busca la primera línea que tenga solo letras mayúsculas (patrón de razón social).

**Estrategia 3 — Primera línea no-ruido:**
Fallback: primera línea que no sea una palabra clave de metadata.

### 8.9 Identificaciones tributarias del vendor

Reconoce los formatos de tax ID de 7 países latinoamericanos y España:

| Tipo | País | Ejemplo |
|---|---|---|
| RUC | Perú | `20123456789` |
| RUC | Panamá | `8-123-456` |
| NIT | Colombia | `900.123.456-1` |
| CIF | España | `B12345678` |
| RIF | Venezuela | `J-12345678-9` |
| CUIT | Argentina | `20-12345678-9` |
| EIN | USA | `12-3456789` |

### 8.10 Nombre del cliente (`customerName`)

Solo extrae si hay una etiqueta explícita en el documento:

```
"Cliente: Juan García"          → "Juan García"
"Bill to: ACME Corp"            → "ACME Corp"
"Facturado a: María López"      → "María López"
"Sr. Pedro Ramírez"             → "Pedro Ramírez"
```

Si no hay etiqueta de cliente, devuelve `null`. Esto es clave para no confundir vendor con customer.

### 8.11 Método de pago (`paymentMethod`)

Mapeo de palabras clave a enum:

```
tarjeta / card / visa / mastercard   →  CARD
efectivo / cash / en efectivo        →  CASH
transferencia / bank transfer / wire →  TRANSFER
otro / other                         →  OTHER
```

Detecta también el patrón "Forma de pago: Transferencia" que es el formato estándar en facturas españolas.

### 8.12 Líneas de detalle (`items`)

Detecta filas de tabla con formato: `Descripción  Cantidad  PrecioUnit  Total`

```
"Diseño web  1  100 €  100 €"
→ { description: "Diseño web", quantity: 1, unitPrice: 100, total: 100 }
```

Validación de coherencia: `|qty × unitPrice - total| / total ≤ 10%`. Si no cuadra, la fila se descarta.

### 8.13 parseAmount — Detector de formato numérico

Detecta automáticamente el formato del número:

```
"1,234.56"  →  US/anglosajon  →  1234.56
"1.234,56"  →  EU/LATAM       →  1234.56
"1234"      →  entero plano   →  1234
"12.50"     →  decimal simple →  12.5
```

Algoritmo: el **último** separador (`.` o `,`) seguido de exactamente 1 o 2 dígitos es el decimal. El otro separador es de miles y se elimina.

---

## 9. Paso 4 — IA: estructuración de campos

**Archivo:** `src/services/ai/ai.openai.ts`

Después del parser de reglas, la IA actúa como segunda pasada para:
- Corregir campos que el OCR distorsionó
- Llenar campos que el regex no pudo capturar
- Interpretar facturas manuscritas o con layout inusual

### 9.1 Comunicación con el relay

No se usa el SDK oficial de OpenAI. En su lugar, se llama al relay de Prosperia vía HTTP con `axios`:

```
POST https://prosperia-openai-relay-production.up.railway.app/openai/chat
Headers:
  X-Prosperia-Token: andres-perez
Body: { model: "gpt-4o-mini", messages: [...], response_format: { type: "json_object" }, temperature: 0 }
```

El relay actúa como proxy: recibe la request, agrega la API key real de OpenAI que vive en el servidor del relay, y forwarda al endpoint de OpenAI. Esto permite que los candidatos usen OpenAI sin exponer ni tener una API key propia.

### 9.2 System prompt para `structure()`

El prompt instruye al modelo a devolver un JSON estricto con todos los campos del schema:

```json
{
  "amount": number | null,
  "subtotalAmount": number | null,
  "taxAmount": number | null,
  "taxPercentage": number | null,
  "type": "expense" | "income",
  "currency": "USD" | "EUR" | "COP" | "PEN" | "CLP" | "MXN" | "GBP" | null,
  "date": "YYYY-MM-DD" | null,
  "paymentMethod": "CARD" | "CASH" | "TRANSFER" | "OTHER" | null,
  "description": "string describing what was purchased" | null,
  "invoiceNumber": string | null,
  "vendorName": string | null,
  "vendorIdentifications": string[],
  "customerName": string | null,
  "customerIdentifications": string[],
  "items": [{ "description", "quantity", "unitPrice", "total" }]
}
```

Reglas críticas incluidas en el prompt:
- Los valores monetarios van sin símbolos ni separadores de miles (10000, no "$10,000")
- `taxPercentage` es solo el número (21, no "21%")
- La distinción vendor/customer es obligatoria (ver sección 13)
- `items` es obligatorio: si hay líneas de productos, DEBEN extraerse
- Tolerancia a errores OCR: "1OO" se interpreta como 100

### 9.3 Prioridad: IA sobre regex

En el service, cuando se construye el objeto final, la IA tiene prioridad:

```typescript
amount: aiStruct.amount ?? base.amount ?? null
//       ↑ IA primero    ↑ regex si IA falló   ↑ null si ninguno
```

Si la IA falla completamente (error de red, JSON inválido), se usa solo el resultado del regex.

---

## 10. Paso 5 — Categorización contable

**Archivos:** `src/services/ai/ai.openai.ts` + `src/services/parsing/categorizer.ts`

La categorización asigna el gasto a una **cuenta contable** (`Account`) de la base de datos. El sistema tiene tres niveles de fallback:

```
Nivel 1 — IA vía relay (primario)
│  Carga todas las cuentas de la DB
│  Pasa el contexto del recibo + lista de cuentas al modelo
│  El modelo devuelve { accountId: number, accountName: string }
│  El sistema verifica que el ID exista en DB
│  ↓ si falla
Nivel 2 — Heurística de palabras clave
│  Busca ~53 keywords en el texto del recibo
│  Mapea a nombre de cuenta (ej: "pizza" → "Alimentación")
│  Consulta DB para obtener el Account.id por nombre
│  ↓ si falla
Nivel 3 — Fallback final
   Consulta la primera cuenta de tipo "expense" en orden de ID
   Asegura que SIEMPRE haya una categoría (requerimiento del README)
```

### 10.1 Cómo funciona la categorización por IA

```
1. SELECT * FROM Account  → [{ id: 1, name: "Aseo/Limpieza", type: "expense" }, ...]
2. Construir contexto compacto:
   "Vendor: BORCELLE\nItems: Diseño web, Publicidad, Marketing\n<rawText>"
3. System prompt: "elige el account_id más apropiado de esta lista"
4. Response: { "accountId": 7, "accountName": "Software/Suscripciones" }
5. Verificar que account 7 exista en la lista cargada
6. Si el ID no existe, fallback por nombre: busca account cuyo name incluya "Software"
```

### 10.2 Cómo funciona la heurística de palabras clave

```typescript
const KEYWORD_MAP = [
  ["uber", "Transporte"],
  ["pizza", "Alimentación"],
  ["diesel", "Combustible"],
  ["netflix", "Software/Suscripciones"],
  // ...53 entradas total
]

// Primer keyword que aparece en el texto gana
for (const [kw, accountName] of KEYWORD_MAP) {
  if (text.includes(kw)) {
    return prisma.account.findFirst({ where: { name: accountName } })
  }
}
```

El orden del mapa importa: categorías más específicas van primero (ej: "gasolina" antes de "servicio") para evitar falsos positivos.

### 10.3 Cuentas disponibles (seeded)

| ID | Nombre | Tipo |
|---|---|---|
| 1 | Aseo/Limpieza | expense |
| 2 | Transporte | expense |
| 3 | Alimentación | expense |
| 4 | Servicios Públicos | expense |
| 5 | Combustible | expense |
| 6 | Papelería | expense |
| 7 | Software/Suscripciones | expense |
| 8 | Mantenimiento | expense |
| 9 | Impuestos (IVA/ITBMS) | tax |
| 10 | Ventas | income |
| 11 | Banco Principal | payment_account |
| 12 | Caja | payment_account |

---

## 11. Paso 6 — Detección de divisa

**Archivo:** `src/services/receipts.service.ts`

La divisa se detecta por señales inequívocas en el texto crudo del OCR, en orden de prioridad:

```
Símbolo €          →  EUR  (inequívoco, solo existe para euro)
Palabra "EUR"      →  EUR
Símbolo £          →  GBP
Palabra "USD"      →  USD
Texto "US$"        →  USD
Palabra "MXN"      →  MXN
Texto "México"     →  MXN
Palabra "COP"      →  COP
Texto "Colombia"   →  COP
Palabra "PEN"      →  PEN
Texto "S/."        →  PEN  (sol peruano, formato "S/. 15.00")
```

Si ninguna señal inequívoca se detecta (por ejemplo, solo aparece `$` sin contexto), se delega a la IA. Si la IA tampoco puede determinarlo, el default es `"USD"`.

El símbolo `$` es intencionalmente ambiguo: puede ser dólares americanos, pesos mexicanos, pesos colombianos, etc. Solo se resuelve con contexto adicional.

---

## 12. Paso 7 — Persistencia en base de datos

**Archivo:** `src/services/receipts.service.ts` + Prisma

El objeto final se construye con merge: la IA tiene prioridad sobre el regex, y ambos tienen prioridad sobre null:

```typescript
const json = {
  amount:           aiStruct.amount           ?? base.amount           ?? null,
  subtotalAmount:   aiStruct.subtotalAmount   ?? base.subtotalAmount   ?? null,
  taxAmount:        aiStruct.taxAmount        ?? base.taxAmount        ?? null,
  taxPercentage:    aiStruct.taxPercentage    ?? base.taxPercentage    ?? null,
  currency:         detectedCurrency,          // lógica de señales
  category:         categoryId,                // del proceso de categorización
  categoryName:     categoryName,              // enriquecido de DB
  categoryType:     categoryType,              // expense | income | tax | ...
  vendorName:       aiStruct.vendorName       ?? base.vendorName       ?? null,
  items:            aiStruct.items?.length
                      ? aiStruct.items
                      : base.items             ?? [],
  // ...resto de campos
};

const saved = await prisma.receipt.create({
  data: {
    originalName,  mimeType,  size,
    storagePath,   rawText: ocrOut.text,
    json,          // campo Json de Prisma — guarda el objeto completo
    ocrProvider: process.env.OCR_PROVIDER,
    aiProvider:  process.env.AI_PROVIDER,
  }
});
```

El modelo `Receipt` en la base de datos tiene:
- Los metadatos del archivo (nombre, tipo, tamaño, ruta)
- El texto crudo completo del OCR (`rawText`)
- El JSON estructurado completo con todos los campos extraídos
- El provider usado para OCR y para IA (para auditoría)
- Timestamps automáticos (`createdAt`, `updatedAt`)

---

## 13. ¿Quién vende y quién compra? (Vendor vs Customer)

Este es uno de los puntos de mayor complejidad. En una factura existen dos partes:

### El Vendor (emisor / vendedor)
- Es quien **emite** la factura y presta el servicio
- Suele aparecer en la **parte superior** del documento, con su logo y datos fiscales
- Su **tax ID** (CIF, NIT, RUC) está inmediatamente después de su nombre
- Ejemplo en Factura2: **BORCELLE** con datos de empresa arriba a la derecha

### El Customer (receptor / comprador)
- Es quien **recibe** la factura y paga el servicio
- Suele aparecer bajo etiquetas explícitas: "Cliente:", "Datos del cliente:", "Bill to:"
- Ejemplo en Factura2: **Alejandro Torres** bajo "Datos del cliente"

### Estrategia de distinción en el parser (regex)

```
vendorName:
  → Ancla en la primera línea con tax ID (CIF/NIT/RUC)
  → Sube hasta 3 líneas y recolecta candidatos
  → El vendor NUNCA tiene etiqueta "Cliente:" antes

customerName:
  → Solo si hay etiqueta explícita: /cliente|bill to|facturado a|sr\./
  → El valor es lo que viene después de los dos puntos
```

### Estrategia de distinción en la IA

El system prompt del `structure()` incluye reglas explícitas:
```
VENDOR vs CUSTOMER — CRITICAL distinction:
* vendorName = WHO ISSUES the receipt (the business/seller).
  Usually at the top, with the tax ID right after.
* customerName = WHO RECEIVES the receipt (the buyer).
  Found AFTER labels like "Cliente:", "Bill to:", "Facturado a:".
* vendorIdentifications = tax IDs of the SELLER only.
* customerIdentifications = tax IDs of the BUYER only.
* Never mix the two.
```

Resultado para Factura2.png:
```
vendorName:    "BORCELLE"
customerName:  "Alejandro Torres"
vendorIdentifications:  []   ← no hay CIF/NIT visible en imagen
customerIdentifications: []
```

---

## 14. Reconciliación financiera

**Archivo:** `src/services/parsing/parser.ts` → función `reconcile()`

Cuando el OCR falla en algún campo numérico pero capta otros, la función `reconcile` deduce el faltante por aritmética contable:

```
total = subtotal + tax

Si tenemos total + subtotal                → tax = total - subtotal
Si tenemos total + tax                     → subtotal = total - tax
Si tenemos total + subtotal + %impuesto    → tax = subtotal × (pct/100)
Si tenemos los 3 y son consistentes        → no tocar
Si total es null                           → no hay base para deducir nada
```

**Tolerancia del 3%** para absorber errores de redondeo del OCR:

```typescript
const near = (a, b) => Math.abs(a - b) / Math.max(Math.abs(a), 0.01) <= 0.03
// near(112, 108.64) → 108.64 vs 112 → diferencia 3% → true (dentro de tolerancia)
```

**Ejemplo real con Factura2.png:**
```
OCR extrae:  total=500, subtotal=500, taxAmount=105, taxPercentage=21
reconcile:   near(500 + 105, 500)?  → 605 ≠ 500 → no son consistentes
             → Devuelve {subtotal: 500, tax: 105} tal como fueron extraídos
             → El total no cuadra con subtotal+IVA porque la factura también
               tiene IRPF 7% (retención = -35€) que el parser no conoce aún
```

---

## 15. Modelo de base de datos

**Archivo:** `prisma/schema.prisma`

```
┌─────────────┐     ┌──────────────────┐
│   Receipt   │     │   Transaction    │
│─────────────│ 1─1 │──────────────────│
│ id (cuid)   │─────│ id (cuid)        │
│ originalName│     │ amount           │
│ mimeType    │     │ currency         │
│ size        │     │ date             │
│ storagePath │     │ type             │
│ rawText     │     │ paymentMethod    │
│ json (Json) │     │ accountId ───────┼──┐
│ ocrProvider │     │ vendorId ────────┼──┼──┐
│ aiProvider  │     │ receiptId        │  │  │
└─────────────┘     └──────────────────┘  │  │
                                          │  │
                    ┌─────────────┐        │  │
                    │   Account   │◄───────┘  │
                    │─────────────│           │
                    │ id          │           │
                    │ name        │           │
                    │ type (enum) │           │
                    │ parentId    │  (árbol)  │
                    └─────────────┘           │
                                              │
                    ┌─────────────┐           │
                    │   Vendor    │◄──────────┘
                    │─────────────│
                    │ id          │
                    │ name        │
                    │ legalName   │
                    └──────┬──────┘
                           │ 1─N
                    ┌──────┴───────────────┐
                    │  VendorIdentification │
                    │──────────────────────│
                    │ type (RUC/NIT/CIF)   │
                    │ value                │
                    └──────────────────────┘
```

### Tipos de cuenta (`AccountType`)

| Tipo | Descripción |
|---|---|
| `expense` | Gastos operativos (transporte, alimentación, etc.) |
| `income` | Ingresos por ventas o servicios |
| `tax` | Cuentas de impuestos (IVA, ITBMS) |
| `payment_account` | Cajas y cuentas bancarias |
| `account_payable` | Cuentas por pagar |
| `account_receivable` | Cuentas por cobrar |

---

## 16. Patrón de providers (OCR e IA)

La aplicación usa el **patrón Strategy** (interfaces + factories) para desacoplar la implementación del proveedor de su uso.

```
Interface OcrProvider              Interface AiProvider
├── extractText()                  ├── structure()
│                                  └── categorize()
├── TesseractOcr (real)            ├── OpenAiProvider (real)
└── MockOcr (tests)                └── MockAi (tests)

Factory: getOcrProvider()          Factory: getAiProvider()
  lee OCR_PROVIDER del .env          lee AI_PROVIDER del .env
  retorna la instancia correcta      retorna la instancia correcta
```

**Ventajas:**
- Cambiar de Tesseract a otro OCR (Google Vision, AWS Textract) solo requiere implementar la interface y cambiar la variable de entorno
- Los tests no necesitan archivos reales ni créditos de IA
- En desarrollo se puede trabajar sin configurar el relay usando `AI_PROVIDER=mock`

---

## 17. UI — Interfaz web

**Archivo:** `public/index.html`

La UI es una Single Page Application sin framework, servida como archivo estático.

**Flujo de uso:**
1. Usuario arrastra un archivo o usa el picker
2. JS hace `POST /api/receipts` con `FormData`
3. Muestra barra de progreso con 4 pasos: "Cargando → OCR → IA → Guardando"
4. Al recibir respuesta, renderiza el desglose completo:

```
┌─ Vendor: BORCELLE                    ┐
│  Fecha: 15/08/2030                   │
│  Factura: —                          │
│  Pago: Transferencia                 │
└──────────────────────────────────────┘
┌─ Cliente: Alejandro Torres           ┐
└──────────────────────────────────────┘
┌─ Resumen financiero                  ┐
│  Subtotal:  500,00 €                 │
│  IVA (21%):  105,00 €                │
│  TOTAL:     500,00 €                 │
└──────────────────────────────────────┘
┌─ Categoría: Software/Suscripciones   ┐
│  Tipo: expense                       │
└──────────────────────────────────────┘
┌─ Líneas de detalle                   ┐
│  Diseño web     1  100€  100€        │
│  Publicidad     1  100€  100€        │
│  Marketing      1  100€  100€        │
│  Asistencia web 1  100€  100€        │
└──────────────────────────────────────┘
┌─ OCR: tesseract  IA: openai  87%     ┐
└──────────────────────────────────────┘
```

La UI mapea iconos a categorías (🍔 Alimentación, 🚗 Transporte, etc.) y formatea montos usando `Intl.NumberFormat` con la divisa detectada.

---

## 18. Tests

**Archivo:** `src/services/parsing/parser.test.ts`

Los tests cubren el parser de reglas (la capa determinística):

### Cobertura actual

| Suite | Casos | Qué prueba |
|---|---|---|
| `parseAmount` | 6 | US format, EU format, entero, decimal, vacío, no-numérico |
| `extractTotal` | 4 | "total: $X", "total a pagar", "grand total", texto sin total |
| `extractSubtotal` | 3 | "subtotal:", "base imponible:", "neto:" |
| `extractTax` | 3 | "iva 12%: 12.00", "tax: 8.50", "igv: 18.00" |
| `extractTaxPercentage` | 3 | "iva 12%", "19% de iva", sin porcentaje |
| `extractDate` | 4 | YYYY-MM-DD, DD-MM-YYYY, texto español, sin fecha |
| `extractVendorName` | 2 | línea mayúsculas, fallback a primera línea no-ruido |
| `extractVendorIds` | 4 | RUC Perú, NIT Colombia, EIN USA, sin IDs |
| `reconcile` | 5 | consistentes, deducir tax, deducir subtotal, deducir de pct, total null |
| `naiveParse` (integración) | 1 | factura completa con todos los campos |

### Ejecutar tests

```bash
npm test              # una sola pasada
npm run test:watch    # modo watch (re-corre al guardar)
```

### Tests pendientes de agregar

Los siguientes casos mejorarían la cobertura dado el análisis del código:

```typescript
// parser.test.ts — casos recomendados a agregar

describe("extractTax — formato IVA porcentaje-luego-monto", () => {
  it("no captura el porcentaje como monto en 'IVA 21% 105€'", () =>
    expect(extractTax("iva 21% 105€")).toBe(105));

  it("no captura el porcentaje en 'IVA 21 % 105 €' (con espacios)", () =>
    expect(extractTax("iva 21 % 105 €")).toBe(105));

  it("extrae con patrón '(21%): 105'", () =>
    expect(extractTax("iva (21%): 105")).toBe(105));
});

describe("extractSubtotal — sin separador (OCR column-merge)", () => {
  it("extrae 'subtotal500' sin separador", () =>
    expect(extractSubtotal("subtotal500")).toBe(500));

  it("extrae 'subtotal 500€' con espacio normal", () =>
    expect(extractSubtotal("subtotal 500€")).toBe(500));
});

describe("reconcile — casos especiales", () => {
  it("no sobrescribe cuando los tres valores son inconsistentes (ej: factura con IRPF)", () =>
    expect(reconcile(500, 500, 105, 21)).toEqual({ subtotal: 500, tax: 105 }));
});

describe("parseAmount — edge cases adicionales", () => {
  it("maneja '500€' (con símbolo pegado)", () =>
    expect(parseAmount("500")).toBe(500));

  it("maneja '1.000' como mil (EU)", () =>
    expect(parseAmount("1.000")).toBe(1000));
});
```

---

## 19. Variables de entorno

| Variable | Valores | Descripción |
|---|---|---|
| `NODE_ENV` | `development` \| `production` | Afecta formato de logs y optimizaciones |
| `PORT` | número (default: 3000) | Puerto del servidor HTTP |
| `DATABASE_URL` | PostgreSQL connection string | URL de conexión a Neon o Postgres local |
| `OCR_PROVIDER` | `tesseract` \| `mock` | Provider de OCR a usar |
| `AI_PROVIDER` | `openai` \| `mock` | Provider de IA a usar |
| `UPLOAD_DIR` | path (default: `./uploads`) | Directorio donde Multer guarda los archivos |
| `OPENAI_BASE_URL` | URL del relay | Endpoint del relay de Prosperia |
| `PROSPERIA_TOKEN` | `nombre-apellido` | Token de acceso al relay (tu nombre) |

---

## 20. Diagrama de arquitectura

```
┌──────────────────────────────────────────────────────────────────┐
│                        CLIENTE                                   │
│  Browser (public/index.html)  o  curl / Postman                  │
└────────────────────────────┬─────────────────────────────────────┘
                             │  POST /api/receipts
                             │  multipart/form-data: file
                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                      EXPRESS APP (app.ts)                         │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  receipts.routes.ts                                        │  │
│  │  multer.single("file") → guarda en ./uploads/             │  │
│  │  → receipts.controller.ts → createReceipt()               │  │
│  └────────────────────┬───────────────────────────────────────┘  │
└───────────────────────┼──────────────────────────────────────────┘
                        │
                        ▼
┌──────────────────────────────────────────────────────────────────┐
│               receipts.service.ts — processReceipt()             │
│                                                                  │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────┐  │
│  │ OCR LAYER    │   │ PARSE LAYER  │   │    AI LAYER          │  │
│  │              │   │              │   │                      │  │
│  │ TesseractOcr │   │ naiveParse() │   │  OpenAiProvider      │  │
│  │  ├ image:    │   │  ├ total     │   │   ├ structure()      │  │
│  │  │ 2 passes  │→  │  ├ subtotal  │→  │   │  GPT-4o-mini     │  │
│  │  │ best conf │   │  ├ tax       │   │   │  JSON mode       │  │
│  │  └ pdf:      │   │  ├ date      │   │   └ categorize()     │  │
│  │    pdf-parse │   │  ├ vendor    │   │     carga cuentas DB │  │
│  │              │   │  ├ customer  │   │     prompt + lista   │  │
│  │  {text,conf} │   │  ├ items     │   │                      │  │
│  └──────────────┘   │  └ reconcile │   │  ↓ fallback:         │  │
│                     └──────────────┘   │  categorizer.ts      │  │
│                                        │  (53 keywords)       │  │
│                                        └──────────────────────┘  │
│                                                                  │
│  detectCurrency()  →  merge(aiStruct ?? base)  →  json final     │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│                    PRISMA ORM                                     │
│  prisma.receipt.create({ data: { json, rawText, ... } })         │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│              POSTGRESQL (Neon cloud / Docker local)               │
│  Receipt table: id, json, rawText, mimeType, ocrProvider, ...    │
│  Account table: categorías contables (seeded)                    │
│  Vendor table:  vendedores registrados                           │
└──────────────────────────────────────────────────────────────────┘

                        SERVICIOS EXTERNOS
┌──────────────────────────────────────────────────────────────────┐
│  relay: prosperia-openai-relay-production.up.railway.app         │
│  ├ POST /openai/chat  (structure + categorize)                   │
│  └ Header: X-Prosperia-Token: andres-perez                       │
│  El relay agrega la API key real de OpenAI en su servidor        │
└──────────────────────────────────────────────────────────────────┘
```

---

## Resumen de garantías del sistema

| Escenario | Comportamiento |
|---|---|
| OCR produce texto perfecto | Parser regex extrae todo; IA confirma o mejora |
| OCR fusiona columnas sin espacio | `extractSubtotal` aún funciona (separador opcional) |
| OCR produce "IVA 21% 105€" | `extractTax` captura 105, no 21 (patrón corregido) |
| IA falla por red o timeout | Se usa solo el resultado del regex |
| IA no puede categorizar | Se usa heurística de palabras clave |
| Heurística no encuentra match | Se usa primer account de tipo `expense` |
| Archivo es PDF digital | pdf-parse extrae texto sin OCR visual (más rápido) |
| Archivo es PDF escaneado (imagen) | Tesseract actúa como fallback si pdf-parse devuelve vacío |
| Divisa es $ sin contexto | Se delega a IA; default USD si IA tampoco lo sabe |
| Total ≠ subtotal + tax (ej: IRPF) | reconcile preserva valores extraídos sin forzar coherencia |
