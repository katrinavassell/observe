import type { TansoObserve } from "../client.js";
import type { TraceContext } from "../tracing.js";
import { startSpan } from "../tracing.js";

interface WrapToolOptions {
  eventName: string;
  featureKey: string;
  customerReferenceId?: string;
  costType?: string;
  costAmount?: number;
  traceContext?: TraceContext;
}

export function wrapTool<A extends unknown[], R>(
  observe: TansoObserve,
  fn: (...args: A) => Promise<R>,
  opts: WrapToolOptions,
): (...args: A) => Promise<R> {
  return async (...args: A): Promise<R> => {
    const spanCtx = opts.traceContext ? startSpan(opts.traceContext) : undefined;
    const start = Date.now();
    let error: unknown;
    try {
      return await fn(...args);
    } catch (err) {
      error = err;
      throw err;
    } finally {
      observe.track({
        eventName: opts.eventName,
        customerReferenceId: opts.customerReferenceId ?? "unknown",
        featureKey: opts.featureKey,
        costType: opts.costType ?? "generic",
        costAmount: opts.costAmount,
        durationMs: Date.now() - start,
        traceId: spanCtx?.traceId,
        spanId: spanCtx?.spanId,
        parentSpanId: spanCtx?.parentSpanId,
        properties: error ? { error: String(error) } : undefined,
      });
    }
  };
}
