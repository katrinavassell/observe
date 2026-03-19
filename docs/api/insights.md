# Insights API

## Generate Insights

```
POST /api/insights/generate
```

Sends aggregated data to OpenAI and returns actionable insights. Each call is logged as an `observe_event` with `feature_key: 'ai_insights'`.

### Response

```json
{
  "insights": [
    {
      "id": "550e8400-...",
      "type": "margin_alert",
      "title": "ai_summarization has negative margin",
      "description": "This feature costs $2,340 but only generates $1,100 in revenue. Consider switching from gpt-4o to gpt-4o-mini for non-critical requests, or raising the per-call price.",
      "severity": "critical",
      "feature_key": "ai_summarization",
      "customer_id": null
    },
    {
      "type": "pricing_opportunity",
      "title": "api_requests can support a price increase",
      "description": "With 79% margin and high usage across all plans, a 15-20% price increase would have low churn risk.",
      "severity": "info",
      "feature_key": "api_requests",
      "customer_id": null
    },
    {
      "type": "customer_risk",
      "title": "3 customers are underwater",
      "description": "Startup Labs, TechStart Inc, and one other customer have negative overall margins. Review their feature usage and contract terms.",
      "severity": "warning",
      "feature_key": null,
      "customer_id": null
    }
  ],
  "meta": {
    "tokens_used": 1847,
    "cost_usd": 0.0031,
    "model": "gpt-4o-mini"
  }
}
```

---

## List Previous Insights

```
GET /api/insights
```

Returns previously generated insights, newest first.

### Query Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `limit` | number | Max results (default: 20) |

### Response

Same structure as `insights` array above, with `created_at` timestamps.
