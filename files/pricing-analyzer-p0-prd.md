# Pricing Analyzer P0 — Product Requirements Document

## Overview

A standalone tool that helps SaaS founders see their real margins by combining revenue, AI costs, and usage data. Reveals insights they've never seen while exposing gaps that only Tanso Core can fill.

**Primary Goal:** Prove founders care about margin visibility and will pay for it.

**Success Metrics:**
- Time to first insight: < 5 minutes
- Users reaching dashboard: > 70% of signups
- Design partner conversions: 3-5 from analyzer users
- Willingness to pay signal: Any $20/mo conversions

---

## Core Data Model

Three data types. Each can come from an integration OR CSV upload.

| Data Type | What It Powers | Integration | CSV Fallback |
|-----------|----------------|-------------|--------------|
| **Revenue** | MRR, ARR, plans, customers, churn | Stripe API Key | ✓ |
| **AI Costs** | Margin calculations, cost trends | OpenAI / Anthropic API Key | ✓ |
| **Usage** | Churn risk, upsell signals, anomalies | Stripe (if metered billing) | ✓ |

---

## User Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Land on Data Sources                                          │
│         │                                                       │
│         ├── [Try Sample Data] ──→ Load 3 CSVs ──→ Dashboard     │
│         │                                                       │
│         └── Connect your own:                                   │
│               │                                                 │
│               ├── Revenue: Stripe API key or CSV                │
│               ├── Costs: OpenAI/Anthropic key or CSV            │
│               └── Usage: CSV (or auto from Stripe)              │
│                     │                                           │
│                     ↓                                           │
│               Pricing Analyzer                                  │
│               (SaaS Metrics → Plan Health → Usage → Margins)    │
│                     │                                           │
│                     ↓                                           │
│               Gap Callout → Design Partner CTA                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Sources Page

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  Data Sources                                                   │
│  Connect your data to see pricing insights                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  🎯 See it in action first                              │   │
│  │                                                         │   │
│  │  Load 6 months of realistic SaaS data:                  │   │
│  │  • 30 customers across 4 pricing tiers                  │   │
│  │  • Revenue, costs, and usage data                       │   │
│  │  • Real margin compression and churn risk scenarios     │   │
│  │                                                         │   │
│  │  [Try Sample Data]                                      │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ─────────────────── or connect your own ───────────────────   │
│                                                                 │
│  REVENUE                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  Stripe                                    [Connect]    │   │
│  │  Pull customers, subscriptions, and invoices            │   │
│  │                                                         │   │
│  │  ───────────────────── or ─────────────────────         │   │
│  │                                                         │   │
│  │  Upload CSV                                [Upload]     │   │
│  │  [↓ Download template]                                  │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  AI COSTS                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  OpenAI                                    [Connect]    │   │
│  │  Pull monthly usage and token costs                     │   │
│  │                                                         │   │
│  │  Anthropic                                 [Connect]    │   │
│  │  Pull monthly usage and token costs                     │   │
│  │                                                         │   │
│  │  ───────────────────── or ─────────────────────         │   │
│  │                                                         │   │
│  │  Upload CSV                                [Upload]     │   │
│  │  [↓ Download template]                                  │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  USAGE                                                          │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                                                         │   │
│  │  Upload your usage data                                 │   │
│  │  [Upload CSV]  [↓ Download template]                    │   │
│  │                                                         │   │
│  │  ┌───────────────────────────────────────────────────┐ │   │
│  │  │  💡 Using Stripe metered billing?                 │ │   │
│  │  │                                                   │ │   │
│  │  │  If you connected Stripe above and use Billing    │ │   │
│  │  │  Meters or Usage Records, we'll detect and pull   │ │   │
│  │  │  usage automatically. No CSV needed.              │ │   │
│  │  └───────────────────────────────────────────────────┘ │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  COMING SOON                                                    │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Salesforce    [Notify me]                              │   │
│  │  HubSpot       [Notify me]                              │   │
│  │  QuickBooks    [Notify me]                              │   │
│  │                                                         │   │
│  │  Need something else? [Request integration →]           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### API Key Connect Modal

```
┌─────────────────────────────────────────────────────────────────┐
│  Connect Stripe                                            [X]  │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Enter your Stripe Secret Key                                   │
│                                                                 │
│  [sk_live_•••••••••••••••••••••••••••••                    ]   │
│                                                                 │
│  ℹ️  Find this in Stripe Dashboard → Developers → API keys.     │
│     We recommend a restricted key with read-only access to:     │
│     • Customers                                                 │
│     • Subscriptions                                             │
│     • Invoices                                                  │
│     • Usage Records (if applicable)                             │
│                                                                 │
│  Your key is encrypted and never stored in plain text.          │
│                                                                 │
│  [Connect]                                        [Cancel]      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Pricing Analyzer Page

### Empty State

```
┌─────────────────────────────────────────────────────────────────┐
│  Pricing Model Analyzer                                         │
│  Analyze your pricing data to discover optimization             │
│  opportunities                                                  │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                        📊                               │   │
│  │                                                         │   │
│  │   No data connected yet                                 │   │
│  │                                                         │   │
│  │   Connect your revenue and cost data to see:            │   │
│  │   • Margin analysis                                     │   │
│  │   • Plan health scores                                  │   │
│  │   • Usage anomalies & churn risk                        │   │
│  │   • Negative margin customers                           │   │
│  │                                                         │   │
│  │   [Connect Data →]        [Try Sample Data]             │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### With Data — Tabs

**Visible tabs (P0):**
1. SaaS Metrics
2. Plan Health
3. Usage Anomalies
4. Negative Margin

**Hidden tabs (P1/P2):**
- Price Experiments
- Bundling
- Cohorts

### SaaS Metrics Tab

```
┌─────────────────────────────────────────────────────────────────┐
│  Pricing Model Analyzer                                         │
│                                                                 │
│  [30 customers]  [4 plans]  [Source: Sample Data]  [Dec 2024 ▼] │
│                                                                 │
│  SaaS Metrics | Plan Health | Usage Anomalies | Negative Margin │
│  ━━━━━━━━━━━━━                                                  │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐│
│  │ ARR         │ │ MRR         │ │ AI COSTS    │ │ MARGIN     ││
│  │ $132,840    │ │ $11,070     │ │ $6,200   ⚠️ │ │ 44%   🔻   ││
│  │             │ │ ▲2.5% MoM   │ │ ▲15% MoM    │ │ -22pts     ││
│  └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘│
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ⚠️ Margin Alert                                         │   │
│  │                                                         │   │
│  │ Costs growing 2x faster than revenue. Margins dropped   │   │
│  │ 22 points in 6 months (66% → 44%). At this rate,        │   │
│  │ you'll be unprofitable by Q2.                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────────┐│
│  │ CUSTOMERS   │ │ ARPU        │ │ NRR         │ │ AVG LTV    ││
│  │ 30          │ │ $369        │ │ 104%        │ │ $4,428     ││
│  │ +2 new      │ │             │ │             │ │            ││
│  └─────────────┘ └─────────────┘ └─────────────┘ └────────────┘│
│                                                                 │
│  MRR Movement                                                   │
│  ┌──────────┬──────────┬────────────┬──────────┬──────────┐    │
│  │ New      │ Expansion│ Contraction│ Churned  │ Net New  │    │
│  │ +$448    │ +$199    │ -$99       │ -$199    │ =$349    │    │
│  │ (green)  │ (blue)   │ (orange)   │ (red)    │ (primary)│    │
│  └──────────┴──────────┴────────────┴──────────┴──────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Plan Health Tab

```
┌─────────────────────────────────────────────────────────────────┐
│  Plan Health                                                    │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Plan       │Health│Cust│Total MRR│Avg MRR│Churn│Upsell│Neg│ │
│  ├────────────┼──────┼────┼─────────┼───────┼─────┼──────┼───┤ │
│  │ Enterprise │  85  │  3 │ $5,997  │$1,999 │  0  │  0   │ 1 │ │
│  │ Business   │  72  │  5 │ $2,495  │ $499  │  0  │  1   │ 0 │ │
│  │ Pro        │  68  │ 10 │ $1,990  │ $199  │  2  │  2   │ 1 │ │
│  │ Starter    │  45  │ 12 │  $588   │  $49  │  2  │  0   │ 1 │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Hover on counts to see customer names                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Usage Anomalies Tab

```
┌─────────────────────────────────────────────────────────────────┐
│  Usage Anomalies                                                │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Customer          │ Plan   │ Usage │ Description   │Status │ │
│  ├───────────────────┼────────┼───────┼───────────────┼───────┤ │
│  │ Globex Ltd        │ Pro    │  23%  │ ▼45% 3 months │ Churn │ │
│  │ Initech           │ Pro    │  31%  │ ▼32% 3 months │ Churn │ │
│  │ Umbrella Co       │ Starter│  18%  │ ▼28% 3 months │ Churn │ │
│  │ Wonka Industries  │ Starter│   4%  │ Near zero     │ Churn │ │
│  │ Stark Industries  │ Pro    │  94%  │ Near limit    │Upsell │ │
│  │ Wayne Enterprises │ Business│ 89%  │ Near limit    │Upsell │ │
│  │ Aperture Science  │ Pro    │ 112%  │ Over limit    │Upsell │ │
│  │ Cyberdyne         │ Business│ 340% │ Nov spike     │Anomaly│ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Summary:                                                       │
│  • 4 customers declining (churn risk) — $546 MRR at risk       │
│  • 3 customers at/over limits (upsell ready) — ~$600 potential │
│  • 1 unusual spike — investigate                                │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Negative Margin Tab

```
┌─────────────────────────────────────────────────────────────────┐
│  Negative Margin Customers                                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ ⚠️ 3 customers costing more than they pay               │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌────────────────────────────────────────────────────────────┐ │
│  │ Customer      │ Plan       │  MRR   │ Costs  │Margin│Reason│ │
│  ├───────────────┼────────────┼────────┼────────┼──────┼──────┤ │
│  │ Acme Corp     │ Enterprise │ $1,999 │ $2,400 │ -20% │ API  │ │
│  │ DataFlow Inc  │ Pro        │  $199  │  $340  │ -71% │Tokens│ │
│  │ TinyStartup   │ Starter    │   $49  │   $85  │ -73% │ API  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  Total at-risk MRR: $2,247                                      │
│  Net loss from these customers: -$578/mo                        │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  🔍 These margins are estimates                         │   │
│  ├─────────────────────────────────────────────────────────┤   │
│  │                                                         │   │
│  │  Costs are allocated proportionally by revenue.         │   │
│  │  You don't actually know:                               │   │
│  │                                                         │   │
│  │  • True cost-to-serve for each customer                 │   │
│  │  • Which features are driving the cost                  │   │
│  │  • Whether to raise prices, add limits, or cut features │   │
│  │                                                         │   │
│  │  This requires tracking usage at the feature level.     │   │
│  │  That's what Tanso does.                                │   │
│  │                                                         │   │
│  │  [Become a Design Partner]        [Learn More]          │   │
│  │                                                         │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Sample Data Specification

### Overview

| Metric | Value |
|--------|-------|
| Customers | 30 |
| Plans | 4 |
| Months of data | 6 (Jul–Dec 2024) |
| Total MRR | $11,070 |
| Total ARR | $132,840 |
| Margin trend | 66% → 44% (declining) |

### Stories the Data Tells

| Insight | Evidence in Data |
|---------|------------------|
| Margin compression | Costs +94% over 6mo, revenue +18% |
| Negative margins | 3 customers unprofitable |
| Concentration risk | Top 3 = 40% of revenue |
| Churn risk | 4 customers with declining usage |
| Upsell opportunity | 3 customers at/over limits |
| Plan health variance | Enterprise 85, Starter 45 |
| Usage anomaly | 1 customer with 340% spike |

---

### revenue.csv

```csv
customer_id,customer_name,email,plan,mrr,status,started_at
cust_001,Acme Corp,billing@acme.com,enterprise,1999,active,2024-03-15
cust_002,MegaCorp,accounts@megacorp.io,enterprise,1999,active,2024-02-01
cust_003,BigBank,procurement@bigbank.com,enterprise,1999,active,2024-04-10
cust_004,Wayne Enterprises,bruce@wayne.co,business,499,active,2024-05-20
cust_005,Stark Industries,tony@stark.io,business,499,active,2024-04-01
cust_006,Cyberdyne,orders@cyberdyne.net,business,499,active,2024-06-15
cust_007,Oscorp,norman@oscorp.com,business,499,active,2024-03-01
cust_008,Umbrella Co,finance@umbrella.co,business,499,active,2024-07-01
cust_009,Globex Ltd,ap@globex.com,pro,199,active,2024-05-01
cust_010,Initech,billing@initech.com,pro,199,active,2024-06-01
cust_011,Hooli,gavin@hooli.xyz,pro,199,active,2024-04-15
cust_012,Pied Piper,richard@piedpiper.com,pro,199,active,2024-03-20
cust_013,Aviato,erlich@aviato.com,pro,199,active,2024-05-10
cust_014,DataFlow Inc,cfo@dataflow.io,pro,199,active,2024-07-01
cust_015,Aperture Science,glados@aperture.net,pro,199,active,2024-06-20
cust_016,Black Mesa,freeman@blackmesa.gov,pro,199,active,2024-04-01
cust_017,Soylent Corp,green@soylent.com,pro,199,active,2024-08-01
cust_018,Tyrell Corp,roy@tyrell.io,pro,199,active,2024-07-15
cust_019,TinyStartup,founder@tinystartup.co,starter,49,active,2024-08-01
cust_020,Bootstrapped Inc,solo@bootstrapped.io,starter,49,active,2024-07-20
cust_021,SideProject LLC,nights@sideproject.dev,starter,49,active,2024-09-01
cust_022,Wonka Industries,willy@wonka.candy,starter,49,active,2024-06-01
cust_023,Dunder Mifflin,michael@dundermifflin.com,starter,49,active,2024-08-15
cust_024,Paddy's Pub,charlie@paddyspub.com,starter,49,active,2024-09-10
cust_025,Bluth Company,michael@bluthco.com,starter,49,active,2024-07-01
cust_026,Sterling Cooper,don@sterlingcooper.com,starter,49,active,2024-10-01
cust_027,Los Pollos,gus@lospollos.com,starter,49,active,2024-08-20
cust_028,Prestige Worldwide,brennan@prestige.biz,starter,49,active,2024-09-15
cust_029,Vandelay Industries,art@vandelay.com,starter,49,active,2024-10-10
cust_030,Rekall Inc,quaid@rekall.mars,starter,49,active,2024-11-01
```

---

### costs.csv

```csv
month,provider,cost
2024-07,openai,2800
2024-07,anthropic,400
2024-08,openai,3100
2024-08,anthropic,500
2024-09,openai,3500
2024-09,anthropic,600
2024-10,openai,4100
2024-10,anthropic,700
2024-11,openai,4600
2024-11,anthropic,800
2024-12,openai,5200
2024-12,anthropic,1000
```

**Cost Growth Story:**
| Month | Total Cost | MRR | Margin |
|-------|------------|-----|--------|
| Jul | $3,200 | $9,400 | 66% |
| Aug | $3,600 | $9,800 | 63% |
| Sep | $4,100 | $10,200 | 60% |
| Oct | $4,800 | $10,500 | 54% |
| Nov | $5,400 | $10,800 | 50% |
| Dec | $6,200 | $11,070 | 44% |

---

### usage.csv

```csv
month,customer_id,metric,value,limit
2024-12,cust_001,api_calls,48000,50000
2024-12,cust_001,tokens,12000000,10000000
2024-12,cust_002,api_calls,42000,50000
2024-12,cust_002,tokens,8500000,10000000
2024-12,cust_003,api_calls,38000,50000
2024-12,cust_003,tokens,7200000,10000000
2024-12,cust_004,api_calls,22000,25000
2024-12,cust_004,tokens,4100000,5000000
2024-12,cust_005,api_calls,23500,25000
2024-12,cust_005,tokens,4400000,5000000
2024-12,cust_006,api_calls,8500,25000
2024-12,cust_006,tokens,1200000,5000000
2024-12,cust_007,api_calls,18000,25000
2024-12,cust_007,tokens,3200000,5000000
2024-12,cust_008,api_calls,4500,25000
2024-12,cust_008,tokens,800000,5000000
2024-12,cust_009,api_calls,2300,10000
2024-12,cust_009,tokens,420000,2000000
2024-12,cust_010,api_calls,3100,10000
2024-12,cust_010,tokens,580000,2000000
2024-12,cust_011,api_calls,7200,10000
2024-12,cust_011,tokens,1400000,2000000
2024-12,cust_012,api_calls,8100,10000
2024-12,cust_012,tokens,1650000,2000000
2024-12,cust_013,api_calls,6800,10000
2024-12,cust_013,tokens,1280000,2000000
2024-12,cust_014,api_calls,9200,10000
2024-12,cust_014,tokens,2100000,2000000
2024-12,cust_015,api_calls,11200,10000
2024-12,cust_015,tokens,2400000,2000000
2024-12,cust_016,api_calls,7500,10000
2024-12,cust_016,tokens,1520000,2000000
2024-12,cust_017,api_calls,5400,10000
2024-12,cust_017,tokens,980000,2000000
2024-12,cust_018,api_calls,6100,10000
2024-12,cust_018,tokens,1150000,2000000
2024-12,cust_019,api_calls,1800,2000
2024-12,cust_019,tokens,380000,500000
2024-12,cust_020,api_calls,1200,2000
2024-12,cust_020,tokens,240000,500000
2024-12,cust_021,api_calls,1400,2000
2024-12,cust_021,tokens,290000,500000
2024-12,cust_022,api_calls,80,2000
2024-12,cust_022,tokens,15000,500000
2024-12,cust_023,api_calls,1100,2000
2024-12,cust_023,tokens,210000,500000
2024-12,cust_024,api_calls,950,2000
2024-12,cust_024,tokens,180000,500000
2024-12,cust_025,api_calls,1300,2000
2024-12,cust_025,tokens,265000,500000
2024-12,cust_026,api_calls,800,2000
2024-12,cust_026,tokens,150000,500000
2024-12,cust_027,api_calls,1050,2000
2024-12,cust_027,tokens,195000,500000
2024-12,cust_028,api_calls,720,2000
2024-12,cust_028,tokens,135000,500000
2024-12,cust_029,api_calls,680,2000
2024-12,cust_029,tokens,125000,500000
2024-12,cust_030,api_calls,420,2000
2024-12,cust_030,tokens,78000,500000
2024-11,cust_006,api_calls,2500,25000
2024-10,cust_006,api_calls,2200,25000
2024-09,cust_006,api_calls,2000,25000
2024-11,cust_009,api_calls,3800,10000
2024-10,cust_009,api_calls,4200,10000
2024-09,cust_009,api_calls,4800,10000
2024-11,cust_010,api_calls,4200,10000
2024-10,cust_010,api_calls,4600,10000
2024-09,cust_010,api_calls,5100,10000
2024-11,cust_008,api_calls,5200,25000
2024-10,cust_008,api_calls,5800,25000
2024-09,cust_008,api_calls,6200,25000
2024-11,cust_022,api_calls,120,2000
2024-10,cust_022,api_calls,280,2000
2024-09,cust_022,api_calls,650,2000
```

---

### Customer Profiles

#### Negative Margin Customers

| Customer | Plan | MRR | Est. Cost | Margin | Reason |
|----------|------|-----|-----------|--------|--------|
| Acme Corp | Enterprise | $1,999 | $2,400 | -20% | Token overages (12M vs 10M limit) |
| DataFlow Inc | Pro | $199 | $340 | -71% | Heavy token usage (2.1M vs 2M limit) |
| TinyStartup | Starter | $49 | $85 | -73% | Surprisingly heavy API usage |

#### Churn Risk Customers

| Customer | Plan | Usage Trend | Current Usage | Signal |
|----------|------|-------------|---------------|--------|
| Globex Ltd | Pro | ▼45% over 3mo | 23% of limit | Declining fast |
| Initech | Pro | ▼32% over 3mo | 31% of limit | Declining |
| Umbrella Co | Business | ▼28% over 3mo | 18% of limit | Declining |
| Wonka Industries | Starter | ▼88% over 3mo | 4% of limit | Nearly churned |

#### Upsell Ready Customers

| Customer | Plan | Usage | Signal |
|----------|------|-------|--------|
| Stark Industries | Business | 94% of limit | Near limit, growing |
| Wayne Enterprises | Business | 89% of limit | Near limit |
| Aperture Science | Pro | 112% of limit | Over limit |

#### Anomaly

| Customer | Plan | Signal |
|----------|------|--------|
| Cyberdyne | Business | 340% usage spike in November (was 2.5K, jumped to 8.5K) |

#### Concentration Risk

| Customer | MRR | % of Total |
|----------|-----|------------|
| Acme Corp | $1,999 | 18.1% |
| MegaCorp | $1,999 | 18.1% |
| BigBank | $1,999 | 18.1% |
| **Top 3 Total** | **$5,997** | **54.2%** |

---

## Navigation Changes

### Sidebar

```
┌─────────────────────────┐
│  🔲 Tanso               │
│                         │
│  [↑ Your Data]          │
│                         │
│  📊 Dashboard           │
│  👥 Accounts            │
│  💰 Pricing      ←───── Analysis lives here
│  📁 Projects            │
│  🔌 Data Sources ←───── Data entry lives here
│                         │
└─────────────────────────┘
```

### Hidden (P1 scope)
- Matches tab and page
- Price Experiments tab
- Bundling tab
- Cohorts tab

---

## Implementation Checklist

### Phase 1: Navigation & Cleanup
- [ ] Hide Matches from sidebar and router
- [ ] Hide Price Experiments, Bundling, Cohorts tabs
- [ ] Remove upload UI from Pricing page
- [ ] Add empty state to Pricing page

### Phase 2: Data Sources Redesign
- [ ] Add "Try Sample Data" hero section
- [ ] Reorganize into Revenue / AI Costs / Usage sections
- [ ] Add API key connect modals (Stripe, OpenAI, Anthropic)
- [ ] Add CSV upload option per section
- [ ] Add template download links
- [ ] Add Coming Soon section with "Notify me"

### Phase 3: Sample Data
- [ ] Create revenue.csv with 30 customers
- [ ] Create costs.csv with 6 months data
- [ ] Create usage.csv with trends and anomalies
- [ ] Wire "Try Sample Data" button to load all three
- [ ] Redirect to Pricing page after load

### Phase 4: Pricing Analyzer Enhancements
- [ ] Add margin cards to SaaS Metrics (when cost data present)
- [ ] Add margin alert banner
- [ ] Add gap callout to Negative Margin tab
- [ ] Add month selector dropdown

### Phase 5: Polish
- [ ] Interest capture modals for Coming Soon
- [ ] Integration request modal
- [ ] Design partner CTA links

---

## Out of Scope (P0)

- Account matching functionality
- Salesforce / HubSpot / QuickBooks integrations
- Price Experiments features
- Bundling analysis
- Cohort analysis
- Per-customer cost tracking (this is the Tanso Core pitch)
- Stripe OAuth (using API key instead)
- User authentication / accounts
- Payment / subscription management

---

## Success Criteria

| Metric | Target |
|--------|--------|
| Time from landing to first insight | < 5 minutes |
| Sample data → "wow" moment | < 30 seconds |
| Users who explore all 4 tabs | > 50% |
| Users who click "Become Design Partner" | Track volume |
| Users who request integration notification | Track volume |
| Design partner conversions | 3-5 |
