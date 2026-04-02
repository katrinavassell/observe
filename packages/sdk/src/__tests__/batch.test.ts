import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BatchQueue } from "../batch.js";
import type { IngestEvent } from "../types.js";

function makeEvent(overrides?: Partial<IngestEvent>): IngestEvent {
  return {
    eventName: "test.event",
    customerReferenceId: "cust-1",
    featureKey: "feature-1",
    ...overrides,
  };
}

describe("BatchQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds events to queue", () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const queue = new BatchQueue({
      flushIntervalMs: 5000,
      maxBatchSize: 10,
      onFlush,
    });

    queue.add(makeEvent());
    queue.add(makeEvent({ eventName: "second" }));

    // Not yet flushed (below maxBatchSize and no interval tick)
    expect(onFlush).not.toHaveBeenCalled();

    queue.shutdown();
  });

  it("flushes when maxBatchSize reached", () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const queue = new BatchQueue({
      flushIntervalMs: 60000,
      maxBatchSize: 3,
      onFlush,
    });

    queue.add(makeEvent());
    queue.add(makeEvent());
    expect(onFlush).not.toHaveBeenCalled();

    queue.add(makeEvent());
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ eventName: "test.event" }),
      ]),
    );
    expect(onFlush.mock.calls[0][0]).toHaveLength(3);

    queue.shutdown();
  });

  it("flushes on interval", () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const queue = new BatchQueue({
      flushIntervalMs: 1000,
      maxBatchSize: 100,
      onFlush,
    });

    queue.add(makeEvent());
    expect(onFlush).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1000);
    expect(onFlush).toHaveBeenCalledOnce();

    queue.shutdown();
  });

  it("shutdown flushes remaining events", async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const queue = new BatchQueue({
      flushIntervalMs: 60000,
      maxBatchSize: 100,
      onFlush,
    });

    queue.add(makeEvent());
    queue.add(makeEvent());

    await queue.shutdown();
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0][0]).toHaveLength(2);
  });

  it("empty flush is a no-op", () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const queue = new BatchQueue({
      flushIntervalMs: 60000,
      maxBatchSize: 100,
      onFlush,
    });

    queue.flush();
    expect(onFlush).not.toHaveBeenCalled();

    queue.shutdown();
  });

  it("calls onError callback on flush failure", async () => {
    vi.useRealTimers();
    const error = new Error("network failure");
    const onFlush = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();
    const queue = new BatchQueue({
      flushIntervalMs: 60000,
      maxBatchSize: 100,
      onFlush,
      onError,
    });

    queue.add(makeEvent());
    queue.flush();

    // Give the rejected promise chain time to settle
    await new Promise((r) => setTimeout(r, 50));

    expect(onError).toHaveBeenCalledWith(error);

    queue.shutdown();
  });
});
