# Architecture Overview

Technical architecture of Observe — feature-level economics and pricing simulation for AI SaaS companies.

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
│  │  pricing-analyzer.ts │ api.ts (HTTP client)                  │   │
│  └────────────────────────┬────────────────────────────────────┘   │
└───────────────────────────┼─────────────────────────────────────────┘
                            │ /api/* (Vite proxy)
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Express Backend (port 3001)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │   Sessions   │  │  Data CRUD   │  │   Stripe     │              │
│  │  (pg-simple) │  │  (pg Pool)   │  │  (Replit)    │              │
│  └──────────────┘  └──────────────┘  └──────┬───────┘              │
└─────────────────────────────────────────────┼───────────────────────┘
                            │                 │
                            ▼                 ▼
                  ┌──────────────┐   ┌──────────────┐
                  │  PostgreSQL  │   │  Stripe API  │
                  │  (Replit)    │   └──────────────┘
                  └──────────────┘
                            │
                            ▼ (Phase 3)
                  ┌──────────────┐
                  │  OpenAI API  │
                  └──────────────┘
```

---

## Data Flow

### 1. Data Import Flow

```
User Input (CSV, Stripe, or Sample Data)
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

### 2. Feature Economics Flow

```
Frontend requests /api/events/by-feature
         │
         ▼
┌─────────────────────────────┐
│  Express Backend             │
│  - Query observe_events      │
│  - GROUP BY feature_key      │
│  - SUM cost, revenue, usage  │
│  - Calculate margin %        │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Vue Components              │
│  - FeaturesPage.vue          │
│  - ModelsPage.vue            │
│  - CustomersPage.vue         │
└─────────────────────────────┘
```

### 3. Pricing Analyzer Flow (Existing)

```
Frontend requests /api/data/analyzer
         │
         ▼
┌─────────────────────────────┐
│  Express Backend             │
│  - Query legacy tables       │
│  - Return raw data           │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  pricing-analyzer.ts         │
│  (client-side calculation)   │
│  - calculateMRR()            │
│  - calculatePlanHealth()     │
│  - analyzeMRRMovement()      │
│  - detectNegativeMargin()    │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  PricingAnalyzerPage.vue     │
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
│   ├── PricingAnalyzerPage.vue   # Existing: MRR, margins, cohorts
│   ├── DataSourcesPage.vue       # Existing: CSV + Stripe import
│   ├── SimulatorPage.vue         # Existing: basic simulator (to be replaced)
│   ├── EventsPage.vue            # New: event stream
│   ├── FeaturesPage.vue          # New: feature economics
│   ├── FeatureDetailPage.vue     # New: single feature detail
│   ├── ModelsPage.vue            # New: AI model costs
│   ├── CustomersPage.vue         # New: customer margins
│   ├── CustomerDetailPage.vue    # New: single customer detail
│   ├── SimulationsPage.vue       # New: simulation list + opportunities
│   ├── SimulationNewPage.vue     # New: 3-step wizard
│   └── SimulationDetailPage.vue  # New: results + impact + rollout
├── components/
│   ├── ui/                 # Reusable UI (shadcn-vue)
│   ├── charts/             # Data visualization
│   ├── data-sources/       # Import workflows
│   ├── pricing/            # Pricing analyzer components
│   ├── simulation/         # Legacy simulator (to be replaced)
│   ├── simulations/        # New: ported simulator components
│   └── shared/             # MarginBadge, TrendIndicator, etc.
├── composables/            # Shared reactive state
│   ├── useAuth.ts          # Session management
│   ├── useDataMode.ts      # Data mode tracking
│   ├── useStripeConnection.ts  # Stripe sync
│   ├── useSimulation.ts    # Legacy simulator
│   └── useSimulationState.ts   # New: ported simulation engine
├── lib/
│   ├── api.ts              # HTTP client for Express backend
│   ├── pricing-analyzer.ts # Client-side metrics calculation
│   ├── utils.ts            # Shared utilities
│   └── simulation-seed.ts  # New: sample data for simulator
└── types/
    ├── index.ts            # Shared types
    └── simulation.ts       # Simulation types (ported from tansoflow)
```

### Key Composables

| Composable | Purpose |
|------------|---------|
| `useAuth` | Anonymous session init via `/api/session/init` |
| `useDataMode` | Track data mode (none/sample/user) |
| `useStripeConnection` | Stripe status check + sync trigger |
| `useSimulationState` | New: full simulation engine (segments, scenarios, impact) |

---

## Backend Architecture

### Express Server (`server/index.ts`)

Single Express app on port 3001, proxied by Vite at `/api/*`.

| Middleware | Purpose |
|-----------|---------|
| `express-session` + `connect-pg-simple` | Anonymous visitor sessions stored in PostgreSQL |
| `ensureVisitor` | Creates visitor ID if not in session, ensures `user_data_status` row exists |
| `express.json()` | JSON body parsing |

### Authentication Model

No login required. Anonymous sessions:

```
1. First request → session cookie created
         │
         ▼
2. ensureVisitor middleware → generates visitorId (UUID)
         │
         ▼
3. visitorId stored in session → persisted in sessions table
         │
         ▼
4. All DB queries filter by user_id = visitorId
```

### Data Isolation

All queries are scoped by `user_id`:
```sql
SELECT * FROM observe_events WHERE user_id = $1
```

This is enforced at the application level in `ensureVisitor` middleware, not via PostgreSQL RLS.

### Stripe Integration

Uses Replit's native Stripe connector (`@replit/connectors-sdk`):
- No API key storage needed
- `getUncachableStripeClient()` returns a configured Stripe client
- Syncs customers, subscriptions, plans, prices

---

## Database

PostgreSQL hosted by Replit. Tables created at startup with `CREATE TABLE IF NOT EXISTS`.

### Legacy Tables (existing, kept for pricing analyzer)
`plans`, `customers`, `subscriptions`, `usage_records`, `cost_records`, `user_data_status`, `sessions`

### New Tables (Observe)
- `observe_events` — unified event store for all data
- `simulations` — pricing simulation definitions + results
- `ai_insights` — AI-generated insight records

See [DATABASE.md](./DATABASE.md) for full schema reference.

---

## Deployment

### Replit Configuration (`.replit`)

```
Frontend: Vite on port 5000 (external port 80)
Backend:  Express on port 3001
Database: PostgreSQL (Replit native)
```

### Build & Deploy
- **Dev:** `npm run dev` → runs backend + frontend concurrently
- **Build:** `npm run build` → `vue-tsc && vite build`
- **Deploy:** Replit autoscale → backend serves API, Vite preview serves static files

---

## Performance

### Database Indexes
- `observe_events`: indexed on `(user_id, timestamp)`, `(user_id, feature_key)`, `(user_id, customer_id)`, `(user_id, model)`
- Legacy tables: indexed on `user_id` and relevant lookup columns

### Client-Side Caching
TanStack Vue Query provides:
- Automatic request deduplication
- Background refetching
- Stale-while-revalidate pattern

### Pagination
All list endpoints support `limit` and `offset` for large datasets.
