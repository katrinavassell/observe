# Sample Data for Pricing Analyzer Demo

This data is designed to tell specific stories that demonstrate the value of pricing insights.

## Overview

| Metric | Value |
|--------|-------|
| Customers | 30 |
| Plans | 4 (Enterprise, Business, Pro, Starter) |
| Months of data | 6 (Jul–Dec 2024) |
| Total MRR | $11,070 |
| Total ARR | $132,840 |
| Margin trend | 66% → 44% (declining) |

---

## Stories the Data Tells

### 1. Margin Compression (SaaS Metrics Tab)

**The insight:** Costs are growing 2x faster than revenue. At this rate, unprofitable by Q2.

| Month | Revenue | Costs | Margin |
|-------|---------|-------|--------|
| Jul 2024 | $9,400 | $3,200 | 66% |
| Aug 2024 | $9,800 | $3,600 | 63% |
| Sep 2024 | $10,200 | $4,100 | 60% |
| Oct 2024 | $10,500 | $4,800 | 54% |
| Nov 2024 | $10,800 | $5,400 | 50% |
| Dec 2024 | $11,070 | $6,200 | 44% |

**What the UI should show:**
- Margin card: 44% with ▼22pts indicator
- AI Costs card: $6,200 with ⚠️ warning
- Alert banner: "Costs growing 2x faster than revenue..."

---

### 2. Negative Margin Customers (Negative Margin Tab)

**The insight:** 3 customers are costing more than they pay.

| Customer | Plan | MRR | Est. Cost | Margin | Why |
|----------|------|-----|-----------|--------|-----|
| Acme Corp | Enterprise | $1,999 | ~$2,400 | -20% | Token overages (12M vs 10M limit) |
| DataFlow Inc | Pro | $199 | ~$340 | -71% | Heavy token usage (2.1M vs 2M limit) |
| TinyStartup | Starter | $49 | ~$85 | -73% | Heavy API usage relative to tier |

**What the UI should show:**
- Table with these 3 customers highlighted
- Total at-risk MRR: $2,247
- Net loss: -$578/mo
- Gap callout explaining this is estimated, Tanso provides true cost-to-serve

---

### 3. Churn Risk (Usage Anomalies Tab)

**The insight:** 4 customers show declining usage patterns → likely to churn.

| Customer | Plan | Current Usage | Trend | Signal |
|----------|------|---------------|-------|--------|
| Globex Ltd | Pro | 23% of limit | ▼45% over 3 months | Declining fast |
| Initech | Pro | 31% of limit | ▼32% over 3 months | Declining |
| Umbrella Co | Business | 18% of limit | ▼28% over 3 months | Declining |
| Wonka Industries | Starter | 4% of limit | ▼88% over 3 months | Nearly churned |

**Historical data in usage.csv:**
- cust_009 (Globex): Sep 4800 → Oct 4200 → Nov 3800 → Dec 2300
- cust_010 (Initech): Sep 5100 → Oct 4600 → Nov 4200 → Dec 3100
- cust_008 (Umbrella): Sep 6200 → Oct 5800 → Nov 5200 → Dec 4500
- cust_022 (Wonka): Sep 650 → Oct 280 → Nov 120 → Dec 80

**What the UI should show:**
- Status column showing "Churn Risk"
- MRR at risk: $546

---

### 4. Upsell Opportunities (Usage Anomalies Tab)

**The insight:** 3 customers are at or over their limits → ready to upgrade.

| Customer | Plan | Usage % | Signal |
|----------|------|---------|--------|
| Stark Industries | Business | 94% | Near limit, growing |
| Wayne Enterprises | Business | 89% | Near limit |
| Aperture Science | Pro | 112% | Over limit |

**What the UI should show:**
- Status column showing "Upsell Ready"
- Potential revenue: ~$600/mo if upgraded

---

### 5. Usage Anomaly (Usage Anomalies Tab)

**The insight:** Cyberdyne had a 340% spike in November.

| Customer | Plan | Pattern |
|----------|------|---------|
| Cyberdyne | Business | Was ~2,500 API calls, jumped to 8,500 in Dec |

**Historical data:**
- Sep: 2000 → Oct: 2200 → Nov: 2500 → Dec: 8500 (spike!)

**What the UI should show:**
- Status column showing "Anomaly"
- Investigation prompt

---

### 6. Plan Health Variance (Plan Health Tab)

**The insight:** Higher-tier plans are healthier than lower-tier.

| Plan | Health Score | Customers | Total MRR | Churn Risk | Upsell | Negative |
|------|--------------|-----------|-----------|------------|--------|----------|
| Enterprise | 85 | 3 | $5,997 | 0 | 0 | 1 |
| Business | 72 | 5 | $2,495 | 1 | 2 | 0 |
| Pro | 68 | 10 | $1,990 | 2 | 1 | 1 |
| Starter | 45 | 12 | $588 | 1 | 0 | 1 |

**What the UI should show:**
- Health scores with color coding
- Hover on counts to see customer names

---

### 7. Concentration Risk (SaaS Metrics Tab)

**The insight:** Top 3 customers = 54% of revenue.

| Customer | MRR | % of Total |
|----------|-----|------------|
| Acme Corp | $1,999 | 18.1% |
| MegaCorp | $1,999 | 18.1% |
| BigBank | $1,999 | 18.1% |
| **Top 3** | **$5,997** | **54.2%** |

---

## Files

| File | Rows | Purpose |
|------|------|---------|
| revenue.csv | 30 | Customer data with plan assignments |
| costs.csv | 12 | Monthly AI provider costs (6 months × 2 providers) |
| usage.csv | 78 | December snapshot + historical trends |
| sample-data.json | 1 | Combined JSON for easy frontend import |

---

## Verification Checklist

After loading sample data, verify these appear in the UI:

- [ ] **SaaS Metrics:** ARR $132,840, MRR $11,070, 30 customers
- [ ] **SaaS Metrics:** AI Costs $6,200, Margin 44%
- [ ] **SaaS Metrics:** Margin alert banner appears
- [ ] **Plan Health:** 4 plans with varying health scores
- [ ] **Usage Anomalies:** 4 churn risk customers listed
- [ ] **Usage Anomalies:** 3 upsell ready customers listed
- [ ] **Usage Anomalies:** 1 anomaly (Cyberdyne) listed
- [ ] **Negative Margin:** 3 customers shown (Acme, DataFlow, TinyStartup)
- [ ] **Negative Margin:** Gap callout with design partner CTA
