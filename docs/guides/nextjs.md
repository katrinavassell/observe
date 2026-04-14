# Integrating Observe with Next.js

Observe tracks AI costs from your Next.js application. All tracking happens server-side — never expose your API key to the browser.

## Install

```bash
npm install @tansohq/observe openai
```

## Configure Once

Call `Observe.configure()` from a server-only module. In Next.js, `lib/observe.ts` is a good place — it runs once per server process.

```typescript
// lib/observe.ts
import "server-only";
import { Observe } from "@tansohq/observe";

Observe.configure({
  apiKey: process.env.OBSERVE_API_KEY!,
  // Optional: override if self-hosting
  // baseUrl: process.env.OBSERVE_URL ?? "https://observemetrics.com",
});
```

Import this file wherever you need tracking (route handlers, server actions, middleware).

## Route Handlers

```typescript
// app/api/chat/route.ts
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { Observe } from "@tansohq/observe";
import { auth } from "@/lib/auth";
import "@/lib/observe"; // side-effect import ensures Observe.configure ran

const openai = Observe.wrap(new OpenAI());

export async function POST(req: NextRequest) {
  const session = await auth();
  Observe.identify({ customerId: session?.user?.id });
  Observe.feature("ai_chat");

  const { message } = await req.json();
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: message }],
  });

  return NextResponse.json({ reply: completion.choices[0].message.content });
}
```

`Observe.wrap()` rewrites the OpenAI client's `baseURL` to the Observe gateway and attaches tracking headers. Your application code stays the same — just wrap the client.

## Server Actions

Server actions run on the server, so they work the same way:

```typescript
// app/actions/summarize.ts
"use server";

import OpenAI from "openai";
import { Observe } from "@tansohq/observe";
import { auth } from "@/lib/auth";
import "@/lib/observe";

const openai = Observe.wrap(new OpenAI());

export async function summarize(text: string) {
  const session = await auth();
  Observe.identify({ customerId: session?.user?.id });

  const completion = await openai.chat.completions.create(
    {
      model: "gpt-4o",
      messages: [{ role: "user", content: `Summarize: ${text}` }],
    },
    { headers: { "x-tanso-feature": "summarize_text" } }
  );

  return completion.choices[0].message.content;
}
```

## Self-Hosted

If you run a self-hosted Observe instance, pass `baseUrl`:

```typescript
Observe.configure({
  apiKey: process.env.OBSERVE_API_KEY!,
  baseUrl: process.env.OBSERVE_URL ?? "http://localhost:3001",
});
```

## Environment

```
OBSERVE_API_KEY=obs_...            # from Data Sources > API Keys
# OBSERVE_URL=https://observemetrics.com  # optional, defaults to hosted
```

Never expose `OBSERVE_API_KEY` to the browser. Keep it server-only (don't prefix with `NEXT_PUBLIC_`).

## Per-Request Attribution

`Observe.identify({ customerId })` sets the customer context for the current async scope. Call it at the start of each authenticated request. Use `Observe.feature('ai_chat')` or a per-call `x-tanso-feature` header to tag the product feature that owns the call.

## Edge Runtime

The SDK uses standard `fetch` and works in edge runtimes. Configure it the same way in an edge route:

```typescript
export const runtime = "edge";
```

No special flushing needed — the gateway is called synchronously on every request, so tracking is guaranteed before the response returns.
