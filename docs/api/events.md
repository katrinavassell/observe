# Events API

## List Events

```
GET /api/events
```

Returns paginated list of events for the current session.

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `customer_id` | string | Filter by customer |
| `feature_key` | string | Filter by feature |
| `model` | string | Filter by AI model |
| `source` | string | Filter by source (`csv`, `stripe`, `sample`) |
| `date_from` | ISO 8601 | Events after this date |
| `date_to` | ISO 8601 | Events before this date |
| `limit` | number | Page size (default: 50, max: 200) |
| `offset` | number | Pagination offset |

### Response

```json
{
  "events": [
    {
      "id": 1,
      "customer_id": "cus_001",
      "customer_name": "Acme Corp",
      "feature_key": "api_requests",
      "event_name": "usage",
      "timestamp": "2026-01-15T00:00:00Z",
      "cost_amount": 12.50,
      "cost_unit": "usd",
      "revenue_amount": 45.00,
      "usage_units": 15000,
      "model": null,
      "model_provider": null,
      "source": "csv",
      "granularity": "monthly_aggregate",
      "properties": null,
      "agent_id": null,
      "trace_id": null,
      "span_id": null,
      "parent_span_id": null,
      "duration_ms": null,
      "cost_type": null,
      "revenue_source": "none"
    }
  ],
  "total": 342,
  "limit": 50,
  "offset": 0
}
```

---

## Aggregate by Feature

```
GET /api/events/by-feature
```

Returns cost, revenue, usage, and margin grouped by feature.

### Response

```json
[
  {
    "feature_key": "api_requests",
    "event_count": 30,
    "total_cost": 890.00,
    "total_revenue": 4200.00,
    "total_usage": 450000,
    "margin_pct": 79,
    "last_seen": "2026-03-19T14:30:00Z"
  },
  {
    "feature_key": "ai_summarization",
    "event_count": 18,
    "total_cost": 2340.00,
    "total_revenue": 1100.00,
    "total_usage": 12000,
    "margin_pct": -113,
    "last_seen": "2026-03-18T09:15:00Z"
  }
]

Note: `margin_pct` is `null` when `total_revenue` is 0.
```

---

## Aggregate by Customer

```
GET /api/events/by-customer
```

Returns cost, revenue, and margin grouped by customer.

### Response

```json
[
  {
    "customer_id": "cus_001",
    "customer_name": "Acme Corp",
    "event_count": 48,
    "total_cost": 534.00,
    "total_revenue": 1794.00,
    "margin_pct": 70,
    "last_seen": "2026-03-19T14:30:00Z"
  }
]
```

Note: `margin_pct` is `null` when `total_revenue` is 0. Does not include `total_usage`.

---

## Aggregate by Model

```
GET /api/events/by-model
```

Returns cost, revenue, usage, and margin grouped by AI model. Only includes events where `model` is not null.

### Response

```json
[
  {
    "model": "gpt-4o",
    "model_provider": "openai",
    "event_count": 12000,
    "total_cost": 1800.00,
    "total_revenue": 3500.00,
    "total_usage": 240000,
    "margin_pct": 49,
    "last_seen": "2026-03-19T14:30:00Z"
  },
  {
    "model": "gpt-4o-mini",
    "model_provider": "openai",
    "event_count": 45000,
    "total_cost": 340.00,
    "total_revenue": 900.00,
    "total_usage": 1800000,
    "margin_pct": 62,
    "last_seen": "2026-03-19T14:28:00Z"
  }
]
```

Note: `margin_pct` is `null` when `total_revenue` is 0.

---

## Ingest Events

```
POST /api/events/ingest
```

Accepts single events or batches for real-time SDK ingestion. Requires a valid SDK API key passed as a Bearer token in the `Authorization` header.

### Request Body

```json
{
  "events": [
    {
      "eventName": "api_call",
      "customerReferenceId": "cus_001",
      "featureKey": "api_requests",
      "timestamp": "2026-03-19T14:30:00Z",
      "costAmount": 0.002,
      "costUnit": "usd",
      "revenueAmount": 0.01,
      "usageUnits": 1,
      "model": "gpt-4o-mini",
      "modelProvider": "openai",
      "inputTokens": 500,
      "outputTokens": 100,
      "idempotencyKey": "evt_abc123",
      "traceId": "trace_abc",
      "spanId": "span_001",
      "parentSpanId": null,
      "durationMs": 1200,
      "costType": "llm",
      "properties": { "region": "us-east-1" }
    }
  ]
}
```

Required fields: `eventName`, `customerReferenceId`, `featureKey`. All others are optional.

If `costAmount` is not provided but `model`, `inputTokens`, and `outputTokens` are, cost is auto-calculated from the built-in model pricing table. If `revenueAmount` is not provided, revenue is enriched from feature pricing rules or MRR allocation.

Maximum batch size: 1000 events.

### Response

```json
{
  "accepted": 1,
  "rejected": 0,
  "errors": []
}
```

`rejected` includes both validation failures and deduplicated events (matched by `idempotencyKey`). `errors` contains `{ "index": 0, "error": "..." }` entries for events that failed validation.
