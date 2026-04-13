import { Router, Request, Response, NextFunction } from "express";
import type { Pool } from "pg";
import { createClient } from "@supabase/supabase-js";

const supabaseServiceKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SECRET_KEY ||
  "";
const supabase = createClient(process.env.SUPABASE_URL!, supabaseServiceKey);

export interface AuthRequest extends Request {
  visitorId?: string;
  accountId?: number;
  accountEmail?: string;
}

// Track which users have had sample data cleared this server lifetime
// Prevents running cleanup queries on every request
const sampleClearedUsers = new Set<string>();

export function createEnsureVisitor(pool: Pool) {
  return async function ensureVisitor(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const authHeader = req.headers.authorization;

      if (authHeader?.startsWith("Bearer ")) {
        // Authenticated user — verify Supabase JWT
        const token = authHeader.slice(7);
        const {
          data: { user },
          error,
        } = await supabase.auth.getUser(token);

        if (error) {
          console.error("Supabase getUser failed:", error.message);
        }
        if (!error && user) {
          req.visitorId = user.id;
          req.accountEmail = user.email;

          // Look up local account row for accountId (used by billing, team features)
          const accountResult = await pool.query(
            "SELECT id FROM accounts WHERE visitor_id = $1",
            [user.id],
          );
          if (accountResult.rows[0]) {
            req.accountId = accountResult.rows[0].id;
          } else if (user.email) {
            // Self-heal: authenticated user with no accounts row. This
            // normally runs from /auth/signup-complete but may not have if
            // the frontend retry loop exhausted. Create the row + SDK key
            // inline so the user is never stuck without an account.
            try {
              const insertResult = await pool.query(
                `INSERT INTO accounts (email, password_hash, name, visitor_id)
                 VALUES ($1, 'supabase-managed', $2, $3)
                 ON CONFLICT (email) DO UPDATE SET visitor_id = $3
                 RETURNING id`,
                [
                  user.email,
                  user.user_metadata?.full_name ||
                    user.user_metadata?.name ||
                    null,
                  user.id,
                ],
              );
              req.accountId = insertResult.rows[0]?.id;

              // Ensure an SDK key exists
              const existingKey = await pool.query(
                "SELECT id FROM sdk_api_keys WHERE user_id = $1 AND revoked_at IS NULL LIMIT 1",
                [user.id],
              );
              if (existingKey.rows.length === 0) {
                const cryptoMod = await import("crypto");
                const rawKey = `obs_${cryptoMod.randomBytes(24).toString("hex")}`;
                const keyHash = cryptoMod
                  .createHash("sha256")
                  .update(rawKey)
                  .digest("hex");
                const keyPrefix = rawKey.slice(0, 11);
                await pool.query(
                  `INSERT INTO sdk_api_keys (user_id, key_hash, key_prefix, name)
                   VALUES ($1, $2, $3, 'default')
                   ON CONFLICT (user_id, name) WHERE revoked_at IS NULL DO NOTHING`,
                  [user.id, keyHash, keyPrefix],
                );
              }
            } catch (healErr) {
              console.error(
                "ensureVisitor self-heal failed — user will see errors until this clears:",
                healErr,
              );
            }
          }

          // Logged-in users must never see sample data. Mark the in-memory
          // set AFTER the cleanup succeeds so a failed cleanup retries on
          // the next request instead of silently persisting stale rows.
          if (!sampleClearedUsers.has(user.id)) {
            try {
              await pool.query(
                "DELETE FROM observe_events WHERE user_id = $1 AND source = 'sample'",
                [user.id],
              );
              await pool.query(
                "DELETE FROM customers WHERE user_id = $1 AND customer_id IN ('cus_001','cus_002','cus_003','cus_004','cus_005','acme_saas','tidewater_ai','neondata','circleops','blazeml','quantumhr')",
                [user.id],
              );
              await pool.query(
                "DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id IN ('sub_001','sub_002','sub_003','sub_004','sub_005','sub_acme','sub_acme_addon','sub_tidewater','sub_neon','sub_neon_addon','sub_circle','sub_blaze','sub_quantum')",
                [user.id],
              );
              await pool.query(
                "DELETE FROM plans WHERE user_id = $1 AND plan_id IN ('starter', 'pro', 'enterprise')",
                [user.id],
              );
              await pool.query(
                "UPDATE user_data_status SET data_mode = CASE WHEN data_mode = 'sample' THEN 'none' ELSE data_mode END WHERE user_id = $1",
                [user.id],
              );
              sampleClearedUsers.add(user.id);
            } catch (cleanupErr) {
              // Intentionally don't add to sampleClearedUsers so we retry.
              console.error(
                "Sample data cleanup failed — will retry on next request:",
                cleanupErr,
              );
            }
          }
        }
      }

      // Anonymous visitor — generate a fresh UUID per request. We do NOT
      // honor any client-sent x-visitor-id header: an attacker could
      // otherwise set x-visitor-id: <victim-uuid> on an unauthenticated
      // request and read/write the victim's data. Guests don't need
      // persistent visitor IDs on the server anymore because their
      // preview is rendered entirely client-side from src/lib/guest-preview.ts.
      if (!req.visitorId) {
        const crypto = await import("crypto");
        req.visitorId = crypto.randomUUID();
      }

      // Ensure user_data_status row exists (only for authenticated users;
      // ephemeral guest UUIDs don't need persistent rows).
      if (req.accountEmail) {
        await pool.query(
          "INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [req.visitorId, "none"],
        );
      }

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
        // Require an authenticated Bearer token. Without this check, an
        // anonymous attacker with just an x-visitor-id header (or body)
        // could overwrite any victim's account email — an account takeover
        // precondition. `req.accountEmail` is only populated when
        // ensureVisitor successfully verifies the Supabase JWT.
        if (!req.accountEmail) {
          return res.status(401).json({ error: "Authentication required" });
        }
        const userId = req.visitorId!;
        const { name } = req.body;

        // Email is taken ONLY from the verified JWT — never from the body
        // or admin lookup. This prevents a confused-deputy rewrite where
        // a valid JWT for user A is used to overwrite account B's email.
        const email = req.accountEmail;

        // Create or update local account row (handles both email and visitor_id conflicts)
        const existing = await pool.query(
          "SELECT id FROM accounts WHERE email = $1 OR visitor_id = $2 LIMIT 1",
          [email, userId],
        );
        let result;
        if (existing.rows.length > 0) {
          result = await pool.query(
            `UPDATE accounts SET email = $1, visitor_id = $2, name = COALESCE($3, name), password_hash = 'supabase-managed', updated_at = NOW()
             WHERE id = $4 RETURNING id, email, name`,
            [email, userId, name?.trim() || null, existing.rows[0].id],
          );
        } else {
          result = await pool.query(
            `INSERT INTO accounts (email, password_hash, name, visitor_id)
             VALUES ($1, 'supabase-managed', $2, $3)
             RETURNING id, email, name`,
            [email, name?.trim() || null, userId],
          );
        }
        const account = result.rows[0];

        // Clear any leftover sample/demo data
        await pool.query(
          "DELETE FROM observe_events WHERE user_id = $1 AND source = $2",
          [userId, "sample"],
        );
        await pool.query(
          "DELETE FROM customers WHERE user_id = $1 AND customer_id IN ('cus_001','cus_002','cus_003','cus_004','cus_005','acme_saas','tidewater_ai','neondata','circleops','blazeml','quantumhr')",
          [userId],
        );
        await pool.query(
          "DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id IN ('sub_001','sub_002','sub_003','sub_004','sub_005','sub_acme','sub_acme_addon','sub_tidewater','sub_neon','sub_neon_addon','sub_circle','sub_blaze','sub_quantum')",
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

        // Every account gets an SDK key on signup. If the insert conflicts
        // (user already has a "default"), confirm an active key exists and
        // return null for rawKey — the existing key_prefix is already shown
        // on Data Sources. If the insert fails for any other reason, or no
        // active key exists after the attempt, FAIL THE REQUEST so the
        // user doesn't land in a state where onboarding tells them to
        // copy a key that doesn't exist.
        let sdkKey: string | null = null;
        const crypto = await import("crypto");
        const rawKey = `obs_${crypto.randomBytes(24).toString("hex")}`;
        const keyHash = crypto
          .createHash("sha256")
          .update(rawKey)
          .digest("hex");
        const keyPrefix = rawKey.slice(0, 11);
        const insertResult = await pool.query(
          `INSERT INTO sdk_api_keys (user_id, key_hash, key_prefix, name)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (user_id, name) DO NOTHING
             RETURNING id`,
          [userId, keyHash, keyPrefix, "default"],
        );
        if (insertResult.rows.length > 0) {
          sdkKey = rawKey;
        } else {
          // Verify an active key actually exists. If not, the insert
          // silently failed for a non-conflict reason — fail loudly.
          const existing = await pool.query(
            "SELECT id FROM sdk_api_keys WHERE user_id = $1 AND revoked_at IS NULL LIMIT 1",
            [userId],
          );
          if (existing.rows.length === 0) {
            throw new Error(
              "Failed to provision SDK key on signup — please retry.",
            );
          }
        }

        // Notify Kat of new signup + send welcome email.
        // Both are AWAITED synchronously because Vercel serverless
        // functions are killed immediately after the HTTP response
        // returns. setTimeout callbacks are dropped, and fire-and-forget
        // .catch() chains often race the lambda death and never actually
        // send. Awaiting adds ~400ms to signup but guarantees delivery.
        const resendKey = process.env.RESEND_API_KEY;
        if (resendKey) {
          const resendPost = (body: Record<string, unknown>) =>
            fetch("https://api.resend.com/emails", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${resendKey}`,
              },
              body: JSON.stringify(body),
            }).then(async (r) => {
              if (!r.ok) {
                const errText = await r.text().catch(() => "");
                console.error("Resend POST failed:", r.status, errText);
              }
            });

          await Promise.allSettled([
            resendPost({
              from: "Observe <kat@tansohq.com>",
              to: "kat@tansohq.com",
              subject: `New signup: ${email}`,
              html: `<p><strong>New user signed up for Observe</strong></p><p>Email: ${email}</p><p>Name: ${name?.trim() || "(not provided)"}</p><p>Time: ${new Date().toISOString()}</p>`,
            }),
            resendPost({
              from: "Kat from Observe <kat@tansohq.com>",
              to: email,
              subject: "Welcome to Observe",
              html: `<p>Hey there!</p>
<p>Just wanted to say thank you for signing up for Observe by Tanso! Would love to learn about what you're building and what brought you to Observe.</p>
<p>Feel free to reach out with any questions or feedback. Also down to hop on a quick call if that's easier: <a href="https://cal.com/katrina-laszlo/meeting">https://cal.com/katrina-laszlo/meeting</a></p>
<p>Kat<br/>Co-founder, Tanso</p>`,
            }),
          ]);
        }

        res.json({
          account: { id: account.id, email: account.email, name: account.name },
          sdkKey,
        });
      } catch (error: unknown) {
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
