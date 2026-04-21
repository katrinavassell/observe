# Architecture Overview

Technical architecture of Observe -- AI cost observability for SaaS companies.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Frontend (Vue 3 SPA)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │    Pages     │  │  Components  │  │  Composables │              │
│  │ (Router)     │  │  (UI/Charts) │  │  (State)     │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         └─────────────────┼─────────────────┘                       │
│                           │                                         │
│  ┌────────────────────────┴────────────────────────────────────┐   │
│  │                     lib/ (Business Logic)                    │   │
│  │  pricing-analyzer.ts │ api.ts │ format.ts │ validation.ts    │   │
│  └────────────────────────┬────────────────────────────────────┘   │
└───────────────────────────┼─────────────────────────────────────────┘
                            │ /api/* (Vite proxy)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Express Backend (port 3001)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   Auth       │  │  Data CRUD   │  │   Stripe     │              │
│  │  (accounts)  │  │  (pg Pool)   │  │  (checkout)  │              │
│  ├──────────────┤  ├──────────────┤  ├──────────────┤              │
│  │ Integrations │  │   Billing    │  │    Alerts    │              │
│  │ (OpenAI/Ant) │  │  (Stripe)    │  │  (rules)     │              │
│  └──────────────┘  └──────────────┘  └──────────────┘              │
│  ┌──────────────┐  ┌──────────────┐                                │
│  │  AI Proxy    │  │    Team      │                                │
│  │ (v1/* fwd)   │  │  (orgs)      │                                │
│  └──────────────┘  └──────────────┘                                │
└─────────────────────────────────────────────────────────────────────┘
                            │
              ┌─────────────┼─────────────────┐
              ▼             ▼                  ▼
    ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
    │  PostgreSQL  │ │  Stripe API  │ │  OpenAI API  │
    │  (Neon/pg)   │ │              │ │ Anthropic API│
    └──────────────┘ └──────────────┘ └──────────────┘
```

---

## Data Flow

### 1. Data Import Flow

```
User Input (CSV, Stripe, OpenAI/Anthropic sync, or Sample Data)
         │
         ▼
┌─────────────────────────────┐
│  Express Backend             │
│  - Parse & validate          │
│  - Write to legacy tables    │
│    (plans, customers, etc.)  │
│  - Dual-write to             │
│    observe_events            │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  PostgreSQL                  │
│  - observe_events (unified)  │
│  - plans, customers, etc.    │
│    (legacy, for analyzer)    │
└─────────────────────────────┘
```

### 2. Analytics Flow

```
Frontend requests /api/analytics/customer-pnl
         │
         ▼
┌─────────────────────────────┐
│  Express Backend             │
│  - Query observe_events      │
│  - GROUP BY feature/customer │
│  - SUM cost, revenue, usage  │
│  - Calculate margin %        │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Vue Components              │
│  - AnalyticsPage.vue (home)  │
│  - EventsPage.vue            │
│  - ModelsPage.vue            │
│  - AlertsPage.vue            │
└─────────────────────────────┘
```

### 3. Proxy Flow

```
Client SDK → POST /v1/chat/completions
         │
         ▼
┌─────────────────────────────┐
│  Express Backend             │
│  - Check proxy cache         │
│  - Forward to OpenAI/Anthro  │
│  - Log cost as observe_event │
│  - Cache response (optional) │
└─────────────────────────────┘
```

---

## Frontend Architecture

### Tech Stack

| Technology | Purpose |
|------------|---------|
| Vue 3 | UI framework (Composition API) |
| TypeScript | Type safety |
| Vite | Build tool + dev server + API proxy |
| Tailwind CSS | Utility-first styling |
| Radix Vue + shadcn-vue | Accessible UI primitives |
| Chart.js + vue-chartjs | Data visualization |
| TanStack Vue Query | Server state + caching |
| Vue Router | Client-side routing |
| Lucide Vue | Icons |
| Vue Sonner | Toast notifications |
| Zod | Validation |

### Directory Structure

```
src/
├── pages/                  # Route components
│   ├── AnalyticsPage.vue        # Home: revenue, costs, margin overview
│   ├── EventsPage.vue           # Filterable event stream
│   ├── ModelsPage.vue           # AI model cost breakdown
│   ├── AlertsPage.vue           # 17 alert types (cost, margin, abuse, pricing, concentration) -- free for all users
│   ├── DataSourcesPage.vue      # CSV upload, integrations
│   ├── PlansPage.vue            # Subscription plans & billing
│   ├── CheckoutSuccessPage.vue  # Post-checkout confirmation
│   ├── CohortsPage.vue          # Cohort retention analysis
│   ├── TracesPage.vue           # Distributed trace viewer
│   ├── LoginPage.vue            # Login / signup (also used for /signup)
│   ├── ForgotPasswordPage.vue   # Request password reset
│   ├── ResetPasswordPage.vue    # Reset password with token
│   ├── OnboardingPage.vue       # First-run onboarding flow
│   ├── TeamSettingsPage.vue     # Team management, invites
│   ├── JoinTeamPage.vue         # Accept team invite
│   └── AdminPage.vue            # Admin dashboard (tansohq.com emails only)
├── components/
│   ├── ui/                 # Reusable UI (shadcn-vue)
│   ├── charts/             # Data visualization
│   ├── dashboard/          # Metric cards, quick actions
│   ├── data-sources/       # Import workflows
│   ├── integrations/       # OpenAI/Anthropic/Stripe API key modals
│   ├── onboarding/         # Upload wizard, column mapper, checklist
│   ├── pricing/            # Margin overview card
│   ├── accounts/           # Account detail panel
│   └── shared/             # ErrorBoundary, MarginBadge, TrendIndicator, FeedbackModal
├── composables/            # Shared reactive state
│   ├── useAuth.ts          # Login, signup, session management
│   ├── useDataMode.ts      # Data mode tracking (none/sample/user)
│   ├── useOnline.ts        # Network connectivity detection
│   └── useTeam.ts          # Team info, roles, invites
├── layouts/
│   └── AppLayout.vue       # Sidebar navigation + main content area
├── lib/
│   ├── api.ts              # HTTP client for Express backend
│   ├── pricing-analyzer.ts # Client-side metrics calculation
│   ├── sample-data.ts      # Sample data generation
│   ├── format.ts           # Number/date formatting helpers
│   ├── validation.ts       # Input validation
│   ├── errors.ts           # Error types
│   ├── logger.ts           # Client-side logging
│   ├── database.types.ts   # Database type definitions
│   └── utils.ts            # Shared utilities
└── types/
    └── ...                 # Shared type definitions
```

### Navigation

The sidebar shows these items in order:

| Nav Item | Route | Page |
|----------|-------|------|
| Analytics | `/` | AnalyticsPage (home) |
| Events | `/events` | EventsPage |
| Traces | `/traces` | TracesPage |
| Models | `/models` | ModelsPage |
| Cohorts | `/cohorts` | CohortsPage |
| Alerts | `/alerts` | AlertsPage |
| Data Sources | `/data-sources` | DataSourcesPage |
| Plans | `/plans` | PlansPage |
| Team Settings | `/team` | TeamSettingsPage |
| Admin | `/admin` | AdminPage (visible to @tansohq.com emails only) |

Additional routes (not in sidebar): `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/checkout/success`, `/join/:token`.

Several legacy routes (`/features`, `/features/:key`, `/customers`, `/customers/:id`, `/insights`, `/pricing`, `/referrals`, `/onboarding`, `/dashboard`, `/analytics`, `/admin/pricing`) redirect to `/` or `/data-sources` or `/models`.

### Key Composables

| Composable | Purpose |
|------------|---------|
| `useAuth` | Login, signup, logout, password reset, session state |
| `useDataMode` | Track data mode (none/sample/user) via `/data/status` |
| `useOnline` | Detect network connectivity for offline-aware UI |
| `useTeam` | Fetch team info, roles, manage invites |

---

## Backend Architecture

### Express Server (`server/index.ts`)

Single Express app on port 3001, proxied by Vite at `/api/*`. The `/api` prefix is stripped by middleware so routes work identically in dev and production.

### Route Modules (`server/routes/`)

| Module | Purpose |
|--------|---------|
| `auth.ts` | Signup, login, logout, password reset, session init |
| `data.ts` | CSV upload, Stripe sync, data status |
| `billing-api.ts` | Billing status, Stripe checkout/portal/webhook, feature pricing, integrations, referrals |
| `events.ts` | Event CRUD, aggregations (by-feature/customer/model/agent/cost-type), traces, SDK key management, batch ingestion with usage limit enforcement |
| `alerts.ts` | Alert rule CRUD, threshold evaluation, email dispatch |
| `integrations.ts` | Integration connections (OpenAI, Anthropic, Stripe API keys), referral conversion |
| `analytics.ts` | Customer P&L, margin alerts |
| `proxy.ts` | AI proxy (OpenAI/Anthropic forwarding with cost logging) |
| `models-api.ts` | Model listing and pricing |
| `insights.ts` | AI-generated insights |
| `team.ts` | Team management and invites |
| `features.ts` | Feature listing |
| `customers.ts` | Customer CRUD |
| `cohorts.ts` | Cohort analysis |
| `inference.ts` | Inference profile computation |
| `a2a.ts` | Agent-to-agent protocol endpoints |
| `cloud-costs.ts` | Cloud cost data import |

### Supporting Modules

| Module | Purpose |
|--------|---------|
| `stripe-client.ts` | Stripe SDK wrapper for checkout and customer portal |
| `billing.ts` | Plan definitions, feature limits, and billing helpers |
| `model-pricing.ts` | Model pricing database and cost calculation |

### Middleware

| Middleware | Purpose |
|-----------|---------|
| `@supabase/supabase-js` | Auth (JWT-based; no server sessions) |
| `ensureVisitor` | Creates visitor ID if not in session, ensures data isolation |
| `helmet` | Security headers |
| `cors` | Restrict origins to known frontends |
| `express-rate-limit` | Rate limiting on auth (20/15min) and API (60/min) endpoints |

### Authentication Model

Supabase-managed email/password auth:

```
1. Signup → Supabase creates user; local `accounts` row linked by visitor_id
         │
         ▼
2. Login → Supabase issues JWT; frontend sends it as a Bearer token
         │
         ▼
3. `ensureVisitor` verifies JWT via supabase.auth.getUser and sets visitorId
         │
         ▼
4. All DB queries filter by user_id = visitorId
```

An auth guard redirects unauthenticated users to `/signup`.

### Data Isolation

All queries are scoped by `user_id` (visitor ID). Team members share data through the `visitor_org_map` table which maps visitors to organizations.

### Stripe Integration

Uses the Stripe SDK directly (`stripe` npm package):
- Checkout sessions for subscription purchases
- Customer portal for billing management
- Webhook handler for Stripe events (checkout completion, subscription updates)

---

## Database

PostgreSQL with support for both standard `pg` driver and `@neondatabase/serverless` (selected via `DB_DRIVER` env var). Tables created at startup with `CREATE TABLE IF NOT EXISTS`.

### Core Tables
- `observe_events` -- unified event store for all data
- `accounts` -- user accounts with hashed passwords
- `organizations` / `organization_members` / `visitor_org_map` -- team structure
- `sdk_api_keys` -- API keys for programmatic event ingestion
- `integrations` -- connected API key providers (OpenAI, Anthropic, Stripe)
- `alert_rules` -- threshold-based cost alert definitions

### Legacy Tables (kept for pricing analyzer)
`plans`, `customers`, `subscriptions`, `usage_records`, `cost_records`, `user_data_status`

### Supporting Tables
- `simulations`, `ai_insights` -- simulation and insight records
- `inference_profiles` -- learned distribution patterns from SDK data
- `proxy_cache` -- cached proxy responses to reduce costs
- `tanso_customers` -- Tanso billing customer mapping
- `referral_codes`, `referrals`, `referral_credits` -- referral program
- `integration_requests` -- interest capture for future integrations
- `password_reset_tokens` -- password reset flow

See [DATABASE.md](./DATABASE.md) for full schema reference.

---

## Deployment

### Docker (`docker-compose.yml`)

```
PostgreSQL 16 Alpine (tanso user)
App container (port 3000, production build)
```

### Local Development

- **Dev:** `npm run dev` -- runs backend + frontend concurrently
- **Build:** `npm run build` -- `vue-tsc && vite build`

### Environment Variables

See `.env.example` for all options. Required: `DATABASE_URL`, `SESSION_SECRET`. Optional: Tanso billing, Stripe, OpenAI/Anthropic keys, Resend for email alerts.

---

## Performance

### Database Indexes
- `observe_events`: indexed on `(user_id, timestamp)`, `(user_id, feature_key)`, `(user_id, source)`, `(user_id, idempotency_key)`, `(user_id, is_inferred)`
- Legacy tables: indexed on `user_id`
- `sdk_api_keys`: indexed on `key_hash` (active keys only)

### Client-Side Caching
TanStack Vue Query provides automatic request deduplication, background refetching, and stale-while-revalidate.

### Proxy Caching
The `proxy_cache` table stores responses keyed by request hash, saving tokens and cost on repeated identical requests.

---

## Revenue, MRR, and Margin Model

### Design decisions

**Customers appear only after SDK events.** The customers page (`/cohorts` route) queries
from `observe_events` and LEFT JOINs `customers` for metadata (name, email, segment).
Stripe-imported customers with zero SDK events are not shown. Rationale: margins are
meaningless without cost data — showing $0/$0 produces misleading 0% margins.

**Revenue is enriched at ingest time.** When an SDK event arrives, `server/lib/enrich-revenue.ts`
stamps `revenue_amount` on the event row before it hits the database. Priority:
1. `feature_pricing` table (explicit per-feature revenue rules)
2. Subscription data (metered unit price, tiered pricing, or hybrid)
3. Explicit `revenueAmount` in the SDK payload overrides everything

**Margins never double-count.** Since PR #94, all analytics queries compute margin from
`SUM(revenue_amount)` and `SUM(cost_amount)` on `observe_events`. They do NOT add
subscription MRR on top — that would double-count since revenue is already on the events.

### MRR calculation

`SUM(COALESCE(mrr_override, plan.price_amount))` across active subscriptions per customer.
`mrr_override` supports custom pricing. Annual plans are normalized to monthly via
`interval_months`.

### Margin formula

Always: `(revenue - cost) / revenue * 100`. When revenue=0 and cost>0, margin=-100%.
When both are 0, margin is null (not displayed).
