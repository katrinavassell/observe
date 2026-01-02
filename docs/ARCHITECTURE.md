# Architecture Overview

This document describes the technical architecture of the Tanso metrics dashboard.

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           Frontend (Vue 3)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │    Pages     │  │  Components  │  │  Composables │              │
│  │ (Router)     │  │  (UI/Charts) │  │  (State)     │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                 │                       │
│         └─────────────────┼─────────────────┘                       │
│                           │                                         │
│  ┌────────────────────────┴────────────────────────────────────┐   │
│  │                     lib/ (Business Logic)                    │   │
│  │  pricing-analyzer.ts │ stripe-import.ts │ supabase-data.ts   │   │
│  └────────────────────────┬────────────────────────────────────┘   │
└───────────────────────────┼─────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        Supabase Platform                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │     Auth     │  │   Database   │  │ Edge Functions│              │
│  │ (Magic Link) │  │ (PostgreSQL) │  │   (Deno)     │              │
│  └──────────────┘  └──────────────┘  └──────┬───────┘              │
└─────────────────────────────────────────────┼───────────────────────┘
                                              │
                                              ▼
                                    ┌──────────────────┐
                                    │    Stripe API    │
                                    └──────────────────┘
```

---

## Data Flow

### 1. Data Import Flow

```
User Input (CSV or Stripe API)
         │
         ▼
┌─────────────────────────────┐
│  Parsing & Validation       │
│  - stripe-import.ts (CSV)   │
│  - stripe-sync-enhanced     │
│    (API via Edge Function)  │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Transform & Normalize      │
│  - Calculate MRR            │
│  - Detect customer segment  │
│  - Map relationships        │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Supabase Database          │
│  - customers, plans         │
│  - subscriptions, invoices  │
│  - usage_records, costs     │
└─────────────────────────────┘
```

### 2. Analytics Flow

```
Database Query
         │
         ▼
┌─────────────────────────────┐
│  supabase-data.ts           │
│  - loadCustomers()          │
│  - loadSubscriptions()      │
│  - loadUsageRecords()       │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  pricing-analyzer.ts        │
│  - calculateMRR()           │
│  - calculatePlanHealth()    │
│  - analyzeMRRMovement()     │
│  - detectNegativeMargin()   │
└─────────────┬───────────────┘
              │
              ▼
┌─────────────────────────────┐
│  Vue Components             │
│  - PricingPage.vue          │
│  - MrrChart.vue             │
│  - CohortChart.vue          │
└─────────────────────────────┘
```

---

## Frontend Architecture

### Tech Stack

| Technology | Purpose |
|------------|---------|
| Vue 3 | UI framework with Composition API |
| TypeScript | Type safety |
| Vite | Build tool and dev server |
| Tailwind CSS | Utility-first styling |
| Radix Vue | Accessible UI primitives |
| Chart.js | Data visualization |
| TanStack Query | Server state management |
| Vue Router | Client-side routing |

### Directory Structure

```
src/
├── pages/              # Route components
├── components/
│   ├── ui/             # Reusable UI (buttons, cards, inputs)
│   ├── charts/         # Data visualization
│   ├── data-sources/   # Import workflows
│   └── simulation/     # Pricing simulations
├── composables/        # Shared reactive state
├── lib/                # Business logic
└── types/              # TypeScript definitions
```

### Key Composables

| Composable | Purpose |
|------------|---------|
| `useAuth` | Authentication state & session management |
| `useDataMode` | Track data mode (none/sample/user) |
| `useStripeConnection` | Stripe API key validation & sync |
| `useSimulation` | Pricing scenario execution |

---

## Backend Architecture

### Supabase Services

| Service | Usage |
|---------|-------|
| **Auth** | Passwordless magic link authentication |
| **Database** | PostgreSQL with Row Level Security |
| **Edge Functions** | Deno runtime for Stripe API calls |
| **Realtime** | (Available, not currently used) |

### Edge Functions

| Function | Purpose |
|----------|---------|
| `stripe-connect` | Validate & store Stripe API key |
| `stripe-sync-enhanced` | Fetch all Stripe data |
| `run-simulation` | Execute pricing scenarios |

### Why Edge Functions?

Stripe API calls must be made server-side because:
1. **CORS restrictions** - Browser cannot call api.stripe.com directly
2. **API key security** - Secret keys cannot be exposed to client
3. **Rate limiting** - Server-side handling with exponential backoff

---

## Key Modules

### pricing-analyzer.ts

The core metrics calculation engine (~1000 lines).

**Key Functions:**

```typescript
// Revenue metrics
calculateMRR(subscriptions)           // Monthly Recurring Revenue
calculateARR(subscriptions)           // Annual Recurring Revenue
calculateARPU(subscriptions, count)   // Average Revenue Per User

// Retention metrics
calculateNRR(current, baseline)       // Net Revenue Retention
calculateChurnRate(churned, total)    // Customer churn percentage

// Health scoring
calculatePlanHealth(plan)             // 0-100 health score
detectNegativeMarginCustomers(data)   // Find unprofitable customers

// Movement analysis
analyzeMRRMovement(current, previous) // New/expansion/contraction/churn
calculateCohortRetention(cohorts)     // Cohort analysis curves
```

### stripe-import.ts

CSV parsing and reconciliation.

**Key Functions:**

```typescript
parseStripeCSV(file)          // Parse uploaded CSV
detectFileType(headers)       // customers/subscriptions/invoices
reconcileData(uploaded, db)   // Find matches and orphans
calculateMRRFromCSV(data)     // Derive MRR from invoice data
```

### supabase-data.ts

Database operations layer.

**Key Functions:**

```typescript
loadCustomers(userId)         // Fetch customers from DB
loadSubscriptions(userId)     // Fetch subscriptions with joins
saveCustomers(customers)      // Upsert customer records
loadSampleData(userId)        // Insert demo dataset
clearUserData(userId)         // Delete all user data
```

### stripe-api/client.ts

Stripe API communication (used in Edge Functions).

**Key Features:**
- Paginated fetching with async generators
- Exponential backoff for rate limits
- Error categorization (auth, rate limit, server)

---

## Authentication Flow

```
1. User enters email on LoginPage
         │
         ▼
2. Supabase sends magic link email
         │
         ▼
3. User clicks link → redirected with token
         │
         ▼
4. supabase.auth.getSession() validates token
         │
         ▼
5. Router guard checks auth.uid()
         │
         ▼
6. All DB queries scoped by user_id (RLS)
```

---

## Data Modes

The app supports three data modes:

| Mode | Description |
|------|-------------|
| `none` | No data loaded, shows onboarding |
| `sample` | Demo dataset for exploration |
| `user` | User's own imported data |

Mode is tracked in `user_data_status` table and cached in `useDataMode` composable.

---

## Security Model

### Row Level Security (RLS)

All database tables enforce user isolation:

```sql
CREATE POLICY "Users can view own data" ON customers
  FOR SELECT USING (auth.uid() = user_id);
```

### API Key Storage

Stripe API keys are:
1. Validated before storage
2. Encrypted using `encryptApiKey()`
3. Stored in `stripe_integrations.encrypted_api_key`
4. Decrypted only in Edge Functions

### Authentication

- JWT tokens validated on every request
- Edge Functions extract user from `Authorization` header
- No sensitive data stored in client

---

## Performance Considerations

### Database Indexes

Strategic indexes on frequently queried columns:
- `user_id` on all tables
- `(user_id, customer_id)` for joins
- `(user_id, period_start, period_end)` for date ranges

### Client-Side Caching

TanStack Query provides:
- Automatic request deduplication
- Background refetching
- Stale-while-revalidate pattern

### Edge Function Optimization

- Parallel data fetching with `Promise.all()`
- Pagination for large datasets
- Partial success handling (continue on errors)
