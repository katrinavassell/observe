import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest } from "./auth.js";

const ALLOWED_KINDS = new Set(["cost", "value", "outcome"]);

function normalizeFeatureKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function createFeatureDefinitionsRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  // GET /feature-definitions — list all definitions for the current user,
  // joined with per-feature event counts so the UI can show "0 events
  // received, waiting for first event" on each row.
  router.get(
    "/feature-definitions",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT
             fd.id,
             fd.name,
             fd.feature_key,
             fd.kind,
             fd.description,
             fd.code_location,
             fd.created_at,
             fd.updated_at,
             COALESCE(ev.event_count, 0) AS event_count,
             COALESCE(ev.total_cost, 0) AS total_cost,
             ev.last_seen,
             fp.revenue_per_unit,
             fp.unit_label
           FROM feature_definitions fd
           LEFT JOIN (
             SELECT feature_key,
                    COUNT(*) AS event_count,
                    SUM(cost_amount) AS total_cost,
                    MAX(timestamp) AS last_seen
             FROM observe_events
             WHERE user_id = $1
             GROUP BY feature_key
           ) ev ON ev.feature_key = fd.feature_key
           LEFT JOIN feature_pricing fp
             ON fp.user_id = fd.user_id AND fp.feature_key = fd.feature_key
           WHERE fd.user_id = $1
           ORDER BY fd.created_at ASC`,
          [req.visitorId],
        );

        res.json({
          definitions: result.rows.map((row) => ({
            id: row.id,
            name: row.name,
            feature_key: row.feature_key,
            kind: row.kind,
            description: row.description,
            code_location: row.code_location,
            created_at: row.created_at,
            updated_at: row.updated_at,
            event_count: parseInt(row.event_count, 10) || 0,
            total_cost: parseFloat(row.total_cost) || 0,
            last_seen: row.last_seen,
            revenue_per_unit:
              row.revenue_per_unit !== null
                ? parseFloat(row.revenue_per_unit)
                : null,
            unit_label: row.unit_label,
          })),
        });
      } catch (err) {
        console.error("GET /feature-definitions error:", {
          userId: req.visitorId,
          error: err,
        });
        res.status(500).json({ error: "Failed to list feature definitions" });
      }
    },
  );

  // POST /feature-definitions — create a new definition. feature_key is
  // normalized and must be unique per user.
  router.post(
    "/feature-definitions",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const { name, feature_key, kind, description, code_location } =
        req.body ?? {};

      if (!name || typeof name !== "string" || !name.trim()) {
        return res.status(400).json({ error: "name is required" });
      }
      const effectiveKind = kind ?? "outcome";
      if (!ALLOWED_KINDS.has(effectiveKind)) {
        return res
          .status(400)
          .json({ error: "kind must be cost, value, or outcome" });
      }

      const rawKey =
        typeof feature_key === "string" && feature_key.trim()
          ? feature_key
          : name;
      const normalizedKey = normalizeFeatureKey(rawKey);
      if (!normalizedKey) {
        return res
          .status(400)
          .json({ error: "feature_key is empty after normalization" });
      }

      try {
        const result = await pool.query(
          `INSERT INTO feature_definitions
             (user_id, account_id, name, feature_key, kind, description, code_location)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING *`,
          [
            req.visitorId,
            req.accountId ?? null,
            name.trim(),
            normalizedKey,
            effectiveKind,
            description?.trim() || null,
            code_location?.trim() || null,
          ],
        );
        res.status(201).json({ definition: result.rows[0] });
      } catch (err: any) {
        if (err?.code === "23505") {
          return res
            .status(409)
            .json({ error: `feature_key "${normalizedKey}" already exists` });
        }
        console.error("POST /feature-definitions error:", {
          userId: req.visitorId,
          input: { name, feature_key: normalizedKey, kind },
          error: err,
        });
        res.status(500).json({ error: "Failed to create feature definition" });
      }
    },
  );

  // PATCH /feature-definitions/:id — update mutable fields. feature_key is
  // immutable once set — renaming it would break the join with observe_events.
  router.patch(
    "/feature-definitions/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "invalid id" });
      }

      const { name, kind, description, code_location } = req.body ?? {};
      if (kind && !ALLOWED_KINDS.has(kind)) {
        return res
          .status(400)
          .json({ error: "kind must be cost, value, or outcome" });
      }

      try {
        const result = await pool.query(
          `UPDATE feature_definitions
           SET
             name = COALESCE($1, name),
             kind = COALESCE($2, kind),
             description = COALESCE($3, description),
             code_location = COALESCE($4, code_location),
             updated_at = NOW()
           WHERE id = $5 AND user_id = $6
           RETURNING *`,
          [
            name?.trim() || null,
            kind || null,
            description?.trim() || null,
            code_location?.trim() || null,
            id,
            req.visitorId,
          ],
        );

        if (result.rowCount === 0) {
          return res.status(404).json({ error: "not found" });
        }
        res.json({ definition: result.rows[0] });
      } catch (err) {
        console.error("PATCH /feature-definitions/:id error:", {
          userId: req.visitorId,
          id,
          error: err,
        });
        res.status(500).json({ error: "Failed to update feature definition" });
      }
    },
  );

  // DELETE /feature-definitions/:id
  router.delete(
    "/feature-definitions/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) {
        return res.status(400).json({ error: "invalid id" });
      }

      try {
        const result = await pool.query(
          `DELETE FROM feature_definitions WHERE id = $1 AND user_id = $2`,
          [id, req.visitorId],
        );
        if (result.rowCount === 0) {
          return res.status(404).json({ error: "not found" });
        }
        res.status(204).end();
      } catch (err) {
        console.error("DELETE /feature-definitions/:id error:", {
          userId: req.visitorId,
          id,
          error: err,
        });
        res.status(500).json({ error: "Failed to delete feature definition" });
      }
    },
  );

  return router;
}
