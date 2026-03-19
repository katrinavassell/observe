# Simulations API

## List Simulations

```
GET /api/simulations
```

Returns all simulations for the current session, ordered by creation date (newest first).

### Response

```json
[
  {
    "id": "550e8400-...",
    "name": "Q2 API pricing increase",
    "status": "completed",
    "segment_name": "All Customers",
    "created_at": "2026-03-15T10:00:00Z",
    "scenarios": [
      { "id": "s1", "name": "Baseline", "isBaseline": true },
      { "id": "s2", "name": "+15% API pricing", "isBaseline": false }
    ]
  }
]
```

---

## Create Simulation

```
POST /api/simulations
```

### Request Body

```json
{
  "name": "Q2 API pricing increase",
  "segment_name": "All Customers",
  "time_range": {
    "start": "2026-01-01",
    "end": "2026-03-31"
  },
  "scenarios": [
    {
      "id": "s1",
      "name": "Baseline",
      "isBaseline": true,
      "pricingChange": null
    },
    {
      "id": "s2",
      "name": "+15% across the board",
      "isBaseline": false,
      "pricingChange": {
        "type": "percentage_increase",
        "value": 15,
        "label": "+15%"
      }
    }
  ]
}
```

### Response

```json
{
  "id": "550e8400-...",
  "status": "draft",
  "created_at": "2026-03-19T14:00:00Z"
}
```

---

## Get Simulation Detail

```
GET /api/simulations/:id
```

Returns the full simulation including results, customer impacts, and feature analysis.

### Response

```json
{
  "id": "550e8400-...",
  "name": "Q2 API pricing increase",
  "status": "completed",
  "segment_name": "All Customers",
  "time_range": { "start": "2026-01-01", "end": "2026-03-31" },
  "scenarios": [...],
  "summary_table": [
    {
      "scenarioId": "s1",
      "scenarioName": "Baseline",
      "revenue": 7550,
      "margin": 42.3,
      "churnRiskCount": 0,
      "badges": []
    },
    {
      "scenarioId": "s2",
      "scenarioName": "+15% across the board",
      "revenue": 8682,
      "margin": 49.8,
      "churnRiskCount": 2,
      "badges": ["highest_revenue", "best_margin"]
    }
  ],
  "customer_impacts": [
    {
      "customerId": "cus_001",
      "customerName": "Acme Corp",
      "currentMrr": 299,
      "changePercent": 15,
      "currentMargin": 70.2,
      "newMargin": 74.3,
      "churnRisk": "low"
    }
  ],
  "feature_analysis": [
    {
      "featureKey": "api_requests",
      "featureName": "API Requests",
      "currentMargin": 78.8,
      "newMargin": 82.0,
      "status": "high"
    }
  ],
  "winning_scenario_id": null,
  "rolled_out_at": null
}
```

---

## Update Simulation

```
PUT /api/simulations/:id
```

Used to run a simulation, select a winner, or mark as rolled out.

### Run Simulation

```json
{ "status": "running" }
```

Triggers computation of `summary_table`, `customer_impacts`, and `feature_analysis`. Status changes to `completed` when done.

### Roll Out

```json
{
  "status": "rolled_out",
  "winning_scenario_id": "s2"
}
```

---

## Delete Simulation

```
DELETE /api/simulations/:id
```

Returns `{ "success": true }`.

---

## Pricing Opportunities

```
GET /api/simulations/opportunities
```

Auto-detected pricing opportunities based on current feature margins.

### Response

```json
[
  {
    "type": "negative_margin",
    "severity": "high",
    "feature_key": "ai_summarization",
    "title": "ai_summarization is losing money",
    "description": "This feature has -113% margin. Consider raising price or reducing model cost.",
    "current_margin": -112.7,
    "suggested_action": "simulate_price_increase"
  },
  {
    "type": "underpriced",
    "severity": "medium",
    "feature_key": "pdf_generation",
    "title": "pdf_generation may be underpriced",
    "description": "19% margin is below the 20% threshold.",
    "current_margin": 18.8,
    "suggested_action": "simulate_price_increase"
  }
]
```
