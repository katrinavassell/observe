# API Reference

This document describes the Supabase Edge Functions API for the Tanso metrics dashboard.

## Authentication

All endpoints require authentication via Supabase Auth. Include the JWT token in the Authorization header:

```
Authorization: Bearer <supabase_access_token>
```

The token is automatically included when using the Supabase client:

```typescript
const { data, error } = await supabase.functions.invoke('function-name', {
  body: { ... }
})
```

---

## Edge Functions

### POST /stripe-connect

Validates and stores a Stripe API key for the authenticated user.

**Request Body:**

```json
{
  "api_key": "sk_test_..."
}
```

**Response (Success):**

```json
{
  "success": true,
  "message": "Stripe connected successfully",
  "account_name": "Acme Inc",
  "account_id": "acct_..."
}
```

**Response (Error):**

```json
{
  "error": "Invalid Stripe API key: ...",
  "status": 401
}
```

**Notes:**
- Accepts secret keys (`sk_test_`, `sk_live_`) and restricted keys (`rk_test_`, `rk_live_`)
- Validates the key by calling Stripe's `/account` endpoint
- Stores encrypted key in `stripe_integrations` table

---

### POST /stripe-sync-enhanced

Fetches all Stripe data including customers, subscriptions, invoices, products, prices, and usage records.

**Request Body:**

```json
{}
```

No parameters required. Uses the stored API key from `/stripe-connect`.

**Response (Success):**

```json
{
  "success": true,
  "message": "Synced 150 customers, 200 subscriptions, 500 invoices",
  "exported_at": "2024-01-15T10:30:00Z",
  "account_id": "acct_...",
  "account_name": "Acme Inc",

  "customers": [
    {
      "id": "cus_...",
      "email": "customer@example.com",
      "name": "Customer Name",
      "description": null,
      "created": "2023-06-01T00:00:00Z",
      "metadata": { "segment": "enterprise" },
      "total_spend": 12500.00,
      "subscription_count": 2,
      "segment": "Enterprise",
      "country": "US",
      "city": "San Francisco",
      "tax_exempt": false,
      "balance": 0,
      "delinquent": false
    }
  ],

  "subscriptions": [
    {
      "id": "sub_...",
      "customer_id": "cus_...",
      "status": "active",
      "created": "2023-06-01T00:00:00Z",
      "current_period_start": "2024-01-01T00:00:00Z",
      "current_period_end": "2024-02-01T00:00:00Z",
      "canceled_at": null,
      "ended_at": null,
      "trial_end": null,
      "metadata": {},
      "mrr": 299.00,
      "currency": "usd",
      "billing_interval": "month",
      "interval_count": 1,
      "items": [
        {
          "id": "si_...",
          "price_id": "price_...",
          "product_id": "prod_...",
          "product_name": "Pro Plan",
          "quantity": 1,
          "unit_amount": 299.00,
          "usage_type": "licensed",
          "metadata": {}
        }
      ],
      "discount_percent": null
    }
  ],

  "invoices": [
    {
      "id": "in_...",
      "customer_id": "cus_...",
      "subscription_id": "sub_...",
      "status": "paid",
      "amount_paid": 299.00,
      "amount_due": 299.00,
      "currency": "usd",
      "created": "2024-01-01T00:00:00Z",
      "period_start": "2024-01-01T00:00:00Z",
      "period_end": "2024-02-01T00:00:00Z",
      "line_items": [...],
      "tax": 0,
      "metadata": {}
    }
  ],

  "usage": [
    {
      "id": "sis_...",
      "subscription_item_id": "si_...",
      "customer_id": "cus_...",
      "period_start": "2024-01-01T00:00:00Z",
      "period_end": "2024-02-01T00:00:00Z",
      "total_usage": 15000,
      "metric": "API Calls"
    }
  ],

  "products": [
    {
      "id": "prod_...",
      "name": "Pro Plan",
      "description": "Full access to all features",
      "active": true,
      "metadata": {},
      "unit_label": null,
      "type": "service"
    }
  ],

  "prices": [
    {
      "id": "price_...",
      "product_id": "prod_...",
      "active": true,
      "currency": "usd",
      "unit_amount": 299.00,
      "billing_scheme": "per_unit",
      "recurring_interval": "month",
      "recurring_interval_count": 1,
      "usage_type": "licensed",
      "nickname": "Monthly",
      "metadata": {}
    }
  ],

  "summary": {
    "total_customers": 150,
    "active_subscriptions": 180,
    "total_mrr": 45000.00,
    "total_arr": 540000.00,
    "average_revenue_per_customer": 300.00,
    "churned_subscriptions": 25,
    "trialing_subscriptions": 10,
    "total_invoices_paid": 500,
    "total_revenue": 125000.00
  },

  "errors": [],

  "timing": {
    "started_at": "2024-01-15T10:30:00Z",
    "completed_at": "2024-01-15T10:30:05Z",
    "duration_ms": 5000
  }
}
```

**Notes:**
- Fetches data in parallel for performance
- Calculates MRR for each subscription (normalizes to monthly)
- Applies discounts to MRR calculations
- Fetches usage records for metered subscriptions
- Partial failures are captured in `errors` array

---

### POST /run-simulation

Executes a pricing simulation using the user's data.

**Request Body:**

```json
{
  "userId": "uuid-...",
  "pricingModel": {
    "type": "usage_based",
    "billingPeriod": "monthly",
    "growthRate": 0.05,
    "tiers": [
      { "upTo": 1000, "price": 0.01 },
      { "upTo": 10000, "price": 0.008 },
      { "upTo": null, "price": 0.005 }
    ]
  }
}
```

**Response (Success):**

```json
{
  "success": true,
  "results": {
    "summary": {
      "totalRevenue": 125000.00,
      "totalCost": 45000.00,
      "totalMargin": 80000.00,
      "marginPercentage": 64.0,
      "averageMarginPerCustomer": 533.33,
      "customersWithNegativeMargin": 5
    },
    "monthlyProjections": [
      {
        "month": "2024-01",
        "revenue": 45000.00,
        "cost": 15000.00,
        "margin": 30000.00,
        "customerCount": 150
      }
    ],
    "customerBreakdown": [...],
    "planComparison": [...],
    "dataSources": [
      { "id": "subscriptions", "name": "Subscriptions", "type": "revenue", "dataTypes": ["revenue"] },
      { "id": "cost_records", "name": "Cost Records", "type": "costs", "dataTypes": ["cost"] }
    ]
  }
}
```

**Response (No Data):**

```json
{
  "success": false,
  "error": {
    "code": "NO_DATA",
    "message": "No data found. Please load sample data or import your data first."
  }
}
```

**Notes:**
- Fetches subscriptions, customers, plans, cost_records, and usage_records
- Joins data using in-memory lookup maps (no FK constraints required)
- Runs simulation engine to project revenue and margins

---

## Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `UNAUTHORIZED` | 401 | Missing or invalid authorization header |
| `INVALID_REQUEST` | 400 | Missing required fields in request body |
| `DATABASE_ERROR` | 500 | Database query failed |
| `NO_DATA` | 404 | No data found for user |
| `CALCULATION_ERROR` | 500 | Error during simulation calculation |

---

## Usage Examples

### Connect Stripe

```typescript
import { supabase } from '@/lib/supabase'

const { data, error } = await supabase.functions.invoke('stripe-connect', {
  body: { api_key: 'sk_test_...' }
})

if (error) {
  console.error('Connection failed:', error.message)
} else {
  console.log('Connected to:', data.account_name)
}
```

### Sync Stripe Data

```typescript
const { data, error } = await supabase.functions.invoke('stripe-sync-enhanced', {
  body: {}
})

if (data?.success) {
  console.log(`Synced ${data.customers.length} customers`)
  console.log(`Total MRR: $${data.summary.total_mrr}`)
}
```

### Run Simulation

```typescript
const { data: { user } } = await supabase.auth.getUser()

const { data, error } = await supabase.functions.invoke('run-simulation', {
  body: {
    userId: user.id,
    pricingModel: {
      type: 'usage_based',
      billingPeriod: 'monthly',
      growthRate: 0.05
    }
  }
})

if (data?.success) {
  console.log('Projected margin:', data.results.summary.marginPercentage + '%')
}
```

---

## Deploying Edge Functions

Deploy all functions:

```bash
npx supabase functions deploy stripe-connect --no-verify-jwt
npx supabase functions deploy stripe-sync-enhanced --no-verify-jwt
npx supabase functions deploy run-simulation --no-verify-jwt
```

Note: `--no-verify-jwt` is used because authentication is handled within the functions.
