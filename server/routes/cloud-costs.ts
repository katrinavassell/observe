import { Router, Response } from "express";
import type { Pool } from "pg";
import { type AuthRequest, ensureScoped } from "./auth.js";
import { encryptApiKey, decryptApiKey } from "../stripe-client.js";

export function createCloudCostRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  // POST /cloud-costs/connect — store encrypted cloud provider credentials
  router.post(
    "/cloud-costs/connect",
    ensureVisitor,
    ensureScoped("billing.write"),
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const { provider, credentials } = req.body;

        if (!provider || !credentials) {
          return res
            .status(400)
            .json({ error: "provider and credentials are required" });
        }
        if (provider !== "aws" && provider !== "gcp") {
          return res
            .status(400)
            .json({ error: "provider must be 'aws' or 'gcp'" });
        }

        // Validate required credential fields per provider
        if (provider === "aws") {
          if (
            !credentials.accessKeyId ||
            !credentials.secretAccessKey ||
            !credentials.region
          ) {
            return res.status(400).json({
              error:
                "AWS credentials require accessKeyId, secretAccessKey, and region",
            });
          }
        } else {
          if (!credentials.serviceAccountJson) {
            return res.status(400).json({
              error: "GCP credentials require serviceAccountJson",
            });
          }
          // Validate that the service account JSON is actually valid JSON
          try {
            JSON.parse(credentials.serviceAccountJson);
          } catch {
            return res.status(400).json({
              error: "serviceAccountJson must be valid JSON",
            });
          }
        }

        const encrypted = encryptApiKey(JSON.stringify(credentials));

        await pool.query(
          `INSERT INTO cloud_integrations (user_id, account_id, provider, encrypted_credentials)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (account_id, provider)
           DO UPDATE SET encrypted_credentials = $4, last_sync_at = NULL`,
          [visitorId, req.accountId ?? null, provider, encrypted],
        );

        res.json({ success: true });
      } catch (err) {
        console.error("Failed to connect cloud provider:", err);
        res.status(500).json({ error: "Failed to connect cloud provider" });
      }
    },
  );

  // POST /cloud-costs/sync/:provider — trigger a cost sync (stub)
  router.post(
    "/cloud-costs/sync/:provider",
    ensureVisitor,
    ensureScoped("billing.write"),
    async (req: AuthRequest, res: Response) => {
      try {
        const { provider } = req.params;

        if (provider !== "aws" && provider !== "gcp") {
          return res
            .status(400)
            .json({ error: "provider must be 'aws' or 'gcp'" });
        }

        // Retrieve and decrypt stored credentials
        const result = await pool.query(
          `SELECT encrypted_credentials FROM cloud_integrations
           WHERE account_id = $1 AND provider = $2`,
          [req.accountId ?? null, provider],
        );
        if (result.rows.length === 0) {
          return res.status(404).json({
            error: `No ${provider} credentials found. Connect first.`,
          });
        }

        const credentials = JSON.parse(
          decryptApiKey(result.rows[0].encrypted_credentials),
        );

        if (provider === "aws") {
          // TODO: Use @aws-sdk/client-cost-explorer
          // const ce = new CostExplorerClient({
          //   credentials: { accessKeyId: credentials.accessKeyId, secretAccessKey: credentials.secretAccessKey },
          //   region: credentials.region,
          // });
          // const endDate = new Date().toISOString().slice(0, 10);
          // const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          // const result = await ce.send(new GetCostAndUsageCommand({
          //   TimePeriod: { Start: startDate, End: endDate },
          //   Granularity: "DAILY",
          //   Metrics: ["UnblendedCost"],
          //   GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
          // }));
          //
          // Then for each result group, insert into observe_events:
          // INSERT INTO observe_events (user_id, customer_id, feature_key, event_name, timestamp,
          //   cost_amount, source, granularity, properties)
          // VALUES ($1, 'infrastructure', service_name, 'compute_cost', date,
          //   cost_amount, 'aws_cost_explorer', 'daily_aggregate', '{"service": "..."}')

          await pool.query(
            `UPDATE cloud_integrations SET last_sync_at = NOW() WHERE account_id = $1 AND provider = $2`,
            [req.accountId ?? null, provider],
          );

          res.json({
            message: "AWS sync stub — SDK integration pending",
            provider: "aws",
            region: credentials.region,
            would_sync: {
              date_range: "last 30 days",
              granularity: "DAILY",
              metrics: ["UnblendedCost"],
              group_by: "SERVICE",
              target_table: "observe_events",
              cost_type: "compute",
            },
          });
        } else {
          // TODO: Use @google-cloud/bigquery
          // const bigquery = new BigQuery({ credentials: JSON.parse(credentials.serviceAccountJson) });
          // const startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
          // const query = `
          //   SELECT service.description AS service, SUM(cost) AS total_cost, DATE(usage_start_time) AS date
          //   FROM \`billing_export\`
          //   WHERE usage_start_time >= @start
          //   GROUP BY service, date
          //   ORDER BY date DESC
          // `;
          //
          // Then insert into observe_events with source = 'gcp_billing', cost_type = 'compute'

          await pool.query(
            `UPDATE cloud_integrations SET last_sync_at = NOW() WHERE account_id = $1 AND provider = $2`,
            [req.accountId ?? null, provider],
          );

          res.json({
            message: "GCP sync stub — SDK integration pending",
            provider: "gcp",
            would_sync: {
              date_range: "last 30 days",
              source_table: "billing_export",
              target_table: "observe_events",
              cost_type: "compute",
            },
          });
        }
      } catch (err) {
        console.error("Failed to sync cloud costs:", err);
        res.status(500).json({ error: "Failed to sync cloud costs" });
      }
    },
  );

  // GET /cloud-costs/status — connection status for each provider
  router.get(
    "/cloud-costs/status",
    ensureVisitor,
    ensureScoped("billing.read"),
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await pool.query(
          `SELECT provider, last_sync_at, created_at
           FROM cloud_integrations
           WHERE account_id = $1`,
          [req.accountId ?? null],
        );

        const providers = ["aws", "gcp"];
        const status = providers.map((p) => {
          const row = result.rows.find((r: any) => r.provider === p);
          return {
            provider: p,
            connected: !!row,
            last_sync_at: row?.last_sync_at ?? null,
            connected_at: row?.created_at ?? null,
          };
        });

        res.json(status);
      } catch (err) {
        console.error("Failed to get cloud cost status:", err);
        res.status(500).json({ error: "Failed to get cloud cost status" });
      }
    },
  );

  // DELETE /cloud-costs/disconnect/:provider — remove stored credentials
  router.delete(
    "/cloud-costs/disconnect/:provider",
    ensureVisitor,
    ensureScoped("billing.write"),
    async (req: AuthRequest, res: Response) => {
      try {
        const { provider } = req.params;

        if (provider !== "aws" && provider !== "gcp") {
          return res
            .status(400)
            .json({ error: "provider must be 'aws' or 'gcp'" });
        }

        await pool.query(
          `DELETE FROM cloud_integrations WHERE account_id = $1 AND provider = $2`,
          [req.accountId ?? null, provider],
        );

        res.json({ success: true });
      } catch (err) {
        console.error("Failed to disconnect cloud provider:", err);
        res.status(500).json({ error: "Failed to disconnect cloud provider" });
      }
    },
  );

  return router;
}
