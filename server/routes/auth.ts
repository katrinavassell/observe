import { Router, Request, Response, NextFunction } from "express";
import type { Pool } from "pg";
import crypto from "crypto";
import bcrypt from "bcryptjs";

declare module "express-session" {
  interface SessionData {
    visitorId: string;
    accountId: number;
    accountEmail: string;
  }
}

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
      if (!req.session.visitorId) {
        const visitorId = crypto.randomUUID();
        req.session.visitorId = visitorId;

        await pool.query(
          "INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT DO NOTHING",
          [visitorId, "none"],
        );
      }
      req.visitorId = req.session.visitorId;
      if (req.session.accountId) {
        req.accountId = req.session.accountId;
        req.accountEmail = req.session.accountEmail;

        // Logged-in users should never see sample data — always clean on first request per session
        if (!req.session._sampleCleared) {
          await pool.query(
            "DELETE FROM observe_events WHERE user_id = $1 AND source = 'sample'",
            [req.visitorId],
          );
          await pool.query(
            "DELETE FROM customers WHERE user_id = $1 AND customer_id IN ('cus_001','cus_002','cus_003','cus_004','cus_005')",
            [req.visitorId],
          );
          await pool.query(
            "DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id IN ('sub_001','sub_002','sub_003','sub_004','sub_005')",
            [req.visitorId],
          );
          await pool.query(
            "DELETE FROM plans WHERE user_id = $1 AND plan_id IN ('starter', 'pro', 'enterprise')",
            [req.visitorId],
          );
          await pool.query(
            "UPDATE user_data_status SET data_mode = CASE WHEN data_mode = 'sample' THEN 'none' ELSE data_mode END WHERE user_id = $1",
            [req.visitorId],
          );
          req.session._sampleCleared = true;
        }
      }
      next();
    } catch (error) {
      console.error("Visitor session error:", error);
      res.status(500).json({ error: "Session error" });
    }
  };
}

function regenerateSession(req: AuthRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const visitorId = req.session.visitorId;
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.visitorId = visitorId;
      resolve();
    });
  });
}

export function createAuthRoutes(
  pool: Pool,
  ensureVisitor: ReturnType<typeof createEnsureVisitor>,
) {
  const router = Router();

  router.get(
    "/session/init",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      res.json({
        visitorId: req.visitorId,
        account: req.session.accountId
          ? {
              id: req.session.accountId,
              email: req.session.accountEmail,
            }
          : null,
      });
    },
  );

  router.post(
    "/auth/signup",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { email, password, name } = req.body;
        if (
          !email ||
          typeof email !== "string" ||
          !password ||
          typeof password !== "string"
        ) {
          return res
            .status(400)
            .json({ error: "Email and password are required" });
        }
        if (password.length < 8) {
          return res
            .status(400)
            .json({ error: "Password must be at least 8 characters" });
        }
        if (name && typeof name !== "string") {
          return res.status(400).json({ error: "Name must be a string" });
        }

        const normalizedEmail = email.toLowerCase().trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
          return res.status(400).json({ error: "Invalid email format" });
        }
        const existing = await pool.query(
          "SELECT id FROM accounts WHERE email = $1",
          [normalizedEmail],
        );
        if (existing.rows.length > 0) {
          return res
            .status(409)
            .json({ error: "An account with this email already exists" });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const result = await pool.query(
          "INSERT INTO accounts (email, password_hash, name, visitor_id) VALUES ($1, $2, $3, $4) RETURNING id, email, name",
          [normalizedEmail, passwordHash, name?.trim() || null, req.visitorId],
        );
        const account = result.rows[0];

        // Clear any leftover sample/demo data from the anonymous session
        await pool.query(
          "DELETE FROM observe_events WHERE user_id = $1 AND source = $2",
          [req.visitorId, "sample"],
        );
        await pool.query("DELETE FROM customers WHERE user_id = $1", [
          req.visitorId,
        ]);
        await pool.query("DELETE FROM subscriptions WHERE user_id = $1", [
          req.visitorId,
        ]);
        await pool.query("DELETE FROM plans WHERE user_id = $1", [
          req.visitorId,
        ]);
        await pool.query("DELETE FROM cost_records WHERE user_id = $1", [
          req.visitorId,
        ]);
        await pool.query("DELETE FROM usage_records WHERE user_id = $1", [
          req.visitorId,
        ]);
        await pool.query("DELETE FROM ai_insights WHERE user_id = $1", [
          req.visitorId,
        ]);
        await pool.query(
          "UPDATE user_data_status SET data_mode = 'none' WHERE user_id = $1",
          [req.visitorId],
        );

        // Auto-generate an SDK key so onboarding can show it immediately
        let sdkKey: string | null = null;
        try {
          const rawKey = `obs_${crypto.randomBytes(24).toString("hex")}`;
          const keyHash = crypto
            .createHash("sha256")
            .update(rawKey)
            .digest("hex");
          const keyPrefix = rawKey.slice(0, 11);
          await pool.query(
            `INSERT INTO sdk_api_keys (user_id, key_hash, key_prefix, name) VALUES ($1, $2, $3, $4)
             ON CONFLICT DO NOTHING`,
            [req.visitorId, keyHash, keyPrefix, "default"],
          );
          sdkKey = rawKey;
        } catch (keyErr) {
          console.error("Auto SDK key generation failed (non-fatal):", keyErr);
        }

        await regenerateSession(req);
        req.session.accountId = account.id;
        req.session.accountEmail = account.email;

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
              subject: `New signup: ${normalizedEmail}`,
              html: `<p><strong>New user signed up for Observe</strong></p><p>Email: ${normalizedEmail}</p><p>Name: ${name?.trim() || "(not provided)"}</p><p>Time: ${new Date().toISOString()}</p>`,
            }),
          }).catch((err: unknown) =>
            console.error("Failed to send signup notification:", err),
          );

          // Welcome email to the new user (delayed 3 minutes)
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
                  to: normalizedEmail,
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
        if (error.code === "23505") {
          return res
            .status(409)
            .json({ error: "An account with this email already exists" });
        }
        console.error("Signup error:", error);
        res.status(500).json({ error: "Failed to create account" });
      }
    },
  );

  router.post(
    "/auth/login",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { email, password } = req.body;
        if (
          !email ||
          typeof email !== "string" ||
          !password ||
          typeof password !== "string"
        ) {
          return res
            .status(400)
            .json({ error: "Email and password are required" });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const result = await pool.query(
          "SELECT id, email, name, password_hash, visitor_id FROM accounts WHERE email = $1",
          [normalizedEmail],
        );
        if (result.rows.length === 0) {
          return res.status(401).json({ error: "Invalid email or password" });
        }

        const account = result.rows[0];
        const passwordValid = await bcrypt.compare(
          password,
          account.password_hash,
        );
        if (!passwordValid) {
          return res.status(401).json({ error: "Invalid email or password" });
        }

        const visitorIdToUse = account.visitor_id || req.visitorId;
        if (!account.visitor_id) {
          await pool.query(
            "UPDATE accounts SET visitor_id = $1 WHERE id = $2",
            [req.visitorId, account.id],
          );
        }

        await regenerateSession(req);
        req.session.visitorId = visitorIdToUse;
        req.session.accountId = account.id;
        req.session.accountEmail = account.email;

        // Clear sample data from the account's visitor so logged-in users see only real data
        const idsToClean = [visitorIdToUse];
        if (req.visitorId !== visitorIdToUse) {
          idsToClean.push(req.visitorId!);
        }
        for (const vid of idsToClean) {
          await pool.query(
            "DELETE FROM observe_events WHERE user_id = $1 AND source = $2",
            [vid, "sample"],
          );
          await pool.query(
            "DELETE FROM customers WHERE user_id = $1 AND customer_id IN ('cus_001','cus_002','cus_003','cus_004','cus_005')",
            [vid],
          );
          await pool.query(
            "DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id IN ('sub_001','sub_002','sub_003','sub_004','sub_005')",
            [vid],
          );
          await pool.query(
            "DELETE FROM plans WHERE user_id = $1 AND plan_id IN ('starter', 'pro', 'enterprise')",
            [vid],
          );
          await pool.query(
            "UPDATE user_data_status SET data_mode = CASE WHEN data_mode = 'sample' THEN 'none' ELSE data_mode END WHERE user_id = $1",
            [vid],
          );
        }

        // Notify Kat of login
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
              subject: `Login: ${account.email}`,
              html: `<p><strong>User logged in to Observe</strong></p><p>Email: ${account.email}</p><p>Name: ${account.name || "(not set)"}</p><p>Time: ${new Date().toISOString()}</p>`,
            }),
          }).catch((err: unknown) =>
            console.error("Failed to send login notification:", err),
          );
        }

        res.json({
          account: { id: account.id, email: account.email, name: account.name },
        });
      } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: "Failed to log in" });
      }
    },
  );

  router.post("/auth/logout", (req: AuthRequest, res: Response) => {
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ error: "Failed to log out" });
      }
      res.clearCookie("pa.sid");
      res.json({ success: true });
    });
  });

  router.get(
    "/auth/me",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      if (!req.session.accountId) {
        return res.json({ account: null });
      }
      try {
        const result = await pool.query(
          "SELECT id, email, name FROM accounts WHERE id = $1",
          [req.session.accountId],
        );
        if (result.rows.length === 0) {
          req.session.accountId = undefined as any;
          req.session.accountEmail = undefined as any;
          return res.json({ account: null });
        }
        res.json({ account: result.rows[0] });
      } catch (error) {
        console.error("Auth me error:", error);
        res.status(500).json({ error: "Failed to get account info" });
      }
    },
  );

  // ─── Forgot password ──────────────────────────────────────────────────
  router.post(
    "/auth/forgot-password",
    async (req: AuthRequest, res: Response) => {
      try {
        const { email } = req.body;
        if (!email || typeof email !== "string") {
          return res.status(400).json({ error: "Email is required" });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const result = await pool.query(
          "SELECT id, email FROM accounts WHERE email = $1",
          [normalizedEmail],
        );

        // Always return success to prevent email enumeration
        if (result.rows.length === 0) {
          return res.json({ success: true });
        }

        const account = result.rows[0];
        const token = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto
          .createHash("sha256")
          .update(token)
          .digest("hex");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Invalidate any existing tokens for this account
        await pool.query(
          "UPDATE password_reset_tokens SET used_at = NOW() WHERE account_id = $1 AND used_at IS NULL",
          [account.id],
        );

        await pool.query(
          "INSERT INTO password_reset_tokens (account_id, token_hash, expires_at) VALUES ($1, $2, $3)",
          [account.id, tokenHash, expiresAt],
        );

        // Send reset email via Resend
        const apiKey = process.env.RESEND_API_KEY;
        if (apiKey) {
          const appUrl = process.env.APP_URL || "http://localhost:5173";
          const resetUrl = `${appUrl}/reset-password?token=${token}`;
          const fromEmail = process.env.ALERT_FROM_EMAIL || "kat@tansohq.com";

          await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              from: fromEmail,
              to: account.email,
              subject: "Reset your password",
              html: `
              <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto;">
                <h2 style="font-size: 18px; margin-bottom: 8px;">Password reset</h2>
                <p style="color: #666; margin-bottom: 16px;">
                  Click the link below to reset your password. This link expires in 1 hour.
                </p>
                <a href="${resetUrl}" style="display: inline-block; background: #111; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px;">
                  Reset password
                </a>
                <p style="color: #999; font-size: 12px; margin-top: 24px;">
                  If you didn't request this, you can safely ignore this email.
                </p>
              </div>
            `,
            }),
          }).catch((err) => console.error("Failed to send reset email:", err));
        } else {
          console.warn("RESEND_API_KEY not set, skipping password reset email");
        }

        res.json({ success: true });
      } catch (error) {
        console.error("Forgot password error:", error);
        res.status(500).json({ error: "Failed to process request" });
      }
    },
  );

  router.post(
    "/auth/reset-password",
    async (req: AuthRequest, res: Response) => {
      try {
        const { token, password } = req.body;
        if (
          !token ||
          typeof token !== "string" ||
          !password ||
          typeof password !== "string"
        ) {
          return res
            .status(400)
            .json({ error: "Token and password are required" });
        }
        if (password.length < 8) {
          return res
            .status(400)
            .json({ error: "Password must be at least 8 characters" });
        }

        const tokenHash = crypto
          .createHash("sha256")
          .update(token)
          .digest("hex");
        const result = await pool.query(
          `SELECT t.id, t.account_id FROM password_reset_tokens t
         WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > NOW()`,
          [tokenHash],
        );

        if (result.rows.length === 0) {
          return res
            .status(400)
            .json({ error: "Invalid or expired reset link" });
        }

        const { id: tokenId, account_id: accountId } = result.rows[0];
        const passwordHash = await bcrypt.hash(password, 12);

        await pool.query(
          "UPDATE accounts SET password_hash = $1, updated_at = NOW() WHERE id = $2",
          [passwordHash, accountId],
        );
        await pool.query(
          "UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1",
          [tokenId],
        );

        res.json({ success: true });
      } catch (error) {
        console.error("Reset password error:", error);
        res.status(500).json({ error: "Failed to reset password" });
      }
    },
  );

  return router;
}
