import dotenv from "dotenv";
dotenv.config();
import app from "./app.js";
import { logger } from "./config/logger.js";
import { shutdownTesseract } from "./services/ocr/ocr.tesseract.js";

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => logger.info(`API listening on :${port}`));

async function shutdown(signal: string) {
  logger.info({ msg: `Received ${signal}, shutting down` });
  server.close();
  await shutdownTesseract();
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
