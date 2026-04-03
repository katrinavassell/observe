# Integrating Observe with Next.js

Observe tracks AI costs from your Next.js application. All tracking happens server-side -- never expose your API key to the browser.

## Install

```bash
npm install @tanso/observe openai
```

## Singleton Pattern

Create a shared Observe instance so it persists across requests. Module-level singletons in Next.js are cached for the lifetime of the server process.

```typescript
// lib/observe.ts
import { TansoObserve } from '@tanso/observe';

export const observe = new TansoObserve({
  apiKey: process.env.OBSERVE_API_KEY!,
  baseUrl: process.env.OBSERVE_URL ?? 'https://app.tanso.io',
});
```

Import this wherever you need tracking. Do not create new instances per request.

## Server-Side Tracking in Route Handlers

```typescript
// app/api/chat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { wrapOpenAI } from '@tanso/observe/openai';
import { observe } from '@/lib/observe';

const openai = wrapOpenAI(new OpenAI(), observe);

export async function POST(req: NextRequest) {
  const { message } = await req.json();

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: message }],
  });

  return NextResponse.json({ reply: completion.choices[0].message.content });
}
```

`wrapOpenAI` intercepts every API call, calculates cost, and sends it to Observe. Your application code stays the same -- just swap in the wrapped client.

## Server Actions

Server actions run on the server, so they work the same way. This example tracks costs per authenticated user.

```typescript
// app/actions/summarize.ts
'use server';

import OpenAI from 'openai';
import { wrapOpenAI } from '@tanso/observe/openai';
import { observe } from '@/lib/observe';
import { auth } from '@/lib/auth';

const openai = wrapOpenAI(new OpenAI(), observe);

export async function summarize(text: string) {
  const session = await auth();

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: `Summarize: ${text}` }],
  });

  // Optionally track with user attribution
  observe.track({
    eventName: 'llm.chat.completion',
    customerReferenceId: session?.user?.id,
    featureKey: 'summarize',
    model: 'gpt-4o',
  });

  return completion.choices[0].message.content;
}
```

## Self-Hosted

If you run a self-hosted Observe instance, point `baseUrl` to it:

```typescript
export const observe = new TansoObserve({
  apiKey: process.env.OBSERVE_API_KEY!,
  baseUrl: process.env.OBSERVE_URL ?? 'http://localhost:3001',
});
```

Set `OBSERVE_URL` in your environment. When unset, it defaults to `https://app.tanso.io`.

## Graceful Shutdown in Serverless

Observe batches events and sends them asynchronously, so it never affects request latency. In serverless environments (Vercel, AWS Lambda), the runtime can terminate before the batch flushes. Three options:

1. **Flush per request.** Call `await observe.flush()` at the end of each handler. This adds one network call but guarantees delivery.

```typescript
export async function POST(req: NextRequest) {
  const { message } = await req.json();

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: message }],
  });

  await observe.flush();

  return NextResponse.json({ reply: completion.choices[0].message.content });
}
```

2. **Reduce flush interval.** Set `flushIntervalMs` to send batches more frequently:

```typescript
export const observe = new TansoObserve({
  apiKey: process.env.OBSERVE_API_KEY!,
  flushIntervalMs: 1000, // flush every 1s instead of default
});
```

3. **Edge functions.** If you use Next.js edge runtime, flushing is critical. The edge runtime can terminate immediately after the response is sent. Always call `await observe.flush()` before returning.

## Per-User Cost Tracking

Use `track()` to attribute costs to specific users. This is fire-and-forget -- it never throws.

```typescript
observe.track({
  eventName: 'llm.chat.completion',
  customerReferenceId: session.user.id, // your user ID
  featureKey: 'ai-chat',
  model: 'gpt-4o',
  costAmount: 0.03,
});
```

`customerReferenceId` is your internal user or organization ID. Use it to break down AI spend per customer in the Observe dashboard.

## Environment Variables

```env
OBSERVE_API_KEY=obs_...            # SDK key from Data Sources > API Keys
OBSERVE_URL=http://localhost:3001  # Self-hosted URL (optional)
```

Add these to `.env.local` for development or your hosting provider's environment settings for production. Never commit `OBSERVE_API_KEY` to source control.
