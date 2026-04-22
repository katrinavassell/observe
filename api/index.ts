import type { VercelRequest, VercelResponse } from "@vercel/node";
import express from "express";
import app from "../server/index.js";
export const API_VERSION = "2026-04-22";

const wrapper = express();
wrapper.use("/api", app);

export default function handler(req: VercelRequest, res: VercelResponse) {
  return wrapper(req, res);
}
