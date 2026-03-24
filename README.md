# Tanso

See exactly where your AI spend goes. Track costs per customer, feature, and model with 3 lines of code.

```js
await fetch('https://your-tanso-instance.com/api/events/ingest', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer YOUR_API_KEY' },
  body: JSON.stringify({ events: [{
    eventName: 'chat_completion',
    customerReferenceId: userId,
    featureKey: 'ai_summarization',
    costAmount: 0.24,
    model: 'gpt-4o',
  }]})
})
```

That's it. Every AI API call gets tracked with cost, customer, feature, and model attribution. Open the dashboard and see where your money is going.

## What you get

- **Per-feature costs** -- which features (summarization, search, image gen) cost the most
- **Per-model breakdown** -- compare GPT-4o vs Claude vs embeddings costs
- **Per-customer margins** -- see which customers are profitable and which are underwater
- **Margin alerts** -- spot negative-margin features before they sink you
- **Pricing simulations** -- model what happens when you change prices

## Quick start

### 1. Run the dashboard

```bash
git clone https://github.com/katrinavassell/metrics-onboarding.git
cd metrics-onboarding
npm install
cp .env.example .env  # Edit with your DATABASE_URL
npm run dev
```

Dashboard runs at `http://localhost:5000`, API at `http://localhost:3001`.

### 2. Try the demo

Click **Try Demo** on the Data Sources page to load realistic sample data -- 5 customers across Starter, Pro, and Enterprise plans with AI cost data across multiple models.

### 3. Connect your data

**Option A: SDK (recommended)** -- Add the snippet above after your AI API calls. Generate an API key from Data Sources > SDK Integration.

**Option B: OpenAI/Anthropic direct** -- Paste your API key and Tanso auto-pulls usage costs. Go to Data Sources > AI Costs > Connect.

**Option C: CSV upload** -- Upload cost CSVs for any provider. Templates provided.

## Environment variables

```env
# Required
DATABASE_URL=postgresql://user:password@localhost:5432/tanso
SESSION_SECRET=any-random-string

# Optional
OPENAI_API_KEY=sk-...          # For AI Insights feature
TANSO_API_KEY=...              # For entitlement tracking
TANSO_ACCOUNT_ID=...           # Tanso account
```

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | Vue 3, TypeScript, Vite, Tailwind CSS |
| Components | shadcn-vue (Radix), Chart.js |
| State | TanStack Vue Query |
| Backend | Express, PostgreSQL (Neon) |
| Auth | Session-based (connect-pg-simple) |

## Project structure

```
src/
  pages/           # Route components (Analytics, Events, Features, Models, Customers, ...)
  components/
    ui/             # Design system (Button, Card, Input, Select, Skeleton, ...)
    data-sources/   # Import workflows (Revenue, Costs, Usage sections)
    integrations/   # API key modals (Stripe, OpenAI, Anthropic)
    shared/         # MarginBadge, SourceBadge, ErrorBoundary
  composables/      # useAuth, useDataMode, useDemoMode, useTeam, useEntitlement
  lib/
    api.ts          # API client
    format.ts       # Shared formatting (currency, percentages)
    validation.ts   # Input validation

server/
  index.ts          # Express server -- all API routes
  tanso-client.ts   # Tanso API client
```

## SDK event fields

| Field | Required | Description |
|-------|----------|-------------|
| `eventName` | yes | What happened (`chat_completion`, `image_generated`) |
| `customerReferenceId` | yes | Your customer ID |
| `featureKey` | yes | Which product feature (`ai_summarization`, `search`) |
| `costAmount` | no | Cost in USD |
| `model` | no | Model name -- provider auto-detected (`gpt-*` -> OpenAI, `claude-*` -> Anthropic) |
| `usageUnits` | no | Tokens, requests, or any quantity |
| `revenueAmount` | no | Revenue for this event (auto-enriched from Stripe if missing) |
| `eventIdempotencyKey` | no | Unique key for dedup on retry |

Batch up to 1,000 events per request.

## Docker

```bash
docker compose up
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

Apache 2.0 -- see [LICENSE](LICENSE).
