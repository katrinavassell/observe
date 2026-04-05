# Observe

**AI cost observability that connects cost to revenue to margin.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/katrinalaszlo/observe)](https://github.com/katrinalaszlo/observe)
[![npm](https://img.shields.io/npm/v/@tanso/observe)](https://www.npmjs.com/package/@tanso/observe)
[![GitHub issues](https://img.shields.io/github/issues/katrinalaszlo/observe)](https://github.com/katrinalaszlo/observe/issues)

![Observe Dashboard](docs/images/dashboard-screenshot.png)

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
| **Distributed traces** | Trace multi-step agent executions with span-level cost attribution |
| **Cohort analysis** | Customer segments by profitability and behavior |
| **Cost alerts** | 17 alert types across 5 categories (cost, margin, abuse/runaway, pricing, concentration risk) -- free for all users, each with a Tanso upsell CTA |
| **Configurable tables** | Column sorting on all data tables |
| **Free plan with limits** | Monthly event cap on free tier with usage meter and limit emails at 80%/100% |
| **AI insights** | AI-generated recommendations about margin compression and pricing (5 free/month) |
| **Bonus credits** | Earn extra AI credits by giving feedback (+5) or inviting teammates (+10) |
| **OpenAI/Anthropic integration** | Connect API keys to auto-pull usage data |
| **Stripe billing** | Subscribe to plans, manage billing through Stripe checkout and webhooks |
| **CSV upload** | Upload cost, usage, and revenue data without any API integration |
| **Team collaboration** | Invite team members with admin/viewer roles |
| **Admin dashboard** | Usage stats, email management for platform admins |
| **Welcome + login emails** | New signups and logins trigger notification emails via Resend |
| **PostHog tracking** | Product analytics events (signups, logins, upgrades, page views) |
| **Sample data** | Guests see a pre-populated dashboard with traces showing diverse cost types (LLM, embedding, vector_db, compute, API, database) |
| **Source badges** | See where each data point came from (Proxy, CSV Import, Stripe) |
| **RevenueCat-style SDK** | `Observe.configure()` + `identify()` + `wrap()` — three calls, zero headers |

---

## Quickstart

### Docker (recommended)

```bash
git clone https://github.com/katrinalaszlo/observe.git
cd observe
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
git clone https://github.com/katrinalaszlo/observe.git
cd observe
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

Frontend: `http://localhost:5000` | API: `http://localhost:3001`

The database schema is created automatically on first start.

---

## Proxy setup (one line)

Point your OpenAI or Anthropic client at Observe. Add one header. Every call is tracked automatically.

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-...",
    base_url="http://localhost:3001/v1",         # your Observe instance
    default_headers={"x-tanso-key": "sk_live_..."},  # SDK key from Data Sources
)

# That's it. Cost, model, and tokens are logged for every call.
```

No customer ID or feature key required to start. Observe auto-derives the feature from the endpoint and defaults the customer to `"default"`.

<details>
<summary>Per-customer attribution (optional)</summary>

Add headers when you need cost breakdowns per customer and feature:

```python
client = OpenAI(
    api_key="sk-...",
    base_url="http://localhost:3001/v1",
    default_headers={
        "x-tanso-key":      "sk_live_...",
        "x-tanso-customer": "cus_acme",      # your customer ID
        "x-tanso-feature":  "ai-assistant",   # which feature
    },
)
```

</details>

<details>
<summary>Anthropic proxy</summary>

```python
import anthropic

client = anthropic.Anthropic(
    api_key="sk-ant-...",
    base_url="http://localhost:3001",
    default_headers={"x-tanso-key": "sk_live_..."},
)
```

</details>

**Supported proxy endpoints:**

| Endpoint | Proxied to |
|---|---|
| `POST /v1/chat/completions` | OpenAI chat completions |
| `POST /v1/embeddings` | OpenAI embeddings |
| `POST /v1/messages` | Anthropic messages |

Without `x-tanso-key`, the request is still proxied but no event is logged. The proxy never blocks or modifies your request.

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
  -H "Authorization: Bearer sk_live_..." \
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
  |-- /cohorts/*             Cohort analysis
  |-- /admin/*               Admin dashboard (restricted)
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

## Documentation

Full docs are in the [`docs/`](docs/README.md) directory:

- [Quickstart](docs/quickstart.md) -- get running in 60 seconds
- [Configuration](docs/configuration.md) -- environment variable reference
- [Self-Hosting Guide](docs/self-hosting.md) -- production deployment with Docker, reverse proxy, and PostgreSQL
- [Security Model](docs/security.md) -- authentication, data isolation, rate limiting
- [Next.js Integration](docs/guides/nextjs.md) -- SDK setup in Next.js apps
- [LangChain Integration](docs/guides/langchain.md) -- proxy mode with LangChain
- [API Reference](docs/API.md) -- all backend endpoints
- [Architecture](docs/ARCHITECTURE.md) -- system design and data flow
- [Troubleshooting](docs/troubleshooting.md) -- common issues and fixes

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm run test        # run tests
npm run typecheck   # type-check
npm run lint        # lint
```

---

## Community

- [Discord](https://discord.gg/zSVwxgvxCj) -- chat with the team and other users
- [GitHub Issues](https://github.com/katrinalaszlo/observe/issues) -- bug reports and feature requests
- [GitHub Discussions](https://github.com/katrinalaszlo/observe/discussions) -- questions, ideas, show & tell

---

## License

Apache 2.0. See [LICENSE](LICENSE).
