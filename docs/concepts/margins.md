# Margin Calculation

## How Margins Are Computed

Margins are calculated from aggregated `observe_events`:

```
revenue = SUM(revenue_amount) for the scope
cost    = SUM(cost_amount) for the scope
margin  = revenue - cost
margin% = (margin / revenue) × 100
```

"Scope" can be a feature, a customer, a model, or any combination.

## Margin Status Categories

| Status | Margin % | Badge Color | Meaning |
|--------|----------|-------------|---------|
| **Negative** | < 0% | Red | Losing money — costs exceed revenue |
| **Low** | 0–20% | Amber | Barely profitable — vulnerable to cost increases |
| **Profitable** | 20–50% | Green | Healthy margin |
| **High** | > 50% | Blue | Strong margin — room for investment or price reduction |

These thresholds are used consistently across the Features page, Customer page, and Simulator.

## Edge Cases

### No revenue data
If a feature has costs but no revenue (e.g., pure infrastructure costs), margin is calculated as negative. The feature shows as "Negative" status.

### No cost data
If a feature has revenue but no costs (e.g., only Stripe data imported), margin cannot be calculated. The feature shows "—" for margin with a prompt to add cost data.

### Aggregate vs attributed costs
When a cost CSV doesn't include `customer_id`, the costs are stored with `customer_id: '_aggregate'`. These aggregate costs appear on the Features page but are not attributed to individual customers.

To see per-customer margins, include `customer_id` in your cost CSV.

## Blended Cost Allocation

When cost data exists at the aggregate level (no customer attribution), Observe can allocate costs proportionally:

```
customer_cost = (customer_revenue / total_revenue) × total_cost
```

This gives an approximation of per-customer margins when you only have total costs. The allocation method is noted in the UI when displayed.
