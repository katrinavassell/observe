# Pricing Simulator

Model pricing changes against real customer data before you commit.

## Why Simulate

Changing prices is high-stakes:
- Raise too much → customers churn
- Raise too little → you leave money on the table
- Change the wrong feature → profitable customers subsidize unprofitable ones

The simulator lets you see the impact before you ship.

## Pricing Opportunities

Before you even create a simulation, Observe auto-detects opportunities from your data:

| Opportunity | What Triggered It | Suggested Action |
|-------------|-------------------|------------------|
| **Negative margin** | A feature has margin < 0% | Raise price or reduce cost |
| **Underpriced** | A feature has margin below 20% | Consider price increase |
| **Tiering opportunity** | High-volume feature with flat pricing | Add graduated tiers |

These appear as a banner on the Simulations page. Click "Simulate" on any opportunity to pre-fill the wizard.

## Creating a Simulation

### Step 1: Define

- **Name** your simulation (e.g., "Q2 API pricing increase")
- **Select segment** — all customers, or filter by plan, margin status, etc.
- **Date range** — the period to analyze
- Preview shows: customer count, total MRR, average margin for the segment

### Step 2: Build Scenarios

You always start with a **Baseline** scenario (current pricing). Then add 1–3 alternatives:

| Change Type | Example |
|-------------|---------|
| Percentage increase | "Raise all prices 15%" |
| Percentage decrease | "Discount 10% for annual contracts" |
| Flat monthly | "Set base fee to $49/mo" |
| Per unit | "Charge $0.002 per API call" |

Each scenario shows projected revenue and margin as you configure it.

### Step 3: Review & Run

See all scenarios side-by-side before committing. Click **Run Simulation** to calculate full customer-level impact.

## Reading Results

### Hero Metrics
Top-level numbers for the simulation:
- Total revenue change
- Average margin change
- Number of customers at churn risk

### Scenario Comparison Table

Side-by-side view of all scenarios with:
- Revenue, margin, churn risk count
- Badges: `highest_revenue`, `best_margin`, `lowest_risk`

### Customer Impact Tab

Per-customer breakdown:

| Column | Description |
|--------|-------------|
| Customer | Name |
| Current MRR | What they pay now |
| New MRR | What they'd pay under the scenario |
| Change % | Price increase/decrease for this customer |
| Current Margin | Their margin today |
| New Margin | Projected margin under new pricing |
| Churn Risk | `high`, `medium`, or `low` |

**Churn risk is calculated from:**
- Price increase > 20% → high risk
- Margin < 0% → high risk
- Month-to-month contract → high risk
- Price increase 10–20% or margin < 30% → medium risk
- Everything else → low risk

### Feature Analysis Tab

Per-feature margin impact:

| Column | Description |
|--------|-------------|
| Feature | Feature key |
| Current Price | Price per unit today |
| New Price | Price under this scenario |
| Volume | Usage volume |
| Current Margin | Today's margin |
| New Margin | Projected margin |
| Status | `negative` / `low` / `profitable` / `high` |

## Rollout

Once you've picked a winning scenario:

1. Click **Roll Out** on the scenario
2. The simulation status changes to `rolled_out`
3. Timestamp is recorded

This is a **decision record**, not an automated price change. You implement the actual price change in your billing system (Stripe, etc.) separately.

To track the impact: re-import your data after the change takes effect and compare the new margins against your simulation projections.

## Supported Pricing Models

| Model | Description |
|-------|-------------|
| `per_unit` | Flat rate per unit of usage |
| `graduated` | Different rates for different usage tiers |
| `volume` | Price based on total volume (all units at one rate) |
| `package` | Bundles of units at a fixed price |
| `matrix` | Price varies by one dimension (e.g., region) |
| `fixed` | Flat monthly/annual fee |
| `percentage_plus_fixed` | Fintech-style: 2.9% + $0.30 per transaction |
| `matrix_2d` | Two-dimensional pricing (e.g., context_window × input/output for AI models) |
