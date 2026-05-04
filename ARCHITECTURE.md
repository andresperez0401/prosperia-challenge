# Mini-Prosperia — Arquitectura

Documento que cuenta, con lenguaje sencillo, cómo viaja un archivo desde que el usuario lo sube hasta que el sistema devuelve los datos estructurados. Si lees este documento de principio a fin, entiendes todo el pipeline.

---

## Stack tecnológico

- **Runtime:** Node.js 20 con TypeScript (ESM).
- **API:** Express. Multer maneja la subida de archivos.
- **Base de datos:** PostgreSQL accedida con Prisma.
- **OCR:** Tesseract.js, configurado para leer inglés y español.
- **Imagen:** Sharp para preprocesar antes del OCR.
- **PDF:** `pdf-parse` saca texto directo si el PDF lo trae embebido; `pdfjs-dist` con `@napi-rs/canvas` rasteriza a imagen sin depender de binarios externos; `pdf2pic` (con GraphicsMagick + Ghostscript) queda como último recurso.
- **IA:** OpenAI vía relay de Prosperia o DeepSeek directo. Hay un proveedor "Mock" como salvavidas.
- **Frontend:** HTML, CSS y JavaScript planos en `public/`.

Patrón estricto **Route → Controller → Service**. Las rutas solo declaran endpoints. Los controllers solo manejan request/response. Toda la lógica vive en los services, que no saben nada de Express.

---

## El viaje completo de una factura

Imagina que el usuario abre la web, elige una foto de una factura y aprieta "Subir". Esto es lo que pasa, en orden.

### Paso 1 — Llega el archivo a la API

El navegador hace `POST /api/receipts` con el archivo en form-data. El primer punto de contacto es `routes/receipts.routes.ts`.

Antes de pasar el control al controller, **Multer hace dos verificaciones**:
- El archivo no puede pesar más de 10 MB (configurable con `MAX_UPLOAD_BYTES`).
- El mime type tiene que ser PDF, PNG, JPEG o WebP. Cualquier otra cosa se rechaza ahí mismo.

Si pasa, Multer mantiene el archivo en memoria. El controller entrega el buffer al service y el service decide dónde persistir el archivo original.

**Camino principal: Cloudinary.** `processUploadedReceipt()` llama a `uploadReceiptToCloudinary()`. El archivo se sube como asset público (`type=upload`, `access_mode=public`), se toma la `secure_url`, y el service valida que esa URL responda públicamente por HTTP. Para OCR/PDF no se lee desde Cloudinary: se escribe un temporal local, se procesa con Tesseract/pdfHandler, y ese temporal se borra al terminar.

**Fallback simple: servidor local.** Si Cloudinary falla, no está configurado, o rechaza la entrega pública (por ejemplo PDFs bloqueados), el service llama a `saveReceiptLocally()`. Esto guarda el archivo original en `UPLOAD_DIR`, igual que el comportamiento anterior a Cloudinary: el pipeline procesa ese archivo local y en DB queda `storagePath` apuntando a la ruta del servidor. En este caso `fileUrl` queda vacío porque no hay URL pública.

### Paso 2 — El controller delega

`controllers/receipts.controller.ts/createReceipt` solo hace tres cosas: revisa que efectivamente llegó el archivo, llama a `processUploadedReceipt(buffer, meta)` y devuelve el resultado con status 201. No conoce Prisma, ni la IA, ni el OCR. Simplemente HTTP in / HTTP out.

### Paso 3 — El service orquesta el pipeline

`services/receipts.service.ts/processReceipt` es el cerebro. Llama a cada subservicio en orden y combina los resultados. Pasos del 3a al 3l explican cada parada.

#### 3a — ¿Es un PDF?

Si el archivo es PDF, `services/pdf/pdfHandler.ts` lo intercepta antes de cualquier OCR. Prueba tres estrategias en cascada:

1. **Texto embebido directo.** `pdf-parse` lee el PDF. Si el resultado tiene al menos 80 caracteres, contiene números y palabras, lo damos por bueno. Esto es lo que pasa con la mayoría de facturas electrónicas tipo DGI/SENIAT que vienen con texto vectorial — saltamos OCR completo, ahorramos varios segundos.
2. **Rasterización pura JS.** Si no hay texto embebido (o es basura), convertimos cada página a PNG con `pdfjs-dist` + `@napi-rs/canvas`. No requiere binarios nativos, funciona en Windows sin instalar nada. La escala es 2.0× (~144 DPI), suficiente para OCR sin reventar la RAM.
3. **`pdf2pic` como fallback.** Si la rasterización JS falla, intentamos con `pdf2pic`, que requiere GraphicsMagick y Ghostscript instalados. Es la opción más cara pero a veces salva PDFs muy raros.

Para PDFs multipágina, cada página corre OCR por separado y los textos se concatenan. La confianza global se promedia.

Si el archivo NO es PDF (es JPG, PNG, etc.), saltamos directo al paso siguiente con `pdfMethod = "image"`.

#### 3b — Preparar la imagen para OCR

`services/image/preprocessImage.ts` toma la imagen original y prepara hasta **tres versiones diferentes** del mismo archivo. La idea es: no sabemos cuál preprocesado le caerá mejor a Tesseract, así que probamos varias y nos quedamos con la que dé mejor lectura.

Las tres variantes:

- **`normalized`** — escala de grises, normalización de niveles, sharpen suave. Es la opción "amigable" para escaneos limpios o fotos con buena luz.
- **`threshold-N`** — binarización agresiva (todo se vuelve blanco o negro puro). Funciona bien con tickets térmicos, fotocopias borrosas o impresiones grises.
- **`darkened-N`** — aumento fuerte de contraste (`linear 1.4× -20`), sharpen agresivo, threshold alto. Es para fotos de celular con tinta gastada, ambientes oscuros, recibos viejos.

Antes de cualquier transformación, Sharp calcula el gris promedio de la imagen. Si está debajo de 110 (imagen oscura, fondo negro con texto blanco) **invierte los colores automáticamente**, así Tesseract siempre ve texto oscuro sobre fondo claro.

También limita el ancho a 2200px para acotar memoria/CPU.

#### 3c — Tesseract lee cada variante

`services/ocr/ocr.tesseract.ts` recibe las variantes y para cada una prueba **tres modos de segmentación de página (PSM)** en este orden:

1. **PSM 6 (single block)** — para facturas con texto denso bien estructurado.
2. **PSM 4 (single column)** — para layouts con dos columnas verticales (etiqueta + valor a la derecha).
3. **PSM 11 (sparse text)** — para tickets pequeños con texto disperso sobre mucho espacio en blanco.

Cada intento recibe un `compositeScore` que pondera: confianza promedio del OCR (×10), cantidad de montos detectados (×5), palabras clave fiscales (`TOTAL`, `IVA`, `RIF`, `RUC`...) (×10), tax IDs (×10) y un bonus por longitud de texto (máx 10).

Hay **early-exit en dos niveles** para no quemar tiempo cuando ya tenemos algo bueno:
- Dentro de una variante: si el primer PSM da score ≥ 40 con confianza ≥ 0.60, no probamos los demás PSMs.
- Entre variantes: si una variante completa da score ≥ 60 con confianza ≥ 0.65, no procesamos las restantes.

El worker de Tesseract es **singleton**: arrancarlo cuesta ~1 segundo, así que se reusa entre requests. Al apagar el servidor con `SIGTERM/SIGINT` se cierra limpio.

#### 3d — La materia prima del OCR

Tesseract no devuelve solo texto plano; devuelve un objeto rico:

```typescript
OcrResult {
  text: string;              // texto unido por saltos de línea
  confidence: number;        // 0..1, promedio de la página
  words: OcrWord[];          // cada palabra con bbox {x0,y0,x1,y1} + confidence individual
  lines: OcrLine[];          // líneas con bbox + words[] anidadas
  selectedVariant?: string;  // qué variante ganó (normalized | threshold-160 | darkened-190)
  selectedPsm?: number;      // qué PSM ganó (4, 6 u 11)
}
```

Lo crítico no es `text`, son los `bbox` por palabra. Con ellos podemos reconstruir la estructura visual de la factura aunque Tesseract haya devuelto las líneas en orden raro.

#### 3e — Reconstruir el layout

`services/ocr/reconstructLayout.ts` traduce las posiciones de Tesseract en texto bien alineado. Sin este paso, "TOTAL" en una línea y "15,212.97" en la siguiente quedarían separados, y los regex no harían match.

Hace tres cosas:

1. **Agrupa palabras por fila vertical.** Si Tesseract ya devolvió `lines[]`, las usa directamente ordenadas por `y0`. Si no, agrupa palabras sueltas: dos palabras pertenecen a la misma fila si su diferencia de `y0` es menor al 60% de la altura promedio de palabra.
2. **Ordena cada fila por X.** Dentro de la fila, izquierda a derecha por `x0`.
3. **Inserta espacios proporcionales al gap horizontal.** Mide la distancia entre el final de una palabra y el comienzo de la siguiente:
   - Gap muy grande (≥ 6 anchos de carácter) → 4 espacios. Probable separador de columnas: `TOTAL    15,212.97`.
   - Gap mediano (2–5) → 2 espacios.
   - Gap chico → 1 espacio normal.

Como bonus, intenta extraer `tableRows`: pares `label: value` con dos puntos, o `label    value` separados por 4+ espacios. Esto ayuda mucho a la IA después.

Si el texto vino de un PDF con texto embebido (sin bbox), simplemente hace `split("\n")` y `tableRows` queda vacío.

#### 3f — Reglas determinísticas extraen lo obvio

Antes de molestar a la IA, `services/parsing/parseReceipt.ts` corre regex sobre el texto reconstruido. Esto es cero costo y atrapa los campos que se extraen sin ambigüedad.

Siempre arranca el **GenericReceiptParser** (basado en `parser.ts/naiveParse`) que busca: total, subtotal, IVA, vendor, fecha, número de factura, identificaciones (RIF/RUC/NIT), items, método de pago.

Después prueba **parsers especializados por país**: hoy hay `PanamaDgiParser` (Panamá DGI) y `SeniatVenezuelaParser` (Venezuela SENIAT). Cada uno se autoevalúa con `detect(ctx)` devolviendo un score 0..1 según señales como "SENIAT", "DGI", "RIF", "Bs". El de mayor score que pase 0.5 superpone sus campos sobre los del genérico (solo donde no son `null`).

El resultado es `{ fields, parserName, warnings }`.

#### 3g — Construir candidatos para la IA

El service no le manda solo el texto crudo a la IA; le manda **listas exhaustivas de candidatos** ya pre-procesados. Esto reduce alucinaciones y ahorra tokens. Cada función vive en `parser.ts`:

| Función | Qué devuelve | Para qué sirve |
|---|---|---|
| `extractAllTotalCandidates` | Lista de líneas con keyword tipo `TOTAL/SUBTOTAL/TTL/IMPORTE/MONTO`, cada una con un `role` (`final`/`subtotal`/`tax`/`line`/`ambiguous`) | La IA elige el `role:"final"` correcto sin confundir con subtotal |
| `extractAllSubtotalCandidates` | Líneas tipo "Subtotal", "Base imponible", "Net amount" | Para que la IA confirme el subtotal |
| `extractAllTaxCandidates` | Líneas con IVA/ITBMS/VAT/IGV/Impuesto, ya filtrando porcentajes solos | Monto del impuesto |
| `extractRawLabeledFields` | Diccionario `{Emisor, Cliente, RUC, RIF, Fecha de Emisión, Dirección, ...}` | Pares clave-valor literales del texto |
| `extractVendorCandidates` | Top 10 líneas plausibles como nombre del comercio | Filtra encabezados, organismos fiscales, tipos de documento ("Factura Electrónica", "Comprobante", etc.) |
| `extractCustomerCandidates` | Solo lo que aparece tras marcadores tipo `Cliente:`, `Receptor:`, `Bill To:` | Distingue cliente de vendedor |
| `extractClassifiedIdentifications` | Lista `[{value, section: "vendor"\|"customer"\|"unknown", label}]` | Cada RIF/RUC/NIT etiquetado por la sección donde apareció |

Las regex que reconocen palabras clave (`TOTAL_TOKEN`, `TAX_TOKEN`) son **tolerantes a confusiones de OCR**: aceptan "T0TAL", "T0T4L", "lMPORTE", "1VA", "lVA" para que líneas mal leídas igual entren como candidatos. La IA decide después qué role tienen.

#### 3h — Cargar las cuentas contables

`prisma.account.findMany()` saca todas las cuentas activas del catálogo. Esta consulta se **cachea en memoria 60 segundos** para no golpear la BD en cada subida.

Las cuentas se serializan compactas como `"id|nombre"` y van en el prompt de la IA para que pueda elegir una directamente.

#### 3i — Una sola llamada a la IA

`services/ai/index.ts/getAiProvider()` decide qué proveedor usar según `AI_PROVIDER`:
- `openai` → OpenAI vía relay Prosperia (modelo `gpt-4o-mini`)
- `deepseek` → DeepSeek API directa
- `auto` → cadena `OpenAiProvider → DeepSeekProvider → MockAi` (`FallbackAiProvider`)
- `mock` → solo regex local (para desarrollo)

`ai.structure(input)` hace **una única llamada** que estructura los campos faltantes Y categoriza al mismo tiempo. Antes era una llamada por cosa; consolidar ahorra tokens y latencia.

El prompt está en `services/ai/prompt.ts`. Es compacto (~600 tokens), en español, con reglas anti-alucinación: "sin evidencia → null", "no uses tipos de documento como vendorName", "amount = TOTAL FINAL no subtotal", etc.

Lo que la IA recibe en el `user` message (JSON serializado):

```
rawText                  ← texto OCR plano (capado a 8000 chars)
reconstructedText        ← versión alineada de 3e (si difiere del raw)
partialFields            ← lo que ya encontraron las reglas (hints)
warnings                 ← incidencias del parser
totalCandidates[]        ← con role hint
subtotalCandidates[]
taxCandidates[]
labeledFields            ← {Emisor:..., Cliente:..., RUC:...}
vendorCandidates[]
customerCandidates[]
identifications[]        ← cada ID con sección {vendor|customer|unknown}
tableRows[]              ← pares label:value alineados por bbox (muy confiables)
accounts                 ← lista compacta "id|nombre" para categorizar
```

La IA devuelve un JSON con todos los campos + `recommendedAccountId`. `parseStructureJson()` valida la respuesta:
- Verifica que el `accountId` exista realmente en la BD. Si no, intenta fuzzy match por nombre. Si nada, queda `null`.
- Coerciona tipos (números, strings, arrays).
- Solo acepta currencies de la lista soportada.

**Si la IA falla en `auto`:** `FallbackAiProvider` captura el error, intenta el siguiente provider de la cadena, y agrupa todos los warnings en `_aiWarnings`. Estos warnings se inyectan en `extraFields["Advertencias IA"]` para que la UI los muestre.

#### 3j — Combinar reglas con IA (merge)

Tenemos dos fuentes: lo que extrajeron las reglas (`base`) y lo que devolvió la IA (`aiStruct`). Hay que combinarlas con criterio:

- **Campos financieros** (`amount`, `subtotalAmount`, `taxAmount`, `taxPercentage`): la IA siempre gana. Vio todos los candidatos con su role, tiene mejor contexto.
- **Identidad** (`vendorName`, `customerName`): la IA solo corrige si la regla dejó vacío o devolvió un valor "feo" — códigos de terminal tipo `DC001`, `POS-1`, `Comprobante`, `Factura de Operacion`, `DGI`. Si la regla devolvió algo limpio, se respeta.
- **IDs** (`vendorIdentifications`, `customerIdentifications`): la IA llena solo si la regla devolvió array vacío.
- **Resto**: la IA llena lo que la regla dejó `null`.

Después del merge se hace una **limpieza de nombres**: si `vendorName` o `customerName` tienen 4+ espacios consecutivos, se corta ahí. Esa secuencia de espacios viene del paso 3e como separador de columnas, así que cualquier cosa que aparezca después es ruido pegado de otra columna.

#### 3k — Matemática de validación

`services/parsing/computeFields.ts` rellena huecos financieros con aritmética: `subtotal + taxAmount = amount`. Solo rellena lo que está en `null`, nunca pisa valores existentes. Tolerancia de 6 centavos para errores de redondeo. Si tenemos dos de los tres, calcula el tercero. Si tenemos amount y taxPercentage, infiere subtotal y tax.

#### 3l — Categoría: red de seguridad

Si la IA no devolvió categoría (poco probable, pero pasa), `services/parsing/categorizer.ts` busca por keywords en el texto: `uber → Transporte`, `restaurant → Alimentación`, `aws → Software/Suscripciones`, etc. Si tampoco matchea, último recurso: la primera cuenta de tipo `expense` que exista. Mejor algo que nada.

#### 3m — Detección de moneda

`services/parsing/detect.currency.ts` aplica patrones explícitos sobre el texto:
- `Bs` o `Bs.` → VES (Venezuela)
- `ITBMS`, `B/.`, `Panamá` → PAB
- `€` → EUR
- `S/.` → PEN
- `RFC` o `México` → MXN
- etc.

Si nada matchea, usa lo que dijo la IA. Si tampoco, default `USD`.

#### 3n — Persistir en BD

`prisma.receipt.create()` guarda:
- Metadatos del archivo (`originalName`, `mimeType`, `size`, `storagePath`).
- URL pública de Cloudinary (`fileUrl`) y metadatos opcionales (`cloudinaryPublicId`, `cloudinaryResourceType`) cuando Cloudinary funcionó.
- Si Cloudinary funcionó, `storagePath` apunta a la URL pública. Si falló, `storagePath` apunta al archivo local en `UPLOAD_DIR`, como antes de Cloudinary, y `fileUrl` queda vacío.
- `rawText` en columna propia (preservado intacto, sin truncar).
- `json` con todos los campos estructurados + un objeto `pipeline` que registra:
  - `pdfMethod`: `"direct"` (PDF con texto), `"ocr"` (PDF rasterizado) o `"image"` (no era PDF).
  - `parserUsed`: qué parser/parsers corrieron, ej. `"GenericReceiptParser + PanamaDgiParser"`.
- `ocrProvider` y `aiProvider` reales — no `"auto"`, sino la clase concreta que efectivamente respondió: `OpenAiProvider`, `DeepSeekProvider`, `MockAi` o `None (All Failed)`.

### Paso 4 — Respuesta al usuario

El controller serializa el registro creado y lo devuelve con HTTP 201. El frontend lo recibe y muestra el resultado inmediato.

La tabla de "Facturas procesadas" siempre se obtiene desde la BD mediante `GET /api/receipts` (`prisma.receipt.findMany`). Al cargar la página y después de cada procesamiento, la UI vuelve a consultar ese endpoint en vez de mutar la tabla solo en memoria.

---

## Otros endpoints

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/receipts` | Lista las últimas 100 facturas desde la BD para alimentar la tabla de facturas procesadas. |
| `GET` | `/api/receipts/:id` | Detalle por ID. 404 si no existe. |
| `POST` | `/api/receipts/:id/reparse` | Vuelve a procesar el archivo original con el pipeline actual. Útil cuando se mejora un parser y quieres re-evaluar facturas viejas. Si `storagePath` es una URL de Cloudinary, lo descarga a un temporal y lo borra al finalizar. |
| `GET` | `/health` | Liveness simple. |
| `GET` | `/api/relay/ping` | Test de conectividad al relay OpenAI. Devuelve latencia y modelo. |

---

## Variables de entorno

```env
DATABASE_URL=postgresql://...

AI_PROVIDER=auto                 # auto | openai | deepseek | mock
OPENAI_BASE_URL=https://prosperia-openai-relay-production.up.railway.app
PROSPERIA_TOKEN=<token>
DEEPSEEK_API_KEY=sk-...

OCR_PROVIDER=tesseract           # tesseract | mock
TESSDATA_DIR=.                   # carpeta con eng.traineddata + spa.traineddata

PORT=3010
MAX_UPLOAD_BYTES=10485760        # opcional, default 10MB
UPLOAD_DIR=./uploads             # fallback local si Cloudinary falla

CLOUDINARY_CLOUD_NAME=<cloud-name>
CLOUDINARY_API_KEY=<api-key>
CLOUDINARY_API_SECRET=<api-secret>
CLOUDINARY_FOLDER=prosperia/receipts
```

---

## Estructura del repo

```
src/
  app.ts                       → bootstrap Express, monta routers, error handler global
  server.ts                    → listen() + shutdown limpio (SIGTERM/SIGINT cierra Tesseract)

  routes/                      → solo endpoints + middlewares (Multer, etc.)
    receipts.routes.ts
    transactions.routes.ts
    relay.routes.ts

  controllers/                 → maneja req/res, sin lógica de negocio
    receipts.controller.ts
    transactions.controller.ts
    relay.controller.ts

  services/
    receipts.service.ts        → orquesta el pipeline completo (processReceipt + list/get/reparse)
    relay.service.ts           → ping al relay OpenAI

    pdf/
      pdfHandler.ts            → estrategia en cascada: pdf-parse → pdfjs-dist → pdf2pic
      pdfRasterize.ts          → render página a PNG con pdfjs-dist + canvas

    image/
      preprocessImage.ts       → 3 variantes Sharp (normalized, threshold, darkened)

    ocr/
      ocr.tesseract.ts         → Tesseract worker singleton, 3 PSMs, score-based pick
      reconstructLayout.ts     → bbox → texto alineado por columnas + tableRows
      ocr.interface.ts         → contrato OcrProvider
      ocr.mock.ts              → placeholder para tests
      index.ts                 → getOcrProvider()

    parsing/
      parseReceipt.ts          → orquestador de parsers (genérico + especializados)
      parser.ts                → naiveParse + extractores de candidatos
      computeFields.ts         → matemática subtotal+tax≈total
      categorizer.ts           → keywords → cuenta contable (fallback)
      detect.currency.ts       → detección de moneda por patrones
      parsers/
        genericReceiptParser.ts
        seniatVenezuelaParser.ts
        panamaDgiParser.ts
        parserInterface.ts
      normalizers/
        normalizeAmount.ts     → "1.234,56" / "1,234.56" → 1234.56
        normalizeDate.ts       → 20+ formatos → YYYY-MM-DD
        normalizeCurrency.ts
        normalizeIdentification.ts → RIF/RUC/NIT con formato regional

    ai/
      index.ts                 → getAiProvider() según AI_PROVIDER
      ai.interface.ts          → contrato AiProvider + StructureInput + AiStructureResult
      ai.openai.ts             → OpenAiProvider (relay Prosperia, json_object mode)
      ai.deepseek.ts           → DeepSeekProvider (API directa)
      ai.mock.ts               → MockAi (regex, fallback final)
      ai.fallback.ts           → FallbackAiProvider (cadena)
      prompt.ts                → STRUCTURE_SYSTEM_PROMPT + buildStructurePrompt + parseStructureJson

  config/
    env.ts                     → carga .env
    logger.ts                  → pino logger

  db/
    client.ts                  → instancia única de PrismaClient (compartida)

  types/
    receipt.ts                 → ParsedReceipt, OcrResult, OcrWord, OcrLine, Item

  utils/
    errors.ts                  → HttpError

prisma/                        → schema + migrations + seed (cuentas iniciales)
public/                        → UI estática (HTML/CSS/JS)
samples/                       → facturas de prueba
uploads/                       → fallback local cuando Cloudinary falla

tests/
  parsing/                     → un archivo por función del parser (10 archivos, 55 tests)
    parseAmount.test.ts
    extractTotal.test.ts
    extractSubtotal.test.ts
    extractTax.test.ts
    extractTaxPercentage.test.ts
    extractDate.test.ts
    extractVendorName.test.ts
    extractVendorIds.test.ts
    reconcile.test.ts
    naiveParse.test.ts
```

---

## Tests

### Dónde viven

```
tests/
  parsing/
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

Cada archivo prueba una sola función. El framework es **Vitest**. No requiere configuración extra: lee TypeScript directamente y corre en Node.

### Cómo correrlos

```bash
# Corre todos los tests una vez y muestra el resultado
npm test

# Modo watch: re-ejecuta automáticamente al guardar un archivo
npm run test:watch
```

### Qué prueban

El archivo tiene **55 tests** organizados en grupos (`describe`). Cada grupo cubre una función del parser:

**`parseAmount`** — verifica que el normalizador de montos entiende los dos formatos más comunes en Latinoamérica: el europeo (punto como separador de miles, coma como decimal: `1.234,56`) y el americano (coma como miles, punto como decimal: `1,234.56`). También prueba enteros, decimales simples, strings vacíos y texto no numérico.

**`extractTotal`** — confirma que la función encuentra el total en frases como `"total: $12.50"`, `"total a pagar: 100.00"` y `"grand total: 99.99"`, y devuelve `null` cuando no hay ninguna.

**`extractSubtotal`** — prueba variantes de la etiqueta: `"subtotal: 50.00"`, `"base imponible: 80.00"`, `"neto: 90.00"`, y también el caso de fusión de columnas de OCR (`"subtotal500"` sin separador).

**`extractTax`** — verifica que extrae el monto del impuesto en formatos de IVA, tax, IGV, y que no confunde el porcentaje con el monto cuando aparece `"iva 21% 105€"` (el porcentaje va antes, el monto va después).

**`extractTaxPercentage`** — comprueba que lee el porcentaje de líneas como `"iva 12%"` o `"total con 19% de iva"`, y devuelve `null` si no hay porcentaje.

**`extractDate`** — cubre más de 20 formatos de fecha: `YYYY-MM-DD`, `DD-MM-YYYY`, formato libre en español (`"el 5 de enero de 2024"`), y devuelve `null` cuando no hay fecha.

**`extractVendorName`** — verifica que prefiere una línea en mayúsculas como nombre del comercio (comportamiento típico de tickets) y que, si no hay mayúsculas, devuelve la primera línea no ruidosa.

**`extractVendorIds`** — extrae identificaciones fiscales: RUC Perú (`20123456789`), NIT Colombia (`900123456-1`), EIN USA (`12-3456789`), y devuelve array vacío si no encuentra nada.

**`reconcile`** — prueba la matemática de validación financiera: si tenemos dos de los tres valores (`subtotal`, `tax`, `total`), el tercero se puede calcular. Cubre también casos de inconsistencia (cuando los números no cuadran) y que nunca derive un impuesto negativo.

**`naiveParse` (integración)** — pasa un recibo completo de texto crudo y verifica que el parser genérico devuelva todos los campos correctamente: `amount`, `subtotalAmount`, `taxAmount`, `taxPercentage`, `date`, `invoiceNumber`, `vendorName` e `vendorIdentifications` en un solo paso.

**Casos de factura real (`factura1`)** — usa el texto OCR real de `samples/factura1.jpg`, una factura electrónica de la DGI de Panamá (DERMA MEDICAL CENTER S.A., exenta de ITBMS). Verifica que `amount = 268`, `subtotal = 268`, `taxAmount = 0`, que el vendedor se extraiga como `"DERMA MEDICAL CENTER S.A."`, el cliente como `"george Nauyok"` y que el número de factura esté presente. Es el test más cercano a un escenario real de producción.

**Casos de auditoría adicionales** — un grupo de tests derivados del análisis del sistema que cubren casos límite encontrados en facturas reales: formatos de IVA con porcentaje antes del monto, subtotals pegados al valor sin separador por error de OCR, y reconciliaciones con valores inconsistentes.

---

## Qué pasa cuando algo falla

- **Multer rechaza el archivo** (mime inválido o > 10MB) → el error pasa al middleware global de Express y devuelve 500. Idealmente subir esto a 400 con un mensaje claro.
- **Tesseract falla en una variante** → se loguea warning y se prueba la siguiente. Si fallan todas, devuelve `{ text: "", confidence: 0 }`.
- **PDF imposible de leer** → todas las estrategias fallan → `pdfToImages` lanza error → el controller responde 500.
- **IA primaria falla en modo `auto`** → cae a la siguiente. Los errores se acumulan en `_aiWarnings` que terminan visibles en `extraFields["Advertencias IA"]`.
- **IA devuelve JSON inválido** → `parseStructureJson` retorna `{}` y el merge cae a lo que tenían las reglas.
- **IA inventa un `accountId`** → la validación contra la BD lo descarta y queda `null`. Categoría cae a `categorize()` por keywords y, si tampoco, a la primera cuenta de tipo expense.
- **Tesseract worker zombie** → al cerrar el server con SIGTERM/SIGINT, `shutdownTesseract()` llama `terminate()` antes de salir.
