# Quickstart

Get Observe running and see your first feature margins in under 5 minutes.

## 1. Open the App

Observe runs on Replit. No account required — you get an anonymous session automatically.

## 2. Load Data

Go to **Data Sources** in the sidebar. You have three options:

### Option A: Sample Data (fastest)
Click **Load Sample Data**. This creates 5 customers, 3 plans, 5 features, and 6 months of history with AI model cost data. You'll have a fully populated dashboard in seconds.

### Option B: Connect Stripe
Click **Connect Stripe** to sync your customers, subscriptions, and plans. This gives you revenue data. To see margins, you'll also need to upload cost data (see Option C).

### Option C: Upload CSVs
Upload your own data files:

- **Revenue CSV** — customers, plans, subscriptions
- **Cost CSV** — infrastructure and AI model costs
- **Usage CSV** — per-feature usage volumes

The column mapper helps you map your columns to Observe's schema.

## 3. Explore Your Margins

Once data is loaded, check these pages:

- **Features** — see which features make or lose money
- **Models** — see which AI models cost the most
- **Customers** — see which customers are profitable
- **Events** — browse the raw event stream

## 4. Run a Simulation

Go to **Simulations** → **New Simulation**:

1. Pick a customer segment and date range
2. Add pricing scenarios (e.g., "raise API pricing 15%")
3. Run it — see revenue impact, margin changes, and churn risk per customer

## 5. Get AI Insights

Click **Generate Insights** to get AI-powered recommendations about your margins, pricing opportunities, and at-risk customers.

## Next Steps

- [Connecting Data Sources](./data-sources.md) — detailed guide for each import method
- [Feature Economics](./feature-economics.md) — understanding the margins dashboard
- [Events API](./api/events.md) — query events programmatically
