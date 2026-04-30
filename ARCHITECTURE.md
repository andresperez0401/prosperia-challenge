# Mini-Prosperia — Cómo Funciona

## Índice
1. [Stack tecnológico](#stack)
2. [Flujo general](#flujo)
3. [Detalles de cada etapa](#etapas)
4. [Configuración del relay](#relay)
5. [Estructura de carpetas](#carpetas)
6. [Solucionar problemas](#problemas)

## Stack Tecnológico {#stack}

- **Backend:** Node.js 20 + TypeScript
- **API:** Express + Multer para subir archivos
- **DB:** PostgreSQL + Prisma ORM
- **OCR:** Tesseract.js (lee inglés + español)
- **Imagen:** Sharp (mejora fotos antes de OCR)
- **PDF:** pdf-parse (texto), pdfjs-dist (convierte a imagen)
- **IA:** OpenAI o DeepSeek (extrae datos, categoriza)
- **Frontend:** HTML + CSS + JavaScript vanilla

## Flujo General {#flujo}

```
📁 Subes factura (PDF, JPG, PNG)
        ↓
🔄 Si es PDF → extrae texto o convierte a imagen
        ↓
🖼️ Mejora imagen (contraste, rotación, nitidez)
        ↓
📖 Lee texto con OCR (Tesseract)
        ↓
🧩 Reorganiza texto (detecta columnas, filas)
        ↓
🔎 Busca campos con reglas (total, fecha, vendor)
        ↓
🤖 IA rellena lo que falta (OpenAI o DeepSeek)
        ↓
🧮 Valida matemática (subtotal + IVA = total)
        ↓
💰 IA clasifica cuenta contable
        ↓
💾 Guarda en base de datos
```

## Detalles de Cada Etapa {#etapas}

### 1️⃣ Extracción de PDF

Si subes un PDF, intenta 3 formas de sacar el contenido:

1. **Texto digital** — Si el PDF tiene texto escrito (no escaneado), lo copia directo
2. **Convertir a imagen** — Si no hay texto, renderiza cada página como imagen
3. **Fallback externo** — Si nada funciona, usa Ghostscript (requiere instalarlo en Windows)

Si el PDF tiene múltiples páginas, procesa cada una y junta el texto con un salto de línea.

### 2️⃣ Mejora de Imagen (Sharp) — Quién Elige Cuál

**Idea simple:** Una factura puede verse de 3 formas diferentes. No sabemos cuál es mejor, así que preparamos **3 versiones de la misma imagen** y dejamos que Tesseract las pruebe todas. Elige la que salga mejor.

#### Las 3 Versiones

Teniendo una foto de una factura. Sharp hace:

**Versión 1: `normalized` — Versión "normal, limpia"**
```
Original → Enderezar (si está rotada) → Convertir a blanco y negro
         → Estirar contraste (oscuro más oscuro, claro más claro)
         → Suavizar (para no ver ruido)
         → Resultado: foto limpia, lista para leer
```
- Cuándo sale bien: Cuando la foto es buena (buen escaneo, buena luz)
- Ejemplo: Factura fotografiada con luz natural, buena calidad

**Versión 2: `threshold-160` — Versión "blanco y negro puro"**
```
Original → Enderezar → Blanco y negro → Estirar contraste
         → Corte AFILADO: si pixel < 160 → totalmente negro, si >= 160 → totalmente blanco
         → Resultado: solo blanco y negro, sin grises
```
- Cuándo sale bien: Cuando la factura es de mala calidad, borrosa
- Ejemplo: Fotocopia vieja, impresión en gris

**Versión 3: `darkened` — Versión "contraste MÁXIMO"**
```
Original → Enderezar → Blanco y negro → Estirar contraste (agresivo)
         → Corte MÁS AFILADO: si pixel < 190 → negro, si >= 190 → blanco
         → Resultado: solo texto oscuro, fondo blanco, mucho contraste
```
- Cuándo sale bien: Cuando la foto es tomada por celular, tickets viejos, fotos borrosas
- Ejemplo: Factura fotografiada con WhatsApp, ticket térmico viejo

**Detalle: Si la foto tiene fondo oscuro**
Sharp lo detecta (promedio < 110). Si ve eso → **invierte colores automático** (negro ↔ blanco).
- Por qué: Si tienes documento blanco con letras negras sobre fondo negro, invierte para que sea negro sobre blanco

**Límite de tamaño:**
Si imagen > 2200px de ancho → la reduce (para no llenar RAM)

#### Cómo Tesseract Elige la Mejor

**Flujo:**
```
Imagen original
    ↓
Crea 3 versiones (Sharp)
    ↓
Para CADA versión:
  ├→ Intenta modo 4 (columnas lado a lado)
  ├→ Intenta modo 6 (texto normal)
  └→ Intenta modo 11 (texto disperso)
    ↓ 9 intentos total (3 versiones × 3 modos)
    ↓
Calcula puntuación cada intento:
  - Confianza OCR (qué tan seguro está)
  - Cantidad de números encontrados
  - Palabras clave (TOTAL, IVA, FECHA, etc.)
  - Longitud de texto
    ↓
Elige el que tenga MÁS puntos
```

**Ejemplo real:**
```
Factura fotografiada con celular, borrosa:

normalized (modo 4) → "TtAL: 100" (confianza 50%, muy confundido) → Score 25
normalized (modo 6) → "TOTAL: 100" (confianza 80%, buena lectura) → Score 40 ✓
normalized (modo 11) → "TOTAL: 100" (confianza 70%) → Score 35

threshold-160 (modo 4) → Error (blanco/negro puro no le sienta bien) → Score 5
threshold-160 (modo 6) → "TOTAL: 100" (confianza 60%) → Score 30
threshold-160 (modo 11) → "T0TAL: 100" (confundió O con 0) → Score 15

darkened (modo 4) → "TOTAL: 100" (confianza 85%, contraste máximo le ayudó) → Score 50 ← GANADOR
darkened (modo 6) → "TOTAL: 100" (confianza 80%) → Score 45
darkened (modo 11) → "TOTAL: 100" (confianza 75%) → Score 40

RESULTADO: Usa darkened (modo 4) porque tuvo puntuación más alta
```

**Punto clave:** No sabemos de antemano cuál será mejor, así que probamos todas.

### 3️⃣ OCR — Lee el Texto

Tesseract intenta leer cada una de las 3 imágenes mejoradas usando 3 modos diferentes:

- **Modo 4** — Para facturas con dos columnas lado a lado
- **Modo 6** — Para texto corrido normal  
- **Modo 11** — Para tickets pequeños con texto disperso

Elige automáticamente la mejor combinación según:
- Confianza de OCR
- Cantidad de números detectados
- Palabras clave encontradas (TOTAL, IVA, RIF, etc.)
- Longitud del texto

Configuración: Lee inglés + español, preserva espacios, usa 300 DPI para claridad.

### 4️⃣ Reorganiza el Texto

Tesseract devuelve la posición de cada palabra en la imagen. Esta etapa:

1. Agrupa palabras que están juntas verticalmente → reconstruye líneas
2. Detecta columnas (espacios grandes entre palabras)
3. Extrae pares clave-valor (ej: "TOTAL: 15.212,97")
4. Si hay tabla de items, los extrae ordenados por fila

Lo hace el reconstructLaayout, agrupando palabras por prioridad vertical, ordenando de izquierd a derecha y detectando alineaciones horizontales. Basicamente toma la data matemática (coordenadas) que da Tesseract y reconstruye el documento como si fuera una tabla estructurada.

Resultado: Texto que respeta la estructura visual de la factura original, no un bloque confuso.

### 5️⃣ Parsers — Busca Campos con Reglas

Sistema en capas: **Parser Genérico + Parsers Especializados**

#### Cómo Funciona: Quién Llama Qué y Cuándo

**Imagina que eres un robot leyendo una factura.**

Alguien te da un texto y dice: "Extrae los campos: monto, vendor, fecha, etc."

```
Tú ejecutas esto mentalmente:

PASO 1: Llamas GenericParser
"Voy a buscar patrones universales (TOTAL, SUBTOTAL, VENDOR, FECHA)"
Resultado: algunos campos rellenos, otros NULL
{
  amount: 100,
  vendor: "BALU",
  currency: null,       ← falta
  ...
}

PASO 2: ¿Detectas Venezuela?
Buscas en el texto: "SENIAT", "RIF", "Bs"
Si ves alguno → "Esta es factura VENEZOLANA"

PASO 3: ¿Es Venezuela?
Si SÍ → Llamas SeniatVenezuelaParser
       "Tengo reglas especiales para Venezuela"
Si NO → Terminas aquí

PASO 4: SeniatVenezuelaParser agrega/corrige
Lee lo que GenericParser encontró
Agrega: currency: "VES" (porque vio "RIF")
Corrige: vendor si está mal
Resultado: objeto completo
```

**Flujo en código:**

```javascript
function parseReceipt(texto) {
  // PASO 1: Siempre GenericParser
  let resultado = genericParser(texto);
  
  // PASO 2: ¿Es Venezuela?
  let esVenezuela = false;
  if (texto.includes("SENIAT")) esVenezuela = true;  // 90% seguro
  if (texto.includes("RIF")) esVenezuela = true;     // 85% seguro
  if (texto.includes("Bs")) esVenezuela = true;      // 70% seguro
  
  // PASO 3: Si es Venezuela, correr parser especializado
  if (esVenezuela) {
    resultado = seniatParser(resultado, texto);
  }
  
  // PASO 4: Devolver resultado
  return resultado;
}
```

**Punto clave:** parseReceipt() es un orquestador. Ella decide qué parser ejecutar según detecte Venezuela o no.

#### Parser Genérico (`GenericParser`)

Lee el texto línea por línea buscando patrones universales.

**Proceso del GenericParser:**

Imagina que tienes este texto:
```
BALU
FACTURA 123
FECHA: 04/11/2025

Producto A    100
Producto B    200

SUBTOTAL: 300
IVA (16%): 48
TOTAL: 348
```

GenericParser hace esto:

1. **Busca TOTAL**
   - Mira cada línea
   - Si ve "TOTAL" → "ACA ESTÁ"
   - Captura número después: `348`
   - Toma ese número

2. **Busca SUBTOTAL**
   - Mira cada línea
   - Si ve "SUBTOTAL" → captura `300`

3. **Busca IVA (el monto, no el %)**
   - Busca líneas con "IVA", "IMPUESTO", "TAX"
   - Pero evita líneas que digan "16%" (esos son porcentajes)
   - Toma el número: `48`

4. **Busca IVA % (el porcentaje)**
   - Busca patrones "16%", "IVA 21%"
   - Si encuentra → `16`

5. **Busca VENDOR (nombre de la tienda)**
   - Toma las primeras 8 líneas
   - Salta líneas que son solo: "SENIAT", "FECHA", números puros
   - Toma la primera línea "útil" → `BALU`

6. **Busca NÚMERO DE FACTURA**
   - Busca "FACTURA NRO", "INVOICE #"
   - Captura número después → `123`
   - PERO: rechaza si la palabra después es "FECHA" (evita confundir)

7. **Busca FECHA**
   - Intenta 20+ formatos diferentes
   - "04/11/2025", "2025-11-04", "4 nov 2025", etc.
   - Convierte a formato estándar: `2025-11-04`

8. **Busca IDENTIFICACIONES (RIF, NIT, etc.)**
   - Busca por patrón: "J-40208563-5" (RIF), "1234567-8" (NIT), etc.
   - Detecta automáticamente qué tipo es
   - Devuelve lista

9. **Busca ITEMS (tabla de productos)**
   - Si hay tabla: descripción + cantidad + precio
   - Extrae fila por fila

10. **Busca MÉTODO DE PAGO**
    - Busca: "tarjeta", "efectivo", "transferencia"

**Resultado del GenericParser:**
```javascript
{
  amount: 348,
  subtotal: 300,
  taxAmount: 48,
  taxPercentage: 16,
  vendor: "BALU",
  invoiceNumber: "123",
  date: "2025-11-04",
  currency: null,         // NO encontró, IA lo agrega
  vendorIdentifications: [],
  items: [...]
}
```

#### Parser Especializado — Venezuela (`SeniatVenezuelaParser`)

**Se activa SOLO si parseReceipt() detecta Venezuela.**

¿Cómo sabe si es Venezuela?
- Si ve "SENIAT" en el texto → 90% confianza
- Si ve "RIF" en el texto → 85% confianza
- Si ve "Bs" o "VES" en el texto → 70% confianza

Se aplico esta variante debido a que alguna de las facturas de prueba encontradas estaban relacionadas con Venezuela. Pero la idea es que se puedan implementar mas adaptadores a la interfaz: ReceiptParser

Si alguna de estas es cierta → ejecuta SeniatVenezuelaParser

**Qué hace el SeniatVenezuelaParser:**

Lee lo que GenericParser encontró y lo corrige/agrega para facturas venezolanas.

**Ejemplo completo de flow:**

Texto original:
```
BALÚ
RIF: J 40208563 5
FACTURA 123
TOTAL: 348 Bs
```

GenericParser encuentra:
```javascript
{
  vendor: "BALÚ",
  invoiceNumber: "123",
  amount: 348,
  currency: null         // No encontró moneda
}
```

SeniatVenezuelaParser ejecuta:
```javascript
// Detectó "RIF" y "Bs" → es Venezuela
{
  vendor: "BALÚ",        // Sin cambios (ya estaba bien)
  currency: "VES",       // AGREGADO (por "RIF" y "Bs")
  rif: "J-40208563-5"    // AGREGADO Y NORMALIZADO
  // Otros campos sin cambios
}
```

Resultado final:
```javascript
{
  vendor: "BALÚ",
  invoiceNumber: "123",
  amount: 348,
  currency: "VES",
  rif: "J-40208563-5"
}
```

### 6️⃣ Normalización de Datos

Convierte texto "sucio" en datos limpios:

- **Montos:** "15.212,97" → 15212.97 (maneja EU, US, y espacios)
  - EU: punto=miles, coma=decimal
  - US: coma=miles, punto=decimal
  - Auto-detecta por contexto (cuántos dígitos después del separador)

- **Fechas:** "04/11/2025" → "2025-11-04" (soporta 20+ formatos)
  - DD/MM/YYYY, YYYY-MM-DD, "4 nov 2025", "4 de noviembre 2025"
  - Valida año 2000-2030 (evita falsos positivos)

- **Monedas:** "Bs" → "VES", "€" → "EUR", "$" → "USD"
  - Bs/Bs. siempre → VES (bolívares venezolanos)
  - $ + contexto regional → USD, COP, etc.

- **IDs:** "J 40208563 5" → "J-40208563-5" (RIF, NIT, RUC, CIF)
  - Detecta tipo por patrón (J-NNN = RIF Venezuela)
  - Limpia espacios/guiones
  - Formato estándar por país

### 7️⃣ Validación Matemática

Si tienes 2 de estos 3 valores, calcula el tercero:
- Subtotal + IVA monto = Total
- Total + IVA % = Subtotal
- Etc.

Solo rellena campos vacíos. Nunca sobrescribe lo que ya encontró.

Tolerancia: Permite diferencia de hasta 6 centavos (errores de redondeo).

### 8️⃣ IA — Rellena y Clasifica

**Etapa 1 — Estructura (OpenAI o DeepSeek):**
- Lee el texto + lo que ya encontraron las reglas
- Rellena campos vacíos (sin sobrescribir los que ya existen)
- Maneja casos especiales (Venezuela, formatos raros)

**Etapa 2 — Categorización (Contabilidad):**
- Lee el nombre del vendor + items comprados
- Asigna a una categoría contable de la base de datos
- Si falla, busca por keywords (ej: "uber" → Transporte, "restauran" → Alimentación)

Usa OpenAI `gpt-4o-mini` o DeepSeek como fallback. Si ambas fallan, usa heurística local pero es menos precisa.

### 9️⃣ Guardar en Base de Datos

Se almacena:
- Todos los campos extraídos (monto, fecha, vendor, items, etc.)
- ID de categoría contable
- Metadatos del procesamiento (qué provider se usó, qué método OCR, etc.)

## Configuración del Relay {#relay}

**Variables de entorno (`.env`):**
```bash
AI_PROVIDER=auto                 # auto, openai, deepseek, o mock
DEEPSEEK_API_KEY=sk-...          # Solo si usas deepseek
OPENAI_BASE_URL=https://prosperia-openai-relay-production.up.railway.app
PROSPERIA_TOKEN=tu-nombre        # Token personal
```

Recomendado: `AI_PROVIDER=auto` (intenta OpenAI, luego DeepSeek, fallback a reglas locales)

## Estructura de Carpetas {#carpetas}

```
public/                   → Frontend (HTML, CSS, JS)
src/
  ├── server.ts           → Arranque del servidor
  ├── controllers/        → Maneja peticiones HTTP
  ├── routes/             → Define URLs
  ├── services/
  │   ├── pdf/            → Extrae texto/imagen de PDF
  │   ├── image/          → Mejora imágenes con Sharp
  │   ├── ocr/            → OCR con Tesseract
  │   ├── parsing/        → Busca campos (regex + IA)
  │   │   ├── parsers/    → Especialistas por región
  │   │   └── normalizers/ → Limpia datos
  │   └── ai/             → OpenAI, DeepSeek, Mock
  └── types/              → TypeScript interfaces
prisma/                   → Base de datos schema
samples/                  → PDFs de prueba
uploads/                  → Archivos subidos
```



