import { Router, Request, Response, NextFunction } from "express";
import type { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export interface AuthRequest extends Request {
  visitorId?: string;
  accountId?: number;
  accountEmail?: string;
}

export function createEnsureVisitor(pool: Pool) {
  return async function ensureVisitor(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        return res
          .status(401)
          .json({ error: "Missing or invalid authorization header" });
      }

      const token = authHeader.slice(7);
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser(token);

      if (error || !user) {
        return res.status(401).json({ error: "Invalid or expired token" });
      }

      // Use Supabase user ID as the visitor ID (maps to user_id across all tables)
      req.visitorId = user.id;
      req.accountEmail = user.email;

      // Look up local account row for accountId (used by billing, team features)
      const accountResult = await pool.query(
        "SELECT id FROM accounts WHERE visitor_id = $1",
        [user.id],
      );
      if (accountResult.rows[0]) {
        req.accountId = accountResult.rows[0].id;
      }

      // Ensure user_data_status row exists
      await pool.query(
        "INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [user.id, "none"],
      );

      next();
    } catch (error) {
      console.error("Auth middleware error:", error);
      res.status(500).json({ error: "Authentication error" });
    }
  };
}

export function createAuthRoutes(
  pool: Pool,
  ensureVisitor: ReturnType<typeof createEnsureVisitor>,
) {
  const router = Router();

  // POST /auth/signup — called after Supabase client-side signup to create local account row
  router.post(
    "/auth/signup-complete",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const userId = req.visitorId!;
        const email = req.accountEmail!;
        const { name } = req.body;

        // Create local account row (idempotent)
        const result = await pool.query(
          `INSERT INTO accounts (email, password_hash, name, visitor_id)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (visitor_id) DO UPDATE SET email = $1, name = COALESCE($3, accounts.name), updated_at = NOW()
           RETURNING id, email, name`,
          [email, "supabase-managed", name?.trim() || null, userId],
        );
        const account = result.rows[0];

        // Clear any leftover sample/demo data
        await pool.query(
          "DELETE FROM observe_events WHERE user_id = $1 AND source = $2",
          [userId, "sample"],
        );
        await pool.query(
          "DELETE FROM customers WHERE user_id = $1 AND customer_id IN ('acme_saas','tidewater_ai','neondata','circleops','blazeml','quantumhr')",
          [userId],
        );
        await pool.query(
          "DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id IN ('sub_acme','sub_acme_addon','sub_tidewater','sub_neon','sub_neon_addon','sub_circle','sub_blaze','sub_quantum')",
          [userId],
        );
        await pool.query(
          "DELETE FROM plans WHERE user_id = $1 AND plan_id IN ('starter', 'pro', 'enterprise')",
          [userId],
        );
        await pool.query("DELETE FROM cost_records WHERE user_id = $1", [
          userId,
        ]);
        await pool.query("DELETE FROM usage_records WHERE user_id = $1", [
          userId,
        ]);
        await pool.query("DELETE FROM ai_insights WHERE user_id = $1", [
          userId,
        ]);
        await pool.query(
          "UPDATE user_data_status SET data_mode = 'none' WHERE user_id = $1",
          [userId],
        );

        // Auto-generate SDK key
        let sdkKey: string | null = null;
        try {
          const crypto = await import("crypto");
          const rawKey = `obs_${crypto.randomBytes(24).toString("hex")}`;
          const keyHash = crypto
            .createHash("sha256")
            .update(rawKey)
            .digest("hex");
          const keyPrefix = rawKey.slice(0, 11);
          await pool.query(
            `INSERT INTO sdk_api_keys (user_id, key_hash, key_prefix, name) VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [userId, keyHash, keyPrefix, "default"],
          );
          sdkKey = rawKey;
        } catch (keyErr) {
          console.error("Auto SDK key generation failed (non-fatal):", keyErr);
        }

        // Notify Kat of new signup
        const resendKey = process.env.RESEND_API_KEY;
        if (resendKey) {
          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${resendKey}`,
            },
            body: JSON.stringify({
              from: "Observe <kat@tansohq.com>",
              to: "kat@tansohq.com",
              subject: `New signup: ${email}`,
              html: `<p><strong>New user signed up for Observe</strong></p><p>Email: ${email}</p><p>Name: ${name?.trim() || "(not provided)"}</p><p>Time: ${new Date().toISOString()}</p>`,
            }),
          }).catch((err: unknown) =>
            console.error("Failed to send signup notification:", err),
          );

          // Welcome email (delayed 3 minutes)
          setTimeout(
            () => {
              fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${resendKey}`,
                },
                body: JSON.stringify({
                  from: "Kat from Observe <kat@tansohq.com>",
                  to: email,
                  subject: "Welcome to Observe",
                  html: `<p>Hey there!</p>
<p>Just wanted to say thank you for signing up for Observe by Tanso! Would love to learn about what you're building and what brought you to Observe.</p>
<p>Feel free to reach out with any questions or feedback. Also down to hop on a quick call if that's easier: <a href="https://cal.com/katrina-laszlo/meeting">https://cal.com/katrina-laszlo/meeting</a></p>
<p>Kat<br/>Co-founder, Tanso</p>`,
                }),
              }).catch((err: unknown) =>
                console.error("Failed to send welcome email:", err),
              );
            },
            3 * 60 * 1000,
          );
        }

        res.json({
          account: { id: account.id, email: account.email, name: account.name },
          sdkKey,
        });
      } catch (error: any) {
        console.error("Signup complete error:", error);
        res.status(500).json({ error: "Failed to complete signup" });
      }
    },
  );

  // GET /auth/me — returns local account info for the authenticated user
  router.get(
    "/auth/me",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          "SELECT id, email, name FROM accounts WHERE visitor_id = $1",
          [req.visitorId],
        );
        if (result.rows.length === 0) {
          return res.json({ account: null });
        }
        res.json({ account: result.rows[0] });
      } catch (error) {
        console.error("Auth me error:", error);
        res.status(500).json({ error: "Failed to get account info" });
      }
    },
  );

  return router;
}
