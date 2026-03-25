# Observe Documentation

Developer docs for Observe -- AI cost observability for SaaS companies.

## Guides

- [Quickstart](./quickstart.md) -- Get running in 5 minutes
- [Connecting Data Sources](./data-sources.md) -- AI providers, Stripe, CSV uploads, SDK
- [Feature Economics](./feature-economics.md) -- Understanding margins and the analytics dashboard
- [Pricing Simulator](./simulator.md) -- Model pricing changes before you ship
- [AI Insights](./ai-insights.md) -- AI-powered margin analysis

## API Reference

- [API Overview](./API.md) -- All backend endpoints
- [Events API](./api/events.md) -- Ingest and query events
- [Features API](./api/features.md) -- Feature aggregations
- [Customers API](./api/customers.md) -- Customer data and margins
- [Models API](./api/models.md) -- AI model cost tracking
- [Simulations API](./api/simulations.md) -- Create and manage pricing simulations
- [Insights API](./api/insights.md) -- Generate AI-powered insights

## Architecture

- [Architecture Overview](./ARCHITECTURE.md) -- System design, tech stack, data flow
- [Component Reference](./COMPONENTS.md) -- Vue pages, components, composables
- [Database Schema](./DATABASE.md) -- Full table reference

## Concepts

- [Event Schema](./concepts/event-schema.md) -- The `observe_event` data model
- [Margin Calculation](./concepts/margins.md) -- How margins are computed and categorized
- [Data Sources & Granularity](./concepts/data-sources.md) -- How imported data maps to events
