# observe

**See your LLM cost per customer and per feature. Drop-in for AI-native founder stacks.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![CI](https://github.com/katrinalaszlo/observe/actions/workflows/ci.yml/badge.svg)](https://github.com/katrinalaszlo/observe/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@tansohq/observe)](https://www.npmjs.com/package/@tansohq/observe)

![Dashboard](./assets/hero.png)

---

## Why this exists

You know your total LLM bill. You don't know which customer is eating your margin or which feature costs 10x what it earns. Tools like LiteLLM, Helicone, Portkey, and Cloudflare AI Gateway track and cache LLM costs — but they don't connect cost to revenue. observe does. It attributes cost per customer and per feature, joins it with your Stripe revenue data, and shows you margin by customer, feature, and model. If you're running an AI product with paying customers, observe tells you exactly where you're losing money.

---

## Quick start

### Docker (self-hosted)

```bash
git clone https://github.com/katrinalaszlo/observe.git
cd observe
cp .env.example .env    # fill in DATABASE_URL + CLERK_SECRET_KEY
docker compose up       # app on http://localhost:3000
```

### npm (local dev)

```bash
git clone https://github.com/katrinalaszlo/observe.git
cd observe
npm install
cp .env.example .env    # fill in required vars (see .env.example for list)
npm run dev             # frontend :5173 | API :3001
```

Database schema (40 tables) is created automatically on first start.

### Point your OpenAI/Anthropic SDK at observe

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-...",
    base_url="http://localhost:3001/v1",          # your observe instance
    default_headers={
        "Observe-Key":      "obs_...",            # from Data Sources page
        "Observe-Customer": "cus_acme",           # your customer ID
        "Observe-Feature":  "ai_chat",            # your feature name
    },
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
# cost, tokens, model, customer, feature — all tracked automatically
```

<details>
<summary>Anthropic</summary>

```python
import anthropic

client = anthropic.Anthropic(
    api_key="sk-ant-...",
    base_url="http://localhost:3001",
    default_headers={
        "Observe-Key":      "obs_...",
        "Observe-Customer": "cus_acme",
        "Observe-Feature":  "document_qa",
    },
)
```

</details>

<details>
<summary>SDK wrapper (zero headers)</summary>

```bash
npm install @tansohq/observe
```

```typescript
import { Observe } from '@tansohq/observe'
import OpenAI from 'openai'

Observe.configure({ apiKey: process.env.OBSERVE_API_KEY! })
Observe.identify({ customerId: user.id })

const openai = Observe.wrap(new OpenAI())
// all calls are auto-tracked with customer + feature attribution
```

</details>

---

## What you get

- **Per-customer cost attribution** — see which customers cost the most to serve, ranked by margin
- **Per-feature cost attribution** — break down cost by feature (ai_chat, pdf_summary, search, etc.)
- **Stripe revenue enrichment** — connect Stripe to allocate MRR across events and compute margin
- **Margin analysis** — revenue minus cost by customer, feature, model, and time period
- **Cost alerts** — 8 curated types: cost spikes, margin floor violations, concentration risk, unprofitable customers, model shift detection
- **AI-generated insights** — margin compression recommendations via Anthropic
- **Distributed tracing** — trace multi-step agent executions with span-level cost attribution
- **CSV bulk import** — upload cost, usage, and revenue data without API integration
- **Model pricing auto-refresh** — 100+ models with per-token pricing, refreshed hourly via OpenRouter
- **OpenAI + Anthropic gateway** — drop-in proxy with streaming, caching, and automatic cost logging
- **SDK event ingestion** — send events from your backend via HTTP or the `@tansohq/observe` npm package

---

## vs alternatives

Every tool in this space tracks LLM cost. observe is the only one that connects cost to revenue and shows margin.

|  | observe | LiteLLM | Helicone | Portkey | Cloudflare AI Gateway |
|---|---|---|---|---|---|
| Per-customer cost tagging | Yes | Yes | Yes | Yes | Yes |
| Per-feature cost tagging | Yes | Yes | Yes | Yes | Yes |
| Revenue + margin analysis | **Yes** | No | No | No | No |
| Self-hosted | Yes | Yes | Yes | Gateway only | No |
| Free / open-source | Apache 2.0 | MIT | Apache 2.0 | Gateway: Apache 2.0 | Free tier (not OSS) |
| Drop-in proxy | Yes | Yes | Yes | Yes | Yes |

Notes: Helicone was [acquired by Mintlify](https://www.helicone.ai/blog/joining-mintlify) in March 2026 and is in maintenance mode. Portkey's gateway is open source but analytics/dashboard features require their managed platform.

---

## Architecture

```
Your app
  |
  |  OPENAI_BASE_URL=http://observe:3001/v1
  |  + Observe-Customer + Observe-Feature headers
  v
┌─────────────────────────────────────────────┐
│  observe (Express 5, Node.js 20)            │
│                                             │
│  /v1/*          → OpenAI/Anthropic proxy    │
│  /events/ingest → SDK event ingestion       │
│  /analytics/*   → margin reports & exports  │
│  /alerts/*      → cost alert rules          │
│  /insights/*    → AI recommendations        │
│  /customers/*   → customer profitability    │
│  /stripe/*      → revenue enrichment        │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │  PostgreSQL (observe_events table)    │  │
│  │  cost + revenue + tokens + customer   │  │
│  │  + feature + model + trace_id         │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
  |
  v
Vue 3 dashboard (Vite + Tailwind + shadcn-vue)
```

All data — gateway, SDK, Stripe, CSV — lands in a single `observe_events` table. Margin queries aggregate from this one table.

| Layer | Stack |
|---|---|
| Frontend | Vue 3, TypeScript, Vite, Tailwind CSS, shadcn-vue |
| Backend | Express 5, Node.js 20 |
| Database | PostgreSQL 16+ (Supabase, Neon, or any standard pg) |
| Auth | Clerk |
| Billing | Stripe |

---

## Roadmap

### v0.1.0 (current)

Gateway proxy, SDK ingestion, per-customer and per-feature attribution, Stripe revenue enrichment, margin analysis, cost alerts, AI insights, distributed tracing, CSV import, model pricing auto-refresh.

### v0.2.0

Multi-target routing with failover and load balancing. Cloud cost integration (AWS Cost Explorer, GCP Billing). ML-based cost inference from incomplete data.

### v0.3.0

Cost forecasting, budget alerts, spend limits per customer and per feature.

---

## Documentation

Full docs in [`docs/`](docs/README.md):

- [Quickstart](docs/quickstart.md)
- [Configuration](docs/configuration.md) — env var reference
- [Self-Hosting](docs/self-hosting.md) — production deployment
- [Security](docs/security.md) — auth, data isolation, rate limiting
- [API Reference](docs/API.md)
- [Architecture](docs/ARCHITECTURE.md)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

Apache 2.0. See [LICENSE](LICENSE).
