import axios from "axios";
import { logger } from "../config/logger.js";

export interface RelayPingResult {
  ok: boolean;
  latencyMs: number;
  relay: string;
  token: string;
  model?: string;
  response?: string;
  status?: number | null;
  error?: unknown;
}

/** Probe the OpenAI relay with a tiny chat call to verify connectivity + token. */
export async function pingRelay(): Promise<RelayPingResult> {
  const baseUrl = process.env.OPENAI_BASE_URL || "http://localhost:8080";
  const token = process.env.PROSPERIA_TOKEN || "";
  const tokenMasked = token ? `${token.slice(0, 4)}***` : "(empty)";
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
    return { ok: true, latencyMs, model, token: tokenMasked, relay: baseUrl, response: content };
  } catch (err: unknown) {
    const latencyMs = Date.now() - start;
    const e = err as { response?: { status?: number; data?: unknown }; message?: string };
    const status = e?.response?.status ?? null;
    const detail = e?.response?.data ?? e?.message ?? "unknown error";
    logger.error({ msg: "relay ping FAILED", latencyMs, status, detail });
    return { ok: false, latencyMs, relay: baseUrl, token: tokenMasked, status, error: detail };
  }
}
