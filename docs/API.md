# API Reference

Express backend endpoints. The API runs on port 3001 and is proxied by Vite at `/api/*` in development.

For detailed API docs on specific subsystems, see the [api/](./api/) directory.

## Authentication

Account-based auth with email/password. Session cookies are used for all authenticated requests. Include `credentials: 'include'` in fetch calls (handled by `src/lib/api.ts`).

Rate limited: 20 auth attempts per 15 minutes.

---

## Auth Endpoints

### POST /auth/signup

Create a new account.

**Request Body:**
```json
{ "email": "user@example.com", "password": "...", "name": "Jane" }
```

### POST /auth/login

Log in to an existing account.

**Request Body:**
```json
{ "email": "user@example.com", "password": "..." }
```

### POST /auth/logout

End the current session.

### GET /auth/me

Get the current authenticated account.

### POST /auth/forgot-password

Request a password reset email.

### POST /auth/reset-password

Reset password with a token.

### GET /session/init

Initialize or resume a session. Returns the visitor ID.

**Response:**
```json
{ "visitorId": "550e8400-e29b-41d4-a716-446655440000" }
```

---

## Data Endpoints

### GET /data/status

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

### GET /data/analyzer

Fetch all data for the pricing analyzer (plans, customers, subscriptions, usage, costs).

### POST /data/sample

(REMOVED) The sample-data endpoint has been deleted — guest preview is now client-side only.

### DELETE /data/clear

Clear all user data.

### POST /data/upload/revenue

Upload customers, plans, and subscriptions.

### POST /data/upload/costs

Upload cost records.

### POST /data/upload/usage

Upload usage records.

### DELETE /data/clear/revenue
### DELETE /data/clear/costs
### DELETE /data/clear/usage

Clear specific data categories.

---

## Event Endpoints

### POST /events/ingest (Public)

Ingest events via SDK key authentication (Bearer token in Authorization header). Does not require a session.

**Request Body:**
```json
{
  "events": [{
    "eventName": "inference",
    "customerReferenceId": "cus_acme",
    "featureKey": "chat",
    "costAmount": 0.003,
    "model": "gpt-4o-mini"
  }]
}
```

### GET /events

List events for the current user. Supports pagination with `limit` and `offset`.

### GET /events/:id

Get a single event by ID.

### GET /events/by-feature

Events aggregated by feature key.

### GET /events/by-customer

Events aggregated by customer.

### GET /events/by-model

Events aggregated by model.

### GET /events/traces

Returns paginated list of traces with aggregated metrics.

**Query params:** `limit` (default 50, max 200), `offset` (default 0)

**Response:**
```json
{
  "traces": [{
    "trace_id": "abc123",
    "start_time": "2024-01-01T00:00:00Z",
    "span_count": 5,
    "total_cost": 0.0234,
    "total_revenue": 0.05,
    "total_duration_ms": 3400,
    "root_event": "agent.research",
    "cost_types": ["llm", "vector_db"]
  }]
}
```

### GET /events/trace/:traceId

Returns all spans for a specific trace.

**Response:**
```json
{
  "trace_id": "abc123",
  "spans": [{ "...EventDetail with trace_id, span_id, parent_span_id, duration_ms, cost_type" }]
}
```

### GET /events/by-cost-type

Returns cost breakdown by type.

**Query params:** `days` (default 30)

**Response:**
```json
{
  "breakdown": [{
    "cost_type": "llm",
    "event_count": 1234,
    "total_cost": 45.67,
    "total_revenue": 89.00,
    "total_usage": 5000000
  }]
}
```

---

## Analytics Endpoints

### GET /analytics/customer-pnl

Customer profit & loss breakdown.

### GET /analytics/margin-alerts

Detect features or customers with concerning margin trends.

---

## Proxy Endpoints

### POST /v1/chat/completions

Proxy to OpenAI chat completions. Logs cost as an observe_event.

### POST /v1/embeddings

Proxy to OpenAI embeddings.

### POST /v1/messages

Proxy to Anthropic messages API.

Headers: `Observe-Key`, `Observe-Customer`, `Observe-Feature` for event attribution.

---

## Integration Endpoints

### GET /integrations/openai/status
### POST /integrations/openai/connect
### DELETE /integrations/openai/disconnect
### POST /integrations/openai/sync

Manage OpenAI API key connection and usage data sync.

### GET /integrations/anthropic/status
### POST /integrations/anthropic/connect
### DELETE /integrations/anthropic/disconnect
### POST /integrations/anthropic/sync

Same for Anthropic.

---

## Alert Endpoints

Alerts are free for all users. 14 metric types across 5 categories: cost, margin, abuse/runaway, model, and concentration risk. 8 aggregate metrics evaluate globally; 6 per-customer triggers evaluate per customer. Each alert type includes a Tanso upsell CTA linking to tansohq.com.

### GET /alerts

List alert rules for the current user.

### POST /alerts

Create a new alert rule.

**Request Body:**
```json
{
  "name": "High daily cost",
  "metric": "daily_cost",
  "operator": ">",
  "threshold": 50.00,
  "email": "alerts@example.com"
}
```

**Available metrics:** `daily_cost`, `cost_per_event`, `margin_percent`, `customer_margin`, `feature_margin_trend`, `customer_cost_vs_revenue`, `model_cost_spike`, `margin_compression`, `usage_velocity`, `customer_cost_share`, `credit_burn_rate`, `top_customer_unprofitable`, `feature_cost_disparity`, `model_cost_increase`, `customer_concentration`, `provider_concentration`, `model_concentration`

### PUT /alerts/:id

Update an alert rule.

### DELETE /alerts/:id

Delete an alert rule.

---

## Model Endpoints

### GET /models

List all AI models with pricing data.

### GET /v1/models

OpenAI-compatible model list.

### GET /pricing/models

Model pricing table (cost per token by model).

---

## Insights Endpoints

### GET /insights

List generated insights.

### POST /insights/generate

Generate new AI insights from current data.

---

## Billing Endpoints

### GET /billing/status

Check billing subscription status for the current user.

### POST /billing/create-checkout

Create a Stripe checkout session for subscription purchase.

### POST /billing/portal

Create a Stripe customer portal session for billing management.

### POST /billing/webhook

Stripe webhook handler (no auth required).

### GET /api/feature-pricing

List feature pricing rules for the current user.

### POST /api/feature-pricing

Create or update a feature pricing rule.

### DELETE /api/feature-pricing/:featureKey

Delete a feature pricing rule.

### GET /api/feature-pricing/features

List features available for pricing rules.

---

## Team Endpoints

### GET /team

Get team info and members.

### POST /team/invite

Invite a team member by email.

### POST /team/join/:token

Accept a team invite.

---

## SDK Key Endpoints

### GET /sdk-keys

List SDK API keys.

### POST /sdk-keys

Generate a new SDK API key.

### DELETE /sdk-keys/:id

Revoke an SDK API key.

---

## Stripe Endpoints

### GET /stripe/status

Check Stripe connection status.

### POST /stripe/sync

Sync customers, subscriptions, and plans from Stripe.

---

## Error Handling

All endpoints return errors as:
```json
{ "error": "Description of what went wrong" }
```

HTTP status codes:
- `400` -- Bad request (missing fields, invalid data)
- `401` -- Not authenticated
- `403` -- Not authorized (e.g., viewer trying to write)
- `429` -- Rate limited
- `500` -- Server error
