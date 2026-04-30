import express from "express";
import path from "path";
import axios from "axios";
import receiptsRouter from "./routes/receipts.routes.js";
import transactionsRouter from "./routes/transactions.routes.js";
import { logger } from "./config/logger.js";

const app = express();
app.use(express.json());

// Static UI (bonus): simple form to upload
app.use(express.static(path.resolve("public")));

app.get("/health", (_req, res) => res.json({ ok: true }));

/** Test relay connectivity + token validity */
app.get("/api/relay/ping", async (_req, res) => {
  const baseUrl = process.env.OPENAI_BASE_URL || "http://localhost:8080";
  const token = process.env.PROSPERIA_TOKEN || "";
  const start = Date.now();
  try {
    const resp = await axios.post(
      `${baseUrl}/openai/chat`,
      { model: "gpt-4o-mini", messages: [{ role: "user", content: "ping" }], temperature: 0, max_tokens: 3 },
      { headers: { "X-Prosperia-Token": token }, timeout: 10000 },
    );
    const latencyMs = Date.now() - start;
    const content: string = resp.data?.choices?.[0]?.message?.content ?? "";
    const model: string = resp.data?.model ?? "unknown";
    logger.info({ msg: "relay ping OK", latencyMs, model });
    res.json({ ok: true, latencyMs, model, token: token ? `${token.slice(0, 4)}***` : "(empty)", relay: baseUrl, response: content });
  } catch (err: any) {
    const latencyMs = Date.now() - start;
    const status = err?.response?.status ?? null;
    const detail = err?.response?.data ?? err?.message ?? "unknown error";
    logger.error({ msg: "relay ping FAILED", latencyMs, status, detail });
    res.status(502).json({ ok: false, latencyMs, relay: baseUrl, token: token ? `${token.slice(0, 4)}***` : "(empty)", status, error: detail });
  }
});

app.use("/api/receipts", receiptsRouter);
app.use("/api/transactions", transactionsRouter);

app.use((err: any, _req: any, res: any, _next: any) => {
  logger.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal Error" });
});

export default app;
