import { Router } from "express";
import multer from "multer";
import { createReceipt, getReceipt, listReceipts, reparseReceipt } from "../controllers/receipts.controller.js";

const upload = multer({ dest: "uploads/" });
const router = Router();

router.get("/", listReceipts);
router.post("/", upload.single("file"), createReceipt);
router.get("/:id", getReceipt);
router.post("/:id/reparse", reparseReceipt);

export default router;
