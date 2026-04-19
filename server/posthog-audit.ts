import Anthropic from "@anthropic-ai/sdk";
import { trackSelfLLM } from "./lib/track-self-llm.js";

const POSTHOG_HOST = process.env.POSTHOG_HOST || "https://us.posthog.com";

type PosthogEvent = {
  event: string;
  timestamp: string;
  distinct_id: string;
  properties: Record<string, unknown>;
};

async function queryPosthog(hogql: string): Promise<unknown[][]> {
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!projectId || !apiKey) {
    throw new Error("POSTHOG_PROJECT_ID and POSTHOG_PERSONAL_API_KEY required");
  }
  const res = await fetch(`${POSTHOG_HOST}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: { kind: "HogQLQuery", query: hogql },
    }),
  });
  if (!res.ok) {
    throw new Error(`PostHog query failed: ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { results: unknown[][] };
  return body.results;
}

async function fetchLast24h() {
  const [events, pageviewRollup, errorEvents, sessions] = await Promise.all([
    queryPosthog(
      `SELECT event, count() AS n, count(DISTINCT distinct_id) AS users
       FROM events
       WHERE timestamp > now() - INTERVAL 24 HOUR
       GROUP BY event
       ORDER BY n DESC
       LIMIT 50`,
    ),
    queryPosthog(
      `SELECT properties.$pathname AS path, count() AS views,
              count(DISTINCT distinct_id) AS uniques
       FROM events
       WHERE event = '$pageview'
         AND timestamp > now() - INTERVAL 24 HOUR
       GROUP BY path
       ORDER BY views DESC
       LIMIT 30`,
    ),
    queryPosthog(
      `SELECT event, properties, timestamp, distinct_id
       FROM events
       WHERE (event LIKE '%error%' OR event LIKE '%fail%' OR event LIKE '%rageclick%')
         AND timestamp > now() - INTERVAL 24 HOUR
       ORDER BY timestamp DESC
       LIMIT 50`,
    ),
    queryPosthog(
      `SELECT distinct_id,
              count() AS events,
              min(timestamp) AS started,
              max(timestamp) AS ended,
              groupUniqArray(event) AS event_types
       FROM events
       WHERE timestamp > now() - INTERVAL 24 HOUR
       GROUP BY distinct_id
       ORDER BY events DESC
       LIMIT 30`,
    ),
  ]);
  return { events, pageviewRollup, errorEvents, sessions };
}

async function analyzeWithClaude(data: {
  events: unknown[][];
  pageviewRollup: unknown[][];
  errorEvents: unknown[][];
  sessions: unknown[][];
}): Promise<string> {
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const prompt = `You are auditing PostHog data from observe.tansohq.com (a developer-focused LLM billing/observability product) for the last 24 hours. You know:

- It's a new product; volumes are low. Zero users one day is normal, not alarming.
- The product has pages: /data-sources (API key + install prompt), /events, /customers, /alerts, /features, /plans, /team, /onboarding, /signup, /login, /join/:token.
- Recent ships: shared invite link (PR #139), guest-visible CTAs on /data-sources /alerts /features /team (PRs #135-137).

Your job: identify **bugs, friction, confusion, drop-offs**. Not a stats dump. Be specific.

Flag things like:
- Rageclicks or repeated failed actions on a specific element
- Users who load /data-sources but never hit /events (never ingested)
- Users who hit /signup but don't complete (drop-off)
- Pages with high traffic but no downstream action
- Error events that cluster
- Sessions that look like confusion (bouncing between 3+ pages, quick exits)

Skip things like:
- "X users visited" with no insight
- Generic "consider adding analytics" suggestions

Data (JSON):

Top events: ${JSON.stringify(data.events).slice(0, 4000)}

Pageviews by path: ${JSON.stringify(data.pageviewRollup).slice(0, 3000)}

Error/rageclick events: ${JSON.stringify(data.errorEvents).slice(0, 4000)}

Top sessions: ${JSON.stringify(data.sessions).slice(0, 4000)}

Output: a Slack-formatted message (mrkdwn). Lead with ONE sentence of the most important finding. Then up to 5 bulleted findings, each with (a) what you saw, (b) specific hypothesis, (c) suggested next step. If the signal is too weak to say anything useful, say so in one line — don't invent. No preamble, no emojis unless genuinely useful.`;

  const auditStarted = Date.now();
  const response = await anthropic.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  trackSelfLLM({
    featureKey: "posthog_audit",
    eventName: "nightly_audit",
    model: "claude-opus-4-7",
    modelProvider: "anthropic",
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    durationMs: Date.now() - auditStarted,
    idempotencyKey: response.id,
  });

  const block = response.content[0];
  if (block.type !== "text") {
    throw new Error("Unexpected Claude response type");
  }
  return block.text;
}

async function sendSlack(text: string) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook) throw new Error("SLACK_WEBHOOK_URL required");
  const res = await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text: `*Observe nightly PostHog audit* — ${new Date().toISOString().slice(0, 10)}\n\n${text}`,
    }),
  });
  if (!res.ok) {
    throw new Error(`Slack webhook failed: ${res.status} ${await res.text()}`);
  }
}

export async function runPosthogAudit() {
  const data = await fetchLast24h();
  const totalEvents = data.events.reduce(
    (sum, row) => sum + Number(row[1] ?? 0),
    0,
  );
  if (totalEvents === 0) {
    await sendSlack(
      "No events in the last 24h. Either PostHog is disconnected or there was zero traffic.",
    );
    return { ok: true, totalEvents: 0 };
  }
  const analysis = await analyzeWithClaude(data);
  await sendSlack(analysis);
  return { ok: true, totalEvents };
}
