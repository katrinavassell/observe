# @tanso/observe

Zero-latency AI cost observability SDK. Track every LLM call with 3 lines of code.

## Quickstart

```ts
import { TansoObserve } from '@tanso/observe';

const observe = new TansoObserve({ apiKey: 'your-api-key' });

observe.track({
  eventName: 'llm.chat',
  customerReferenceId: 'user-123',
  featureKey: 'ai-assistant',
  model: 'gpt-4o',
  usageUnits: 1500,
  costAmount: 0.03,
});
```

## OpenAI Wrapper

```ts
import OpenAI from 'openai';
import { TansoObserve } from '@tanso/observe';
import { wrapOpenAI } from '@tanso/observe/openai';

const client = new OpenAI();
const observe = new TansoObserve({ apiKey: 'your-api-key' });

wrapOpenAI(client, observe, {
  customerReferenceId: 'user-123',
  featureKey: 'chat',
});

// All calls are now automatically tracked
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
});
```

## Anthropic Wrapper

```ts
import Anthropic from '@anthropic-ai/sdk';
import { TansoObserve } from '@tanso/observe';
import { wrapAnthropic } from '@tanso/observe/anthropic';

const client = new Anthropic();
const observe = new TansoObserve({ apiKey: 'your-api-key' });

wrapAnthropic(client, observe, {
  customerReferenceId: 'user-123',
  featureKey: 'chat',
});

const response = await client.messages.create({
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello' }],
});
```

## Self-hosted

```ts
const observe = new TansoObserve({
  apiKey: 'your-api-key',
  baseUrl: 'https://your-instance.example.com',
});
```

## API Reference

### `new TansoObserve(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `apiKey` | `string` | *required* | Your Tanso API key |
| `baseUrl` | `string` | `https://app.tanso.io` | API endpoint |
| `flushIntervalMs` | `number` | `5000` | Auto-flush interval in ms |
| `maxBatchSize` | `number` | `100` | Max events per batch |
| `onError` | `(err: Error) => void` | - | Error callback (errors are silent by default) |

### `observe.track(event)`

Fire-and-forget. Queues an event for batched delivery. Never throws.

### `observe.flush()`

Immediately flush queued events.

### `observe.shutdown()`

Flush remaining events and stop the background timer. Returns a Promise.
