# Using Tanso to Power Your Own Pricing — A Dogfooding Guide

## What We Did

We used Tanso to manage the pricing and entitlements for the Pricing Analyzer — Tanso's own product. This is the full story of how we went from "we need a free and paid tier" to a live, gated product in under 10 minutes using the Tanso MCP integration.

---

## The Problem

The Pricing Analyzer helps SaaS founders see their real margins by combining revenue, AI costs, and usage data. We needed to:

1. Offer a **free tier** that proves value (margin compression, churn risk insights)
2. Gate the **expensive AI-powered features** to convert free users to paid
3. Track usage on **every feature** — even ungated ones — so we have data to inform future pricing decisions
4. Keep it simple: two tiers, one price point

## The Decision: What to Gate

We looked at every feature in the product and asked: **"Does this cost us money to run, and is it high enough value that users would pay for more?"**

| Feature | Costs Us Money? | High Value? | Gate It? |
|---------|----------------|-------------|----------|
| AI Insights (Claude-powered) | Yes (API calls) | Yes | Limit on free |
| Simulations | Moderate | Yes | Limit on free |
| SaaS Metrics Dashboard | No (client-side) | Medium | No — it's the hook |
| Plan Health Scores | No (client-side) | Medium | No |
| CSV Uploads | No | Low | No |
| Stripe/AI Connections | No | Low | No |
| Sample Data | No | Low | No — it's onboarding |

**The rule:** Gate features that cost money AND are high value. Leave everything else free to maximize the "aha moment" before hitting the paywall.

## The Tiers

| | Free | Pro ($12/mo) |
|---|---|---|
| AI Insight generations | 3/month | Unlimited |
| Simulations | 2/month | Unlimited |
| Everything else | Unlimited | Unlimited |

**Why these limits:**
- **3 AI insights** is enough to see "your margins dropped 22 points" and "4 customers are at churn risk." That's the aha moment. But you can't monitor ongoing — you'll want more next month.
- **2 simulations** is enough to try "what if I raise Pro by 20%" and see the projected impact. But you can't compare 5 different scenarios to find the optimal price — you need Pro for that.
- **$12/month** is low enough that a solo founder doesn't think twice. Unlimited removes all friction.

## Setting It Up in Tanso

### Step 1: Create Features (the things you track and gate)

We created 10 features — 2 gated, 8 tracked-only:

```
ai_insights          — AI-generated pricing insights, churn risk, recommendations
simulations          — What-if pricing scenario modeling
csv_upload           — Upload revenue, cost, and usage data via CSV
stripe_connection    — Connect Stripe for customer/subscription data
ai_provider_connection — Connect OpenAI/Anthropic for cost data
saas_metrics         — Core SaaS metrics dashboard (MRR, ARR, ARPU, churn)
plan_health          — Per-plan health scoring
usage_anomalies      — Unusual usage pattern detection
negative_margin      — Identify unprofitable customers
sample_data          — Demo dataset for onboarding
```

**Why track ungated features?** Because we don't know yet what we'll charge for in 6 months. Maybe heavy CSV uploaders become a segment. Maybe Stripe connection frequency correlates with willingness to pay. The data costs nothing to collect and could inform future pricing.

### Step 2: Create Plans

Two plans:
- **Free** — $0/month
- **Pro** — $12/month

### Step 3: Link Features to Plans with Rules

**Free plan:**
- `ai_insights` → usage-metered, max 3/month, resets monthly
- `simulations` → usage-metered, max 2/month, resets monthly
- All other features → boolean (on/off), enabled

**Pro plan:**
- All features → boolean (on/off), enabled (no limits)

### Step 4: Activate

Set both plans to ACTIVE status and enable all features. Done.

## The Frontend Integration

The app was already wired for entitlement checks. Here's the pattern:

### Checking Entitlements

```typescript
// composables/useEntitlement.ts
const simRun = useEntitlement('simulations')

// In the template
<button
  :disabled="simRun.isAtLimit.value"
  @click="createSimulation()"
>
  New Simulation
</button>
```

### Showing Usage

```vue
<UsageLimitBanner
  v-if="simRun.hasLimit.value"
  feature-label="Simulations"
  :usage="simRun.usage.value"
  :limit="simRun.limit.value"
  :usage-percent="simRun.usagePercent.value"
/>
```

### The UX Flow

```
User clicks "Generate Insights"
  → checkEntitlement('ai_insights')
  → If allowed: run it, usage counter increments
  → If limit reached: show banner
    → "You've used 3/3 insights this month"
    → [Upgrade to Pro — $12/mo]
```

No paywall on onboarding. No gate on connecting data. No friction until the user has already seen the value.

## What We Learned

### 1. Gate the expensive stuff, track everything else
Don't guess what to charge for. Instrument every feature, gate only what you must, and let usage data tell you where the next paywall should go.

### 2. Free limits should deliver the aha moment
3 insights is enough to see "your margins are compressing and here's why." That's the moment they decide whether to pay. Too few and they never get there. Too many and they never need to upgrade.

### 3. The upgrade trigger should be natural
Users hit the limit when they're deep in analysis mode — comparing scenarios, exploring recommendations. That's the highest-intent moment to show the upgrade CTA.

### 4. Keep the paid tier dead simple
One price. Unlimited everything. No feature matrix to decode. $12/month and you're done.

### 5. Monthly resets create recurring urgency
The free user gets 3 insights this month. They'll use them. Next month they get 3 more — but they've been flying blind for 30 days. That's the conversion pressure.

---

## Full Feature Catalog in Tanso

| Feature Key | Name | Free Limit | Pro Limit | Tanso ID |
|---|---|---|---|---|
| `ai_insights` | AI Insights | 3/mo | Unlimited | `2b8be44e-...` |
| `simulations` | Simulations | 2/mo | Unlimited | `92936a6d-...` |
| `csv_upload` | CSV Uploads | Unlimited | Unlimited | `f516fe9b-...` |
| `stripe_connection` | Stripe Connection | Unlimited | Unlimited | `be1f1c8d-...` |
| `ai_provider_connection` | AI Provider Connection | Unlimited | Unlimited | `4433e72b-...` |
| `saas_metrics` | SaaS Metrics Dashboard | Unlimited | Unlimited | `2406f9a8-...` |
| `plan_health` | Plan Health Analysis | Unlimited | Unlimited | `6899cbae-...` |
| `usage_anomalies` | Usage Anomaly Detection | Unlimited | Unlimited | `dc4e6c1a-...` |
| `negative_margin` | Negative Margin Analysis | Unlimited | Unlimited | `e8c5092c-...` |
| `sample_data` | Sample Data | Unlimited | Unlimited | `9d57f911-...` |

## Plan IDs

| Plan | Key | Price | Tanso ID |
|---|---|---|---|
| Free | `free` | $0/mo | `de9f7367-d908-4577-8414-059518a0d283` |
| Pro | `pro` | $12/mo | `39408c84-fd2c-476c-abca-ff78afb9de6d` |
