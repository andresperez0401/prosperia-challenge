import { Request, Response, NextFunction } from "express";
import {
  processUploadedReceipt,
  listReceiptsService,
  getReceiptByIdService,
  reparseReceiptService,
} from "../services/receipts.service.js";
import { HttpError } from "../utils/errors.js";

export async function createReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.file) throw new HttpError(400, "file is required");
    if (!req.file.buffer) throw new HttpError(400, "file buffer is required");
    const saved = await processUploadedReceipt(req.file.buffer, {
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });
    res.status(201).json(saved);
  } catch (e) { next(e); }
}

export async function listReceipts(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await listReceiptsService());
  } catch (e) { next(e); }
}

export async function getReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await getReceiptByIdService(req.params.id));
  } catch (e) { next(e); }
}

export async function reparseReceipt(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reparseReceiptService(req.params.id));
  } catch (e) { next(e); }
}
