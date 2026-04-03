import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TansoObserve } from "../client.js";

describe("TansoObserve", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: "OK" }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("sets defaults correctly", async () => {
    const client = new TansoObserve({ apiKey: "test-key" });

    client.track({
      eventName: "test",
      customerReferenceId: "c1",
      featureKey: "f1",
    });
    client.flush();

    // Allow the async sendBatch to resolve
    await vi.advanceTimersByTimeAsync(0);

    expect(fetch).toHaveBeenCalledWith(
      "https://app.tanso.io/api/events/ingest",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer test-key",
        }),
      }),
    );

    await client.shutdown();
  });

  it("track queues an event", async () => {
    const client = new TansoObserve({ apiKey: "key", flushIntervalMs: 60000 });

    client.track({
      eventName: "llm.call",
      customerReferenceId: "cust-1",
      featureKey: "chat",
      model: "gpt-4o",
    });

    // Not flushed yet
    expect(fetch).not.toHaveBeenCalled();

    await client.shutdown();
  });

  it("flush triggers batch send", async () => {
    const client = new TansoObserve({ apiKey: "key", flushIntervalMs: 60000 });

    client.track({
      eventName: "llm.call",
      customerReferenceId: "cust-1",
      featureKey: "chat",
    });
    client.flush();

    await vi.advanceTimersByTimeAsync(0);

    expect(fetch).toHaveBeenCalledOnce();

    await client.shutdown();
  });

  it("shutdown stops timer and flushes", async () => {
    const client = new TansoObserve({ apiKey: "key", flushIntervalMs: 60000 });

    client.track({
      eventName: "test",
      customerReferenceId: "c1",
      featureKey: "f1",
    });

    await client.shutdown();

    expect(fetch).toHaveBeenCalledOnce();
  });

  it("sendBatch calls fetch with correct URL, headers, body", async () => {
    const client = new TansoObserve({
      apiKey: "sk-test-123",
      baseUrl: "https://custom.api.io",
    });

    client.track({
      eventName: "llm.completion",
      customerReferenceId: "cust-42",
      featureKey: "summarize",
      model: "gpt-4o",
      costAmount: 0.003,
    });
    client.flush();

    await vi.advanceTimersByTimeAsync(0);

    expect(fetch).toHaveBeenCalledWith(
      "https://custom.api.io/api/events/ingest",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer sk-test-123",
        },
        body: expect.stringContaining('"customerReferenceId":"cust-42"'),
      },
    );

    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.events).toHaveLength(1);
    expect(body.events[0].modelProvider).toBe("openai");

    await client.shutdown();
  });

  it("infers modelProvider when not provided", async () => {
    const client = new TansoObserve({ apiKey: "key" });

    client.track({
      eventName: "test",
      customerReferenceId: "c1",
      featureKey: "f1",
      model: "claude-sonnet-4-20250514",
    });

    await client.shutdown();

    const body = JSON.parse(
      (fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body,
    );
    expect(body.events[0].modelProvider).toBe("anthropic");
  });
});
