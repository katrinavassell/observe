import { BatchQueue } from "./batch.js";
import { inferModelProvider } from "./providers.js";
import type { TraceContext } from "./tracing.js";
import { startTrace, startSpan } from "./tracing.js";
import type { ClientOptions, IngestEvent, ObserveEvent } from "./types.js";

export class TansoObserve {
  private readonly queue: BatchQueue;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly onError?: (err: Error) => void;

  constructor(options: ClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://app.tanso.io";
    this.onError = options.onError;

    this.queue = new BatchQueue({
      flushIntervalMs: options.flushIntervalMs ?? 5000,
      maxBatchSize: options.maxBatchSize ?? 100,
      onFlush: (events) => this.sendBatch(events),
      onError: this.onError,
    });
  }

  track(event: ObserveEvent): void {
    const ingestEvent: IngestEvent = {
      ...event,
      modelProvider:
        event.modelProvider ?? inferModelProvider(event.model) ?? undefined,
    };
    this.queue.add(ingestEvent);
  }

  startTrace(): TraceContext {
    return startTrace();
  }

  async span<T>(
    ctx: TraceContext,
    opts: {
      eventName: string;
      featureKey: string;
      customerReferenceId?: string;
      costType?: string;
      costAmount?: number;
      model?: string;
      modelProvider?: string;
    },
    fn: () => Promise<T>,
  ): Promise<T> {
    const spanCtx = startSpan(ctx);
    const start = Date.now();
    let error: unknown;
    try {
      return await fn();
    } catch (err) {
      error = err;
      throw err;
    } finally {
      this.track({
        eventName: opts.eventName,
        customerReferenceId: opts.customerReferenceId ?? "unknown",
        featureKey: opts.featureKey,
        costType: opts.costType,
        costAmount: opts.costAmount,
        model: opts.model,
        modelProvider: opts.modelProvider,
        traceId: spanCtx.traceId,
        spanId: spanCtx.spanId,
        parentSpanId: spanCtx.parentSpanId,
        durationMs: Date.now() - start,
        properties: error ? { error: String(error) } : undefined,
      });
    }
  }

  flush(): void {
    this.queue.flush();
  }

  async shutdown(): Promise<void> {
    return this.queue.shutdown();
  }

  private async sendBatch(events: IngestEvent[]): Promise<void> {
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(`${this.baseUrl}/api/events/ingest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ events }),
      });
      if (response.ok) return;
      if (attempt < maxRetries) {
        const delayMs = 1000 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }
      throw new Error(
        `Ingest failed: ${response.status} ${response.statusText}`,
      );
    }
  }
}
