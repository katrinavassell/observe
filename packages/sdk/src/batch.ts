import type { IngestEvent } from './types.js';

export interface BatchQueueOptions {
  flushIntervalMs: number;
  maxBatchSize: number;
  onFlush: (events: IngestEvent[]) => Promise<void>;
  onError?: (err: Error) => void;
}

export class BatchQueue {
  private queue: IngestEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly options: BatchQueueOptions;

  constructor(options: BatchQueueOptions) {
    this.options = options;
    this.timer = setInterval(() => {
      this.flush();
    }, options.flushIntervalMs);
  }

  add(event: IngestEvent): void {
    this.queue.push(event);
    if (this.queue.length >= this.options.maxBatchSize) {
      this.flush();
    }
  }

  flush(): void {
    if (this.queue.length === 0) return;
    const events = this.queue;
    this.queue = [];
    this.options.onFlush(events).catch((err) => {
      if (this.options.onError) {
        this.options.onError(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  async shutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.queue.length === 0) return;
    const events = this.queue;
    this.queue = [];
    try {
      await this.options.onFlush(events);
    } catch (err) {
      if (this.options.onError) {
        this.options.onError(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }
}
