import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import session from "express-session";
import pgSession from "connect-pg-simple";
import Pg from "pg";
import { Pool as NeonPool } from "@neondatabase/serverless";

const Pool =
  process.env.DB_DRIVER === "pg"
    ? Pg.Pool
    : (NeonPool as unknown as typeof Pg.Pool);
import { createAuthRoutes, createEnsureVisitor } from "./routes/auth.js";
import { checkFeatureAccess } from "./billing.js";

import { createConvertReferralIfPending } from "./routes/integrations.js";
import { createAlertRoutes } from "./routes/alerts.js";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { initModelPricing } from "./model-pricing.js";
import { createProxyRoutes } from "./routes/proxy.js";
import { createCustomersRoutes } from "./routes/customers.js";
import { createEventsRoutes } from "./routes/events.js";
import { createFeaturesRoutes } from "./routes/features.js";
import { createInsightsRoutes } from "./routes/insights.js";
import { createModelsApiRoutes } from "./routes/models-api.js";
import { createTeamRoutes } from "./routes/team.js";
import { createAnalyticsRoutes } from "./routes/analytics.js";
import { createCohortsRoutes } from "./routes/cohorts.js";
import { createA2ARoutes } from "./routes/a2a.js";
import { createCloudCostRoutes } from "./routes/cloud-costs.js";
import { createBillingApiRoutes } from "./routes/billing-api.js";
import {
  createInferenceRoutes,
  computeInferenceProfiles,
} from "./routes/inference.js";

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const PgStore = pgSession(session);

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
const requiredEnvVars = ["SESSION_SECRET", "DATABASE_URL"] as const;
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`${envVar} environment variable is required`);
  }
}

app.set("trust proxy", 1);

app.use(
  session({
    store: new PgStore({
      pool,
      tableName: "sessions",
      createTableIfMissing: true,
    }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    name: "pa.sid",
    cookie: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "strict",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  }),
);

// Auth routes + middleware (extracted to routes/auth.ts)
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
) => checkFeatureAccess(pool, visitorId, featureKey, email);
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

// ─── Health check ───────────────────────────────────────────────────────────
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ status: "ok" });
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
app.use(createInferenceRoutes(pool, ensureVisitor));
app.use(createA2ARoutes(pool, ensureVisitor));
app.use(createCloudCostRoutes(pool, ensureVisitor));

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
    "DELETE FROM subscriptions WHERE user_id = $1 AND subscription_id IN ('sub_001','sub_002','sub_003','sub_004','sub_005')",
    [userId],
  );
  await db.query(
    "DELETE FROM customers WHERE user_id = $1 AND customer_id IN ('cus_001','cus_002','cus_003','cus_004','cus_005')",
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
async function _doDbInit() {
  try {
    await pool.query("SELECT 1");
    console.log("Database connection verified");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS accounts (
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

    // Add stripe columns if missing (migration for existing DBs)
    await pool.query(
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`,
    );
    await pool.query(
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stripe_plan TEXT DEFAULT 'free'`,
    );
    await pool.query(
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS bonus_credits INTEGER DEFAULT 0`,
    );
    await pool.query(
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS feedback_submitted BOOLEAN DEFAULT false`,
    );
    await pool.query(
      `ALTER TABLE accounts ADD COLUMN IF NOT EXISTS invite_credits_granted INTEGER DEFAULT 0`,
    );

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
        account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
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

    // Add revenue_source column to observe_events if missing
    await pool.query(`
      ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS revenue_source TEXT DEFAULT 'none'
    `);

    await pool.query(`
      ALTER TABLE observe_events ADD COLUMN IF NOT EXISTS agent_id TEXT
    `);

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
        email TEXT NOT NULL,
        enabled BOOLEAN DEFAULT true,
        cooldown_minutes INTEGER DEFAULT 60,
        last_triggered_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

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

    // Initialize model pricing table
    await initModelPricing(pool);

    // One-time cleanup: purge stale sample data for users already on 'user' mode
    try {
      const contaminated = await pool.query(
        `SELECT uds.user_id FROM user_data_status uds
         WHERE uds.data_mode = 'user'
         AND EXISTS (SELECT 1 FROM observe_events oe WHERE oe.user_id = uds.user_id AND oe.source = 'sample' LIMIT 1)`,
      );
      for (const row of contaminated.rows) {
        await clearSampleData(pool, row.user_id);
        console.log(`Cleaned stale sample data for user ${row.user_id}`);
      }
    } catch (err) {
      console.error("Sample data cleanup error (non-fatal):", err);
    }
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
    console.log(`Server running on http://localhost:${port}`);
  });
}

// Vercel serverless export
export default app;
