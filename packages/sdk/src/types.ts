export interface IngestEvent {
  eventName: string;
  customerReferenceId: string;
  featureKey: string;
  timestamp?: string;
  costAmount?: number;
  costUnit?: string;
  revenueAmount?: number;
  usageUnits?: number;
  model?: string;
  modelProvider?: string;
  properties?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface ObserveEvent {
  eventName: string;
  customerReferenceId: string;
  featureKey: string;
  timestamp?: string;
  costAmount?: number;
  costUnit?: string;
  revenueAmount?: number;
  usageUnits?: number;
  model?: string;
  modelProvider?: string;
  properties?: Record<string, unknown>;
  idempotencyKey?: string;
}

export interface ClientOptions {
  apiKey: string;
  baseUrl?: string;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  onError?: (err: Error) => void;
}

export interface IngestResponse {
  accepted: number;
  rejected: number;
  errors: Array<{ index: number; error: string }>;
}
