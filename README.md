# Observe

**AI cost observability that connects cost to revenue to margin.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/docker/pulls/tanso/observe)](https://hub.docker.com/r/tanso/observe)

---

## Why this exists

Helicone shows you what your AI calls cost. That's it. You still have to answer the questions that actually matter: which features are unprofitable? Which customers cost more to serve than they pay? What happens to margins if you raise prices on one plan?

Observe closes that loop. It tracks AI cost at the feature and customer level, joins it with your revenue data, and gives you margin-by-feature breakdowns, per-customer profitability, and a simulation engine to model pricing changes before you ship them.

If you're running an AI product and you're losing money on a subset of customers or features, Observe shows you exactly where and by how much.

---

## Features

| Feature | What it does |
|---|---|
| **OpenAI + Anthropic proxy** | Swap one URL, get automatic cost logging for all chat and embedding calls |
| **SDK event ingestion** | Send cost + revenue + usage events from your backend in a single HTTP call |
| **Feature-level economics** | See cost, revenue, margin %, and margin trend per feature key |
| **Per-customer profitability** | Identify customers where your cost-to-serve exceeds what they pay |
| **AI model breakdown** | Cost and volume by model (gpt-4o, claude-sonnet, etc.) |
| **Pricing simulations** | Model a price change across a customer segment, see revenue impact and churn risk |
| **AI insights** | AI-generated recommendations about margin compression and pricing opportunities |
| **Stripe sync** | Import customers, subscriptions, and invoices directly from your Stripe account |
| **CSV upload** | Upload cost, usage, and revenue data without any API integration |
| **Sample data** | Explore with a realistic pre-populated dataset — no credentials needed |

---

## Quickstart

### Docker (recommended)

```bash
git clone https://github.com/tanso/observe.git
cd observe
docker compose up
```

Dashboard: `http://localhost:5173` | API: `http://localhost:3001`

Set a real session secret before any non-local deployment:

```bash
SESSION_SECRET=your-secret docker compose up
```

### npm (local development)

**Prerequisites:** Node.js 20+, PostgreSQL 16+

```bash
git clone https://github.com/tanso/observe.git
cd observe
npm install
```

Create a `.env` file:

```env
DATABASE_URL=postgresql://user:password@localhost:5432/observe
SESSION_SECRET=any-random-string-at-least-32-chars
```

```bash
npm run dev
```

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

Without `x-tanso-key`, the request is still proxied but no event is logged. The proxy never blocks or modifies your request.

---

## SDK event ingestion

For providers without proxy support, or when you need to attach revenue data, send events directly. Generate an SDK key under **Data Sources > API Keys** in the dashboard.

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

Batch limit: 1000 events per request. Invalid events are rejected individually — valid ones still accepted.

---

## Architecture

```
Browser (Vue 3 SPA)
        |
        v
Express API  (port 3001)
  |-- /v1/*                  OpenAI + Anthropic proxy
  |-- /events/ingest         SDK event ingestion
  |-- /api/events/*          Query events by feature, customer, model
  |-- /api/simulations/*     Pricing simulation engine
  |-- /api/insights/*        AI-generated insights
        |
        v
PostgreSQL (observe_events)
```

All data — proxy, SDK, Stripe, CSV — lands in a single `observe_events` table with the same schema. Margin queries aggregate from this one table.

| Layer | Technology |
|---|---|
| Frontend | Vue 3, TypeScript, Vite, Tailwind CSS, Chart.js |
| Backend | Express 5, Node.js 20 |
| Database | PostgreSQL 16 |

---

## Migrating from Helicone?

Change your `base_url` from `https://oai.helicone.ai/v1` to your Observe instance. The `Authorization` header format is unchanged. Helicone-property headers (`helicone-property-*`) are automatically captured as event properties.

**What Observe adds:**
- Revenue data — connect Stripe or send revenue events to get margin, not just cost
- Feature-level P&L — tag calls with `x-tanso-feature` to see per-feature economics
- Pricing simulations — model price changes before shipping them
- Self-hosted — data stays in your own Postgres

**Importing Helicone data:** export request logs as CSV, then use **Data Sources > Upload CSV** in the dashboard.

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
