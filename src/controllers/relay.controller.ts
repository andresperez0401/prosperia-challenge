import { Request, Response, NextFunction } from "express";
import { pingRelay } from "../services/relay.service.js";

export async function pingRelayController(_req: Request, res: Response, next: NextFunction) {
  try {
    const result = await pingRelay();
    res.status(result.ok ? 200 : 502).json(result);
  } catch (e) { next(e); }
}
