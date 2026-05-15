import { Router, Request, Response, NextFunction } from "express";
import type { Pool } from "pg";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { verifyToken, createClerkClient } from "@clerk/backend";
import { encryptApiKey } from "../stripe-client.js";

const clerkSecretKey = process.env.CLERK_SECRET_KEY || "";
const clerk = createClerkClient({ secretKey: clerkSecretKey });

const IMPERSONATION_ADMIN_EMAILS = (() => {
  const legacy = process.env.ADMIN_EMAIL
    ? [process.env.ADMIN_EMAIL.toLowerCase()]
    : [];
  const list = process.env.ADMIN_EMAILS
    ? process.env.ADMIN_EMAILS.split(",").map((e) => e.trim().toLowerCase())
    : [];
  return new Set([...legacy, ...list]);
})();

export interface AuthRequest extends Request {
  visitorId?: string;
  accountId?: number;
  accountEmail?: string;
  isNewUser?: boolean;
  keyScopes?: string[] | null;
  keyId?: number;
  keyBudgetCents?: number | null;
  keyBudgetUsedCents?: number;
  isImpersonating?: boolean;
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
        process.env.NODE_ENV !== "production" &&
        process.env.TEST_AUTH_BYPASS === "1" &&
        req.headers["x-test-user-id"]
      ) {
        req.visitorId = req.headers["x-test-user-id"] as string;
        req.accountEmail = "test@observe.test";

        const testAccountResult = await pool.query(
          `SELECT ua.account_id FROM user_accounts ua JOIN users u ON u.id = ua.user_id WHERE u.visitor_id = $1 AND ua.status = 'active' LIMIT 1`,
          [req.visitorId],
        );
        if (testAccountResult.rows[0]) {
          req.accountId = testAccountResult.rows[0].account_id;
        } else {
          await pool.query(
            "INSERT INTO users (visitor_id) VALUES ($1) ON CONFLICT DO NOTHING",
            [req.visitorId],
          );
          const userRow = await pool.query(
            "SELECT id FROM users WHERE visitor_id = $1",
            [req.visitorId],
          );
          const accountRow = await pool.query(
            "INSERT INTO accounts (name) VALUES ($1) RETURNING id",
            ["Test Account"],
          );
          req.accountId = accountRow.rows[0].id;
          await pool.query(
            "INSERT INTO user_accounts (user_id, account_id, role, status, joined_at) VALUES ($1, $2, 'owner', 'active', NOW()) ON CONFLICT DO NOTHING",
            [userRow.rows[0].id, req.accountId],
          );
        }
        return next();
      }

      const authHeader = req.headers.authorization;

      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.slice(7);

        let clerkUserId: string;
        let clerkOrgId: string | undefined;
        let clerkEmail: string | undefined;
        let clerkName: string | undefined;

        try {
          const payload = await verifyToken(token, {
            secretKey: clerkSecretKey,
          });
          clerkUserId = payload.sub;
          const orgClaim = (payload as Record<string, unknown>).o as
            | { id?: string }
            | undefined;
          clerkOrgId = orgClaim?.id;

          const user = await clerk.users.getUser(clerkUserId);
          clerkEmail = user.emailAddresses.find(
            (e) => e.id === user.primaryEmailAddressId,
          )?.emailAddress;
          clerkName =
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
            undefined;
        } catch (err) {
          console.error("Clerk token verification failed:", err);
          return res.status(401).json({ error: "Invalid or expired token" });
        }

        req.visitorId = clerkUserId;
        req.accountEmail = clerkEmail;

        const accountResult = await pool.query(
          "SELECT id FROM users WHERE visitor_id = $1",
          [clerkUserId],
        );
        if (!accountResult.rows[0] && clerkEmail) {
          req.isNewUser = true;
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
              "SELECT id FROM sdk_api_keys WHERE account_id = $1 AND revoked_at IS NULL LIMIT 1",
              [resolvedAccountId],
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
              "DELETE FROM customers WHERE account_id IN (SELECT ua.account_id FROM user_accounts ua JOIN users u ON u.id = ua.user_id WHERE u.visitor_id = $1) AND customer_id IN ('cus_001','cus_002','cus_003','cus_004','cus_005','acme_saas','tidewater_ai','neondata','circleops','blazeml','quantumhr')",
              [clerkUserId],
            );
            await pool.query(
              "DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id IN ('sub_001','sub_002','sub_003','sub_004','sub_005','sub_acme','sub_acme_addon','sub_tidewater','sub_neon','sub_neon_addon','sub_circle','sub_blaze','sub_quantum')",
              [clerkUserId],
            );
            await pool.query(
              "DELETE FROM plans WHERE user_id = $1 AND plan_id IN ('_sample_starter', '_sample_pro', '_sample_enterprise')",
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

        const cacheKey = `${clerkUserId}:${clerkOrgId ?? "personal"}`;
        const cached = accountIdCache.get(cacheKey);
        const now = Date.now();
        if (cached && cached.expiresAt > now) {
          req.accountId = cached.accountId;
        } else {
          let resolvedAccountId: number | undefined;

          if (clerkOrgId) {
            const orgResult = await pool.query(
              `SELECT id FROM accounts WHERE clerk_org_id = $1`,
              [clerkOrgId],
            );
            if (orgResult.rows[0]) {
              resolvedAccountId = orgResult.rows[0].id;
            } else {
              try {
                const clerkOrg = await clerk.organizations.getOrganization({
                  organizationId: clerkOrgId,
                });
                const insertedAccount = await pool.query(
                  `INSERT INTO accounts (name, clerk_org_id)
                   VALUES ($1, $2) RETURNING id`,
                  [clerkOrg.name, clerkOrgId],
                );
                resolvedAccountId = insertedAccount.rows[0].id as number;
                const userRow = await pool.query(
                  `SELECT id FROM users WHERE visitor_id = $1`,
                  [clerkUserId],
                );
                if (userRow.rows[0]) {
                  await pool.query(
                    `INSERT INTO user_accounts (user_id, account_id, role, status, joined_at)
                     VALUES ($1, $2, 'owner', 'active', NOW())
                     ON CONFLICT (user_id, account_id) DO NOTHING`,
                    [userRow.rows[0].id, resolvedAccountId],
                  );
                }
              } catch (orgErr) {
                console.error(
                  "ensureVisitor: failed to create account for org",
                  clerkOrgId,
                  orgErr,
                );
              }
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
            // Backfill: if account has no clerk_org_id but user has one, stamp it
            if (clerkOrgId) {
              pool
                .query(
                  `UPDATE accounts SET clerk_org_id = $1 WHERE id = $2 AND clerk_org_id IS NULL`,
                  [clerkOrgId, resolvedAccountId],
                )
                .catch(() => {});
            }
          } else {
            console.warn("ensureVisitor: no account resolved for", clerkUserId);
          }
        }
      }

      const xAccountId = req.headers["x-account-id"];
      if (xAccountId && req.accountEmail && req.visitorId) {
        const targetId = Number(xAccountId);
        if (
          Number.isFinite(targetId) &&
          targetId > 0 &&
          targetId !== req.accountId
        ) {
          if (IMPERSONATION_ADMIN_EMAILS.has(req.accountEmail.toLowerCase())) {
            const targetExists = await pool.query(
              "SELECT id FROM accounts WHERE id = $1",
              [targetId],
            );
            if (targetExists.rows.length > 0) {
              req.accountId = targetId;
              req.isImpersonating = true;
            }
          } else {
            const membership = await pool.query(
              `SELECT ua.account_id FROM user_accounts ua
               JOIN users u ON u.id = ua.user_id
               WHERE u.visitor_id = $1 AND ua.account_id = $2 AND ua.status = 'active'`,
              [req.visitorId, targetId],
            );
            if (membership.rows.length > 0) {
              req.accountId = targetId;
            }
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

export function createEnsureAuth(pool: Pool) {
  const ensureVisitor = createEnsureVisitor(pool);

  return async function ensureAuth(
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) {
    try {
      const authHeader = req.headers.authorization;
      const observeKey = req.headers["observe-key"] as string | undefined;
      const legacyKey = req.headers["x-tanso-key"] as string | undefined;

      const hasClerkToken =
        authHeader?.startsWith("Bearer ") &&
        !authHeader.slice(7).startsWith("obs_");
      if (hasClerkToken) {
        return ensureVisitor(req, res, next);
      }

      const apiKey =
        observeKey ||
        legacyKey ||
        (authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined);

      if (apiKey) {
        const keyHash = crypto
          .createHash("sha256")
          .update(apiKey)
          .digest("hex");
        const result = await pool.query(
          `SELECT id, user_id, account_id, scopes, budget_cents, budget_used_cents,
                  budget_period, budget_reset_at, expires_at
           FROM sdk_api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
          [keyHash],
        );
        if (result.rows.length > 0) {
          const row = result.rows[0];

          if (row.expires_at && new Date(row.expires_at) < new Date()) {
            return res.status(401).json({ error: "API key has expired" });
          }

          req.visitorId = row.user_id;
          req.accountId = row.account_id ?? undefined;
          req.keyId = row.id;
          req.keyScopes = row.scopes ?? null;
          req.keyBudgetCents = row.budget_cents ?? null;
          req.keyBudgetUsedCents = row.budget_used_cents ?? 0;

          if (req.accountId) {
            const acct = await pool.query(
              "SELECT email FROM accounts WHERE id = $1",
              [req.accountId],
            );
            req.accountEmail = acct.rows[0]?.email ?? "sdk-key@observe";
          }
          pool
            .query(
              "UPDATE sdk_api_keys SET last_used_at = NOW() WHERE key_hash = $1",
              [keyHash],
            )
            .catch((err) =>
              console.error("SDK key last_used_at update failed:", err),
            );
          return next();
        }
        return res.status(401).json({
          error:
            "Invalid API key. Check your Bearer token or Observe-Key header.",
        });
      }

      return ensureVisitor(req, res, next);
    } catch (error) {
      console.error("Auth middleware error:", error);
      res.status(500).json({ error: "Authentication error" });
    }
  };
}

export const VALID_SCOPES = [
  "proxy.chat",
  "usage.read",
  "usage.write",
  "billing.read",
  "billing.write",
  "customers.read",
  "customers.write",
  "events.read",
  "events.write",
  "recommendations.read",
  "alerts.read",
  "alerts.write",
  "models.read",
  "admin",
] as const;

export const SIGNUP_ALLOWED_SCOPES = new Set([
  "proxy.chat",
  "usage.read",
  "billing.read",
  "events.read",
  "events.write",
  "customers.read",
  "recommendations.read",
  "models.read",
]);

export type Scope = (typeof VALID_SCOPES)[number];

export function ensureScoped(requiredScope: Scope) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (req.keyScopes === undefined || req.keyScopes === null) {
      return next();
    }
    if (
      req.keyScopes.includes(requiredScope) ||
      req.keyScopes.includes("admin")
    ) {
      return next();
    }
    return res.status(403).json({
      error: `This API key does not have the '${requiredScope}' scope`,
    });
  };
}

export interface ResolvedKey {
  id: number;
  user_id: string;
  account_id: number | null;
  scopes: string[] | null;
  budget_cents: number | null;
  budget_used_cents: number;
  budget_period: string | null;
  budget_reset_at: Date | null;
  expires_at: Date | null;
}

export function createKeyHelpers(pool: Pool) {
  async function resolveKey(observeKey: string): Promise<ResolvedKey | null> {
    const keyHash = crypto
      .createHash("sha256")
      .update(observeKey)
      .digest("hex");
    const result = await pool.query(
      `SELECT id, user_id, account_id, scopes, budget_cents, budget_used_cents,
              budget_period, budget_reset_at, expires_at
       FROM sdk_api_keys WHERE key_hash = $1 AND revoked_at IS NULL`,
      [keyHash],
    );
    if (result.rows.length === 0) return null;

    const row = result.rows[0];
    if (row.expires_at && new Date(row.expires_at) < new Date()) return null;

    pool
      .query(
        "UPDATE sdk_api_keys SET last_used_at = NOW() WHERE key_hash = $1",
        [keyHash],
      )
      .catch((err) =>
        console.error("Failed to update sdk_api_keys last_used_at:", err),
      );

    return row;
  }

  async function checkBudget(
    key: ResolvedKey,
  ): Promise<{ allowed: boolean; remaining?: number }> {
    if (key.budget_cents === null) return { allowed: true };

    if (key.budget_period && key.budget_reset_at) {
      const resetAt = new Date(key.budget_reset_at);
      if (new Date() >= resetAt) {
        const nextReset =
          key.budget_period === "day"
            ? new Date(resetAt.getTime() + 24 * 60 * 60 * 1000)
            : new Date(
                resetAt.getFullYear(),
                resetAt.getMonth() + 1,
                resetAt.getDate(),
              );
        await pool.query(
          `UPDATE sdk_api_keys SET budget_used_cents = 0, budget_reset_at = $1 WHERE id = $2`,
          [nextReset.toISOString(), key.id],
        );
        key.budget_used_cents = 0;
        key.budget_reset_at = nextReset;
      }
    }

    const remaining = key.budget_cents - key.budget_used_cents;
    return { allowed: remaining > 0, remaining };
  }

  async function incrementBudget(keyId: number, costCents: number) {
    if (costCents <= 0) return;
    await pool.query(
      `UPDATE sdk_api_keys SET budget_used_cents = COALESCE(budget_used_cents, 0) + $1 WHERE id = $2`,
      [Math.round(costCents), keyId],
    );
  }

  return { resolveKey, checkBudget, incrementBudget };
}

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many signup attempts, please try again later" },
});

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
        const isNewUser = req.isNewUser === true;
        if (existing.rows.length > 0) {
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
        let clerkOrgId: string | undefined;
        if (resolvedAccountId === undefined) {
          const trimmedName = name?.trim();
          const orgName = trimmedName
            ? `${trimmedName}'s Workspace`
            : "My Workspace";

          try {
            const clerkOrg = await clerk.organizations.createOrganization({
              name: orgName,
              createdBy: userId,
            });
            clerkOrgId = clerkOrg.id;
          } catch (orgErr) {
            console.error("Failed to create Clerk org on signup:", orgErr);
          }

          const insertedAccount = await pool.query(
            `INSERT INTO accounts (name, email, password_hash, visitor_id, clerk_org_id)
             VALUES ($1, $2, 'clerk-managed', $3, $4) RETURNING id`,
            [orgName, email, userId, clerkOrgId ?? null],
          );
          resolvedAccountId = insertedAccount.rows[0].id as number;
          await pool.query(
            `INSERT INTO user_accounts (user_id, account_id, role, status, joined_at)
             VALUES ($1, $2, 'owner', 'active', NOW())
             ON CONFLICT (user_id, account_id) DO NOTHING`,
            [userInternalId, resolvedAccountId],
          );
        } else {
          const orgRow = await pool.query(
            `SELECT clerk_org_id FROM accounts WHERE id = $1`,
            [resolvedAccountId],
          );
          clerkOrgId = orgRow.rows[0]?.clerk_org_id ?? undefined;
          if (clerkOrgId) {
            try {
              const org = await clerk.organizations.getOrganization({
                organizationId: clerkOrgId,
              });
              const membership = org
                ? await clerk.organizations.getOrganizationMembershipList({
                    organizationId: clerkOrgId,
                  })
                : null;
              const isMember = membership?.data?.some(
                (m) => m.publicUserData?.userId === userId,
              );
              if (!isMember) {
                try {
                  await clerk.organizations.createOrganizationMembership({
                    organizationId: clerkOrgId,
                    userId,
                    role: "org:admin",
                  });
                } catch {
                  console.warn(
                    "Could not add user to org, clearing stale org_id",
                  );
                  clerkOrgId = undefined;
                }
              }
            } catch {
              console.warn(
                "Clerk org not found, clearing stale clerk_org_id:",
                clerkOrgId,
              );
              await pool.query(
                `UPDATE accounts SET clerk_org_id = NULL WHERE id = $1`,
                [resolvedAccountId],
              );
              clerkOrgId = undefined;
            }
          }
          if (!clerkOrgId) {
            const trimmedName = name?.trim();
            const orgName = trimmedName
              ? `${trimmedName}'s Workspace`
              : "My Workspace";
            try {
              const clerkOrg = await clerk.organizations.createOrganization({
                name: orgName,
                createdBy: userId,
              });
              clerkOrgId = clerkOrg.id;
              await pool.query(
                `UPDATE accounts SET clerk_org_id = $1 WHERE id = $2`,
                [clerkOrgId, resolvedAccountId],
              );
            } catch (orgErr) {
              console.error("Failed to backfill Clerk org:", orgErr);
            }
          }
        }

        if (isNewUser) {
          const adminEmailsForDogfood = [
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
                    `INSERT INTO customers (account_id, customer_id, name, email)
                     VALUES ($1, $2, $3, $4)
                     ON CONFLICT (account_id, customer_id) DO UPDATE SET name = EXCLUDED.name, email = COALESCE(EXCLUDED.email, customers.email)`,
                    [adminAccountId, email, name?.trim() || email, email],
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
          "DELETE FROM customers WHERE account_id IN (SELECT ua.account_id FROM user_accounts ua JOIN users u ON u.id = ua.user_id WHERE u.visitor_id = $1) AND customer_id IN ('cus_001','cus_002','cus_003','cus_004','cus_005','acme_saas','tidewater_ai','neondata','circleops','blazeml','quantumhr')",
          [userId],
        );
        await pool.query(
          "DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id IN ('sub_001','sub_002','sub_003','sub_004','sub_005','sub_acme','sub_acme_addon','sub_tidewater','sub_neon','sub_neon_addon','sub_circle','sub_blaze','sub_quantum')",
          [userId],
        );
        await pool.query(
          "DELETE FROM plans WHERE user_id = $1 AND plan_id IN ('_sample_starter', '_sample_pro', '_sample_enterprise')",
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
            "SELECT id FROM sdk_api_keys WHERE account_id = $1 AND revoked_at IS NULL LIMIT 1",
            [resolvedAccountId],
          );
          if (existing.rows.length === 0) {
            throw new Error(
              "Failed to provision SDK key on signup — please retry.",
            );
          }
        }

        const resendKey = process.env.RESEND_API_KEY;
        if (isNewUser && resendKey) {
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

          const followUpAt = new Date(
            Date.now() + 2 * 24 * 60 * 60 * 1000,
          ).toISOString();

          const isCloud = process.env.OBSERVE_EDITION === "cloud";
          const fromEmail =
            process.env.ALERT_FROM_EMAIL || "alerts@example.com";
          const adminEmails = (process.env.ADMIN_EMAILS || "")
            .split(",")
            .filter(Boolean);
          const appUrl = process.env.APP_URL || "http://localhost:3000";

          await Promise.allSettled([
            ...(adminEmails.length
              ? [
                  resendPost({
                    from: `Observe <${fromEmail}>`,
                    to: adminEmails,
                    subject: `New signup: ${email}`,
                    html: `<p><strong>New user signed up for Observe</strong></p><p>Email: ${email}</p><p>Name: ${name?.trim() || "(not provided)"}</p><p>Time: ${new Date().toISOString()}</p>`,
                  }),
                ]
              : []),
            ...(isCloud
              ? [
                  resendPost({
                    from: "Kat from Observe <kat@tansohq.com>",
                    to: email,
                    subject: "Welcome to Observe",
                    html: `<p>Hey there!</p>
<p>Just wanted to say thank you for signing up for Observe by Tanso! Would love to learn about what you're building and what brought you here.</p>
<p>Feel free to reach out with any questions or feedback. Also down to hop on a quick call if that's easier: <a href="https://cal.com/katrina-laszlo/meeting">https://cal.com/katrina-laszlo/meeting</a></p>
<p>Kat<br/>Co-founder, Tanso</p>`,
                  }),
                  resendPost({
                    from: "Kat from Observe <kat@tansohq.com>",
                    to: email,
                    subject: "How's setup going?",
                    scheduled_at: followUpAt,
                    html: `<p>Hey${name?.trim() ? ` ${name.trim()}` : ""}!</p>
<p>Just checking in — have you had a chance to get your SDK key set up? If you're running into anything or have questions about connecting your data, I'm happy to help.</p>
<p>Here's a quick link to the setup guide: <a href="${appUrl}/data-sources">${appUrl}/data-sources</a></p>
<p>Or grab time with me directly: <a href="https://cal.com/katrina-laszlo/meeting">cal.com/katrina-laszlo/meeting</a></p>
<p>Kat<br/>Co-founder, Tanso</p>`,
                  }),
                ]
              : []),
          ]);
        }

        res.json({
          account: { id: account.id, email: account.email, name: account.name },
          sdkKey,
          clerkOrgId: clerkOrgId ?? null,
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

  router.post("/signup", signupLimiter, async (req: Request, res: Response) => {
    try {
      const { email, scopes, budget_cents, budget_period, expires_in_seconds } =
        req.body;
      if (
        !email ||
        typeof email !== "string" ||
        !email.includes("@") ||
        email.length > 255
      ) {
        return res.status(400).json({ error: "Valid email is required" });
      }
      if (scopes && Array.isArray(scopes)) {
        const disallowed = scopes.filter(
          (s: string) => !SIGNUP_ALLOWED_SCOPES.has(s),
        );
        if (disallowed.length > 0) {
          return res.status(400).json({
            error: `Scopes not allowed on signup: ${disallowed.join(", ")}. Use POST /sdk-keys with a Clerk session for elevated scopes.`,
          });
        }
      }
      if (
        budget_period &&
        budget_period !== "month" &&
        budget_period !== "day"
      ) {
        return res
          .status(400)
          .json({ error: "budget_period must be 'month' or 'day'" });
      }
      const normalizedEmail = email.trim().toLowerCase();

      const existingUser = await pool.query(
        "SELECT id FROM users WHERE LOWER(email) = $1 LIMIT 1",
        [normalizedEmail],
      );
      if (existingUser.rows.length > 0) {
        return res
          .status(409)
          .json({ error: "An account with this email already exists" });
      }

      let clerkUser;
      try {
        clerkUser = await clerk.users.createUser({
          emailAddress: [normalizedEmail],
          skipPasswordRequirement: true,
        });
      } catch (clerkErr: unknown) {
        const msg =
          clerkErr instanceof Error ? clerkErr.message : String(clerkErr);
        if (
          msg.includes("already exists") ||
          msg.includes("taken") ||
          msg.includes("unique")
        ) {
          return res
            .status(409)
            .json({ error: "An account with this email already exists" });
        }
        throw clerkErr;
      }

      const clerkUserId = clerkUser.id;

      try {
        const insertedUser = await pool.query(
          `INSERT INTO users (email, password_hash, name, visitor_id)
             VALUES ($1, 'clerk-managed', NULL, $2)
             ON CONFLICT (email) DO NOTHING
             RETURNING id`,
          [normalizedEmail, clerkUserId],
        );
        if (insertedUser.rows.length === 0) {
          await clerk.users
            .deleteUser(clerkUserId)
            .catch((e) =>
              console.error("Clerk orphan cleanup failed:", clerkUserId, e),
            );
          return res
            .status(409)
            .json({ error: "An account with this email already exists" });
        }
        const userInternalId = insertedUser.rows[0].id as number;

        const insertedAccount = await pool.query(
          `INSERT INTO accounts (name, email, password_hash, visitor_id)
             VALUES ('Personal Account', $1, 'clerk-managed', $2) RETURNING id`,
          [normalizedEmail, clerkUserId],
        );
        const accountId = insertedAccount.rows[0].id as number;

        await pool.query(
          `INSERT INTO user_accounts (user_id, account_id, role, status, joined_at)
             VALUES ($1, $2, 'owner', 'active', NOW())
             ON CONFLICT (user_id, account_id) DO NOTHING`,
          [userInternalId, accountId],
        );

        const rawKey = `obs_${crypto.randomBytes(24).toString("hex")}`;
        const keyHash = crypto
          .createHash("sha256")
          .update(rawKey)
          .digest("hex");
        const keyPrefix = rawKey.slice(0, 11);

        const keyScopes =
          scopes && Array.isArray(scopes) && scopes.length > 0
            ? scopes
            : ["usage.read", "billing.read"];
        const keyExpiry = expires_in_seconds
          ? new Date(
              Date.now() + Number(expires_in_seconds) * 1000,
            ).toISOString()
          : null;
        const keyBudgetCents =
          budget_cents != null ? Number(budget_cents) : null;
        const keyBudgetPeriod = budget_period || null;
        const keyBudgetResetAt =
          keyBudgetPeriod === "month"
            ? new Date(
                new Date().getFullYear(),
                new Date().getMonth() + 1,
                1,
              ).toISOString()
            : keyBudgetPeriod === "day"
              ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
              : null;

        await pool.query(
          `INSERT INTO sdk_api_keys (user_id, account_id, key_hash, key_prefix, encrypted_key, name,
             scopes, budget_cents, budget_period, budget_reset_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, 'default', $6, $7, $8, $9, $10)`,
          [
            clerkUserId,
            accountId,
            keyHash,
            keyPrefix,
            encryptApiKey(rawKey),
            keyScopes,
            keyBudgetCents,
            keyBudgetPeriod,
            keyBudgetResetAt,
            keyExpiry,
          ],
        );

        await pool.query(
          "INSERT INTO user_data_status (user_id, account_id, data_mode) VALUES ($1, $2, 'none') ON CONFLICT DO NOTHING",
          [clerkUserId, accountId],
        );

        res.status(201).json({
          key: rawKey,
          scopes: keyScopes,
          expires_at: keyExpiry,
          budget_cents: keyBudgetCents,
          budget_period: keyBudgetPeriod,
        });
      } catch (dbErr) {
        await clerk.users
          .deleteUser(clerkUserId)
          .catch((e) =>
            console.error("Clerk orphan cleanup failed:", clerkUserId, e),
          );
        throw dbErr;
      }
    } catch (error) {
      console.error("POST /signup error:", error);
      res.status(500).json({ error: "Failed to create account" });
    }
  });

  router.post(
    "/sdk-keys",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.visitorId || !req.accountId) {
          return res.status(401).json({ error: "Authentication required" });
        }
        if (req.keyScopes !== undefined) {
          return res
            .status(403)
            .json({ error: "SDK keys cannot create other keys" });
        }

        const {
          name,
          scopes,
          budget_cents,
          budget_period,
          expires_in_seconds,
        } = req.body;
        if (!name || typeof name !== "string" || name.trim().length === 0) {
          return res.status(400).json({ error: "name is required" });
        }
        if (scopes && Array.isArray(scopes)) {
          const invalid = scopes.filter(
            (s: string) => !(VALID_SCOPES as readonly string[]).includes(s),
          );
          if (invalid.length > 0) {
            return res
              .status(400)
              .json({ error: `Invalid scopes: ${invalid.join(", ")}` });
          }
        }
        if (
          budget_period &&
          budget_period !== "month" &&
          budget_period !== "day"
        ) {
          return res
            .status(400)
            .json({ error: "budget_period must be 'month' or 'day'" });
        }

        const rawKey = `obs_${crypto.randomBytes(24).toString("hex")}`;
        const keyHash = crypto
          .createHash("sha256")
          .update(rawKey)
          .digest("hex");
        const keyPrefix = rawKey.slice(0, 11);

        const keyScopes =
          scopes && Array.isArray(scopes) && scopes.length > 0 ? scopes : null;
        const keyExpiry = expires_in_seconds
          ? new Date(
              Date.now() + Number(expires_in_seconds) * 1000,
            ).toISOString()
          : null;
        const keyBudgetCents =
          budget_cents != null ? Number(budget_cents) : null;
        const keyBudgetPeriod = budget_period || null;
        const keyBudgetResetAt =
          keyBudgetPeriod === "month"
            ? new Date(
                new Date().getFullYear(),
                new Date().getMonth() + 1,
                1,
              ).toISOString()
            : keyBudgetPeriod === "day"
              ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
              : null;

        const insertResult = await pool.query(
          `INSERT INTO sdk_api_keys (user_id, account_id, key_hash, key_prefix, encrypted_key, name,
             scopes, budget_cents, budget_period, budget_reset_at, expires_at, delegated_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
             ON CONFLICT (account_id, name) WHERE revoked_at IS NULL DO NOTHING
             RETURNING id`,
          [
            req.visitorId,
            req.accountId,
            keyHash,
            keyPrefix,
            encryptApiKey(rawKey),
            name.trim(),
            keyScopes,
            keyBudgetCents,
            keyBudgetPeriod,
            keyBudgetResetAt,
            keyExpiry,
            req.visitorId,
          ],
        );

        if (insertResult.rows.length === 0) {
          return res.status(409).json({
            error: `An active key named '${name.trim()}' already exists`,
          });
        }

        res.status(201).json({
          key: rawKey,
          name: name.trim(),
          scopes: keyScopes,
          expires_at: keyExpiry,
          budget_cents: keyBudgetCents,
          budget_period: keyBudgetPeriod,
        });
      } catch (error) {
        console.error("POST /sdk-keys error:", error);
        res.status(500).json({ error: "Failed to create API key" });
      }
    },
  );

  return router;
}
