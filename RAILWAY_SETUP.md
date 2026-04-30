# Deployment a Railway

## 1. Verificaciones locales (antes de subir)

### Iniciar Docker + Postgres
```bash
# Inicia Docker Desktop manualmente en Windows, O si tienes WSL:
wsl --install  # Si no está instalado
docker --version  # Verifica que Docker está disponible

# Levanta Postgres en Docker (docker-compose)
docker-compose up -d

# Aguarda a que Postgres esté listo (~10s)
sleep 10

# Verifica conexión
npm run db:migrate
npm run db:seed
```

### Compilar y correr local
```bash
npm run build
npm run start
```

### Probar upload de factura
```bash
# En otra terminal, con curl o via web UI:
curl -F "file=@samples/factura1.jpg" http://localhost:3000/api/receipts
```

### Construir imagen Docker local
```bash
docker build -t mini-prosperia:latest .
docker run --env-file .env -p 3000:3000 mini-prosperia:latest
# Prueba: curl http://localhost:3000/health
```

---

## 2. Deployment a Railway

### Step 1: Crea cuenta en Railway
- https://railway.app
- Sign up con GitHub

### Step 2: Nuevo proyecto
1. Railway Dashboard → Create New Project
2. Selecciona "Deploy from GitHub"
3. Conecta tu repo `PruebaProsperia/prosperia-challenge`
4. Railway detectará el Dockerfile automáticamente

### Step 3: Configura variables de entorno
En Railway Dashboard → Project → Variables → Add:

```
NODE_ENV=production
PORT=3000

DATABASE_URL=postgresql://...  # Railway crea el Postgres automático
OCR_PROVIDER=tesseract
AI_PROVIDER=auto

OPENAI_BASE_URL=http://prosperia-openai-relay-production.up.railway.app:8080
PROSPERIA_TOKEN=andres-perez

DEEPSEEK_API_KEY=sk-1b60e267e4574089982cfb04e441fca9
```

### Step 4: Configura Postgres plugin
Railway → Plugins → PostgreSQL → Add
- Selecciona "Connected" → será inyectado en DATABASE_URL automáticamente

### Step 5: Deploy
Railway detiene/reinicia el servicio automáticamente:
1. Dockerfile se compila (3-5 min)
2. CMD ejecuta: `prisma migrate deploy && tsx prisma/seed.ts || true && node dist/server.js`
3. App escucha en puerto 3000

### Step 6: Monitorea logs
```bash
railway up  # Requiere Railway CLI instalado
# O en Dashboard → Logs
```

---

## 3. Fallback de proveedores AI

**Configuración actual (recomendada):**
```
AI_PROVIDER=auto
```

**Cadena de fallback:**
1. OpenAI Relay (Prosperia) → timeout 15s
2. DeepSeek API → timeout 15s
3. Mock (reglas locales)

Si OpenAI o DeepSeek fallan durante una request, automáticamente intenta el siguiente proveedor.

**Costs:**
- OpenAI: vía relay (pagado por Prosperia)
- DeepSeek: ~$0.14 por 1M input tokens (~3.5k facturas si cada una = 40 tokens)
- Mock: gratis, solo reglas locales (bajo valor, solo como fallback final)

**Para cambiar de estrategia:**
- `AI_PROVIDER=openai` → solo ChatGPT (falla si relay cae)
- `AI_PROVIDER=deepseek` → solo DeepSeek
- `AI_PROVIDER=mock` → sin IA (solo reglas, OCR + parsing local)

---

## 4. Troubleshooting

### "ERROR: failed to locate Tesseract"
Tesseract.js descarga binarios WASM automáticamente. Si falla:
- Verifica internet en Railway
- Los .traineddata locales (eng.traineddata, spa.traineddata) son un respaldo

### "DEEPSEEK_API_KEY not configured"
- Verifica que la env var esté en Railway Dashboard
- Si cambias la key: Railway → Redeploy

### "Category: using generic fallback"
Significa que:
1. OpenAI/DeepSeek no devolvieron categoría
2. Keyword heuristic no encontró coincidencia
3. Usa la primer cuenta expense en BD

Para debuggear: revisa los logs de categorización en Railway Logs.

### "timeout" en relay OpenAI
- Relay está lento/no disponible
- Sistema automáticamente cae a DeepSeek (si AI_PROVIDER=auto)
- Verifica que URL de relay sea correcta

