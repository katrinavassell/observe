# Observe

**AI cost observability that connects cost to revenue to margin.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)

---

## Why this exists

Helicone shows you what your AI calls cost. That's it. You still have to answer the questions that actually matter: which features are unprofitable? Which customers cost more to serve than they pay? What happens to margins if you raise prices on one plan?

Observe closes that loop. It tracks AI cost at the feature and customer level, joins it with your revenue data, and gives you margin-by-feature breakdowns, per-customer profitability, and AI-powered insights to optimize pricing.

If you're running an AI product and you're losing money on a subset of customers or features, Observe shows you exactly where and by how much.

---

## Features

| Feature | What it does |
|---|---|
| **OpenAI + Anthropic proxy** | Swap one URL, get automatic cost logging for all chat and embedding calls |
| **SDK event ingestion** | Send cost + revenue + usage events from your backend in a single HTTP call |
| **Analytics dashboard** | Revenue, costs, and margin overview with trend charts |
| **AI model breakdown** | Cost and volume by model (gpt-4o, claude-sonnet, etc.) |
| **Cost alerts** | Threshold-based alerts with email notifications |
| **AI insights** | AI-generated recommendations about margin compression and pricing opportunities |
| **OpenAI/Anthropic integration** | Connect API keys to auto-pull usage data |
| **Stripe billing** | Subscribe to plans, manage billing through Stripe checkout |
| **CSV upload** | Upload cost, usage, and revenue data without any API integration |
| **Team collaboration** | Invite team members with admin/viewer roles |
| **Sample data** | Explore with a realistic pre-populated dataset |

---

## Quickstart

### Docker (recommended)

```bash
git clone https://github.com/tansohq/metrics-onboarding.git
cd metrics-onboarding
docker compose up
```

App: `http://localhost:3000`

Set a real session secret before any non-local deployment:

```bash
SESSION_SECRET=your-secret docker compose up
```

### npm (local development)

**Prerequisites:** Node.js 20+, PostgreSQL 16+

```bash
git clone https://github.com/tansohq/metrics-onboarding.git
cd metrics-onboarding
npm install
```

Create a `.env` file (see `.env.example` for all options):

```env
DATABASE_URL=postgresql://user:password@localhost:5432/tanso
SESSION_SECRET=any-random-string-at-least-32-chars
```

```bash
npm run dev
```

Frontend: `http://localhost:5173` | API: `http://localhost:3001`

The database schema is created automatically on first start.

---

## Proxy setup (one line)

Point your OpenAI or Anthropic client at your Observe instance. Your API key goes in the auth header as normal. Observe forwards the request transparently and logs the cost in the background.

### OpenAI

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-...",
    base_url="http://localhost:3001/v1",     # swap this line
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
    extra_headers={
        "x-tanso-key":      "obs_...",       # your Observe SDK key
        "x-tanso-customer": "cus_acme",
        "x-tanso-feature":  "chat",
    },
)
```

### Anthropic

```python
import anthropic

client = anthropic.Anthropic(
    api_key="sk-ant-...",
    base_url="http://localhost:3001",         # swap this line
)
```

**Supported proxy endpoints:**

| Endpoint | Proxied to |
|---|---|
| `POST /v1/chat/completions` | OpenAI chat completions |
| `POST /v1/embeddings` | OpenAI embeddings |
| `POST /v1/messages` | Anthropic messages |

Without `x-tanso-key`, the request is still proxied but no event is logged. The proxy never blocks or modifies your request. Responses can be cached to reduce costs (see proxy cache in the architecture docs).

---

## SDK (zero latency, 3 lines)

```bash
npm install @tanso/observe
```

```typescript
import { TansoObserve } from '@tanso/observe'

const tanso = new TansoObserve({ apiKey: 'sk_live_...' })

tanso.track({
  eventName: 'chat_response',
  customerReferenceId: 'cust_123',
  featureKey: 'ai-assistant',
  model: 'gpt-4o',
  costAmount: 0.03,
})
```

Fire-and-forget. Events are batched and sent asynchronously. If Observe is unreachable, events are silently dropped -- your app's latency is never affected.

### Auto-capture with wrappers

```typescript
import { wrapOpenAI } from '@tanso/observe/openai'
const openai = wrapOpenAI(new OpenAI(), tanso, {
  customerReferenceId: 'cust_123',
  featureKey: 'ai-chat',
})
// Every call is automatically tracked with model, tokens, and cost
```

Also available: `wrapAnthropic` from `@tanso/observe/anthropic`.

---

## HTTP event ingestion

For providers without proxy or SDK support, or when you need to attach revenue data, send events directly. Generate an SDK key under **Data Sources > API Keys** in the dashboard.

```bash
curl -X POST http://localhost:3001/events/ingest \
  -H "Authorization: Bearer obs_..." \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "eventName":           "inference",
      "customerReferenceId": "cus_acme",
      "featureKey":          "pdf_summarization",
      "costAmount":          0.0042,
      "revenueAmount":       0.02,
      "model":               "claude-sonnet-4-20250514"
    }]
  }'
```

**Event fields:**

| Field | Required | Description |
|---|---|---|
| `eventName` | yes | e.g. `"inference"`, `"api_call"` |
| `customerReferenceId` | yes | Your customer identifier |
| `featureKey` | yes | Feature this event belongs to |
| `costAmount` | no | Cost in USD |
| `revenueAmount` | no | Revenue attributed to this event |
| `usageUnits` | no | Unit count (tokens, requests, pages) |
| `model` | no | Model name |
| `properties` | no | Arbitrary metadata |
| `idempotencyKey` | no | Deduplicate retries |

Batch limit: 1000 events per request. Invalid events are rejected individually -- valid ones still accepted.

---

## Architecture

```
Browser (Vue 3 SPA)
        |
        v
Express API  (port 3001)
  |-- /v1/*                  OpenAI + Anthropic proxy
  |-- /events/ingest         SDK event ingestion (public, key-authenticated)
  |-- /auth/*                Signup, login, password reset
  |-- /data/*                CSV upload, sample data, Stripe sync
  |-- /integrations/*        OpenAI/Anthropic API key connections
  |-- /alerts/*              Cost alert rules
  |-- /tanso/*               Billing (plans, subscriptions, entitlements)
  |-- /team/*                Team invites, roles
  |-- /insights/*            AI-generated insights
  |-- /analytics/*           Customer P&L, margin alerts
  |-- /models/*              Model pricing data
        |
        v
PostgreSQL (observe_events + 20 supporting tables)
```

All data -- proxy, SDK, Stripe, CSV -- lands in a single `observe_events` table with the same schema. Margin queries aggregate from this one table.

| Layer | Technology |
|---|---|
| Frontend | Vue 3, TypeScript, Vite, Tailwind CSS, Chart.js, shadcn-vue |
| Backend | Express 5, Node.js 20 |
| Database | PostgreSQL 16 (Neon serverless or standard pg) |
| Billing | Tanso SDK + Stripe |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm run test        # run tests
npm run typecheck   # type-check
npm run lint        # lint
```

---

## License

Apache 2.0. See [LICENSE](LICENSE).
