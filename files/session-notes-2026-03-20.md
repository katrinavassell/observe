# Session Notes — March 20, 2026

## What We Did

### 1. Tanso MCP Setup
- Fixed MCP connection issue (streamable HTTP bug in `WebMvcStreamableServerTransportProvider.handlePost` line 321)
- Doug fixed prod, sandbox still broken
- Added both `tanso-prod` and `tanso-sandbox` to `.mcp.json`

### 2. Pricing Tiers Configured in Tanso
- **Free ($0/mo):** 3 AI insights/mo, 2 simulations/mo, everything else unlimited
- **Pro ($12/mo):** Unlimited everything
- 10 features total created and linked to both plans
- All tracked in Tanso for future pricing decisions

### 3. Stripe Integration
- Registered Stripe API key with Tanso prod
- Set up webhook, switched to STRIPE_DRIVEN mode
- Products sync lazily on first subscription (not immediately)

### 4. Plans Page Redesign
- Fixed $NaN price and "undefined mo" bugs (nested response mapping, string intervalMonths)
- Added pricing cards (Free + Pro) with comparison table
- Highlighted gated features (AI Insights 3/mo, Simulations 2/mo vs Unlimited)

### 5. Stripe Checkout Flow
- Wired "Upgrade to Pro" → createSubscription → get invoice → createCheckoutSession → redirect to Stripe Checkout
- Checkout session is REST-only (no MCP tool exists yet — card for Doug)

### 6. Auto-subscribe on Signup
- New users automatically placed on free plan after account creation

### 7. Dev Environment
- Created `.env.development` for sandbox keys (commented out, using prod for now)
- Server loads `.env` via `import 'dotenv/config'` (ES module hoisting matters)

## Key Decisions
- Gate AI-powered features only (cost money + high value)
- Track everything else ungated for future pricing data
- $12/mo price point — low enough for solo founders
- Monthly resets on free tier create recurring conversion pressure

## MCP vs REST API Distinction
- **MCP:** Set up your product (plans, features, pricing rules, Stripe config) — once/rarely
- **REST API:** Run your product (entitlement checks, subscriptions, events, checkout) — every request
- MCP adds latency (init handshake per call) — don't use for runtime

## Key Learning: MCP vs REST API
- **Started with:** All Tanso calls going through MCP (slow — init handshake per call)
- **Switched to:** REST API for runtime calls (`/api/v1/client/*` endpoints)
- **Result:** Noticeably faster checkout flow and plan loading
- **Rule:** MCP = setup (plans, features, Stripe config). REST = runtime (entitlements, subscriptions, events, checkout)
- **REST responses are wrapped:** `{ success: true, data: {...} }` — extract `.data`

## Checkout Flow (working)
1. `POST /api/v1/client/subscriptions` → returns `{ subscription, invoice }`
2. `POST /api/v1/client/billing/invoices/{invoiceId}/stripe/checkout` → returns `{ url }`
3. Frontend opens URL in new tab → user pays in Stripe Checkout
4. Stripe webhook marks invoice paid → subscription activates → entitlements granted

## Open Items
- Sandbox MCP still broken (Doug needs to deploy fix)
- Add `createCheckoutSession` MCP tool (for Doug)
- Document checkout flow in llms-mcp.txt
- Build pricing page designer and pricing advisor agents

## Files Created/Modified
- `files/pricing-tiers.md` — pricing tier reference doc
- `files/tanso-dogfood-guide.md` — dogfooding guide for marketing/docs
- `.mcp.json` — Tanso MCP connections (prod + sandbox)
- `.env.development` — sandbox keys (commented out)
- `src/pages/PlansPage.vue` — redesigned plans page
- `src/composables/useAuth.ts` — auto-subscribe on signup
- `server/tanso-client.ts` — added checkout session REST call
- `server/index.ts` — checkout flow in subscribe endpoint
