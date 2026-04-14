# Observe Documentation

Developer docs for Observe -- AI cost observability for SaaS companies.

## Getting Started

- [Quickstart](./quickstart.md) -- Get running in 60 seconds
- [Configuration](./configuration.md) -- Environment variable reference
- [Contributing](../CONTRIBUTING.md) -- Set up a dev environment and submit PRs

## Guides

- [Connecting Data Sources](./data-sources.md) -- AI providers, Stripe, CSV uploads, SDK
- [Pricing Simulator](./simulator.md) -- Model pricing changes before you ship
- [AI Insights](./ai-insights.md) -- AI-powered margin analysis

## Integration Guides

- [Next.js](./guides/nextjs.md) -- SDK and wrapper setup in Next.js apps
- [LangChain](./guides/langchain.md) -- Proxy mode and callback tracking with LangChain

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

## Self-Hosting & Operations

- [Self-Hosting Guide](./self-hosting.md) -- Production deployment with Docker, reverse proxy, and database setup
- [Security Model](./security.md) -- Authentication, data isolation, rate limiting, and hardening
- [Upgrading](./upgrading.md) -- How to upgrade between versions
- [Troubleshooting](./troubleshooting.md) -- Common issues and fixes
