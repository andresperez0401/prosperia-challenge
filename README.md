# Mini-Prosperia — OCR + IA para Facturas

Sube una factura (PDF o imagen) y el sistema extrae automáticamente los datos, los estructura y los clasifica contablemente.

## URL de la app


https://www.mini-prosperia.site/


**Qué hace:**
- Lee texto con OCR (Tesseract)
- Extrae campos: monto, subtotal, IVA, vendor, fecha, número de factura
- Clasifica el gasto en una cuenta contable usando IA (OpenAI o DeepSeek)
- Guarda todo en PostgreSQL

---

## Requisitos

- Node.js 20+
- PostgreSQL (o usar Neon.tech)
- Docker Desktop (opcional)

---

## Levantar en local

### 1. Instalar dependencias

```bash
npm install
```

### 2. Variables de entorno

```bash
cp .env.example .env
```

Editar `.env`:

```env
NODE_ENV=development
DATABASE_URL=postgresql://usuario:password@host/db?sslmode=require

# IA — elegir uno:
AI_PROVIDER=auto          # Recomendado: prueba OpenAI → DeepSeek → reglas locales

# OpenAI vía relay Prosperia
OPENAI_BASE_URL=https://prosperia-openai-relay-production.up.railway.app
PROSPERIA_TOKEN=tu-nombre-apellido

# DeepSeek (alternativa barata)
DEEPSEEK_API_KEY=sk-xxxxx
```

### 3. Migraciones y seed

```bash
# Crear tablas en la DB
npm run db:deploy

# Insertar cuentas contables iniciales
npm run db:seed
```

### 4. Correr

```bash
npm run dev
```

App en: `http://localhost:3000`

---

## Levantar con Docker

```bash
cp .env.example .env
# Editar .env con DATABASE_URL y demás variables

docker compose up --build
```

App en: `http://localhost:3000`

> Las migraciones y seed corren automáticamente al iniciar el contenedor.

---

## Endpoints

| Método | URL | Descripción |
|--------|-----|-------------|
| `POST` | `/api/receipts` | Sube factura (form-data: `file`) |
| `GET` | `/api/receipts` | Lista todas las facturas |
| `GET` | `/api/receipts/:id` | Ver factura por ID |
| `POST` | `/api/receipts/:id/reparse` | Re-procesar factura |

### Ejemplo subir factura

```bash
curl -F "file=@factura.pdf" http://localhost:3000/api/receipts
```

Respuesta:
```json
{
  "id": 1,
  "vendorName": "BALÚ",
  "amount": 15212.97,
  "taxAmount": 2098.34,
  "taxPercentage": 16,
  "currency": "VES",
  "category": 3,
  "categoryName": "Ropa/Vestimenta",
  "date": "2025-11-04"
}
```

---

## Proveedores de IA

| `AI_PROVIDER` | Descripción | Costo |
|---------------|-------------|-------|
| `auto` | OpenAI → DeepSeek → Mock (nunca falla) | Mínimo |
| `openai` | ChatGPT vía relay Prosperia | Pagado por Prosperia |
| `deepseek` | DeepSeek API | ~$0.0001/factura |
| `mock` | Solo reglas locales | Gratis |

---

## Scripts

```bash
npm run dev          # Servidor con hot-reload
npm run build        # Compilar TypeScript
npm run start        # Correr compilado
npm run db:deploy    # Aplicar migraciones
npm run db:seed      # Insertar datos iniciales
npm run db:migrate   # Crear nueva migración (dev)
npm test             # Correr tests
```

## Estructura

```
src/
  services/
    pdf/        → extrae texto/imagen de PDF
    image/      → mejora imagen con Sharp
    ocr/        → OCR con Tesseract
    parsing/    → extrae campos con regex + IA
    ai/         → OpenAI, DeepSeek, fallback
  controllers/  → endpoints HTTP
prisma/         → schema + migraciones + seed
public/         → UI (HTML + CSS + JS)
```
