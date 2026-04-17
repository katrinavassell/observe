import type { Pool } from "pg";
import { computeRecommendations } from "./routes/recommendations.js";

const isCloud = process.env.OBSERVE_EDITION === "cloud" || !!process.env.VERCEL;

interface DigestData {
  email: string;
  name: string | null;
  visitorId: string;
  totalRevenue: number;
  totalCost: number;
  marginPct: number;
  eventCount: number;
  customerCount: number;
  recommendations: Array<{
    type: string;
    title: string;
    severity: string;
  }>;
}

async function gatherDigestData(
  pool: Pool,
  visitorId: string,
): Promise<DigestData | null> {
  const account = await pool.query(
    "SELECT email, name FROM users WHERE visitor_id = $1",
    [visitorId],
  );
  if (!account.rows[0]?.email) return null;

  // Run fresh recommendations
  await computeRecommendations(pool, visitorId);

  // Get last 7 days summary
  const summary = await pool.query(
    `SELECT
      COALESCE(SUM(revenue_amount), 0) as total_revenue,
      COALESCE(SUM(cost_amount), 0) as total_cost,
      COUNT(*) as event_count,
      COUNT(DISTINCT customer_id) FILTER (WHERE customer_id IS NOT NULL AND customer_id != 'default') as customer_count
     FROM observe_events
     WHERE user_id = $1 AND timestamp > NOW() - INTERVAL '7 days'
       AND source != 'sample'`,
    [visitorId],
  );

  const row = summary.rows[0];
  const totalRevenue = parseFloat(row.total_revenue);
  const totalCost = parseFloat(row.total_cost);
  const marginPct =
    totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;

  // Get top 3 pending recommendations
  const recs = await pool.query(
    `SELECT type, title, severity FROM recommendations
     WHERE user_id = $1 AND status = 'pending'
     ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END,
       created_at DESC
     LIMIT 3`,
    [visitorId],
  );

  return {
    email: account.rows[0].email,
    name: account.rows[0].name,
    visitorId,
    totalRevenue,
    totalCost,
    marginPct,
    eventCount: parseInt(row.event_count),
    customerCount: parseInt(row.customer_count),
    recommendations: recs.rows,
  };
}

function buildDigestHtml(data: DigestData, appUrl: string): string {
  const greeting = data.name ? `Hi ${data.name}` : "Hi there";
  const marginColor =
    data.marginPct >= 50
      ? "#10b981"
      : data.marginPct >= 20
        ? "#f59e0b"
        : "#ef4444";

  const recsHtml =
    data.recommendations.length > 0
      ? data.recommendations
          .map((r) => {
            const icon =
              r.severity === "critical"
                ? "🔴"
                : r.severity === "warning"
                  ? "🟡"
                  : "🔵";
            return `<li style="margin-bottom: 8px; font-size: 14px;">${icon} ${r.title}</li>`;
          })
          .join("")
      : '<li style="font-size: 14px; color: #999;">No new findings this week.</li>';

  return `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 520px; margin: 0 auto; padding: 24px;">
  <div style="margin-bottom: 24px;">
    <strong style="font-size: 18px;">Observe</strong>
    <span style="color: #999; font-size: 14px; margin-left: 8px;">Weekly Digest</span>
  </div>

  <p style="font-size: 14px; color: #333; margin-bottom: 20px;">${greeting},</p>
  <p style="font-size: 14px; color: #333; margin-bottom: 20px;">Here's your week at a glance:</p>

  <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin-bottom: 20px;">
    <table style="width: 100%; border-collapse: collapse;">
      <tr>
        <td style="padding: 8px 0; font-size: 13px; color: #666;">Revenue</td>
        <td style="padding: 8px 0; font-size: 14px; font-weight: 600; text-align: right;">$${data.totalRevenue.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; font-size: 13px; color: #666;">Cost</td>
        <td style="padding: 8px 0; font-size: 14px; font-weight: 600; text-align: right;">$${data.totalCost.toFixed(2)}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; font-size: 13px; color: #666;">Margin</td>
        <td style="padding: 8px 0; font-size: 14px; font-weight: 600; text-align: right; color: ${marginColor};">${data.marginPct.toFixed(1)}%</td>
      </tr>
      <tr style="border-top: 1px solid #e5e7eb;">
        <td style="padding: 8px 0; font-size: 13px; color: #666;">Events</td>
        <td style="padding: 8px 0; font-size: 14px; text-align: right;">${data.eventCount.toLocaleString()}</td>
      </tr>
      <tr>
        <td style="padding: 8px 0; font-size: 13px; color: #666;">Active customers</td>
        <td style="padding: 8px 0; font-size: 14px; text-align: right;">${data.customerCount}</td>
      </tr>
    </table>
  </div>

  <div style="margin-bottom: 20px;">
    <p style="font-size: 13px; font-weight: 600; color: #333; margin-bottom: 8px;">Top actions this week:</p>
    <ul style="list-style: none; padding: 0; margin: 0;">
      ${recsHtml}
    </ul>
  </div>

  <a href="${appUrl}/insights" style="display: inline-block; background: #111; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none; font-size: 14px;">
    Open Dashboard
  </a>

  <p style="color: #999; font-size: 11px; margin-top: 24px;">
    Sent by Observe weekly digest. You're receiving this because you have an Observe account.
  </p>
</div>`;
}

async function sendDigestEmail(email: string, html: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn("RESEND_API_KEY not set, skipping digest email");
    return false;
  }

  const fromEmail = process.env.ALERT_FROM_EMAIL || "kat@tansohq.com";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: `Observe <${fromEmail}>`,
        to: email,
        subject: "Your Observe weekly digest",
        html,
      }),
    });
    if (!res.ok) {
      console.error("Digest email failed:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Digest email error:", err);
    return false;
  }
}

export async function runWeeklyDigest(pool: Pool): Promise<void> {
  if (!isCloud) {
    console.log("Weekly digest is cloud-only, skipping");
    return;
  }

  const appUrl =
    process.env.APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:5173");

  // Get all accounts with data in the last 30 days
  const accounts = await pool.query(
    `SELECT DISTINCT u.visitor_id
     FROM users u
     JOIN user_accounts ua ON ua.user_id = u.id AND ua.role = 'owner'
     JOIN accounts a ON a.id = ua.account_id
     JOIN observe_events oe ON oe.user_id = u.visitor_id
     WHERE oe.timestamp > NOW() - INTERVAL '30 days'
       AND oe.source != 'sample'
       AND a.stripe_plan IN ('growth', 'pro')`,
  );

  console.log(`Weekly digest: processing ${accounts.rows.length} accounts`);

  let sent = 0;
  for (const row of accounts.rows) {
    try {
      const data = await gatherDigestData(pool, row.visitor_id);
      if (!data || data.eventCount === 0) continue;

      const html = buildDigestHtml(data, appUrl);
      const success = await sendDigestEmail(data.email, html);
      if (success) sent++;
    } catch (err) {
      console.error(`Digest failed for ${row.visitor_id}:`, err);
    }
  }

  console.log(`Weekly digest: sent ${sent} emails`);
}
