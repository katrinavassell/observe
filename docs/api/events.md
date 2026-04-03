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
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "customer_id": "cus_001",
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
      "properties": {}
    }
  ],
  "total": 342
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
    "total_cost": 890.00,
    "total_revenue": 4200.00,
    "total_usage": 450000,
    "margin_pct": 78.8,
    "margin_status": "high",
    "event_count": 30
  },
  {
    "feature_key": "ai_summarization",
    "total_cost": 2340.00,
    "total_revenue": 1100.00,
    "total_usage": 12000,
    "margin_pct": -112.7,
    "margin_status": "negative",
    "event_count": 18
  }
]
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
    "total_cost": 534.00,
    "total_revenue": 1794.00,
    "margin_pct": 70.2,
    "margin_status": "high",
    "top_features": ["api_requests", "ai_summarization"]
  }
]
```

---

## Aggregate by Model

```
GET /api/events/by-model
```

Returns cost and volume grouped by AI model. Only includes events where `model` is not null.

### Response

```json
[
  {
    "model": "gpt-4o",
    "model_provider": "openai",
    "total_cost": 1800.00,
    "request_count": 12000,
    "cost_per_request": 0.15,
    "pct_of_total": 52.3
  },
  {
    "model": "gpt-4o-mini",
    "model_provider": "openai",
    "total_cost": 340.00,
    "request_count": 45000,
    "cost_per_request": 0.0076,
    "pct_of_total": 9.9
  }
]
```

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
      "customer_id": "cus_001",
      "feature_key": "api_requests",
      "event_name": "api_call",
      "timestamp": "2026-03-19T14:30:00Z",
      "cost_amount": 0.002,
      "cost_unit": "usd",
      "revenue_amount": 0.01,
      "usage_units": 1,
      "model": "gpt-4o-mini",
      "model_provider": "openai",
      "properties": { "endpoint": "/v1/summarize", "latency_ms": 340 }
    }
  ]
}
```
