# Helicone to Tanso Migration Guide

Helicone was acquired by Mintlify (2026-03-03) and entered maintenance mode. This guide covers how to migrate your Helicone integration to Tanso with minimal code changes.

---

## What Helicone gave you

| Capability | Helicone | Tanso equivalent |
|---|---|---|
| Request logging | Auto-logged via proxy | Auto-logged via proxy (`source: 'proxy'` in `observe_events`) |
| Cost tracking | Per-request, per-model | Per-request, per-model, per-feature, per-customer |
| Token counting | prompt_tokens + completion_tokens | Same, extracted from provider response |
| Custom properties | `Helicone-Property-*` headers | Same headers accepted, stored in `properties` JSONB column |
| User tracking | `Helicone-User-Id` header | Same header accepted, mapped to `customer_id` |
| Session grouping | `Helicone-Session-Id` header | Same header accepted, mapped to `feature_key` |
| Caching | Built-in response cache | Built-in response cache (`proxy_cache` table) |
| Rate limiting | Per-key rate limits | Express rate limiter on proxy endpoints |
| Revenue/margin analysis | Not available | Real-time P&L per feature, customer, and model |
| Pricing simulations | Not available | Built-in simulation engine |

---

## Step 1: Change your base URL

### OpenAI (Python)

```python
from openai import OpenAI

# Before (Helicone)
client = OpenAI(
    api_key="sk-...",
    base_url="https://oai.helicone.ai/v1",
    default_headers={
        "Helicone-Auth": "Bearer sk_helicone_...",
        "Helicone-User-Id": "user_123",
        "Helicone-Property-environment": "production",
    }
)

# After (Tanso) -- change URL and auth key, everything else stays
client = OpenAI(
    api_key="sk-...",
    base_url="https://app.tanso.io/v1",
    default_headers={
        "Helicone-Auth": "Bearer sk_live_...",
        "Helicone-User-Id": "user_123",
        "Helicone-Property-environment": "production",
    }
)
```

### OpenAI (Node/TypeScript)

```typescript
import OpenAI from 'openai'

const openai = new OpenAI({
  baseURL: 'https://app.tanso.io/v1',
  defaultHeaders: {
    'Helicone-Auth': 'Bearer sk_live_...',
    'Helicone-User-Id': 'user_123',
    'Helicone-Property-environment': 'production',
  },
})
```

### Anthropic (Python)

```python
import anthropic

# Before (Helicone)
client = anthropic.Anthropic(
    api_key="sk-ant-...",
    base_url="https://anthropic.helicone.ai",
    default_headers={
        "Helicone-Auth": "Bearer sk_helicone_...",
        "Helicone-User-Id": "user_123",
    }
)

# After (Tanso)
client = anthropic.Anthropic(
    api_key="sk-ant-...",
    base_url="https://app.tanso.io",
    default_headers={
        "Helicone-Auth": "Bearer sk_live_...",
        "Helicone-User-Id": "user_123",
    }
)
```

### Anthropic (Node/TypeScript)

```typescript
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  baseURL: 'https://app.tanso.io',
  defaultHeaders: {
    'Helicone-Auth': 'Bearer sk_live_...',
    'Helicone-User-Id': 'user_123',
  },
})
```

---

## Step 2: Get a Tanso SDK key

1. Open the Tanso dashboard
2. Go to **Data Sources > API Keys**
3. Click **Create API Key**
4. Copy the `sk_live_...` key -- this replaces your Helicone key in the `Helicone-Auth` header

---

## Header mapping reference

The proxy routes in `server/index.ts` use `parseProxyHeaders()` to extract both Helicone and native Tanso headers.

| Helicone header | Tanso-native header | Maps to | Used for |
|---|---|---|---|
| `Helicone-Auth: Bearer <key>` | `x-tanso-key: <key>` | SDK API key lookup | Authenticates the request for event logging |
| `Helicone-User-Id` | `x-tanso-customer` | `customer_id` column | Per-customer cost/margin tracking |
| `Helicone-Session-Id` | `x-tanso-feature` | `feature_key` column | Per-feature cost/margin tracking |
| `Helicone-Property-*` | (no equivalent) | `properties` JSONB column | Arbitrary metadata stored with event |

### How header resolution works

1. **Auth**: Checks `x-tanso-key` first, then falls back to `Helicone-Auth` (stripping the `Bearer ` prefix)
2. **Customer**: Checks `Helicone-User-Id` first, then `x-tanso-customer`, defaults to `'unknown'`
3. **Feature**: Checks `Helicone-Session-Id` first, then `x-tanso-feature`, defaults to endpoint name
4. **Properties**: Iterates all headers matching `helicone-property-*`, strips the prefix, stores as key-value pairs

---

## Proxy endpoints

| Endpoint | Provider | Auth header | Notes |
|---|---|---|---|
| `POST /v1/chat/completions` | OpenAI | `Authorization: Bearer sk-...` (OpenAI key) | Extracts `prompt_tokens`, `completion_tokens`, model |
| `POST /v1/embeddings` | OpenAI | `Authorization: Bearer sk-...` (OpenAI key) | Extracts `prompt_tokens` or `total_tokens` |
| `POST /v1/messages` | Anthropic | `x-api-key: sk-ant-...` (Anthropic key) | Extracts `input_tokens`, `output_tokens` |
| `GET /v1/models` | OpenAI | `Authorization: Bearer sk-...` (OpenAI key) | Pass-through, no event logged |

All proxy endpoints forward transparently, return the provider's response immediately, and log cost/usage asynchronously.

---

## How proxy data feeds into the dashboard

Every proxied request creates a row in `observe_events` with `source = 'proxy'`. This is the same table used by SDK ingestion, Stripe sync, and CSV upload.

```
OpenAI/Anthropic call
    |
    v
Tanso proxy
    |
    +--> Forward to provider, return response to caller
    |
    +--> (async) Extract model, tokens, compute cost
    |
    +--> (async) INSERT INTO observe_events
              source = 'proxy'
              model_provider = 'openai' | 'anthropic'
              customer_id = from Helicone-User-Id
              feature_key = from Helicone-Session-Id
              properties = from Helicone-Property-*
    |
    v
Dashboard queries
    +--> Features page: cost/revenue/margin by feature_key
    +--> Models page: cost/volume by model
    +--> Customers page: cost/margin by customer_id
    +--> Analytics page: MRR, total costs, net margin, P&L
    +--> Events page: raw event log with filters
    +--> Insights page: AI-generated margin analysis
```

### Cost calculation

Hardcoded pricing tables per provider:

**OpenAI**: gpt-4o ($2.50/$10.00), gpt-4o-mini ($0.15/$0.60), gpt-4 ($30/$60), o1 ($15/$60), embeddings ($0.02-$0.13) per 1M tokens.

**Anthropic**: claude-sonnet-4 ($3/$15), claude-haiku-4 ($0.80/$4), claude-3-5-sonnet ($3/$15), claude-3-opus ($15/$75) per 1M tokens.

Unknown models get cost = $0 (logged but not priced).

---

## Step 3: Import historical Helicone data

1. Export request logs from Helicone (Settings > Export)
2. Open Tanso dashboard > **Data Sources > Upload CSV**
3. Map Helicone columns to Tanso fields:
   - `model` -> model
   - `prompt_tokens` + `completion_tokens` -> usage_units
   - `user_id` -> customer_id
   - `created_at` -> timestamp
   - `total_cost` -> cost_amount

---

## What you gain by migrating

### Revenue context (Helicone never had this)

Tanso joins AI costs with revenue data (Stripe, CSV, or SDK events):

- **Per-feature P&L**: "AI summarization costs $0.03/call but generates $0.12/call = 75% margin"
- **Per-customer profitability**: "Acme costs $450/mo but pays $200/mo = -$250/mo margin"
- **Negative margin alerts**: Auto-flags features and customers losing money
- **Margin trends**: Month-over-month direction per feature

### Pricing simulations

Model price changes before shipping them. See revenue impact and churn risk.

### Self-hosting

`docker compose up` gives you the full stack. All data stays local. Apache 2.0.

---

## Known limitations vs Helicone

| Limitation | Status | Workaround |
|---|---|---|
| Streaming proxy (`stream: true`) | In progress | Use SDK wrapper for streaming calls |
| Prompt versioning / management | Not planned | Use your own; Tanso focuses on economics |
| Helicone CSV auto-mapper | Planned | Manual column mapping via CSV upload |
| Pre-built Docker Hub image | Planned | Clone repo + `docker compose up` works today |

---

## Alternative: Use the SDK instead of proxy

If you don't want middleware in your request path:

```typescript
import { TansoObserve } from '@tanso/observe'
import { wrapOpenAI } from '@tanso/observe/openai'
import OpenAI from 'openai'

const tanso = new TansoObserve({ apiKey: 'sk_live_...' })
const openai = wrapOpenAI(new OpenAI(), tanso, {
  customerReferenceId: 'user_123',
  featureKey: 'chat',
})

// Calls go directly to OpenAI. Tanso observes async, after the response.
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
})
```

Zero latency. If Tanso is unreachable, events are silently dropped.
