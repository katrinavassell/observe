# Tanso - Pricing Analytics Dashboard

## Overview
Tanso is a Vue.js 3 pricing analytics dashboard application for SaaS businesses. It helps analyze pricing data, subscriptions, and revenue metrics through Stripe integration.

## Project Structure
- `src/` - Vue.js application source code
  - `components/` - Reusable Vue components organized by feature
  - `composables/` - Vue composables for shared logic
  - `lib/` - Utility libraries and API clients
  - `pages/` - Page components
  - `types/` - TypeScript type definitions
- `supabase/` - Supabase edge functions and database schema
- `public/` - Static assets
- `docs/` - Project documentation

## Tech Stack
- Vue.js 3 with Composition API
- TypeScript
- Vite (build tool)
- TailwindCSS for styling
- Supabase for backend/auth
- Chart.js for data visualization
- Radix Vue for UI components

## Environment Variables Required
- `VITE_SUPABASE_URL` - Supabase project URL
- `VITE_SUPABASE_ANON_KEY` - Supabase anonymous key

## Development
- Frontend runs on port 5000
- Development server: `npm run dev`
- Backend dev server for Stripe: `node dev-server.cjs` (port 8000)

## Recent Changes
- 2026-01-05: Configured for Replit environment
  - Set Vite to use port 5000 with host 0.0.0.0
  - Added allowedHosts: true for Replit proxy compatibility
  - Made Supabase initialization graceful when credentials missing
