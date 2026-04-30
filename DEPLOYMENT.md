# Despliegue — Docker Local + Railway

---

## Prerequisitos

### Instalar Docker Desktop
- Windows: https://docs.docker.com/desktop/install/windows/
- Verificar instalación:
```bash
docker --version
docker compose version
```

### Prerequisitos del proyecto
Antes de buildear, verificar que existen estos archivos en raíz:
```
eng.traineddata    ← Tesseract inglés (~5MB)
spa.traineddata    ← Tesseract español (~3MB)
```
Si no existen:
```bash
# Descargar manualmente
curl -L https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata -o eng.traineddata
curl -L https://github.com/tesseract-ocr/tessdata/raw/main/spa.traineddata -o spa.traineddata
```

---

## 1. Deploy Local con Docker Compose

### Paso 1: Crear archivo .env
```bash
cp .env.example .env
```
Editar `.env`:
```env
NODE_ENV=production
DATABASE_URL=postgresql://neondb_owner:npg_KyPvb31VieUT@ep-late-star-amlcna45-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require
AI_PROVIDER=auto
DEEPSEEK_API_KEY=sk-xxxxx          # Tu key de DeepSeek
OPENAI_BASE_URL=https://prosperia-openai-relay-production.up.railway.app
PROSPERIA_TOKEN=tu-nombre-apellido  # Tu token
```

> **DB:** Neon.tech externo (no docker local). Conexión directa con SSL.

### Paso 2: Buildear y levantar
```bash
docker compose up --build
```
Esto hace en orden:
1. Buildea imagen de la app (~3-5 min primera vez)
2. Conecta a Neon DB via `DATABASE_URL` del .env
3. Corre migrations + seed automáticamente
4. Levanta la app en puerto 3000

### Paso 3: Verificar que funciona
```bash
# En otra terminal
curl http://localhost:3000/health

# Respuesta esperada:
# {"status":"ok","uptime":5}
```

### Paso 4: Probar subir factura
```bash
curl -F "file=@samples/SENIAT.pdf" http://localhost:3000/api/receipts
```

### Comandos útiles
```bash
# Levantar en background (no bloquea terminal)
docker compose up --build -d

# Ver logs en vivo
docker compose logs -f app

# Ver logs solo de la DB
docker compose logs -f db

# Parar todo
docker compose down

# Parar y borrar datos (DB incluida)
docker compose down -v

# Rebuildar solo la app (sin bajar)
docker compose build app
docker compose up -d app
```

---

## 2. Deploy Local sin Compose (solo imagen)

Útil para probar la imagen sola sin docker compose.

### Paso 1: Buildear imagen
```bash
docker build -t mini-prosperia:latest .
```

### Paso 2: Correr la app
```bash
docker run \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://neondb_owner:npg_KyPvb31VieUT@ep-late-star-amlcna45-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require" \
  -e AI_PROVIDER=auto \
  -e DEEPSEEK_API_KEY=sk-xxxxx \
  -e OPENAI_BASE_URL=https://prosperia-openai-relay-production.up.railway.app \
  -e PROSPERIA_TOKEN=tu-nombre \
  -v $(pwd)/uploads:/app/uploads \
  mini-prosperia:latest
```

> DB es Neon externo → no necesita `--network` ni postgres local.

---

## 3. Deploy en Railway con Docker

Railway detecta el `Dockerfile` automáticamente y lo usa.

### Paso 1: Crear cuenta Railway
```
https://railway.app → Sign up con GitHub
```

### Paso 2: Instalar Railway CLI
```bash
npm install -g @railway/cli
railway login
```

### Paso 3: Crear proyecto en Railway
```bash
# Desde dentro de la carpeta del proyecto
railway init

# O en el dashboard web: Create New Project → Deploy from GitHub
```

### Paso 4: Configurar variables de entorno

DB es Neon externo — NO agregar PostgreSQL plugin de Railway.

**Por CLI:**
```bash
railway variables set NODE_ENV=production
railway variables set DATABASE_URL="postgresql://neondb_owner:npg_KyPvb31VieUT@ep-late-star-amlcna45-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"
railway variables set AI_PROVIDER=auto
railway variables set DEEPSEEK_API_KEY=sk-xxxxx
railway variables set OPENAI_BASE_URL=https://prosperia-openai-relay-production.up.railway.app
railway variables set PROSPERIA_TOKEN=tu-nombre-apellido
```

**O en Dashboard:**
```
Tu app → Variables → Add Variable
```

Variables requeridas:
```
NODE_ENV=production
DATABASE_URL=postgresql://neondb_owner:...@neon.tech/neondb?sslmode=require&channel_binding=require
AI_PROVIDER=auto
DEEPSEEK_API_KEY=sk-xxxxx
OPENAI_BASE_URL=https://prosperia-openai-relay-production.up.railway.app
PROSPERIA_TOKEN=tu-nombre-apellido
```

### Paso 6: Deploy

**Opción A: Deploy desde GitHub (recomendado)**
```
Dashboard → tu app → Settings → Source → Connect GitHub repo
```
Cada push a `main` → Railway re-deploya automáticamente.

**Opción B: Deploy desde CLI (push directo)**
```bash
railway up
```
Sube el código local y buildea en Railway.

### Paso 7: Ver logs
```bash
# CLI en vivo
railway logs

# O Dashboard → tu app → Logs
```

El inicio del log debe verse así:
```
Prisma migrate deploy: Applied X migrations
Seed: accounts inserted
Server running on port 3000
```

### Paso 8: Obtener URL pública
```bash
railway open
# O Dashboard → tu app → Settings → Domains → Generate Domain
```

### Paso 9: Probar
```bash
# Reemplaza con tu URL
curl https://tu-app.railway.app/health

curl -F "file=@samples/SENIAT.pdf" https://tu-app.railway.app/api/receipts
```

---

## Qué hace el Dockerfile al arrancar

El CMD del Dockerfile ejecuta esto en orden:
```bash
# 1. Aplica migrations pendientes
prisma migrate deploy

# 2. Corre seed (cuentas contables iniciales) — nunca falla gracias al || true
tsx prisma/seed.ts || true

# 3. Arranca la app
node dist/server.js
```

Esto pasa SIEMPRE que el contenedor arranca (local y Railway).

---

## Troubleshooting

### Build falla: "COPY eng.traineddata: file not found"
```bash
# Los archivos de Tesseract deben estar en la raíz
ls *.traineddata

# Si no están:
curl -L https://github.com/tesseract-ocr/tessdata/raw/main/eng.traineddata -o eng.traineddata
curl -L https://github.com/tesseract-ocr/tessdata/raw/main/spa.traineddata -o spa.traineddata
```

### App arranca pero no conecta a DB
```bash
# Verificar que DATABASE_URL es la URL de Neon (no localhost)
docker compose config | grep DATABASE_URL

# Neon requiere SSL — verificar que URL tenga ?sslmode=require
# Si no tiene → conexión rechazada

# Verificar desde CLI que Neon responde
psql "postgresql://neondb_owner:npg_KyPvb31VieUT@ep-late-star-amlcna45-pooler.c-5.us-east-1.aws.neon.tech/neondb?sslmode=require"
```

### App en Railway no conecta a DB (Neon)
```bash
# Verificar que DATABASE_URL está en variables de Railway
railway variables | grep DATABASE_URL

# Verificar que tiene sslmode=require y channel_binding=require
# Sin esos parámetros, Neon rechaza la conexión
```

### "exec tsx: not found" en Railway
Railway usa el Dockerfile, tsx está en devDependencies y se instala con `npm ci`.
Si falla, verificar que `npm ci` no tiene `--only=production` en el Dockerfile.
(El Dockerfile actual está correcto, no tiene esa flag.)

### Puerto incorrecto
Railway asigna `PORT` automáticamente. La app debe leerlo:
```typescript
// En src/server.ts
const PORT = process.env.PORT || 3000;
```

### Migrations fallan: "migration already applied"
```bash
# Es normal, prisma migrate deploy es idempotente
# Solo aplica migrations nuevas, ignora las ya aplicadas
```

### Railway falla en build (timeout)
Primera build es lenta (~5-8 min) por descarga de deps.
Esperar o verificar en Logs que no sea otro error.

---

## Resumen de Comandos

| Acción | Comando |
|--------|---------|
| Build + levantar todo | `docker compose up --build` |
| Levantar en background | `docker compose up --build -d` |
| Ver logs app | `docker compose logs -f app` |
| Bajar todo | `docker compose down` |
| Bajar + borrar datos | `docker compose down -v` |
| Rebuildar imagen | `docker compose build app` |
| Deploy a Railway | `railway up` |
| Ver logs Railway | `railway logs` |
| Ver variables | `railway variables` |
| Abrir app en browser | `railway open` |
| Re-deploy forzado | `railway redeploy` |
