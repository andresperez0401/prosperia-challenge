import { Request, Response, NextFunction } from "express";
import path from "path";
import { processReceipt } from "../services/receipts.service.js";
import { prisma } from "../db/client.js";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function createReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new HttpError(400, "file is required");
    const filePath = path.resolve(req.file.path);
    const saved = await processReceipt(filePath, {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size
    });
    res.status(201).json(saved);
  } catch (e) { next(e); }
}

export async function listReceipts(_req: Request, res: Response, next: NextFunction) {
  try {
    const receipts = await prisma.receipt.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    res.json(receipts);
  } catch (e) { next(e); }
}

export async function getReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    const r = await prisma.receipt.findUnique({ where: { id: req.params.id } });
    if (!r) throw new HttpError(404, "Not found");
    res.json(r);
  } catch (e) { next(e); }
}

export async function reparseReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    const r = await prisma.receipt.findUnique({ where: { id: req.params.id } });
    if (!r) throw new HttpError(404, "Not found");
    const saved = await processReceipt(r.storagePath, {
      originalName: r.originalName,
      mimeType: r.mimeType,
      size: r.size
    });
    res.json(saved);
  } catch (e) { next(e); }
}
