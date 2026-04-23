# Pricing Simulator

Model pricing changes against real customer data before you commit.

> **Note:** The simulator pages (`/simulations`) are currently redirected to the home page. The simulation engine exists in the backend and database but the dedicated UI pages are not yet active. Simulations can still be created and managed via the API.

## Why Simulate

Changing prices is high-stakes:
- Raise too much -- customers churn
- Raise too little -- you leave money on the table
- Change the wrong feature -- profitable customers subsidize unprofitable ones

The simulator lets you see the impact before you ship.

## API Access

Simulations are available via the backend API:

### POST /simulations

Create a new simulation.

### GET /simulations

List existing simulations.

### GET /simulations/:id

Get simulation details and results.

## Data Model

Simulations are stored in the `simulations` table with:

- **Scenarios** -- different pricing configurations to compare
- **Time range** -- the period to analyze
- **Segment** -- which customers to include
- **Results** -- customer impacts, feature analysis, margin changes

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
| `matrix_2d` | Two-dimensional pricing (e.g., context_window x input/output for AI models) |

## Churn Risk Calculation

When a simulation runs, churn risk is estimated per customer:

- Price increase > 20% -- high risk
- Margin < 0% -- high risk
- Month-to-month contract -- high risk
- Price increase 10-20% or margin < 30% -- medium risk
- Everything else -- low risk
