# Observe

**AI cost observability that connects cost to revenue to margin.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/katrinalaszlo/observe)](https://github.com/katrinalaszlo/observe)

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
| **OpenAI + Anthropic gateway** | Swap one URL, get automatic cost logging for all chat and embedding calls. Headers attach customer + feature attribution. |
| **SDK event ingestion** | Send cost + revenue + usage events from your backend in a single HTTP call |
| **Analytics dashboard** | Revenue, costs, and margin overview. Group by feature, model, customer, agent, or cost type. |
| **Distributed traces** | Trace multi-step agent executions with span-level cost attribution |
| **Cohort analysis** | Group customers by profitability, segment, or custom rules |
| **Cost alerts** | 8 curated alert types (cost spikes, margin floors, unprofitable top customers, concentration risk, etc.) delivered via email |
| **Ask Observe (AI side panel)** | Global ⌘K command palette — ask natural-language questions about your data, get answers and one-click actions (create alert, create cohort, route customer) |
| **AI insights** | AI-generated recommendations about margin compression and pricing (5 free/month) |
| **Free plan with limits** | Monthly event cap on free tier with usage meter |
| **OpenAI/Anthropic integration** | Connect API keys to auto-pull usage data |
| **Stripe billing** | Subscribe to plans, manage billing through Stripe checkout and webhooks |
| **CSV upload** | Upload cost, usage, and revenue data without any API integration |
| **Team collaboration** | Invite team members with admin/viewer roles |
| **Guest preview** | Logged-out visitors see a pre-populated dashboard rendered entirely client-side — sample data never touches the database |
| **Source badges** | See where each data point came from (Gateway, SDK, CSV, Stripe) |
| **llms.txt install** | Point your AI agent at `observemetrics.com/llms.txt` + your API key and it'll wire up Observe in your repo |

---

## Quickstart

### Docker (recommended)

```bash
git clone https://github.com/katrinalaszlo/observe.git
cd observe
cp .env.example .env
docker compose up
```

App: `http://localhost:3000`

### npm (local development)

**Prerequisites:** Node.js 20+, PostgreSQL 16+ (or Supabase Postgres)

```bash
git clone https://github.com/katrinalaszlo/observe.git
cd observe
npm install
cp .env.example .env
```

Required env vars:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/observe
SESSION_SECRET=any-random-string-at-least-32-chars
INTEGRATION_ENCRYPTION_KEY=any-random-string-at-least-16-chars   # openssl rand -hex 32
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=...
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...
```

```bash
npm run dev
```

Frontend: `http://localhost:5000` | API: `http://localhost:3001`

The database schema is created automatically on first start (observe_events + ~30 supporting tables).

---

## Gateway setup (one line)

Point your OpenAI or Anthropic client at the Observe gateway. Add one header. Every call is tracked automatically.

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-...",                                  # your real provider key
    base_url="https://observemetrics.com/v1",          # or your self-hosted URL
    default_headers={"x-tanso-key": "obs_..."},        # your Observe key from Data Sources
)

# Cost, model, tokens, customer, feature — all tracked automatically.
```

You can also route to a self-hosted instance: swap `base_url` to `http://localhost:3001/v1`.

<details>
<summary>Per-customer + per-feature attribution (recommended)</summary>

```python
client = OpenAI(
    api_key="sk-...",
    base_url="https://observemetrics.com/v1",
    default_headers={
        "x-tanso-key":      "obs_...",
        "x-tanso-customer": user.stripe_customer_id,  # cus_...
        "x-tanso-feature":  "ai_chat",                # your feature name
    },
)
```

</details>

<details>
<summary>Anthropic</summary>

```python
import anthropic

client = anthropic.Anthropic(
    api_key="sk-ant-...",
    base_url="https://observemetrics.com",
    default_headers={"x-tanso-key": "obs_..."},
)
```

</details>

**Supported endpoints:**

| Endpoint | Proxied to |
|---|---|
| `POST /v1/chat/completions` | OpenAI chat completions (streaming supported) |
| `POST /v1/embeddings` | OpenAI embeddings |
| `POST /v1/messages` | Anthropic messages |

---

## SDK (zero headers, zero-latency wrap)

```bash
npm install @tansohq/observe
```

```typescript
import { Observe } from '@tansohq/observe'
import OpenAI from 'openai'

// 1. Configure once at startup
Observe.configure({ apiKey: process.env.OBSERVE_API_KEY! })

// 2. Identify the current customer at request time
Observe.identify({ customerId: user.stripeCustomerId })

// 3. Wrap the OpenAI client — all calls are auto-tracked
const openai = Observe.wrap(new OpenAI())

await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
})
```

`Observe.wrap()` rewrites the client's `baseURL` to the Observe gateway and injects the tracking headers. Anthropic works the same way.

Per-call feature override:

```typescript
await openai.chat.completions.create(
  { model: 'gpt-4o', messages },
  { headers: { 'x-tanso-feature': 'summarize_email' } }
)
```

### Install with your AI agent

Observe exposes an [`llms.txt`](https://observemetrics.com/llms.txt) optimized for LLM consumption. Paste this into Cursor / Claude Code / Copilot and it'll wire up Observe in your repo automatically:

```
Install Observe by Tanso. Docs: https://observemetrics.com/llms.txt
My API key: obs_...
Wrap all OpenAI/Anthropic calls to report cost, customer, and feature.
```

---

## HTTP event ingestion

For providers without a gateway, or when you need to attach revenue data, send events directly.

```bash
curl -X POST https://observemetrics.com/events/ingest \
  -H "Authorization: Bearer obs_..." \
  -H "Content-Type: application/json" \
  -d '{
    "events": [{
      "eventName":           "inference",
      "customerReferenceId": "cus_acme",
      "featureKey":          "pdf_summarization",
      "costAmount":          0.0042,
      "revenueAmount":       0.02,
      "model":               "claude-3-5-sonnet"
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

Batch limit: 1000 events per request. Invalid events are rejected individually — valid ones still accepted.

---

## Architecture

```
Browser (Vue 3 SPA)
        |
        v
Express API  (port 3001)
  |-- /v1/*                  OpenAI + Anthropic gateway (streaming-capable)
  |-- /events/ingest         SDK event ingestion (public, key-authenticated)
  |-- /auth/*                Signup, login, password reset (Supabase-backed)
  |-- /data/*                CSV upload, data management
  |-- /integrations/*        OpenAI/Anthropic/Stripe/AWS/GCP connections
  |-- /alerts/*              Cost alert rules
  |-- /team/*                Team invites, roles
  |-- /insights/*            AI-generated insights
  |-- /analytics/*           Customer P&L, margin alerts, feature breakdown
  |-- /models/*              Model pricing data
  |-- /cohorts/*             Cohort analysis
  |-- /sdk-keys/*            API key management
  |-- /admin/*               Admin dashboard (restricted)
        |
        v
PostgreSQL (observe_events + ~30 supporting tables)
```

All data — gateway, SDK, Stripe, CSV — lands in a single `observe_events` table with the same schema. Margin queries aggregate from this one table.

A `CHECK` constraint on `observe_events.source` rejects any row tagged `'sample'` at insert time, so the database cannot contain preview data. Guest preview is rendered entirely client-side from `src/lib/guest-preview.ts` — it never touches the server.

| Layer | Technology |
|---|---|
| Frontend | Vue 3, TypeScript, Vite, Tailwind CSS, shadcn-vue, radix-vue |
| Backend | Express 5, Node.js 20 |
| Database | PostgreSQL 16 (Supabase or any standard pg) |
| Auth | Supabase Auth (JWT Bearer) |
| Billing | Stripe |

---

## Documentation

Full docs are in the [`docs/`](docs/README.md) directory:

- [Quickstart](docs/quickstart.md) — get running in 60 seconds
- [Configuration](docs/configuration.md) — environment variable reference
- [Self-Hosting Guide](docs/self-hosting.md) — production deployment
- [Security Model](docs/security.md) — authentication, data isolation, rate limiting
- [Next.js Integration](docs/guides/nextjs.md) — SDK setup in Next.js apps
- [LangChain Integration](docs/guides/langchain.md) — gateway mode with LangChain
- [API Reference](docs/API.md) — all backend endpoints
- [Architecture](docs/ARCHITECTURE.md) — system design and data flow
- [Troubleshooting](docs/troubleshooting.md) — common issues and fixes

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

- [Discord](https://discord.gg/6GHcsaQTy7) — chat with the team and other users
- [GitHub Issues](https://github.com/katrinalaszlo/observe/issues) — bug reports and feature requests
- [GitHub Discussions](https://github.com/katrinalaszlo/observe/discussions) — questions, ideas, show & tell

---

## License

Apache 2.0. See [LICENSE](LICENSE).
