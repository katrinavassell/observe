import type { VercelRequest, VercelResponse } from "@vercel/node";
import Pg from "pg";
import { runWeeklyDigest } from "../../server/digest.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Verify cron secret to prevent unauthorized access
  if (
    req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}` &&
    req.headers["x-vercel-cron"] !== "true"
  ) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const pool = new Pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10000,
  });

  try {
    await runWeeklyDigest(pool);
    res.json({ ok: true });
  } catch (err) {
    console.error("Weekly digest cron error:", err);
    res.status(500).json({ error: "Digest failed" });
  } finally {
    await pool.end();
  }
}
