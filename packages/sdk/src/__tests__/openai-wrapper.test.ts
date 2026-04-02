import { describe, it, expect, vi } from "vitest";
import { wrapOpenAI } from "../wrappers/openai.js";
import type { TansoObserve } from "../client.js";

function makeMockObserve(): TansoObserve {
  return { track: vi.fn() } as unknown as TansoObserve;
}

function makeMockOpenAI(response: unknown) {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue(response),
      },
    },
  };
}

describe("wrapOpenAI", () => {
  it("tracks non-streaming completions", async () => {
    const observe = makeMockObserve();
    const openai = makeMockOpenAI({
      model: "gpt-4o",
      usage: { prompt_tokens: 100, completion_tokens: 50 },
    });

    const wrapped = wrapOpenAI(openai, observe, {
      customerReferenceId: "cust-1",
      featureKey: "chat",
    });
    await wrapped.chat.completions.create({ model: "gpt-4o", messages: [] });

    expect(observe.track).toHaveBeenCalledOnce();
    expect(observe.track).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "llm.chat.completion",
        customerReferenceId: "cust-1",
        featureKey: "chat",
        model: "gpt-4o",
        modelProvider: "openai",
        usageUnits: 150,
        properties: { promptTokens: 100, completionTokens: 50 },
      }),
    );
  });

  it("calculates cost correctly for gpt-4o", async () => {
    const observe = makeMockObserve();
    const openai = makeMockOpenAI({
      model: "gpt-4o",
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    });

    const wrapped = wrapOpenAI(openai, observe);
    await wrapped.chat.completions.create({ model: "gpt-4o", messages: [] });

    const tracked = (observe.track as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    // gpt-4o: input 2.5/1M, output 10.0/1M
    // 1000 * 2.5/1M + 500 * 10.0/1M = 0.0025 + 0.005 = 0.0075
    expect(tracked.costAmount).toBeCloseTo(0.0075, 6);
    expect(tracked.costUnit).toBe("usd");
  });

  it("handles missing usage gracefully", async () => {
    const observe = makeMockObserve();
    const openai = makeMockOpenAI({
      model: "gpt-4o",
      usage: undefined,
    });

    const wrapped = wrapOpenAI(openai, observe);
    await wrapped.chat.completions.create({ model: "gpt-4o", messages: [] });

    expect(observe.track).toHaveBeenCalledOnce();
    const tracked = (observe.track as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(tracked.usageUnits).toBe(0);
    expect(tracked.properties).toEqual({
      promptTokens: 0,
      completionTokens: 0,
    });
  });

  it("skips tracking for streaming responses", async () => {
    const observe = makeMockObserve();
    const streamResponse = { [Symbol.asyncIterator]: () => ({}) };
    const openai = makeMockOpenAI(streamResponse);

    const wrapped = wrapOpenAI(openai, observe);
    const result = await wrapped.chat.completions.create({
      model: "gpt-4o",
      messages: [],
      stream: true,
    });

    expect(observe.track).not.toHaveBeenCalled();
  });

  it("uses default customerReferenceId and featureKey when no defaults provided", async () => {
    const observe = makeMockObserve();
    const openai = makeMockOpenAI({
      model: "gpt-4o",
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    const wrapped = wrapOpenAI(openai, observe);
    await wrapped.chat.completions.create({ model: "gpt-4o", messages: [] });

    expect(observe.track).toHaveBeenCalledWith(
      expect.objectContaining({
        customerReferenceId: "unknown",
        featureKey: "openai-chat",
      }),
    );
  });
});
