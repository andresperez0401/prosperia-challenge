import { Router } from "express";
import { pingRelayController } from "../controllers/relay.controller.js";

const router = Router();
router.get("/ping", pingRelayController);

export default router;
