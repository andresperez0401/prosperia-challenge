import { Router } from "express";
import multer from "multer";
import { createReceipt, getReceipt, listReceipts, reparseReceipt } from "../controllers/receipts.controller.js";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      cb(new Error(`Unsupported mime type: ${file.mimetype}`));
      return;
    }
    cb(null, true);
  },
});

const router = Router();

router.get("/", listReceipts);
router.post("/", upload.single("file"), createReceipt);
router.get("/:id", getReceipt);
router.post("/:id/reparse", reparseReceipt);

export default router;
