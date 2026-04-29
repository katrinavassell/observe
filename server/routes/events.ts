import { Router } from "express";
import type { Pool } from "pg";
import rateLimit from "express-rate-limit";
import { createEventsListRoutes } from "./events-list.js";
import { createEventsAggregationRoutes } from "./events-aggregation.js";
import { createEventsIngestRoutes } from "./events-ingest.js";

type ComputeInferenceProfilesFn = (userId: string) => Promise<number>;

export function createEventsRoutes(
  pool: Pool,
  ensureVisitor: any,
  deps: {
    computeInferenceProfiles: ComputeInferenceProfilesFn;
    apiLimiter: ReturnType<typeof rateLimit>;
  },
) {
  const router = Router();

  router.use(createEventsAggregationRoutes(pool, ensureVisitor));
  router.use(createEventsListRoutes(pool, ensureVisitor));
  router.use(createEventsIngestRoutes(pool, ensureVisitor, deps));

  return router;
}
