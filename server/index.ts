import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import Pg from "pg";
import { createAuthRoutes, createEnsureVisitor } from "./routes/auth.js";
import { checkFeatureAccess } from "./billing.js";

import { createConvertReferralIfPending } from "./routes/integrations.js";
import { createAlertRoutes } from "./routes/alerts.js";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { initModelPricing } from "./model-pricing.js";
import { createProxyRoutes } from "./routes/proxy.js";
import { createGatewayRoutes } from "./routes/gateway.js";
import { createRecommendationsRoutes } from "./routes/recommendations.js";
import { createChatRoutes } from "./routes/chat.js";
import { createCustomersRoutes } from "./routes/customers.js";
import { createEventsRoutes } from "./routes/events.js";
import { createFeaturesRoutes } from "./routes/features.js";
import { createInsightsRoutes } from "./routes/insights.js";
import { createModelsApiRoutes } from "./routes/models-api.js";
import { createTeamRoutes } from "./routes/team.js";
import { createAnalyticsRoutes } from "./routes/analytics.js";
import { createCohortsRoutes } from "./routes/cohorts.js";
import { createFeatureDefinitionsRoutes } from "./routes/feature-definitions.js";
import { createA2ARoutes } from "./routes/a2a.js";
import { createCloudCostRoutes } from "./routes/cloud-costs.js";
import { createBillingApiRoutes } from "./routes/billing-api.js";
import { createBackfillRoutes } from "./routes/backfill.js";
import {
  createInferenceRoutes,
  computeInferenceProfiles,
} from "./routes/inference.js";

const app = express();

const pool = new Pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

// Parse JSON for all routes except the Stripe webhook (which needs raw body)
app.use((req, res, next) => {
  if (req.path === "/billing/webhook" || req.path === "/api/billing/webhook") {
    next();
  } else {
    express.json({ limit: "2mb" })(req, res, next);
  }
});

// Strip /api prefix so routes work in both dev (Vite proxy) and production (same origin)
app.use((req, _res, next) => {
  if (req.path.startsWith("/api/")) {
    req.url = req.url.replace("/api", "");
  }
  next();
});

// Security headers
app.use(helmet());

// CORS — restrict to known origins
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : ["http://localhost:5000", "http://localhost:5173"];
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);

// Rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // 20 attempts per window
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts, please try again later" },
});
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please slow down" },
});
app.use("/auth/", authLimiter);
app.use("/api/", apiLimiter);

// Ensure DB tables exist before anything else (critical for serverless cold starts)
app.use(async (_req: Request, _res: Response, next: NextFunction) => {
  try {
    await ensureDbInitialized();
    next();
  } catch (error) {
    next(error);
  }
});

// Validate required env vars at startup
const requiredEnvVars = ["DATABASE_URL", "CLERK_SECRET_KEY"] as const;
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} environment variable is required`);
  }
}

app.set("trust proxy", 1);

// Auth middleware — verifies Clerk JWT, sets req.visitorId
const ensureVisitor = createEnsureVisitor(pool);
app.use(createAuthRoutes(pool, ensureVisitor));

// ─── Admin visitor ID (shared by proxy dual-write + billing usage tracking) ──
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || "";
let cachedAdminVisitorId: string | null = null;

async function getAdminVisitorId(): Promise<string | null> {
  if (!ADMIN_EMAIL) return null;
  if (cachedAdminVisitorId) return cachedAdminVisitorId;
  try {
    const result = await pool.query(
      "SELECT visitor_id FROM accounts WHERE LOWER(email) = $1 LIMIT 1",
      [ADMIN_EMAIL.toLowerCase()],
    );
    if (result.rows[0]?.visitor_id) {
      cachedAdminVisitorId = result.rows[0].visitor_id;
      return cachedAdminVisitorId;
    }
  } catch (err) {
    console.error("Failed to resolve admin visitor_id:", err);
  }
  return null;
}

// ─── Shared helpers ──────────────────────────────────────────────────────────
const convertReferralIfPending = createConvertReferralIfPending(pool);

const checkBillingFeatureAccess = (
  visitorId: string,
  featureKey: string,
  email?: string,
  accountId?: number,
) => checkFeatureAccess(pool, visitorId, featureKey, email, accountId);
const trackBillingUsage = (
  _visitorId: string,
  _featureKey: string,
  _eventName: string,
) => {
  /* usage counted on read from source tables */
};

const expensiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again in a minute" },
});

// ─── Route modules ──────────────────────────────────────────────────────────
app.use(
  createCustomersRoutes(pool, ensureVisitor, {
    checkBillingFeatureAccess,
    trackBillingUsage,
    convertReferralIfPending,
  }),
);
app.use(
  createBillingApiRoutes(pool, ensureVisitor, {
    trackBillingUsage,
    convertReferralIfPending,
  }),
);
app.use(
  createAlertRoutes(pool, ensureVisitor, {
    checkTansoFeatureAccess: checkBillingFeatureAccess,
  }),
);
app.use(
  createProxyRoutes(pool, ensureVisitor, {
    getAdminVisitorId,
  }),
);
app.use(createGatewayRoutes(pool, ensureVisitor, { apiLimiter }));
app.use(createRecommendationsRoutes(pool, ensureVisitor));
app.use(
  createChatRoutes(pool, ensureVisitor, {
    checkBillingFeatureAccess,
  }),
);
app.use(
  createEventsRoutes(pool, ensureVisitor, {
    computeInferenceProfiles: (userId: string) =>
      computeInferenceProfiles(pool, userId),
    apiLimiter,
  }),
);
app.use(createFeaturesRoutes(pool, ensureVisitor));
app.use(
  createInsightsRoutes(pool, ensureVisitor, {
    checkBillingFeatureAccess,
    trackBillingUsage,
    expensiveLimiter,
  }),
);
app.use(createModelsApiRoutes(pool, ensureVisitor));
app.use(createTeamRoutes(pool, ensureVisitor));
app.use(createAnalyticsRoutes(pool, ensureVisitor));
app.use(createCohortsRoutes(pool, ensureVisitor));
app.use(createFeatureDefinitionsRoutes(pool, ensureVisitor));
app.use(createInferenceRoutes(pool, ensureVisitor));
app.use(createA2ARoutes(pool, ensureVisitor));
app.use(createCloudCostRoutes(pool, ensureVisitor));
app.use(createBackfillRoutes(pool, ensureVisitor));

// ─── Weekly digest (cloud-only, manual trigger for admin) ───────────────────
import { runWeeklyDigest } from "./digest.js";
app.post("/admin/digest", ensureVisitor, async (req: any, res: any) => {
  const adminEmails = (
    process.env.ADMIN_EMAILS ||
    process.env.ADMIN_EMAIL ||
    ""
  ).toLowerCase();
  if (
    !req.accountEmail ||
    !adminEmails.includes(req.accountEmail.toLowerCase())
  ) {
    return res.status(403).json({ error: "Admin only" });
  }
  try {
    await runWeeklyDigest(pool);
    res.json({ ok: true });
  } catch (err) {
    console.error("Manual digest error:", err);
    res.status(500).json({ error: "Digest failed" });
  }
});

// ─── Database initialization ────────────────────────────────────────────────

async function clearSampleData(
  db: { query: (text: string, params: unknown[]) => Promise<unknown> },
  userId: string,
): Promise<void> {
  await db.query(
    "DELETE FROM observe_events WHERE user_id = $1 AND source = 'sample'",
    [userId],
  );
  await db.query(
    "DELETE FROM cost_records WHERE user_id = $1 AND cost_type = 'ai_inference' AND customer_id IS NULL AND period_start IS NOT NULL",
    [userId],
  );
  await db.query(
    "DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id IN ('sub_001','sub_002','sub_003','sub_004','sub_005','sub_acme','sub_acme_addon','sub_tidewater','sub_neon','sub_neon_addon','sub_circle','sub_blaze','sub_quantum')",
    [userId],
  );
  await db.query(
    "DELETE FROM customers WHERE user_id = $1 AND customer_id IN ('cus_001','cus_002','cus_003','cus_004','cus_005','acme_saas','tidewater_ai','neondata','circleops','blazeml','quantumhr')",
    [userId],
  );
  await db.query(
    "DELETE FROM plans WHERE user_id = $1 AND plan_id IN ('starter', 'pro', 'enterprise')",
    [userId],
  );
}

let dbInitialized = false;
let dbInitPromise: Promise<void> | null = null;
async function ensureDbInitialized() {
  if (dbInitialized) return;
  if (!dbInitPromise) {
    dbInitPromise = _doDbInit()
      .then(() => {
        dbInitialized = true;
      })
      .catch((err) => {
        dbInitPromise = null;
        throw err;
      });
  }
  return dbInitPromise;
}
const SCHEMA_VERSION = 22;
async function _doDbInit() {
  try {
    await pool.query("SELECT 1");

    // Fast path: if schema is current, skip all migrations (1 query vs 100+)
    try {
      const vResult = await pool.query(
        "SELECT version FROM schema_version LIMIT 1",
      );
      if (
        vResult.rows.length > 0 &&
        vResult.rows[0].version >= SCHEMA_VERSION
      ) {
        console.warn(`Schema v${SCHEMA_VERSION} current, skipping migrations`);
        initModelPricing(pool).catch(() => {});
        return;
      }
    } catch {
      // Table doesn't exist yet — run full migration
    }

    console.warn("Running schema migrations...");

    // Hard-reject sample-tagged rows at the DB level. Cheaper than a
    // runtime filter in every read query. On first install with legacy
    // sample rows, we have to DELETE them before ADD CONSTRAINT or it
    // errors out (23514).
    try {
      const existingConstraint = await pool.query(
        `SELECT 1 FROM pg_constraint
          WHERE conname = 'observe_events_no_sample_source'`,
      );
      if (existingConstraint.rows.length === 0) {
        const wipe = await pool.query(
          "DELETE FROM observe_events WHERE source = 'sample'",
        );
        if ((wipe.rowCount ?? 0) > 0) {
          console.warn(
            `Wiped ${wipe.rowCount} legacy sample event rows before adding CHECK constraint`,
          );
        }
        await pool.query(
          `ALTER TABLE observe_events
             ADD CONSTRAINT observe_events_no_sample_source
             CHECK (source IS NULL OR source != 'sample')`,
        );
      }
    } catch (err: unknown) {
      console.error("Sample CHECK constraint setup failed:", err);
    }

    // ── Stage 1 schema migration ─────────────────────────────────────────
    // Split the old `accounts` table (which was really a users/auth table) into:
    //   users         — auth identity (renamed from the old accounts)
    //   accounts      — billing/data owner (new table)
    //   user_accounts — join table (role, status)
    // Data tables get a nullable account_id column; backfill runs below.
    // Idempotent: safe to re-run on every boot.

    // 1. Rename accounts → users if needed.
    try {
      const check = await pool.query(
        `SELECT
           EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'users') AS has_users,
           EXISTS (SELECT 1 FROM information_schema.tables
                    WHERE table_schema = 'public' AND table_name = 'accounts') AS has_accounts`,
      );
      const hasUsers = check.rows[0]?.has_users;
      const hasAccounts = check.rows[0]?.has_accounts;
      if (!hasUsers && hasAccounts) {
        await pool.query(`ALTER TABLE accounts RENAME TO users`);
        console.warn("Stage 1 migration: renamed accounts → users");
      }
    } catch (err) {
      console.error("Stage 1 rename (accounts→users) failed:", err);
    }

    // 2. Ensure users table + all its columns exist before FK references
    // and backfill. On fresh installs this creates the table outright; on
    // existing (post-rename) DBs it's a no-op and the ALTERs add any missing
    // columns.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        visitor_id TEXT UNIQUE,
        stripe_customer_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    await pool.query(`DO $$ BEGIN
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_plan TEXT DEFAULT 'free';
      ALTER TABLE users ADD COLUMN IF NOT EXISTS bonus_credits INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS feedback_submitted BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS invite_credits_granted INTEGER DEFAULT 0;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT false;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS first_sdk_event_at TIMESTAMPTZ;
    END $$`);

    // 3. New billing/data owner accounts table.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'My Account',
        stripe_customer_id TEXT,
        stripe_plan TEXT DEFAULT 'free',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 4. User ↔ Account join table.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_accounts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner','admin','viewer')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active')),
        joined_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, account_id)
      )
    `);

    // 5. Add nullable account_id FK to all data tables. Some may not exist
    // yet on fresh installs (created further down); log + continue.
    const dataTablesNeedingAccountId = [
      "observe_events",
      "customers",
      "subscriptions",
      "plans",
      "alert_rules",
      "alert_history",
      "feature_definitions",
      "feature_pricing",
      "simulations",
      "ai_insights",
      "customer_health_snapshots",
      "integrations",
      "sdk_api_keys",
      "cost_records",
      "usage_records",
      "user_data_status",
      "routing_configs",
      "cloud_integrations",
      "inference_profiles",
      "proxy_cache",
      "recommendations",
      "custom_cohorts",
    ];
    for (const t of dataTablesNeedingAccountId) {
      await pool
        .query(
          `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS account_id INTEGER REFERENCES accounts(id)`,
        )
        .catch((err) => console.error(`Stage 1 add account_id on ${t}:`, err));
    }

    // 6. Backfill. For each user not already in user_accounts, create an
    // accounts row (copying stripe_customer_id + stripe_plan, which remain
    // on users for Stage 1), link via user_accounts, then tag their data
    // rows by matching users.visitor_id → <table>.user_id (TEXT column).
    try {
      const usersToBackfill = await pool.query(
        `SELECT u.id, u.visitor_id, u.stripe_customer_id, u.stripe_plan
           FROM users u
          WHERE NOT EXISTS (
            SELECT 1 FROM user_accounts ua WHERE ua.user_id = u.id
          )`,
      );
      for (const u of usersToBackfill.rows) {
        try {
          const inserted = await pool.query(
            `INSERT INTO accounts (stripe_customer_id, stripe_plan)
             VALUES ($1, COALESCE($2, 'free'))
             RETURNING id`,
            [u.stripe_customer_id ?? null, u.stripe_plan ?? null],
          );
          const newAccountId = inserted.rows[0].id;
          await pool.query(
            `INSERT INTO user_accounts (user_id, account_id, role, status, joined_at)
             VALUES ($1, $2, 'owner', 'active', NOW())
             ON CONFLICT (user_id, account_id) DO NOTHING`,
            [u.id, newAccountId],
          );
          if (u.visitor_id) {
            for (const t of dataTablesNeedingAccountId) {
              await pool
                .query(
                  `UPDATE ${t} SET account_id = $1
                    WHERE account_id IS NULL AND user_id = $2`,
                  [newAccountId, u.visitor_id],
                )
                .catch((err) =>
                  console.error(`Stage 1 backfill ${t} for user ${u.id}:`, err),
                );
            }
          }
        } catch (err) {
          console.error(`Stage 1 backfill failed for user ${u.id}:`, err);
        }
      }
    } catch (err) {
      console.error("Stage 1 backfill outer loop failed:", err);
    }
    // ── end Stage 1 migration ───────────────────────────────────────────

    // ── Stage 5: catch-up backfill for newly added tables ───────────────
    // Stage 1 only backfills users without user_accounts rows. Users who
    // already had rows from prior migrations still have NULL account_id on
    // tables added to the list later (recommendations, custom_cohorts).
    try {
      for (const t of dataTablesNeedingAccountId) {
        await pool
          .query(
            `UPDATE ${t} SET account_id = ua.account_id
               FROM users u
               JOIN user_accounts ua ON ua.user_id = u.id AND ua.role = 'owner'
              WHERE ${t}.account_id IS NULL
                AND ${t}.user_id = u.visitor_id`,
          )
          .catch((err) =>
            console.error(`Stage 5 catch-up backfill ${t}:`, err),
          );
      }
    } catch (err) {
      console.error("Stage 5 catch-up backfill failed:", err);
    }
    // ── end Stage 5 migration ───────────────────────────────────────────

    // ── Stage 6: add (account_id, customer_id) unique constraint ───────
    // The original unique constraint is (user_id, customer_id) but all
    // joins use account_id. Old customer rows with NULL account_id cause
    // silent join failures — names don't show up.
    await pool
      .query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_account_customer
           ON customers (account_id, customer_id)
          WHERE account_id IS NOT NULL`,
      )
      .catch((err) => console.error("Stage 6 customers unique index:", err));

    // Also update customer_health_snapshots constraint to use account_id
    await pool
      .query(
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_health_snapshots_account
           ON customer_health_snapshots (account_id, customer_id, snapshot_date)
          WHERE account_id IS NOT NULL`,
      )
      .catch((err) => console.error("Stage 6 health snapshots index:", err));
    // ── end Stage 6 migration ──────────────────────────────────────────

    // ── Stage 4: copy Stripe fields users → accounts ────────────────────
    // Additive + idempotent. Columns stay on `users` for rollback safety.
    // Runs after Stage 1 so accounts/user_accounts exist and owners are set.
    await pool.query(
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bonus_credits INTEGER DEFAULT 0`,
    );
    try {
      await pool.query(
        `UPDATE accounts a
            SET stripe_customer_id = COALESCE(a.stripe_customer_id, u.stripe_customer_id),
                stripe_plan        = COALESCE(NULLIF(a.stripe_plan, 'free'), u.stripe_plan, 'free'),
                bonus_credits      = COALESCE(a.bonus_credits, u.bonus_credits, 0)
           FROM users u
           JOIN user_accounts ua ON ua.user_id = u.id AND ua.role = 'owner'
          WHERE ua.account_id = a.id
            AND (
              (u.stripe_customer_id IS NOT NULL AND a.stripe_customer_id IS NULL)
              OR (u.stripe_plan IS NOT NULL AND a.stripe_plan = 'free' AND u.stripe_plan != 'free')
              OR (u.bonus_credits > 0 AND COALESCE(a.bonus_credits, 0) = 0)
            )`,
      );
    } catch (err) {
      console.error("Stage 4 stripe field copy failed:", err);
    }
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_accounts_stripe_customer ON accounts(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL`,
    );
    // ── end Stage 4 migration ───────────────────────────────────────────

    await pool.query(`
      CREATE TABLE IF NOT EXISTS feedback (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS password_reset_tokens (
        id SERIAL PRIMARY KEY,
        account_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        used_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        name TEXT NOT NULL,
        price_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
        interval_months INTEGER NOT NULL DEFAULT 1,
        billing_model TEXT NOT NULL DEFAULT 'recurring',
        api_calls_limit INTEGER,
        tokens_limit INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, plan_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        name TEXT NOT NULL,
        email TEXT,
        segment TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, customer_id)
      )
    `);

    await pool.query(
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT false`,
    );
    await pool.query(
      `ALTER TABLE customers ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`,
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        subscription_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        plan_id TEXT NOT NULL,
        is_active BOOLEAN NOT NULL DEFAULT true,
        current_period_start TIMESTAMPTZ,
        current_period_end TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        previous_mrr DECIMAL(10,2),
        mrr_override DECIMAL(10,2),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, subscription_id)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS usage_records (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        metric_key TEXT NOT NULL,
        metric_value DECIMAL(12,2) NOT NULL,
        metric_limit DECIMAL(12,2),
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cost_records (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        customer_id TEXT,
        cost_type TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        period_start TIMESTAMPTZ NOT NULL,
        period_end TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_data_status (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        data_mode TEXT NOT NULL DEFAULT 'none',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS observe_events (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        customer_id TEXT NOT NULL DEFAULT 'unknown',
        feature_key TEXT NOT NULL DEFAULT 'unknown',
        event_name TEXT NOT NULL DEFAULT 'usage',
        timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        cost_amount NUMERIC(12, 4) NOT NULL DEFAULT 0,
        cost_unit TEXT DEFAULT 'usd',
        revenue_amount NUMERIC(12, 4) NOT NULL DEFAULT 0,
        usage_units NUMERIC(12, 4) NOT NULL DEFAULT 0,
        model TEXT,
        model_provider TEXT,
        source TEXT NOT NULL DEFAULT 'csv',
        granularity TEXT NOT NULL DEFAULT 'monthly_aggregate',
        properties JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // Split token persistence — input and output tokens have different
    // provider rates, so we store them separately. Nullable so historical
    // rows (blended into usage_units) stay as-is.
    await pool.query(`DO $$ BEGIN
      ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS input_tokens INT;
      ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS output_tokens INT;
      ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS tokens_source TEXT;
    END $$`);
    await pool.query(`DO $$ BEGIN
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pricing_model TEXT;
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS pricing_tiers JSONB;
      ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12, 6);
    END $$`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS feature_pricing (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        feature_key TEXT NOT NULL,
        revenue_per_unit NUMERIC(12, 4) NOT NULL,
        unit_label TEXT DEFAULT 'call',
        effective_from TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, feature_key)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS feature_definitions (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        feature_key TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('cost','value','outcome')),
        description TEXT,
        code_location TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, feature_key)
      )
    `);

    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_feature_definitions_user_id ON feature_definitions(user_id)`,
    );

    await pool.query(`DO $$ BEGIN
      ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS revenue_source TEXT DEFAULT 'none';
      ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS agent_id TEXT;
      ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS meta JSONB DEFAULT '{}'::jsonb;
    END $$`);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ai_insights (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        insight_type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT DEFAULT 'info',
        feature_key TEXT,
        customer_id TEXT,
        metadata JSONB DEFAULT '{}',
        tokens_used INTEGER,
        cost_usd NUMERIC(10, 6),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS simulations (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        scenarios JSONB DEFAULT '[]',
        time_range JSONB DEFAULT '{}',
        results JSONB,
        status TEXT DEFAULT 'draft',
        segment_name TEXT,
        feature_analysis JSONB,
        customer_impacts JSONB,
        margin_impact JSONB,
        confidence_score NUMERIC(5,2),
        key_insight TEXT,
        winning_scenario_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS integration_requests (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        integration_name TEXT NOT NULL,
        request_type TEXT NOT NULL DEFAULT 'notify',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, integration_name)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS customer_health_snapshots (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        customer_id TEXT NOT NULL,
        health_score INTEGER NOT NULL,
        margin_pct INTEGER,
        adoption_depth INTEGER,
        active_days INTEGER,
        snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, customer_id, snapshot_date)
      )
    `);

    // Create indexes
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_plans_user_id ON plans(user_id)`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_customers_user_id ON customers(user_id)`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id)`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_usage_records_user_id ON usage_records(user_id)`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_cost_records_user_id ON cost_records(user_id)`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_observe_events_user_ts ON observe_events(user_id, timestamp DESC)`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_observe_events_user_feature ON observe_events(user_id, feature_key)`,
    );

    // Inference metadata columns on observe_events
    await pool.query(
      `ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS is_inferred BOOLEAN NOT NULL DEFAULT false`,
    );
    await pool.query(
      `ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS inference_method TEXT`,
    );
    await pool.query(
      `ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS inference_confidence NUMERIC(3,2)`,
    );
    await pool.query(
      `ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS inferred_from_source TEXT`,
    );
    await pool.query(
      `ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS original_event_id INTEGER`,
    );
    await pool.query(
      `ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
    );
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_observe_events_idempotency ON observe_events(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_observe_events_inferred ON observe_events(user_id, is_inferred) WHERE is_inferred = true`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_observe_events_source ON observe_events(user_id, source)`,
    );

    // Request/response body logging for proxy events
    await pool.query(
      `ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS request_body JSONB`,
    );
    await pool.query(
      `ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS response_body JSONB`,
    );

    // Distributed tracing columns for multi-step agent flow tracking
    await pool.query(
      `ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS trace_id TEXT`,
    );
    await pool.query(
      `ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS span_id TEXT`,
    );
    await pool.query(
      `ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS parent_span_id TEXT`,
    );
    await pool.query(
      `ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS duration_ms INTEGER`,
    );
    await pool.query(
      `ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS cost_type TEXT DEFAULT 'llm'`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_observe_events_trace ON observe_events(user_id, trace_id) WHERE trace_id IS NOT NULL`,
    );

    // Inference profiles table — stores learned distribution patterns from SDK data
    await pool.query(`
      CREATE TABLE IF NOT EXISTS inference_profiles (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        profile_type TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        distribution JSONB NOT NULL DEFAULT '{}',
        sample_count INTEGER NOT NULL DEFAULT 0,
        time_window_start TIMESTAMPTZ,
        time_window_end TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, profile_type, scope_key)
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_insights_user ON ai_insights(user_id, created_at DESC)`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_simulations_user_created ON simulations(user_id, created_at DESC)`,
    );

    // Integrations table for API key connections (OpenAI, Anthropic, etc.)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS integrations (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        api_key_prefix TEXT NOT NULL,
        has_usage_access BOOLEAN DEFAULT false,
        connected_at TIMESTAMPTZ DEFAULT NOW(),
        last_synced_at TIMESTAMPTZ,
        encrypted_api_key TEXT,
        stripe_account_id TEXT,
        stripe_account_name TEXT,
        UNIQUE(user_id, provider)
      )
    `);

    // Add columns for Stripe integration (migration for existing databases)
    await pool.query(
      `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS encrypted_api_key TEXT`,
    );
    await pool.query(
      `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS stripe_account_id TEXT`,
    );
    await pool.query(
      `ALTER TABLE integrations ADD COLUMN IF NOT EXISTS stripe_account_name TEXT`,
    );

    // Team / Organization tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL DEFAULT 'My Team',
        owner_visitor_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS organization_members (
        id SERIAL PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        visitor_id TEXT,
        invited_email TEXT,
        invite_token TEXT UNIQUE,
        role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
        joined_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Shared org-scoped invite token (anyone-with-link joins)
    await pool.query(
      `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS invite_token TEXT UNIQUE`,
    );
    // md5 is built-in; no pgcrypto extension needed.
    await pool.query(
      `UPDATE organizations
          SET invite_token = md5(random()::text || clock_timestamp()::text || id::text)
        WHERE invite_token IS NULL`,
    );
    // Drop pre-#139 phantom rows (pending, no visitor, no email, legacy token)
    await pool.query(
      `DELETE FROM organization_members
       WHERE status = 'pending'
         AND visitor_id IS NULL
         AND invited_email IS NULL`,
    );
    // Backfill invited_email from users.email so /team doesn't render "Anonymous"
    await pool.query(
      `UPDATE organization_members om
          SET invited_email = u.email
         FROM users u
        WHERE om.visitor_id = u.visitor_id
          AND om.invited_email IS NULL
          AND u.email IS NOT NULL`,
    );

    await pool.query(`
      CREATE TABLE IF NOT EXISTS visitor_org_map (
        visitor_id TEXT PRIMARY KEY,
        org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Referral system tables
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_codes (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE,
        code TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referrals (
        id SERIAL PRIMARY KEY,
        referrer_user_id TEXT NOT NULL,
        referred_user_id TEXT NOT NULL UNIQUE,
        referral_code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        credited_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_credits (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        credit_type TEXT NOT NULL DEFAULT 'promo_month',
        amount INTEGER NOT NULL DEFAULT 1,
        source_referral_id INTEGER REFERENCES referrals(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        used_at TIMESTAMPTZ,
        promo_code TEXT,
        stripe_promo_id TEXT
      )
    `);

    // Add new columns if missing (migration for existing tables)
    await pool.query(`
      ALTER TABLE referral_credits ADD COLUMN IF NOT EXISTS used_at TIMESTAMPTZ;
      ALTER TABLE referral_credits ADD COLUMN IF NOT EXISTS promo_code TEXT;
      ALTER TABLE referral_credits ADD COLUMN IF NOT EXISTS stripe_promo_id TEXT
    `);

    // SDK API keys table for programmatic event ingestion
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sdk_api_keys (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        key_hash TEXT NOT NULL UNIQUE,
        key_prefix TEXT NOT NULL,
        encrypted_key TEXT,
        name TEXT NOT NULL DEFAULT 'default',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_used_at TIMESTAMPTZ,
        revoked_at TIMESTAMPTZ
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_sdk_api_keys_hash ON sdk_api_keys(key_hash) WHERE revoked_at IS NULL`,
    );
    await pool.query(
      `ALTER TABLE sdk_api_keys ADD COLUMN IF NOT EXISTS encrypted_key TEXT`,
    );
    // Race-protect SDK key auto-generation on /auth/signup-complete.
    // PARTIAL unique index — only active (non-revoked) keys must have a
    // unique (account_id, name). This lets /sdk-keys/:id/reset soft-delete
    // the old row and insert a new one with the same name.
    try {
      await pool.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS sdk_api_keys_account_name_active
           ON sdk_api_keys (account_id, name)
           WHERE revoked_at IS NULL`,
      );
    } catch (err: unknown) {
      console.error("sdk_api_keys partial unique index add failed:", err);
    }

    // Proxy response cache table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS proxy_cache (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        cache_key TEXT NOT NULL,
        model TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        response_body JSONB NOT NULL,
        tokens_saved INTEGER DEFAULT 0,
        cost_saved NUMERIC(12,4) DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        UNIQUE(user_id, cache_key)
      )
    `);
    // Partial index with NOW() fails on Neon (not IMMUTABLE) — skip if it fails
    try {
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_proxy_cache_lookup ON proxy_cache(user_id, cache_key) WHERE expires_at IS NULL`,
      );
    } catch {
      // Index already exists or can't be created — non-fatal
    }

    // Alert rules table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS alert_rules (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        metric TEXT NOT NULL,
        operator TEXT NOT NULL,
        threshold NUMERIC(12,4) NOT NULL,
        email TEXT,
        webhook_url TEXT,
        enabled BOOLEAN DEFAULT true,
        cooldown_minutes INTEGER DEFAULT 60,
        last_triggered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    // Migrations for older deployments
    await pool.query(
      `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS webhook_url TEXT`,
    );
    await pool.query(
      `ALTER TABLE alert_rules ALTER COLUMN email DROP NOT NULL`,
    );

    // Alerts v2 migrations
    try {
      await pool.query(
        `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS trigger_type TEXT DEFAULT 'threshold'`,
      );
      await pool.query(
        `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS segment_type TEXT DEFAULT 'all'`,
      );
      await pool.query(
        `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS segment_value TEXT`,
      );
      await pool.query(
        `ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS evaluation TEXT DEFAULT 'aggregate'`,
      );
    } catch (err) {
      console.error("Non-fatal migration (alert_rules v2 columns):", err);
    }

    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS alert_history (
          id SERIAL PRIMARY KEY,
          user_id TEXT NOT NULL,
          alert_rule_id INTEGER REFERENCES alert_rules(id) ON DELETE CASCADE,
          customer_id TEXT,
          customer_name TEXT,
          trigger_type TEXT NOT NULL,
          current_value NUMERIC,
          threshold NUMERIC,
          fired_at TIMESTAMPTZ DEFAULT NOW(),
          delivery_status JSONB DEFAULT '{}'
        )
      `);
      await pool.query(
        `CREATE INDEX IF NOT EXISTS idx_alert_history_user ON alert_history(user_id, fired_at DESC)`,
      );
    } catch (err) {
      console.error("Non-fatal migration (alert_history table):", err);
    }

    // Cloud provider integrations (AWS Cost Explorer, GCP Billing)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cloud_integrations (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        encrypted_credentials TEXT NOT NULL,
        last_sync_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, provider)
      )
    `);

    // ── Routing / Gateway tables ────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS routing_configs (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, name)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS routing_targets (
        id SERIAL PRIMARY KEY,
        config_id INTEGER NOT NULL REFERENCES routing_configs(id) ON DELETE CASCADE,
        priority INTEGER NOT NULL DEFAULT 0,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        api_base_url TEXT,
        encrypted_api_key TEXT,
        max_retries INTEGER DEFAULT 1,
        timeout_ms INTEGER DEFAULT 25000,
        weight INTEGER DEFAULT 100,
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS routing_rules (
        id SERIAL PRIMARY KEY,
        config_id INTEGER NOT NULL REFERENCES routing_configs(id) ON DELETE CASCADE,
        field TEXT NOT NULL,
        operator TEXT NOT NULL,
        value TEXT NOT NULL,
        target_id INTEGER REFERENCES routing_targets(id) ON DELETE SET NULL,
        priority INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // ── Recommendations table ──────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS recommendations (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'info',
        action_type TEXT NOT NULL,
        action_payload JSONB NOT NULL DEFAULT '{}',
        context JSONB DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        applied_at TIMESTAMPTZ,
        dismissed_at TIMESTAMPTZ
      )
    `);
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_recommendations_user_status ON recommendations(user_id, status)`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_recommendations_account_status ON recommendations(account_id, status)`,
    );

    // ── Custom cohorts ─────────────────────────────────────────────────────
    await pool.query(`
      CREATE TABLE IF NOT EXISTS custom_cohorts (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        color TEXT DEFAULT '#6366f1',
        cohort_type TEXT NOT NULL DEFAULT 'static',
        rules JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, name)
      )
    `);

    // Add columns if they don't exist (migration for existing DBs)
    await pool
      .query(
        `ALTER TABLE custom_cohorts ADD COLUMN IF NOT EXISTS cohort_type TEXT NOT NULL DEFAULT 'static'`,
      )
      .catch(() => {});
    await pool
      .query(`ALTER TABLE custom_cohorts ADD COLUMN IF NOT EXISTS rules JSONB`)
      .catch(() => {});
    await pool
      .query(
        `CREATE INDEX IF NOT EXISTS idx_custom_cohorts_account ON custom_cohorts(account_id)`,
      )
      .catch(() => {});

    await pool.query(`
      CREATE TABLE IF NOT EXISTS cohort_members (
        id SERIAL PRIMARY KEY,
        cohort_id INTEGER NOT NULL REFERENCES custom_cohorts(id) ON DELETE CASCADE,
        customer_id TEXT NOT NULL,
        added_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(cohort_id, customer_id)
      )
    `);

    // Stage 1 migration indexes (added at end so referenced tables exist).
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_user_accounts_user ON user_accounts(user_id)`,
    );
    await pool.query(
      `CREATE INDEX IF NOT EXISTS idx_user_accounts_account ON user_accounts(account_id)`,
    );

    // Initialize model pricing table (non-blocking — don't delay cold start)
    initModelPricing(pool).catch((err) =>
      console.error("Initial pricing refresh failed:", err),
    );

    // ── Stage 6: zero out misleading mrr_allocation revenue on gateway/proxy events
    try {
      const fixed = await pool.query(
        `UPDATE observe_events
         SET revenue_amount = 0, revenue_source = 'subscription'
         WHERE revenue_source = 'mrr_allocation'
           AND (source = 'gateway' OR source = 'proxy')`,
      );
      if ((fixed.rowCount ?? 0) > 0) {
        console.warn(`Stage 6: fixed ${fixed.rowCount} mrr_allocation events`);
      }
    } catch (err) {
      console.error("Stage 6 mrr_allocation fix failed:", err);
    }
    // ── end Stage 6 migration ───────────────────────────────────────────

    // ── Stage 7: add clerk_org_id to accounts, relax legacy NOT NULLs ──
    await pool
      .query(
        `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS clerk_org_id TEXT UNIQUE`,
      )
      .catch((err) => console.error("Stage 7 add clerk_org_id:", err));
    await pool
      .query(
        `CREATE INDEX IF NOT EXISTS idx_accounts_clerk_org ON accounts(clerk_org_id) WHERE clerk_org_id IS NOT NULL`,
      )
      .catch((err) => console.error("Stage 7 clerk_org_id index:", err));
    await pool
      .query(`ALTER TABLE accounts ALTER COLUMN email DROP NOT NULL`)
      .catch(() => {});
    await pool
      .query(`ALTER TABLE accounts ALTER COLUMN password_hash DROP NOT NULL`)
      .catch(() => {});
    // ── end Stage 7 ────────────────────────────────────────────────────

    // Record schema version so future cold starts skip migrations
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_version (version INT NOT NULL)`,
    );
    await pool.query(`DELETE FROM schema_version`);
    await pool.query(`INSERT INTO schema_version (version) VALUES ($1)`, [
      SCHEMA_VERSION,
    ]);
    console.warn(
      `Schema migrations complete, set version to ${SCHEMA_VERSION}`,
    );
  } catch (error) {
    console.error("Failed to connect to database:", error);
    throw error;
  }
}

// ─── Static file serving for Docker/self-host ─────────────────────────────
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "..", "dist");

// Only serve static files when self-hosting (Docker), not on Vercel
import fs from "fs";

if (
  process.env.NODE_ENV === "production" &&
  !process.env.VERCEL &&
  fs.existsSync(distPath)
) {
  app.use(express.static(distPath));
  // SPA fallback: serve index.html for all non-API routes
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// Local dev server
const port = parseInt(process.env.PORT || "3001", 10);
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(port, () => {
    console.warn(`Server running on http://localhost:${port}`);
  });
}

// Vercel serverless export
export default app;
