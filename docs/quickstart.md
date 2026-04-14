# Quickstart

## Start tracking in 30 seconds

Point your OpenAI or Anthropic SDK at Observe. One header. That's it.

### OpenAI (Python)

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-...",
    base_url="https://app.tanso.io/v1",     # your Observe instance
    default_headers={"x-tanso-key": "obs_..."}, # SDK key from Data Sources
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": "Hello"}],
)
# Cost, model, and tokens are logged automatically.
```

### OpenAI (TypeScript)

```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  apiKey: 'sk-...',
  baseURL: 'https://app.tanso.io/v1',
  defaultHeaders: { 'x-tanso-key': 'obs_...' },
})
```

### Anthropic (Python)

```python
import anthropic

client = anthropic.Anthropic(
    api_key="sk-ant-...",
    base_url="https://app.tanso.io",
    default_headers={"x-tanso-key": "obs_..."},
)
```

No customer ID or feature key required. Observe auto-derives the feature from the endpoint (`chat_completions`, `embeddings`, `messages`) and defaults the customer to `"default"`. Add attribution headers later when you need per-customer breakdowns.

---

## Optional: per-customer attribution

When you're ready to track costs per customer and feature, add two more headers:

```python
client = OpenAI(
    api_key="sk-...",
    base_url="https://app.tanso.io/v1",
    default_headers={
        "x-tanso-key":      "obs_...",
        "x-tanso-customer": "cus_acme",      # your customer ID
        "x-tanso-feature":  "ai-assistant",   # which feature this is
    },
)
```

---

## Running Observe

### Docker (recommended)

```bash
git clone https://github.com/tansohq/observe.git
cd observe
docker compose up
```

App: `http://localhost:3000` | Proxy: `http://localhost:3000/v1`

### Local development

```bash
git clone https://github.com/tansohq/observe.git
cd observe
npm install
cp .env.example .env
npm run dev
```

Frontend: `http://localhost:5000` | API + Proxy: `http://localhost:3001`

Only two env vars are required:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `SESSION_SECRET` | Signs session cookies (any random string) |

---

## Load your data

Go to **Data Sources** in the sidebar. Pick whichever fits:

**Sample data (fastest)** -- Click **Load Sample Data**. Dashboard is populated in seconds.

**Connect Stripe** -- Sync customers, subscriptions, and plans for revenue data.

**Connect an AI provider** -- Add your OpenAI or Anthropic API key to pull usage and cost data.

**Upload CSVs** -- Bring your own revenue, cost, and usage files.

---

## SDK integration (alternative to proxy)

If you prefer fire-and-forget tracking from your backend instead of the proxy:

```bash
npm install @tansohq/observe
```

```typescript
import { Observe } from "@tansohq/observe"
import OpenAI from "openai"

Observe.configure({ apiKey: "obs_your_key" })
Observe.identify({ customerId: "cus_123" })

const openai = Observe.wrap(new OpenAI())

// Every call is automatically tracked
const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
})
```

See the [SDK README](../packages/sdk/README.md) for full options.

---

## Tracing agent flows

Track multi-step agent executions with cost attribution per step. Use the `x-tanso-trace-id` and `x-tanso-span-id` headers on each gateway call to group them into a single trace:

```typescript
import { Observe } from "@tansohq/observe"
import OpenAI from "openai"

Observe.configure({ apiKey: process.env.OBSERVE_API_KEY! })
const openai = Observe.wrap(new OpenAI())

const traceId = crypto.randomUUID()

// Step 1 of a multi-step agent
await openai.chat.completions.create(
  { model: "gpt-4o", messages: [{ role: "user", content: "Plan the research" }] },
  { headers: { "x-tanso-trace-id": traceId, "x-tanso-span-id": "plan" } },
)

// Step 2
await openai.chat.completions.create(
  { model: "gpt-4o-mini", messages: [{ role: "user", content: "Summarize" }] },
  { headers: { "x-tanso-trace-id": traceId, "x-tanso-span-id": "summarize", "x-tanso-parent-span-id": "plan" } },
)
```

View traces at `/traces` in the dashboard — each shows a waterfall of spans with cost, duration, and type.

---

## Next steps

- [Configuration](./configuration.md) -- environment variable reference
- [Next.js Integration](./guides/nextjs.md) -- SDK setup in Next.js apps
- [LangChain Integration](./guides/langchain.md) -- proxy mode with LangChain
- [API Reference](./API.md) -- all backend endpoints
