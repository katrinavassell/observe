import type Pg from 'pg'

export interface ModelPrice {
  model: string
  provider: string
  input_cost_per_million: number
  output_cost_per_million: number
}

export interface PricingLogEntry {
  id: number
  model: string
  provider: string
  field: string
  old_value: number
  new_value: number
  source: string // 'openrouter' | 'litellm' | 'admin' | 'user_override'
  user_id: string | null // null = global change, set = user override
  created_at: string
}

// In-memory cache
let pricingCache: ModelPrice[] = []
let cacheLoadedAt = 0
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

// Providers we care about from OpenRouter (filter the 400+ models down)
const TRACKED_PROVIDERS = ['openai', 'anthropic', 'google', 'mistral', 'meta-llama', 'cohere']

// Map OpenRouter provider names to our internal names
const PROVIDER_MAP: Record<string, string> = {
  'openai': 'openai',
  'anthropic': 'anthropic',
  'google': 'google',
  'mistral': 'mistral',
  'meta-llama': 'meta',
  'cohere': 'cohere',
}

// Default seed data — used to initialize the table on first run
const SEED_PRICING: ModelPrice[] = [
  // OpenAI
  { model: 'gpt-4o', provider: 'openai', input_cost_per_million: 2.50, output_cost_per_million: 10.00 },
  { model: 'gpt-4o-mini', provider: 'openai', input_cost_per_million: 0.15, output_cost_per_million: 0.60 },
  { model: 'gpt-4-turbo', provider: 'openai', input_cost_per_million: 10.00, output_cost_per_million: 30.00 },
  { model: 'gpt-4', provider: 'openai', input_cost_per_million: 30.00, output_cost_per_million: 60.00 },
  { model: 'gpt-3.5-turbo', provider: 'openai', input_cost_per_million: 0.50, output_cost_per_million: 1.50 },
  { model: 'o1', provider: 'openai', input_cost_per_million: 15.00, output_cost_per_million: 60.00 },
  { model: 'o1-mini', provider: 'openai', input_cost_per_million: 3.00, output_cost_per_million: 12.00 },
  { model: 'o1-pro', provider: 'openai', input_cost_per_million: 150.00, output_cost_per_million: 600.00 },
  { model: 'o3', provider: 'openai', input_cost_per_million: 10.00, output_cost_per_million: 40.00 },
  { model: 'o3-mini', provider: 'openai', input_cost_per_million: 1.10, output_cost_per_million: 4.40 },
  { model: 'o4-mini', provider: 'openai', input_cost_per_million: 1.10, output_cost_per_million: 4.40 },
  { model: 'text-embedding-3-small', provider: 'openai', input_cost_per_million: 0.02, output_cost_per_million: 0 },
  { model: 'text-embedding-3-large', provider: 'openai', input_cost_per_million: 0.13, output_cost_per_million: 0 },
  { model: 'text-embedding-ada-002', provider: 'openai', input_cost_per_million: 0.10, output_cost_per_million: 0 },
  // Anthropic
  { model: 'claude-sonnet-4-5', provider: 'anthropic', input_cost_per_million: 3.00, output_cost_per_million: 15.00 },
  { model: 'claude-opus-4', provider: 'anthropic', input_cost_per_million: 15.00, output_cost_per_million: 75.00 },
  { model: 'claude-sonnet-4', provider: 'anthropic', input_cost_per_million: 3.00, output_cost_per_million: 15.00 },
  { model: 'claude-sonnet-4-20250514', provider: 'anthropic', input_cost_per_million: 3.00, output_cost_per_million: 15.00 },
  { model: 'claude-haiku-4-20250414', provider: 'anthropic', input_cost_per_million: 0.80, output_cost_per_million: 4.00 },
  { model: 'claude-3-5-sonnet-20241022', provider: 'anthropic', input_cost_per_million: 3.00, output_cost_per_million: 15.00 },
  { model: 'claude-3-5-haiku-20241022', provider: 'anthropic', input_cost_per_million: 0.80, output_cost_per_million: 4.00 },
  { model: 'claude-3-opus-20240229', provider: 'anthropic', input_cost_per_million: 15.00, output_cost_per_million: 75.00 },
  { model: 'claude-3-haiku-20240307', provider: 'anthropic', input_cost_per_million: 0.25, output_cost_per_million: 1.25 },
  // Google
  { model: 'gemini-2.5-pro', provider: 'google', input_cost_per_million: 1.25, output_cost_per_million: 10.00 },
  { model: 'gemini-2.5-flash', provider: 'google', input_cost_per_million: 0.15, output_cost_per_million: 0.60 },
  { model: 'gemini-2.0-flash', provider: 'google', input_cost_per_million: 0.10, output_cost_per_million: 0.40 },
  { model: 'gemini-1.5-pro', provider: 'google', input_cost_per_million: 1.25, output_cost_per_million: 5.00 },
  { model: 'gemini-1.5-flash', provider: 'google', input_cost_per_million: 0.075, output_cost_per_million: 0.30 },
  // Mistral
  { model: 'mistral-large-latest', provider: 'mistral', input_cost_per_million: 2.00, output_cost_per_million: 6.00 },
  { model: 'mistral-small-latest', provider: 'mistral', input_cost_per_million: 0.10, output_cost_per_million: 0.30 },
  { model: 'codestral-latest', provider: 'mistral', input_cost_per_million: 0.30, output_cost_per_million: 0.90 },
  // Meta
  { model: 'llama-3.1-405b', provider: 'meta', input_cost_per_million: 3.00, output_cost_per_million: 3.00 },
  { model: 'llama-3.1-70b', provider: 'meta', input_cost_per_million: 0.80, output_cost_per_million: 0.80 },
  { model: 'llama-3.1-8b', provider: 'meta', input_cost_per_million: 0.10, output_cost_per_million: 0.10 },
]

// ─── Table Init ─────────────────────────────────────────────────────────────

export async function initModelPricing(pool: Pg.Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS model_pricing (
      model TEXT NOT NULL,
      provider TEXT NOT NULL,
      input_cost_per_million NUMERIC NOT NULL,
      output_cost_per_million NUMERIC NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (model)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_model_pricing (
      user_id TEXT NOT NULL,
      model TEXT NOT NULL,
      input_cost_per_million NUMERIC NOT NULL,
      output_cost_per_million NUMERIC NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, model)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS model_pricing_log (
      id SERIAL PRIMARY KEY,
      model TEXT NOT NULL,
      provider TEXT,
      field TEXT NOT NULL,
      old_value NUMERIC,
      new_value NUMERIC,
      source TEXT NOT NULL,
      user_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)

  const { rows } = await pool.query('SELECT COUNT(*) FROM model_pricing')
  if (parseInt(rows[0].count) === 0) {
    const values: string[] = []
    const params: unknown[] = []
    let idx = 1
    for (const p of SEED_PRICING) {
      values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++})`)
      params.push(p.model, p.provider, p.input_cost_per_million, p.output_cost_per_million)
    }
    await pool.query(
      `INSERT INTO model_pricing (model, provider, input_cost_per_million, output_cost_per_million) VALUES ${values.join(', ')}`,
      params
    )
  }

  await refreshCache(pool)

  // Start daily auto-refresh (every 24 hours)
  setInterval(() => {
    refreshFromSources(pool).catch(err => console.error('Auto pricing refresh failed:', err))
  }, 24 * 60 * 60 * 1000)

  // Also run once on startup (after a short delay to not block init)
  setTimeout(() => {
    refreshFromSources(pool).catch(err => console.error('Initial pricing refresh failed:', err))
  }, 10_000)
}

// ─── Cache ──────────────────────────────────────────────────────────────────

async function refreshCache(pool: Pg.Pool): Promise<void> {
  const { rows } = await pool.query('SELECT model, provider, input_cost_per_million, output_cost_per_million FROM model_pricing')
  pricingCache = rows.map(r => ({
    model: r.model,
    provider: r.provider,
    input_cost_per_million: parseFloat(r.input_cost_per_million),
    output_cost_per_million: parseFloat(r.output_cost_per_million),
  }))
  cacheLoadedAt = Date.now()
}

// ─── Read ───────────────────────────────────────────────────────────────────

export async function getAllPricing(pool: Pg.Pool): Promise<ModelPrice[]> {
  if (Date.now() - cacheLoadedAt > CACHE_TTL_MS) {
    await refreshCache(pool)
  }
  return pricingCache
}

export async function getModelPricing(pool: Pg.Pool, model: string): Promise<ModelPrice | null> {
  const all = await getAllPricing(pool)
  return all.find(p => p.model === model || p.model === model.toLowerCase()) || null
}

export async function getUserModelPricing(pool: Pg.Pool, userId: string, model: string): Promise<ModelPrice | null> {
  const { rows } = await pool.query(
    `SELECT ump.model, mp.provider, ump.input_cost_per_million, ump.output_cost_per_million
     FROM user_model_pricing ump
     LEFT JOIN model_pricing mp ON mp.model = ump.model
     WHERE ump.user_id = $1 AND ump.model = $2`,
    [userId, model]
  )
  if (rows.length === 0) return null
  return {
    model: rows[0].model,
    provider: rows[0].provider || 'unknown',
    input_cost_per_million: parseFloat(rows[0].input_cost_per_million),
    output_cost_per_million: parseFloat(rows[0].output_cost_per_million),
  }
}

export async function getUserPricing(pool: Pg.Pool, userId: string): Promise<ModelPrice[]> {
  const defaults = await getAllPricing(pool)
  const { rows } = await pool.query(
    'SELECT model, input_cost_per_million, output_cost_per_million FROM user_model_pricing WHERE user_id = $1',
    [userId]
  )
  const overrides = new Map(rows.map((r: any) => [r.model, {
    input_cost_per_million: parseFloat(r.input_cost_per_million),
    output_cost_per_million: parseFloat(r.output_cost_per_million),
  }]))

  return defaults.map(d => {
    const override = overrides.get(d.model)
    if (override) return { ...d, ...override }
    return d
  })
}

// ─── Write ──────────────────────────────────────────────────────────────────

async function logPricingChange(
  pool: Pg.Pool,
  model: string,
  provider: string | null,
  field: string,
  oldValue: number,
  newValue: number,
  source: string,
  userId: string | null = null,
): Promise<void> {
  await pool.query(
    `INSERT INTO model_pricing_log (model, provider, field, old_value, new_value, source, user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [model, provider, field, oldValue, newValue, source, userId]
  )
}

export async function upsertModelPricing(pool: Pg.Pool, price: ModelPrice, source = 'admin'): Promise<void> {
  // Check for changes to log
  const existing = await getModelPricing(pool, price.model)
  if (existing) {
    if (existing.input_cost_per_million !== price.input_cost_per_million) {
      await logPricingChange(pool, price.model, price.provider, 'input_cost_per_million', existing.input_cost_per_million, price.input_cost_per_million, source)
    }
    if (existing.output_cost_per_million !== price.output_cost_per_million) {
      await logPricingChange(pool, price.model, price.provider, 'output_cost_per_million', existing.output_cost_per_million, price.output_cost_per_million, source)
    }
  } else {
    await logPricingChange(pool, price.model, price.provider, 'input_cost_per_million', 0, price.input_cost_per_million, source)
    if (price.output_cost_per_million > 0) {
      await logPricingChange(pool, price.model, price.provider, 'output_cost_per_million', 0, price.output_cost_per_million, source)
    }
  }

  await pool.query(
    `INSERT INTO model_pricing (model, provider, input_cost_per_million, output_cost_per_million, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (model) DO UPDATE SET
       provider = $2,
       input_cost_per_million = $3,
       output_cost_per_million = $4,
       updated_at = NOW()`,
    [price.model, price.provider, price.input_cost_per_million, price.output_cost_per_million]
  )
  cacheLoadedAt = 0
}

export async function upsertUserModelPricing(
  pool: Pg.Pool,
  userId: string,
  model: string,
  inputCost: number,
  outputCost: number,
): Promise<void> {
  // Log the user override
  const existing = await getUserModelPricing(pool, userId, model)
  const oldInput = existing?.input_cost_per_million ?? (await getModelPricing(pool, model))?.input_cost_per_million ?? 0
  const oldOutput = existing?.output_cost_per_million ?? (await getModelPricing(pool, model))?.output_cost_per_million ?? 0

  if (oldInput !== inputCost) {
    await logPricingChange(pool, model, null, 'input_cost_per_million', oldInput, inputCost, 'user_override', userId)
  }
  if (oldOutput !== outputCost) {
    await logPricingChange(pool, model, null, 'output_cost_per_million', oldOutput, outputCost, 'user_override', userId)
  }

  await pool.query(
    `INSERT INTO user_model_pricing (user_id, model, input_cost_per_million, output_cost_per_million, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, model) DO UPDATE SET
       input_cost_per_million = $3,
       output_cost_per_million = $4,
       updated_at = NOW()`,
    [userId, model, inputCost, outputCost]
  )
}

export async function deleteUserModelPricing(pool: Pg.Pool, userId: string, model: string): Promise<void> {
  await pool.query('DELETE FROM user_model_pricing WHERE user_id = $1 AND model = $2', [userId, model])
}

// ─── Cost Calculation ───────────────────────────────────────────────────────

export async function calculateCostFromTokens(
  pool: Pg.Pool,
  model: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  userId?: string,
): Promise<number> {
  if (!model || (inputTokens == null && outputTokens == null)) return 0

  let pricing: ModelPrice | null = null
  if (userId) {
    pricing = await getUserModelPricing(pool, userId, model)
  }
  if (!pricing) {
    pricing = await getModelPricing(pool, model)
  }
  if (!pricing) return 0

  const inputCost = (inputTokens || 0) * pricing.input_cost_per_million / 1_000_000
  const outputCost = (outputTokens || 0) * pricing.output_cost_per_million / 1_000_000
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
}

// ─── Pricing Log ────────────────────────────────────────────────────────────

/**
 * Get pricing change log. Shows global changes + user's own overrides.
 */
export async function getPricingLog(pool: Pg.Pool, userId?: string, limit = 100): Promise<PricingLogEntry[]> {
  const { rows } = await pool.query(
    `SELECT id, model, provider, field, old_value, new_value, source, user_id, created_at
     FROM model_pricing_log
     WHERE user_id IS NULL OR user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId || '__none__', limit]
  )
  return rows.map(r => ({
    id: r.id,
    model: r.model,
    provider: r.provider,
    field: r.field,
    old_value: parseFloat(r.old_value),
    new_value: parseFloat(r.new_value),
    source: r.source,
    user_id: r.user_id,
    created_at: r.created_at,
  }))
}

// ─── Auto-Refresh from OpenRouter / LiteLLM ────────────────────────────────

interface OpenRouterModel {
  id: string
  pricing?: {
    prompt?: string
    completion?: string
  }
}

function extractModelName(openRouterId: string): string {
  // OpenRouter IDs look like "openai/gpt-4o" — we want "gpt-4o"
  const parts = openRouterId.split('/')
  return parts[parts.length - 1]
}

function extractProvider(openRouterId: string): string | null {
  const parts = openRouterId.split('/')
  if (parts.length < 2) return null
  const raw = parts[0]
  return PROVIDER_MAP[raw] || null
}

async function fetchFromOpenRouter(): Promise<ModelPrice[]> {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    headers: process.env.OPENROUTER_API_KEY
      ? { 'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}` }
      : {},
  })
  if (!res.ok) throw new Error(`OpenRouter returned ${res.status}`)

  const data = await res.json() as { data?: OpenRouterModel[] }
  if (!data.data) return []

  const results: ModelPrice[] = []
  for (const m of data.data) {
    const provider = extractProvider(m.id)
    if (!provider) continue

    // OpenRouter pricing is per-token (not per million), convert
    const inputPerToken = parseFloat(m.pricing?.prompt || '0')
    const outputPerToken = parseFloat(m.pricing?.completion || '0')
    if (inputPerToken === 0 && outputPerToken === 0) continue

    results.push({
      model: extractModelName(m.id),
      provider,
      input_cost_per_million: Math.round(inputPerToken * 1_000_000 * 1000) / 1000,
      output_cost_per_million: Math.round(outputPerToken * 1_000_000 * 1000) / 1000,
    })
  }
  return results
}

async function fetchFromLiteLLM(): Promise<ModelPrice[]> {
  const res = await fetch('https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json')
  if (!res.ok) throw new Error(`LiteLLM returned ${res.status}`)

  const data = await res.json() as Record<string, any>
  const results: ModelPrice[] = []

  for (const [key, val] of Object.entries(data)) {
    if (typeof val !== 'object' || !val) continue
    const provider = val.litellm_provider as string | undefined
    if (!provider) continue

    // Map litellm provider names
    let mappedProvider: string | null = null
    const p = provider.toLowerCase()
    if (p.includes('openai')) mappedProvider = 'openai'
    else if (p.includes('anthropic') || p.includes('claude')) mappedProvider = 'anthropic'
    else if (p.includes('google') || p.includes('gemini') || p.includes('vertex')) mappedProvider = 'google'
    else if (p.includes('mistral')) mappedProvider = 'mistral'
    else if (p.includes('meta') || p.includes('llama')) mappedProvider = 'meta'
    else if (p.includes('cohere')) mappedProvider = 'cohere'
    if (!mappedProvider) continue

    const inputCost = val.input_cost_per_token as number | undefined
    const outputCost = val.output_cost_per_token as number | undefined
    if (!inputCost && !outputCost) continue

    // Extract model name — remove provider prefix if present
    let modelName = key
    if (modelName.includes('/')) {
      modelName = modelName.split('/').pop() || modelName
    }

    results.push({
      model: modelName,
      provider: mappedProvider,
      input_cost_per_million: Math.round((inputCost || 0) * 1_000_000 * 1000) / 1000,
      output_cost_per_million: Math.round((outputCost || 0) * 1_000_000 * 1000) / 1000,
    })
  }
  return results
}

export async function refreshFromSources(pool: Pg.Pool): Promise<{ updated: number; added: number; source: string }> {
  let freshPricing: ModelPrice[] = []
  let source = 'openrouter'

  try {
    freshPricing = await fetchFromOpenRouter()
    console.log(`Fetched ${freshPricing.length} models from OpenRouter`)
  } catch (err) {
    console.warn('OpenRouter fetch failed, trying LiteLLM:', err)
    try {
      freshPricing = await fetchFromLiteLLM()
      source = 'litellm'
      console.log(`Fetched ${freshPricing.length} models from LiteLLM`)
    } catch (err2) {
      console.error('Both pricing sources failed:', err2)
      return { updated: 0, added: 0, source: 'none' }
    }
  }

  if (freshPricing.length === 0) return { updated: 0, added: 0, source }

  // Get current pricing for diff
  const current = await getAllPricing(pool)
  const currentMap = new Map(current.map(p => [p.model, p]))

  let updated = 0
  let added = 0

  for (const fresh of freshPricing) {
    const existing = currentMap.get(fresh.model)

    if (!existing) {
      // New model — add it
      await upsertModelPricing(pool, fresh, source)
      added++
    } else {
      // Existing model — check for price changes
      const inputChanged = Math.abs(existing.input_cost_per_million - fresh.input_cost_per_million) > 0.001
      const outputChanged = Math.abs(existing.output_cost_per_million - fresh.output_cost_per_million) > 0.001

      if (inputChanged || outputChanged) {
        await upsertModelPricing(pool, fresh, source)
        updated++
      }
    }
  }

  if (updated > 0 || added > 0) {
    console.log(`Pricing refresh: ${updated} updated, ${added} new models (source: ${source})`)
    cacheLoadedAt = 0
  }

  return { updated, added, source }
}
