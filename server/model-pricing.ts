import type Pg from 'pg'

export interface ModelPrice {
  model: string
  provider: string
  input_cost_per_million: number
  output_cost_per_million: number
}

// In-memory cache
let pricingCache: ModelPrice[] = []
let cacheLoadedAt = 0
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

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

/**
 * Create the model_pricing and user_model_pricing tables and seed defaults if empty.
 */
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

  // User-level overrides — customer negotiated rates take precedence over defaults
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

  // Load into cache
  await refreshCache(pool)
}

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

/**
 * Get all model pricing (from cache).
 */
export async function getAllPricing(pool: Pg.Pool): Promise<ModelPrice[]> {
  if (Date.now() - cacheLoadedAt > CACHE_TTL_MS) {
    await refreshCache(pool)
  }
  return pricingCache
}

/**
 * Get pricing for a specific model. Returns null if unknown.
 */
export async function getModelPricing(pool: Pg.Pool, model: string): Promise<ModelPrice | null> {
  const all = await getAllPricing(pool)
  return all.find(p => p.model === model || p.model === model.toLowerCase()) || null
}

/**
 * Get user-specific pricing override for a model. Returns null if no override set.
 */
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

/**
 * Get all pricing for a user — user overrides merged on top of global defaults.
 */
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

/**
 * Set a user-level pricing override for a model.
 */
export async function upsertUserModelPricing(
  pool: Pg.Pool,
  userId: string,
  model: string,
  inputCost: number,
  outputCost: number,
): Promise<void> {
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

/**
 * Delete a user-level pricing override (revert to global default).
 */
export async function deleteUserModelPricing(pool: Pg.Pool, userId: string, model: string): Promise<void> {
  await pool.query('DELETE FROM user_model_pricing WHERE user_id = $1 AND model = $2', [userId, model])
}

/**
 * Calculate cost from model + token counts. Checks user override first, then global default.
 * Returns 0 if model is unknown.
 */
export async function calculateCostFromTokens(
  pool: Pg.Pool,
  model: string | undefined,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  userId?: string,
): Promise<number> {
  if (!model || (inputTokens == null && outputTokens == null)) return 0

  // Check user override first
  let pricing: ModelPrice | null = null
  if (userId) {
    pricing = await getUserModelPricing(pool, userId, model)
  }
  // Fall back to global default
  if (!pricing) {
    pricing = await getModelPricing(pool, model)
  }
  if (!pricing) return 0

  const inputCost = (inputTokens || 0) * pricing.input_cost_per_million / 1_000_000
  const outputCost = (outputTokens || 0) * pricing.output_cost_per_million / 1_000_000
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
}

/**
 * Upsert pricing for a model.
 */
export async function upsertModelPricing(pool: Pg.Pool, price: ModelPrice): Promise<void> {
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
  // Invalidate cache
  cacheLoadedAt = 0
}
