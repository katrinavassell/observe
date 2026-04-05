import crypto from "crypto";

export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
}

export function generateId(): string {
  return crypto.randomBytes(8).toString("hex");
}

export function startTrace(): TraceContext {
  const id = generateId();
  return { traceId: id, spanId: id };
}

export function startSpan(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: generateId(),
    parentSpanId: parent.spanId,
  };
}
