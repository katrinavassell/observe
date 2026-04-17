import type { VercelRequest, VercelResponse } from "@vercel/node";
import { runPosthogAudit } from "../../server/posthog-audit.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (
    req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` &&
    req.headers["x-vercel-cron"] !== "true"
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const result = await runPosthogAudit();
    res.json(result);
  } catch (err) {
    console.error("PostHog audit cron error:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "Audit failed",
    });
  }
}
