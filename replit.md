# Tanso - Pricing Analytics Dashboard

## Overview
Tanso is a Vue.js 3 pricing analytics dashboard application for SaaS businesses. It helps analyze pricing data, subscriptions, and revenue metrics.

## Project Structure
- `src/` - Vue.js application source code
  - `components/` - Reusable Vue components organized by feature
  - `composables/` - Vue composables for shared logic (useAuth, useDataMode)
  - `lib/` - Utility libraries and API clients
  - `pages/` - Page components
  - `types/` - TypeScript type definitions
- `server/` - Express.js backend API
  - `index.ts` - Main server file with auth and data endpoints
- `public/` - Static assets
- `docs/` - Project documentation

## Tech Stack
- Vue.js 3 with Composition API
- TypeScript
- Vite (build tool)
- TailwindCSS for styling
- Express.js backend with PostgreSQL (Replit's built-in database)
- Session-based authentication with bcrypt password hashing
- Chart.js for data visualization
- Radix Vue for UI components

## Database
Uses Replit's built-in PostgreSQL with the following tables:
- users - User accounts with email/password
- sessions - Session management
- customers - Customer data
- subscriptions - Subscription records
- plans - Pricing plans
- usage_records - Usage metrics
- cost_records - Cost tracking
- user_data_status - Tracks data mode (sample/user/none)
- observe_events - Feature-level usage events with cost/revenue/model attribution (dual-written from all upload flows)

## Development
- `npm run dev` - Runs both frontend (port 5000) and backend (port 3001) concurrently
- `npm run dev:frontend` - Frontend only
- `npm run dev:backend` - Backend only
- Frontend uses Vite proxy to route /api/* to backend

## API Endpoints
- GET /api/session/init - Initialize anonymous session
- GET /api/data/status - Get data status
- GET /api/data/analyzer - Get all data for pricing analyzer
- POST /api/data/sample - Load sample data
- DELETE /api/data/clear - Clear user data
- POST /api/data/upload/costs - Upload cost records from CSV
- POST /api/data/upload/usage - Upload usage records from CSV
- POST /api/data/upload/revenue - Upload revenue data (customers, plans, subscriptions)
- GET /api/customers - List customers
- GET /api/customers/:id/detail - Enriched customer detail with feature events
- GET /api/subscriptions - List subscriptions
- GET /api/plans - List plans
- GET /api/usage - List usage records
- GET /api/costs - List cost records
- GET /api/metrics/summary - Get MRR/ARR metrics
- GET /api/events - Paginated observe_events (filters: feature_key, customer_id, model)
- GET /api/features - Per-feature aggregated cost/revenue/margin stats
- GET /api/features/:key - Feature detail with by-customer and by-model breakdown
- GET /api/models - Per-model aggregated cost/revenue/margin stats

## Pages
- `/` - Pricing Analyzer (margin analysis)
- `/simulator` - What-if pricing simulator
- `/events` - All feature usage events with cost/revenue/margin
- `/features` - Feature economics list with margin badges
- `/features/:key` - Feature detail (by customer, by model, recent events)
- `/models` - AI model cost breakdown
- `/customers` - Customer list with search and segment filter
- `/customers/:id` - Customer detail with feature usage and events
- `/data-sources` - Connect integrations or upload CSV files

## Shared Components
- `src/components/shared/MarginBadge.vue` - Color-coded margin percentage badge
- `src/components/shared/TrendIndicator.vue` - Up/down/stable trend arrow with value

## Recent Changes
- 2026-03-19: Feature Economics Dashboard (Task #1)
  - Added observe_events table with 5 indexes for feature-level cost/revenue tracking
  - Dual-write from all upload endpoints (costs, usage, revenue) and sample data
  - Added 6 new API endpoints (events, features, feature detail, models, customer detail)
  - Added 6 new pages (Events, Features, FeatureDetail, Models, Customers, CustomerDetail)
  - Added MarginBadge and TrendIndicator shared components
  - Updated sidebar navigation with all new routes
- 2026-01-05: Migrated all upload flows from Supabase to Express backend
  - Added backend endpoints for costs, usage, and revenue uploads
  - Updated useStripeUpload composable to use new API
  - Updated CostsSection and UsageSection components
  - All data operations now use session-based anonymous auth
- 2026-01-05: Removed login/signup requirements
  - Users can now use the app without creating an account
  - Anonymous sessions automatically created for each visitor
  - Data is stored per-session for 30 days
  - Removed Sign Out button from sidebar
- 2026-01-05: Migrated from Supabase to Replit's built-in PostgreSQL
  - Created Express.js backend with anonymous session support
  - Updated frontend composables to use new API
  - Set Vite to use port 5000 with host 0.0.0.0
  - Added allowedHosts: true for Replit proxy compatibility
