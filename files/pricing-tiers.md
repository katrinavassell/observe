# Pricing Tiers — Pricing Analyzer

## Overview

Two tiers gated on AI-powered features. Free tier proves value, paid tier unlocks unlimited access.

---

## Free Tier

| Feature | Limit |
|---------|-------|
| AI Insight generations | 3/month |
| Simulations | 2/month |
| Sample data | Unlimited |
| SaaS metrics (MRR, ARR, ARPU, churn, NRR, LTV) | Unlimited |
| Plan health scores | Unlimited |
| Usage anomalies & negative margin tables | Unlimited |
| CSV uploads | Unlimited |
| Stripe/OpenAI/Anthropic connections | Unlimited |

## Pro — $12/month

| Feature | Limit |
|---------|-------|
| AI Insight generations | Unlimited |
| Simulations | Unlimited |
| Everything else | Same as free |

---

## Gating Logic

### Feature Keys (Tanso Entitlements)
- `ai_insights` — Free: limit=3/month, Pro: unlimited
- `simulations` — Free: limit=2/month, Pro: unlimited

### UX Flow
1. User triggers "Generate Insights" or "New Simulation"
2. `checkEntitlement()` checks remaining usage
3. If allowed → run feature, decrement remaining
4. If limit reached → show `UsageLimitBanner`
   - "You've used 3/3 insights this month"
   - [Upgrade to Pro — $12/mo] CTA
   - Links to /plans page

### What Stays Ungated
- All dashboard views and metric calculations (client-side)
- Sample data loading
- Data source connections (Stripe, OpenAI, Anthropic, CSV)
- Plan health, usage anomalies, negative margin tables
- Month selector and filtering

---

## Rationale

- **3 AI insights** = enough to see "your margins are compressing" and "these customers are at churn risk." Not enough for ongoing monitoring.
- **2 simulations** = enough to try "what if I raise Pro by 20%." Not enough to compare multiple scenarios and optimize.
- **$12/month** = low enough for solo founders to not think twice. Unlimited removes all friction.
- **Everything else free** = no gate on data connections or basic metrics. Users invest time connecting data before hitting the paywall, increasing conversion likelihood.
