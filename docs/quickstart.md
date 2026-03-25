# Quickstart

Get Observe running and see your first analytics in under 5 minutes.

## 1. Start the App

### Docker (fastest)

```bash
git clone https://github.com/tansohq/metrics-onboarding.git
cd metrics-onboarding
docker compose up
```

Open `http://localhost:3000`.

### Local Development

```bash
git clone https://github.com/tansohq/metrics-onboarding.git
cd metrics-onboarding
npm install
cp .env.example .env
# Edit .env with your DATABASE_URL and SESSION_SECRET
npm run dev
```

Open `http://localhost:5173`.

## 2. Create an Account

Sign up with email and password. Or click **Try Demo** to explore with sample data without an account.

## 3. Load Data

Go to **Data Sources** in the sidebar. You have several options:

### Option A: Sample Data (fastest)
Click **Load Sample Data**. This creates customers, plans, features, and months of history with AI model cost data. You'll have a fully populated dashboard in seconds.

### Option B: Connect an AI Provider
Connect your OpenAI or Anthropic API key to automatically pull usage and cost data from your provider.

### Option C: Upload CSVs
Upload your own data files:

- **Revenue CSV** -- customers, plans, subscriptions
- **Cost CSV** -- infrastructure and AI model costs
- **Usage CSV** -- per-feature usage volumes

The column mapper helps you map your columns to Observe's schema.

### Option D: Connect Stripe
Sync your customers, subscriptions, and plans from Stripe for revenue data.

## 4. Explore Your Data

Once data is loaded, check these pages:

- **Analytics** (home) -- revenue, costs, and margin overview
- **Events** -- browse the raw event stream
- **Models** -- see which AI models cost the most
- **Alerts** -- set up threshold-based cost alerts

## 5. Set Up Alerts

Go to **Alerts** and create rules to get notified when costs exceed thresholds. Alerts can send email notifications (requires Resend API key in `.env`).

## 6. Integrate Your App

For production use, integrate Observe into your app:

- **Proxy mode** -- point your OpenAI/Anthropic client at Observe's URL
- **SDK** -- `npm install @tanso/observe` and call `tanso.track()`
- **HTTP API** -- `POST /events/ingest` with an SDK key

See the main [README](../README.md) for integration examples.

## Next Steps

- [Connecting Data Sources](./data-sources.md) -- detailed guide for each import method
- [Feature Economics](./feature-economics.md) -- understanding margin analysis
- [Events API](./api/events.md) -- query events programmatically
