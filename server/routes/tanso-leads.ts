/**
 * POST /api/v1/contact/tanso-implementation
 *
 * Captures a Tanso Platform implementation lead from inside the Observe
 * product. Triggered when a user clicks "Talk to us about implementing
 * this →" on a MarginRecommendation card.
 *
 * Flow:
 *   1. Persist the lead in `tanso_leads` (table created by the matching
 *      migration in `migrations/2026-05-11-tanso-leads.sql` — apply that
 *      against the staging/dev Supabase DB before merging this PR).
 *   2. Send the AE notification email via Resend (reuses the same direct
 *      `api.resend.com/emails` pattern as `server/routes/alerts.ts`).
 *   3. Optionally fire a Slack webhook for the leads channel if
 *      `SLACK_WEBHOOK_LEADS_URL` env var is set.
 *
 * The DB connection (`pool`) is the standard one passed through from
 * `server/index.ts`. It uses whichever DATABASE_URL is configured in the
 * environment — i.e., your staging URL when running locally with
 * .env.staging or in the staging Vercel deploy.
 */

import type { Pool } from "pg";
import express from "express";
import { z } from "zod";

const leadSchema = z.object({
  email: z.string().email(),
  customer_name: z.string().max(200).nullable().optional(),
  action_type: z.string().max(100).nullable().optional(),
  action_payload: z.record(z.unknown()).nullable().optional(),
  recovered_dollars: z.number().nullable().optional(),
  recommendation_id: z.number().int().nullable().optional(),
  note: z.string().max(1000).nullable().optional(),
  scheduled_for: z.string().datetime().nullable().optional(),
  source: z.string().max(100).optional(),
});

type LeadInput = z.infer<typeof leadSchema>;

interface NotifyContext {
  lead: LeadInput & { id: string; created_at: string };
  appUrl: string;
}

/**
 * Send the AE notification email. Mirrors the pattern from alerts.ts.
 * Fails silently (logs only) so the user-facing submit still succeeds.
 */
async function sendAeNotificationEmail(ctx: NotifyContext): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const aeEmail = process.env.TANSO_LEAD_AE_EMAIL || "kat@tansohq.com";
  const fromEmail =
    process.env.RESEND_FROM_EMAIL || "alerts@observe.tansohq.com";

  if (!apiKey) {
    console.warn("[tanso-leads] RESEND_API_KEY not set; skipping AE email");
    return;
  }

  const { lead, appUrl } = ctx;
  const customer = lead.customer_name ? lead.customer_name : "(unspecified)";
  const action = lead.action_type ?? "(unspecified)";
  const recovered =
    typeof lead.recovered_dollars === "number"
      ? `$${lead.recovered_dollars.toFixed(2)}/mo`
      : "—";

  const subject = `[Observe Lead] ${customer} — ${action}`;

  const html = `
    <div style="font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; color: #111; max-width: 600px;">
      <h2 style="margin: 0 0 12px;">New Tanso Platform lead from Observe</h2>
      <p style="color: #555; margin: 0 0 18px;">
        Submitted from the MarginRecommendation contact form.
      </p>

      <table cellpadding="6" style="border-collapse: collapse; font-size: 14px;">
        <tr><td style="color: #666; vertical-align: top;">Email</td><td><strong>${escapeHtml(lead.email)}</strong></td></tr>
        <tr><td style="color: #666; vertical-align: top;">Customer</td><td>${escapeHtml(customer)}</td></tr>
        <tr><td style="color: #666; vertical-align: top;">Recommended action</td><td>${escapeHtml(action)}</td></tr>
        <tr><td style="color: #666; vertical-align: top;">Recovery est.</td><td>${escapeHtml(recovered)}</td></tr>
        <tr><td style="color: #666; vertical-align: top;">Recommendation ID</td><td>${lead.recommendation_id ?? "—"}</td></tr>
        <tr><td style="color: #666; vertical-align: top;">Source</td><td>${escapeHtml(lead.source ?? "observe_recommendation_cta")}</td></tr>
      </table>

      ${
        lead.note
          ? `<p style="margin: 18px 0 6px; color: #666;">Note from the lead:</p>
             <blockquote style="margin: 0; padding: 10px 14px; background: #f7f7f7; border-left: 3px solid #ddd; font-size: 14px;">${escapeHtml(lead.note)}</blockquote>`
          : ""
      }

      ${
        lead.action_payload
          ? `<details style="margin-top: 18px;"><summary style="cursor: pointer; color: #555; font-size: 13px;">action_payload</summary><pre style="background: #fafafa; padding: 10px; border-radius: 4px; font-size: 12px; overflow-x: auto;">${escapeHtml(JSON.stringify(lead.action_payload, null, 2))}</pre></details>`
          : ""
      }

      <p style="margin-top: 24px; font-size: 13px; color: #666;">
        Next: review the lead's account in Observe, draft a one-page implementation prep doc, and reply with a calendar invite.
        <br><a href="${appUrl}" style="color: #2563eb;">Open Observe →</a>
      </p>
    </div>
  `;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: aeEmail,
        reply_to: lead.email,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("[tanso-leads] AE email send failed:", res.status, errText);
    }
  } catch (err) {
    console.error("[tanso-leads] AE email send threw:", err);
  }
}

/**
 * Optional Slack notification. No-op if SLACK_WEBHOOK_LEADS_URL is not set.
 */
async function sendSlackLeadAlert(ctx: NotifyContext): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_LEADS_URL;
  if (!url) return;

  const { lead } = ctx;
  const customer = lead.customer_name ?? "(unspecified)";
  const action = lead.action_type ?? "(unspecified)";
  const recovered =
    typeof lead.recovered_dollars === "number"
      ? `$${lead.recovered_dollars.toFixed(2)}/mo`
      : "—";

  const text = `:dart: *New Tanso Platform lead from Observe*\n*Email:* ${lead.email}\n*Customer:* ${customer}\n*Action:* ${action}\n*Recovery:* ${recovered}${lead.note ? `\n*Note:* ${lead.note}` : ""}`;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch (err) {
    console.error("[tanso-leads] Slack webhook failed:", err);
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Resolve the authenticated user + account from the request. Mirrors the
 * pattern used elsewhere in this codebase (Clerk JWT in Authorization +
 * X-Account-Id header, or x-visitor-id for anonymous).
 *
 * Falls back gracefully so anonymous visitors can still submit leads.
 */
function resolveSubmitter(req: express.Request): {
  user_id: string | null;
  account_id: number | null;
} {
  // The existing middleware (see server/routes/auth.ts and the auth
  // composition in server/index.ts) attaches `req.userId` and
  // `req.accountId` when a Clerk token is valid. We read both and fall
  // back to the anonymous visitor id header for users who haven't signed
  // up yet.
  const anyReq = req as express.Request & {
    userId?: string;
    accountId?: number;
  };
  const visitorId = req.header("x-visitor-id");
  return {
    user_id: anyReq.userId ?? visitorId ?? null,
    account_id: anyReq.accountId ?? null,
  };
}

export function createTansoLeadsRoutes(pool: Pool): express.Router {
  const router = express.Router();

  router.post("/contact/tanso-implementation", async (req, res) => {
    const parsed = leadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid lead payload",
        details: parsed.error.flatten(),
      });
    }
    const input = parsed.data;
    const { user_id, account_id } = resolveSubmitter(req);
    const source = input.source ?? "observe_recommendation_cta";

    try {
      // Persist. Lean payload — the DB schema lives in
      // migrations/2026-05-11-tanso-leads.sql.
      const insertResult = await pool.query(
        `INSERT INTO tanso_leads
           (email, customer_name, action_type, action_payload,
            recovered_dollars, recommendation_id, note, source,
            user_id, account_id, scheduled_for)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, email, customer_name, action_type,
                   recovered_dollars, source, scheduled_for, created_at`,
        [
          input.email.trim().toLowerCase(),
          input.customer_name ?? null,
          input.action_type ?? null,
          input.action_payload ? JSON.stringify(input.action_payload) : null,
          input.recovered_dollars ?? null,
          input.recommendation_id ?? null,
          input.note ?? null,
          source,
          user_id,
          account_id,
          input.scheduled_for ?? null,
        ],
      );

      const lead = insertResult.rows[0];
      const appUrl =
        process.env.APP_URL ||
        (process.env.VERCEL_URL
          ? `https://${process.env.VERCEL_URL}`
          : "http://localhost:5173");

      // Notify (best-effort, non-blocking on errors)
      await Promise.allSettled([
        sendAeNotificationEmail({
          lead: { ...input, id: lead.id, created_at: lead.created_at, source },
          appUrl,
        }),
        sendSlackLeadAlert({
          lead: { ...input, id: lead.id, created_at: lead.created_at, source },
          appUrl,
        }),
      ]);

      res.json({ lead });
    } catch (err) {
      console.error("[tanso-leads] Insert failed:", err);
      res.status(500).json({ error: "Failed to capture lead" });
    }
  });

  return router;
}
