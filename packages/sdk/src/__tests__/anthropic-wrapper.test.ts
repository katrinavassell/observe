import { describe, it, expect, vi } from "vitest";
import { wrapAnthropic } from "../wrappers/anthropic.js";
import type { TansoObserve } from "../client.js";

function makeMockObserve(): TansoObserve {
  return { track: vi.fn() } as unknown as TansoObserve;
}

function makeMockAnthropic(response: unknown) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue(response),
    },
  };
}

describe("wrapAnthropic", () => {
  it("tracks non-streaming messages", async () => {
    const observe = makeMockObserve();
    const anthropic = makeMockAnthropic({
      model: "claude-sonnet-4-5",
      usage: { input_tokens: 200, output_tokens: 80 },
    });

    const wrapped = wrapAnthropic(anthropic, observe, {
      customerReferenceId: "cust-1",
      featureKey: "chat",
    });
    await wrapped.messages.create({
      model: "claude-sonnet-4-5",
      messages: [],
    });

    expect(observe.track).toHaveBeenCalledOnce();
    expect(observe.track).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "llm.messages.create",
        customerReferenceId: "cust-1",
        featureKey: "chat",
        model: "claude-sonnet-4-5",
        modelProvider: "anthropic",
        usageUnits: 280,
        properties: { inputTokens: 200, outputTokens: 80 },
      }),
    );
  });

  it("calculates cost correctly for claude-sonnet-4-5", async () => {
    const observe = makeMockObserve();
    const anthropic = makeMockAnthropic({
      model: "claude-sonnet-4-5",
      usage: { input_tokens: 1000, output_tokens: 500 },
    });

    const wrapped = wrapAnthropic(anthropic, observe);
    await wrapped.messages.create({
      model: "claude-sonnet-4-5",
      messages: [],
    });

    const tracked = (observe.track as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    // claude-sonnet-4-5: input 3.0/1M, output 15.0/1M
    // 1000 * 3.0/1M + 500 * 15.0/1M = 0.003 + 0.0075 = 0.0105
    expect(tracked.costAmount).toBeCloseTo(0.0105, 6);
    expect(tracked.costUnit).toBe("usd");
  });

  it("handles missing usage gracefully", async () => {
    const observe = makeMockObserve();
    const anthropic = makeMockAnthropic({
      model: "claude-sonnet-4-5",
      usage: undefined,
    });

    const wrapped = wrapAnthropic(anthropic, observe);
    await wrapped.messages.create({
      model: "claude-sonnet-4-5",
      messages: [],
    });

    expect(observe.track).toHaveBeenCalledOnce();
    const tracked = (observe.track as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(tracked.usageUnits).toBe(0);
    expect(tracked.properties).toEqual({
      inputTokens: 0,
      outputTokens: 0,
    });
  });

  it("tracks streaming responses by accumulating SSE events", async () => {
    const observe = makeMockObserve();

    const sseEvents = [
      {
        type: "message_start",
        message: {
          model: "claude-sonnet-4-5",
          usage: { input_tokens: 150 },
        },
      },
      {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      },
      {
        type: "content_block_delta",
        index: 0,
        delta: { type: "text_delta", text: "Hello" },
      },
      {
        type: "content_block_stop",
        index: 0,
      },
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn" },
        usage: { output_tokens: 42 },
      },
      {
        type: "message_stop",
      },
    ];

    let eventIndex = 0;
    const streamResponse = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (eventIndex < sseEvents.length) {
              return { done: false, value: sseEvents[eventIndex++] };
            }
            return { done: true, value: undefined };
          },
        };
      },
    };

    const anthropic = makeMockAnthropic(streamResponse);
    const wrapped = wrapAnthropic(anthropic, observe, {
      customerReferenceId: "cust-2",
      featureKey: "stream-chat",
    });

    const stream = await wrapped.messages.create({
      model: "claude-sonnet-4-5",
      messages: [],
      stream: true,
    });

    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }

    expect(chunks).toHaveLength(6);
    expect(observe.track).toHaveBeenCalledOnce();
    expect(observe.track).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "llm.messages.create",
        customerReferenceId: "cust-2",
        featureKey: "stream-chat",
        model: "claude-sonnet-4-5",
        modelProvider: "anthropic",
        usageUnits: 192,
        properties: { inputTokens: 150, outputTokens: 42 },
      }),
    );
  });

  it("does not track streaming when no usage events received", async () => {
    const observe = makeMockObserve();

    const sseEvents = [{ type: "content_block_delta", delta: { text: "Hi" } }];

    let eventIndex = 0;
    const streamResponse = {
      [Symbol.asyncIterator]() {
        return {
          async next() {
            if (eventIndex < sseEvents.length) {
              return { done: false, value: sseEvents[eventIndex++] };
            }
            return { done: true, value: undefined };
          },
        };
      },
    };

    const anthropic = makeMockAnthropic(streamResponse);
    const wrapped = wrapAnthropic(anthropic, observe);

    const stream = await wrapped.messages.create({
      model: "claude-sonnet-4-5",
      messages: [],
      stream: true,
    });

    for await (const _ of stream) {
      // consume
    }

    expect(observe.track).not.toHaveBeenCalled();
  });

  it("uses default customerReferenceId and featureKey when no defaults provided", async () => {
    const observe = makeMockObserve();
    const anthropic = makeMockAnthropic({
      model: "claude-sonnet-4-5",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const wrapped = wrapAnthropic(anthropic, observe);
    await wrapped.messages.create({
      model: "claude-sonnet-4-5",
      messages: [],
    });

    expect(observe.track).toHaveBeenCalledWith(
      expect.objectContaining({
        customerReferenceId: "unknown",
        featureKey: "anthropic-messages",
      }),
    );
  });
});
