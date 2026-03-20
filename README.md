# Tanso - SaaS Revenue Analytics Dashboard

A comprehensive SaaS revenue analytics and pricing intelligence dashboard that helps companies analyze subscription revenue, customer pricing patterns, and margin health.

## Overview

Tanso provides deep insights into your SaaS metrics by connecting to your billing data (via Stripe or CSV uploads) and generating actionable analytics including MRR trends, churn analysis, cohort tracking, and margin health scoring.

## Features

- **Revenue Analytics** - MRR, ARR, ARPU, NRR, LTV calculations with trend visualization
- **MRR Movement Analysis** - Track New, Expansion, Contraction, and Churned revenue
- **Plan Health Scoring** - 0-100 health scores based on growth, stability, and efficiency
- **Cohort Analysis** - Track customer cohorts over time
- **Margin Tracking** - Identify negative margin customers and margin compression
- **Usage Anomaly Detection** - Flag unusual usage patterns
- **Pricing Simulations** - Model pricing changes and project revenue impact
- **AI Insights** - AI-powered analysis via OpenAI and Anthropic integrations
- **Stripe Integration** - Direct API connection or CSV import
- **Sample Data** - Demo dataset for exploration

## Tech Stack

| Category | Technologies |
|----------|-------------|
| Frontend | Vue 3, TypeScript, Vite |
| Styling | Tailwind CSS, Radix Vue |
| Charts | Chart.js, Vue Chart.js |
| State | TanStack Vue Query |
| Forms | Vee-Validate, Zod |
| Backend | Express (Node.js), PostgreSQL |
| Edge Functions | Supabase Edge Functions (Stripe sync, simulations) |
| Billing | Stripe API |

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow, key modules |
| [Database Schema](docs/DATABASE.md) | Tables, relationships, RLS policies |
| [API Reference](docs/API.md) | Edge Functions endpoints |
| [Components](docs/COMPONENTS.md) | Vue components and composables |
| [Quickstart](docs/quickstart.md) | Quick setup guide |
| [Data Sources](docs/data-sources.md) | Data import workflows |
| [Simulator](docs/simulator.md) | Pricing simulation engine |
| [AI Insights](docs/ai-insights.md) | AI-powered analytics |
| [Feature Economics](docs/feature-economics.md) | Feature-level cost analysis |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm
- PostgreSQL database
- Supabase account (for edge functions)
- Stripe account (optional, for live data)

### Installation

```bash
# Clone the repository
git clone https://github.com/katrinavassell/metrics-onboarding.git
cd metrics-onboarding

# Install dependencies
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
# Required - Backend
DATABASE_URL=postgresql://user:password@localhost:5432/metrics
SESSION_SECRET=your-session-secret

# Required - Supabase (for edge functions)
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Database Setup

1. Create a PostgreSQL database

2. Run the base schema in Supabase SQL Editor:
   ```bash
   # Copy contents of supabase/schema.sql
   # Paste into Supabase SQL Editor and run
   ```

3. Run all migrations in order:
   ```bash
   # supabase/migrations/001_stripe_integrations.sql
   # supabase/migrations/002_simulation_engine.sql
   # supabase/migrations/003_ai_integrations.sql
   # supabase/migrations/004_observe_events.sql
   # supabase/migrations/005_simulations.sql
   # supabase/migrations/006_ai_insights.sql
   ```

### Deploy Edge Functions

```bash
# Link to your Supabase project
npx supabase link --project-ref your-project-ref

# Deploy all functions
npx supabase functions deploy stripe-connect --no-verify-jwt
npx supabase functions deploy stripe-sync-enhanced --no-verify-jwt
npx supabase functions deploy stripe-disconnect --no-verify-jwt
npx supabase functions deploy stripe-status --no-verify-jwt
npx supabase functions deploy run-simulation --no-verify-jwt
npx supabase functions deploy anthropic-connect --no-verify-jwt
npx supabase functions deploy anthropic-status --no-verify-jwt
npx supabase functions deploy openai-connect --no-verify-jwt
npx supabase functions deploy openai-status --no-verify-jwt
```

### Start Development

```bash
# Start both frontend and backend
npm run dev
```

This starts:
- **Frontend** (Vite) at `http://localhost:5000`
- **Backend** (Express) at `http://localhost:3001`

The frontend proxies `/api` requests to the backend automatically.

---

## Project Structure

```
src/
├── pages/                      # Route components
│   ├── PricingAnalyzerPage.vue # Main analytics dashboard (home)
│   ├── AnalyticsPage.vue       # Analytics overview
│   ├── CustomersPage.vue       # Customer list
│   ├── CustomerDetailPage.vue  # Individual customer view
│   ├── DataSourcesPage.vue     # Data import interface
│   ├── EventsPage.vue          # Event tracking
│   ├── FeaturesPage.vue        # Feature management
│   ├── FeatureDetailPage.vue   # Feature detail view
│   ├── InsightsPage.vue        # AI-powered insights
│   ├── ModelsPage.vue          # Pricing models
│   ├── SimulationsPage.vue     # Simulation list
│   ├── SimulationNewPage.vue   # Create simulation
│   └── SimulationDetailPage.vue# Simulation results
├── components/
│   ├── ui/                     # Reusable UI (Button, Card, Tabs, etc.)
│   ├── charts/                 # Data visualizations
│   ├── dashboard/              # Dashboard widgets
│   ├── data-sources/           # Import workflows
│   ├── integrations/           # Third-party integrations
│   ├── pricing/                # Pricing components
│   ├── simulation/             # Pricing simulations
│   ├── accounts/               # Account management
│   ├── onboarding/             # Onboarding flow
│   └── shared/                 # Shared components
├── composables/                # Vue 3 composables
│   ├── useAuth.ts              # Session management
│   ├── useDataMode.ts          # Data mode state
│   ├── useStripeConnection.ts  # Stripe sync
│   ├── useStripeAnalysis.ts    # Stripe data analysis
│   ├── useStripeUpload.ts      # CSV upload handling
│   ├── useSimulation.ts        # Simulation execution
│   ├── useAppMode.ts           # App mode state
│   └── useOnline.ts            # Online status detection
├── lib/                        # Business logic
│   ├── api.ts                  # API client
│   ├── pricing-analyzer.ts     # Core metrics engine
│   ├── supabase-data.ts        # Supabase operations
│   ├── supabase.ts             # Supabase client
│   ├── stripe-import.ts        # CSV parsing
│   ├── stripe-api/             # Stripe API client
│   ├── stripe-claude-analyzer.ts # AI-powered Stripe analysis
│   ├── sample-data.ts          # Demo data generator
│   ├── validation.ts           # Input validation
│   ├── logger.ts               # Logging utility
│   ├── errors.ts               # Error handling
│   └── utils.ts                # General utilities
└── types/                      # TypeScript definitions

server/
├── index.ts                    # Express server (port 3001)
└── stripe-client.ts            # Stripe SDK client

supabase/
├── schema.sql                  # Base database schema
├── migrations/                 # Schema migrations (001-006)
└── functions/                  # Edge Functions
    ├── stripe-connect/         # Stripe API key validation
    ├── stripe-sync-enhanced/   # Stripe data sync
    ├── stripe-disconnect/      # Disconnect Stripe
    ├── stripe-status/          # Stripe connection status
    ├── run-simulation/         # Pricing simulations
    ├── anthropic-connect/      # Anthropic API integration
    ├── anthropic-status/       # Anthropic connection status
    ├── openai-connect/         # OpenAI API integration
    └── openai-status/          # OpenAI connection status
```

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start frontend + backend concurrently |
| `npm run dev:frontend` | Start Vite dev server only |
| `npm run dev:backend` | Start Express server only |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Check code with ESLint |
| `npm run lint:fix` | Auto-fix lint issues |

---

## Key Metrics

| Metric | Description |
|--------|-------------|
| **MRR** | Monthly Recurring Revenue |
| **ARR** | Annual Recurring Revenue (MRR x 12) |
| **ARPU** | Average Revenue Per User |
| **NRR** | Net Revenue Retention |
| **Churn Rate** | Customer churn percentage |
| **LTV** | Customer Lifetime Value |
| **Health Score** | Plan health (0-100) |

---

## Data Import Options

### 1. Stripe API Integration

Connect directly via Stripe secret API key:

1. Click "Connect Stripe" on the Data Sources page
2. Enter your Stripe secret key (`sk_test_...` or `sk_live_...`)
3. Click "Connect" to validate
4. Click "Start Import" to sync data

Imports: customers, subscriptions, invoices, products, prices, usage records

### 2. CSV Upload

Upload Stripe export CSVs:
- `customers.csv` - Customer data
- `subscriptions.csv` - Subscription data
- `invoices.csv` - Invoice history

### 3. Sample Data

Load demo data to explore the dashboard without connecting real data.

---

## Authentication

Uses anonymous session-based authentication. When a user visits the app, the Express backend automatically creates a session with a unique visitor ID. Sessions are stored in PostgreSQL and persist for 30 days.

---

## Deployment

### Vercel / Netlify

1. Connect your repository
2. Set build command: `npm run build`
3. Set output directory: `dist`
4. Add environment variables:
   - `DATABASE_URL`
   - `SESSION_SECRET`
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

### Edge Functions

Edge functions are deployed to Supabase:

```bash
npx supabase functions deploy --no-verify-jwt
```

---

## Database Schema

See [docs/DATABASE.md](docs/DATABASE.md) for full schema reference.

Core tables:
- `customers` - Customer accounts
- `plans` - Pricing tiers
- `subscriptions` - Active subscriptions
- `usage_records` - Usage metrics
- `cost_records` - Cost data
- `pricing_scenarios` - Simulation configurations
- `sessions` - Express session store

All tables use Row Level Security (RLS) scoped to the visitor session.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make changes and run `npm run lint`
4. Commit changes: `git commit -m "Add my feature"`
5. Push to branch: `git push origin feature/my-feature`
6. Submit a pull request

---

## License

Private - All rights reserved
