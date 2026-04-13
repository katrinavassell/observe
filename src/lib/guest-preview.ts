/**
 * Hardcoded sample data served to LOGGED-OUT visitors only.
 *
 * This module is the ONLY source of preview data shown to guests. The
 * server has zero knowledge of sample data — a CHECK constraint rejects
 * any row with source='sample' at insert time. Keeping the preview
 * entirely client-side makes it impossible for sample rows to ever leak
 * into a real user's account.
 *
 * Pages use these arrays via `useGuestPreview()` — when !isLoggedIn,
 * the page renders from the array instead of calling the API. When the
 * user signs in, the page falls back to real queries.
 */

import type { TraceListItem, TraceDetail } from "@/lib/api";

export const GUEST_TRACES: TraceListItem[] = [
  {
    trace_id: "sample-trace-rag-pipeline",
    start_time: new Date(Date.now() - 1 * 3600_000).toISOString(),
    span_count: 5,
    total_cost: 0.423,
    total_revenue: 1.2,
    total_duration_ms: 3200,
    root_event: "rag_query",
    cost_types: ["llm", "embedding", "vector_db"],
  },
  {
    trace_id: "sample-trace-content-gen",
    start_time: new Date(Date.now() - 4 * 3600_000).toISOString(),
    span_count: 4,
    total_cost: 0.85,
    total_revenue: 2.0,
    total_duration_ms: 5800,
    root_event: "content_pipeline",
    cost_types: ["llm", "compute", "api"],
  },
  {
    trace_id: "sample-trace-code-review",
    start_time: new Date(Date.now() - 8 * 3600_000).toISOString(),
    span_count: 6,
    total_cost: 1.32,
    total_revenue: 3.5,
    total_duration_ms: 12400,
    root_event: "code_review_agent",
    cost_types: ["llm", "compute", "database", "api"],
  },
  {
    trace_id: "sample-trace-data-extract",
    start_time: new Date(Date.now() - 12 * 3600_000).toISOString(),
    span_count: 3,
    total_cost: 0.18,
    total_revenue: 0.5,
    total_duration_ms: 2100,
    root_event: "document_extraction",
    cost_types: ["llm", "compute"],
  },
  {
    trace_id: "sample-trace-search",
    start_time: new Date(Date.now() - 18 * 3600_000).toISOString(),
    span_count: 4,
    total_cost: 0.065,
    total_revenue: 0.2,
    total_duration_ms: 890,
    root_event: "semantic_search",
    cost_types: ["embedding", "vector_db"],
  },
];

const SAMPLE_TRACE_DETAILS: Record<string, TraceDetail> = {
  "sample-trace-rag-pipeline": {
    trace_id: "sample-trace-rag-pipeline",
    spans: [
      {
        id: 1,
        user_id: "guest",
        customer_id: "cus_acme",
        feature_key: "rag_query",
        event_name: "rag_query",
        timestamp: new Date(Date.now() - 3600_000).toISOString(),
        cost_amount: 0.08,
        cost_unit: "usd",
        revenue_amount: 0.4,
        usage_units: 2400,
        source: "sample",
        model: "gpt-4o-mini",
        model_provider: "openai",
        span_id: "s1",
        parent_span_id: null,
        duration_ms: 520,
        cost_type: "llm",
      } as unknown as TraceDetail["spans"][number],
      {
        id: 2,
        user_id: "guest",
        customer_id: "cus_acme",
        feature_key: "rag_query",
        event_name: "embed_query",
        timestamp: new Date(Date.now() - 3600_000 + 300).toISOString(),
        cost_amount: 0.002,
        cost_unit: "usd",
        revenue_amount: 0,
        usage_units: 64,
        source: "sample",
        model: "text-embedding-3-small",
        model_provider: "openai",
        span_id: "s2",
        parent_span_id: "s1",
        duration_ms: 90,
        cost_type: "embedding",
      } as unknown as TraceDetail["spans"][number],
      {
        id: 3,
        user_id: "guest",
        customer_id: "cus_acme",
        feature_key: "rag_query",
        event_name: "vector_search",
        timestamp: new Date(Date.now() - 3600_000 + 450).toISOString(),
        cost_amount: 0.003,
        cost_unit: "usd",
        revenue_amount: 0,
        usage_units: 8,
        source: "sample",
        model: null,
        model_provider: null,
        span_id: "s3",
        parent_span_id: "s1",
        duration_ms: 180,
        cost_type: "vector_db",
      } as unknown as TraceDetail["spans"][number],
      {
        id: 4,
        user_id: "guest",
        customer_id: "cus_acme",
        feature_key: "rag_query",
        event_name: "generate_answer",
        timestamp: new Date(Date.now() - 3600_000 + 700).toISOString(),
        cost_amount: 0.33,
        cost_unit: "usd",
        revenue_amount: 0.8,
        usage_units: 5200,
        source: "sample",
        model: "gpt-4o",
        model_provider: "openai",
        span_id: "s4",
        parent_span_id: "s1",
        duration_ms: 2100,
        cost_type: "llm",
      } as unknown as TraceDetail["spans"][number],
      {
        id: 5,
        user_id: "guest",
        customer_id: "cus_acme",
        feature_key: "rag_query",
        event_name: "rerank_results",
        timestamp: new Date(Date.now() - 3600_000 + 900).toISOString(),
        cost_amount: 0.008,
        cost_unit: "usd",
        revenue_amount: 0,
        usage_units: 320,
        source: "sample",
        model: "gpt-4o-mini",
        model_provider: "openai",
        span_id: "s5",
        parent_span_id: "s1",
        duration_ms: 310,
        cost_type: "llm",
      } as unknown as TraceDetail["spans"][number],
    ],
  },
};

export function getGuestTraceDetail(traceId: string): TraceDetail | null {
  return SAMPLE_TRACE_DETAILS[traceId] ?? null;
}
