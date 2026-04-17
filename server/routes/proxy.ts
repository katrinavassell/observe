import { Router, Request, Response } from "express";
import type { Pool } from "pg";
import crypto from "crypto";
import { type AuthRequest } from "./auth.js";
import { calculateCostFromTokens as calcCostFromDb } from "../model-pricing.js";
import { checkAlerts } from "./alerts.js";

type GetAdminVisitorIdFn = () => Promise<string | null>;

async function resolveAccountIdForUser(
  pool: Pool,
  userId: string,
): Promise<number | null> {
  try {
    const result = await pool.query(
      `SELECT account_id FROM user_accounts
        WHERE user_id = (SELECT id FROM users WHERE visitor_id = $1)
          AND role = 'owner' LIMIT 1`,
      [userId],
    );
    if (result.rows[0]) return result.rows[0].account_id;
  } catch (err) {
    console.error("proxy: account_id fallback lookup failed:", err);
  }
  console.warn("proxy: no account_id resolved for user", userId);
  return null;
}

function parseProxyHeaders(req: Request): {
  observeKey: string | undefined;
  customerId: string;
  featureKey: string;
  properties: Record<string, string>;
  agentId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string;
} {
  // Auth: Observe-Key (RFC 6648 preferred) > x-tanso-key > x-observe-key > Helicone-Auth
  let observeKey =
    (req.headers["observe-key"] as string | undefined) ||
    (req.headers["x-tanso-key"] as string | undefined) ||
    (req.headers["x-observe-key"] as string | undefined);
  const heliconeAuth = req.headers["helicone-auth"] as string | undefined;
  if (!observeKey && heliconeAuth?.startsWith("Bearer ")) {
    observeKey = heliconeAuth.slice(7).trim();
  }

  // Customer: Observe-Customer > x-tanso-customer > Helicone-User-Id > x-observe-customer > "default"
  const customerId =
    (req.headers["observe-customer"] as string) ||
    (req.headers["x-tanso-customer"] as string) ||
    (req.headers["helicone-user-id"] as string) ||
    (req.headers["x-observe-customer"] as string) ||
    "default";

  // Feature: Observe-Feature > x-tanso-feature > Helicone-Session-Id > x-observe-feature
  const featureKey =
    (req.headers["observe-feature"] as string) ||
    (req.headers["x-tanso-feature"] as string) ||
    (req.headers["helicone-session-id"] as string) ||
    (req.headers["x-observe-feature"] as string) ||
    "";

  // Collect Observe-Property-* and Helicone-Property-* headers as properties
  const properties: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value !== "string") continue;
    if (key.startsWith("observe-property-")) {
      properties[key.replace("observe-property-", "")] = value;
    } else if (key.startsWith("helicone-property-")) {
      properties[key.replace("helicone-property-", "")] = value;
    }
  }

  const agentId =
    (req.headers["observe-agent"] as string) ||
    (req.headers["x-tanso-agent"] as string) ||
    "";

  const traceId =
    (req.headers["observe-trace-id"] as string) ||
    (req.headers["x-tanso-trace-id"] as string) ||
    "";
  const spanId =
    (req.headers["observe-span-id"] as string) ||
    (req.headers["x-tanso-span-id"] as string) ||
    "";
  const parentSpanId =
    (req.headers["observe-parent-span-id"] as string) ||
    (req.headers["x-tanso-parent-span-id"] as string) ||
    "";

  return {
    observeKey,
    customerId,
    featureKey,
    properties,
    agentId,
    traceId,
    spanId,
    parentSpanId,
  };
}

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

export function createProxyRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    getAdminVisitorId: GetAdminVisitorIdFn;
  },
) {
  const router = Router();

  async function lookupCache(
    userId: string,
    cacheKey: string,
  ): Promise<Record<string, unknown> | null> {
    const accountId = await resolveAccountIdForUser(pool, userId);
    const result = await pool.query(
      `SELECT response_body FROM proxy_cache
       WHERE account_id = $1 AND cache_key = $2
         AND (expires_at IS NULL OR expires_at > NOW())`,
      [accountId, cacheKey],
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
    const accountId = await resolveAccountIdForUser(pool, userId);
    await pool.query(
      `INSERT INTO proxy_cache (user_id, account_id, cache_key, model, request_hash, response_body, tokens_saved, cost_saved, expires_at)
       VALUES ($1, $2, $3, $4, $3, $5, $6, $7, NOW() + ($8 || ' seconds')::INTERVAL)
       ON CONFLICT (user_id, cache_key) DO UPDATE SET
         response_body = EXCLUDED.response_body,
         tokens_saved = proxy_cache.tokens_saved + EXCLUDED.tokens_saved,
         cost_saved = proxy_cache.cost_saved + EXCLUDED.cost_saved,
         expires_at = EXCLUDED.expires_at`,
      [
        userId,
        accountId,
        cacheKey,
        model,
        responseBody,
        tokensSaved,
        costSaved,
        String(ttlSeconds),
      ],
    );
  }

  async function calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
  ): Promise<number> {
    return calcCostFromDb(pool, model, inputTokens, outputTokens);
  }

  async function resolveProxyUserId(
    observeKey: string,
  ): Promise<string | null> {
    const keyHash = crypto
      .createHash("sha256")
      .update(observeKey)
      .digest("hex");
    const result = await pool.query(
      "SELECT user_id FROM sdk_api_keys WHERE key_hash = $1 AND revoked_at IS NULL",
      [keyHash],
    );
    if (result.rows.length === 0) return null;
    pool
      .query(
        "UPDATE sdk_api_keys SET last_used_at = NOW() WHERE key_hash = $1",
        [keyHash],
      )
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
    agentId: string = "",
    traceId: string = "",
    spanId: string = "",
    parentSpanId: string = "",
    durationMs: number | null = null,
    costType: string = "llm",
  ): Promise<void> {
    const propsJson = JSON.stringify(properties);
    const reqJson = requestBody ? JSON.stringify(requestBody) : null;
    const resJson = responseBody ? JSON.stringify(responseBody) : null;
    const totalTokens = inputTokens + outputTokens;
    const accountId = await resolveAccountIdForUser(pool, userId);

    // Revenue enrichment: feature_pricing > MRR allocation > 0
    let revenue = 0;
    let revenueSource = "none";
    try {
      const fpResult = await pool.query(
        `SELECT revenue_per_unit FROM feature_pricing WHERE account_id = $1 AND feature_key = $2`,
        [accountId, featureKey],
      );
      if (fpResult.rows.length > 0) {
        revenue = parseFloat(fpResult.rows[0].revenue_per_unit);
        revenueSource = "feature_pricing";
      } else if (customerId && customerId !== "unknown") {
        const mrrResult = await pool.query(
          `SELECT SUM(mrr_override) as mrr FROM subscriptions
           WHERE account_id = $1 AND is_active = true AND customer_id = $2`,
          [accountId, customerId],
        );
        if (mrrResult.rows[0]?.mrr) {
          revenue = parseFloat(mrrResult.rows[0].mrr) / 30;
          revenueSource = "mrr_allocation";
        }
      }
    } catch (err) {
      console.error("Proxy revenue enrichment failed:", err);
    }

    // 1. Log for the user
    await pool.query(
      `INSERT INTO observe_events (
        user_id, account_id, customer_id, feature_key, event_name, timestamp,
        cost_amount, cost_unit, revenue_amount, usage_units,
        model, model_provider, source, granularity, is_inferred, properties,
        request_body, response_body, revenue_source, agent_id,
        trace_id, span_id, parent_span_id, duration_ms, cost_type
      ) VALUES ($1, $2, $3, $4, 'cost', NOW(), $5, 'usd', $6, $7, $8, $9, 'proxy', 'event', false, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [
        userId,
        accountId,
        customerId,
        featureKey,
        cost,
        revenue,
        totalTokens,
        model,
        provider,
        propsJson,
        reqJson,
        resJson,
        revenueSource,
        agentId || null,
        traceId || null,
        spanId || null,
        parentSpanId || null,
        durationMs,
        costType,
      ],
    );
    checkAlerts(pool, userId).catch((err) =>
      console.error("checkAlerts error (proxy event):", err),
    );

    // 2. Mirror to admin account so admin@example.com sees all activity
    deps
      .getAdminVisitorId()
      .then(async (adminId) => {
        if (!adminId || adminId === userId) return;
        const adminAccountId = await resolveAccountIdForUser(pool, adminId);
        pool
          .query(
            `INSERT INTO observe_events (
          user_id, account_id, customer_id, feature_key, event_name, timestamp,
          cost_amount, cost_unit, revenue_amount, usage_units,
          model, model_provider, source, granularity, is_inferred, properties,
          request_body, response_body, revenue_source, agent_id,
          trace_id, span_id, parent_span_id, duration_ms, cost_type
        ) VALUES ($1, $2, $3, $4, 'cost', NOW(), $5, 'usd', $6, $7, $8, $9, 'proxy', 'event', false, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
            [
              adminId,
              adminAccountId,
              customerId,
              featureKey,
              cost,
              revenue,
              totalTokens,
              model,
              provider,
              propsJson,
              reqJson,
              resJson,
              revenueSource,
              agentId || null,
              traceId || null,
              spanId || null,
              parentSpanId || null,
              durationMs,
              costType,
            ],
          )
          .catch((err) =>
            console.error("Admin proxy event mirror error:", err),
          );
      })
      .catch((err) => console.error("Admin proxy mirror error:", err));
  }

  // GET /v1/models — proxy to OpenAI
  router.get("/v1/models", async (req: Request, res: Response) => {
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
  router.post("/v1/chat/completions", async (req: Request, res: Response) => {
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
        agentId,
        traceId,
        spanId,
        parentSpanId,
      } = parseProxyHeaders(req);
      if (!observeKey) {
        return res.status(401).json({
          error: {
            message: "Missing observe key (Observe-Key header)",
            type: "auth_error",
          },
        });
      }
      const userId = await resolveProxyUserId(observeKey);
      if (!userId) {
        return res.status(401).json({
          error: {
            message: "Invalid or revoked observe key",
            type: "auth_error",
          },
        });
      }
      const featureKey = feat || "chat_completions";
      const model = req.body.model || "unknown";
      const { cacheEnabled, ttlSeconds } = parseCacheHeaders(req);
      const isCacheable =
        cacheEnabled &&
        !req.body.stream &&
        !(req.body.temperature > 0) &&
        userId;

      // Cache lookup
      if (isCacheable && userId) {
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
            agentId,
            traceId,
            spanId,
            parentSpanId,
            null,
            "llm",
          ).catch((err) =>
            console.error("logProxyEvent error (openai cache hit):", err),
          );
          return;
        }
      }

      // Streaming not supported — reject early with clear message
      if (req.body.stream) {
        return res.status(400).json({
          error:
            "Streaming is not supported through the Observe proxy. Set stream: false or use the provider directly for streaming.",
        });
      }

      // Forward to OpenAI
      const proxyStart = Date.now();
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
      const durationMs = Date.now() - proxyStart;
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
          agentId,
          traceId,
          spanId,
          parentSpanId,
          durationMs,
          "llm",
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
  router.post("/v1/embeddings", async (req: Request, res: Response) => {
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
        agentId,
        traceId,
        spanId,
        parentSpanId,
      } = parseProxyHeaders(req);
      if (!observeKey) {
        return res.status(401).json({
          error: {
            message: "Missing observe key (Observe-Key header)",
            type: "auth_error",
          },
        });
      }
      const userId = await resolveProxyUserId(observeKey);
      if (!userId) {
        return res.status(401).json({
          error: {
            message: "Invalid or revoked observe key",
            type: "auth_error",
          },
        });
      }
      const featureKey = feat || "embeddings";
      const model = req.body.model || "unknown";
      const { cacheEnabled, ttlSeconds } = parseCacheHeaders(req);
      const isCacheable = cacheEnabled && !req.body.stream && userId;

      // Cache lookup (embeddings are always deterministic)
      if (isCacheable && userId) {
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
            agentId,
            traceId,
            spanId,
            parentSpanId,
            null,
            "embedding",
          ).catch((err) =>
            console.error("logProxyEvent error (openai cache hit):", err),
          );
          return;
        }
      }

      const proxyStart = Date.now();
      const openaiResponse = await fetch(
        "https://api.openai.com/v1/embeddings",
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
      const durationMs = Date.now() - proxyStart;
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
          agentId,
          traceId,
          spanId,
          parentSpanId,
          durationMs,
          "embedding",
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

  // POST /v1/messages — Anthropic proxy + log (Helicone-compatible)
  router.post("/v1/messages", async (req: Request, res: Response) => {
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
        agentId,
        traceId,
        spanId,
        parentSpanId,
      } = parseProxyHeaders(req);
      if (!observeKey) {
        return res.status(401).json({
          error: {
            message: "Missing observe key (Observe-Key header)",
            type: "auth_error",
          },
        });
      }
      const userId = await resolveProxyUserId(observeKey);
      if (!userId) {
        return res.status(401).json({
          error: {
            message: "Invalid or revoked observe key",
            type: "auth_error",
          },
        });
      }
      const featureKey = feat || "messages";
      const model = req.body.model || "unknown";

      const { cacheEnabled, ttlSeconds } = parseCacheHeaders(req);
      // Anthropic defaults temperature to 1 when omitted — only cache explicit temperature: 0
      const isCacheable =
        cacheEnabled &&
        !req.body.stream &&
        userId &&
        req.body.temperature === 0;

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
            agentId,
            traceId,
            spanId,
            parentSpanId,
            null,
            "llm",
          ).catch((err) =>
            console.error("logProxyEvent error (anthropic cache hit):", err),
          );
          return;
        }
      }

      // Forward to Anthropic
      const proxyStart = Date.now();
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
      const durationMs = Date.now() - proxyStart;
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
        const cost = await calcCostFromDb(
          pool,
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
          agentId,
          traceId,
          spanId,
          parentSpanId,
          durationMs,
          "llm",
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

  // POST /v1/google/generateContent — Google Gemini proxy + log
  router.post(
    "/v1/google/generateContent",
    async (req: Request, res: Response) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return res.status(401).json({
            error: {
              message: "Missing Authorization header (Google API key)",
              type: "auth_error",
            },
          });
        }

        const {
          observeKey,
          customerId,
          featureKey: feat,
          properties,
          agentId,
          traceId,
          spanId,
          parentSpanId,
        } = parseProxyHeaders(req);
        if (!observeKey) {
          return res.status(401).json({
            error: {
              message: "Missing observe key (Observe-Key header)",
              type: "auth_error",
            },
          });
        }
        const userId = await resolveProxyUserId(observeKey);
        if (!userId) {
          return res.status(401).json({
            error: {
              message: "Invalid or revoked observe key",
              type: "auth_error",
            },
          });
        }
        const featureKey = feat || "generate_content";
        const model = req.body.model || "gemini-2.5-flash";

        // Google uses ?key= query param for auth
        const apiKey = authHeader.replace(/^Bearer\s+/i, "");
        const upstreamUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

        const proxyStart = Date.now();
        const googleResponse = await fetch(upstreamUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req.body),
        });

        const data = (await googleResponse.json()) as Record<string, unknown>;
        const durationMs = Date.now() - proxyStart;
        res.status(googleResponse.status).json(data);

        if (userId && googleResponse.ok && data.usageMetadata) {
          const usage = data.usageMetadata as {
            promptTokenCount?: number;
            candidatesTokenCount?: number;
          };
          const respModel = model;
          const inputTokens = usage.promptTokenCount || 0;
          const outputTokens = usage.candidatesTokenCount || 0;
          const cost = await calculateCost(
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
            "google",
            properties,
            req.body,
            data,
            agentId,
            traceId,
            spanId,
            parentSpanId,
            durationMs,
            "llm",
          ).catch((err) =>
            console.error("Google proxy event logging failed:", err),
          );
        }
      } catch (error) {
        console.error("POST /v1/google/generateContent proxy error:", error);
        res.status(502).json({
          error: {
            message: "Failed to reach Google Gemini",
            type: "proxy_error",
          },
        });
      }
    },
  );

  // POST /v1/cohere/chat — Cohere proxy + log
  router.post("/v1/cohere/chat", async (req: Request, res: Response) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({
          error: {
            message: "Missing Authorization header (Cohere key)",
            type: "auth_error",
          },
        });
      }

      const {
        observeKey,
        customerId,
        featureKey: feat,
        properties,
        agentId,
        traceId,
        spanId,
        parentSpanId,
      } = parseProxyHeaders(req);
      if (!observeKey) {
        return res.status(401).json({
          error: {
            message: "Missing observe key (Observe-Key header)",
            type: "auth_error",
          },
        });
      }
      const userId = await resolveProxyUserId(observeKey);
      if (!userId) {
        return res.status(401).json({
          error: {
            message: "Invalid or revoked observe key",
            type: "auth_error",
          },
        });
      }
      const featureKey = feat || "cohere_chat";
      const model = req.body.model || "command-r-plus";

      const proxyStart = Date.now();
      const cohereResponse = await fetch("https://api.cohere.com/v2/chat", {
        method: "POST",
        headers: {
          Authorization: authHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req.body),
      });

      const data = (await cohereResponse.json()) as Record<string, unknown>;
      const durationMs = Date.now() - proxyStart;
      res.status(cohereResponse.status).json(data);

      if (userId && cohereResponse.ok && data.usage) {
        const usage = data.usage as {
          billed_input_tokens?: number;
          billed_output_tokens?: number;
        };
        const respModel = (data.model as string) || model;
        const inputTokens = usage.billed_input_tokens || 0;
        const outputTokens = usage.billed_output_tokens || 0;
        const cost = await calculateCost(respModel, inputTokens, outputTokens);
        logProxyEvent(
          userId,
          respModel,
          inputTokens,
          outputTokens,
          cost,
          customerId,
          featureKey,
          "cohere",
          properties,
          req.body,
          data,
          agentId,
          traceId,
          spanId,
          parentSpanId,
          durationMs,
          "llm",
        ).catch((err) =>
          console.error("Cohere proxy event logging failed:", err),
        );
      }
    } catch (error) {
      console.error("POST /v1/cohere/chat proxy error:", error);
      res.status(502).json({
        error: { message: "Failed to reach Cohere", type: "proxy_error" },
      });
    }
  });

  // POST /v1/mistral/chat/completions — Mistral proxy + log
  router.post(
    "/v1/mistral/chat/completions",
    async (req: Request, res: Response) => {
      try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          return res.status(401).json({
            error: {
              message: "Missing Authorization header (Mistral key)",
              type: "auth_error",
            },
          });
        }

        const {
          observeKey,
          customerId,
          featureKey: feat,
          properties,
          agentId,
          traceId,
          spanId,
          parentSpanId,
        } = parseProxyHeaders(req);
        if (!observeKey) {
          return res.status(401).json({
            error: {
              message: "Missing observe key (Observe-Key header)",
              type: "auth_error",
            },
          });
        }
        const userId = await resolveProxyUserId(observeKey);
        if (!userId) {
          return res.status(401).json({
            error: {
              message: "Invalid or revoked observe key",
              type: "auth_error",
            },
          });
        }
        const featureKey = feat || "mistral_chat";
        const model = req.body.model || "mistral-large-latest";

        const proxyStart = Date.now();
        const mistralResponse = await fetch(
          "https://api.mistral.ai/v1/chat/completions",
          {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(req.body),
          },
        );

        const data = (await mistralResponse.json()) as Record<string, unknown>;
        const durationMs = Date.now() - proxyStart;
        res.status(mistralResponse.status).json(data);

        if (userId && mistralResponse.ok && data.usage) {
          const usage = data.usage as {
            prompt_tokens?: number;
            completion_tokens?: number;
          };
          const respModel = (data.model as string) || model;
          const inputTokens = usage.prompt_tokens || 0;
          const outputTokens = usage.completion_tokens || 0;
          const cost = await calculateCost(
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
            "mistral",
            properties,
            req.body,
            data,
            agentId,
            traceId,
            spanId,
            parentSpanId,
            durationMs,
            "llm",
          ).catch((err) =>
            console.error("Mistral proxy event logging failed:", err),
          );
        }
      } catch (error) {
        console.error("POST /v1/mistral/chat/completions proxy error:", error);
        res.status(502).json({
          error: { message: "Failed to reach Mistral", type: "proxy_error" },
        });
      }
    },
  );

  // GET /proxy/cache/stats — cache performance metrics for current user
  router.get(
    "/proxy/cache/stats",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const acct = req.accountId ?? null;
        const [cacheRows, hitRows, totalRows] = await Promise.all([
          pool.query(
            `SELECT COUNT(*) FILTER (WHERE expires_at IS NULL OR expires_at > NOW()) AS total_cached,
                  COALESCE(SUM(tokens_saved), 0) AS tokens_saved,
                  COALESCE(SUM(cost_saved), 0) AS cost_saved
           FROM proxy_cache WHERE account_id = $1`,
            [acct],
          ),
          pool.query(
            `SELECT COUNT(*) AS hit_count FROM observe_events
           WHERE account_id = $1 AND source = 'proxy' AND properties->>'cache_hit' = 'true'`,
            [acct],
          ),
          pool.query(
            `SELECT COUNT(*) AS total FROM observe_events WHERE account_id = $1 AND source = 'proxy'`,
            [acct],
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

  return router;
}
