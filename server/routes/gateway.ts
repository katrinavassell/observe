import { Router, Request, Response } from "express";
import type { Pool } from "pg";
import crypto from "crypto";
import { type AuthRequest } from "./auth.js";
import {
  getProvider,
  type ProviderRequest,
  type ProviderResponse,
} from "../providers/index.js";
import type { StreamSink } from "../providers/types.js";
import { calculateCostFromTokens } from "../model-pricing.js";
import { decryptApiKey, encryptApiKey } from "../stripe-client.js";
import { checkAlerts } from "./alerts.js";

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
    console.error("gateway: account_id fallback lookup failed:", err);
  }
  console.warn("gateway: no account_id resolved for user", userId);
  return null;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface RoutingTarget {
  id: number;
  priority: number;
  provider: string;
  model: string;
  api_base_url: string | null;
  encrypted_api_key: string | null;
  max_retries: number;
  timeout_ms: number;
  weight: number;
  enabled: boolean;
}

interface RoutingRule {
  id: number;
  field: string;
  operator: string;
  value: string;
  target_id: number | null;
  priority: number;
}

interface ResolvedConfig {
  id: number;
  name: string;
  targets: RoutingTarget[];
  rules: RoutingRule[];
}

// ── Config cache (in-memory, short TTL) ──────────────────────────────────────

const configCache = new Map<
  string,
  { config: ResolvedConfig; expiresAt: number }
>();
const CONFIG_CACHE_TTL = 10_000; // 10 seconds

function getCachedConfig(key: string): ResolvedConfig | null {
  const entry = configCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    configCache.delete(key);
    return null;
  }
  return entry.config;
}

function setCachedConfig(key: string, config: ResolvedConfig): void {
  configCache.set(key, { config, expiresAt: Date.now() + CONFIG_CACHE_TTL });
}

// Per-user cache invalidation. Global configCache.clear() was evicting every
// user's cache on any CRUD op, causing unnecessary DB round-trips under load.
function invalidateUserCache(userId: string): void {
  const prefix = `${userId}:`;
  for (const key of configCache.keys()) {
    if (key.startsWith(prefix)) configCache.delete(key);
  }
}

// ── Target cooldown tracking ─────────────────────────────────────────────────
// When a target fails repeatedly, park it for a cooldown window so subsequent
// requests don't keep hitting the same dead endpoint. This is the reliability
// pattern LiteLLM uses (cooldown + Redis in multi-instance deploys). We keep
// it in-memory for now — acceptable for single-instance, would need Redis for
// horizontal scale.
const COOLDOWN_FAILURE_THRESHOLD = 3;
const COOLDOWN_DURATION_MS = 30_000;

interface CooldownState {
  consecutiveFailures: number;
  cooldownUntil: number;
  retryAfterUntil: number; // respects provider Retry-After headers
}

const targetCooldowns = new Map<number, CooldownState>();

function getCooldown(targetId: number): CooldownState {
  let state = targetCooldowns.get(targetId);
  if (!state) {
    state = { consecutiveFailures: 0, cooldownUntil: 0, retryAfterUntil: 0 };
    targetCooldowns.set(targetId, state);
  }
  return state;
}

function isTargetCooling(targetId: number): boolean {
  const state = targetCooldowns.get(targetId);
  if (!state) return false;
  const now = Date.now();
  return now < state.cooldownUntil || now < state.retryAfterUntil;
}

function recordTargetFailure(targetId: number, retryAfterMs?: number): void {
  const state = getCooldown(targetId);
  state.consecutiveFailures += 1;
  if (retryAfterMs && retryAfterMs > 0) {
    state.retryAfterUntil = Date.now() + retryAfterMs;
  }
  if (state.consecutiveFailures >= COOLDOWN_FAILURE_THRESHOLD) {
    state.cooldownUntil = Date.now() + COOLDOWN_DURATION_MS;
  }
}

function recordTargetSuccess(targetId: number): void {
  const state = targetCooldowns.get(targetId);
  if (!state) return;
  state.consecutiveFailures = 0;
  state.cooldownUntil = 0;
  state.retryAfterUntil = 0;
}

// Parses Retry-After header value (either delta-seconds or HTTP-date) to ms.
function parseRetryAfterMs(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 60_000);
  }
  const dateMs = Date.parse(header);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    if (delta > 0) return Math.min(delta, 60_000);
  }
  return undefined;
}

// ── Route factory ────────────────────────────────────────────────────────────

export function createGatewayRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: { apiLimiter: ReturnType<typeof import("express-rate-limit").default> },
) {
  const router = Router();

  // ── Helpers ──────────────────────────────────────────────────────────────

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

  async function loadConfig(
    userId: string,
    configName: string,
  ): Promise<ResolvedConfig | null> {
    const cacheKey = `${userId}:${configName}`;
    const cached = getCachedConfig(cacheKey);
    if (cached) return cached;

    const accountId = await resolveAccountIdForUser(pool, userId);
    const configResult = await pool.query(
      "SELECT id, name FROM routing_configs WHERE account_id = $1 AND name = $2 AND is_active = true",
      [accountId, configName],
    );
    if (configResult.rows.length === 0) return null;

    const config = configResult.rows[0];
    const [targetsResult, rulesResult] = await Promise.all([
      pool.query(
        "SELECT id, priority, provider, model, api_base_url, encrypted_api_key, max_retries, timeout_ms, weight, enabled FROM routing_targets WHERE config_id = $1 AND enabled = true ORDER BY priority ASC, weight DESC",
        [config.id],
      ),
      pool.query(
        "SELECT id, field, operator, value, target_id, priority FROM routing_rules WHERE config_id = $1 ORDER BY priority ASC",
        [config.id],
      ),
    ]);

    const resolved: ResolvedConfig = {
      id: config.id,
      name: config.name,
      targets: targetsResult.rows,
      rules: rulesResult.rows,
    };
    setCachedConfig(cacheKey, resolved);
    return resolved;
  }

  // ── Rule evaluation ────────────────────────────────────────────────────

  function evaluateRules(
    rules: RoutingRule[],
    metadata: Record<string, string>,
  ): number | null {
    for (const rule of rules) {
      const actual = metadata[rule.field];
      if (actual === undefined) continue;

      let match = false;
      switch (rule.operator) {
        case "eq":
          match = actual === rule.value;
          break;
        case "neq":
          match = actual !== rule.value;
          break;
        case "in": {
          try {
            const values = JSON.parse(rule.value) as string[];
            match = values.includes(actual);
          } catch {
            match = false;
          }
          break;
        }
        case "contains":
          match = actual.includes(rule.value);
          break;
      }
      if (match) return rule.target_id;
    }
    return null;
  }

  // ── Target selection (priority + weighted random) ──────────────────────

  // Weighted shuffle: pick items one at a time with probability proportional
  // to their weight, without replacement. Produces a correctly-weighted
  // ordering of the group — higher-weight targets land earlier on average.
  // The previous implementation used a sort comparator built from Math.random
  // calls, which was not a valid weighted sampler.
  function weightedShuffle(group: RoutingTarget[]): RoutingTarget[] {
    const pool = [...group];
    const result: RoutingTarget[] = [];
    while (pool.length > 0) {
      const totalWeight = pool.reduce((s, t) => s + Math.max(t.weight, 0), 0);
      if (totalWeight <= 0) {
        // All weights zero — fall back to random order to avoid bias.
        result.push(...pool.sort(() => Math.random() - 0.5));
        break;
      }
      let r = Math.random() * totalWeight;
      let idx = 0;
      for (let i = 0; i < pool.length; i++) {
        r -= Math.max(pool[i].weight, 0);
        if (r <= 0) {
          idx = i;
          break;
        }
      }
      result.push(pool[idx]);
      pool.splice(idx, 1);
    }
    return result;
  }

  function selectTargets(
    targets: RoutingTarget[],
    pinnedTargetId: number | null,
  ): RoutingTarget[] {
    // Filter out targets currently in cooldown before any other ordering,
    // but keep them as a last-resort tail so we never end up with zero
    // candidates if every target is cooling.
    const live = targets.filter((t) => !isTargetCooling(t.id));
    const cooling = targets.filter((t) => isTargetCooling(t.id));
    const usable = live.length > 0 ? live : targets;

    if (pinnedTargetId !== null) {
      const pinned = usable.find((t) => t.id === pinnedTargetId);
      if (pinned) {
        return [
          pinned,
          ...usable.filter((t) => t.id !== pinnedTargetId),
          ...(live.length > 0 ? cooling : []),
        ];
      }
    }

    // Group by priority, weighted shuffle within each group
    const grouped = new Map<number, RoutingTarget[]>();
    for (const t of usable) {
      const group = grouped.get(t.priority) || [];
      group.push(t);
      grouped.set(t.priority, group);
    }

    const result: RoutingTarget[] = [];
    const sortedPriorities = [...grouped.keys()].sort((a, b) => a - b);
    for (const priority of sortedPriorities) {
      const group = grouped.get(priority)!;
      if (group.length === 1) {
        result.push(group[0]);
      } else {
        result.push(...weightedShuffle(group));
      }
    }
    if (live.length > 0) result.push(...cooling);
    return result;
  }

  // ── Execute with fallback ──────────────────────────────────────────────

  async function executeWithFallback(
    targets: RoutingTarget[],
    request: ProviderRequest,
    budgetMs: number,
  ): Promise<{
    response: ProviderResponse;
    target: RoutingTarget;
    attempts: number;
  }> {
    const startTime = Date.now();
    let lastError: ProviderResponse | null = null;
    let attempts = 0;

    // Minimum headroom per attempt: need enough for network RTT + small
    // provider processing. 3s floor prevents the "1000ms timeout, doomed
    // call" footgun in the old budget math.
    const MIN_ATTEMPT_HEADROOM_MS = 3000;

    for (const target of targets) {
      const elapsed = Date.now() - startTime;
      const remaining = budgetMs - elapsed;
      if (remaining < MIN_ATTEMPT_HEADROOM_MS) break;

      const adapter = getProvider(target.provider);
      if (!adapter) {
        console.error(`Unknown provider: ${target.provider}`);
        continue;
      }

      let apiKey: string;
      try {
        if (!target.encrypted_api_key) {
          lastError = {
            ok: false,
            status: 500,
            model: target.model,
            inputTokens: 0,
            outputTokens: 0,
            body: {},
            durationMs: 0,
            error: `No API key configured for target ${target.id}`,
          };
          continue;
        }
        apiKey = decryptApiKey(target.encrypted_api_key);
      } catch (err) {
        console.error(
          `Failed to decrypt API key for target ${target.id}:`,
          err,
        );
        continue;
      }

      const timeoutMs = Math.min(target.timeout_ms, remaining - 1000);
      const providerRequest: ProviderRequest = {
        ...request,
        model: target.model,
      };

      for (let retry = 0; retry <= target.max_retries; retry++) {
        attempts++;
        const response = await adapter.send(
          providerRequest,
          apiKey,
          target.api_base_url || undefined,
          timeoutMs,
        );

        if (response.ok) {
          recordTargetSuccess(target.id);
          return { response, target, attempts };
        }

        // 4xx client errors: don't retry on the same target, but also don't
        // mark it as failing (the client is wrong, not the target).
        if (response.status >= 400 && response.status < 500) {
          // 429 is the exception: it's a rate limit, target-side throttling.
          if (response.status === 429) {
            const retryAfterMs = parseRetryAfterMs(
              (response as ProviderResponse & { retryAfter?: string })
                .retryAfter,
            );
            recordTargetFailure(target.id, retryAfterMs);
          }
          lastError = response;
          break;
        }

        lastError = response;
        recordTargetFailure(target.id);
        // Only retry on 5xx / network errors
        if (retry < target.max_retries) {
          await new Promise((r) => setTimeout(r, 200 * (retry + 1)));
        }
      }
    }

    return {
      response: lastError || {
        ok: false,
        status: 502,
        model: request.model,
        inputTokens: 0,
        outputTokens: 0,
        body: {},
        durationMs: Date.now() - startTime,
        error: "All targets exhausted",
      },
      target: targets[targets.length - 1],
      attempts,
    };
  }

  // Wrap an Express response as a StreamSink. First write() triggers the
  // SSE headers (200 + text/event-stream). Adapters only see the sink
  // interface and don't need to know about Express.
  function createExpressStreamSink(res: Response): StreamSink {
    let committed = false;
    return {
      write(chunk: Uint8Array): void {
        if (!committed) {
          committed = true;
          res.status(200);
          res.set("Content-Type", "text/event-stream");
          res.set("Cache-Control", "no-cache, no-transform");
          res.set("Connection", "keep-alive");
          res.set("X-Accel-Buffering", "no"); // disable proxy buffering
          res.flushHeaders?.();
        }
        // Node's Response inherits from Writable — Buffer.from covers
        // Uint8Array without a copy.
        res.write(Buffer.from(chunk));
      },
      end(): void {
        if (!res.writableEnded) res.end();
      },
      get committed(): boolean {
        return committed;
      },
    };
  }

  // ── Stream execution ───────────────────────────────────────────────────
  // Streaming path has a hard asymmetry: once any byte has been written to
  // the client, we can't fall back to a different target — headers are
  // committed. So fallback only applies before the first byte.

  async function executeStreamWithFallback(
    targets: RoutingTarget[],
    request: ProviderRequest,
    sink: StreamSink,
    budgetMs: number,
  ): Promise<{
    response: ProviderResponse;
    target: RoutingTarget;
    attempts: number;
  }> {
    const startTime = Date.now();
    let lastError: ProviderResponse | null = null;
    let attempts = 0;
    const MIN_ATTEMPT_HEADROOM_MS = 3000;

    for (const target of targets) {
      const elapsed = Date.now() - startTime;
      const remaining = budgetMs - elapsed;
      if (remaining < MIN_ATTEMPT_HEADROOM_MS) break;

      const adapter = getProvider(target.provider);
      if (!adapter) {
        console.error(`Unknown provider: ${target.provider}`);
        continue;
      }
      if (!adapter.sendStream) {
        // Adapter doesn't support streaming yet. Record as a target-level
        // miss (not a failure — don't cool the target down for this) and
        // try the next one.
        lastError = {
          ok: false,
          status: 501,
          model: target.model,
          inputTokens: 0,
          outputTokens: 0,
          body: {
            error: {
              message: `Provider '${target.provider}' does not support streaming`,
              type: "unsupported",
            },
          },
          durationMs: 0,
          error: "streaming not supported",
        };
        continue;
      }

      let apiKey: string;
      try {
        if (!target.encrypted_api_key) {
          lastError = {
            ok: false,
            status: 500,
            model: target.model,
            inputTokens: 0,
            outputTokens: 0,
            body: {},
            durationMs: 0,
            error: `No API key configured for target ${target.id}`,
          };
          continue;
        }
        apiKey = decryptApiKey(target.encrypted_api_key);
      } catch (err) {
        console.error(
          `Failed to decrypt API key for target ${target.id}:`,
          err,
        );
        continue;
      }

      const timeoutMs = Math.min(target.timeout_ms, remaining - 1000);
      const providerRequest: ProviderRequest = {
        ...request,
        model: target.model,
      };

      attempts++;
      const response = await adapter.sendStream(
        providerRequest,
        apiKey,
        sink,
        target.api_base_url || undefined,
        timeoutMs,
      );

      if (response.ok) {
        recordTargetSuccess(target.id);
        return { response, target, attempts };
      }

      // If we've already committed bytes, we cannot fall back. Surface
      // whatever error happened and stop.
      if (sink.committed) {
        recordTargetFailure(target.id);
        return { response, target, attempts };
      }

      // Pre-commit failure — cool the target if it's 5xx, try next.
      if (response.status >= 500 || response.status === 0) {
        recordTargetFailure(target.id);
      }
      lastError = response;
    }

    return {
      response: lastError || {
        ok: false,
        status: 502,
        model: request.model,
        inputTokens: 0,
        outputTokens: 0,
        body: {},
        durationMs: Date.now() - startTime,
        error: "All stream targets exhausted",
      },
      target: targets[targets.length - 1],
      attempts,
    };
  }

  // ── Event logging ──────────────────────────────────────────────────────

  async function logGatewayEvent(
    userId: string,
    model: string,
    inputTokens: number,
    outputTokens: number,
    cost: number,
    customerId: string,
    featureKey: string,
    provider: string,
    properties: Record<string, string>,
    requestBody: Record<string, unknown> | null,
    responseBody: Record<string, unknown> | null,
    agentId: string,
    traceId: string,
    spanId: string,
    parentSpanId: string,
    durationMs: number | null,
  ): Promise<void> {
    const totalTokens = inputTokens + outputTokens;
    const accountId = await resolveAccountIdForUser(pool, userId);

    // Revenue enrichment
    let revenue = 0;
    let revenueSource = "none";
    try {
      const fpResult = await pool.query(
        "SELECT revenue_per_unit FROM feature_pricing WHERE account_id = $1 AND feature_key = $2",
        [accountId, featureKey],
      );
      if (fpResult.rows.length > 0) {
        revenue = parseFloat(fpResult.rows[0].revenue_per_unit);
        revenueSource = "feature_pricing";
      } else if (
        customerId &&
        customerId !== "unknown" &&
        customerId !== "default"
      ) {
        const mrrResult = await pool.query(
          "SELECT SUM(mrr_override) as mrr FROM subscriptions WHERE account_id = $1 AND is_active = true AND customer_id = $2",
          [accountId, customerId],
        );
        if (mrrResult.rows[0]?.mrr) {
          revenue = parseFloat(mrrResult.rows[0].mrr) / 30;
          revenueSource = "mrr_allocation";
        }
      }
    } catch (err) {
      console.error("Gateway revenue enrichment failed:", err);
    }

    await pool.query(
      `INSERT INTO observe_events (
        user_id, account_id, customer_id, feature_key, event_name, timestamp,
        cost_amount, cost_unit, revenue_amount, usage_units,
        model, model_provider, source, granularity, is_inferred, properties,
        request_body, response_body, revenue_source, agent_id,
        trace_id, span_id, parent_span_id, duration_ms, cost_type
      ) VALUES ($1, $2, $3, $4, 'cost', NOW(), $5, 'usd', $6, $7, $8, $9, 'gateway', 'event', false, $10, $11, $12, $13, $14, $15, $16, $17, $18, 'llm')`,
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
        JSON.stringify(properties),
        requestBody ? JSON.stringify(requestBody) : null,
        responseBody ? JSON.stringify(responseBody) : null,
        revenueSource,
        agentId || null,
        traceId || null,
        spanId || null,
        parentSpanId || null,
        durationMs,
      ],
    );
    checkAlerts(pool, userId).catch((err) =>
      console.error("checkAlerts error (gateway):", err),
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // GATEWAY ENDPOINT — the main routing proxy
  // ═══════════════════════════════════════════════════════════════════════

  router.post(
    "/v1/gateway/chat/completions",
    deps.apiLimiter,
    async (req: Request, res: Response) => {
      try {
        const observeKey =
          (req.headers["observe-key"] as string) ||
          (req.headers["x-tanso-key"] as string) ||
          (req.headers["x-observe-key"] as string);
        if (!observeKey) {
          return res.status(401).json({
            error: { message: "Missing observe key", type: "auth_error" },
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

        const configName =
          (req.headers["x-observe-config"] as string) || "default";
        const config = await loadConfig(userId, configName);
        if (!config || config.targets.length === 0) {
          return res.status(404).json({
            error: {
              message: `Routing config '${configName}' not found or has no targets`,
              type: "config_error",
            },
          });
        }

        // Collect metadata for rule evaluation
        const customerId =
          (req.headers["x-tanso-customer"] as string) ||
          (req.headers["x-observe-customer"] as string) ||
          "default";
        const featureKey =
          (req.headers["x-tanso-feature"] as string) ||
          (req.headers["x-observe-feature"] as string) ||
          "gateway";
        const region = (req.headers["x-observe-region"] as string) || "";
        const agentId = (req.headers["x-tanso-agent"] as string) || "";
        const traceId = (req.headers["x-tanso-trace-id"] as string) || "";
        const spanId = (req.headers["x-tanso-span-id"] as string) || "";
        const parentSpanId =
          (req.headers["x-tanso-parent-span-id"] as string) || "";

        // Collect custom properties
        const properties: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (key.startsWith("x-observe-prop-") && typeof value === "string") {
            properties[key.replace("x-observe-prop-", "")] = value;
          }
        }

        const metadata: Record<string, string> = {
          customer_id: customerId,
          feature_key: featureKey,
          region,
          ...properties,
        };

        // Evaluate rules → pinned target or null
        const pinnedTargetId = evaluateRules(config.rules, metadata);

        // Select and order targets
        const orderedTargets = selectTargets(config.targets, pinnedTargetId);

        // Build provider request from body
        const providerRequest: ProviderRequest = {
          model: req.body.model || orderedTargets[0].model,
          messages: req.body.messages || [],
          system: req.body.system,
          temperature: req.body.temperature,
          max_tokens: req.body.max_tokens,
          stream: req.body.stream,
        };

        const wantsStream = req.body.stream === true;

        if (wantsStream) {
          // SSE path. Headers are committed on first write, so pre-commit
          // fallback is the only kind available.
          const sink = createExpressStreamSink(res);
          const { response, target, attempts } =
            await executeStreamWithFallback(
              orderedTargets,
              providerRequest,
              sink,
              27_000,
            );

          if (!sink.committed) {
            // Nothing was written — we can still return a JSON error.
            res.set("X-Observe-Provider", target.provider);
            res.set("X-Observe-Model", response.model);
            res.set("X-Observe-Attempts", String(attempts));
            res.status(response.status || 502).json(
              response.body && Object.keys(response.body).length > 0
                ? response.body
                : {
                    error: {
                      message: response.error || "Stream failed",
                      type: "stream_error",
                    },
                  },
            );
          } else if (!res.writableEnded) {
            // Committed but adapter didn't close — defensive.
            res.end();
          }

          if (userId && response.ok) {
            const cost = await calculateCostFromTokens(
              pool,
              response.model,
              response.inputTokens,
              response.outputTokens,
            );
            logGatewayEvent(
              userId,
              response.model,
              response.inputTokens,
              response.outputTokens,
              cost,
              customerId,
              featureKey,
              target.provider,
              {
                ...properties,
                routing_config: configName,
                routing_attempts: String(attempts),
                routing_mode: "stream",
              },
              req.body,
              null, // streaming responses aren't captured as JSON bodies
              agentId,
              traceId,
              spanId,
              parentSpanId,
              response.durationMs,
            ).catch((err) =>
              console.error("Gateway event logging failed:", err),
            );
          }
          return;
        }

        // Execute with 27s budget (leave headroom for Vercel 30s limit)
        const { response, target, attempts } = await executeWithFallback(
          orderedTargets,
          providerRequest,
          27_000,
        );

        // Add routing metadata to response headers
        res.set("X-Observe-Provider", target.provider);
        res.set("X-Observe-Model", response.model);
        res.set("X-Observe-Attempts", String(attempts));
        res.status(response.status).json(response.body);

        // Log asynchronously
        if (userId && response.ok) {
          const cost = await calculateCostFromTokens(
            pool,
            response.model,
            response.inputTokens,
            response.outputTokens,
          );
          logGatewayEvent(
            userId,
            response.model,
            response.inputTokens,
            response.outputTokens,
            cost,
            customerId,
            featureKey,
            target.provider,
            {
              ...properties,
              routing_config: configName,
              routing_attempts: String(attempts),
            },
            req.body,
            response.body,
            agentId,
            traceId,
            spanId,
            parentSpanId,
            response.durationMs,
          ).catch((err) => console.error("Gateway event logging failed:", err));
        }
      } catch (error) {
        console.error("POST /v1/gateway/chat/completions error:", error);
        res
          .status(502)
          .json({ error: { message: "Gateway error", type: "gateway_error" } });
      }
    },
  );

  // ═══════════════════════════════════════════════════════════════════════
  // CONFIG MANAGEMENT API
  // ═══════════════════════════════════════════════════════════════════════

  // List configs
  router.get(
    "/gateway/configs",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT c.id, c.name, c.description, c.is_active, c.created_at, c.updated_at,
          (SELECT COUNT(*) FROM routing_targets t WHERE t.config_id = c.id) as target_count
         FROM routing_configs c WHERE c.account_id = $1 ORDER BY c.created_at DESC`,
          [req.accountId ?? null],
        );
        res.json({ configs: result.rows });
      } catch (error) {
        console.error("GET /gateway/configs error:", error);
        res.status(500).json({ error: "Failed to list configs" });
      }
    },
  );

  // Create config
  router.post(
    "/gateway/configs",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { name, description } = req.body;
        if (!name || typeof name !== "string") {
          return res.status(400).json({ error: "name is required" });
        }
        const result = await pool.query(
          "INSERT INTO routing_configs (user_id, account_id, name, description) VALUES ($1, $2, $3, $4) RETURNING *",
          [
            req.visitorId,
            req.accountId ?? null,
            name.trim(),
            description || null,
          ],
        );
        res.status(201).json(result.rows[0]);
      } catch (error: any) {
        if (error.code === "23505") {
          return res
            .status(409)
            .json({ error: "A config with this name already exists" });
        }
        console.error("POST /gateway/configs error:", error);
        res.status(500).json({ error: "Failed to create config" });
      }
    },
  );

  // Get config with targets and rules
  router.get(
    "/gateway/configs/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const configResult = await pool.query(
          "SELECT * FROM routing_configs WHERE id = $1 AND account_id = $2",
          [req.params.id, req.accountId ?? null],
        );
        if (configResult.rows.length === 0) {
          return res.status(404).json({ error: "Config not found" });
        }

        const [targets, rules] = await Promise.all([
          pool.query(
            "SELECT id, priority, provider, model, api_base_url, max_retries, timeout_ms, weight, enabled, created_at FROM routing_targets WHERE config_id = $1 ORDER BY priority ASC",
            [req.params.id],
          ),
          pool.query(
            "SELECT * FROM routing_rules WHERE config_id = $1 ORDER BY priority ASC",
            [req.params.id],
          ),
        ]);

        res.json({
          ...configResult.rows[0],
          targets: targets.rows,
          rules: rules.rows,
        });
      } catch (error) {
        console.error("GET /gateway/configs/:id error:", error);
        res.status(500).json({ error: "Failed to get config" });
      }
    },
  );

  // Update config
  router.put(
    "/gateway/configs/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const { name, description, is_active } = req.body;
        const result = await pool.query(
          `UPDATE routing_configs SET
          name = COALESCE($3, name),
          description = COALESCE($4, description),
          is_active = COALESCE($5, is_active),
          updated_at = NOW()
         WHERE id = $1 AND account_id = $2 RETURNING *`,
          [req.params.id, req.accountId ?? null, name, description, is_active],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Config not found" });
        }
        // Invalidate cache
        invalidateUserCache(req.visitorId!);
        res.json(result.rows[0]);
      } catch (error) {
        console.error("PUT /gateway/configs/:id error:", error);
        res.status(500).json({ error: "Failed to update config" });
      }
    },
  );

  // Delete config
  router.delete(
    "/gateway/configs/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          "DELETE FROM routing_configs WHERE id = $1 AND account_id = $2 RETURNING id",
          [req.params.id, req.accountId ?? null],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Config not found" });
        }
        invalidateUserCache(req.visitorId!);
        res.json({ deleted: true });
      } catch (error) {
        console.error("DELETE /gateway/configs/:id error:", error);
        res.status(500).json({ error: "Failed to delete config" });
      }
    },
  );

  // ── Target CRUD ────────────────────────────────────────────────────────

  // Add target
  router.post(
    "/gateway/configs/:id/targets",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        // Verify config ownership
        const configCheck = await pool.query(
          "SELECT id FROM routing_configs WHERE id = $1 AND account_id = $2",
          [req.params.id, req.accountId ?? null],
        );
        if (configCheck.rows.length === 0) {
          return res.status(404).json({ error: "Config not found" });
        }

        const {
          provider,
          model,
          api_base_url,
          api_key,
          priority,
          max_retries,
          timeout_ms,
          weight,
        } = req.body;
        if (!provider || !model) {
          return res
            .status(400)
            .json({ error: "provider and model are required" });
        }

        const encrypted = api_key ? encryptApiKey(api_key) : null;
        const result = await pool.query(
          `INSERT INTO routing_targets (config_id, priority, provider, model, api_base_url, encrypted_api_key, max_retries, timeout_ms, weight)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id, priority, provider, model, api_base_url, max_retries, timeout_ms, weight, enabled, created_at`,
          [
            req.params.id,
            priority ?? 0,
            provider,
            model,
            api_base_url || null,
            encrypted,
            max_retries ?? 1,
            timeout_ms ?? 25000,
            weight ?? 100,
          ],
        );
        invalidateUserCache(req.visitorId!);
        res.status(201).json(result.rows[0]);
      } catch (error) {
        console.error("POST /gateway/configs/:id/targets error:", error);
        res.status(500).json({ error: "Failed to add target" });
      }
    },
  );

  // Update target
  router.put(
    "/gateway/configs/:configId/targets/:targetId",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const configCheck = await pool.query(
          "SELECT id FROM routing_configs WHERE id = $1 AND account_id = $2",
          [req.params.configId, req.accountId ?? null],
        );
        if (configCheck.rows.length === 0) {
          return res.status(404).json({ error: "Config not found" });
        }

        const {
          provider,
          model,
          api_base_url,
          api_key,
          priority,
          max_retries,
          timeout_ms,
          weight,
          enabled,
        } = req.body;
        const updates: string[] = [];
        const values: unknown[] = [];
        let idx = 1;

        if (provider !== undefined) {
          updates.push(`provider = $${idx++}`);
          values.push(provider);
        }
        if (model !== undefined) {
          updates.push(`model = $${idx++}`);
          values.push(model);
        }
        if (api_base_url !== undefined) {
          updates.push(`api_base_url = $${idx++}`);
          values.push(api_base_url || null);
        }
        if (api_key !== undefined) {
          updates.push(`encrypted_api_key = $${idx++}`);
          values.push(encryptApiKey(api_key));
        }
        if (priority !== undefined) {
          updates.push(`priority = $${idx++}`);
          values.push(priority);
        }
        if (max_retries !== undefined) {
          updates.push(`max_retries = $${idx++}`);
          values.push(max_retries);
        }
        if (timeout_ms !== undefined) {
          updates.push(`timeout_ms = $${idx++}`);
          values.push(timeout_ms);
        }
        if (weight !== undefined) {
          updates.push(`weight = $${idx++}`);
          values.push(weight);
        }
        if (enabled !== undefined) {
          updates.push(`enabled = $${idx++}`);
          values.push(enabled);
        }

        if (updates.length === 0) {
          return res.status(400).json({ error: "No fields to update" });
        }

        values.push(req.params.targetId, req.params.configId);
        const result = await pool.query(
          `UPDATE routing_targets SET ${updates.join(", ")} WHERE id = $${idx++} AND config_id = $${idx}
         RETURNING id, priority, provider, model, api_base_url, max_retries, timeout_ms, weight, enabled, created_at`,
          values,
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Target not found" });
        }
        invalidateUserCache(req.visitorId!);
        res.json(result.rows[0]);
      } catch (error) {
        console.error(
          "PUT /gateway/configs/:configId/targets/:targetId error:",
          error,
        );
        res.status(500).json({ error: "Failed to update target" });
      }
    },
  );

  // Delete target
  router.delete(
    "/gateway/configs/:configId/targets/:targetId",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const configCheck = await pool.query(
          "SELECT id FROM routing_configs WHERE id = $1 AND account_id = $2",
          [req.params.configId, req.accountId ?? null],
        );
        if (configCheck.rows.length === 0) {
          return res.status(404).json({ error: "Config not found" });
        }

        const result = await pool.query(
          "DELETE FROM routing_targets WHERE id = $1 AND config_id = $2 RETURNING id",
          [req.params.targetId, req.params.configId],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Target not found" });
        }
        invalidateUserCache(req.visitorId!);
        res.json({ deleted: true });
      } catch (error) {
        console.error("DELETE target error:", error);
        res.status(500).json({ error: "Failed to delete target" });
      }
    },
  );

  // ── Rule CRUD ──────────────────────────────────────────────────────────

  // Add rule
  router.post(
    "/gateway/configs/:id/rules",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const configCheck = await pool.query(
          "SELECT id FROM routing_configs WHERE id = $1 AND account_id = $2",
          [req.params.id, req.accountId ?? null],
        );
        if (configCheck.rows.length === 0) {
          return res.status(404).json({ error: "Config not found" });
        }

        const { field, operator, value, target_id, priority } = req.body;
        if (!field || !operator || value === undefined) {
          return res
            .status(400)
            .json({ error: "field, operator, and value are required" });
        }

        const result = await pool.query(
          "INSERT INTO routing_rules (config_id, field, operator, value, target_id, priority) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
          [
            req.params.id,
            field,
            operator,
            typeof value === "string" ? value : JSON.stringify(value),
            target_id || null,
            priority ?? 0,
          ],
        );
        invalidateUserCache(req.visitorId!);
        res.status(201).json(result.rows[0]);
      } catch (error) {
        console.error("POST /gateway/configs/:id/rules error:", error);
        res.status(500).json({ error: "Failed to add rule" });
      }
    },
  );

  // Delete rule
  router.delete(
    "/gateway/configs/:configId/rules/:ruleId",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const configCheck = await pool.query(
          "SELECT id FROM routing_configs WHERE id = $1 AND account_id = $2",
          [req.params.configId, req.accountId ?? null],
        );
        if (configCheck.rows.length === 0) {
          return res.status(404).json({ error: "Config not found" });
        }

        const result = await pool.query(
          "DELETE FROM routing_rules WHERE id = $1 AND config_id = $2 RETURNING id",
          [req.params.ruleId, req.params.configId],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({ error: "Rule not found" });
        }
        invalidateUserCache(req.visitorId!);
        res.json({ deleted: true });
      } catch (error) {
        console.error("DELETE rule error:", error);
        res.status(500).json({ error: "Failed to delete rule" });
      }
    },
  );

  // ── Test config (dry run) ──────────────────────────────────────────────

  router.post(
    "/gateway/configs/:id/test",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const configResult = await pool.query(
          "SELECT id, name FROM routing_configs WHERE id = $1 AND account_id = $2",
          [req.params.id, req.accountId ?? null],
        );
        if (configResult.rows.length === 0) {
          return res.status(404).json({ error: "Config not found" });
        }

        const [targetsResult, rulesResult] = await Promise.all([
          pool.query(
            "SELECT id, priority, provider, model, weight, enabled FROM routing_targets WHERE config_id = $1 AND enabled = true ORDER BY priority ASC",
            [req.params.id],
          ),
          pool.query(
            "SELECT id, field, operator, value, target_id, priority FROM routing_rules WHERE config_id = $1 ORDER BY priority ASC",
            [req.params.id],
          ),
        ]);

        const metadata = req.body.metadata || {};
        const pinnedTargetId = evaluateRules(rulesResult.rows, metadata);
        const ordered = selectTargets(
          targetsResult.rows as RoutingTarget[],
          pinnedTargetId,
        );

        res.json({
          config: configResult.rows[0].name,
          metadata,
          matched_rule: pinnedTargetId
            ? rulesResult.rows.find(
                (r: RoutingRule) => r.target_id === pinnedTargetId,
              )
            : null,
          target_order: ordered.map((t) => ({
            id: t.id,
            provider: t.provider,
            model: t.model,
            priority: t.priority,
          })),
        });
      } catch (error) {
        console.error("POST /gateway/configs/:id/test error:", error);
        res.status(500).json({ error: "Failed to test config" });
      }
    },
  );

  // ── List providers ─────────────────────────────────────────────────────

  router.get(
    "/gateway/providers",
    ensureVisitor,
    async (_req: AuthRequest, res: Response) => {
      const { listProviders } = await import("../providers/index.js");
      res.json({ providers: listProviders() });
    },
  );

  return router;
}
