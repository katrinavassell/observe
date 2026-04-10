# Observe Cloud — Product Vision

## The Pitch
Open source gets the dashboard. Cloud gets the brain.

---

## 1. The Mascot — "Iris"

### Why "Iris"
- The colored part of the eye — literally "the observer"
- Short, memorable, feminine but not gendered
- Works as a name ("Ask Iris") and a brand ("Powered by Iris")
- Doesn't overlap with any major tech mascot

### Personality
- **Voice:** Direct, data-driven, slightly warm. Like a sharp analyst friend, not a corporate chatbot.
- **Tone:** Confident when she has data, honest when she doesn't. Never bullshits.
- **Quirks:** Uses numbers naturally ("3 of your 12 customers are underwater"), celebrates wins ("nice — your margins improved 8% this month")
- **She is NOT:** Clippy (never interrupts uninvited), a generic assistant ("how can I help?"), or overly cute in a way that undermines credibility

### Visual Design Brief
- **Shape:** Round, compact — works at 24px in a chat bubble and 120px on marketing
- **Core element:** A single large eye or lens — cute, expressive, changes based on state
- **Color:** Match Observe brand (dark/neutral with accent color)
- **Expressions:**
  - Neutral: calm, watching
  - Analyzing: eye narrows, scanning animation
  - Found something: eye widens, slight glow
  - Alert: eye turns warm/amber
  - Celebrating: sparkle/wink
- **Style reference:** Tamagotchi meets data analyst. Simple enough for a favicon, expressive enough for onboarding.

### Where Iris Appears
| Location | Behavior |
|---|---|
| Chat (Insights page) | Iris is the responder — avatar on every AI message |
| Alerts | Iris found something — appears in alert cards |
| Empty states | "I don't have enough data yet. Connect a source and I'll start watching." |
| Loading/analyzing | Eye scanning animation |
| Onboarding | Guides setup: "Let's connect your data. I work best with 30+ days of history." |
| Email alerts | From line: "Iris from Observe" |
| Marketing site | Hero character — "Meet Iris, your AI margins analyst" |

### Example Copy
- **Introduction:** "I'm Iris. I watch your costs, revenue, and margins so you don't have to. Connect a data source and I'll start finding patterns."
- **Cost anomaly:** "Heads up — your GPT-4o costs jumped 43% this week. Customer Acme Corp is driving most of it. Want me to dig deeper?"
- **No data:** "Nothing to see yet. I need event data to work with — connect Stripe, upload a CSV, or integrate your AI provider."
- **Upgrade moment:** "You've hit 25 insights this month. Upgrade to Growth for 500/month plus a strategy session with Kat."
- **Win:** "Your overall margin improved from 44% to 51% this month. The model swap on the search feature saved $380."

### Level-Up Path
1. **V1 (now):** Iris lives in the chat. Answers questions, surfaces insights.
2. **V2:** Iris gets proactive — cron-based alerts, email digests, anomaly detection.
3. **V3:** Iris gets teammates — specialized bots for different domains (see Workforce below).

---

## 2. The AI Workforce (V3 Vision)

### Concept
Users see their AI agents working. Like a cute ops dashboard. Each agent has a job, a status, and findings.

### The Squad (future — start with Iris alone)
| Agent | Job | Visual | Status Examples |
|---|---|---|---|
| **Iris** (lead) | Overall insights, chat | Eye/lens | "Analyzing 247 events..." |
| **Margin Scout** | Watches margins, flags underwater customers | Binoculars | "2 customers below 0% margin" |
| **Cost Hawk** | Monitors AI model costs, suggests swaps | Magnifying glass | "Found $400/mo savings on GPT-4o" |
| **Churn Radar** | Usage decline detection, health scores | Radar sweep | "3 customers showing decline" |
| **Price Pulse** | Pricing optimization, plan analysis | Heartbeat/pulse | "Pro plan underpriced by ~15%" |

### Workforce Dashboard
- Lives as a widget on the main dashboard or its own page
- Shows each active agent with:
  - Avatar + name
  - Current status (idle / analyzing / found something)
  - Last finding with timestamp
  - Click to see details
- Agents animate when working — subtle pulse, scanning motion
- Celebration state when something good happens (margin improvement, churn prevented)

### Progressive Unlock
- Free: Iris only (chat, basic insights)
- Growth: Iris + all agents (proactive alerts, cron analysis, email digests)
- The workforce dashboard IS the upgrade CTA — free users see locked agent slots

---

## 3. The Consultation Package

### Growth Plan Feature
**On pricing page:**
> "1:1 Strategy Session — Get a personalized pricing and growth review with our team. Included with Growth."

### Session 1: Onboarding (within first week of upgrade)
**Trigger:** Checkout success page shows Cal.com booking CTA
**Agenda (30 min):**
1. Review current pricing model and margins
2. Identify top 3 cost optimization opportunities
3. Set up alerts and monitoring for key metrics
4. Define success metrics for the next 90 days

### Session 2: Growth Review (after data threshold)
**Trigger:** 1,000+ events ingested AND 30+ days of data
**Notification:** Iris says: "You've got enough data for meaningful analysis now. Want to schedule a growth review with Kat?"
**Agenda (30 min):**
1. Review margin trends and anomalies
2. Customer health assessment — who's at risk, who's expanding
3. Pricing recommendations based on usage patterns
4. Action items for next quarter

### Where Booking Appears
- Checkout success page (primary CTA)
- Growth plan settings page
- Iris suggests it when data threshold is hit
- Sidebar badge for Growth users who haven't booked

### Scaling Plan (50+ customers)
1. Phase 1 (now): Kat does all sessions personally — it's the moat
2. Phase 2: Record sessions, build playbook from patterns
3. Phase 3: Iris absorbs the playbook — AI gives the advice, Kat handles exceptions
4. Phase 4: Group sessions / office hours instead of 1:1s

---

## 4. The Proprietary Guidance Engine

### What It Is
A curated knowledge base of pricing, margin, and growth best practices — maintained by Kat from real consultation sessions. Iris uses this to give opinionated, actionable advice instead of generic analytics.

### What Makes It Proprietary
Baremetrics/ChartMogul show you charts. Iris tells you what to DO about them.

| Generic Tool | Observe + Iris |
|---|---|
| "Your MRR is $11,070" | "Your MRR is $11,070 but 3 customers are underwater. Here's a migration path." |
| "Churn rate: 5%" | "2 customers show declining usage — intervene now before they churn. Here's what worked for similar customers." |
| "AI costs: $6,200/mo" | "Switch your search feature from GPT-4o to Claude Haiku — same quality, saves $400/mo. Want me to update the routing?" |

### Knowledge Base Structure
Kat documents her frameworks as structured playbooks:
- **Pricing playbooks:** When to raise prices, how to tier, usage-based vs seat-based signals
- **Margin benchmarks:** What's healthy by segment (Enterprise: 70%+, SMB: 50%+, Startup: 30%+)
- **Churn signals:** Usage decline patterns, support ticket correlation, payment failure patterns
- **Expansion signals:** Usage growth, feature adoption, team size changes
- **Model optimization:** Cost/quality tradeoffs by use case, when to switch providers

### The AI + Human Loop
1. Iris surfaces insight from data + knowledge base
2. User can discuss with Kat in consultation session
3. Kat's advice from session feeds back into knowledge base
4. Iris gets smarter over time
5. Eventually Iris handles 90% of cases, Kat handles the 10% edge cases

### Cron-Based Proactive Guidance
Daily/weekly cron jobs run the knowledge base against customer data:
- **Daily:** Cost anomaly detection, usage spikes, payment failures
- **Weekly:** Margin trend analysis, churn risk scoring, expansion signals
- **Monthly:** Pricing health check, competitive positioning review

Results delivered via:
- In-app notifications (Iris avatar + finding)
- Email digest (configurable frequency)
- Slack webhook (future)

### V1 → V2 → V3
- **V1 (ship in a week):** Iris chat with basic rules — cost thresholds, margin alerts, model swap suggestions. Knowledge base is hardcoded rules.
- **V2 (ship in a month):** Cron-based proactive alerts. Knowledge base as structured JSON/markdown that Kat edits. Consultation session insights feed back in manually.
- **V3 (long-term):** Fine-tuned model on Kat's consultation transcripts. Automatic knowledge base updates from session recordings. The AI workforce with specialized agents.

---

## 5. Open Source vs Cloud

| | Open Source (Free) | Cloud (Free Tier) | Cloud (Growth) |
|---|---|---|---|
| Dashboard + Analytics | Yes | Yes | Yes |
| Data Sources (CSV, Stripe, SDK) | Yes | Yes | Yes |
| Iris (AI Agent) | No | Yes (50 msgs/mo) | Yes (500 msgs/mo) |
| Proactive Alerts | No | 1 alert | Unlimited |
| AI Workforce Dashboard | No | No | Yes |
| Consultation Session | No | No | 2 sessions included |
| Knowledge Base Updates | No | No | Yes |
| Cron-Based Guidance | No | No | Yes |

**The mascot IS the moat.** Open source users see the dashboard. Cloud users see Iris watching their back.
