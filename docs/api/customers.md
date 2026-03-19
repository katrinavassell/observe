# Customers API

## Get Customer Detail

```
GET /api/customers/:id
```

Returns aggregated metrics, feature breakdown, and monthly timeseries for a single customer.

### Path Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `id` | string | Customer ID (e.g., `cus_001`) |

### Response

```json
{
  "customer_id": "cus_001",
  "customer_name": "Acme Corp",
  "email": "billing@acme.com",
  "total_cost": 534.00,
  "total_revenue": 1794.00,
  "margin_pct": 70.2,
  "margin_status": "high",
  "timeseries": [
    { "month": "2026-01", "cost": 85.00, "revenue": 299.00, "margin_pct": 71.6 },
    { "month": "2026-02", "cost": 92.00, "revenue": 299.00, "margin_pct": 69.2 }
  ],
  "features": [
    { "feature_key": "api_requests", "cost": 120.00, "revenue": 540.00, "usage": 45000 },
    { "feature_key": "ai_summarization", "cost": 280.00, "revenue": 150.00, "usage": 3200 },
    { "feature_key": "pdf_generation", "cost": 134.00, "revenue": 200.00, "usage": 800 }
  ],
  "recent_events": [
    {
      "id": "...",
      "feature_key": "api_requests",
      "event_name": "usage",
      "timestamp": "2026-03-01T00:00:00Z",
      "cost_amount": 42.00,
      "revenue_amount": 180.00
    }
  ]
}
```
