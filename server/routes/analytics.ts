import { Router } from "express";
import type { Pool } from "pg";
import { createAnalyticsReportRoutes } from "./analytics-reports.js";
import { createSimulationRoutes } from "./simulations.js";

export function createAnalyticsRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  router.use(createAnalyticsReportRoutes(pool, ensureVisitor));
  router.use(createSimulationRoutes(pool, ensureVisitor));

  return router;
}
