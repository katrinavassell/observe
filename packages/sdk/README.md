# @tansohq/observe

AI cost observability SDK. Track every LLM call with 3 lines of code.

## Install

```bash
npm install @tansohq/observe
```

## Quickstart (recommended)

```ts
import { Observe } from '@tansohq/observe'
import OpenAI from 'openai'

// 1. Configure once at startup
Observe.configure({ apiKey: 'obs_your_api_key' })

// 2. Identify customer once on login
Observe.identify({ customerId: 'cus_123' })

// 3. Wrap your client -- all calls auto-tracked
const openai = Observe.wrap(new OpenAI())

const response = await openai.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
})
// Cost, model, tokens, customer, and feature tracked automatically.
```

### How it works

`Observe.wrap()` sets your client's `baseURL` to the Observe proxy and injects tracking headers. Your OpenAI/Anthropic API key still authenticates with the provider -- Observe just logs the call on the way through.

### API

| Method | Description |
|---|---|
| `Observe.configure({ apiKey, baseUrl? })` | Set API key. Call once at startup. `baseUrl` defaults to `https://app.tanso.io` |
| `Observe.identify({ customerId, name?, email? })` | Set customer context globally. Call once on login |
| `Observe.feature(featureKey)` | Set default feature attribution |
| `Observe.wrap(client, overrides?)` | Wrap an OpenAI or Anthropic client. Returns the same instance |
| `Observe.agent(agentId)` | Set the current agent context for multi-agent tracking. Attaches `agentId` to all subsequent events |

Per-call overrides use the client's native options:

```ts
await openai.chat.completions.create(
  { model: 'gpt-4o', messages },
  { headers: { 'x-tanso-feature': 'export_report' } }
)
```

### Self-hosted

```ts
Observe.configure({
  apiKey: 'obs_your_api_key',
  baseUrl: 'https://your-instance.example.com',
})
```

### Multi-agent tracking (A2A)

Use `Observe.agent()` to attribute costs to individual agents in a multi-agent system:

```ts
import { Observe } from '@tansohq/observe'
import OpenAI from 'openai'

Observe.configure({ apiKey: 'obs_your_api_key' })
Observe.identify({ customerId: 'cus_123' })

// Research agent
Observe.agent('research-agent')
const researchClient = Observe.wrap(new OpenAI())
await researchClient.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Find recent papers on X' }],
})

// Summarization agent
Observe.agent('summarization-agent')
const summaryClient = Observe.wrap(new OpenAI())
await summaryClient.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Summarize these findings' }],
})

// Each call is tagged with its agentId, so you can see cost per agent
// in the AI model breakdown dashboard.
```

---

## Alternative: Direct proxy (no SDK)

Set your OpenAI/Anthropic base URL to Observe and add one header:

```python
from openai import OpenAI

client = OpenAI(
    api_key="sk-...",
    base_url="https://app.tanso.io/v1",
    default_headers={
        "x-tanso-key": "obs_your_api_key",
        "x-tanso-customer": user.stripe_id,
        "x-tanso-feature": "ai_chat",
    },
)
```

---

## Alternative: Manual event tracking

For non-OpenAI/Anthropic providers or custom cost attribution:

```ts
import { TansoObserve } from '@tansohq/observe';

const observe = new TansoObserve({ apiKey: 'your-api-key' });

observe.track({
  eventName: 'llm.chat',
  customerReferenceId: 'user-123',
  featureKey: 'ai-assistant',
  model: 'gpt-4o',
  usageUnits: 1500,
  costAmount: 0.03,
});

// Before process exit or serverless teardown:
await observe.shutdown();
```

## Architecture

The `TansoObserve` client uses an internal `BatchQueue`. When you call `track()`, the event is pushed into an in-memory queue. The queue is flushed automatically on a timer (default: every 5 seconds) or when the batch reaches its max size (default: 100 events). Flushes send events via `POST /events/ingest` with Bearer token auth.

Failed sends are retried up to 3 times with exponential backoff (1s, 2s, 4s). After all retries are exhausted, the error is passed to the `onError` callback if one was provided. If no callback is set, the error is silently dropped.

## Client Options

```ts
const observe = new TansoObserve({
  apiKey: 'your-api-key',           // required -- SDK API key from Data Sources page
  baseUrl: 'https://app.tanso.io',  // default; override for self-hosted
  flushIntervalMs: 5000,            // default: 5 seconds
  maxBatchSize: 100,                // default: 100 events per batch
  onError: (err) => {               // called after retries exhausted
    console.error('Observe send failed:', err);
  },
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | *required* | Your SDK API key from the Data Sources page |
| `baseUrl` | `string` | `https://app.tanso.io` | API endpoint |
| `flushIntervalMs` | `number` | `5000` | Auto-flush interval in ms |
| `maxBatchSize` | `number` | `100` | Max events per batch |
| `onError` | `(err: Error) => void` | - | Error callback; errors are silent by default |

## Event Schema Reference

Every event requires `eventName`, `customerReferenceId`, and `featureKey`. All other fields are optional.

```ts
interface ObserveEvent {
  eventName: string;           // required
  customerReferenceId: string; // required
  featureKey: string;          // required
  timestamp?: string;
  costAmount?: number;
  costUnit?: string;
  revenueAmount?: number;
  usageUnits?: number;
  model?: string;
  modelProvider?: string;      // auto-inferred from model name if not provided
  properties?: Record<string, unknown>;
  idempotencyKey?: string;
}
```

- `model` -- the LLM model name (e.g. `gpt-4o`, `claude-sonnet-4-20250514`). If provided, `modelProvider` is auto-detected.
- `modelProvider` -- explicitly set the provider. Overrides auto-detection.
- `costAmount` / `costUnit` -- the cost of this event in your chosen unit.
- `revenueAmount` -- revenue attributed to this event.
- `usageUnits` -- token count or other usage metric.
- `idempotencyKey` -- deduplicate events on the server side.
- `properties` -- arbitrary key-value metadata attached to the event.

## OpenAI Wrapper

`wrapOpenAI` uses a `Proxy` to intercept `client.chat.completions.create` calls and automatically track them.

```ts
import OpenAI from 'openai';
import { TansoObserve } from '@tansohq/observe';
import { wrapOpenAI } from '@tansohq/observe/openai';

const observe = new TansoObserve({ apiKey: 'your-api-key' });

const client = wrapOpenAI(new OpenAI(), observe, {
  customerReferenceId: 'user-123',
  featureKey: 'chat',
});

// All calls are now automatically tracked
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

How it works:

- Non-streaming responses are tracked immediately after completion.
- Streaming responses wrap the async iterator to capture usage from the final chunk.
- Cost is automatically calculated from a built-in pricing table (`OPENAI_PRICING`).
- Events are emitted with `eventName: "llm.chat.completion"` and `modelProvider: "openai"`.
- Tracking failures never break the caller -- a try/catch around tracking ensures your app is unaffected.

## Anthropic Wrapper

`wrapAnthropic` uses a `Proxy` to intercept `client.messages.create` calls and automatically track them.

```ts
import Anthropic from '@anthropic-ai/sdk';
import { TansoObserve } from '@tansohq/observe';
import { wrapAnthropic } from '@tansohq/observe/anthropic';

const observe = new TansoObserve({ apiKey: 'your-api-key' });

const client = wrapAnthropic(new Anthropic(), observe, {
  customerReferenceId: 'user-123',
  featureKey: 'chat',
});

const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }],
});
```

How it works:

- Non-streaming responses are tracked after completion.
- Events are emitted with `eventName: "llm.messages.create"` and `modelProvider: "anthropic"`.
- Tracking failures never break the caller.

## Model Provider Auto-Detection

When you set a `model` name on an event, the SDK automatically infers `modelProvider` using prefix matching. You can override this by setting `modelProvider` explicitly.

| Model prefix | Detected provider |
|---|---|
| `claude-*` | `anthropic` |
| `gpt-*`, `dall-e-*`, `text-embedding-*` | `openai` |
| `gemini-*` | `google` |
| `mistral-*`, `mixtral-*` | `mistral` |
| `llama-*` | `meta` |
| `command-*` | `cohere` |

## Lifecycle Management

- **`track(event)`** -- Fire-and-forget. Queues an event in memory. Never throws.
- **`flush()`** -- Triggers an immediate send of all queued events. Non-blocking.
- **`shutdown()`** -- Clears the flush interval timer and flushes remaining events. Returns a `Promise`. Call this before process exit, in serverless teardown, or in `SIGTERM` handlers.

```ts
// Express shutdown example
process.on('SIGTERM', async () => {
  await observe.shutdown();
  process.exit(0);
});
```

## Error Handling and Retries

The SDK is designed to never affect your application's reliability:

- `track()` never throws. Events are queued in memory regardless of network state.
- When a flush fails, it is retried up to 3 times with exponential backoff (1s, 2s, 4s).
- After all retries are exhausted, the error is passed to `onError` if provided. Otherwise, it is silently dropped.

```ts
const observe = new TansoObserve({
  apiKey: 'your-api-key',
  onError: (err) => {
    // Log to your error tracking service
    Sentry.captureException(err);
  },
});
```

## Self-Hosted

Point the SDK at your own instance:

```ts
const observe = new TansoObserve({
  apiKey: 'your-api-key',
  baseUrl: 'https://your-instance.example.com',
});
```

## Debugging Tips

- Events are queued in memory. If you're not seeing data in the dashboard, check that `flush()` or `shutdown()` is being called before the process exits.
- Set an `onError` callback to surface send failures. Without it, errors after retries are silently dropped.
- In serverless environments (Lambda, Vercel Functions), always `await observe.shutdown()` at the end of the handler. Otherwise the process may exit before the flush completes.
- Check that your `apiKey` is a valid SDK key from the Data Sources page.

## Known Limitations

- **Anthropic streaming is not tracked.** When `stream: true` is passed to `wrapAnthropic`, the response is returned as-is without tracking. Non-streaming Anthropic calls are tracked normally.
- **No persistent queue.** Events are held in memory only. If the process crashes before a flush, queued events are lost.
