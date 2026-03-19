# API Reference (Legacy)

> **Note:** This documents the existing Express backend endpoints. For the new Observe endpoints (events, features, customers, models, simulations, insights), see the [api/](./api/) directory.

## Authentication

No authentication required. All requests use anonymous sessions via cookies. The `ensureVisitor` middleware assigns a `visitorId` on first request and scopes all data to that visitor.

Cookies are set automatically — include `credentials: 'include'` in fetch calls (handled by `src/lib/api.ts`).

---

## Endpoints

### GET /api/session/init

Initialize or resume a session. Returns the visitor ID.

**Response:**
```json
{ "visitorId": "550e8400-e29b-41d4-a716-446655440000" }
```

---

### GET /api/data/status

Get data mode and record counts.

**Response:**
```json
{
  "data_mode": "sample",
  "has_data": true,
  "customer_count": 5,
  "has_revenue": true,
  "has_costs": true,
  "has_usage": true,
  "revenue_customer_count": 5,
  "costs_record_count": 30,
  "usage_record_count": 30,
  "last_sync_at": "2026-03-19T10:00:00Z"
}
```

---

### GET /api/data/analyzer

Fetch all data for the pricing analyzer (plans, customers, subscriptions, usage, costs).

**Response:** `AnalyzerData` object or `null` if no customers exist.

---

### POST /api/data/sample

Load sample dataset. Clears existing data first.

**Response:**
```json
{ "success": true, "message": "Sample data loaded" }
```

---

### DELETE /api/data/clear

Clear all user data.

---

### POST /api/data/upload/revenue

Upload customers, plans, and subscriptions.

**Request Body:**
```json
{
  "customers": [{ "customer_id": "cus_001", "name": "Acme Corp", "email": "billing@acme.com" }],
  "plans": [{ "plan_id": "pro", "name": "Professional", "price_amount": 99 }],
  "subscriptions": [{ "subscription_id": "sub_001", "customer_id": "cus_001", "plan_id": "pro", "is_active": true }]
}
```

---

### POST /api/data/upload/costs

Upload cost records.

**Request Body:**
```json
{
  "records": [
    { "month": "2026-01", "customer_id": "cus_001", "provider": "openai", "cost": 245.00 }
  ]
}
```

---

### POST /api/data/upload/usage

Upload usage records.

**Request Body:**
```json
{
  "records": [
    { "month": "2026-01", "customer_id": "cus_001", "metric_key": "api_calls", "metric_value": 15000 }
  ]
}
```

---

### DELETE /api/data/clear/revenue
### DELETE /api/data/clear/costs
### DELETE /api/data/clear/usage

Clear specific data categories.

---

### GET /api/customers
### GET /api/plans
### GET /api/subscriptions
### GET /api/usage
### GET /api/costs

List endpoints for each data type. Returns arrays of records.

---

### GET /api/metrics/summary

Quick MRR/ARR summary.

**Response:**
```json
{
  "total_customers": 5,
  "active_subscriptions": 5,
  "mrr": 755,
  "arr": 9060,
  "arpc": 151
}
```

---

### GET /api/stripe/status

Check if Stripe is connected via Replit native integration.

**Response:**
```json
{
  "connected": true,
  "account_id": "acct_...",
  "account_name": "My Company"
}
```

---

### POST /api/stripe/sync

Sync customers, subscriptions, and plans from Stripe.

**Response:**
```json
{
  "success": true,
  "synced": {
    "customers": 25,
    "subscriptions": 30,
    "plans": 4
  }
}
```

---

## Error Handling

All endpoints return errors as:
```json
{ "error": "Description of what went wrong" }
```

HTTP status codes:
- `400` — Bad request (missing fields, invalid data)
- `500` — Server error (database failure, Stripe error)
