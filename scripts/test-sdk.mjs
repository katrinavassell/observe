#!/usr/bin/env node
/**
 * End-to-end smoke test for @tansohq/observe.
 *
 * Prereqs:
 *   npm i @tansohq/observe openai
 *   export OBSERVE_API_KEY=obs_xxx        (from Data Sources > API Keys)
 *   export OPENAI_API_KEY=sk-...
 *   export OBSERVE_BASE_URL=https://app.tanso.io   (optional — override for staging)
 *
 * What it does:
 *   1. Configures Observe + identifies a synthetic customer
 *   2. Sends one wrapped OpenAI chat call (gpt-4o-mini, ~$0.0001)
 *   3. Polls /events until the event is ingested
 *   4. Asserts: customer_id, feature_key, model, cost > 0
 *   5. Prints PASS/FAIL
 */

import { Observe } from "@tansohq/observe";
import OpenAI from "openai";

const OBSERVE_KEY = process.env.OBSERVE_API_KEY;
const OPENAI_KEY = process.env.OPENAI_API_KEY;
const BASE = process.env.OBSERVE_BASE_URL || "https://app.tanso.io";

if (!OBSERVE_KEY || !OPENAI_KEY) {
  console.error("Missing OBSERVE_API_KEY or OPENAI_API_KEY");
  process.exit(1);
}

const CUSTOMER_ID = `sdk-smoke-${Date.now()}`;
const FEATURE_KEY = "sdk_smoke_test";

Observe.configure({ apiKey: OBSERVE_KEY, baseUrl: BASE });
Observe.identify({ customerId: CUSTOMER_ID, name: "SDK Smoke Test" });
Observe.feature(FEATURE_KEY);

const openai = Observe.wrap(new OpenAI({ apiKey: OPENAI_KEY }));

console.log(`→ Sending wrapped chat call (customer=${CUSTOMER_ID})`);
const completion = await openai.chat.completions.create({
  model: "gpt-4o-mini",
  messages: [{ role: "user", content: "Say OK in one word." }],
  max_tokens: 5,
});
console.log(`← Got reply: ${completion.choices[0]?.message?.content?.trim()}`);

// Poll for ingest (wrapper batches + flushes async)
const deadline = Date.now() + 30_000;
let found = null;
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  const res = await fetch(
    `${BASE}/api/events?customer_id=${CUSTOMER_ID}&limit=10`,
    { headers: { Authorization: `Bearer ${OBSERVE_KEY}` } },
  );
  if (!res.ok) continue;
  const body = await res.json();
  found = (body.events || []).find(
    (e) => e.customer_id === CUSTOMER_ID && e.feature_key === FEATURE_KEY,
  );
  if (found) break;
  process.stdout.write(".");
}
console.log();

if (!found) {
  console.error("FAIL: event was not ingested within 30s");
  process.exit(1);
}

const checks = {
  "customer_id matches": found.customer_id === CUSTOMER_ID,
  "feature_key matches": found.feature_key === FEATURE_KEY,
  "model recorded": !!found.model && found.model.includes("gpt-4o-mini"),
  "provider recorded": found.model_provider === "openai",
  "cost > 0": parseFloat(found.cost_amount || "0") > 0,
  "source = sdk": found.source === "sdk",
};

let allPass = true;
for (const [label, ok] of Object.entries(checks)) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) allPass = false;
}

if (!allPass) {
  console.error("\nSMOKE TEST FAILED");
  console.error(JSON.stringify(found, null, 2));
  process.exit(1);
}
console.log("\nSMOKE TEST PASSED");
