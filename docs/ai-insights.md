# AI Insights

AI-powered analysis of your margins, pricing, and customer health. Powered by OpenAI.

## What You Get

Click **Generate Insights** and Observe sends a summary of your data to `gpt-4o-mini`, which returns 3–5 actionable insights:

| Insight Type | Example |
|-------------|---------|
| **Margin alert** | "pdf_generation has -15% margin and costs are increasing month-over-month" |
| **Pricing opportunity** | "api_requests could support a 20% price increase — 92% of customers have margin above 40%" |
| **Cost optimization** | "Switching ai_summarization from gpt-4o to gpt-4o-mini would save ~$1,200/mo with minimal quality impact" |
| **Customer risk** | "3 enterprise customers are underwater — review their contract terms" |

Each insight has:
- **Severity** — `critical` (red), `warning` (amber), `info` (blue), `positive` (green)
- **Related feature or customer** — links to the relevant detail page
- **Actionable description** — not just what's wrong, but what to do about it

## How It Works

1. Observe aggregates your data: feature margins, customer profitability, model costs
2. Sends a structured summary to OpenAI `gpt-4o-mini`
3. Parses the response into typed insight objects
4. Saves them to the database for later viewing

**Your raw data is never sent to OpenAI.** Only aggregated summaries (e.g., "feature X has $4,200 revenue and $890 cost") are included in the prompt.

## AI Credits

Each AI Insights generation costs one AI credit. Free plans get 5 AI credits per month. You can earn bonus credits by giving feedback (+5) or inviting teammates (+10).

## Cost Transparency

Every AI Insights call is tracked as an `observe_event` and costs one AI credit:

```
feature_key: 'ai_insights'
event_name: 'inference'
model: 'gpt-4o-mini'
model_provider: 'openai'
cost_amount: <estimated from token usage>
```

This means you can see the cost of the AI Insights feature itself on the `/features` page — and even simulate pricing for it using the Pricing Simulator.

Typical cost per insights generation: **$0.001–$0.005** (depending on data size).

## When to Use

- After importing new data — get fresh analysis
- Before running a simulation — see what the AI recommends first
- Periodically — spot trends you might miss manually

## Limitations

- Insights are suggestions, not guarantees. Always validate against your domain knowledge.
- Quality depends on data completeness. More features and cost data → better insights.
- Rate: generates once per click. No automatic scheduling in v1.
