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
import crypto from "crypto";
import bcrypt from "bcryptjs";
import {
  createAuthRoutes,
  createEnsureVisitor,
  type AuthRequest,
} from "./routes/auth.js";
import { createDataRoutes } from "./routes/data.js";
// import { createSimulationsRoutes } from './routes/simulations.js'
import {
  createBillingRoutes,
  createCheckBillingFeatureAccess,
  createTrackBillingUsage,
} from "./routes/tanso.js";

// import { createTeamRoutes } from './routes/team.js'
import {
  createIntegrationsRoutes,
  createConvertReferralIfPending,
  syncStripeDataForUser,
} from "./routes/integrations.js";
import {
  createStripeClientFromKey,
  encryptApiKey,
  decryptApiKey,
  getStripeClientForUser,
} from "./stripe-client.js";
import { createAlertRoutes, checkAlerts } from "./routes/alerts.js";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { getUncachableStripeClient } from "./stripe-client.js";
import {
  initModelPricing,
  calculateCostFromTokens as calcCostFromDb,
  getAllPricing,
} from "./model-pricing.js";

const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

const PgStore = pgSession(session);

app.use(express.json({ limit: "2mb" }));

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
const ADMIN_EMAIL = "admin@observehq.dev";
let cachedAdminVisitorId: string | null = null;

async function getAdminVisitorId(): Promise<string | null> {
  if (cachedAdminVisitorId) return cachedAdminVisitorId;
  try {
    const result = await pool.query(
      "SELECT visitor_id FROM accounts WHERE LOWER(email) = $1 LIMIT 1",
      [ADMIN_EMAIL],
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

// ─── Shared billing helpers (used by multiple route modules) ─────────────────
const checkBillingFeatureAccess = createCheckBillingFeatureAccess(pool);
const trackBillingUsage = createTrackBillingUsage(pool, getAdminVisitorId);
const convertReferralIfPending = createConvertReferralIfPending(pool);

// ─── Extracted route modules ───────────────────────────────────────────────
app.use(
  createDataRoutes(pool, ensureVisitor, {
    checkBillingFeatureAccess,
    trackBillingUsage,
    convertReferralIfPending,
  }),
);
// app.use(createSimulationsRoutes(pool, ensureVisitor))
app.use(
  createBillingRoutes(pool, ensureVisitor, {
    checkBillingFeatureAccess,
  }),
);

// app.use(createTeamRoutes(pool, ensureVisitor))
app.use(
  createIntegrationsRoutes(pool, ensureVisitor, {
    trackBillingUsage,
    convertReferralIfPending,
  }),
);
app.use(
  createAlertRoutes(pool, ensureVisitor, {
    checkTansoFeatureAccess: checkBillingFeatureAccess,
  }),
);

// ─── OpenAI-compatible proxy ───────────────────────────────────────────────
// Users swap their base URL to route through this proxy. Requests are forwarded
// to OpenAI transparently while logging cost/usage as observe_events.
// Helicone-compatible: accepts Helicone-Auth, Helicone-User-Id, Helicone-Property-* headers
// so teams migrating from Helicone can just change their base URL.

// Extract Helicone-compatible headers, falling back to Observe-native headers
function parseProxyHeaders(req: Request): {
  observeKey: string | undefined;
  customerId: string;
  featureKey: string;
  properties: Record<string, string>;
} {
  // Auth: Helicone-Auth > x-observe-key
  let observeKey = req.headers["x-observe-key"] as string | undefined;
  const heliconeAuth = req.headers["helicone-auth"] as string | undefined;
  if (!observeKey && heliconeAuth?.startsWith("Bearer ")) {
    observeKey = heliconeAuth.slice(7).trim();
  }

  // Customer: Helicone-User-Id > x-observe-customer
  const customerId =
    (req.headers["helicone-user-id"] as string) ||
    (req.headers["x-observe-customer"] as string) ||
    "unknown";

  // Feature: Helicone-Session-Id > x-observe-feature (default per-endpoint)
  const featureKey =
    (req.headers["helicone-session-id"] as string) ||
    (req.headers["x-observe-feature"] as string) ||
    "";

  // Collect Helicone-Property-* headers as properties
  const properties: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.startsWith("helicone-property-") && typeof value === "string") {
      properties[key.replace("helicone-property-", "")] = value;
    }
  }

  return { observeKey, customerId, featureKey, properties };
}

// ── Proxy Response Cache ────────────────────────────────────────────────────

function parseCacheHeaders(req: Request): {
  cacheEnabled: boolean;
  ttlSeconds: number;
} {
  const enabled =
    req.headers["helicone-cache-enabled"] === "true" ||
    req.headers["x-observe-cache-enabled"] === "true";
  const rawTtl =
    (req.headers["helicone-cache-ttl"] as string | undefined) ||
    (req.headers["x-observe-cache-ttl"] as string | undefined);
  const ttlSeconds = rawTtl
    ? Math.max(1, parseInt(rawTtl, 10) || 86400)
    : 86400;
  return { cacheEnabled: enabled, ttlSeconds };
}

function generateCacheKey(
  userId: string,
  model: string,
  payload: Record<string, unknown>,
): string {
  const stable = JSON.stringify(payload, Object.keys(payload).sort());
  return crypto
    .createHash("sha256")
    .update(`${userId}:${model}:${stable}`)
    .digest("hex");
}

async function lookupCache(
  userId: string,
  cacheKey: string,
): Promise<Record<string, unknown> | null> {
  const result = await pool.query(
    `SELECT response_body FROM proxy_cache
     WHERE user_id = $1 AND cache_key = $2
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [userId, cacheKey],
  );
  return result.rows[0]?.response_body ?? null;
}

async function writeCache(
  userId: string,
  cacheKey: string,
  model: string,
  responseBody: Record<string, unknown>,
  ttlSeconds: number,
  tokensSaved: number,
  costSaved: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO proxy_cache (user_id, cache_key, model, request_hash, response_body, tokens_saved, cost_saved, expires_at)
     VALUES ($1, $2, $3, $2, $4, $5, $6, NOW() + ($7 || ' seconds')::INTERVAL)
     ON CONFLICT (user_id, cache_key) DO UPDATE SET
       response_body = EXCLUDED.response_body,
       tokens_saved = proxy_cache.tokens_saved + EXCLUDED.tokens_saved,
       cost_saved = proxy_cache.cost_saved + EXCLUDED.cost_saved,
       expires_at = EXCLUDED.expires_at`,
    [
      userId,
      cacheKey,
      model,
      responseBody,
      tokensSaved,
      costSaved,
      String(ttlSeconds),
    ],
  );
}

// Clear sample/demo data when transitioning to real user data
// Uses exact sample IDs to avoid deleting real Stripe data (sub_*, cus_* prefixes match real Stripe IDs)
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

// Model pricing is now in the database (model_pricing table) — see model-pricing.ts

function inferModelProvider(model: string | undefined): string | null {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m.startsWith("claude-")) return "anthropic";
  if (
    m.startsWith("gpt-") ||
    m.startsWith("o1") ||
    m.startsWith("o3") ||
    m.startsWith("o4") ||
    m.startsWith("text-embedding-")
  )
    return "openai";
  if (m.startsWith("dall-e-")) return "openai";
  if (m.startsWith("gemini-")) return "google";
  if (m.startsWith("mistral-") || m.startsWith("codestral")) return "mistral";
  if (m.startsWith("llama-")) return "meta";
  return null;
}

async function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<number> {
  return calcCostFromDb(pool, model, inputTokens, outputTokens);
}

async function resolveProxyUserId(observeKey: string): Promise<string | null> {
  const keyHash = crypto.createHash("sha256").update(observeKey).digest("hex");
  const result = await pool.query(
    "SELECT user_id FROM sdk_api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
    [keyHash],
  );
  if (result.rows.length === 0) return null;
  pool
    .query("UPDATE sdk_api_keys SET last_used_at = NOW() WHERE key_hash = $1", [
      keyHash,
    ])
    .catch((err) =>
      console.error("Failed to update sdk_api_keys last_used_at:", err),
    );
  return result.rows[0].user_id;
}

async function logProxyEvent(
  userId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  cost: number,
  customerId: string,
  featureKey: string,
  provider: string = "openai",
  properties: Record<string, string> = {},
  requestBody?: Record<string, unknown> | null,
  responseBody?: Record<string, unknown> | null,
): Promise<void> {
  const propsJson = JSON.stringify(properties);
  const reqJson = requestBody ? JSON.stringify(requestBody) : null;
  const resJson = responseBody ? JSON.stringify(responseBody) : null;
  const totalTokens = inputTokens + outputTokens;

  // 1. Log for the user
  await pool.query(
    `INSERT INTO observe_events (
      user_id, customer_id, feature_key, event_name, timestamp,
      cost_amount, cost_unit, revenue_amount, usage_units,
      model, model_provider, source, granularity, is_inferred, properties,
      request_body, response_body
    ) VALUES ($1, $2, $3, 'cost', NOW(), $4, 'usd', 0, $5, $6, $7, 'proxy', 'event', false, $8, $9, $10)`,
    [
      userId,
      customerId,
      featureKey,
      cost,
      totalTokens,
      model,
      provider,
      propsJson,
      reqJson,
      resJson,
    ],
  );
  checkAlerts(pool, userId).catch((err) =>
    console.error("checkAlerts error (proxy event):", err),
  );

  // 2. Mirror to admin account so admin@observehq.dev sees all activity
  getAdminVisitorId()
    .then((adminId) => {
      if (!adminId || adminId === userId) return;
      pool
        .query(
          `INSERT INTO observe_events (
        user_id, customer_id, feature_key, event_name, timestamp,
        cost_amount, cost_unit, revenue_amount, usage_units,
        model, model_provider, source, granularity, is_inferred, properties,
        request_body, response_body
      ) VALUES ($1, $2, $3, 'cost', NOW(), $4, 'usd', 0, $5, $6, $7, 'proxy', 'event', false, $8, $9, $10)`,
          [
            adminId,
            customerId,
            featureKey,
            cost,
            totalTokens,
            model,
            provider,
            propsJson,
            reqJson,
            resJson,
          ],
        )
        .catch((err) => console.error("Admin proxy event mirror error:", err));
    })
    .catch((err) => console.error("Admin proxy mirror error:", err));
}

// GET /v1/models — proxy to OpenAI
app.get("/v1/models", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        error: {
          message: "Missing Authorization header",
          type: "auth_error",
        },
      });
    }
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: authHeader },
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (error) {
    console.error("GET /v1/models proxy error:", error);
    res.status(502).json({
      error: { message: "Failed to reach OpenAI", type: "proxy_error" },
    });
  }
});

// POST /v1/chat/completions — proxy + log (Helicone-compatible)
app.post("/v1/chat/completions", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        error: {
          message: "Missing Authorization header (OpenAI key)",
          type: "auth_error",
        },
      });
    }

    const {
      observeKey,
      customerId,
      featureKey: feat,
      properties,
    } = parseProxyHeaders(req);
    if (!observeKey) {
      return res.status(401).json({
        error: {
          message: "Missing X-Observe-Key header",
          type: "auth_error",
        },
      });
    }
    const userId = await resolveProxyUserId(observeKey);
    if (!userId) {
      return res.status(401).json({
        error: {
          message: "Invalid or revoked X-Observe-Key",
          type: "auth_error",
        },
      });
    }
    const featureKey = feat || "chat_completions";
    const model = req.body.model || "unknown";
    const { cacheEnabled, ttlSeconds } = parseCacheHeaders(req);
    const isCacheable =
      cacheEnabled && !req.body.stream && !(req.body.temperature > 0);

    // Cache lookup
    if (isCacheable) {
      const cacheKey = generateCacheKey(userId, model, {
        messages: req.body.messages,
        model,
        temperature: req.body.temperature ?? 0,
      });
      const cached = await lookupCache(userId, cacheKey);
      if (cached) {
        res.set("X-Observe-Cache", "HIT");
        res.status(200).json(cached);
        logProxyEvent(
          userId,
          model,
          0,
          0,
          0,
          customerId,
          featureKey,
          "openai",
          { ...properties, cache_hit: "true" },
          req.body,
          cached as Record<string, unknown>,
        ).catch((err) =>
          console.error("logProxyEvent error (openai cache hit):", err),
        );
        return;
      }
    }

    // Forward to OpenAI
    const openaiResponse = await fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      },
    );

    const data = (await openaiResponse.json()) as Record<string, unknown>;
    if (isCacheable) res.set("X-Observe-Cache", "MISS");
    res.status(openaiResponse.status).json(data);

    // Log + cache write asynchronously
    if (userId && openaiResponse.ok && data.usage) {
      const usage = data.usage as {
        prompt_tokens?: number;
        completion_tokens?: number;
      };
      const respModel = (data.model as string) || model;
      const inputTokens = usage.prompt_tokens || 0;
      const outputTokens = usage.completion_tokens || 0;
      const cost = await calculateCost(respModel, inputTokens, outputTokens);
      logProxyEvent(
        userId,
        respModel,
        inputTokens,
        outputTokens,
        cost,
        customerId,
        featureKey,
        "openai",
        properties,
        req.body,
        data,
      ).catch((err) => console.error("Proxy event logging failed:", err));
      if (isCacheable) {
        const cacheKey = generateCacheKey(userId, model, {
          messages: req.body.messages,
          model,
          temperature: req.body.temperature ?? 0,
        });
        writeCache(
          userId,
          cacheKey,
          respModel,
          data,
          ttlSeconds,
          inputTokens + outputTokens,
          cost,
        ).catch((err) => console.error("Cache write failed:", err));
      }
    }
  } catch (error) {
    console.error("POST /v1/chat/completions proxy error:", error);
    res.status(502).json({
      error: { message: "Failed to reach OpenAI", type: "proxy_error" },
    });
  }
});

// POST /v1/embeddings — proxy + log (Helicone-compatible)
app.post("/v1/embeddings", async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({
        error: {
          message: "Missing Authorization header (OpenAI key)",
          type: "auth_error",
        },
      });
    }

    const {
      observeKey,
      customerId,
      featureKey: feat,
      properties,
    } = parseProxyHeaders(req);
    if (!observeKey) {
      return res.status(401).json({
        error: {
          message: "Missing X-Observe-Key header",
          type: "auth_error",
        },
      });
    }
    const userId = await resolveProxyUserId(observeKey);
    if (!userId) {
      return res.status(401).json({
        error: {
          message: "Invalid or revoked X-Observe-Key",
          type: "auth_error",
        },
      });
    }
    const featureKey = feat || "embeddings";
    const model = req.body.model || "unknown";
    const { cacheEnabled, ttlSeconds } = parseCacheHeaders(req);
    const isCacheable = cacheEnabled && !req.body.stream;

    // Cache lookup (embeddings are always deterministic)
    if (isCacheable) {
      const cacheKey = generateCacheKey(userId, model, {
        input: req.body.input,
        model,
      });
      const cached = await lookupCache(userId, cacheKey);
      if (cached) {
        res.set("X-Observe-Cache", "HIT");
        res.status(200).json(cached);
        logProxyEvent(
          userId,
          model,
          0,
          0,
          0,
          customerId,
          featureKey,
          "openai",
          { ...properties, cache_hit: "true" },
          req.body,
          cached as Record<string, unknown>,
        ).catch((err) =>
          console.error("logProxyEvent error (openai cache hit):", err),
        );
        return;
      }
    }

    const openaiResponse = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    const data = (await openaiResponse.json()) as Record<string, unknown>;
    if (isCacheable) res.set("X-Observe-Cache", "MISS");
    res.status(openaiResponse.status).json(data);

    // Log + cache write
    if (userId && openaiResponse.ok && data.usage) {
      const usage = data.usage as {
        prompt_tokens?: number;
        total_tokens?: number;
      };
      const respModel = (data.model as string) || model;
      const inputTokens = usage.prompt_tokens || usage.total_tokens || 0;
      const cost = await calculateCost(respModel, inputTokens, 0);
      logProxyEvent(
        userId,
        respModel,
        inputTokens,
        0,
        cost,
        customerId,
        featureKey,
        "openai",
        properties,
        req.body,
        data,
      ).catch((err) => console.error("Proxy event logging failed:", err));
      if (isCacheable) {
        const cacheKey = generateCacheKey(userId, model, {
          input: req.body.input,
          model,
        });
        writeCache(
          userId,
          cacheKey,
          respModel,
          data,
          ttlSeconds,
          inputTokens,
          cost,
        ).catch((err) => console.error("Cache write failed:", err));
      }
    }
  } catch (error) {
    console.error("POST /v1/embeddings proxy error:", error);
    res.status(502).json({
      error: { message: "Failed to reach OpenAI", type: "proxy_error" },
    });
  }
});

// ─── Anthropic-compatible proxy (Helicone migration) ──────────────────────

async function calculateAnthropicCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): Promise<number> {
  return calcCostFromDb(pool, model, inputTokens, outputTokens);
}

// POST /v1/messages — Anthropic proxy + log (Helicone-compatible)
app.post("/v1/messages", async (req: Request, res: Response) => {
  try {
    const apiKey = req.headers["x-api-key"] as string | undefined;
    if (!apiKey) {
      return res.status(401).json({
        error: {
          message: "Missing x-api-key header (Anthropic key)",
          type: "auth_error",
        },
      });
    }

    const {
      observeKey,
      customerId,
      featureKey: feat,
      properties,
    } = parseProxyHeaders(req);
    const featureKey = feat || "messages";
    const model = req.body.model || "unknown";

    let userId: string | null = null;
    if (observeKey) {
      userId = await resolveProxyUserId(observeKey);
    }

    const { cacheEnabled, ttlSeconds } = parseCacheHeaders(req);
    // Anthropic defaults temperature to 1 when omitted — only cache explicit temperature: 0
    const isCacheable =
      cacheEnabled && !req.body.stream && userId && req.body.temperature === 0;

    // Cache lookup
    if (isCacheable && userId) {
      const cacheKey = generateCacheKey(userId, model, {
        messages: req.body.messages,
        system: req.body.system ?? null,
        model,
      });
      const cached = await lookupCache(userId, cacheKey);
      if (cached) {
        res.set("X-Observe-Cache", "HIT");
        res.status(200).json(cached);
        logProxyEvent(
          userId,
          model,
          0,
          0,
          0,
          customerId,
          featureKey,
          "anthropic",
          { ...properties, cache_hit: "true" },
          req.body,
          cached as Record<string, unknown>,
        ).catch((err) =>
          console.error("logProxyEvent error (anthropic cache hit):", err),
        );
        return;
      }
    }

    // Forward to Anthropic
    const anthropicResponse = await fetch(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version":
            (req.headers["anthropic-version"] as string) || "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      },
    );

    const data = (await anthropicResponse.json()) as Record<string, unknown>;
    if (isCacheable) res.set("X-Observe-Cache", "MISS");
    res.status(anthropicResponse.status).json(data);

    // Log + cache write
    if (userId && anthropicResponse.ok && data.usage) {
      const usage = data.usage as {
        input_tokens?: number;
        output_tokens?: number;
      };
      const respModel = (data.model as string) || model;
      const inputTokens = usage.input_tokens || 0;
      const outputTokens = usage.output_tokens || 0;
      const cost = await calculateAnthropicCost(
        respModel,
        inputTokens,
        outputTokens,
      );
      logProxyEvent(
        userId,
        respModel,
        inputTokens,
        outputTokens,
        cost,
        customerId,
        featureKey,
        "anthropic",
        properties,
        req.body,
        data,
      ).catch((err) =>
        console.error("Anthropic proxy event logging failed:", err),
      );
      if (isCacheable) {
        const cacheKey = generateCacheKey(userId, model, {
          messages: req.body.messages,
          system: req.body.system ?? null,
          model,
        });
        writeCache(
          userId,
          cacheKey,
          respModel,
          data,
          ttlSeconds,
          inputTokens + outputTokens,
          cost,
        ).catch((err) => console.error("Cache write failed:", err));
      }
    }
  } catch (error) {
    console.error("POST /v1/messages proxy error:", error);
    res.status(502).json({
      error: { message: "Failed to reach Anthropic", type: "proxy_error" },
    });
  }
});

// GET /proxy/cache/stats — cache performance metrics for current user
app.get(
  "/proxy/cache/stats",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const [cacheRows, hitRows, totalRows] = await Promise.all([
        pool.query(
          `SELECT COUNT(*) FILTER (WHERE expires_at IS NULL OR expires_at > NOW()) AS total_cached,
                COALESCE(SUM(tokens_saved), 0) AS tokens_saved,
                COALESCE(SUM(cost_saved), 0) AS cost_saved
         FROM proxy_cache WHERE user_id = $1`,
          [req.visitorId],
        ),
        pool.query(
          `SELECT COUNT(*) AS hit_count FROM observe_events
         WHERE user_id = $1 AND source = 'proxy' AND properties->>'cache_hit' = 'true'`,
          [req.visitorId],
        ),
        pool.query(
          `SELECT COUNT(*) AS total FROM observe_events WHERE user_id = $1 AND source = 'proxy'`,
          [req.visitorId],
        ),
      ]);

      const hitCount = parseInt(hitRows.rows[0].hit_count) || 0;
      const totalCount = parseInt(totalRows.rows[0].total) || 0;

      res.json({
        total_cached_entries: parseInt(cacheRows.rows[0].total_cached) || 0,
        tokens_saved: parseInt(cacheRows.rows[0].tokens_saved) || 0,
        cost_saved: parseFloat(cacheRows.rows[0].cost_saved) || 0,
        total_proxy_requests: totalCount,
        cache_hits: hitCount,
        miss_rate_percent:
          totalCount === 0
            ? 0
            : parseFloat(
                (((totalCount - hitCount) / totalCount) * 100).toFixed(1),
              ),
      });
    } catch (error) {
      console.error("GET /proxy/cache/stats error:", error);
      res.status(500).json({ error: "Failed to fetch cache stats" });
    }
  },
);

// ─── End proxy ─────────────────────────────────────────────────────────────

app.get(
  "/data/status",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const statusResult = await pool.query(
        "SELECT * FROM user_data_status WHERE user_id = $1",
        [req.visitorId],
      );
      const customersResult = await pool.query(
        "SELECT COUNT(*) FROM customers WHERE user_id = $1",
        [req.visitorId],
      );
      const costsResult = await pool.query(
        "SELECT COUNT(*) FROM cost_records WHERE user_id = $1",
        [req.visitorId],
      );
      const usageResult = await pool.query(
        "SELECT COUNT(*) FROM usage_records WHERE user_id = $1",
        [req.visitorId],
      );

      const status = statusResult.rows[0] || { data_mode: "none" };
      const customerCount = parseInt(customersResult.rows[0].count);
      const costsCount = parseInt(costsResult.rows[0].count);
      const usageCount = parseInt(usageResult.rows[0].count);

      res.json({
        data_mode: status.data_mode,
        has_data: customerCount > 0,
        customer_count: customerCount,
        has_revenue: customerCount > 0,
        has_costs: costsCount > 0,
        has_usage: usageCount > 0,
        revenue_customer_count: customerCount,
        costs_record_count: costsCount,
        usage_record_count: usageCount,
        last_sync_at: status.updated_at,
      });
    } catch (error) {
      console.error("Get data status error:", error);
      res.status(500).json({ error: "Failed to get data status" });
    }
  },
);

app.get(
  "/customers",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const offset = parseInt(req.query.offset as string) || 0;
      const [result, countResult] = await Promise.all([
        pool.query(
          "SELECT * FROM customers WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
          [req.visitorId, limit, offset],
        ),
        pool.query("SELECT COUNT(*) FROM customers WHERE user_id = $1", [
          req.visitorId,
        ]),
      ]);
      res.json({
        data: result.rows,
        total: parseInt(countResult.rows[0].count),
        limit,
        offset,
      });
    } catch (error) {
      console.error("Get customers error:", error);
      res.status(500).json({ error: "Failed to get customers" });
    }
  },
);

app.get(
  "/subscriptions",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
      const offset = parseInt(req.query.offset as string) || 0;
      const [result, countResult] = await Promise.all([
        pool.query(
          "SELECT s.*, c.name as customer_name, c.email as customer_email, p.name as plan_name, p.price_amount FROM subscriptions s LEFT JOIN customers c ON s.user_id = c.user_id AND s.customer_id = c.customer_id LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id WHERE s.user_id = $1 ORDER BY s.created_at DESC LIMIT $2 OFFSET $3",
          [req.visitorId, limit, offset],
        ),
        pool.query("SELECT COUNT(*) FROM subscriptions WHERE user_id = $1", [
          req.visitorId,
        ]),
      ]);
      res.json({
        data: result.rows,
        total: parseInt(countResult.rows[0].count),
        limit,
        offset,
      });
    } catch (error) {
      console.error("Get subscriptions error:", error);
      res.status(500).json({ error: "Failed to get subscriptions" });
    }
  },
);

app.get("/plans", ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const result = await pool.query(
      "SELECT * FROM plans WHERE user_id = $1 ORDER BY price_amount ASC LIMIT $2 OFFSET $3",
      [req.visitorId, limit, offset],
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Get plans error:", error);
    res.status(500).json({ error: "Failed to get plans" });
  }
});

app.get("/usage", ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const [result, countResult] = await Promise.all([
      pool.query(
        "SELECT * FROM usage_records WHERE user_id = $1 ORDER BY period_start DESC LIMIT $2 OFFSET $3",
        [req.visitorId, limit, offset],
      ),
      pool.query("SELECT COUNT(*) FROM usage_records WHERE user_id = $1", [
        req.visitorId,
      ]),
    ]);
    res.json({
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Get usage error:", error);
    res.status(500).json({ error: "Failed to get usage" });
  }
});

app.get("/costs", ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const offset = parseInt(req.query.offset as string) || 0;
    const [result, countResult] = await Promise.all([
      pool.query(
        "SELECT * FROM cost_records WHERE user_id = $1 ORDER BY period_start DESC LIMIT $2 OFFSET $3",
        [req.visitorId, limit, offset],
      ),
      pool.query("SELECT COUNT(*) FROM cost_records WHERE user_id = $1", [
        req.visitorId,
      ]),
    ]);
    res.json({
      data: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Get costs error:", error);
    res.status(500).json({ error: "Failed to get costs" });
  }
});

app.get(
  "/data/analyzer",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const analyzerLimit = 5000;
      const [plans, customers, subscriptions, usage, costs] = await Promise.all(
        [
          pool.query("SELECT * FROM plans WHERE user_id = $1 LIMIT $2", [
            req.visitorId,
            analyzerLimit,
          ]),
          pool.query("SELECT * FROM customers WHERE user_id = $1 LIMIT $2", [
            req.visitorId,
            analyzerLimit,
          ]),
          pool.query(
            "SELECT * FROM subscriptions WHERE user_id = $1 LIMIT $2",
            [req.visitorId, analyzerLimit],
          ),
          pool.query(
            "SELECT * FROM usage_records WHERE user_id = $1 LIMIT $2",
            [req.visitorId, analyzerLimit],
          ),
          pool.query("SELECT * FROM cost_records WHERE user_id = $1 LIMIT $2", [
            req.visitorId,
            analyzerLimit,
          ]),
        ],
      );

      if (customers.rows.length === 0) {
        res.json(null);
        return;
      }

      res.json({
        plans: plans.rows.map((p) => ({
          plan_id: p.plan_id,
          name: p.name,
          price_amount: Number(p.price_amount),
          interval_months: p.interval_months || 1,
          billing_model: p.billing_model || "recurring",
        })),
        customers: customers.rows.map((c) => ({
          customer_id: c.customer_id,
          name: c.name,
          email: c.email || undefined,
          segment: c.segment || undefined,
          created_at: c.created_at,
        })),
        subscriptions: subscriptions.rows.map((s) => ({
          subscription_id: s.subscription_id,
          customer_id: s.customer_id,
          plan_id: s.plan_id,
          is_active: s.is_active,
          mrr_override: s.mrr_override ? Number(s.mrr_override) : undefined,
          previous_mrr: s.previous_mrr ? Number(s.previous_mrr) : undefined,
          current_period_start: s.current_period_start,
          current_period_end: s.current_period_end,
          cancelled_at: s.cancelled_at,
        })),
        usage: usage.rows.map((u) => ({
          customer_id: u.customer_id,
          metric_key: u.metric_key,
          metric_value: Number(u.metric_value),
          metric_limit: u.metric_limit ? Number(u.metric_limit) : undefined,
          period_start: u.period_start,
          period_end: u.period_end,
        })),
        costs: costs.rows.map((c) => ({
          customer_id: c.customer_id || undefined,
          cost_type: c.cost_type,
          amount: Number(c.amount),
          period_start: c.period_start,
          period_end: c.period_end,
        })),
      });
    } catch (error) {
      console.error("Get analyzer data error:", error);
      res.status(500).json({ error: "Failed to get analyzer data" });
    }
  },
);

app.post(
  "/data/sample",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query("DELETE FROM ai_insights WHERE user_id = $1", [
        req.visitorId,
      ]);

      await client.query("DELETE FROM observe_events WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM usage_records WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM cost_records WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM subscriptions WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM customers WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM plans WHERE user_id = $1", [
        req.visitorId,
      ]);

      const plans = [
        {
          plan_id: "starter",
          name: "Starter",
          price_amount: 29,
          interval_months: 1,
        },
        {
          plan_id: "pro",
          name: "Professional",
          price_amount: 99,
          interval_months: 1,
        },
        {
          plan_id: "enterprise",
          name: "Enterprise",
          price_amount: 299,
          interval_months: 1,
        },
      ];
      for (const plan of plans) {
        await client.query(
          "INSERT INTO plans (user_id, plan_id, name, price_amount, interval_months) VALUES ($1, $2, $3, $4, $5)",
          [
            req.visitorId,
            plan.plan_id,
            plan.name,
            plan.price_amount,
            plan.interval_months,
          ],
        );
      }

      const customers = [
        {
          customer_id: "cus_001",
          name: "Acme Corp",
          email: "billing@acme.com",
          segment: "Enterprise",
          created_at: "2025-08-01T00:00:00Z",
        },
        {
          customer_id: "cus_002",
          name: "TechStart Inc",
          email: "admin@techstart.io",
          segment: "SMB",
          created_at: "2025-11-15T00:00:00Z",
        },
        {
          customer_id: "cus_003",
          name: "Global Solutions",
          email: "accounts@global.com",
          segment: "Mid-Market",
          created_at: "2025-09-10T00:00:00Z",
        },
        {
          customer_id: "cus_004",
          name: "Startup Labs",
          email: "hello@startuplabs.co",
          segment: "SMB",
          created_at: "2026-02-01T00:00:00Z",
        },
        {
          customer_id: "cus_005",
          name: "Enterprise Co",
          email: "procurement@enterprise.com",
          segment: "Enterprise",
          created_at: "2025-06-01T00:00:00Z",
        },
      ];
      for (const customer of customers) {
        await client.query(
          "INSERT INTO customers (user_id, customer_id, name, email, segment, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
          [
            req.visitorId,
            customer.customer_id,
            customer.name,
            customer.email,
            customer.segment,
            customer.created_at,
          ],
        );
      }

      const subscriptions = [
        {
          subscription_id: "sub_001",
          customer_id: "cus_001",
          plan_id: "enterprise",
          is_active: true,
          mrr_override: 299,
          previous_mrr: 99,
          created_at: "2025-08-01T00:00:00Z",
          current_period_start: "2026-03-01T00:00:00Z",
          current_period_end: "2026-04-01T00:00:00Z",
        },
        {
          subscription_id: "sub_002",
          customer_id: "cus_002",
          plan_id: "starter",
          is_active: true,
          mrr_override: 29,
          previous_mrr: 0,
          created_at: "2025-11-15T00:00:00Z",
          current_period_start: "2026-03-01T00:00:00Z",
          current_period_end: "2026-04-01T00:00:00Z",
        },
        {
          subscription_id: "sub_003",
          customer_id: "cus_003",
          plan_id: "pro",
          is_active: true,
          mrr_override: 99,
          previous_mrr: 29,
          created_at: "2025-09-10T00:00:00Z",
          current_period_start: "2026-03-01T00:00:00Z",
          current_period_end: "2026-04-01T00:00:00Z",
        },
        {
          subscription_id: "sub_004",
          customer_id: "cus_004",
          plan_id: "starter",
          is_active: true,
          mrr_override: 29,
          previous_mrr: 0,
          created_at: "2026-02-01T00:00:00Z",
          current_period_start: "2026-03-01T00:00:00Z",
          current_period_end: "2026-04-01T00:00:00Z",
        },
        {
          subscription_id: "sub_005",
          customer_id: "cus_005",
          plan_id: "enterprise",
          is_active: true,
          mrr_override: 299,
          previous_mrr: 299,
          created_at: "2025-06-01T00:00:00Z",
          current_period_start: "2026-03-01T00:00:00Z",
          current_period_end: "2026-04-01T00:00:00Z",
        },
      ];
      for (const sub of subscriptions) {
        await client.query(
          `INSERT INTO subscriptions (user_id, subscription_id, customer_id, plan_id, is_active, mrr_override, previous_mrr, created_at, current_period_start, current_period_end)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            req.visitorId,
            sub.subscription_id,
            sub.customer_id,
            sub.plan_id,
            sub.is_active,
            sub.mrr_override,
            sub.previous_mrr,
            sub.created_at,
            sub.current_period_start,
            sub.current_period_end,
          ],
        );
      }

      // Sample cost_records — monthly AI costs for the Overview page
      const _now = new Date();
      for (let i = 5; i >= 0; i--) {
        const start = new Date(_now.getFullYear(), _now.getMonth() - i, 1);
        const end = new Date(_now.getFullYear(), _now.getMonth() - i + 1, 0);
        const amount = 3200 + (5 - i) * 600;
        await client.query(
          "INSERT INTO cost_records (user_id, cost_type, amount, period_start, period_end) VALUES ($1, $2, $3, $4, $5)",
          [
            req.visitorId,
            "ai_inference",
            amount,
            start.toISOString(),
            end.toISOString(),
          ],
        );
      }

      // Sample observe_events — feature-level cost+revenue data
      function daysAgo(d: number) {
        return new Date(Date.now() - d * 86400000).toISOString();
      }
      const sampleEvents = [
        {
          customer_id: "cus_001",
          feature_key: "ai_summarization",
          event_name: "summary_generated",
          ts: daysAgo(1),
          cost: 0.24,
          cost_unit: "usd",
          revenue: 0.5,
          usage: 24,
          model: "claude-3-5-sonnet",
          provider: "anthropic",
          source: "sample",
        },
        {
          customer_id: "cus_002",
          feature_key: "ai_summarization",
          event_name: "summary_generated",
          ts: daysAgo(2),
          cost: 0.08,
          cost_unit: "usd",
          revenue: 0.2,
          usage: 8,
          model: "gpt-4o",
          provider: "openai",
          source: "sample",
        },
        {
          customer_id: "cus_003",
          feature_key: "ai_summarization",
          event_name: "summary_generated",
          ts: daysAgo(5),
          cost: 0.15,
          cost_unit: "usd",
          revenue: 0.35,
          usage: 15,
          model: "claude-3-5-sonnet",
          provider: "anthropic",
          source: "sample",
        },
        {
          customer_id: "cus_001",
          feature_key: "ai_summarization",
          event_name: "summary_generated",
          ts: daysAgo(10),
          cost: 0.3,
          cost_unit: "usd",
          revenue: 0.6,
          usage: 30,
          model: "gpt-4o",
          provider: "openai",
          source: "sample",
        },
        {
          customer_id: "cus_004",
          feature_key: "ai_summarization",
          event_name: "summary_generated",
          ts: daysAgo(14),
          cost: 0.05,
          cost_unit: "usd",
          revenue: 0.15,
          usage: 5,
          model: "claude-3-haiku",
          provider: "anthropic",
          source: "sample",
        },
        {
          customer_id: "cus_001",
          feature_key: "image_generation",
          event_name: "image_generated",
          ts: daysAgo(3),
          cost: 0.04,
          cost_unit: "usd",
          revenue: 0.25,
          usage: 1,
          model: "dall-e-3",
          provider: "openai",
          source: "sample",
        },
        {
          customer_id: "cus_003",
          feature_key: "image_generation",
          event_name: "image_generated",
          ts: daysAgo(7),
          cost: 0.04,
          cost_unit: "usd",
          revenue: 0.25,
          usage: 1,
          model: "dall-e-3",
          provider: "openai",
          source: "sample",
        },
        {
          customer_id: "cus_005",
          feature_key: "image_generation",
          event_name: "image_generated",
          ts: daysAgo(18),
          cost: 0.02,
          cost_unit: "usd",
          revenue: 0.2,
          usage: 1,
          model: "stable-diffusion-xl",
          provider: "stability",
          source: "sample",
        },
        {
          customer_id: "cus_002",
          feature_key: "image_generation",
          event_name: "image_generated",
          ts: daysAgo(20),
          cost: 0.04,
          cost_unit: "usd",
          revenue: 0.25,
          usage: 1,
          model: "dall-e-3",
          provider: "openai",
          source: "sample",
        },
        {
          customer_id: "cus_001",
          feature_key: "search",
          event_name: "search_query",
          ts: daysAgo(1),
          cost: 0.002,
          cost_unit: "usd",
          revenue: 0.01,
          usage: 100,
          model: "text-embedding-3-small",
          provider: "openai",
          source: "sample",
        },
        {
          customer_id: "cus_002",
          feature_key: "search",
          event_name: "search_query",
          ts: daysAgo(4),
          cost: 0.003,
          cost_unit: "usd",
          revenue: 0.01,
          usage: 150,
          model: "text-embedding-3-small",
          provider: "openai",
          source: "sample",
        },
        {
          customer_id: "cus_003",
          feature_key: "search",
          event_name: "search_query",
          ts: daysAgo(12),
          cost: 0.001,
          cost_unit: "usd",
          revenue: 0.005,
          usage: 50,
          model: "text-embedding-3-small",
          provider: "openai",
          source: "sample",
        },
        {
          customer_id: "cus_004",
          feature_key: "search",
          event_name: "search_query",
          ts: daysAgo(15),
          cost: 0.004,
          cost_unit: "usd",
          revenue: 0.02,
          usage: 200,
          model: "text-embedding-ada-002",
          provider: "openai",
          source: "sample",
        },
        {
          customer_id: "cus_001",
          feature_key: "pdf_generation",
          event_name: "document_generated",
          ts: daysAgo(6),
          cost: 0.12,
          cost_unit: "usd",
          revenue: 0.5,
          usage: 12,
          model: null,
          provider: null,
          source: "sample",
        },
        {
          customer_id: "cus_005",
          feature_key: "pdf_generation",
          event_name: "document_generated",
          ts: daysAgo(16),
          cost: 0.18,
          cost_unit: "usd",
          revenue: 0.7,
          usage: 18,
          model: null,
          provider: null,
          source: "sample",
        },
        {
          customer_id: "cus_002",
          feature_key: "email_send",
          event_name: "email_sent",
          ts: daysAgo(8),
          cost: 0.01,
          cost_unit: "usd",
          revenue: 0.05,
          usage: 100,
          model: null,
          provider: null,
          source: "sample",
        },
        {
          customer_id: "cus_004",
          feature_key: "email_send",
          event_name: "email_sent",
          ts: daysAgo(22),
          cost: 0.015,
          cost_unit: "usd",
          revenue: 0.06,
          usage: 150,
          model: null,
          provider: null,
          source: "sample",
        },
      ];

      for (const ev of sampleEvents) {
        await client.query(
          `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, revenue_amount, usage_units, model, model_provider, source, granularity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'event')`,
          [
            req.visitorId,
            ev.customer_id,
            ev.feature_key,
            ev.event_name,
            ev.ts,
            ev.cost,
            ev.cost_unit,
            ev.revenue,
            ev.usage,
            ev.model,
            ev.provider,
            ev.source,
          ],
        );
      }

      await client.query(
        "INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()",
        [req.visitorId, "sample"],
      );

      await client.query("COMMIT");
      // Convert referral if this user was referred and just loaded data
      convertReferralIfPending(req.visitorId!);
      res.json({ success: true, message: "Sample data loaded" });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Load sample data error:", error);
      res.status(500).json({ error: "Failed to load sample data" });
    } finally {
      client.release();
    }
  },
);

app.delete(
  "/data/clear",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM ai_insights WHERE user_id = $1", [
        req.visitorId,
      ]);

      await client.query("DELETE FROM observe_events WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM usage_records WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM cost_records WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM subscriptions WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM customers WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM plans WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query(
        "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1",
        [req.visitorId, "none"],
      );
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Clear data error:", error);
      res.status(500).json({ error: "Failed to clear data" });
    } finally {
      client.release();
    }
  },
);

app.delete(
  "/data/clear/revenue",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'revenue'",
        [req.visitorId],
      );
      await client.query("DELETE FROM subscriptions WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM customers WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM plans WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Failed to clear revenue data" });
    } finally {
      client.release();
    }
  },
);

app.delete(
  "/data/clear/costs",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'cost'",
        [req.visitorId],
      );
      await client.query("DELETE FROM cost_records WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Failed to clear cost data" });
    } finally {
      client.release();
    }
  },
);

app.delete(
  "/data/clear/usage",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'usage'",
        [req.visitorId],
      );
      await client.query("DELETE FROM usage_records WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("COMMIT");
      res.json({ success: true });
    } catch (error) {
      await client.query("ROLLBACK");
      res.status(500).json({ error: "Failed to clear usage data" });
    } finally {
      client.release();
    }
  },
);

// Upload cost records
// Upload validation schemas
const costRecordSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM format"),
  cost: z.number({ coerce: true }).nonnegative(),
  customer_id: z.string().optional(),
  provider: z.string().optional(),
});
const usageRecordSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/, "month must be YYYY-MM format"),
  customer_id: z.string().optional(),
  metric: z.string().optional(),
  metric_key: z.string().optional(),
  value: z.number({ coerce: true }).optional(),
  metric_value: z.number({ coerce: true }).optional(),
  limit: z.number({ coerce: true }).optional(),
  metric_limit: z.number({ coerce: true }).optional(),
});
const revenueUploadSchema = z.object({
  customers: z
    .array(
      z.object({
        customer_id: z.string(),
        name: z.string(),
        email: z.string().optional(),
        segment: z.string().optional(),
      }),
    )
    .optional(),
  plans: z
    .array(
      z.object({
        plan_id: z.string(),
        name: z.string(),
        price_amount: z.number({ coerce: true }),
        interval_months: z.number().optional(),
      }),
    )
    .optional(),
  subscriptions: z
    .array(
      z.object({
        subscription_id: z.string(),
        customer_id: z.string(),
        plan_id: z.string(),
        is_active: z.boolean().optional(),
        mrr_override: z.number({ coerce: true }).optional(),
        current_period_start: z.string().optional(),
        current_period_end: z.string().optional(),
      }),
    )
    .optional(),
});

app.post(
  "/data/upload/costs",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    const access = await checkBillingFeatureAccess(
      req.visitorId!,
      "csv_upload",
      req.accountEmail,
    );
    if (!access.allowed)
      return res.status(403).json({
        error: access.reason || "Upload limit reached. Upgrade your plan.",
      });
    const client = await pool.connect();
    try {
      const { records } = req.body;
      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: "No records provided" });
      }
      if (records.length > 10000) {
        return res
          .status(400)
          .json({ error: "Too many records. Maximum 10,000 per upload." });
      }
      const parseResult = z.array(costRecordSchema).safeParse(records);
      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid record format",
          details: parseResult.error.issues.slice(0, 5),
        });
      }

      await client.query("BEGIN");
      await clearSampleData(client, req.visitorId!);
      await client.query("DELETE FROM cost_records WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query(
        "DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'cost'",
        [req.visitorId],
      );

      // Batch insert cost_records
      const batchSize = 500;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const costValues: unknown[] = [];
        const costPlaceholders: string[] = [];
        const eventValues: unknown[] = [];
        const eventPlaceholders: string[] = [];
        let costIdx = 1;
        let eventIdx = 1;

        for (const record of batch) {
          const periodStart = `${record.month}-01`;
          const periodEnd = new Date(record.month + "-01");
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          periodEnd.setDate(0);
          const periodEndStr = periodEnd.toISOString().split("T")[0];

          costPlaceholders.push(
            `($${costIdx++}, $${costIdx++}, $${costIdx++}, $${costIdx++}, $${costIdx++}, $${costIdx++})`,
          );
          costValues.push(
            req.visitorId,
            record.customer_id || null,
            record.provider || "infrastructure",
            record.cost,
            periodStart,
            periodEndStr,
          );

          eventPlaceholders.push(
            `($${eventIdx++}, $${eventIdx++}, $${eventIdx++}, 'cost', $${eventIdx++}, $${eventIdx++}, 'usd', 'csv', 'monthly_aggregate', $${eventIdx++})`,
          );
          eventValues.push(
            req.visitorId,
            record.customer_id || "_aggregate",
            record.provider || "infrastructure",
            new Date(`${record.month}-01`).toISOString(),
            record.cost,
            record.provider || null,
          );
        }

        await client.query(
          `INSERT INTO cost_records (user_id, customer_id, cost_type, amount, period_start, period_end) VALUES ${costPlaceholders.join(", ")}`,
          costValues,
        );
        await client.query(
          `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, source, granularity, model_provider) VALUES ${eventPlaceholders.join(", ")}`,
          eventValues,
        );
      }

      await client.query(
        "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1",
        [req.visitorId, "user"],
      );

      await client.query("COMMIT");
      convertReferralIfPending(req.visitorId!);
      trackBillingUsage(req.visitorId!, "csv_upload", "csv_upload_costs");
      checkAlerts(pool, req.visitorId!).catch((err) =>
        console.error("checkAlerts error (csv upload):", err),
      );
      res.json({ success: true, count: records.length });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Upload costs error:", error);
      res.status(500).json({ error: "Failed to upload cost data" });
    } finally {
      client.release();
    }
  },
);

// Upload usage records
app.post(
  "/data/upload/usage",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    const access = await checkBillingFeatureAccess(
      req.visitorId!,
      "csv_upload",
      req.accountEmail,
    );
    if (!access.allowed)
      return res.status(403).json({
        error: access.reason || "Upload limit reached. Upgrade your plan.",
      });
    const client = await pool.connect();
    try {
      const { records } = req.body;
      if (!Array.isArray(records) || records.length === 0) {
        return res.status(400).json({ error: "No records provided" });
      }
      if (records.length > 10000) {
        return res
          .status(400)
          .json({ error: "Too many records. Maximum 10,000 per upload." });
      }
      const parseResult = z.array(usageRecordSchema).safeParse(records);
      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid record format",
          details: parseResult.error.issues.slice(0, 5),
        });
      }

      await client.query("BEGIN");
      await clearSampleData(client, req.visitorId!);
      await client.query("DELETE FROM usage_records WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query(
        "DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'usage'",
        [req.visitorId],
      );

      // Batch insert usage_records
      const batchSize = 500;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const usageValues: unknown[] = [];
        const usagePlaceholders: string[] = [];
        const eventValues: unknown[] = [];
        const eventPlaceholders: string[] = [];
        let usageIdx = 1;
        let eventIdx = 1;

        for (const record of batch) {
          const periodStart = `${record.month}-01`;
          const periodEnd = new Date(record.month + "-01");
          periodEnd.setMonth(periodEnd.getMonth() + 1);
          periodEnd.setDate(0);
          const periodEndStr = periodEnd.toISOString().split("T")[0];
          const metricKey = record.metric || record.metric_key;
          const metricValue = record.value ?? record.metric_value;

          usagePlaceholders.push(
            `($${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++}, $${usageIdx++})`,
          );
          usageValues.push(
            req.visitorId,
            record.customer_id,
            metricKey,
            metricValue,
            record.limit || record.metric_limit || null,
            periodStart,
            periodEndStr,
          );

          eventPlaceholders.push(
            `($${eventIdx++}, $${eventIdx++}, $${eventIdx++}, 'usage', $${eventIdx++}, $${eventIdx++}, 'csv', 'monthly_aggregate')`,
          );
          eventValues.push(
            req.visitorId,
            record.customer_id || "_aggregate",
            metricKey,
            new Date(`${record.month}-01`).toISOString(),
            metricValue,
          );
        }

        await client.query(
          `INSERT INTO usage_records (user_id, customer_id, metric_key, metric_value, metric_limit, period_start, period_end) VALUES ${usagePlaceholders.join(", ")}`,
          usageValues,
        );
        await client.query(
          `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, usage_units, source, granularity) VALUES ${eventPlaceholders.join(", ")}`,
          eventValues,
        );
      }

      await client.query(
        "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1",
        [req.visitorId, "user"],
      );

      await client.query("COMMIT");
      convertReferralIfPending(req.visitorId!);
      trackBillingUsage(req.visitorId!, "csv_upload", "csv_upload_usage");
      checkAlerts(pool, req.visitorId!).catch((err) =>
        console.error("checkAlerts error (csv upload):", err),
      );
      res.json({ success: true, count: records.length });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Upload usage error:", error);
      res.status(500).json({ error: "Failed to upload usage data" });
    } finally {
      client.release();
    }
  },
);

// Upload revenue data (customers, plans, subscriptions)
app.post(
  "/data/upload/revenue",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    const access = await checkBillingFeatureAccess(
      req.visitorId!,
      "csv_upload",
      req.accountEmail,
    );
    if (!access.allowed)
      return res.status(403).json({
        error: access.reason || "Upload limit reached. Upgrade your plan.",
      });
    const client = await pool.connect();
    try {
      const parseResult = revenueUploadSchema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({
          error: "Invalid revenue data format",
          details: parseResult.error.issues.slice(0, 5),
        });
      }
      const { customers, plans, subscriptions } = parseResult.data;

      await client.query("BEGIN");
      await clearSampleData(client, req.visitorId!);

      // Clear existing revenue data
      await client.query("DELETE FROM subscriptions WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM customers WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM plans WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query(
        "DELETE FROM observe_events WHERE user_id = $1 AND event_name = 'revenue'",
        [req.visitorId],
      );

      // Insert plans
      if (Array.isArray(plans)) {
        for (const plan of plans) {
          await client.query(
            "INSERT INTO plans (user_id, plan_id, name, price_amount, interval_months) VALUES ($1, $2, $3, $4, $5)",
            [
              req.visitorId,
              plan.plan_id,
              plan.name,
              plan.price_amount,
              plan.interval_months || 1,
            ],
          );
        }
      }

      // Insert customers
      if (Array.isArray(customers)) {
        for (const customer of customers) {
          await client.query(
            "INSERT INTO customers (user_id, customer_id, name, email, segment) VALUES ($1, $2, $3, $4, $5)",
            [
              req.visitorId,
              customer.customer_id,
              customer.name,
              customer.email || null,
              customer.segment || null,
            ],
          );
        }
      }

      // Insert subscriptions
      if (Array.isArray(subscriptions)) {
        for (const sub of subscriptions) {
          await client.query(
            "INSERT INTO subscriptions (user_id, subscription_id, customer_id, plan_id, is_active, mrr_override, current_period_start, current_period_end) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            [
              req.visitorId,
              sub.subscription_id,
              sub.customer_id,
              sub.plan_id,
              sub.is_active !== false,
              sub.mrr_override || null,
              sub.current_period_start || null,
              sub.current_period_end || null,
            ],
          );
        }
      }

      // Dual-write subscriptions to observe_events (use plan price as MRR fallback)
      if (Array.isArray(subscriptions)) {
        const planPriceMap = new Map(
          (plans || []).map((p: { plan_id: string; price_amount: number }) => [
            p.plan_id,
            parseFloat(p.price_amount as unknown as string) || 0,
          ]),
        );
        for (const sub of subscriptions) {
          const mrr = sub.mrr_override || planPriceMap.get(sub.plan_id) || 0;
          await client.query(
            `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, revenue_amount, source, granularity)
           VALUES ($1, $2, 'subscription', 'revenue', NOW(), $3, 'csv', 'monthly_aggregate')`,
            [req.visitorId, sub.customer_id, mrr],
          );
        }
      }

      await client.query(
        "UPDATE user_data_status SET data_mode = $2, updated_at = NOW() WHERE user_id = $1",
        [req.visitorId, "user"],
      );

      await client.query("COMMIT");
      convertReferralIfPending(req.visitorId!);
      trackBillingUsage(req.visitorId!, "csv_upload", "csv_upload_revenue");
      res.json({
        success: true,
        counts: {
          customers: customers?.length || 0,
          plans: plans?.length || 0,
          subscriptions: subscriptions?.length || 0,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Upload revenue error:", error);
      res.status(500).json({ error: "Failed to upload revenue data" });
    } finally {
      client.release();
    }
  },
);

app.get(
  "/metrics/summary",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const customersResult = await pool.query(
        "SELECT COUNT(*) FROM customers WHERE user_id = $1",
        [req.visitorId],
      );
      const activeSubs = await pool.query(
        "SELECT COUNT(*) FROM subscriptions WHERE user_id = $1 AND is_active = true",
        [req.visitorId],
      );
      const mrrResult = await pool.query(
        "SELECT COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as mrr FROM subscriptions s LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id WHERE s.user_id = $1 AND s.is_active = true",
        [req.visitorId],
      );

      const mrr = parseFloat(mrrResult.rows[0].mrr) || 0;
      const customerCount = parseInt(customersResult.rows[0].count);

      res.json({
        total_customers: customerCount,
        active_subscriptions: parseInt(activeSubs.rows[0].count),
        mrr: mrr,
        arr: mrr * 12,
        arpc: customerCount > 0 ? mrr / customerCount : 0,
      });
    } catch (error) {
      console.error("Get metrics error:", error);
      res.status(500).json({ error: "Failed to get metrics" });
    }
  },
);

// GET /metrics/source-breakdown — event counts and costs by data source
app.get(
  "/metrics/source-breakdown",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT source, is_inferred,
              COUNT(*) as event_count,
              COALESCE(SUM(cost_amount), 0) as total_cost,
              COALESCE(SUM(revenue_amount), 0) as total_revenue
       FROM observe_events
       WHERE user_id = $1
       GROUP BY source, is_inferred
       ORDER BY total_cost DESC`,
        [req.visitorId],
      );
      const sources = result.rows.map(
        (r: {
          source: string;
          is_inferred: boolean;
          event_count: string;
          total_cost: string;
          total_revenue: string;
        }) => ({
          source: r.is_inferred ? "inferred" : r.source,
          event_count: parseInt(r.event_count),
          total_cost: parseFloat(r.total_cost) || 0,
          total_revenue: parseFloat(r.total_revenue) || 0,
        }),
      );
      const total_events = sources.reduce(
        (s: number, r: { event_count: number }) => s + r.event_count,
        0,
      );
      res.json({ sources, total_events });
    } catch (error) {
      console.error("Get source breakdown error:", error);
      res.status(500).json({ error: "Failed to get source breakdown" });
    }
  },
);

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

    // Add stripe_customer_id column if missing (migration for existing DBs)
    await pool.query(`
      ALTER TABLE accounts ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT
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
      CREATE TABLE IF NOT EXISTS tanso_customers (
        id SERIAL PRIMARY KEY,
        visitor_id TEXT UNIQUE NOT NULL,
        tanso_customer_id TEXT,
        email TEXT,
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

// =============================================================================
// MODEL PRICING API
// =============================================================================

const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "admin@observehq.dev")
  .split(",")
  .map((e) => e.trim().toLowerCase());

function isAdminUser(req: AuthRequest): boolean {
  return (
    !!req.accountEmail && ADMIN_EMAILS.includes(req.accountEmail.toLowerCase())
  );
}

// GET /admin/status — check if current user is admin
app.get(
  "/admin/status",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    res.json({ isAdmin: isAdminUser(req) });
  },
);

// GET /pricing/models — public endpoint, returns all current model pricing
app.get("/pricing/models", async (_req, res: Response) => {
  try {
    const pricing = await getAllPricing(pool);
    res.json({ models: pricing, updated_at: new Date().toISOString() });
  } catch (error) {
    console.error("GET /pricing/models error:", error);
    res.status(500).json({ error: "Failed to fetch model pricing" });
  }
});

// =============================================================================
// STRIPE NATIVE INTEGRATION
// =============================================================================

// Check Stripe connection status (via native Replit integration)
app.get(
  "/stripe/status",
  ensureVisitor,
  async (_req: AuthRequest, res: Response) => {
    try {
      const stripe = await getUncachableStripeClient();
      const account = await stripe.accounts.retrieve();
      res.json({
        connected: true,
        account_id: account.id,
        account_name:
          (
            account as {
              business_profile?: { name?: string };
              display_name?: string;
            }
          ).business_profile?.name ||
          (account as { display_name?: string }).display_name ||
          account.id,
      });
    } catch (error) {
      console.error("Stripe status check error:", error);
      res.json({ connected: false, error: "Not connected" });
    }
  },
);

// =============================================================================
// STRIPE INTEGRATION (user-provided API key)
// =============================================================================

app.post(
  "/integrations/stripe/connect",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      const { api_key } = req.body;

      if (!api_key || typeof api_key !== "string") {
        return res.status(400).json({ error: "api_key is required" });
      }

      if (
        !api_key.startsWith("rk_live_") &&
        !api_key.startsWith("rk_test_") &&
        !api_key.startsWith("sk_live_") &&
        !api_key.startsWith("sk_test_")
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid Stripe API key format. Use a restricted key (rk_live_... or rk_test_...) or secret key (sk_live_... or sk_test_...).",
        });
      }

      let accountName = "";
      let accountId = "";
      try {
        const stripe = createStripeClientFromKey(api_key);
        const account = await stripe.accounts.retrieve();
        accountId = account.id;
        accountName =
          (account as any).business_profile?.name ||
          (account as any).display_name ||
          account.id;
      } catch {
        return res.status(400).json({
          success: false,
          message:
            "Invalid Stripe API key. Please check your key and try again.",
        });
      }

      const keyPrefix = api_key.substring(0, 12) + "...";
      const encryptedKey = encryptApiKey(api_key);

      await pool.query(
        `INSERT INTO integrations (user_id, provider, api_key_prefix, has_usage_access, connected_at, encrypted_api_key, stripe_account_id, stripe_account_name)
       VALUES ($1, 'stripe', $2, true, NOW(), $3, $4, $5)
       ON CONFLICT (user_id, provider)
       DO UPDATE SET api_key_prefix = $2, has_usage_access = true, connected_at = NOW(), encrypted_api_key = $3, stripe_account_id = $4, stripe_account_name = $5`,
        [visitorId, keyPrefix, encryptedKey, accountId, accountName],
      );

      let syncResult = { customers: 0, subscriptions: 0, plans: 0 };
      try {
        syncResult = await syncStripeDataForUser(pool, visitorId, api_key);
        await clearSampleData(pool, visitorId);
        await pool.query(
          "INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()",
          [visitorId, "user"],
        );
        convertReferralIfPending(visitorId);
      } catch (syncErr) {
        console.error(
          "Initial Stripe sync error (connection succeeded):",
          syncErr,
        );
      }

      trackBillingUsage(visitorId, "stripe_sync", "stripe_connected");

      res.json({
        success: true,
        message: "Stripe connected successfully",
        account_name: accountName,
        account_id: accountId,
        synced: syncResult,
      });
    } catch (err) {
      console.error("Stripe connect error:", err);
      res.status(500).json({ error: "Failed to connect Stripe" });
    }
  },
);

app.get(
  "/integrations/stripe/status",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT api_key_prefix, has_usage_access, connected_at, last_synced_at, stripe_account_id, stripe_account_name
       FROM integrations WHERE user_id = $1 AND provider = 'stripe'`,
        [req.visitorId],
      );

      if (result.rows.length === 0) {
        return res.json({ connected: false });
      }

      const row = result.rows[0];
      res.json({
        connected: true,
        api_key_prefix: row.api_key_prefix,
        account_id: row.stripe_account_id,
        account_name: row.stripe_account_name,
        connected_at: row.connected_at,
        last_synced_at: row.last_synced_at,
      });
    } catch (err) {
      console.error("Stripe status error:", err);
      res.status(500).json({ error: "Failed to check Stripe status" });
    }
  },
);

app.post(
  "/integrations/stripe/sync",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      const syncResult = await syncStripeDataForUser(pool, visitorId);

      await pool.query(
        `UPDATE integrations SET last_synced_at = NOW() WHERE user_id = $1 AND provider = 'stripe'`,
        [visitorId],
      );

      trackBillingUsage(visitorId, "stripe_sync", "stripe_data_synced");

      res.json({ success: true, synced: syncResult });
    } catch (err) {
      console.error("Stripe sync error:", err);
      res.status(500).json({ error: "Failed to sync Stripe data" });
    }
  },
);

app.post(
  "/integrations/stripe/disconnect",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      const { clear_data } = req.body;

      await pool.query(
        "DELETE FROM integrations WHERE user_id = $1 AND provider = $2",
        [visitorId, "stripe"],
      );

      if (clear_data) {
        await pool.query(
          "DELETE FROM observe_events WHERE user_id = $1 AND source = 'stripe'",
          [visitorId],
        );
        await pool.query("DELETE FROM subscriptions WHERE user_id = $1", [
          visitorId,
        ]);
        await pool.query("DELETE FROM customers WHERE user_id = $1", [
          visitorId,
        ]);
        await pool.query("DELETE FROM plans WHERE user_id = $1", [visitorId]);
      }

      res.json({
        success: true,
        message: clear_data
          ? "Stripe disconnected and data cleared"
          : "Stripe disconnected",
      });
    } catch (err) {
      console.error("Stripe disconnect error:", err);
      res.status(500).json({ error: "Failed to disconnect Stripe" });
    }
  },
);

// Sync data from Stripe into the user's session
const expensiveLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again in a minute" },
});

app.post(
  "/stripe/sync",
  ensureVisitor,
  expensiveLimiter,
  async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      const stripe = await getUncachableStripeClient();

      // Fetch all data from Stripe using auto-pagination
      const [
        stripeCustomersList,
        stripeSubscriptionsList,
        stripeProductsList,
        pricesList,
      ] = await Promise.all([
        stripe.customers
          .list({ limit: 100 })
          .autoPagingToArray({ limit: 10000 }),
        stripe.subscriptions
          .list({ limit: 100, status: "all" })
          .autoPagingToArray({ limit: 10000 }),
        stripe.products
          .list({ limit: 100, active: true })
          .autoPagingToArray({ limit: 10000 }),
        stripe.prices
          .list({ limit: 100, active: true })
          .autoPagingToArray({ limit: 10000 }),
      ]);
      const stripeCustomers = { data: stripeCustomersList };
      const stripeSubscriptions = { data: stripeSubscriptionsList };
      const stripeProducts = { data: stripeProductsList };
      const prices = pricesList;

      await client.query("BEGIN");

      // Clear existing revenue data
      await client.query("DELETE FROM subscriptions WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM customers WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query("DELETE FROM plans WHERE user_id = $1", [
        req.visitorId,
      ]);
      await client.query(
        "DELETE FROM observe_events WHERE user_id = $1 AND source = 'stripe'",
        [req.visitorId],
      );

      // Insert plans (from Stripe products + prices) — batched
      const planIds = new Set<string>();
      const planRows: {
        planId: string;
        name: string;
        amount: number;
        intervalMonths: number;
      }[] = [];
      for (const price of prices) {
        const planId = price.id;
        if (planIds.has(planId)) continue;
        planIds.add(planId);
        const product = stripeProducts.data.find(
          (p) =>
            p.id ===
            (typeof price.product === "string"
              ? price.product
              : price.product?.id),
        );
        const name = product?.name || planId;
        const amount = (price.unit_amount || 0) / 100;
        const intervalMonths = price.recurring?.interval === "year" ? 12 : 1;
        planRows.push({ planId, name, amount, intervalMonths });
      }
      const batchSize = 500;
      for (let i = 0; i < planRows.length; i += batchSize) {
        const batch = planRows.slice(i, i + batchSize);
        const values: unknown[] = [];
        const placeholders: string[] = [];
        let idx = 1;
        for (const p of batch) {
          placeholders.push(
            `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
          );
          values.push(
            req.visitorId,
            p.planId,
            p.name,
            p.amount,
            p.intervalMonths,
            "recurring",
          );
        }
        await client.query(
          `INSERT INTO plans (user_id, plan_id, name, price_amount, interval_months, billing_model) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
          values,
        );
      }

      // Insert customers — batched
      const validCustomers = stripeCustomers.data.filter(
        (c) => typeof c !== "string",
      );
      for (let i = 0; i < validCustomers.length; i += batchSize) {
        const batch = validCustomers.slice(i, i + batchSize);
        const values: unknown[] = [];
        const placeholders: string[] = [];
        let idx = 1;
        for (const customer of batch) {
          placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`);
          values.push(
            req.visitorId,
            customer.id,
            customer.email || customer.id,
            customer.email || null,
          );
        }
        await client.query(
          `INSERT INTO customers (user_id, customer_id, name, email) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`,
          values,
        );
      }

      // Insert subscriptions — batched
      let syncedSubs = 0;
      const subRows: {
        id: string;
        customerId: string;
        priceId: string;
        isActive: boolean;
        mrr: number;
      }[] = [];
      for (const sub of stripeSubscriptions.data) {
        const priceId = sub.items?.data?.[0]?.price?.id;
        if (!priceId) continue;
        const unitAmount = sub.items.data[0].price.unit_amount || 0;
        const mrr =
          sub.items.data[0].price.recurring?.interval === "year"
            ? Math.round(unitAmount / 12 / 100)
            : Math.round(unitAmount / 100);
        subRows.push({
          id: sub.id,
          customerId: sub.customer as string,
          priceId,
          isActive: sub.status === "active",
          mrr,
        });
        syncedSubs++;
      }
      for (let i = 0; i < subRows.length; i += batchSize) {
        const batch = subRows.slice(i, i + batchSize);
        const subValues: unknown[] = [];
        const subPlaceholders: string[] = [];
        const eventValues: unknown[] = [];
        const eventPlaceholders: string[] = [];
        let subIdx = 1;
        let eventIdx = 1;
        for (const s of batch) {
          subPlaceholders.push(
            `($${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++}, $${subIdx++})`,
          );
          subValues.push(
            req.visitorId,
            s.id,
            s.customerId,
            s.priceId,
            s.isActive,
            s.mrr,
          );
          eventPlaceholders.push(
            `($${eventIdx++}, $${eventIdx++}, 'subscription', 'revenue', NOW(), $${eventIdx++}, 'stripe', 'monthly_aggregate')`,
          );
          eventValues.push(req.visitorId, s.customerId, s.mrr);
        }
        await client.query(
          `INSERT INTO subscriptions (user_id, subscription_id, customer_id, plan_id, is_active, mrr_override) VALUES ${subPlaceholders.join(", ")} ON CONFLICT DO NOTHING`,
          subValues,
        );
        await client.query(
          `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, revenue_amount, source, granularity) VALUES ${eventPlaceholders.join(", ")}`,
          eventValues,
        );
      }

      // clearSampleData not needed here — full DELETE at lines above already clears all existing data
      await client.query(
        "INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()",
        [req.visitorId, "user"],
      );

      await client.query("COMMIT");
      convertReferralIfPending(req.visitorId!);

      // Track Stripe sync usage in billing
      trackBillingUsage(req.visitorId!, "stripe_sync", "stripe_data_synced");

      res.json({
        success: true,
        synced: {
          customers: stripeCustomers.data.length,
          subscriptions: syncedSubs,
          plans: planIds.size,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK");
      console.error("Stripe sync error:", error);
      res.status(500).json({ error: "Stripe sync failed" });
    } finally {
      client.release();
    }
  },
);

// =============================================================================
// FEATURE ECONOMICS ENDPOINTS
// =============================================================================

function coerceEventRow(row: Record<string, unknown>) {
  return {
    ...row,
    cost_amount:
      row.cost_amount != null ? parseFloat(row.cost_amount as string) : null,
    revenue_amount:
      row.revenue_amount != null
        ? parseFloat(row.revenue_amount as string)
        : null,
    usage_units:
      row.usage_units != null ? parseFloat(row.usage_units as string) : null,
  };
}

// GET /events — paginated list of observe_events
app.get("/events", ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = parseInt(req.query.offset as string) || 0;
    const featureKey = req.query.feature_key as string | undefined;
    const customerId = req.query.customer_id as string | undefined;
    const model = req.query.model as string | undefined;
    const source = req.query.source as string | undefined;
    const dateFrom = req.query.date_from as string | undefined;
    const dateTo = req.query.date_to as string | undefined;

    let where = "WHERE oe.user_id = $1";
    const params: unknown[] = [req.visitorId];
    let paramIdx = 2;

    if (featureKey) {
      where += ` AND oe.feature_key = $${paramIdx++}`;
      params.push(featureKey);
    }
    if (customerId) {
      where += ` AND oe.customer_id = $${paramIdx++}`;
      params.push(customerId);
    }
    if (model) {
      where += ` AND oe.model = $${paramIdx++}`;
      params.push(model);
    }
    if (source) {
      where += ` AND oe.source = $${paramIdx++}`;
      params.push(source);
    }
    if (dateFrom) {
      where += ` AND oe.timestamp >= $${paramIdx++}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND oe.timestamp <= $${paramIdx++}`;
      params.push(dateTo);
    }

    const eventsResult = await pool.query(
      `SELECT oe.*, c.name as customer_name
       FROM observe_events oe
       LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
       ${where}
       ORDER BY oe.timestamp DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      [...params, limit, offset],
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM observe_events oe ${where}`,
      params,
    );

    res.json({
      events: eventsResult.rows.map(coerceEventRow),
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (error) {
    console.error("Get events error:", error);
    res.status(500).json({ error: "Failed to get events" });
  }
});

// Source priority: proxy/sdk data wins over csv for the same (model, customer, feature, day).
// CSV rows are excluded when a higher-priority source already covers that slot.
// $1 = user_id, excludes sample data unless user is in sample mode
const SOURCE_PRIORITY_CTE = `
  WITH ranked AS (
    SELECT oe.*,
      ROW_NUMBER() OVER (
        PARTITION BY oe.user_id, COALESCE(oe.model,''), COALESCE(oe.customer_id,''), COALESCE(oe.feature_key,''), date_trunc('day', oe.timestamp)
        ORDER BY CASE oe.source WHEN 'proxy' THEN 1 WHEN 'sdk' THEN 2 WHEN 'csv' THEN 3 WHEN 'sample' THEN 4 ELSE 5 END
      ) AS _src_rank
    FROM observe_events oe
    LEFT JOIN user_data_status uds ON uds.user_id = oe.user_id
    WHERE oe.user_id = $1
      AND (oe.source != 'sample' OR COALESCE(uds.data_mode, 'none') = 'sample')
  ),
  deduped AS (SELECT * FROM ranked WHERE _src_rank = 1)
`;

// GET /events/by-feature — aggregate events grouped by feature_key
app.get(
  "/events/by-feature",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await pool.query(
        `${SOURCE_PRIORITY_CTE}
       SELECT feature_key, COUNT(*) as event_count,
         COALESCE(SUM(cost_amount), 0) as total_cost,
         COALESCE(SUM(revenue_amount), 0) as total_revenue,
         COALESCE(SUM(usage_units), 0) as total_usage,
         MAX(timestamp) as last_seen
       FROM deduped WHERE feature_key IS NOT NULL
       GROUP BY feature_key ORDER BY total_cost DESC`,
        [req.visitorId],
      );
      res.json(
        result.rows.map((row) => {
          const cost = parseFloat(row.total_cost) || 0;
          const revenue = parseFloat(row.total_revenue) || 0;
          return {
            feature_key: row.feature_key,
            event_count: parseInt(row.event_count),
            total_cost: cost,
            total_revenue: revenue,
            total_usage: parseFloat(row.total_usage) || 0,
            margin_pct:
              revenue > 0
                ? Math.round(((revenue - cost) / revenue) * 100)
                : null,
            last_seen: row.last_seen,
          };
        }),
      );
    } catch (error) {
      console.error("Get events/by-feature error:", error);
      res.status(500).json({ error: "Failed to get feature aggregations" });
    }
  },
);

// GET /events/by-customer — aggregate events grouped by customer_id
app.get(
  "/events/by-customer",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await pool.query(
        `${SOURCE_PRIORITY_CTE}
       SELECT d.customer_id, c.name as customer_name, COUNT(*) as event_count,
         COALESCE(SUM(d.cost_amount), 0) as total_cost,
         COALESCE(SUM(d.revenue_amount), 0) as total_revenue,
         MAX(d.timestamp) as last_seen
       FROM deduped d
       LEFT JOIN customers c ON d.user_id = c.user_id AND d.customer_id = c.customer_id
       GROUP BY d.customer_id, c.name ORDER BY total_cost DESC`,
        [req.visitorId],
      );
      res.json(
        result.rows.map((row) => {
          const cost = parseFloat(row.total_cost) || 0;
          const revenue = parseFloat(row.total_revenue) || 0;
          return {
            customer_id: row.customer_id,
            customer_name: row.customer_name || row.customer_id,
            event_count: parseInt(row.event_count),
            total_cost: cost,
            total_revenue: revenue,
            margin_pct:
              revenue > 0
                ? Math.round(((revenue - cost) / revenue) * 100)
                : null,
            last_seen: row.last_seen,
          };
        }),
      );
    } catch (error) {
      console.error("Get events/by-customer error:", error);
      res.status(500).json({ error: "Failed to get customer aggregations" });
    }
  },
);

// GET /events/by-model — aggregate events grouped by model
app.get(
  "/events/by-model",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await pool.query(
        `${SOURCE_PRIORITY_CTE}
       SELECT model, model_provider, COUNT(*) as event_count,
         COALESCE(SUM(cost_amount), 0) as total_cost,
         COALESCE(SUM(revenue_amount), 0) as total_revenue,
         COALESCE(SUM(usage_units), 0) as total_usage,
         MAX(timestamp) as last_seen
       FROM deduped WHERE model IS NOT NULL
       GROUP BY model, model_provider ORDER BY total_cost DESC`,
        [req.visitorId],
      );
      res.json(
        result.rows.map((row) => {
          const cost = parseFloat(row.total_cost) || 0;
          const revenue = parseFloat(row.total_revenue) || 0;
          return {
            model: row.model,
            model_provider: row.model_provider,
            event_count: parseInt(row.event_count),
            total_cost: cost,
            total_revenue: revenue,
            total_usage: parseFloat(row.total_usage) || 0,
            margin_pct:
              revenue > 0
                ? Math.round(((revenue - cost) / revenue) * 100)
                : null,
            last_seen: row.last_seen,
          };
        }),
      );
    } catch (error) {
      console.error("Get events/by-model error:", error);
      res.status(500).json({ error: "Failed to get model aggregations" });
    }
  },
);

// GET /events/:id — single event detail with request/response bodies
app.get(
  "/events/:id",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const eventId = parseInt(req.params.id);
      if (isNaN(eventId))
        return res.status(400).json({ error: "Invalid event ID" });
      const result = await pool.query(
        `SELECT oe.*, c.name as customer_name
       FROM observe_events oe
       LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
       WHERE oe.id = $1 AND oe.user_id = $2`,
        [eventId, req.visitorId],
      );
      if (result.rows.length === 0)
        return res.status(404).json({ error: "Event not found" });
      res.json(coerceEventRow(result.rows[0]));
    } catch (error) {
      console.error("GET /events/:id error:", error);
      res.status(500).json({ error: "Failed to get event detail" });
    }
  },
);

// =============================================================================
// ANALYTICS — PER-CUSTOMER P&L & MARGIN ALERTS
// =============================================================================

// GET /analytics/customer-pnl — per-customer profit & loss, sorted by margin ascending (worst first)
app.get(
  "/analytics/customer-pnl",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.visitorId!;

      const result = await pool.query(
        `SELECT oe.customer_id,
              COALESCE(c.name, oe.customer_id) as customer_name,
              COUNT(*) as event_count,
              COALESCE(SUM(oe.revenue_amount), 0) as total_revenue,
              COALESCE(SUM(oe.cost_amount), 0) as total_cost
       FROM observe_events oe
       LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
       WHERE oe.user_id = $1 AND oe.customer_id IS NOT NULL
       GROUP BY oe.customer_id, c.name
       ORDER BY total_revenue - total_cost ASC`,
        [userId],
      );

      const subResult = await pool.query(
        `SELECT s.customer_id, COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as sub_revenue
       FROM subscriptions s
       LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id
       WHERE s.user_id = $1 AND s.is_active = true
       GROUP BY s.customer_id`,
        [userId],
      );
      const subRevenueMap: Record<string, number> = {};
      for (const row of subResult.rows) {
        subRevenueMap[row.customer_id] = parseFloat(row.sub_revenue) || 0;
      }

      const topFeatureResult = await pool.query(
        `SELECT DISTINCT ON (customer_id) customer_id, feature_key, SUM(cost_amount) as feat_cost
       FROM observe_events
       WHERE user_id = $1 AND customer_id IS NOT NULL AND feature_key IS NOT NULL
       GROUP BY customer_id, feature_key
       ORDER BY customer_id, feat_cost DESC`,
        [userId],
      );
      const topFeatureMap: Record<string, string> = {};
      for (const row of topFeatureResult.rows) {
        topFeatureMap[row.customer_id] = row.feature_key;
      }

      const customers = result.rows.map((row) => {
        const eventRevenue = parseFloat(row.total_revenue) || 0;
        const subRevenue = subRevenueMap[row.customer_id] || 0;
        const totalRevenue = eventRevenue + subRevenue;
        const totalCost = parseFloat(row.total_cost) || 0;
        const marginPct =
          totalRevenue > 0
            ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100)
            : totalCost > 0
              ? -100
              : null;

        return {
          customer_id: row.customer_id,
          customer_name: row.customer_name,
          total_revenue: totalRevenue,
          total_cost: totalCost,
          margin_pct: marginPct,
          event_count: parseInt(row.event_count),
          unprofitable: marginPct !== null && marginPct < 0,
          top_cost_feature: topFeatureMap[row.customer_id] || null,
        };
      });

      customers.sort(
        (a, b) => (a.margin_pct ?? -Infinity) - (b.margin_pct ?? -Infinity),
      );

      res.json({ customers });
    } catch (error) {
      console.error("GET /analytics/customer-pnl error:", error);
      res.status(500).json({ error: "Failed to get customer P&L" });
    }
  },
);

// GET /analytics/margin-alerts — scan for margin alert conditions
app.get(
  "/analytics/margin-alerts",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.visitorId!;
      const alerts: Array<{
        type: string;
        severity: string;
        title: string;
        description: string;
        entity_id: string | null;
        metric_value: number | null;
      }> = [];

      // 1. Customers with negative margin
      const custResult = await pool.query(
        `SELECT oe.customer_id, COALESCE(c.name, oe.customer_id) as customer_name,
              COALESCE(SUM(oe.revenue_amount), 0) as total_revenue,
              COALESCE(SUM(oe.cost_amount), 0) as total_cost
       FROM observe_events oe
       LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
       WHERE oe.user_id = $1 AND oe.customer_id IS NOT NULL
       GROUP BY oe.customer_id, c.name
       HAVING COALESCE(SUM(oe.cost_amount), 0) > COALESCE(SUM(oe.revenue_amount), 0)`,
        [userId],
      );
      for (const row of custResult.rows) {
        const rev = parseFloat(row.total_revenue) || 0;
        const cost = parseFloat(row.total_cost) || 0;
        const margin = rev > 0 ? Math.round(((rev - cost) / rev) * 100) : -100;
        alerts.push({
          type: "negative_margin_customer",
          severity: "critical",
          title: `${row.customer_name} is unprofitable`,
          description: `Cost $${cost.toFixed(2)} exceeds revenue $${rev.toFixed(2)} (margin: ${margin}%)`,
          entity_id: row.customer_id,
          metric_value: margin,
        });
      }

      // 2. Features where cost > revenue
      const featResult = await pool.query(
        `SELECT feature_key,
              COALESCE(SUM(cost_amount), 0) as total_cost,
              COALESCE(SUM(revenue_amount), 0) as total_revenue
       FROM observe_events
       WHERE user_id = $1 AND feature_key IS NOT NULL
       GROUP BY feature_key
       HAVING COALESCE(SUM(cost_amount), 0) > COALESCE(SUM(revenue_amount), 0)`,
        [userId],
      );
      for (const row of featResult.rows) {
        const cost = parseFloat(row.total_cost) || 0;
        const rev = parseFloat(row.total_revenue) || 0;
        alerts.push({
          type: "unprofitable_feature",
          severity: "warning",
          title: `Feature "${row.feature_key}" is losing money`,
          description: `Cost $${cost.toFixed(2)} exceeds revenue $${rev.toFixed(2)}`,
          entity_id: row.feature_key,
          metric_value: rev > 0 ? Math.round(((rev - cost) / rev) * 100) : -100,
        });
      }

      // 3. Models where cost increased >20% vs previous period (current 30d vs prior 30d)
      const modelResult = await pool.query(
        `SELECT model,
              COALESCE(SUM(CASE WHEN timestamp >= NOW() - INTERVAL '30 days' THEN cost_amount ELSE 0 END), 0) as current_cost,
              COALESCE(SUM(CASE WHEN timestamp >= NOW() - INTERVAL '60 days' AND timestamp < NOW() - INTERVAL '30 days' THEN cost_amount ELSE 0 END), 0) as prior_cost
       FROM observe_events
       WHERE user_id = $1 AND model IS NOT NULL AND timestamp >= NOW() - INTERVAL '60 days'
       GROUP BY model
       HAVING COALESCE(SUM(CASE WHEN timestamp >= NOW() - INTERVAL '60 days' AND timestamp < NOW() - INTERVAL '30 days' THEN cost_amount ELSE 0 END), 0) > 0`,
        [userId],
      );
      for (const row of modelResult.rows) {
        const current = parseFloat(row.current_cost) || 0;
        const prior = parseFloat(row.prior_cost) || 0;
        if (prior > 0 && current > prior * 1.2) {
          const pctIncrease = Math.round(((current - prior) / prior) * 100);
          alerts.push({
            type: "model_cost_spike",
            severity: "warning",
            title: `Model "${row.model}" cost up ${pctIncrease}%`,
            description: `Cost increased from $${prior.toFixed(2)} to $${current.toFixed(2)} vs previous 30 days`,
            entity_id: row.model,
            metric_value: pctIncrease,
          });
        }
      }

      // 4. Customers spending >50% of subscription on AI costs
      const subSpendResult = await pool.query(
        `SELECT oe.customer_id, COALESCE(c.name, oe.customer_id) as customer_name,
              COALESCE(SUM(oe.cost_amount), 0) as total_cost
       FROM observe_events oe
       LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
       WHERE oe.user_id = $1 AND oe.customer_id IS NOT NULL
       GROUP BY oe.customer_id, c.name`,
        [userId],
      );
      const subRevMap: Record<string, number> = {};
      const subRows = await pool.query(
        `SELECT s.customer_id, COALESCE(SUM(COALESCE(s.mrr_override, p.price_amount)), 0) as sub_revenue
       FROM subscriptions s
       LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id
       WHERE s.user_id = $1 AND s.is_active = true
       GROUP BY s.customer_id`,
        [userId],
      );
      for (const row of subRows.rows) {
        subRevMap[row.customer_id] = parseFloat(row.sub_revenue) || 0;
      }
      for (const row of subSpendResult.rows) {
        const cost = parseFloat(row.total_cost) || 0;
        const subRev = subRevMap[row.customer_id] || 0;
        if (subRev > 0 && cost > subRev * 0.5) {
          const pct = Math.round((cost / subRev) * 100);
          alerts.push({
            type: "high_cost_ratio",
            severity: pct >= 100 ? "critical" : "warning",
            title: `${row.customer_name} AI costs are ${pct}% of subscription`,
            description: `AI costs $${cost.toFixed(2)} vs subscription revenue $${subRev.toFixed(2)}`,
            entity_id: row.customer_id,
            metric_value: pct,
          });
        }
      }

      // Sort: critical first, then warning
      alerts.sort(
        (a, b) =>
          (a.severity === "critical" ? 0 : 1) -
          (b.severity === "critical" ? 0 : 1),
      );

      res.json({ alerts });
    } catch (error) {
      console.error("GET /analytics/margin-alerts error:", error);
      res.status(500).json({ error: "Failed to get margin alerts" });
    }
  },
);

// =============================================================================
// SDK API KEY MANAGEMENT
// =============================================================================

// POST /sdk-keys — Generate a new SDK API key
app.post(
  "/sdk-keys",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.visitorId!;
      const name =
        typeof req.body?.name === "string"
          ? req.body.name.trim().slice(0, 100)
          : null;

      const rawKey = "sk_live_" + crypto.randomBytes(16).toString("hex");
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.slice(0, 12);
      const encryptedKey = encryptApiKey(rawKey);

      await pool.query(
        "INSERT INTO sdk_api_keys (user_id, key_hash, key_prefix, encrypted_key, name) VALUES ($1, $2, $3, $4, $5)",
        [userId, keyHash, keyPrefix, encryptedKey, name],
      );

      res.json({ key: rawKey, prefix: keyPrefix, name });
    } catch (error) {
      console.error("POST /sdk-keys error:", error);
      res.status(500).json({ error: "Failed to create API key" });
    }
  },
);

// GET /sdk-keys — List all active SDK API keys (includes full key if encrypted_key exists)
app.get("/sdk-keys", ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.visitorId!;
    const result = await pool.query(
      "SELECT id, key_prefix, encrypted_key, name, created_at, last_used_at FROM sdk_api_keys WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC",
      [userId],
    );
    const keys = result.rows.map((row) => ({
      id: row.id,
      key_prefix: row.key_prefix,
      full_key: row.encrypted_key ? decryptApiKey(row.encrypted_key) : null,
      name: row.name,
      created_at: row.created_at,
      last_used_at: row.last_used_at,
    }));
    res.json(keys);
  } catch (error) {
    console.error("GET /sdk-keys error:", error);
    res.status(500).json({ error: "Failed to list API keys" });
  }
});

// POST /sdk-keys/:id/reset — Revoke old key and generate a new one with the same name
app.post(
  "/sdk-keys/:id/reset",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.visitorId!;
      const keyId = parseInt(req.params.id, 10);
      if (isNaN(keyId)) {
        return res.status(400).json({ error: "Invalid key ID" });
      }

      // Get the old key's name
      const old = await pool.query(
        "SELECT name FROM sdk_api_keys WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
        [keyId, userId],
      );
      if (old.rows.length === 0) {
        return res.status(404).json({ error: "Key not found" });
      }
      const name = old.rows[0].name;

      // Revoke old key
      await pool.query(
        "UPDATE sdk_api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2",
        [keyId, userId],
      );

      // Generate new key
      const rawKey = "sk_live_" + crypto.randomBytes(16).toString("hex");
      const keyHash = crypto.createHash("sha256").update(rawKey).digest("hex");
      const keyPrefix = rawKey.slice(0, 12);
      const encryptedKey = encryptApiKey(rawKey);

      const result = await pool.query(
        "INSERT INTO sdk_api_keys (user_id, key_hash, key_prefix, encrypted_key, name) VALUES ($1, $2, $3, $4, $5) RETURNING id",
        [userId, keyHash, keyPrefix, encryptedKey, name],
      );

      res.json({ id: result.rows[0].id, key: rawKey, prefix: keyPrefix, name });
    } catch (error) {
      console.error("POST /sdk-keys/:id/reset error:", error);
      res.status(500).json({ error: "Failed to reset API key" });
    }
  },
);

// DELETE /sdk-keys/:id — Revoke an SDK API key (soft delete)
app.delete(
  "/sdk-keys/:id",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.visitorId!;
      const keyId = parseInt(req.params.id, 10);
      if (isNaN(keyId)) {
        return res.status(400).json({ error: "Invalid key ID" });
      }

      const result = await pool.query(
        "UPDATE sdk_api_keys SET revoked_at = NOW() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL",
        [keyId, userId],
      );

      if (result.rowCount === 0) {
        return res.status(404).json({ error: "Key not found" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("DELETE /sdk-keys/:id error:", error);
      res.status(500).json({ error: "Failed to revoke API key" });
    }
  },
);

// POST /events/ingest — SDK batch event ingestion
app.post("/events/ingest", apiLimiter, async (req: Request, res: Response) => {
  try {
    let userId: string | null = null;

    // Auth: Bearer token first, then session fallback
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.slice(7).trim();
      if (token) {
        const keyHash = crypto.createHash("sha256").update(token).digest("hex");
        const keyResult = await pool.query(
          "SELECT user_id FROM sdk_api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
          [keyHash],
        );
        if (keyResult.rows.length > 0) {
          userId = keyResult.rows[0].user_id;
          // Update last_used_at
          pool
            .query(
              "UPDATE sdk_api_keys SET last_used_at = NOW() WHERE key_hash = $1",
              [keyHash],
            )
            .catch((err) =>
              console.error("Failed to update sdk_api_keys last_used_at:", err),
            );
        }
      }
    }

    // Fallback to session-based auth
    if (!userId) {
      const authReq = req as AuthRequest;
      if (authReq.session?.visitorId) {
        userId = authReq.session.visitorId;
      }
    }

    if (!userId) {
      return res.status(401).json({
        error:
          "Authentication required. Provide a Bearer token or use a session.",
      });
    }

    const { events } = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        error: 'Request body must contain a non-empty "events" array.',
      });
    }
    if (events.length > 1000) {
      return res
        .status(400)
        .json({ error: "Batch size exceeds maximum of 1000 events." });
    }

    const errors: Array<{ index: number; error: string }> = [];
    const validEvents: Array<{
      eventName: string;
      customerReferenceId: string;
      featureKey: string;
      timestamp?: string;
      costAmount?: number;
      costUnit?: string;
      revenueAmount?: number;
      usageUnits?: number;
      model?: string;
      modelProvider?: string;
      inputTokens?: number;
      outputTokens?: number;
      properties?: Record<string, unknown>;
      idempotencyKey?: string;
    }> = [];

    for (let i = 0; i < events.length; i++) {
      const evt = events[i];
      const missing: string[] = [];
      if (!evt.eventName) missing.push("eventName");
      if (!evt.customerReferenceId) missing.push("customerReferenceId");
      if (!evt.featureKey) missing.push("featureKey");
      if (missing.length > 0) {
        errors.push({
          index: i,
          error: `Missing required fields: ${missing.join(", ")}`,
        });
        continue;
      }
      validEvents.push(evt);
    }

    if (validEvents.length === 0) {
      return res.json({ accepted: 0, rejected: errors.length, errors });
    }

    // Enrich model_provider from model name if missing
    function inferModelProvider(model: string | undefined): string | null {
      if (!model) return null;
      const m = model.toLowerCase();
      if (m.startsWith("claude-")) return "anthropic";
      if (
        m.startsWith("gpt-") ||
        m.startsWith("o1") ||
        m.startsWith("o3") ||
        m.startsWith("o4") ||
        m.startsWith("text-embedding-")
      )
        return "openai";
      if (m.startsWith("dall-e-")) return "openai";
      if (m.startsWith("gemini-")) return "google";
      if (m.startsWith("mistral-") || m.startsWith("codestral"))
        return "mistral";
      if (m.startsWith("llama-")) return "meta";
      return null;
    }

    // Auto-enrich revenue from Stripe: look up MRR for customers in this batch
    const customerIds = [
      ...new Set(validEvents.map((e) => e.customerReferenceId)),
    ];
    const mrrByCustomer = new Map<string, number>();
    if (customerIds.length > 0) {
      try {
        const mrrResult = await pool.query(
          `SELECT s.customer_id, SUM(s.mrr_override) as mrr
           FROM subscriptions s
           WHERE s.user_id = $1 AND s.is_active = true AND s.customer_id = ANY($2)
           GROUP BY s.customer_id`,
          [userId, customerIds],
        );
        for (const row of mrrResult.rows) {
          // MRR / 30 = daily revenue share per event
          mrrByCustomer.set(row.customer_id, parseFloat(row.mrr) / 30);
        }
      } catch {
        // Non-critical: if lookup fails, just skip enrichment
      }
    }

    // Build batch insert
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let paramIdx = 1;

    for (const evt of validEvents) {
      const provider = evt.modelProvider || inferModelProvider(evt.model);
      const ts = evt.timestamp || new Date().toISOString();

      // Auto-calculate cost from model + tokens if costAmount not provided
      const cost =
        evt.costAmount ??
        (await calcCostFromDb(
          pool,
          evt.model,
          evt.inputTokens,
          evt.outputTokens,
        ));

      // Auto-enrich revenue from Stripe MRR if not provided
      const revenue =
        evt.revenueAmount ?? mrrByCustomer.get(evt.customerReferenceId) ?? 0;

      placeholders.push(
        `($${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, $${paramIdx++}, 'sdk', 'event', false, $${paramIdx++})`,
      );
      values.push(
        userId,
        evt.customerReferenceId,
        evt.featureKey,
        evt.eventName,
        ts,
        cost,
        evt.costUnit ?? "usd",
        revenue,
        evt.usageUnits ?? (evt.inputTokens || 0) + (evt.outputTokens || 0),
        evt.model ?? null,
        provider,
        evt.idempotencyKey ?? null,
      );
    }

    const insertQuery = `
      INSERT INTO observe_events (
        user_id, customer_id, feature_key, event_name, timestamp,
        cost_amount, cost_unit, revenue_amount, usage_units,
        model, model_provider, source, granularity, is_inferred, idempotency_key
      ) VALUES ${placeholders.join(", ")}
      ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    `;

    const result = await pool.query(insertQuery, values);
    const inserted = result.rowCount ?? 0;
    const deduped = validEvents.length - inserted;

    res.json({
      accepted: inserted,
      rejected: errors.length + deduped,
      errors,
    });

    // Auto-trigger inference profile learning in the background (fire-and-forget)
    if (inserted > 0) {
      computeInferenceProfiles(userId).catch((err) =>
        console.error("Auto inference profile update failed:", err),
      );
      // Check alert thresholds
      checkAlerts(pool, userId).catch((err) =>
        console.error("checkAlerts error (ingest):", err),
      );
    }
  } catch (error) {
    console.error("POST /events/ingest error:", error);
    res.status(500).json({ error: "Failed to ingest events" });
  }
});

// GET /features — aggregated stats per feature_key
app.get("/features", ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT
         feature_key,
         COUNT(*) as event_count,
         COUNT(DISTINCT customer_id) as customer_count,
         COALESCE(SUM(cost_amount), 0) as total_cost,
         COALESCE(SUM(revenue_amount), 0) as total_revenue,
         COALESCE(SUM(usage_units), 0) as total_usage,
         COALESCE(AVG(cost_amount), 0) as avg_cost_per_event,
         COALESCE(AVG(revenue_amount), 0) as avg_revenue_per_event,
         MAX(timestamp) as last_seen
       FROM observe_events
       WHERE user_id = $1 AND feature_key IS NOT NULL
       GROUP BY feature_key
       ORDER BY total_cost DESC`,
      [req.visitorId],
    );

    const features = result.rows.map((row) => {
      const cost = parseFloat(row.total_cost) || 0;
      const revenue = parseFloat(row.total_revenue) || 0;
      const margin =
        revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null;
      return {
        feature_key: row.feature_key,
        event_count: parseInt(row.event_count),
        customer_count: parseInt(row.customer_count),
        total_cost: cost,
        total_revenue: revenue,
        total_usage: parseFloat(row.total_usage) || 0,
        avg_cost_per_event: parseFloat(row.avg_cost_per_event) || 0,
        avg_revenue_per_event: parseFloat(row.avg_revenue_per_event) || 0,
        margin_pct: margin,
        last_seen: row.last_seen,
      };
    });

    res.json(features);
  } catch (error) {
    console.error("Get features error:", error);
    res.status(500).json({ error: "Failed to get features" });
  }
});

// GET /features/:key — detail for a single feature
app.get(
  "/features/:key",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const { key } = req.params;

      const [summaryRes, eventsRes, customerRes, modelRes, timeseriesRes] =
        await Promise.all([
          pool.query(
            `SELECT feature_key, COUNT(*) as event_count, COUNT(DISTINCT customer_id) as customer_count,
           COALESCE(SUM(cost_amount), 0) as total_cost, COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage, MAX(timestamp) as last_seen
         FROM observe_events WHERE user_id = $1 AND feature_key = $2
         GROUP BY feature_key`,
            [req.visitorId, key],
          ),
          pool.query(
            `SELECT oe.*, c.name as customer_name FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1 AND oe.feature_key = $2 ORDER BY oe.timestamp DESC LIMIT 50`,
            [req.visitorId, key],
          ),
          pool.query(
            `SELECT oe.customer_id, c.name as customer_name,
           COUNT(*) as event_count, COALESCE(SUM(oe.cost_amount), 0) as total_cost,
           COALESCE(SUM(oe.revenue_amount), 0) as total_revenue
         FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1 AND oe.feature_key = $2
         GROUP BY oe.customer_id, c.name ORDER BY total_cost DESC`,
            [req.visitorId, key],
          ),
          pool.query(
            `SELECT model, model_provider, COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost, COALESCE(SUM(revenue_amount), 0) as total_revenue
         FROM observe_events WHERE user_id = $1 AND feature_key = $2 AND model IS NOT NULL
         GROUP BY model, model_provider ORDER BY total_cost DESC`,
            [req.visitorId, key],
          ),
          pool.query(
            `SELECT DATE_TRUNC('month', timestamp) as month,
           COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage
         FROM observe_events WHERE user_id = $1 AND feature_key = $2
         GROUP BY month ORDER BY month ASC`,
            [req.visitorId, key],
          ),
        ]);

      const s = summaryRes.rows[0];
      if (!s || !s.feature_key) {
        return res.status(404).json({ error: "Feature not found" });
      }

      const cost = parseFloat(s.total_cost) || 0;
      const revenue = parseFloat(s.total_revenue) || 0;
      const margin =
        revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null;

      res.json({
        feature_key: s.feature_key,
        event_count: parseInt(s.event_count),
        customer_count: parseInt(s.customer_count),
        total_cost: cost,
        total_revenue: revenue,
        total_usage: parseFloat(s.total_usage) || 0,
        margin_pct: margin,
        last_seen: s.last_seen,
        recent_events: eventsRes.rows.map(coerceEventRow),
        by_customer: customerRes.rows.map(
          (r: {
            customer_id: string;
            customer_name: string;
            event_count: string;
            total_cost: string;
            total_revenue: string;
          }) => ({
            customer_id: r.customer_id,
            customer_name: r.customer_name,
            event_count: parseInt(r.event_count),
            total_cost: parseFloat(r.total_cost) || 0,
            total_revenue: parseFloat(r.total_revenue) || 0,
          }),
        ),
        by_model: modelRes.rows.map(
          (r: {
            model: string;
            model_provider: string;
            event_count: string;
            total_cost: string;
            total_revenue: string;
          }) => ({
            model: r.model,
            model_provider: r.model_provider,
            event_count: parseInt(r.event_count),
            total_cost: parseFloat(r.total_cost) || 0,
            total_revenue: parseFloat(r.total_revenue) || 0,
          }),
        ),
        timeseries: timeseriesRes.rows.map(
          (r: {
            month: string;
            event_count: string;
            total_cost: string;
            total_revenue: string;
            total_usage: string;
          }) => ({
            month: r.month,
            event_count: parseInt(r.event_count),
            total_cost: parseFloat(r.total_cost) || 0,
            total_revenue: parseFloat(r.total_revenue) || 0,
            total_usage: parseFloat(r.total_usage) || 0,
          }),
        ),
      });
    } catch (error) {
      console.error("Get feature detail error:", error);
      res.status(500).json({ error: "Failed to get feature detail" });
    }
  },
);

// GET /models — aggregated stats per model
app.get("/models", ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT model, model_provider, COUNT(*) as event_count,
         COUNT(DISTINCT customer_id) as customer_count, COUNT(DISTINCT feature_key) as feature_count,
         COALESCE(SUM(cost_amount), 0) as total_cost, COALESCE(SUM(revenue_amount), 0) as total_revenue,
         COALESCE(SUM(usage_units), 0) as total_usage, COALESCE(AVG(cost_amount), 0) as avg_cost_per_event,
         MAX(timestamp) as last_seen
       FROM observe_events WHERE user_id = $1 AND model IS NOT NULL
       GROUP BY model, model_provider ORDER BY total_cost DESC`,
      [req.visitorId],
    );

    res.json(
      result.rows.map((row) => {
        const cost = parseFloat(row.total_cost) || 0;
        const revenue = parseFloat(row.total_revenue) || 0;
        return {
          model: row.model,
          model_provider: row.model_provider,
          event_count: parseInt(row.event_count),
          customer_count: parseInt(row.customer_count),
          feature_count: parseInt(row.feature_count),
          total_cost: cost,
          total_revenue: revenue,
          total_usage: parseFloat(row.total_usage) || 0,
          avg_cost_per_event: parseFloat(row.avg_cost_per_event) || 0,
          margin_pct:
            revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : null,
          last_seen: row.last_seen,
        };
      }),
    );
  } catch (error) {
    console.error("Get models error:", error);
    res.status(500).json({ error: "Failed to get models" });
  }
});

// GET /customers/:id — enriched customer detail with events
app.get(
  "/customers/:id",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;

      const [customerRes, subRes, eventsRes, featureRes] = await Promise.all([
        pool.query(
          "SELECT * FROM customers WHERE user_id = $1 AND customer_id = $2",
          [req.visitorId, id],
        ),
        pool.query(
          `SELECT s.*, p.name as plan_name, p.price_amount FROM subscriptions s
         LEFT JOIN plans p ON s.user_id = p.user_id AND s.plan_id = p.plan_id
         WHERE s.user_id = $1 AND s.customer_id = $2`,
          [req.visitorId, id],
        ),
        pool.query(
          `SELECT * FROM observe_events WHERE user_id = $1 AND customer_id = $2 ORDER BY timestamp DESC LIMIT 50`,
          [req.visitorId, id],
        ),
        pool.query(
          `SELECT feature_key, COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage
         FROM observe_events WHERE user_id = $1 AND customer_id = $2 AND feature_key IS NOT NULL
         GROUP BY feature_key ORDER BY total_cost DESC`,
          [req.visitorId, id],
        ),
      ]);

      if (customerRes.rows.length === 0) {
        return res.status(404).json({ error: "Customer not found" });
      }

      const c = customerRes.rows[0];
      const totalCost = featureRes.rows.reduce(
        (sum: number, r: { total_cost: string }) =>
          sum + (parseFloat(r.total_cost) || 0),
        0,
      );
      const totalRevenue = featureRes.rows.reduce(
        (sum: number, r: { total_revenue: string }) =>
          sum + (parseFloat(r.total_revenue) || 0),
        0,
      );
      const marginPct =
        totalRevenue > 0
          ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100)
          : null;

      res.json({
        customer: {
          customer_id: c.customer_id,
          name: c.name,
          email: c.email,
          segment: c.segment,
          created_at: c.created_at,
        },
        subscriptions: subRes.rows,
        total_cost: totalCost,
        total_revenue: totalRevenue,
        margin_pct: marginPct,
        recent_events: eventsRes.rows.map(coerceEventRow),
        by_feature: featureRes.rows.map(
          (r: {
            feature_key: string;
            event_count: string;
            total_cost: string;
            total_revenue: string;
            total_usage: string;
          }) => ({
            feature_key: r.feature_key,
            event_count: parseInt(r.event_count),
            total_cost: parseFloat(r.total_cost) || 0,
            total_revenue: parseFloat(r.total_revenue) || 0,
            total_usage: parseFloat(r.total_usage) || 0,
          }),
        ),
      });
    } catch (error) {
      console.error("Get customer detail error:", error);
      res.status(500).json({ error: "Failed to get customer detail" });
    }
  },
);

// =============================================================================
// RECOMMENDATIONS
// =============================================================================

// GET /recommendations/model-swap — find cheaper model alternatives per feature
app.get(
  "/recommendations/model-swap",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 90;

      const result = await pool.query(
        `SELECT
         feature_key, model, model_provider,
         COUNT(*) AS event_count,
         COALESCE(SUM(cost_amount), 0) AS total_cost,
         COALESCE(AVG(cost_amount), 0) AS avg_cost_per_event,
         COALESCE(SUM(usage_units), 0) AS total_usage_units
       FROM observe_events
       WHERE user_id = $1
         AND model IS NOT NULL
         AND cost_amount > 0
         AND timestamp > NOW() - MAKE_INTERVAL(days => $2)
       GROUP BY feature_key, model, model_provider
       ORDER BY total_cost DESC`,
        [req.visitorId, days],
      );

      // For each feature+model, find cheaper alternatives from MODEL_PRICING
      const recommendations: Array<{
        feature_key: string;
        current_model: string;
        current_provider: string | null;
        current_avg_cost_per_event: number;
        total_cost: number;
        event_count: number;
        recommendations: Array<{
          model: string;
          provider: string;
          same_provider: boolean;
          estimated_savings_pct: number;
          estimated_monthly_savings: number;
        }>;
      }> = [];

      // Build input-rate lookup from DB pricing
      const allPricing = await getAllPricing(pool);
      const inputRateMap: Record<string, number> = {};
      for (const p of allPricing) {
        inputRateMap[p.model] = p.input_cost_per_million;
      }

      for (const row of result.rows) {
        const currentInputRate = inputRateMap[row.model];
        if (!currentInputRate) continue; // skip unknown models
        const avgCost = parseFloat(row.avg_cost_per_event);
        const totalCost = parseFloat(row.total_cost);
        if (avgCost <= 0) continue;

        const candidates: Array<{
          model: string;
          provider: string;
          same_provider: boolean;
          estimated_savings_pct: number;
          estimated_monthly_savings: number;
        }> = [];

        const isEmbedding =
          row.model.includes("embedding") || row.model.includes("ada-002");
        for (const [altModel, altInputRate] of Object.entries(inputRateMap)) {
          if (altModel === row.model) continue;

          // Don't recommend cross-type swaps (embedding ↔ chat)
          const altIsEmbedding =
            altModel.includes("embedding") || altModel.includes("ada-002");
          if (isEmbedding !== altIsEmbedding) continue;

          // Only recommend if meaningfully cheaper (>20% savings on input rate)
          if (altInputRate >= currentInputRate * 0.8) continue;

          const costRatio = altInputRate / currentInputRate;
          const savingsPct = Math.round((1 - costRatio) * 100);
          const monthlySavings =
            Math.round(totalCost * (1 - costRatio) * 100) / 100;
          const altProvider = inferModelProvider(altModel) || "unknown";

          candidates.push({
            model: altModel,
            provider: altProvider,
            same_provider:
              altProvider ===
              (row.model_provider || inferModelProvider(row.model)),
            estimated_savings_pct: savingsPct,
            estimated_monthly_savings: monthlySavings,
          });
        }

        // Sort by savings, take top 3
        candidates.sort(
          (a, b) => b.estimated_monthly_savings - a.estimated_monthly_savings,
        );
        const topCandidates = candidates.slice(0, 3);

        if (topCandidates.length > 0) {
          recommendations.push({
            feature_key: row.feature_key,
            current_model: row.model,
            current_provider:
              row.model_provider || inferModelProvider(row.model),
            current_avg_cost_per_event: avgCost,
            total_cost: totalCost,
            event_count: parseInt(row.event_count),
            recommendations: topCandidates,
          });
        }
      }

      // Deduplicate: keep only the most expensive model per feature
      const byFeature = new Map<string, (typeof recommendations)[0]>();
      for (const rec of recommendations) {
        const existing = byFeature.get(rec.feature_key);
        if (!existing || rec.total_cost > existing.total_cost) {
          byFeature.set(rec.feature_key, rec);
        }
      }

      const final = Array.from(byFeature.values());
      const totalPotentialSavings = final.reduce(
        (sum, r) =>
          sum + (r.recommendations[0]?.estimated_monthly_savings || 0),
        0,
      );

      res.json({
        recommendations: final,
        total_potential_savings: Math.round(totalPotentialSavings * 100) / 100,
        days,
      });
    } catch (error) {
      console.error("GET /recommendations/model-swap error:", error);
      res
        .status(500)
        .json({ error: "Failed to generate model swap recommendations" });
    }
  },
);

// GET /recommendations/underwater-customers — customers where cost > revenue
app.get(
  "/recommendations/underwater-customers",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const days = parseInt(req.query.days as string) || 90;

      const result = await pool.query(
        `SELECT
         oe.customer_id,
         c.name AS customer_name,
         COALESCE(SUM(oe.cost_amount), 0) AS total_ai_cost,
         COALESCE(SUM(oe.revenue_amount), 0) AS total_revenue,
         COALESCE(SUM(oe.cost_amount), 0) - COALESCE(SUM(oe.revenue_amount), 0) AS loss_amount,
         COUNT(*) AS event_count
       FROM observe_events oe
       LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
       WHERE oe.user_id = $1
         AND oe.timestamp > NOW() - MAKE_INTERVAL(days => $2)
       GROUP BY oe.customer_id, c.name
       HAVING SUM(oe.cost_amount) > SUM(oe.revenue_amount)
       ORDER BY (SUM(oe.cost_amount) - SUM(oe.revenue_amount)) DESC`,
        [req.visitorId, days],
      );

      const customers = result.rows.map((r) => ({
        customer_id: r.customer_id,
        customer_name: r.customer_name || r.customer_id,
        total_ai_cost: parseFloat(r.total_ai_cost),
        total_revenue: parseFloat(r.total_revenue),
        loss_amount: parseFloat(r.loss_amount),
        margin_pct:
          parseFloat(r.total_revenue) > 0
            ? Math.round(
                ((parseFloat(r.total_revenue) - parseFloat(r.total_ai_cost)) /
                  parseFloat(r.total_revenue)) *
                  100,
              )
            : -100,
        event_count: parseInt(r.event_count),
      }));

      res.json({ customers, days });
    } catch (error) {
      console.error("GET /recommendations/underwater-customers error:", error);
      res.status(500).json({ error: "Failed to find underwater customers" });
    }
  },
);

// =============================================================================
// SIMULATIONS
// =============================================================================

// GET /simulations/opportunities — auto-detect pricing issues
// NOTE: Must come BEFORE /simulations/:id to avoid matching 'opportunities' as an :id
app.get(
  "/simulations/opportunities",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT feature_key,
         COALESCE(SUM(cost_amount), 0) as total_cost,
         COALESCE(SUM(revenue_amount), 0) as total_revenue,
         COUNT(*) as event_count
       FROM observe_events
       WHERE user_id = $1 AND feature_key IS NOT NULL
       GROUP BY feature_key`,
        [req.visitorId],
      );

      const opportunities: Array<{
        id: string;
        title: string;
        description: string;
        severity: string;
        suggested_action: string;
        feature_key?: string;
        estimated_impact?: string;
      }> = [];

      let idx = 0;
      for (const row of result.rows) {
        const cost = parseFloat(row.total_cost) || 0;
        const revenue = parseFloat(row.total_revenue) || 0;
        const margin = revenue > 0 ? ((revenue - cost) / revenue) * 100 : -100;

        if (margin < 0) {
          idx++;
          opportunities.push({
            id: `opp-${idx}`,
            title: `Negative margin on ${row.feature_key}`,
            description: `Feature "${row.feature_key}" is losing money: margin is ${Math.round(margin)}%. Cost ($${cost.toFixed(2)}) exceeds revenue ($${revenue.toFixed(2)}).`,
            severity: "critical",
            suggested_action: `Increase pricing for ${row.feature_key} or reduce cost by switching models.`,
            feature_key: row.feature_key,
            estimated_impact: `$${(cost - revenue).toFixed(2)} loss`,
          });
        } else if (margin < 20) {
          idx++;
          opportunities.push({
            id: `opp-${idx}`,
            title: `Low margin on ${row.feature_key}`,
            description: `Feature "${row.feature_key}" has only ${Math.round(margin)}% margin. Consider adjusting pricing to improve sustainability.`,
            severity: "warning",
            suggested_action: `Increase pricing for ${row.feature_key} by at least ${Math.round(20 - margin)}% to reach 20% margin.`,
            feature_key: row.feature_key,
            estimated_impact: `+$${((revenue * 0.2) / (1 - 0.2) - revenue + revenue - cost).toFixed(2)} potential improvement`,
          });
        }
      }

      res.json(opportunities);
    } catch (error) {
      console.error("Get opportunities error:", error);
      res.status(500).json({ error: "Failed to get opportunities" });
    }
  },
);

// POST /simulations/suggest — AI-generated simulation scenarios based on user data
// NOTE: Must come BEFORE /simulations/:id to avoid matching 'suggest' as an :id
app.post(
  "/simulations/suggest",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      // Gather the user's observe_events data (same queries as insights)
      const [featureRes, customerRes] = await Promise.all([
        pool.query(
          `SELECT feature_key,
           COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage
         FROM observe_events WHERE user_id = $1 AND feature_key IS NOT NULL
         GROUP BY feature_key ORDER BY total_cost DESC`,
          [req.visitorId],
        ),
        pool.query(
          `SELECT oe.customer_id, c.name as customer_name, c.segment,
           COALESCE(SUM(oe.cost_amount), 0) as total_cost,
           COALESCE(SUM(oe.revenue_amount), 0) as total_revenue
         FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1
         GROUP BY oe.customer_id, c.name, c.segment ORDER BY total_revenue DESC LIMIT 10`,
          [req.visitorId],
        ),
      ]);

      if (featureRes.rows.length === 0) {
        return res.status(400).json({
          error: "No data available to suggest simulations. Add events first.",
        });
      }

      // Build data summary
      const featureLines = featureRes.rows
        .map((r: Record<string, string>) => {
          const cost = parseFloat(r.total_cost) || 0;
          const revenue = parseFloat(r.total_revenue) || 0;
          const margin =
            revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : -100;
          return `- ${r.feature_key}: cost=$${cost.toFixed(2)}, revenue=$${revenue.toFixed(2)}, margin=${margin}%, ${r.event_count} events`;
        })
        .join("\n");

      const customerLines = customerRes.rows
        .map((r: Record<string, string>) => {
          const cost = parseFloat(r.total_cost) || 0;
          const revenue = parseFloat(r.total_revenue) || 0;
          return `- ${r.customer_name || r.customer_id || "Unknown"} (${r.segment || "unknown"}): cost=$${cost.toFixed(2)}, revenue=$${revenue.toFixed(2)}`;
        })
        .join("\n");

      const featureKeys = featureRes.rows.map(
        (r: Record<string, string>) => r.feature_key,
      );

      const prompt = `You are an AI SaaS pricing strategist. Based on the data below, suggest a simulation with 2-3 scenarios the user can run to optimize their pricing.

Feature Data:
${featureLines}

Customer Data:
${customerLines}

Available feature_keys: ${JSON.stringify(featureKeys)}

Return a JSON object with these fields:
- name: a short simulation name (e.g. "Margin Recovery Q1")
- rationale: 1-2 sentences explaining WHY these scenarios make sense given the data
- scenarios: array of 2-3 scenarios, each with:
  - name: short scenario name (e.g. "Conservative +10%")
  - description: 1 sentence explaining this scenario's strategy
  - changes: array of pricing changes, each with:
    - feature_key: must be one of the available feature_keys listed above
    - change_type: one of "percentage_increase", "percentage_decrease", "flat_increase", "flat_decrease", "new_price"
    - change_value: a positive number

Design scenarios that represent different risk levels:
1. A conservative/safe option (small adjustments)
2. A moderate option (meaningful changes)
3. An aggressive option (bigger bets for higher margin)

Focus on features with poor margins or high cost. Be specific with numbers.
Return ONLY the JSON object, no markdown or explanation.`;

      const openaiKey = process.env.OPENAI_API_KEY;
      let suggestion: {
        name: string;
        rationale: string;
        scenarios: Array<{
          name: string;
          description: string;
          changes: Array<{
            feature_key: string;
            change_type: string;
            change_value: number;
          }>;
        }>;
      };

      if (openaiKey) {
        const openaiResponse = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${openaiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: prompt }],
              temperature: 0.4,
              max_tokens: 1500,
            }),
          },
        );

        if (!openaiResponse.ok) {
          const errBody = await openaiResponse.text();
          console.error("OpenAI API error (suggest):", errBody);
          return res.status(502).json({
            error: "AI service unavailable. Check your OpenAI API key.",
          });
        }

        const completion = (await openaiResponse.json()) as {
          choices: Array<{ message: { content: string } }>;
        };
        const content = completion.choices[0]?.message?.content || "{}";

        try {
          const cleaned = content
            .replace(/^```json?\n?/i, "")
            .replace(/\n?```$/i, "")
            .trim();
          const parsed = JSON.parse(cleaned);
          suggestion = parsed.suggestion || parsed; // handle wrapped responses
          if (
            !suggestion.name ||
            !suggestion.rationale ||
            !Array.isArray(suggestion.scenarios)
          ) {
            throw new Error("AI response missing required fields");
          }
        } catch {
          console.error("Failed to parse OpenAI suggestion response:", content);
          return res
            .status(502)
            .json({ error: "AI returned invalid response. Try again." });
        }
      } else {
        // Local fallback: heuristic-based suggestions
        const scenarios: typeof suggestion.scenarios = [];

        // Sort features by margin (worst first)
        const features = featureRes.rows
          .map((r: Record<string, string>) => {
            const cost = parseFloat(r.total_cost) || 0;
            const revenue = parseFloat(r.total_revenue) || 0;
            const margin =
              revenue > 0 ? ((revenue - cost) / revenue) * 100 : -100;
            return { key: r.feature_key, cost, revenue, margin };
          })
          .sort((a, b) => a.margin - b.margin);

        const worstFeatures = features.filter((f) => f.margin < 50).slice(0, 3);
        if (worstFeatures.length === 0) worstFeatures.push(features[0]);

        scenarios.push({
          name: "Conservative (+10%)",
          description:
            "Small price increases on underperforming features to improve margins safely.",
          changes: worstFeatures.map((f) => ({
            feature_key: f.key,
            change_type: "percentage_increase",
            change_value: 10,
          })),
        });

        scenarios.push({
          name: "Moderate (+20%)",
          description:
            "Meaningful price adjustments targeting features with the worst margins.",
          changes: worstFeatures.map((f) => ({
            feature_key: f.key,
            change_type: "percentage_increase",
            change_value: 20,
          })),
        });

        scenarios.push({
          name: "Aggressive (+35%)",
          description:
            "Bold repricing to reach healthy margins, may increase churn risk.",
          changes: worstFeatures.map((f) => ({
            feature_key: f.key,
            change_type: "percentage_increase",
            change_value: 35,
          })),
        });

        const worstNames = worstFeatures.map((f) => f.key).join(", ");
        suggestion = {
          name: "Margin Optimization",
          rationale: `Features with the lowest margins (${worstNames}) are candidates for price increases. These three scenarios let you compare conservative vs aggressive approaches.`,
          scenarios,
        };
      }

      // Validate that suggested feature_keys actually exist in the user's data
      const validKeys = new Set(featureKeys);
      for (const scenario of suggestion.scenarios) {
        scenario.changes = scenario.changes.filter((c) =>
          validKeys.has(c.feature_key),
        );
      }
      suggestion.scenarios = suggestion.scenarios.filter(
        (s) => s.changes.length > 0,
      );

      if (suggestion.scenarios.length === 0) {
        return res.status(400).json({
          error: "Could not generate valid scenarios from your data.",
        });
      }

      res.json(suggestion);
    } catch (error) {
      console.error("Suggest simulation error:", error);
      res
        .status(500)
        .json({ error: "Failed to generate simulation suggestion" });
    }
  },
);

// GET /simulations — list all simulations
app.get(
  "/simulations",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await pool.query(
        "SELECT * FROM simulations WHERE user_id = $1 ORDER BY created_at DESC",
        [req.visitorId],
      );
      res.json(
        result.rows.map((row: Record<string, unknown>) => ({
          ...row,
          scenarios: row.scenarios || [],
          customer_impacts: row.customer_impacts || [],
          feature_analysis: row.feature_analysis || [],
        })),
      );
    } catch (error) {
      console.error("List simulations error:", error);
      res.status(500).json({ error: "Failed to list simulations" });
    }
  },
);

// POST /simulations — create a new simulation
app.post(
  "/simulations",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    const visitorId = req.visitorId!;

    try {
      const { name, scenarios, time_range } = req.body;
      if (!name) {
        return res.status(400).json({ error: "Name is required" });
      }

      const result = await pool.query(
        `INSERT INTO simulations (user_id, name, scenarios, time_range, status)
       VALUES ($1, $2, $3, $4, 'draft')
       RETURNING *`,
        [
          visitorId,
          name,
          JSON.stringify(scenarios || []),
          time_range ? JSON.stringify(time_range) : null,
        ],
      );

      const row = result.rows[0];

      res.json({
        ...row,
        scenarios: row.scenarios || [],
        customer_impacts: row.customer_impacts || [],
        feature_analysis: row.feature_analysis || [],
      });
    } catch (error) {
      console.error("Create simulation error:", error);
      res.status(500).json({ error: "Failed to create simulation" });
    }
  },
);

// GET /simulations/:id — get a single simulation
app.get(
  "/simulations/:id",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        "SELECT * FROM simulations WHERE id = $1 AND user_id = $2",
        [id, req.visitorId],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Simulation not found" });
      }
      const row = result.rows[0];
      res.json({
        ...row,
        scenarios: row.scenarios || [],
        customer_impacts: row.customer_impacts || [],
        feature_analysis: row.feature_analysis || [],
      });
    } catch (error) {
      console.error("Get simulation error:", error);
      res.status(500).json({ error: "Failed to get simulation" });
    }
  },
);

// PUT /simulations/:id — update a simulation (including running it)
app.put(
  "/simulations/:id",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    const client = await pool.connect();
    try {
      const { id } = req.params;
      const updates = req.body;

      // Check ownership
      const existing = await client.query(
        "SELECT * FROM simulations WHERE id = $1 AND user_id = $2",
        [id, req.visitorId],
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Simulation not found" });
      }

      const sim = existing.rows[0];

      // If status is changing to 'running', compute results
      if (updates.status === "running") {
        await client.query("BEGIN");

        // Update status to running
        await client.query(
          "UPDATE simulations SET status = 'running', updated_at = NOW() WHERE id = $1",
          [id],
        );

        const scenarios = updates.scenarios || sim.scenarios || [];

        // Query feature data
        const featureResult = await client.query(
          `SELECT feature_key,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage,
           COUNT(*) as event_count
         FROM observe_events
         WHERE user_id = $1 AND feature_key IS NOT NULL
         GROUP BY feature_key`,
          [req.visitorId],
        );

        // Query customer data
        const customerResult = await client.query(
          `SELECT oe.customer_id, c.name as customer_name, c.segment,
           COALESCE(SUM(oe.cost_amount), 0) as total_cost,
           COALESCE(SUM(oe.revenue_amount), 0) as total_revenue
         FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1
         GROUP BY oe.customer_id, c.name, c.segment`,
          [req.visitorId],
        );

        // Build feature data map
        const featureMap = new Map<
          string,
          { cost: number; revenue: number; usage: number }
        >();
        for (const row of featureResult.rows) {
          featureMap.set(row.feature_key, {
            cost: parseFloat(row.total_cost) || 0,
            revenue: parseFloat(row.total_revenue) || 0,
            usage: parseFloat(row.total_usage) || 0,
          });
        }

        // Helper: apply a scenario's changes to compute projected revenue per feature
        function computeScenarioProjections(
          changes: Array<{
            feature_key: string;
            change_type: string;
            change_value: number;
          }>,
        ) {
          const projections = new Map<string, number>();
          for (const [key, data] of featureMap.entries()) {
            let projectedRevenue = data.revenue;
            const change = changes.find((c) => c.feature_key === key);
            if (change) {
              switch (change.change_type) {
                case "percentage_increase":
                  projectedRevenue =
                    data.revenue * (1 + change.change_value / 100);
                  break;
                case "percentage_decrease":
                  projectedRevenue =
                    data.revenue * (1 - change.change_value / 100);
                  break;
                case "flat_increase":
                  projectedRevenue = data.revenue + change.change_value;
                  break;
                case "flat_decrease":
                  projectedRevenue = data.revenue - change.change_value;
                  break;
                case "new_price":
                  projectedRevenue = change.change_value * (data.usage || 1);
                  break;
              }
            }
            projections.set(key, projectedRevenue);
          }
          return projections;
        }

        const totalCurrentRevenue = Array.from(featureMap.values()).reduce(
          (s, d) => s + d.revenue,
          0,
        );
        const totalCost = Array.from(featureMap.values()).reduce(
          (s, d) => s + d.cost,
          0,
        );
        const currentMarginPct =
          totalCurrentRevenue > 0
            ? Math.round(
                ((totalCurrentRevenue - totalCost) / totalCurrentRevenue) * 100,
              )
            : 0;

        // Compute projections for EACH scenario independently
        const updatedScenarios = scenarios.map((s: Record<string, unknown>) => {
          const changes =
            (s.changes as Array<{
              feature_key: string;
              change_type: string;
              change_value: number;
            }>) || [];
          const projections = computeScenarioProjections(changes);
          const scenarioRevenue = Array.from(projections.values()).reduce(
            (sum, v) => sum + v,
            0,
          );
          const scenarioMarginPct =
            scenarioRevenue > 0
              ? Math.round(
                  ((scenarioRevenue - totalCost) / scenarioRevenue) * 100,
                )
              : 0;
          return {
            ...s,
            projected_revenue: scenarioRevenue,
            projected_cost: totalCost,
            projected_margin_pct: scenarioMarginPct,
          };
        });

        // Use the best scenario (highest margin) for feature analysis and customer impacts
        let bestScenario = updatedScenarios[0];
        for (const s of updatedScenarios) {
          if (
            (s.projected_margin_pct || 0) >
            (bestScenario.projected_margin_pct || 0)
          ) {
            bestScenario = s;
          }
        }

        const bestChanges =
          (bestScenario.changes as Array<{
            feature_key: string;
            change_type: string;
            change_value: number;
          }>) || [];
        const featureProjections = computeScenarioProjections(bestChanges);
        const totalProjectedRevenue = Array.from(
          featureProjections.values(),
        ).reduce((s, v) => s + v, 0);
        const projectedMarginPct =
          totalProjectedRevenue > 0
            ? Math.round(
                ((totalProjectedRevenue - totalCost) / totalProjectedRevenue) *
                  100,
              )
            : 0;

        // Feature analysis (based on best scenario)
        const featureAnalysis = Array.from(featureMap.entries()).map(
          ([key, data]) => {
            const projectedRevenue =
              featureProjections.get(key) || data.revenue;
            const currentMargin =
              data.revenue > 0
                ? Math.round(((data.revenue - data.cost) / data.revenue) * 100)
                : 0;
            const projectedMargin =
              projectedRevenue > 0
                ? Math.round(
                    ((projectedRevenue - data.cost) / projectedRevenue) * 100,
                  )
                : 0;
            return {
              feature_key: key,
              current_cost: data.cost,
              current_revenue: data.revenue,
              current_margin_pct: currentMargin,
              projected_revenue: projectedRevenue,
              projected_margin_pct: projectedMargin,
              margin_delta_pct: projectedMargin - currentMargin,
            };
          },
        );

        // Customer impacts (based on best scenario)
        const revenueRatio =
          totalCurrentRevenue > 0
            ? totalProjectedRevenue / totalCurrentRevenue
            : 1;
        const customerImpacts = customerResult.rows.map(
          (row: Record<string, unknown>) => {
            const currentRevenue = parseFloat(row.total_revenue as string) || 0;
            const projectedRevenue = currentRevenue * revenueRatio;
            const delta = projectedRevenue - currentRevenue;
            const deltaPct =
              currentRevenue > 0
                ? Math.round((delta / currentRevenue) * 100)
                : 0;

            let churnRisk: "low" | "medium" | "high" = "low";
            if (deltaPct > 30) churnRisk = "high";
            else if (deltaPct > 15) churnRisk = "medium";
            if (delta < 0) churnRisk = "low";

            return {
              customer_id: row.customer_id as string,
              customer_name:
                (row.customer_name as string) || (row.customer_id as string),
              current_revenue: currentRevenue,
              projected_revenue: projectedRevenue,
              revenue_delta: delta,
              revenue_delta_pct: deltaPct,
              churn_risk: churnRisk,
              segment: (row.segment as string) || undefined,
            };
          },
        );

        // Margin impact summary (based on best scenario)
        const marginImpact = {
          current_margin_pct: currentMarginPct,
          projected_margin_pct: projectedMarginPct,
          margin_delta_pct: projectedMarginPct - currentMarginPct,
          total_current_revenue: totalCurrentRevenue,
          total_projected_revenue: totalProjectedRevenue,
          total_cost: totalCost,
          customers_affected: customerImpacts.length,
          high_churn_risk_count: customerImpacts.filter(
            (c: { churn_risk: string }) => c.churn_risk === "high",
          ).length,
        };

        // Confidence score: based on data volume
        const totalEvents = featureResult.rows.reduce(
          (s: number, r: { event_count: string }) =>
            s + parseInt(r.event_count),
          0,
        );
        const confidenceScore = Math.min(
          95,
          Math.max(30, Math.round(40 + Math.log2(totalEvents + 1) * 10)),
        );

        // Key insight
        const marginDelta = projectedMarginPct - currentMarginPct;
        const highChurnCount = customerImpacts.filter(
          (c: { churn_risk: string }) => c.churn_risk === "high",
        ).length;
        let keyInsight = "";
        if (marginDelta > 0) {
          keyInsight = `This pricing change would improve overall margin from ${currentMarginPct}% to ${projectedMarginPct}% (+${marginDelta}pp).`;
        } else if (marginDelta < 0) {
          keyInsight = `This pricing change would reduce margin from ${currentMarginPct}% to ${projectedMarginPct}% (${marginDelta}pp).`;
        } else {
          keyInsight = `This pricing change has minimal impact on overall margin (${currentMarginPct}%).`;
        }
        if (highChurnCount > 0) {
          keyInsight += ` ${highChurnCount} customer${highChurnCount > 1 ? "s" : ""} at high churn risk.`;
        }

        // Determine winning scenario (highest projected margin — already computed per-scenario)
        const winningScenarioId = (bestScenario.id as string) || null;

        await client.query(
          `UPDATE simulations SET
           status = 'completed',
           scenarios = $2,
           feature_analysis = $3,
           customer_impacts = $4,
           margin_impact = $5,
           confidence_score = $6,
           key_insight = $7,
           winning_scenario_id = $8,
           updated_at = NOW()
         WHERE id = $1`,
          [
            id,
            JSON.stringify(updatedScenarios),
            JSON.stringify(featureAnalysis),
            JSON.stringify(customerImpacts),
            JSON.stringify(marginImpact),
            confidenceScore,
            keyInsight,
            winningScenarioId,
          ],
        );

        await client.query("COMMIT");

        const updated = await client.query(
          "SELECT * FROM simulations WHERE id = $1",
          [id],
        );
        const row = updated.rows[0];
        return res.json({
          ...row,
          scenarios: row.scenarios || [],
          customer_impacts: row.customer_impacts || [],
          feature_analysis: row.feature_analysis || [],
        });
      }

      // Handle roll-out
      if (updates.status === "rolled_out") {
        await client.query(
          "UPDATE simulations SET status = 'rolled_out', rolled_out_at = NOW(), updated_at = NOW() WHERE id = $1",
          [id],
        );
        const updated = await client.query(
          "SELECT * FROM simulations WHERE id = $1",
          [id],
        );
        const row = updated.rows[0];
        return res.json({
          ...row,
          scenarios: row.scenarios || [],
          customer_impacts: row.customer_impacts || [],
          feature_analysis: row.feature_analysis || [],
        });
      }

      // Generic update
      const setClauses: string[] = ["updated_at = NOW()"];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (updates.name !== undefined) {
        setClauses.push(`name = $${paramIdx++}`);
        params.push(updates.name);
      }
      if (updates.scenarios !== undefined) {
        setClauses.push(`scenarios = $${paramIdx++}`);
        params.push(JSON.stringify(updates.scenarios));
      }
      if (updates.segment_name !== undefined) {
        setClauses.push(`segment_name = $${paramIdx++}`);
        params.push(updates.segment_name);
      }
      if (updates.time_range !== undefined) {
        setClauses.push(`time_range = $${paramIdx++}`);
        params.push(JSON.stringify(updates.time_range));
      }

      params.push(id);
      await client.query(
        `UPDATE simulations SET ${setClauses.join(", ")} WHERE id = $${paramIdx}`,
        params,
      );

      const updated = await client.query(
        "SELECT * FROM simulations WHERE id = $1",
        [id],
      );
      const row = updated.rows[0];
      res.json({
        ...row,
        scenarios: row.scenarios || [],
        customer_impacts: row.customer_impacts || [],
        feature_analysis: row.feature_analysis || [],
      });
    } catch (error) {
      await client
        .query("ROLLBACK")
        .catch((err) => console.error("ROLLBACK failed:", err));
      console.error("Update simulation error:", error);
      res.status(500).json({ error: "Failed to update simulation" });
    } finally {
      client.release();
    }
  },
);

// DELETE /simulations/:id — delete a simulation
app.delete(
  "/simulations/:id",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        "DELETE FROM simulations WHERE id = $1 AND user_id = $2 RETURNING id",
        [id, req.visitorId],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Simulation not found" });
      }
      res.json({ success: true });
    } catch (error) {
      console.error("Delete simulation error:", error);
      res.status(500).json({ error: "Failed to delete simulation" });
    }
  },
);

// =============================================================================
// AI INSIGHTS
// =============================================================================

// GET /insights — list all insights for the session
app.get("/insights", ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const result = await pool.query(
      "SELECT * FROM ai_insights WHERE user_id = $1 ORDER BY created_at DESC",
      [req.visitorId],
    );
    res.json(result.rows);
  } catch (error) {
    console.error("List insights error:", error);
    res.status(500).json({ error: "Failed to list insights" });
  }
});

// POST /insights/generate — generate AI insights from observe_events data
app.post(
  "/insights/generate",
  ensureVisitor,
  expensiveLimiter,
  async (req: AuthRequest, res: Response) => {
    const visitorId = req.visitorId!;

    // Billing entitlement check (fail closed)
    const aiAccess = await checkBillingFeatureAccess(
      visitorId,
      "ai_insights",
      req.accountEmail,
    );
    if (!aiAccess.allowed) {
      return res.status(403).json({
        error: aiAccess.reason || "AI insights limit reached",
        usage: aiAccess.usage,
        limit: aiAccess.limit,
        remaining: aiAccess.remaining,
      });
    }

    try {
      // Gather rich summary data from observe_events for pricing analysis
      const [
        featureRes,
        customerRes,
        modelRes,
        overallRes,
        featureModelRes,
        customerFeatureRes,
        trendRes,
      ] = await Promise.all([
        // Per-feature breakdown with cost-per-call
        pool.query(
          `SELECT feature_key,
           COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COALESCE(SUM(usage_units), 0) as total_usage,
           CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(cost_amount), 0) / COUNT(*) ELSE 0 END as cost_per_call,
           CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(revenue_amount), 0) / COUNT(*) ELSE 0 END as revenue_per_call
         FROM observe_events WHERE user_id = $1 AND feature_key IS NOT NULL
         GROUP BY feature_key ORDER BY total_cost DESC`,
          [req.visitorId],
        ),
        // Per-customer with feature-level breakdown
        pool.query(
          `SELECT oe.customer_id, c.name as customer_name, c.segment,
           COUNT(*) as event_count,
           COALESCE(SUM(oe.cost_amount), 0) as total_cost,
           COALESCE(SUM(oe.revenue_amount), 0) as total_revenue,
           CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(oe.cost_amount), 0) / COUNT(*) ELSE 0 END as cost_per_call
         FROM observe_events oe
         LEFT JOIN customers c ON oe.user_id = c.user_id AND oe.customer_id = c.customer_id
         WHERE oe.user_id = $1
         GROUP BY oe.customer_id, c.name, c.segment ORDER BY total_cost DESC LIMIT 15`,
          [req.visitorId],
        ),
        // Model usage
        pool.query(
          `SELECT model, model_provider,
           COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost
         FROM observe_events WHERE user_id = $1 AND model IS NOT NULL
         GROUP BY model, model_provider ORDER BY total_cost DESC`,
          [req.visitorId],
        ),
        // Overall totals
        pool.query(
          `SELECT
           COUNT(*) as total_events,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue
         FROM observe_events WHERE user_id = $1`,
          [req.visitorId],
        ),
        // Which models power which features (for model routing recommendations)
        pool.query(
          `SELECT feature_key, model,
           COUNT(*) as event_count,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           CASE WHEN COUNT(*) > 0 THEN COALESCE(SUM(cost_amount), 0) / COUNT(*) ELSE 0 END as cost_per_call
         FROM observe_events
         WHERE user_id = $1 AND feature_key IS NOT NULL AND model IS NOT NULL
         GROUP BY feature_key, model ORDER BY feature_key, total_cost DESC`,
          [req.visitorId],
        ),
        // Usage variance across customers per feature (for usage-based pricing signals)
        pool.query(
          `SELECT feature_key,
           COUNT(DISTINCT customer_id) as unique_customers,
           MIN(ct.calls) as min_calls, MAX(ct.calls) as max_calls,
           AVG(ct.calls) as avg_calls, STDDEV(ct.calls) as stddev_calls
         FROM (
           SELECT feature_key, customer_id, COUNT(*) as calls
           FROM observe_events
           WHERE user_id = $1 AND feature_key IS NOT NULL
           GROUP BY feature_key, customer_id
         ) ct
         GROUP BY feature_key`,
          [req.visitorId],
        ),
        // Monthly trend (for trajectory analysis)
        pool.query(
          `SELECT DATE_TRUNC('month', timestamp) as month,
           COALESCE(SUM(cost_amount), 0) as total_cost,
           COALESCE(SUM(revenue_amount), 0) as total_revenue,
           COUNT(*) as event_count
         FROM observe_events WHERE user_id = $1
         GROUP BY month ORDER BY month DESC LIMIT 6`,
          [req.visitorId],
        ),
      ]);

      if (featureRes.rows.length === 0) {
        return res.status(400).json({
          error:
            "No data available to analyze. Load sample data or import your own first.",
        });
      }

      const overall = overallRes.rows[0];
      const totalCost = parseFloat(overall.total_cost) || 0;
      const totalRevenue = parseFloat(overall.total_revenue) || 0;
      const overallMargin =
        totalRevenue > 0
          ? Math.round(((totalRevenue - totalCost) / totalRevenue) * 100)
          : 0;

      // Build rich summaries for pricing consultant prompt
      const featureSummary = featureRes.rows
        .map((r: Record<string, string>) => {
          const cost = parseFloat(r.total_cost) || 0;
          const revenue = parseFloat(r.total_revenue) || 0;
          const margin =
            revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0;
          const costPerCall = parseFloat(r.cost_per_call) || 0;
          const revenuePerCall = parseFloat(r.revenue_per_call) || 0;
          return `- ${r.feature_key}: cost=$${cost.toFixed(2)}, revenue=$${revenue.toFixed(2)}, margin=${margin}%, ${r.event_count} events, cost/call=$${costPerCall.toFixed(4)}, revenue/call=$${revenuePerCall.toFixed(4)}`;
        })
        .join("\n");

      const customerSummary = customerRes.rows
        .map((r: Record<string, string>) => {
          const cost = parseFloat(r.total_cost) || 0;
          const revenue = parseFloat(r.total_revenue) || 0;
          const margin =
            revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0;
          const costPerCall = parseFloat(r.cost_per_call) || 0;
          return `- ${r.customer_name || r.customer_id} (${r.segment || "no segment"}): cost=$${cost.toFixed(2)}, revenue=$${revenue.toFixed(2)}, margin=${margin}%, ${r.event_count} calls, cost/call=$${costPerCall.toFixed(4)}`;
        })
        .join("\n");

      const modelSummary = modelRes.rows
        .map((r: Record<string, string>) => {
          const cost = parseFloat(r.total_cost) || 0;
          return `- ${r.model} (${r.model_provider || "unknown"}): cost=$${cost.toFixed(2)}, ${r.event_count} calls`;
        })
        .join("\n");

      // Model-per-feature breakdown (which models power which features)
      const featureModelSummary =
        featureModelRes.rows.length > 0
          ? featureModelRes.rows
              .map((r: Record<string, string>) => {
                const costPerCall = parseFloat(r.cost_per_call) || 0;
                return `- ${r.feature_key} → ${r.model}: ${r.event_count} calls, cost/call=$${costPerCall.toFixed(4)}`;
              })
              .join("\n")
          : "No model-level feature data available.";

      // Usage variance (signals for usage-based pricing)
      const usageVarianceSummary =
        customerFeatureRes.rows.length > 0
          ? customerFeatureRes.rows
              .map((r: Record<string, string>) => {
                const min = parseInt(r.min_calls) || 0;
                const max = parseInt(r.max_calls) || 0;
                const avg = parseFloat(r.avg_calls) || 0;
                const stddev = parseFloat(r.stddev_calls) || 0;
                const ratio = min > 0 ? Math.round(max / min) : max;
                return `- ${r.feature_key}: ${r.unique_customers} customers, calls range ${min}–${max} (${ratio}x spread), avg=${Math.round(avg)}, stddev=${Math.round(stddev)}`;
              })
              .join("\n")
          : "No per-customer usage variance data available.";

      // Monthly trend
      const trendSummary =
        trendRes.rows.length > 0
          ? trendRes.rows
              .map((r: any) => {
                const month = r.month
                  ? new Date(r.month).toISOString().slice(0, 7)
                  : "unknown";
                const cost = parseFloat(r.total_cost) || 0;
                const revenue = parseFloat(r.total_revenue) || 0;
                const margin =
                  revenue > 0
                    ? Math.round(((revenue - cost) / revenue) * 100)
                    : 0;
                return `- ${month}: cost=$${cost.toFixed(2)}, revenue=$${revenue.toFixed(2)}, margin=${margin}%, ${r.event_count} events`;
              })
              .join("\n")
          : "No trend data available.";

      // Pull historic context (CSV uploads, OpenAI/Anthropic imports)
      let historicContext = "";
      try {
        const [costRecords, usageRecords, importedEvents] = await Promise.all([
          pool.query(
            `SELECT cost_type, SUM(amount)::numeric as total, COUNT(*)::int as records,
             MIN(period_start) as earliest, MAX(period_end) as latest
           FROM cost_records WHERE user_id = $1 GROUP BY cost_type`,
            [req.visitorId],
          ),
          pool.query(
            `SELECT metric_name, SUM(value)::numeric as total, COUNT(*)::int as records
           FROM usage_records WHERE user_id = $1 GROUP BY metric_name`,
            [req.visitorId],
          ),
          pool.query(
            `SELECT source, model, model_provider,
             COUNT(*)::int as event_count,
             COALESCE(SUM(cost_amount), 0)::numeric as total_cost,
             MIN(timestamp) as earliest, MAX(timestamp) as latest
           FROM observe_events
           WHERE user_id = $1 AND source IN ('openai', 'anthropic', 'csv') AND granularity != 'event'
           GROUP BY source, model, model_provider`,
            [req.visitorId],
          ),
        ]);

        const parts: string[] = [];

        if (costRecords.rows.length > 0) {
          const lines = costRecords.rows.map(
            (r: any) =>
              `- ${r.cost_type}: $${parseFloat(r.total).toFixed(2)} total (${r.records} records, ${r.earliest?.toISOString().slice(0, 10)} to ${r.latest?.toISOString().slice(0, 10)})`,
          );
          parts.push(
            `Historic cost data (from CSV/imports):\n${lines.join("\n")}`,
          );
        }

        if (usageRecords.rows.length > 0) {
          const lines = usageRecords.rows.map(
            (r: any) =>
              `- ${r.metric_name}: ${parseFloat(r.total).toLocaleString()} total (${r.records} records)`,
          );
          parts.push(
            `Historic usage data (from CSV/imports):\n${lines.join("\n")}`,
          );
        }

        if (importedEvents.rows.length > 0) {
          const lines = importedEvents.rows.map(
            (r: any) =>
              `- ${r.source} import: ${r.model || "various models"} (${r.model_provider || "unknown"}), $${parseFloat(r.total_cost).toFixed(2)} cost, ${r.event_count} records, ${r.earliest?.toISOString().slice(0, 10)} to ${r.latest?.toISOString().slice(0, 10)}`,
          );
          parts.push(
            `Imported provider data (daily aggregates, no per-customer breakdown):\n${lines.join("\n")}`,
          );
        }

        if (parts.length > 0) {
          historicContext =
            "\n\nHistoric Context (use to cross-reference with SDK event data above):\n" +
            parts.join("\n\n");
        }
      } catch (err) {
        console.error("Failed to fetch historic context for insights:", err);
      }

      const prompt = `You are an AI pricing consultant for SaaS companies that build on AI models. Your client pays you to analyze their cost and usage data and tell them exactly how to price their product. Be specific, quantitative, and actionable — like a $50k/year pricing advisor, not a generic dashboard.

## Client's Data

Overall: ${parseInt(overall.total_events)} events tracked, total cost $${totalCost.toFixed(2)}, total revenue $${totalRevenue.toFixed(2)}, overall margin ${overallMargin}%

### Features (cost, revenue, and unit economics per call)
${featureSummary}

### Customers (who costs how much to serve)
${customerSummary}

### AI Models Used
${modelSummary}

### Which Models Power Which Features
${featureModelSummary}

### Usage Variance Across Customers (signals for pricing model design)
${usageVarianceSummary}

### Monthly Trend (most recent first)
${trendSummary}${historicContext}

## Your Analysis

Return exactly 4-6 insights as a JSON array. Each insight must have:
- insight_type: one of "pricing_recommendation", "usage_pricing_signal", "model_routing", "margin_alert", "customer_risk", "cost_optimization"
- title: short headline (under 60 chars)
- description: 2-3 sentences. Include specific dollar amounts, percentages, and recommended actions. For pricing recommendations, state the exact price point or range.
- severity: one of "critical", "warning", "info", "positive"
- feature_key: the relevant feature key if applicable, or null
- customer_id: the relevant customer id if applicable, or null

### What a great pricing consultant would focus on:

1. **Pricing recommendations**: For each feature with poor margins, calculate what the price per call SHOULD be to hit 50%+ margin. State it explicitly: "Charge $X per call" or "Raise price by Y%".

2. **Usage-based pricing signals**: If some customers use a feature 10x more than others but pay the same, that's a clear signal for usage-based or tiered pricing. Quantify the spread and recommend a pricing model (per-call, tiered, or overage-based).

3. **Model routing opportunities**: If an expensive model is used for a feature where a cheaper model would work, calculate the savings. Be specific: "Routing 70% of summarization calls to haiku instead of sonnet saves $X/month".

4. **Margin trajectory**: If margins are improving or degrading over time, explain why and what to do about it. If model costs dropped but prices stayed flat, the client is leaving margin on the table — or could lower prices to grow volume.

5. **Customer profitability**: Flag customers who cost more to serve than they pay. Recommend whether to reprice, upsell, or accept the loss as acquisition cost.

6. **Cross-reference historic data**: If CSV/import data shows total historic spend, estimate how much went to each feature based on current usage proportions. Flag discrepancies between historic and current patterns.

Prioritize pricing recommendations and usage-based pricing signals — those are the highest-value insights. Every insight should end with a concrete "do this" action, not just an observation.

Return ONLY the JSON array, no markdown or explanation.`;

      // Check for OpenAI API key
      const openaiKey = process.env.OPENAI_API_KEY;
      let insights: Array<{
        insight_type: string;
        title: string;
        description: string;
        severity: string;
        feature_key?: string;
        customer_id?: string;
      }>;
      let tokensUsed = 0;
      let costUsd = 0;

      if (openaiKey) {
        const openaiResponse = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${openaiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-4o",
              messages: [{ role: "user", content: prompt }],
              temperature: 0.3,
              max_tokens: 3000,
            }),
          },
        );

        if (!openaiResponse.ok) {
          const errBody = await openaiResponse.text();
          console.error("OpenAI API error:", errBody);
          return res.status(502).json({
            error: "AI service unavailable. Check your OpenAI API key.",
          });
        }

        const completion = (await openaiResponse.json()) as {
          choices: Array<{ message: { content: string } }>;
          usage?: { total_tokens: number };
        };
        const content = completion.choices[0]?.message?.content || "[]";
        tokensUsed = completion.usage?.total_tokens || 0;
        const promptTokens =
          (completion.usage as Record<string, number>)?.prompt_tokens || 0;
        const completionTokens =
          (completion.usage as Record<string, number>)?.completion_tokens || 0;
        costUsd = promptTokens * 0.0000025 + completionTokens * 0.00001;

        try {
          const cleaned = content
            .replace(/^```json?\n?/i, "")
            .replace(/\n?```$/i, "")
            .trim();
          let parsed = JSON.parse(cleaned);
          // Handle wrapped responses like { "insights": [...] }
          if (
            !Array.isArray(parsed) &&
            parsed.insights &&
            Array.isArray(parsed.insights)
          ) {
            parsed = parsed.insights;
          }
          if (!Array.isArray(parsed)) {
            throw new Error("Expected JSON array from AI");
          }
          insights = parsed;
        } catch {
          console.error("Failed to parse OpenAI response:", content);
          return res
            .status(502)
            .json({ error: "AI returned invalid response. Try again." });
        }
      } else {
        // Fallback: generate consultant-grade insights locally without OpenAI
        insights = [];

        // 1. Pricing recommendations for features with poor margins
        for (const row of featureRes.rows) {
          const cost = parseFloat(row.total_cost) || 0;
          const revenue = parseFloat(row.total_revenue) || 0;
          const margin =
            revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : 0;
          const costPerCall = parseFloat(row.cost_per_call) || 0;
          const revenuePerCall = parseFloat(row.revenue_per_call) || 0;
          const events = parseInt(row.event_count) || 0;
          const targetRevenuePerCall = costPerCall / 0.5; // 50% margin target

          if (margin < 0) {
            insights.push({
              insight_type: "pricing_recommendation",
              title: `${row.feature_key}: charge $${targetRevenuePerCall.toFixed(4)}/call for 50% margin`,
              description: `This feature costs $${costPerCall.toFixed(4)}/call but you charge $${revenuePerCall.toFixed(4)}/call (${margin}% margin). To hit 50% margin, set the price to $${targetRevenuePerCall.toFixed(4)}/call. At ${events} calls, that recovers $${((targetRevenuePerCall - revenuePerCall) * events).toFixed(2)} in lost margin.`,
              severity: "critical",
              feature_key: row.feature_key,
            });
          } else if (margin < 30) {
            insights.push({
              insight_type: "pricing_recommendation",
              title: `${row.feature_key}: raise price to $${targetRevenuePerCall.toFixed(4)}/call`,
              description: `At ${margin}% margin and $${costPerCall.toFixed(4)} cost/call, this feature is underpriced. Raise per-call price from $${revenuePerCall.toFixed(4)} to $${targetRevenuePerCall.toFixed(4)} to reach 50% margin. That's a ${Math.round(((targetRevenuePerCall - revenuePerCall) / (revenuePerCall || 0.0001)) * 100)}% increase.`,
              severity: "warning",
              feature_key: row.feature_key,
            });
          }
        }

        // 2. Usage-based pricing signals from customer variance
        for (const row of customerFeatureRes.rows) {
          const min = parseInt(row.min_calls) || 0;
          const max = parseInt(row.max_calls) || 0;
          const customers = parseInt(row.unique_customers) || 0;
          const ratio = min > 0 ? Math.round(max / min) : max;

          if (ratio >= 5 && customers >= 2) {
            insights.push({
              insight_type: "usage_pricing_signal",
              title: `${row.feature_key}: ${ratio}x usage spread across customers`,
              description: `Your heaviest user of ${row.feature_key} makes ${max} calls vs ${min} for the lightest (${ratio}x spread across ${customers} customers). If they pay the same flat rate, you're subsidizing power users. Consider per-call pricing or usage tiers with an overage charge.`,
              severity: "warning",
              feature_key: row.feature_key,
            });
          }
        }

        // 3. Model routing opportunities
        const featureModels: Record<
          string,
          Array<{
            model: string;
            cost_per_call: number;
            event_count: number;
            total_cost: number;
          }>
        > = {};
        for (const row of featureModelRes.rows) {
          const key = row.feature_key;
          if (!featureModels[key]) featureModels[key] = [];
          featureModels[key].push({
            model: row.model,
            cost_per_call: parseFloat(row.cost_per_call) || 0,
            event_count: parseInt(row.event_count) || 0,
            total_cost: parseFloat(row.total_cost) || 0,
          });
        }
        for (const [feature, models] of Object.entries(featureModels)) {
          if (models.length >= 2) {
            const sorted = [...models].sort(
              (a, b) => b.cost_per_call - a.cost_per_call,
            );
            const expensive = sorted[0];
            const cheap = sorted[sorted.length - 1];
            if (expensive.cost_per_call > cheap.cost_per_call * 2) {
              const savingsIfRouted =
                (expensive.cost_per_call - cheap.cost_per_call) *
                expensive.event_count *
                0.7; // assume 70% routable
              insights.push({
                insight_type: "model_routing",
                title: `Route ${feature} calls from ${expensive.model} to ${cheap.model}`,
                description: `${expensive.model} costs $${expensive.cost_per_call.toFixed(4)}/call vs $${cheap.cost_per_call.toFixed(4)} for ${cheap.model} (${Math.round(expensive.cost_per_call / (cheap.cost_per_call || 0.0001))}x more expensive). Routing 70% of ${expensive.event_count} calls to the cheaper model saves ~$${savingsIfRouted.toFixed(2)}/period. Test quality on a sample before switching.`,
                severity: "info",
                feature_key: feature,
              });
            }
          }
        }

        // 4. Overall margin health
        if (overallMargin < 30) {
          insights.push({
            insight_type: "margin_alert",
            title: `Overall margin is ${overallMargin}% — below 30% threshold`,
            description: `Total costs ($${totalCost.toFixed(2)}) consume ${100 - overallMargin}% of revenue ($${totalRevenue.toFixed(2)}). Healthy AI SaaS targets 50%+ margin. Combine pricing increases on underperforming features with model routing to close the gap.`,
            severity: overallMargin < 0 ? "critical" : "warning",
          });
        } else {
          insights.push({
            insight_type: "margin_alert",
            title: `Overall margin is healthy at ${overallMargin}%`,
            description: `Revenue ($${totalRevenue.toFixed(2)}) covers costs ($${totalCost.toFixed(2)}) with ${overallMargin}% margin. You could lower prices to grow volume or maintain margin and invest in features.`,
            severity: "positive",
          });
        }

        // 5. Customer profitability risk
        for (const row of customerRes.rows) {
          const cost = parseFloat(row.total_cost) || 0;
          const revenue = parseFloat(row.total_revenue) || 0;
          const margin =
            revenue > 0 ? Math.round(((revenue - cost) / revenue) * 100) : -100;
          if (margin < 0 && cost > totalCost * 0.1) {
            insights.push({
              insight_type: "customer_risk",
              title: `${row.customer_name || row.customer_id} is unprofitable at ${margin}% margin`,
              description: `This customer costs $${cost.toFixed(2)} to serve but pays $${revenue.toFixed(2)} (${margin}% margin, ${Math.round((cost / totalCost) * 100)}% of your total cost). Either reprice their plan, add usage caps, or treat as acquisition cost with a timeline to convert.`,
              severity: "critical",
              customer_id: row.customer_id,
            });
          }
        }

        // 6. Margin trend
        if (trendRes.rows.length >= 2) {
          const recent = trendRes.rows[0];
          const older = trendRes.rows[trendRes.rows.length - 1];
          const recentMargin =
            parseFloat(recent.total_revenue) > 0
              ? Math.round(
                  ((parseFloat(recent.total_revenue) -
                    parseFloat(recent.total_cost)) /
                    parseFloat(recent.total_revenue)) *
                    100,
                )
              : 0;
          const olderMargin =
            parseFloat(older.total_revenue) > 0
              ? Math.round(
                  ((parseFloat(older.total_revenue) -
                    parseFloat(older.total_cost)) /
                    parseFloat(older.total_revenue)) *
                    100,
                )
              : 0;
          const delta = recentMargin - olderMargin;
          if (Math.abs(delta) >= 5) {
            insights.push({
              insight_type: delta > 0 ? "cost_optimization" : "margin_alert",
              title: `Margin ${delta > 0 ? "improved" : "dropped"} ${Math.abs(delta)}pp over ${trendRes.rows.length} months`,
              description: `Margin moved from ${olderMargin}% to ${recentMargin}% (${delta > 0 ? "+" : ""}${delta}pp). ${delta > 0 ? "If model costs dropped but your prices stayed flat, you could lower prices to grow volume or keep the extra margin." : "Check if usage patterns shifted to more expensive models, or if a specific feature or customer drove the increase."}`,
              severity: delta < -10 ? "warning" : "info",
            });
          }
        }

        // Prioritize: pricing recommendations first, then signals, then alerts
        const priority: Record<string, number> = {
          pricing_recommendation: 0,
          usage_pricing_signal: 1,
          model_routing: 2,
          customer_risk: 3,
          margin_alert: 4,
          cost_optimization: 5,
        };
        insights.sort(
          (a, b) =>
            (priority[a.insight_type] ?? 9) - (priority[b.insight_type] ?? 9),
        );
        insights = insights.slice(0, 6);
      }

      // Store insights
      const storedInsights: any[] = [];
      for (const insight of insights) {
        const result = await pool.query(
          `INSERT INTO ai_insights (user_id, insight_type, title, description, severity, feature_key, customer_id, tokens_used, cost_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
          [
            req.visitorId,
            insight.insight_type,
            insight.title,
            insight.description,
            insight.severity || "info",
            insight.feature_key || null,
            insight.customer_id || null,
            tokensUsed,
            costUsd,
          ],
        );
        storedInsights.push(result.rows[0]);
      }

      // Log the generation as an observe_event
      await pool.query(
        `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, cost_amount, cost_unit, source, granularity)
       VALUES ($1, 'system', 'ai_insights', 'insight_generated', $2, 'usd', 'system', 'event')`,
        [visitorId, costUsd],
      );

      // Track usage (insights are metered by counting ai_insights rows)
      trackBillingUsage(visitorId, "ai_insights", "insights_generated");

      res.json({
        insights: storedInsights,
        tokens_used: tokensUsed,
        cost_usd: costUsd,
        source: openaiKey ? "openai" : "local",
      });
    } catch (error) {
      console.error("Generate insights error:", error);
      res.status(500).json({ error: "Failed to generate insights" });
    }
  },
);

// DELETE /insights — clear all insights
app.delete(
  "/insights",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      await pool.query("DELETE FROM ai_insights WHERE user_id = $1", [
        req.visitorId,
      ]);
      res.json({ success: true });
    } catch (error) {
      console.error("Clear insights error:", error);
      res.status(500).json({ error: "Failed to clear insights" });
    }
  },
);

// GET /usage/limits — return current usage for ai_insights
app.get(
  "/usage/limits",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    const visitorId = req.visitorId!;
    try {
      const access = await checkBillingFeatureAccess(
        visitorId,
        "ai_insights",
        req.accountEmail,
      );
      res.json({
        configured: true,
        ai_insights: {
          allowed: access.allowed,
          usage: access.usage,
          limit: access.limit,
          remaining: access.remaining,
        },
      });
    } catch (err) {
      console.error("Usage limits check error:", err);
      res.status(503).json({
        configured: true,
        error: "Usage data temporarily unavailable",
      });
    }
  },
);

// Billing monetization routes are mounted via createBillingRoutes() above
// (inline duplicate block removed — was dead code shadowed by the router module)
// =============================================================================
// OPENAI & ANTHROPIC INTEGRATION ROUTES
// =============================================================================

// POST /integrations/openai/connect - Validate OpenAI API key and store connection
app.post(
  "/integrations/openai/connect",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      const { api_key } = req.body;

      if (!api_key || typeof api_key !== "string") {
        return res.status(400).json({ error: "api_key is required" });
      }

      // Validate key by calling OpenAI models endpoint
      const validationResponse = await fetch(
        "https://api.openai.com/v1/models",
        {
          headers: { Authorization: `Bearer ${api_key}` },
        },
      );

      if (!validationResponse.ok) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid OpenAI API key. Please check your key and try again.",
        });
      }

      // Store the connection
      const keyPrefix = api_key.substring(0, 8) + "...";

      // Try to fetch and sync usage data
      let hasUsageAccess = false;
      let totalCostSynced = 0;
      let eventsSynced = 0;

      try {
        const now = Math.floor(Date.now() / 1000);
        const thirtyDaysAgo = now - 30 * 24 * 60 * 60;

        const usageResponse = await fetch(
          `https://api.openai.com/v1/organization/usage/completions?start_time=${thirtyDaysAgo}&end_time=${now}&bucket_width=1d`,
          { headers: { Authorization: `Bearer ${api_key}` } },
        );

        if (usageResponse.ok) {
          hasUsageAccess = true;
          const usageData = (await usageResponse.json()) as {
            data?: Array<{
              results?: Array<{
                snapshot_id?: string;
                input_tokens?: number;
                output_tokens?: number;
              }>;
              start_time?: number;
            }>;
          };

          if (usageData.data && Array.isArray(usageData.data)) {
            for (const bucket of usageData.data) {
              const bucketTime = bucket.start_time
                ? new Date(bucket.start_time * 1000).toISOString()
                : new Date().toISOString();

              if (bucket.results && Array.isArray(bucket.results)) {
                for (const result of bucket.results) {
                  const modelName = result.snapshot_id || "unknown";
                  const inputTokens = result.input_tokens || 0;
                  const outputTokens = result.output_tokens || 0;

                  const cost = await calcCostFromDb(
                    pool,
                    modelName,
                    inputTokens,
                    outputTokens,
                  );

                  if (cost > 0) {
                    await pool.query(
                      `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, revenue_amount, usage_units, model, model_provider, source, granularity)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                      [
                        visitorId,
                        "system",
                        "openai_usage",
                        "cost",
                        bucketTime,
                        cost,
                        "usd",
                        0,
                        inputTokens + outputTokens,
                        modelName,
                        "openai",
                        "openai",
                        "daily",
                      ],
                    );
                    totalCostSynced += cost;
                    eventsSynced++;
                  }
                }
              }
            }
          }

          // Update has_usage_access and last_synced_at
          if (eventsSynced > 0) {
            const txClient = await pool.connect();
            try {
              await txClient.query("BEGIN");
              await clearSampleData(txClient, visitorId);
              await txClient.query(
                `INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()`,
                [visitorId, "user"],
              );
              await txClient.query("COMMIT");
            } catch (err) {
              await txClient
                .query("ROLLBACK")
                .catch((e) => console.error("ROLLBACK failed:", e));
              console.error("clearSampleData failed during OpenAI sync:", err);
            } finally {
              txClient.release();
            }
          }
        } else if (usageResponse.status === 403) {
          // No admin access - skip usage sync, still store the connection
          console.log(
            `OpenAI usage API returned 403 for user ${visitorId} - no admin access`,
          );
        }
      } catch (syncErr) {
        console.error(
          "OpenAI usage sync error (connection will still succeed):",
          syncErr,
        );
      }

      await pool.query(
        `INSERT INTO integrations (user_id, provider, api_key_prefix, has_usage_access, connected_at)
       VALUES ($1, 'openai', $2, $3, NOW())
       ON CONFLICT (user_id, provider)
       DO UPDATE SET api_key_prefix = $2, has_usage_access = $3, connected_at = NOW()`,
        [visitorId, keyPrefix, hasUsageAccess],
      );

      // Track OpenAI sync usage in billing
      trackBillingUsage(visitorId, "openai_sync", "openai_connected");

      res.json({
        success: true,
        message: "OpenAI connected successfully",
        has_usage_access: hasUsageAccess,
        cost_synced: Math.round(totalCostSynced * 100) / 100,
        months_synced: eventsSynced > 0 ? 1 : 0,
      });
    } catch (err) {
      console.error("OpenAI connect error:", err);
      res.status(500).json({ error: "Failed to connect OpenAI" });
    }
  },
);

// GET /integrations/openai/status - Check OpenAI connection status
app.get(
  "/integrations/openai/status",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      const result = await pool.query(
        `SELECT api_key_prefix, has_usage_access, connected_at, last_synced_at
       FROM integrations WHERE user_id = $1 AND provider = 'openai'`,
        [visitorId],
      );

      if (result.rows.length === 0) {
        return res.json({ connected: false, has_usage_access: false });
      }

      const row = result.rows[0];
      res.json({
        connected: true,
        has_usage_access: row.has_usage_access,
        api_key_prefix: row.api_key_prefix,
        connected_at: row.connected_at,
        last_synced_at: row.last_synced_at,
      });
    } catch (err) {
      console.error("OpenAI status error:", err);
      res.status(500).json({ error: "Failed to check OpenAI status" });
    }
  },
);

// POST /integrations/openai/disconnect - Disconnect OpenAI
app.post(
  "/integrations/openai/disconnect",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      await pool.query(
        "DELETE FROM integrations WHERE user_id = $1 AND provider = $2",
        [req.visitorId, "openai"],
      );
      res.json({ success: true });
    } catch (err) {
      console.error("OpenAI disconnect error:", err);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  },
);

// POST /integrations/anthropic/connect - Validate Anthropic API key and store connection
app.post(
  "/integrations/anthropic/connect",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      const { api_key } = req.body;

      if (!api_key || typeof api_key !== "string") {
        return res.status(400).json({ error: "api_key is required" });
      }

      // Validate key by checking auth against the models endpoint (no token cost)
      const validationResponse = await fetch(
        "https://api.anthropic.com/v1/models",
        {
          headers: {
            "x-api-key": api_key,
            "anthropic-version": "2023-06-01",
          },
        },
      );

      if (
        validationResponse.status === 401 ||
        validationResponse.status === 403
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid Anthropic API key. Please check your key and try again.",
        });
      }

      // Store the connection
      const keyPrefix = api_key.substring(0, 10) + "...";

      // Try to fetch and sync usage data
      let hasUsageAccess = false;
      let totalCostSynced = 0;
      let eventsSynced = 0;

      try {
        const today = new Date();
        const thirtyDaysAgo = new Date(
          today.getTime() - 30 * 24 * 60 * 60 * 1000,
        );
        const todayISO = today.toISOString().split("T")[0];
        const thirtyDaysAgoISO = thirtyDaysAgo.toISOString().split("T")[0];

        const usageResponse = await fetch(
          `https://api.anthropic.com/v1/organizations/usage?start_date=${thirtyDaysAgoISO}&end_date=${todayISO}`,
          {
            headers: {
              "x-api-key": api_key,
              "anthropic-version": "2023-06-01",
            },
          },
        );

        if (usageResponse.ok) {
          hasUsageAccess = true;
          const usageData = (await usageResponse.json()) as {
            data?: Array<{
              model?: string;
              input_tokens?: number;
              output_tokens?: number;
              date?: string;
            }>;
          };

          if (usageData.data && Array.isArray(usageData.data)) {
            for (const entry of usageData.data) {
              const modelName = entry.model || "unknown";
              const inputTokens = entry.input_tokens || 0;
              const outputTokens = entry.output_tokens || 0;
              const entryDate = entry.date
                ? new Date(entry.date).toISOString()
                : new Date().toISOString();

              const cost = await calcCostFromDb(
                pool,
                modelName,
                inputTokens,
                outputTokens,
              );

              if (cost > 0) {
                await pool.query(
                  `INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit, revenue_amount, usage_units, model, model_provider, source, granularity)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                  [
                    visitorId,
                    "system",
                    "anthropic_usage",
                    "cost",
                    entryDate,
                    cost,
                    "usd",
                    0,
                    inputTokens + outputTokens,
                    modelName,
                    "anthropic",
                    "anthropic",
                    "daily",
                  ],
                );
                totalCostSynced += cost;
                eventsSynced++;
              }
            }
          }

          // Update data_mode to 'user' if we synced any data
          if (eventsSynced > 0) {
            const txClient = await pool.connect();
            try {
              await txClient.query("BEGIN");
              await clearSampleData(txClient, visitorId);
              await txClient.query(
                `INSERT INTO user_data_status (user_id, data_mode) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET data_mode = $2, updated_at = NOW()`,
                [visitorId, "user"],
              );
              await txClient.query("COMMIT");
            } catch (err) {
              await txClient
                .query("ROLLBACK")
                .catch((e) => console.error("ROLLBACK failed:", e));
              console.error(
                "clearSampleData failed during Anthropic sync:",
                err,
              );
            } finally {
              txClient.release();
            }
          }
        } else if (usageResponse.status === 403) {
          // No admin access - skip usage sync, still store the connection
          console.log(
            `Anthropic usage API returned 403 for user ${visitorId} - no admin access`,
          );
        }
      } catch (syncErr) {
        console.error(
          "Anthropic usage sync error (connection will still succeed):",
          syncErr,
        );
      }

      await pool.query(
        `INSERT INTO integrations (user_id, provider, api_key_prefix, has_usage_access, connected_at)
       VALUES ($1, 'anthropic', $2, $3, NOW())
       ON CONFLICT (user_id, provider)
       DO UPDATE SET api_key_prefix = $2, has_usage_access = $3, connected_at = NOW()`,
        [visitorId, keyPrefix, hasUsageAccess],
      );

      // Track Anthropic sync usage in billing
      trackBillingUsage(visitorId, "anthropic_sync", "anthropic_connected");

      res.json({
        success: true,
        message: "Anthropic connected successfully",
        has_usage_access: hasUsageAccess,
        cost_synced: Math.round(totalCostSynced * 100) / 100,
        months_synced: eventsSynced > 0 ? 1 : 0,
      });
    } catch (err) {
      console.error("Anthropic connect error:", err);
      res.status(500).json({ error: "Failed to connect Anthropic" });
    }
  },
);

// GET /integrations/anthropic/status - Check Anthropic connection status
app.get(
  "/integrations/anthropic/status",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      const result = await pool.query(
        `SELECT api_key_prefix, has_usage_access, connected_at, last_synced_at
       FROM integrations WHERE user_id = $1 AND provider = 'anthropic'`,
        [visitorId],
      );

      if (result.rows.length === 0) {
        return res.json({ connected: false, has_usage_access: false });
      }

      const row = result.rows[0];
      res.json({
        connected: true,
        has_usage_access: row.has_usage_access,
        api_key_prefix: row.api_key_prefix,
        connected_at: row.connected_at,
        last_synced_at: row.last_synced_at,
      });
    } catch (err) {
      console.error("Anthropic status error:", err);
      res.status(500).json({ error: "Failed to check Anthropic status" });
    }
  },
);

// POST /integrations/anthropic/disconnect - Disconnect Anthropic
app.post(
  "/integrations/anthropic/disconnect",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      await pool.query(
        "DELETE FROM integrations WHERE user_id = $1 AND provider = $2",
        [req.visitorId, "anthropic"],
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Anthropic disconnect error:", err);
      res.status(500).json({ error: "Failed to disconnect" });
    }
  },
);

// =============================================================================
// REFERRAL SYSTEM
// =============================================================================

// Helper: convert a pending referral to 'converted' and grant a Stripe promo code to the referrer

// GET /referral/code - Get or create a referral code for the current user
app.get(
  "/referral/code",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      // Check if user already has a code
      const existing = await pool.query(
        `SELECT code FROM referral_codes WHERE user_id = $1`,
        [visitorId],
      );
      if (existing.rows.length > 0) {
        return res.json({ code: existing.rows[0].code });
      }
      // Generate a unique code
      const code = crypto.randomUUID().replace(/-/g, "").substring(0, 8);
      await pool.query(
        `INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)`,
        [visitorId, code],
      );
      res.json({ code });
    } catch (err) {
      console.error("Referral code error:", err);
      res.status(500).json({ error: "Failed to get referral code" });
    }
  },
);

// POST /referral/record - Record that the current user was referred by a code
app.post(
  "/referral/record",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      const { code } = req.body;
      if (!code || typeof code !== "string") {
        return res.status(400).json({ error: "Referral code is required" });
      }
      // Check if this user was already referred
      const existingReferral = await pool.query(
        `SELECT id FROM referrals WHERE referred_user_id = $1`,
        [visitorId],
      );
      if (existingReferral.rows.length > 0) {
        return res.json({ success: true, already_recorded: true });
      }
      // Look up the referral code
      const codeResult = await pool.query(
        `SELECT user_id FROM referral_codes WHERE code = $1`,
        [code],
      );
      if (codeResult.rows.length === 0) {
        return res.status(404).json({ error: "Invalid referral code" });
      }
      const referrerUserId = codeResult.rows[0].user_id;
      // Don't allow self-referral
      if (referrerUserId === visitorId) {
        return res
          .status(400)
          .json({ error: "Cannot use your own referral code" });
      }
      // Record the referral
      await pool.query(
        `INSERT INTO referrals (referrer_user_id, referred_user_id, referral_code, status)
       VALUES ($1, $2, $3, 'pending')`,
        [referrerUserId, visitorId, code],
      );

      // Track referral usage in billing for both referrer and referred user
      trackBillingUsage(referrerUserId, "referrals", "referral_shared");

      res.json({ success: true });
    } catch (err) {
      console.error("Record referral error:", err);
      res.status(500).json({ error: "Failed to record referral" });
    }
  },
);

// GET /referral/stats - Get referral statistics for the current user
app.get(
  "/referral/stats",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;

      // Get or create referral code
      let codeResult = await pool.query(
        `SELECT code FROM referral_codes WHERE user_id = $1`,
        [visitorId],
      );
      if (codeResult.rows.length === 0) {
        const code = crypto.randomUUID().replace(/-/g, "").substring(0, 8);
        await pool.query(
          `INSERT INTO referral_codes (user_id, code) VALUES ($1, $2)`,
          [visitorId, code],
        );
        codeResult = { rows: [{ code }] } as any;
      }
      const code = codeResult.rows[0].code;

      // Count referrals by status
      const statsResult = await pool.query(
        `SELECT
         COUNT(*)::int AS total_referrals,
         COUNT(*) FILTER (WHERE status = 'converted')::int AS converted_referrals,
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_referrals
       FROM referrals WHERE referrer_user_id = $1`,
        [visitorId],
      );

      // Get promo codes earned from referrals
      const promosResult = await pool.query(
        `SELECT promo_code, used_at, created_at
       FROM referral_credits WHERE user_id = $1 ORDER BY created_at DESC`,
        [visitorId],
      );

      const stats = statsResult.rows[0];
      res.json({
        code,
        total_referrals: stats.total_referrals,
        converted_referrals: stats.converted_referrals,
        pending_referrals: stats.pending_referrals,
        promos: promosResult.rows.map((r: any) => ({
          code: r.promo_code,
          used: !!r.used_at,
          created_at: r.created_at,
        })),
      });
    } catch (err) {
      console.error("Referral stats error:", err);
      res.status(500).json({ error: "Failed to get referral stats" });
    }
  },
);

// Integration requests (notify me / request integration)
app.post(
  "/integration-requests",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const { integration_name, request_type } = req.body;
      if (!integration_name) {
        return res.status(400).json({ error: "integration_name is required" });
      }
      await pool.query(
        `INSERT INTO integration_requests (user_id, integration_name, request_type)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, integration_name) DO NOTHING`,
        [req.visitorId, integration_name, request_type || "notify"],
      );
      res.json({ success: true });
    } catch (error) {
      console.error("Integration request error:", error);
      res.status(500).json({ error: "Failed to save request" });
    }
  },
);

// =============================================================================
// TEAM / ORGANIZATION
// =============================================================================

// Helper: get or create org for a visitor
async function getOrCreateOrg(visitorId: string) {
  // Check if visitor already has an org
  const mapResult = await pool.query(
    "SELECT org_id FROM visitor_org_map WHERE visitor_id = $1",
    [visitorId],
  );
  if (mapResult.rows.length > 0) {
    const orgId = mapResult.rows[0].org_id;
    const orgResult = await pool.query(
      "SELECT * FROM organizations WHERE id = $1",
      [orgId],
    );
    return orgResult.rows[0];
  }

  // Create new org
  const orgResult = await pool.query(
    "INSERT INTO organizations (name, owner_visitor_id) VALUES ($1, $2) RETURNING *",
    ["My Team", visitorId],
  );
  const org = orgResult.rows[0];

  // Map visitor to org
  await pool.query(
    "INSERT INTO visitor_org_map (visitor_id, org_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
    [visitorId, org.id],
  );

  // Add visitor as admin member
  await pool.query(
    `INSERT INTO organization_members (org_id, visitor_id, role, status, joined_at)
     VALUES ($1, $2, 'admin', 'active', NOW())`,
    [org.id, visitorId],
  );

  return org;
}

// GET /team - get current user's org info and members
app.get("/team", ensureVisitor, async (req: AuthRequest, res: Response) => {
  try {
    const visitorId = req.visitorId!;
    const org = await getOrCreateOrg(visitorId);

    const membersResult = await pool.query(
      `SELECT om.*, a.email AS account_email, a.name AS account_name
       FROM organization_members om
       LEFT JOIN accounts a ON a.visitor_id = om.visitor_id
       WHERE om.org_id = $1
       ORDER BY om.created_at ASC`,
      [org.id],
    );

    // Merge account email into invited_email for display if not already set
    const members = membersResult.rows.map((m: any) => ({
      ...m,
      invited_email: m.invited_email || m.account_email || null,
      account_name: undefined,
      account_email: undefined,
    }));

    // Find current user's role
    const myMember = members.find((m: any) => m.visitor_id === visitorId);
    const myRole = myMember?.role || "viewer";

    res.json({
      org,
      members,
      my_role: myRole,
    });
  } catch (err) {
    console.error("GET /team error:", err);
    res.status(500).json({ error: "Failed to load team info" });
  }
});

// PATCH /team/name - rename the org
app.patch(
  "/team/name",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      const { name } = req.body;
      if (!name || typeof name !== "string") {
        return res.status(400).json({ error: "Name is required" });
      }
      if (name.trim().length > 100) {
        return res
          .status(400)
          .json({ error: "Name must be 100 characters or fewer" });
      }

      const org = await getOrCreateOrg(visitorId);

      // Check admin
      const memberResult = await pool.query(
        "SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2",
        [org.id, visitorId],
      );
      if (!memberResult.rows.length || memberResult.rows[0].role !== "admin") {
        return res
          .status(403)
          .json({ error: "Only admins can rename the team" });
      }

      await pool.query("UPDATE organizations SET name = $1 WHERE id = $2", [
        name,
        org.id,
      ]);
      res.json({ success: true });
    } catch (err) {
      console.error("PATCH /team/name error:", err);
      res.status(500).json({ error: "Failed to rename team" });
    }
  },
);

// POST /team/invite - create an invite
app.post(
  "/team/invite",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      const { email, role } = req.body;

      const org = await getOrCreateOrg(visitorId);

      // Check admin
      const memberResult = await pool.query(
        "SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2",
        [org.id, visitorId],
      );
      if (!memberResult.rows.length || memberResult.rows[0].role !== "admin") {
        return res
          .status(403)
          .json({ error: "Only admins can invite members" });
      }

      const validRole = role === "admin" ? "admin" : "viewer";
      const normalizedEmail = email ? email.trim().toLowerCase() : null;

      // Prevent duplicate invites for the same email
      if (normalizedEmail) {
        const existing = await pool.query(
          `SELECT id, status FROM organization_members WHERE org_id = $1 AND LOWER(invited_email) = $2`,
          [org.id, normalizedEmail],
        );
        if (existing.rows.length > 0) {
          const match = existing.rows[0];
          if (match.status === "active") {
            return res
              .status(409)
              .json({ error: "This person is already a team member" });
          }
          // Replace the stale pending invite
          await pool.query("DELETE FROM organization_members WHERE id = $1", [
            match.id,
          ]);
        }
      }

      const inviteToken = crypto.randomUUID();

      await pool.query(
        `INSERT INTO organization_members (org_id, invited_email, invite_token, role, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
        [org.id, normalizedEmail, inviteToken, validRole],
      );

      res.json({ success: true, invite_token: inviteToken });
    } catch (err) {
      console.error("POST /team/invite error:", err);
      res.status(500).json({ error: "Failed to create invite" });
    }
  },
);

// GET /team/invite/:token - get invite info (no auth required)
app.get("/team/invite/:token", async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const result = await pool.query(
      `SELECT om.invited_email, om.role, o.name AS org_name
       FROM organization_members om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.invite_token = $1 AND om.status = 'pending'`,
      [token],
    );

    if (!result.rows.length) {
      return res
        .status(404)
        .json({ error: "Invite not found or already used" });
    }

    const row = result.rows[0];
    res.json({
      org_name: row.org_name,
      invited_email: row.invited_email,
      role: row.role,
    });
  } catch (err) {
    console.error("GET /team/invite/:token error:", err);
    res.status(500).json({ error: "Failed to get invite info" });
  }
});

// POST /team/join/:token - accept an invite
app.post(
  "/team/join/:token",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      const { token } = req.params;

      const result = await pool.query(
        `SELECT om.*, o.id AS organization_id
       FROM organization_members om
       JOIN organizations o ON o.id = om.org_id
       WHERE om.invite_token = $1 AND om.status = 'pending'`,
        [token],
      );

      if (!result.rows.length) {
        return res
          .status(404)
          .json({ error: "Invite not found or already used" });
      }

      const invite = result.rows[0];

      // Update invite to active
      await pool.query(
        `UPDATE organization_members
       SET visitor_id = $1, status = 'active', joined_at = NOW(), invite_token = NULL
       WHERE id = $2`,
        [visitorId, invite.id],
      );

      // Map visitor to org (overwrite any existing mapping)
      await pool.query(
        `INSERT INTO visitor_org_map (visitor_id, org_id) VALUES ($1, $2)
       ON CONFLICT (visitor_id) DO UPDATE SET org_id = $2`,
        [visitorId, invite.organization_id],
      );

      res.json({
        success: true,
        org_id: String(invite.organization_id),
        role: invite.role,
      });
    } catch (err) {
      console.error("POST /team/join/:token error:", err);
      res.status(500).json({ error: "Failed to accept invite" });
    }
  },
);

// PATCH /team/members/:id - update member role
app.patch(
  "/team/members/:id",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      const memberId = req.params.id;
      const { role } = req.body;

      if (!role || !["admin", "viewer"].includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }

      const org = await getOrCreateOrg(visitorId);

      // Check admin
      const adminCheck = await pool.query(
        "SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2",
        [org.id, visitorId],
      );
      if (!adminCheck.rows.length || adminCheck.rows[0].role !== "admin") {
        return res.status(403).json({ error: "Only admins can change roles" });
      }

      // Prevent demoting yourself if you're the last admin
      const targetMember = await pool.query(
        "SELECT * FROM organization_members WHERE id = $1 AND org_id = $2",
        [memberId, org.id],
      );
      if (!targetMember.rows.length) {
        return res.status(404).json({ error: "Member not found" });
      }

      if (targetMember.rows[0].visitor_id === visitorId && role !== "admin") {
        const adminCount = await pool.query(
          "SELECT COUNT(*) FROM organization_members WHERE org_id = $1 AND role = 'admin' AND status = 'active'",
          [org.id],
        );
        if (parseInt(adminCount.rows[0].count) <= 1) {
          return res
            .status(400)
            .json({ error: "Cannot demote yourself — you are the only admin" });
        }
      }

      // Update the target member (must be in same org)
      const updateResult = await pool.query(
        "UPDATE organization_members SET role = $1 WHERE id = $2 AND org_id = $3 RETURNING id",
        [role, memberId, org.id],
      );

      if (!updateResult.rows.length) {
        return res.status(404).json({ error: "Member not found" });
      }

      res.json({ success: true });
    } catch (err) {
      console.error("PATCH /team/members/:id error:", err);
      res.status(500).json({ error: "Failed to update role" });
    }
  },
);

// DELETE /team/members/:id - remove a member
app.delete(
  "/team/members/:id",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;
      const memberId = req.params.id;

      const org = await getOrCreateOrg(visitorId);

      // Check admin
      const adminCheck = await pool.query(
        "SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2",
        [org.id, visitorId],
      );
      if (!adminCheck.rows.length || adminCheck.rows[0].role !== "admin") {
        return res
          .status(403)
          .json({ error: "Only admins can remove members" });
      }

      // Get the member to remove
      const memberResult = await pool.query(
        "SELECT * FROM organization_members WHERE id = $1 AND org_id = $2",
        [memberId, org.id],
      );
      if (!memberResult.rows.length) {
        return res.status(404).json({ error: "Member not found" });
      }

      const member = memberResult.rows[0];

      // Don't allow removing yourself
      if (member.visitor_id === visitorId) {
        return res.status(400).json({ error: "Cannot remove yourself" });
      }

      // Remove visitor-org mapping if they have one
      if (member.visitor_id) {
        await pool.query(
          "DELETE FROM visitor_org_map WHERE visitor_id = $1 AND org_id = $2",
          [member.visitor_id, org.id],
        );
      }

      await pool.query("DELETE FROM organization_members WHERE id = $1", [
        memberId,
      ]);
      res.json({ success: true });
    } catch (err) {
      console.error("DELETE /team/members/:id error:", err);
      res.status(500).json({ error: "Failed to remove member" });
    }
  },
);

// GET /team/my-role - get current user's role
app.get(
  "/team/my-role",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const visitorId = req.visitorId!;

      const mapResult = await pool.query(
        "SELECT org_id FROM visitor_org_map WHERE visitor_id = $1",
        [visitorId],
      );

      if (!mapResult.rows.length) {
        return res.json({ role: "viewer", org_id: "" });
      }

      const orgId = mapResult.rows[0].org_id;
      const memberResult = await pool.query(
        "SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2",
        [orgId, visitorId],
      );

      res.json({
        role: memberResult.rows.length ? memberResult.rows[0].role : "viewer",
        org_id: String(orgId),
      });
    } catch (err) {
      console.error("GET /team/my-role error:", err);
      res.status(500).json({ error: "Failed to get role" });
    }
  },
);

// ─── Inference Engine ───────────────────────────────────────────────────────

async function computeInferenceProfiles(userId: string): Promise<number> {
  const result = await pool.query(
    `SELECT model_provider, feature_key,
            COUNT(*)::int as event_count,
            SUM(cost_amount)::numeric as total_cost
     FROM observe_events
     WHERE user_id = $1 AND source = 'sdk' AND model_provider IS NOT NULL
     GROUP BY model_provider, feature_key`,
    [userId],
  );

  if (result.rows.length === 0) return 0;

  // Group by provider, compute distribution ratios based on cost
  const providerData: Record<
    string,
    { features: Record<string, number>; totalCost: number; totalCount: number }
  > = {};
  for (const row of result.rows) {
    const provider = row.model_provider;
    if (!providerData[provider]) {
      providerData[provider] = { features: {}, totalCost: 0, totalCount: 0 };
    }
    const cost = parseFloat(row.total_cost) || 0;
    providerData[provider].features[row.feature_key] = cost;
    providerData[provider].totalCost += cost;
    providerData[provider].totalCount += row.event_count;
  }

  let profilesUpdated = 0;
  for (const [provider, data] of Object.entries(providerData)) {
    const distribution: Record<string, number> = {};
    if (data.totalCost > 0) {
      for (const [feature, cost] of Object.entries(data.features)) {
        distribution[feature] =
          Math.round((cost / data.totalCost) * 10000) / 10000;
      }
    } else {
      const featureCount = Object.keys(data.features).length;
      for (const feature of Object.keys(data.features)) {
        distribution[feature] = Math.round((1 / featureCount) * 10000) / 10000;
      }
    }

    const windowResult = await pool.query(
      `SELECT MIN(timestamp) as window_start, MAX(timestamp) as window_end
       FROM observe_events
       WHERE user_id = $1 AND source = 'sdk' AND model_provider = $2`,
      [userId, provider],
    );

    await pool.query(
      `INSERT INTO inference_profiles (user_id, profile_type, scope_key, distribution, sample_count, time_window_start, time_window_end)
       VALUES ($1, 'feature_distribution', $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, profile_type, scope_key) DO UPDATE SET
         distribution = EXCLUDED.distribution,
         sample_count = EXCLUDED.sample_count,
         time_window_start = EXCLUDED.time_window_start,
         time_window_end = EXCLUDED.time_window_end,
         created_at = NOW()`,
      [
        userId,
        provider,
        JSON.stringify(distribution),
        data.totalCount,
        windowResult.rows[0]?.window_start,
        windowResult.rows[0]?.window_end,
      ],
    );
    profilesUpdated++;
  }

  return profilesUpdated;
}

function getConfidence(sampleCount: number): number {
  if (sampleCount >= 50) return 0.85;
  if (sampleCount >= 10) return 0.65;
  return 0.4;
}

async function applyInference(
  userId: string,
): Promise<{ rows_inferred: number; rows_split: number }> {
  const coarseRows = await pool.query(
    `SELECT id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit,
            revenue_amount, usage_units, model, model_provider, source, granularity, properties
     FROM observe_events
     WHERE user_id = $1
       AND source IN ('csv', 'openai', 'anthropic')
       AND granularity IN ('monthly_aggregate', 'daily')
       AND is_inferred = false
       AND (properties->>'inference_status') IS NULL`,
    [userId],
  );

  if (coarseRows.rows.length === 0) return { rows_inferred: 0, rows_split: 0 };

  const profiles = await pool.query(
    `SELECT scope_key, distribution, sample_count
     FROM inference_profiles
     WHERE user_id = $1 AND profile_type = 'feature_distribution'`,
    [userId],
  );

  if (profiles.rows.length === 0) return { rows_inferred: 0, rows_split: 0 };

  const profileMap: Record<
    string,
    { distribution: Record<string, number>; sample_count: number }
  > = {};
  for (const p of profiles.rows) {
    profileMap[p.scope_key] = {
      distribution: p.distribution,
      sample_count: p.sample_count,
    };
  }

  let rowsInferred = 0;
  let rowsSplit = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const row of coarseRows.rows) {
      // Match by model_provider or by feature_key that matches a provider name
      const provider = row.model_provider || row.feature_key;
      const profile = profileMap[provider];
      if (!profile) continue;

      const distribution = profile.distribution;
      const featureKeys = Object.keys(distribution);
      if (featureKeys.length === 0) continue;

      const confidence = getConfidence(profile.sample_count);
      const originalCost = parseFloat(row.cost_amount) || 0;
      const originalRevenue = parseFloat(row.revenue_amount) || 0;
      const originalUsage = parseFloat(row.usage_units) || 0;
      const properties = row.properties || {};

      // Save originals, zero out amounts, mark as split_source
      const updatedProperties = {
        ...properties,
        original_cost_amount: originalCost,
        original_revenue_amount: originalRevenue,
        inference_status: "split_source",
      };

      await client.query(
        `UPDATE observe_events
         SET cost_amount = 0, revenue_amount = 0, properties = $1
         WHERE id = $2`,
        [JSON.stringify(updatedProperties), row.id],
      );
      rowsSplit++;

      // Insert child rows proportionally
      for (const [featureKey, ratio] of Object.entries(distribution)) {
        const childCost = Math.round(originalCost * ratio * 10000) / 10000;
        const childRevenue =
          Math.round(originalRevenue * ratio * 10000) / 10000;
        const childUsage = Math.round(originalUsage * ratio * 10000) / 10000;

        await client.query(
          `INSERT INTO observe_events
           (user_id, customer_id, feature_key, event_name, timestamp, cost_amount, cost_unit,
            revenue_amount, usage_units, model, model_provider, source, granularity, properties,
            is_inferred, inference_method, inference_confidence, inferred_from_source, original_event_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
                   true, 'proportional', $15, $16, $17)`,
          [
            userId,
            row.customer_id,
            featureKey,
            row.event_name,
            row.timestamp,
            childCost,
            row.cost_unit,
            childRevenue,
            childUsage,
            row.model,
            row.model_provider || provider,
            row.source,
            row.granularity,
            JSON.stringify({ inferred_from_profile: provider }),
            confidence,
            row.source,
            row.id,
          ],
        );
        rowsInferred++;
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { rows_inferred: rowsInferred, rows_split: rowsSplit };
}

app.post(
  "/inference/run",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.visitorId!;
      const profilesUpdated = await computeInferenceProfiles(userId);
      const { rows_inferred, rows_split } = await applyInference(userId);
      res.json({
        profiles_updated: profilesUpdated,
        rows_inferred,
        rows_split,
      });
    } catch (err) {
      console.error("POST /inference/run error:", err);
      res.status(500).json({ error: "Inference run failed" });
    }
  },
);

app.get(
  "/inference/profiles",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const result = await pool.query(
        `SELECT id, profile_type, scope_key, distribution, sample_count,
              time_window_start, time_window_end, created_at
       FROM inference_profiles
       WHERE user_id = $1
       ORDER BY created_at DESC`,
        [req.visitorId],
      );
      res.json(result.rows);
    } catch (err) {
      console.error("GET /inference/profiles error:", err);
      res.status(500).json({ error: "Failed to fetch inference profiles" });
    }
  },
);

// ─── Helicone data import ─────────────────────────────────────────────────
// Accepts Helicone's JSON export format and maps to observe_events
const heliconeEventSchema = z.object({
  request_id: z.string().optional(),
  created_at: z.string().optional(),
  model: z.string().optional(),
  provider: z.string().optional(),
  prompt_tokens: z.number().optional(),
  completion_tokens: z.number().optional(),
  total_tokens: z.number().optional(),
  cost: z.number().optional(),
  user_id: z.string().optional(),
  // Helicone custom properties
  properties: z.record(z.string()).optional(),
});

app.post(
  "/import/helicone",
  ensureVisitor,
  async (req: AuthRequest, res: Response) => {
    try {
      const userId = req.visitorId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });

      const body = z
        .object({
          events: z.array(heliconeEventSchema).min(1).max(10000),
        })
        .safeParse(req.body);

      if (!body.success) {
        return res
          .status(400)
          .json({ error: "Invalid format", details: body.error.flatten() });
      }

      const events = body.data.events;
      let imported = 0;

      for (const event of events) {
        const model = event.model || "unknown";
        const provider =
          event.provider || inferModelProvider(model) || "unknown";
        const inputTokens = event.prompt_tokens || 0;
        const outputTokens = event.completion_tokens || 0;
        const cost = event.cost || 0;
        const customerId =
          event.user_id || event.properties?.["Helicone-User-Id"] || "unknown";
        const featureKey =
          event.properties?.["Helicone-Session-Id"] ||
          event.properties?.["feature"] ||
          "imported";
        const timestamp = event.created_at
          ? new Date(event.created_at)
          : new Date();
        const idempotencyKey = event.request_id || null;

        const result = await pool.query(
          `INSERT INTO observe_events (
          user_id, customer_id, feature_key, event_name, timestamp,
          cost_amount, cost_unit, revenue_amount, usage_units,
          model, model_provider, source, granularity, is_inferred, properties,
          idempotency_key
        ) VALUES ($1, $2, $3, 'cost', $4, $5, 'usd', 0, $6, $7, $8, 'helicone_import', 'event', false, $9, $10)
        ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
          [
            userId,
            customerId,
            featureKey,
            timestamp,
            cost,
            inputTokens + outputTokens,
            model,
            provider,
            JSON.stringify(event.properties || {}),
            idempotencyKey,
          ],
        );
        if (result.rowCount && result.rowCount > 0) imported++;
      }

      res.json({ success: true, imported, total: events.length });
    } catch (err) {
      console.error("POST /import/helicone error:", err);
      res.status(500).json({ error: "Import failed" });
    }
  },
);

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
