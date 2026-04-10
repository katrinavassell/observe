# Consultation Playbook

## Pricing Page Copy

Replace "Priority support" with:
- **"1:1 onboarding call with a founder"** — signals seniority and access
- **"Quarterly strategy review"** — sets ceiling (4x/year), signals business value not tech support

## Session 1: Onboarding (30 min, within 7 days of upgrade)

**Goal:** Get customer to value realization ASAP. Leave with real data on dashboard + at least one insight they didn't have.

**Pre-call (5 min):**
- Check account: events ingested, data sources, team size
- If data exists: pull analytics, note margin issues or cost outliers
- If no data: prepare to walk through SDK/proxy setup live

**Agenda:**
1. **(5 min) Context** — What's your product? What AI features? Current monthly spend?
2. **(10 min) Data pipeline** — Verify integration. SDK schema or proxy setup.
3. **(10 min) Dashboard walkthrough** — Show their specific numbers. "Your margin on Feature X is 23%, Feature Y is -4%. Here's why."
4. **(5 min) First alert** — Set up one cost alert together. Guarantees re-engagement.

**Post-call:** 3-bullet email — what you set up, what to watch, when Session 2 triggers.

## Session 2: Strategy Review (30 min, triggered by data)

**Trigger:** 1,000+ events AND 2+ distinct feature_keys AND 14+ days of data.

**Pre-call (10 min):**
- Review AI recommendations output
- Prepare 2-3 specific, quantified recommendations with dollar amounts

**Agenda:**
1. **(5 min) Check-in** — New models, features, pricing changes?
2. **(15 min) Recommendations** — Walk through AI findings. Validate each one for their business context.
3. **(5 min) Routing rules** — Set up optimizations together on the call.
4. **(5 min) Next steps** — What to monitor? Follow-up needed?

## Email Flow

| Moment | Trigger | Subject |
|---|---|---|
| Checkout complete | Webhook | "Your Growth plan is active — let's set up your dashboard" |
| 72hr reminder | Not booked | "Quick question about your Observe setup" |
| Session 1 follow-up | After call | Manual 3-bullet email |
| Session 2 trigger | Data threshold | "Your Observe data is ready for review" |
| Session 2 reminder | 7 days, not booked | One reminder, then stop |

## Critical UX Fix

**CheckoutSuccessPage currently auto-redirects in 2 seconds.** This is the highest-intent moment in the funnel — wasted.

**Change to:**
1. Green checkmark + "Welcome to Growth!"
2. Booking card: "Set up your dashboard with a founder" + Cal.com embed
3. Secondary link: "Skip for now, go to dashboard"
4. Remove the auto-redirect setTimeout

## Scaling Math

| Customers | Hours/week | Approach |
|---|---|---|
| 0-50 | ~2 hrs | Full 1:1, both sessions live |
| 50-100 | ~4 hrs | Session 1 stays live. Session 2 becomes async Loom review (15 min) + monthly group office hours |
| 100+ | Tiered | AI generates written Strategy Review. Top 20% get live calls. Enterprise tier for dedicated sessions |

## What to Track (spreadsheet, not software)

| Metric | Target |
|---|---|
| Session 1 booking rate | >50% |
| 30-day retention (consulted vs not) | Consulted should be 20%+ higher |
| Time to first insight | Consulted should be 3x faster |
| Session duration | Under 30 min |

**The real metric:** Churn rate of consulted vs non-consulted Growth customers. If no difference, redirect time to product.
