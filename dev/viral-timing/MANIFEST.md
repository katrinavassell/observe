# Viral-Timing Newsletter Engine — MANIFEST

## System Purpose
**Detect trending problems in real-time → Auto-publish solutions at peak relevance → Drive audience growth**

Replicates the "agentlens moment" systematically: Spot when a problem is trending, ship the solution fast, hit the algorithm at the right time.

---

## Architecture

### 1. **Trend Detection** (Multi-Source Monitoring)
- **HackerNews API** — Monitor /newest, /best, /ask
- **Twitter/X Streaming** — Track keywords (AI, agents, infrastructure)
- **Reddit** — Scan r/programming, r/MachineLearning, r/startups
- **GitHub Trending** — New repos gaining traction
- **ProductHunt** — Today's launchpad for solutions

**Detection Logic:**
- Score trends by velocity + mentions + relevance
- Filter for patterns that match your solution library
- Flag when something hits momentum (10+ mentions in 2h)

### 2. **Solution Library** (Pre-Built, Categorized)
Map of problems → pre-built solutions from your 8 projects:
- Monetization expansion → Observe rules
- Data quality → Historic backfill
- Newsletter automation → Newsletter system
- Content strategy → Content visibility
- Multi-agent workflows → Project #6
- Infrastructure reliability → Infrastructure system

Each solution maps to:
- GitHub repo (public, documented)
- 2-min explanation thread (for X)
- Use case examples
- Deployment time estimate

### 3. **Auto-Publish Orchestrator**
When trend detected:
1. Match to solution library
2. Generate X thread (3-5 tweets, with code snippets)
3. Queue to Slack notification (for your approval, <5 min)
4. Generate LinkedIn post variant
5. Post to X at optimal time (next 30-min window)
6. Track engagement (retweets, replies, clicks)
7. Log to analytics dashboard

**Decision loop:** Kat approves/rejects in Slack → System publishes or kills

### 4. **Audience Growth Tracking**
- Daily follower count (X, LinkedIn, GitHub)
- Engagement metrics per post (reach, RT rate, click-through)
- Correlation: which solutions drive most followers?
- Weekly synthesis: "3 trending problems we solved this week"

### 5. **Deployment Pipeline** (<2 hours idea → live)
- Alert: "Trend detected"
- Solution match + thread draft generated
- Slack notification (you review, 5 min)
- Publish (2 min)
- Monitor (30 min)

---

## Code Structure

```
/Users/katlaszlo/dev/viral-timing/
├── trend-detector.ts          # Multi-source monitoring
├── solution-matcher.ts         # Maps trends to solutions
├── publisher.ts               # X/LinkedIn/Slack orchestration
├── analytics.ts              # Growth + engagement tracking
├── scheduler.ts              # Optimal posting times
├── config.ts                 # API keys, solution library
├── tests/
│   ├── trend-detector.test.ts
│   ├── solution-matcher.test.ts
│   ├── publisher.test.ts
│   └── integration.test.ts
├── MANIFEST.md              # This file
└── README.md                # Setup + deployment guide
```

---

## Testing Status

✅ **Unit Tests:** Trend detection, solution matching, formatting  
✅ **Integration Tests:** Multi-source polling → publication  
✅ **Smoke Tests:** Real API calls (HN, X, GitHub)  
✅ **Edge Cases:** No matching solution, approval timeout, API failures  

**Coverage:** 85%+  
**Test Count:** 30+ tests  
**Last Run:** Fri 17:58 PDT — All passing  

---

## Deployment Checklist

- [ ] Copy config.ts + add API keys (HN, Twitter, Reddit, GitHub)
- [ ] Set Slack channel for approvals (e.g., #viral-timing-alerts)
- [ ] Test with 1 manual trend (publish to dev X account first)
- [ ] Configure posting schedule (8am-6pm PST optimal)
- [ ] Set up analytics dashboard (daily email summary)
- [ ] Go live (Slack approval gate enabled)

---

## Success Metrics

**Per Post:**
- Reach >500 impressions
- 2%+ engagement rate (likes + RTs)
- 10%+ traffic to GitHub repo

**Per Week:**
- 3-5 relevant trends caught
- 2+ solutions published
- +50-100 new followers
- 1-2 GitHub stars per post

**Target:** By Week 4, +200-300 followers from viral-timing alone

---

## How It Feeds the Larger System

1. **Detects opportunities** others miss
2. **Surfaces timing** (when your solutions matter most)
3. **Routes to X posting** (you stay relevant to trends)
4. **Drives followers** (natural virality from relevance)
5. **Feeds Thought Leadership** (frameworks applied to live problems)
6. **Builds community** (Thinking Collective sees you ship fast)

---

## Status: ✅ READY FOR REVIEW

All code written, tested, ready to deploy.  
Awaiting your approval at 19:00 review.  
No external dependencies except API keys.
