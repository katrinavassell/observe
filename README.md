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
| Backend | Supabase (PostgreSQL + Auth) |
| Billing | Stripe API |

## Project Structure

```
src/
├── components/
│   ├── ui/              # Reusable UI components (Button, Card, Tabs, etc.)
│   ├── charts/          # Data visualizations (MrrChart, CohortChart, etc.)
│   ├── integrations/    # Stripe and integration modals
│   ├── accounts/        # Account management
│   ├── data-sources/    # Data import sections
│   └── layouts/         # App layout and sidebar
├── pages/
│   ├── PricingPage.vue      # Main analytics dashboard
│   ├── DataSourcesPage.vue  # Data import interface
│   └── LoginPage.vue        # Authentication
├── composables/         # Vue 3 composables (useAuth, useDataMode, etc.)
├── lib/                 # Business logic
│   ├── pricing-analyzer.ts  # Core metrics engine
│   ├── supabase-data.ts     # Database operations
│   ├── stripe-import.ts     # CSV parsing & reconciliation
│   └── stripe-api.ts        # Stripe API client
├── api/                 # HTTP client
└── types/               # TypeScript definitions
```

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

The app runs at `http://localhost:5174`

### Environment Variables

Create a `.env` file:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### Development Server (for Stripe API)

For local Stripe API integration:

```bash
node dev-server.cjs
```

Runs at `http://localhost:8000`

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Check code with ESLint |
| `npm run lint:fix` | Auto-fix lint issues |

## Key Metrics Calculated

| Metric | Description |
|--------|-------------|
| **MRR** | Monthly Recurring Revenue |
| **ARR** | Annual Recurring Revenue (MRR x 12) |
| **ARPU** | Average Revenue Per User |
| **NRR** | Net Revenue Retention |
| **Churn Rate** | Customer churn percentage |
| **LTV** | Customer Lifetime Value |
| **Health Score** | Plan health (0-100) |

## Data Import Options

### 1. Stripe Integration
Connect directly via Stripe API key to sync customers, subscriptions, invoices, and usage data.

### 2. CSV Upload
Upload Stripe export CSVs:
- `customers.csv` - Customer data
- `subscriptions.csv` - Subscription data
- `invoices.csv` - Invoice history

### 3. Sample Data
Load demo data to explore the dashboard without connecting real data.

## Authentication

Uses Supabase Auth with passwordless magic links:
1. Enter email on login page
2. Receive magic link via email
3. Click link to authenticate
4. Session persists across tabs

## Architecture

```
User Input (CSV/Stripe API)
    ↓
Data Parsing & Validation
    ↓
Supabase Database
    ↓
Pricing Analyzer Engine
    ↓
Analytics Dashboard
```

## Database Schema

Core entities:
- `customers` - Customer accounts
- `plans` - Pricing tiers
- `subscriptions` - Active subscriptions
- `invoices` - Billing history
- `usage_records` - Usage metrics
- `cost_records` - Cost data
- `data_status` - Import status tracking

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes and run `npm run lint`
4. Submit a pull request

## License

Private - All rights reserved
