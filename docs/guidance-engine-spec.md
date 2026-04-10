# Proprietary Guidance Engine

## The Pitch
Baremetrics tells you WHAT happened. Observe tells you WHY and WHAT TO DO.

## Marketing Headline
**"Stop guessing what to charge for AI."**

Subhead: Connect your AI costs to revenue at the feature level. See which customers and features are profitable — and get recommendations to fix the ones that aren't.

## 15 Guidance Types

### Pricing Decisions
1. **Feature Underpricing** — cost/call > 80% of revenue/call → "document_analysis costs $0.087/call, earns $0.05. You lost $458/mo."
2. **Price Elasticity Signal** — usage growing + healthy margin → "code_review has pricing power. 15% increase adds ~$1,240/mo."
3. **Plan Restructuring** — customers using 8-12x plan median → "4 Starter customers should be on a higher tier."

### Margin Protection
4. **Customer Underwater** — negative margin with specific model/feature cause + routing fix
5. **Margin Compression Trend** — decompose into price/mix/volume effects (margin bridge)
6. **Revenue Leakage** — customers with cost > 0, revenue = 0

### Cost Optimization
7. **Model Swap** — calculate savings using actual token distributions, not averages
8. **Provider Cost Arbitrage** — when prices change, recalculate optimal routing

### Growth Signals
9. **Expansion Signal** — usage up >50% MoM, nearing plan limit
10. **Feature Adoption Tracking** — new feature traction curve + margin

### Churn/Risk
11. **Churn Risk** — usage down >50% over 4 weeks or >7 days inactive
12. **Concentration Risk** — customer/provider/model dependency with impact modeling

### Operational
13. **Anomaly Detection** — hourly cost z-score, identify responsible customer
14. **Model Quality/Cost Frontier** — optimal model allocation per feature
15. **Weekly Digest** — board-ready summary with top 3 actions

## Architecture (3 layers)

```
observe_events (raw)
  → SQL aggregations (per-customer/feature/model P&L)
  → Rules engine (threshold checks → recommendation rows)
  → LLM synthesis (recommendations + data → prioritized narrative)
  → Delivery (dashboard cards, email digest, chat)
  → User action (apply/dismiss/discuss with Kat)
  → Feedback loop (outcomes → improve rules + prompts)
```

## What Makes It Proprietary (vs Stripe/Baremetrics/ChartMogul)

| They have | We have |
|---|---|
| Revenue by customer | Cost-to-revenue at feature granularity |
| MRR charts | Model-level optimization with one-click routing |
| Churn rate | Why churn is happening + intervention actions |
| Static dashboards | Prescriptive actions the AI executes |
| No AI cost awareness | Built specifically for AI-native cost structures |

## The AI + Human Loop

1. AI surfaces insight from rules engine + LLM
2. User self-serves (one-click action) OR books Kat consultation
3. Kat reviews, advises, records notes in `guidance_feedback` table
4. Monthly: extract patterns from notes → few-shot examples in LLM prompt
5. Rules get segment-specific: "pre-revenue customers: suppress margin alerts, focus on adoption"
6. Month 12: system handles 80% autonomously, Kat handles 10% edge cases

## Build Sequence

### V1 (this week): 5 new recommendation types + weekly email
- Revenue leakage, usage anomaly, expansion signal, churn risk, feature underpricing
- Pure SQL, no LLM needed
- Weekly email digest via Resend (Sunday night cron)
- **3-4 days of work**

### V2 (this month): LLM synthesis + consultation flow
- Structured recommendation cards with narrative
- "Discuss with Kat" button → Cal.com booking
- `guidance_feedback` table for consultation notes
- Remaining recommendation types
- Smarter model swap using actual token distributions
- **2-3 weeks**

### V3 (3-6 months): Learning loop + cross-user intelligence
- Prompt enrichment from guidance_feedback
- Cross-user benchmarks: "Companies your size have 45% margin on chat. Yours is 28%."
- Scenario modeling: "What if OpenAI raises prices 20%?"
- Auto-calibrating thresholds from apply/dismiss ratios
- Guidance API for programmatic access

## Key Metric
Track apply/dismiss ratio per recommendation type. If dismiss > 80%, prune it.
