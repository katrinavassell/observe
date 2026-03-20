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
- referral_codes - One unique code per visitor (TEXT user_id)
- referrals - Tracks referrer/referred relationships and conversion status
- referral_credits - AI insight credits earned through successful referrals

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
- `/referrals` - Referral program with invite links and credit tracking

## Shared Components
- `src/components/shared/MarginBadge.vue` - Color-coded margin percentage badge
- `src/components/shared/TrendIndicator.vue` - Up/down/stable trend arrow with value

## Team / Organization System
- Organizations table: id, name, owner_visitor_id, created_at
- organization_members table: id, org_id, visitor_id, invited_email, invite_token, role (admin/viewer), status (pending/active), joined_at
- visitor_org_map table: maps each visitor_id to their org_id for data isolation
- Data isolation: When a visitor is in an org, all data queries use the org owner's visitor_id (effectiveUserId)
- Roles: Admin has full access; Viewer is read-only (cannot upload/clear data or manage team)
- Invite flow: Admin generates a shareable invite link → invitee visits /join/:token → accepts → gets mapped to the org

## Team API Endpoints
- GET /api/team - Get org info, members list, and current user's role
- PATCH /api/team/name - Rename the team (admin only)
- POST /api/team/invite - Generate invite link with role (admin only)
- GET /api/team/invite/:token - Get invite info (public)
- POST /api/team/join/:token - Accept invite and join org
- PATCH /api/team/members/:id - Change member role (admin only)
- DELETE /api/team/members/:id - Remove member (admin only)
- GET /api/team/my-role - Get current user's role

## Simulation API Endpoints
- GET /api/simulations - List all simulations for user
- GET /api/simulations/opportunities - Get pricing opportunities based on feature data
- GET /api/simulations/:id - Get simulation detail
- POST /api/simulations - Create new simulation (admin only)
- PUT /api/simulations/:id - Update simulation / run simulation engine (admin only)
- DELETE /api/simulations/:id - Delete simulation (admin only)

## Referral System
- `referral_codes` table: stores one unique code per visitor (user_id UNIQUE, code UNIQUE)
- `referrals` table: tracks referrer/referred relationships (status: pending/converted)
- `referral_credits` table: AI insight credits earned from successful referrals
- `maybeAwardReferralCredit()` called after sample data load and all upload endpoints
- Referral link captured via `?ref=CODE` query param on app load (App.vue)

## Referral API Endpoints
- GET /api/referral/code - Get or create referral code for current user
- POST /api/referral/record - Record a referral when new user arrives via link
- GET /api/referral/stats - Get total/converted/pending referrals and credits earned

## Post-Merge Setup
- Script: `scripts/post-merge.sh` (runs `npm install --legacy-peer-deps`)
- Configured in `.replit` [postMerge] section

## Recent Changes
- 2026-03-20: Tanso monetization integration
  - Created `server/tanso-client.ts` — HTTP wrapper for Tanso MCP endpoint
  - Added `tanso_customers` table, helper functions (getOrCreateTansoCustomer, checkTansoEntitlement, trackTansoUsage)
  - Added 6 new `/tanso/*` API endpoints (plans, features, entitlements, subscription, subscribe, check)
  - Entitlement gating on upload endpoints (csv_upload) and simulation creation (simulation_run)
  - Created `PlansPage.vue` with plan listing, usage tracking, subscription management
  - Created `useEntitlement` composable for per-feature usage checking
  - Created `UsageLimitBanner` shared component for usage progress bars and upgrade prompts
  - Added usage indicators on DataSourcesPage and SimulationsPage
  - Graceful fallback when Tanso API is unreachable (all features allowed, "Billing Not Connected" state)
- 2026-03-20: Referral system (Task #4)
  - Added referral_codes, referrals, referral_credits tables (created at server startup)
  - Added referral API endpoints and maybeAwardReferralCredit helper
  - Added ReferralsPage with how-it-works explainer, link sharing, stats cards
  - Referral code captured via ?ref= query param on app load
- 2026-03-20: UI consistency polish
  - Replaced native HTML form elements with shadcn/UI components across all pages
  - Fixed font-mono → tabular-nums for numeric/currency table cells
  - Modernized Data Sources section headers
  - Fixed Team Settings invite link URL (was localhost:3001)
- 2026-03-20: Pricing Simulator (Task #2)
  - Created simulations table with indexes at server startup
  - Added CRUD + simulation engine endpoints (run calculates projections from observe_events)
  - Added API client functions (listSimulations, getSimulation, createSimulation, updateSimulation, deleteSimulation, getOpportunities)
  - SimulationsPage, SimulationNewPage (3-step wizard), SimulationDetailPage all functional
- 2026-03-20: UI/UX polish for Features and Events pages
  - Redesigned FeaturesPage with clean list layout and horizontal bar charts
  - Redesigned EventsPage with inline filters and polished data table
  - Fixed Radix Select empty-value bug in EventsPage
- 2026-03-19: Added team accounts with Admin/Viewer roles and invite links
  - Created organizations, organization_members, visitor_org_map DB tables
  - Added team management API routes to Express backend
  - Updated ensureVisitor to resolve effectiveUserId (org owner's ID) for data sharing
  - Added requireAdmin middleware for write operations
  - Created TeamSettingsPage with member list, invite form, role management
  - Created JoinTeamPage for invite acceptance flow (/join/:token)
  - Added Team Settings to sidebar navigation
  - Added viewer role banners and disabled upload controls for Viewer role users
  - Added readonly prop to RevenueSection, CostsSection, UsageSection
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
