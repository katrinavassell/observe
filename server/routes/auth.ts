import { Router, Request, Response, NextFunction } from "express";
import type { Pool } from "pg";
import { createClerkClient } from "@clerk/backend";
import { encryptApiKey } from "../stripe-client.js";

const clerkSecretKey = process.env.CLERK_SECRET_KEY || "";
const clerk = createClerkClient({ secretKey: clerkSecretKey });

export interface AuthRequest extends Request {
  visitorId?: string;
  accountId?: number;
  accountEmail?: string;
}

const sampleClearedUsers = new Set<string>();

const ACCOUNT_ID_TTL_MS = 5 * 60 * 1000;
const accountIdCache = new Map<
  string,
  { accountId: number; expiresAt: number }
>();

export function createEnsureVisitor(pool: Pool) {
  return async function ensureVisitor(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      if (
        process.env.TEST_AUTH_BYPASS === "1" &&
        req.headers["x-test-user-id"]
      ) {
        req.visitorId = req.headers["x-test-user-id"] as string;
        req.accountEmail = "test@observe.test";
        return next();
      }

      const authHeader = req.headers.authorization;

      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);

        let clerkUserId: string;
        let clerkEmail: string | undefined;
        let clerkName: string | undefined;

        try {
          const payload = await clerk.verifyToken(token);
          clerkUserId = payload.sub;

          const user = await clerk.users.getUser(clerkUserId);
          clerkEmail = user.emailAddresses.find(
            (e) => e.id === user.primaryEmailAddressId,
          )?.emailAddress;
          clerkName =
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
            undefined;
        } catch (err) {
          console.error("Clerk token verification failed:", err);
          return next();
        }

        req.visitorId = clerkUserId;
        req.accountEmail = clerkEmail;

        const accountResult = await pool.query(
          "SELECT id FROM users WHERE visitor_id = $1",
          [clerkUserId],
        );
        if (!accountResult.rows[0] && clerkEmail) {
          try {
            const insertedUser = await pool.query(
              `INSERT INTO users (email, password_hash, name, visitor_id)
               VALUES ($1, 'clerk-managed', $2, $3)
               ON CONFLICT (email) DO UPDATE SET visitor_id = $3
               RETURNING id`,
              [clerkEmail, clerkName || null, clerkUserId],
            );
            const userInternalId = insertedUser.rows[0].id as number;

            const existingMembership = await pool.query(
              `SELECT account_id FROM user_accounts
                WHERE user_id = $1 AND role = 'owner' AND status = 'active'
                LIMIT 1`,
              [userInternalId],
            );
            let resolvedAccountId: number | undefined =
              existingMembership.rows[0]?.account_id;
            if (resolvedAccountId === undefined) {
              const accountName = clerkName
                ? `${clerkName}'s Account`
                : "Personal Account";
              const insertedAccount = await pool.query(
                `INSERT INTO accounts (name, email, password_hash, visitor_id)
                 VALUES ($1, $2, 'clerk-managed', $3) RETURNING id`,
                [accountName, clerkEmail, clerkUserId],
              );
              resolvedAccountId = insertedAccount.rows[0].id as number;
              await pool.query(
                `INSERT INTO user_accounts (user_id, account_id, role, status, joined_at)
                 VALUES ($1, $2, 'owner', 'active', NOW())
                 ON CONFLICT (user_id, account_id) DO NOTHING`,
                [userInternalId, resolvedAccountId],
              );
            }

            const existingKey = await pool.query(
              "SELECT id FROM sdk_api_keys WHERE user_id = $1 AND revoked_at IS NULL LIMIT 1",
              [clerkUserId],
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
                `INSERT INTO sdk_api_keys (user_id, account_id, key_hash, key_prefix, encrypted_key, name)
                 VALUES ($1, $2, $3, $4, $5, 'default')
                 ON CONFLICT (account_id, name) WHERE revoked_at IS NULL DO NOTHING`,
                [
                  clerkUserId,
                  resolvedAccountId,
                  keyHash,
                  keyPrefix,
                  encryptApiKey(rawKey),
                ],
              );
            }
          } catch (healErr) {
            console.error("ensureVisitor self-heal failed:", healErr);
          }
        }

        if (!sampleClearedUsers.has(clerkUserId)) {
          try {
            await pool.query(
              "DELETE FROM observe_events WHERE user_id = $1 AND source = 'sample'",
              [clerkUserId],
            );
            await pool.query(
              "DELETE FROM customers WHERE user_id = $1 AND customer_id IN ('cus_001','cus_002','cus_003','cus_004','cus_005','acme_saas','tidewater_ai','neondata','circleops','blazeml','quantumhr')",
              [clerkUserId],
            );
            await pool.query(
              "DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id IN ('sub_001','sub_002','sub_003','sub_004','sub_005','sub_acme','sub_acme_addon','sub_tidewater','sub_neon','sub_neon_addon','sub_circle','sub_blaze','sub_quantum')",
              [clerkUserId],
            );
            await pool.query(
              "DELETE FROM plans WHERE user_id = $1 AND plan_id IN ('starter', 'pro', 'enterprise')",
              [clerkUserId],
            );
            await pool.query(
              "UPDATE user_data_status SET data_mode = CASE WHEN data_mode = 'sample' THEN 'none' ELSE data_mode END WHERE user_id = $1",
              [clerkUserId],
            );
            sampleClearedUsers.add(clerkUserId);
          } catch (cleanupErr) {
            console.error(
              "Sample data cleanup failed — will retry on next request:",
              cleanupErr,
            );
          }
        }

        const headerAccountIdRaw = req.headers["x-account-id"];
        const headerAccountId = Array.isArray(headerAccountIdRaw)
          ? headerAccountIdRaw[0]
          : headerAccountIdRaw;
        const cacheKey = `${clerkUserId}:${headerAccountId ?? ""}`;
        const cached = accountIdCache.get(cacheKey);
        const now = Date.now();
        if (cached && cached.expiresAt > now) {
          req.accountId = cached.accountId;
        } else {
          let resolvedAccountId: number | undefined;
          if (headerAccountId) {
            const verifyResult = await pool.query(
              `SELECT ua.account_id
               FROM user_accounts ua
               JOIN users u ON u.id = ua.user_id
               WHERE u.visitor_id = $1 AND ua.account_id = $2 AND ua.status = 'active'
               LIMIT 1`,
              [clerkUserId, headerAccountId],
            );
            if (verifyResult.rows[0]) {
              resolvedAccountId = verifyResult.rows[0].account_id;
            }
          }
          if (resolvedAccountId === undefined) {
            const defaultResult = await pool.query(
              `SELECT ua.account_id
               FROM user_accounts ua
               JOIN users u ON u.id = ua.user_id
               WHERE u.visitor_id = $1 AND ua.status = 'active'
               ORDER BY CASE ua.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, ua.joined_at ASC NULLS LAST
               LIMIT 1`,
              [clerkUserId],
            );
            if (defaultResult.rows[0]) {
              resolvedAccountId = defaultResult.rows[0].account_id;
            }
          }
          if (resolvedAccountId !== undefined) {
            req.accountId = resolvedAccountId;
            accountIdCache.set(cacheKey, {
              accountId: resolvedAccountId,
              expiresAt: now + ACCOUNT_ID_TTL_MS,
            });
          } else {
            console.warn(
              "ensureVisitor: no active user_accounts row for visitor",
              clerkUserId,
            );
          }
        }
      }

      if (!req.visitorId) {
        const crypto = await import("crypto");
        req.visitorId = crypto.randomUUID();
      }

      if (req.accountEmail) {
        await pool.query(
          "INSERT INTO user_data_status (user_id, account_id, data_mode) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [req.visitorId, req.accountId ?? null, "none"],
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

  router.post(
    "/auth/signup-complete",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.accountEmail) {
          return res.status(401).json({ error: "Authentication required" });
        }
        const userId = req.visitorId!;
        const email = req.accountEmail;
        const { name } = req.body;

        const existing = await pool.query(
          "SELECT id FROM users WHERE email = $1 OR visitor_id = $2 LIMIT 1",
          [email, userId],
        );
        let result;
        const isNewAccount = existing.rows.length === 0;
        if (!isNewAccount) {
          result = await pool.query(
            `UPDATE users SET email = $1, visitor_id = $2, name = COALESCE($3, name), password_hash = 'clerk-managed', updated_at = NOW()
             WHERE id = $4 RETURNING id, email, name`,
            [email, userId, name?.trim() || null, existing.rows[0].id],
          );
        } else {
          result = await pool.query(
            `INSERT INTO users (email, password_hash, name, visitor_id)
             VALUES ($1, 'clerk-managed', $2, $3)
             RETURNING id, email, name`,
            [email, name?.trim() || null, userId],
          );
        }
        const account = result.rows[0];
        const userInternalId = account.id as number;

        const existingMembership = await pool.query(
          `SELECT account_id FROM user_accounts
            WHERE user_id = $1 AND role = 'owner' AND status = 'active'
            LIMIT 1`,
          [userInternalId],
        );
        let resolvedAccountId: number | undefined =
          existingMembership.rows[0]?.account_id;
        if (resolvedAccountId === undefined) {
          const trimmedName = name?.trim();
          const accountName = trimmedName
            ? `${trimmedName}'s Account`
            : "Personal Account";
          const insertedAccount = await pool.query(
            `INSERT INTO accounts (name, email, password_hash, visitor_id)
             VALUES ($1, $2, 'clerk-managed', $3) RETURNING id`,
            [accountName, email, userId],
          );
          resolvedAccountId = insertedAccount.rows[0].id as number;
          await pool.query(
            `INSERT INTO user_accounts (user_id, account_id, role, status, joined_at)
             VALUES ($1, $2, 'owner', 'active', NOW())
             ON CONFLICT (user_id, account_id) DO NOTHING`,
            [userInternalId, resolvedAccountId],
          );
        }

        if (isNewAccount) {
          const adminEmailsForDogfood = [
            "tansoadmin@tansohq.com",
            "kat@tansohq.com",
            "doug@tansohq.com",
            ...(process.env.ADMIN_EMAILS
              ? process.env.ADMIN_EMAILS.split(",").map((e) =>
                  e.trim().toLowerCase(),
                )
              : []),
          ];
          pool
            .query(
              `SELECT u.visitor_id, u.email, ua.account_id
                 FROM users u
                 LEFT JOIN user_accounts ua
                   ON ua.user_id = u.id AND ua.status = 'active'
                WHERE LOWER(u.email) = ANY($1) AND u.visitor_id IS NOT NULL`,
              [adminEmailsForDogfood.map((e) => e.toLowerCase())],
            )
            .then(async (admins) => {
              for (const row of admins.rows) {
                const adminUid = row.visitor_id as string;
                const adminAccountId =
                  (row.account_id as number | null) ?? null;
                await pool
                  .query(
                    `INSERT INTO customers (user_id, account_id, customer_id, name, email)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT DO NOTHING`,
                    [
                      adminUid,
                      adminAccountId,
                      email,
                      name?.trim() || email,
                      email,
                    ],
                  )
                  .catch((err) =>
                    console.error("Dogfood customer insert failed:", err),
                  );
                await pool
                  .query(
                    `INSERT INTO observe_events
                       (user_id, account_id, customer_id, feature_key, event_name,
                        timestamp, source, granularity, idempotency_key)
                     VALUES ($1, $2, $3, 'observe_signup', 'signup', NOW(),
                             'sdk', 'event', $4)
                     ON CONFLICT (account_id, idempotency_key)
                       WHERE idempotency_key IS NOT NULL DO NOTHING`,
                    [adminUid, adminAccountId, email, `signup:${email}`],
                  )
                  .catch((err) =>
                    console.error("Dogfood signup event insert failed:", err),
                  );
              }
            })
            .catch((err) => console.error("Dogfood admin lookup failed:", err));
        }

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

        let sdkKey: string | null = null;
        const crypto = await import("crypto");
        const rawKey = `obs_${crypto.randomBytes(24).toString("hex")}`;
        const keyHash = crypto
          .createHash("sha256")
          .update(rawKey)
          .digest("hex");
        const keyPrefix = rawKey.slice(0, 11);
        const insertResult = await pool.query(
          `INSERT INTO sdk_api_keys (user_id, account_id, key_hash, key_prefix, encrypted_key, name)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (account_id, name) WHERE revoked_at IS NULL DO NOTHING
             RETURNING id`,
          [
            userId,
            resolvedAccountId,
            keyHash,
            keyPrefix,
            encryptApiKey(rawKey),
            "default",
          ],
        );
        if (insertResult.rows.length > 0) {
          sdkKey = rawKey;
        } else {
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

        const resendKey = process.env.RESEND_API_KEY;
        if (isNewAccount && resendKey) {
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
              to: ["kat@tansohq.com", "doug@tansohq.com"],
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

  router.get(
    "/auth/me",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          "SELECT id, email, name FROM users WHERE visitor_id = $1",
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

  router.get(
    "/me/accounts",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      if (!req.visitorId) {
        return res.status(401).json({ error: "Not authenticated" });
      }
      try {
        const result = await pool.query(
          `SELECT a.id, a.name, ua.role, ua.status, ua.joined_at
             FROM user_accounts ua
             JOIN accounts a ON a.id = ua.account_id
             JOIN users u ON u.id = ua.user_id
            WHERE u.visitor_id = $1 AND ua.status = 'active'
            ORDER BY CASE ua.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,
                     ua.joined_at ASC NULLS LAST`,
          [req.visitorId],
        );
        res.json({
          accounts: result.rows.map((r) => ({
            id: r.id,
            name: r.name,
            role: r.role,
            status: r.status,
            joined_at: r.joined_at,
            is_current: req.accountId === r.id,
          })),
          current_account_id: req.accountId ?? null,
        });
      } catch (err) {
        console.error("GET /me/accounts error:", err);
        res.status(500).json({ error: "Failed to load accounts" });
      }
    },
  );

  return router;
}
