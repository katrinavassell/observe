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

## Development
- `npm run dev` - Runs both frontend (port 5000) and backend (port 3001) concurrently
- `npm run dev:frontend` - Frontend only
- `npm run dev:backend` - Backend only
- Frontend uses Vite proxy to route /api/* to backend

## API Endpoints
- POST /api/auth/register - Create account
- POST /api/auth/login - Login
- POST /api/auth/logout - Logout
- GET /api/auth/me - Get current user
- GET /api/data/status - Get data status
- POST /api/data/sample - Load sample data
- DELETE /api/data/clear - Clear user data
- GET /api/customers - List customers
- GET /api/subscriptions - List subscriptions
- GET /api/plans - List plans
- GET /api/metrics/summary - Get MRR/ARR metrics

## Recent Changes
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
