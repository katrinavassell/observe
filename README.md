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
| Backend | Supabase (PostgreSQL + Auth + Edge Functions) |
| Billing | Stripe API |

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow, key modules |
| [Database Schema](docs/DATABASE.md) | Tables, relationships, RLS policies |
| [API Reference](docs/API.md) | Edge Functions endpoints |
| [Components](docs/COMPONENTS.md) | Vue components and composables |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm
- Supabase account (free tier works)
- Stripe account (optional, for live data)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-org/metrics-onboarding.git
cd metrics-onboarding

# Install dependencies
npm install

# Copy environment template
cp .env.example .env
```

### Environment Variables

Edit `.env` with your Supabase credentials:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### Supabase Setup

1. Create a new Supabase project at [supabase.com](https://supabase.com)

2. Run the schema in SQL Editor:
   ```bash
   # Copy contents of supabase/schema.sql
   # Paste into Supabase SQL Editor and run
   ```

3. Run migrations:
   ```bash
   # supabase/migrations/001_stripe_integrations.sql
   # supabase/migrations/002_simulation_engine.sql
   ```

4. Enable Email Auth in Authentication > Providers

### Deploy Edge Functions

```bash
# Link to your Supabase project
npx supabase link --project-ref your-project-ref

# Deploy all functions
npx supabase functions deploy stripe-connect --no-verify-jwt
npx supabase functions deploy stripe-sync-enhanced --no-verify-jwt
npx supabase functions deploy run-simulation --no-verify-jwt
```

### Start Development

```bash
# Start Vite dev server
npm run dev
```

The app runs at `http://localhost:5174`

---

## Project Structure

```
src/
├── pages/                  # Route components
│   ├── LoginPage.vue       # Authentication
│   ├── PricingPage.vue     # Main analytics dashboard
│   ├── DataSourcesPage.vue # Data import interface
│   └── OnboardingScreen.vue
├── components/
│   ├── ui/                 # Reusable UI (Button, Card, Tabs, etc.)
│   ├── charts/             # Data visualizations
│   ├── data-sources/       # Import workflows
│   └── simulation/         # Pricing simulations
├── composables/            # Vue 3 composables
│   ├── useAuth.ts          # Authentication
│   ├── useDataMode.ts      # Data mode state
│   ├── useStripeConnection.ts # Stripe sync
│   └── useSimulation.ts    # Simulation execution
├── lib/                    # Business logic
│   ├── pricing-analyzer.ts # Core metrics engine
│   ├── supabase-data.ts    # Database operations
│   ├── stripe-import.ts    # CSV parsing
│   └── stripe-api/         # Stripe API client
└── types/                  # TypeScript definitions

supabase/
├── schema.sql              # Database schema
├── migrations/             # Schema migrations
└── functions/              # Edge Functions
    ├── stripe-connect/     # API key validation
    ├── stripe-sync-enhanced/ # Data sync
    └── run-simulation/     # Pricing simulations
```

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run typecheck` | Run TypeScript type checking |
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

Uses Supabase Auth with passwordless magic links:

1. Enter email on login page
2. Receive magic link via email
3. Click link to authenticate
4. Session persists across browser tabs

---

## Deployment

### Vercel / Netlify

1. Connect your repository
2. Set build command: `npm run build`
3. Set output directory: `dist`
4. Add environment variables:
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

All tables use Row Level Security (RLS) to isolate data per user.

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Make changes and run `npm run lint && npm run typecheck`
4. Commit changes: `git commit -m "Add my feature"`
5. Push to branch: `git push origin feature/my-feature`
6. Submit a pull request

---

## License

Private - All rights reserved
