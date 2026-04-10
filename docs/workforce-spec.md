# AI Workforce — Visual System Spec

## The 5 Agents (mapped to existing backend)

| Agent | Job | Backend Source | Icon |
|---|---|---|---|
| **Margin** | Finds underwater customers, eroding margins | `computeRecommendations()` | TrendingDown |
| **Spike** | Cost anomalies, usage velocity | Alert rule engine (17 metrics) | Zap |
| **Concentration** | Provider/customer/model dependency risk | Alert metrics | PieChart |
| **Pricing** | Underpriced features, repricing signals | Insights + feature P&L | DollarSign |
| **Health** | Churn risk, expansion signals, adoption | New — usage trend scoring | HeartPulse |

## Workforce Dashboard Layout

```
+------------------------------------------------------------------+
|  Your Workforce                              [Last run: 3m ago]  |
+------------------------------------------------------------------+
|  [Margin: 2 found] [Spike: idle] [Concentration: 1 alert]       |
|  [Pricing: locked]  [Health: locked]                              |
+------------------------------------------------------------------+
|  Findings Feed (newest first)                                     |
|                                                                   |
|  [Margin]  customer_acme margin -12%              2h ago         |
|            847 events, $423 cost, $372 revenue                   |
|            [Route to cheaper model]  [Dismiss]                   |
|                                                                   |
|  [Concentration]  84% of compute through OpenAI   overnight      |
|            One outage kills your product.                         |
|            [View Routing]  [Dismiss]                              |
+------------------------------------------------------------------+
|  Chat (collapsed, expandable)                                     |
|  Ask your workforce anything...                    [Send]        |
+------------------------------------------------------------------+
```

## Agent Status States

| State | Meaning | Visual |
|---|---|---|
| Idle | No new findings | Gray, muted, 40% opacity icon |
| Working | Analysis running | Loader2 animate-spin, progress text, border pulse |
| Found something | New pending findings | Primary tint, count badge, dot indicator |
| Alert | Critical finding | Red tint, pulsing dot, destructive badge |
| Celebrating | Action taken, metric improved | Green tint, brief appearance |

## Progressive Unlock

| Tier | Agents |
|---|---|
| Cloud Free | Margin + Spike |
| Cloud Growth | + Concentration + Pricing |
| Enterprise/Tanso | + Health + autonomous actions + custom configs |
| Data-gated | Health needs revenue data. Pricing needs 2+ features. |

Locked agents show: "Connect revenue data to activate" — creates onboarding loop.

## Build Priority (4 days total)

1. Agent status cards on workforce page (1 day)
2. Findings feed from recommendations table (1 day)
3. Sidebar unseen-findings badge (2 hours)
4. Working state with progress text (half day)
5. Progressive disclosure / locked cards (half day)
6. Chat panel at bottom of workforce page (half day)
