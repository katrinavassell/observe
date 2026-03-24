import { BatchQueue } from './batch.js';
import { inferModelProvider } from './providers.js';
import type { ClientOptions, IngestEvent, ObserveEvent } from './types.js';

export class TansoObserve {
  private readonly queue: BatchQueue;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly onError?: (err: Error) => void;

  constructor(options: ClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://app.tanso.io';
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
      modelProvider: event.modelProvider ?? inferModelProvider(event.model) ?? undefined,
    };
    this.queue.add(ingestEvent);
  }

  flush(): void {
    this.queue.flush();
  }

  async shutdown(): Promise<void> {
    return this.queue.shutdown();
  }

  private async sendBatch(events: IngestEvent[]): Promise<void> {
    const response = await fetch(`${this.baseUrl}/events/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ events }),
    });
    if (!response.ok) {
      throw new Error(`Ingest failed: ${response.status} ${response.statusText}`);
    }
  }
}
