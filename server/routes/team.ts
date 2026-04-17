import { Router, Request, Response } from "express";
import type { Pool } from "pg";
import crypto from "crypto";
import { type AuthRequest } from "./auth.js";
import { grantBonusCredits } from "../billing.js";

export function createTeamRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  async function getOrCreateOrg(visitorId: string, accountEmail?: string) {
    const mapResult = await pool.query(
      "SELECT org_id FROM visitor_org_map WHERE visitor_id = $1",
      [visitorId],
    );
    if (mapResult.rows.length > 0) {
      const orgId = mapResult.rows[0].org_id;
      const orgResult = await pool.query(
        "SELECT * FROM organizations WHERE id = $1",
        [orgId],
      );
      const org = orgResult.rows[0];
      if (org && !org.invite_token) {
        const tok = crypto.randomBytes(16).toString("hex");
        await pool.query(
          "UPDATE organizations SET invite_token = $1 WHERE id = $2",
          [tok, org.id],
        );
        org.invite_token = tok;
      }
      return org;
    }

    const inviteToken = crypto.randomBytes(16).toString("hex");
    const orgResult = await pool.query(
      "INSERT INTO organizations (name, owner_visitor_id, invite_token) VALUES ($1, $2, $3) RETURNING *",
      ["My Team", visitorId, inviteToken],
    );
    const org = orgResult.rows[0];

    await pool.query(
      "INSERT INTO visitor_org_map (visitor_id, org_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [visitorId, org.id],
    );

    await pool.query(
      `INSERT INTO organization_members (org_id, visitor_id, invited_email, role, status, joined_at)
       VALUES ($1, $2, $3, 'admin', 'active', NOW())`,
      [org.id, visitorId, accountEmail ?? null],
    );

    return org;
  }

  async function backfillMemberEmail(
    orgId: number,
    visitorId: string,
    accountEmail: string | undefined,
  ) {
    if (!accountEmail) return;
    await pool.query(
      `UPDATE organization_members
         SET invited_email = $1
       WHERE org_id = $2 AND visitor_id = $3 AND invited_email IS NULL`,
      [accountEmail, orgId, visitorId],
    );
  }

  // GET /team - get current user's org info and members
  router.get(
    "/team",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const org = await getOrCreateOrg(visitorId, req.accountEmail);
        await backfillMemberEmail(org.id, visitorId, req.accountEmail);

        const membersResult = await pool.query(
          `SELECT om.*, a.email AS account_email, a.name AS account_name
         FROM organization_members om
         LEFT JOIN users a ON a.visitor_id = om.visitor_id
         WHERE om.org_id = $1
           AND (om.status = 'active' OR om.invited_email IS NOT NULL)
         ORDER BY om.created_at ASC`,
          [org.id],
        );

        const members = membersResult.rows.map((m: any) => ({
          ...m,
          invited_email: m.invited_email || m.account_email || null,
          account_name: undefined,
          account_email: undefined,
          // `role` is retained in the DB but no longer surfaced in the API.
          role: undefined,
        }));

        res.json({ org, members, invite_token: org.invite_token });
      } catch (err) {
        console.error("GET /team error:", err);
        res.status(500).json({ error: "Failed to load team info" });
      }
    },
  );

  // PATCH /team/name - rename the org
  router.patch(
    "/team/name",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const { name } = req.body;
        if (!name || typeof name !== "string") {
          return res.status(400).json({ error: "Name is required" });
        }
        if (name.trim().length > 100) {
          return res
            .status(400)
            .json({ error: "Name must be 100 characters or fewer" });
        }

        const org = await getOrCreateOrg(visitorId);

        const memberResult = await pool.query(
          "SELECT 1 FROM organization_members WHERE org_id = $1 AND visitor_id = $2 AND status = 'active'",
          [org.id, visitorId],
        );
        if (!memberResult.rows.length) {
          return res
            .status(403)
            .json({ error: "Only team members can rename the team" });
        }

        await pool.query("UPDATE organizations SET name = $1 WHERE id = $2", [
          name,
          org.id,
        ]);
        res.json({ success: true });
      } catch (err) {
        console.error("PATCH /team/name error:", err);
        res.status(500).json({ error: "Failed to rename team" });
      }
    },
  );

  // POST /team/invite/rotate - rotate shared invite token
  router.post(
    "/team/invite/rotate",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const org = await getOrCreateOrg(visitorId);

        const memberResult = await pool.query(
          "SELECT 1 FROM organization_members WHERE org_id = $1 AND visitor_id = $2 AND status = 'active'",
          [org.id, visitorId],
        );
        if (!memberResult.rows.length) {
          return res
            .status(403)
            .json({ error: "Only team members can rotate the invite link" });
        }

        const newToken = crypto.randomBytes(16).toString("hex");
        await pool.query(
          "UPDATE organizations SET invite_token = $1 WHERE id = $2",
          [newToken, org.id],
        );
        res.json({ success: true, invite_token: newToken });
      } catch (err) {
        console.error("POST /team/invite/rotate error:", err);
        res.status(500).json({ error: "Failed to rotate invite link" });
      }
    },
  );

  // GET /team/invite/:token - get invite info (no auth required)
  router.get("/team/invite/:token", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const result = await pool.query(
        `SELECT name AS org_name FROM organizations WHERE invite_token = $1`,
        [token],
      );

      if (!result.rows.length) {
        return res
          .status(404)
          .json({ error: "Invite link not found or rotated" });
      }

      res.json({
        org_name: result.rows[0].org_name,
        invited_email: null,
      });
    } catch (err) {
      console.error("GET /team/invite/:token error:", err);
      res.status(500).json({ error: "Failed to get invite info" });
    }
  });

  // POST /team/join/:token - accept an invite (anyone signed in with link)
  router.post(
    "/team/join/:token",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        if (!req.accountEmail) {
          return res
            .status(401)
            .json({ error: "You must be signed in to accept an invite" });
        }
        const visitorId = req.visitorId!;
        const { token } = req.params;

        const orgResult = await pool.query(
          `SELECT id, owner_visitor_id FROM organizations WHERE invite_token = $1`,
          [token],
        );
        if (!orgResult.rows.length) {
          return res
            .status(404)
            .json({ error: "Invite link not found or rotated" });
        }
        const orgId = orgResult.rows[0].id;
        const ownerVisitorId = orgResult.rows[0].owner_visitor_id;

        const existing = await pool.query(
          `SELECT id, status FROM organization_members WHERE org_id = $1 AND visitor_id = $2`,
          [orgId, visitorId],
        );

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          if (existing.rows.length > 0) {
            await client.query(
              `UPDATE organization_members
               SET status = 'active', joined_at = COALESCE(joined_at, NOW())
               WHERE id = $1`,
              [existing.rows[0].id],
            );
          } else {
            await client.query(
              `INSERT INTO organization_members (org_id, visitor_id, invited_email, role, status, joined_at)
               VALUES ($1, $2, $3, 'admin', 'active', NOW())`,
              [orgId, visitorId, req.accountEmail],
            );
          }
          // Don't clobber an existing mapping — the invitee may already own
          // another org. They can switch between accounts via the X-Account-Id
          // header / account switcher once user_accounts has both rows.
          await client.query(
            `INSERT INTO visitor_org_map (visitor_id, org_id) VALUES ($1, $2)
             ON CONFLICT (visitor_id) DO NOTHING`,
            [visitorId, orgId],
          );

          // Add the invitee to the inviter's account in the new
          // (user_accounts) model so the account switcher shows it and
          // req.accountId can resolve when X-Account-Id points at it.
          const ownerAcctResult = await client.query(
            `SELECT ua.account_id
               FROM user_accounts ua
               JOIN users u ON u.id = ua.user_id
               WHERE u.visitor_id = $1 AND ua.role = 'owner' AND ua.status = 'active'
               LIMIT 1`,
            [ownerVisitorId],
          );
          const inviterAccountId = ownerAcctResult.rows[0]?.account_id;
          if (inviterAccountId) {
            await client.query(
              `INSERT INTO user_accounts (user_id, account_id, role, status, joined_at)
               SELECT id, $2, 'admin', 'active', NOW() FROM users WHERE visitor_id = $1
               ON CONFLICT (user_id, account_id) DO UPDATE SET status = 'active'`,
              [visitorId, inviterAccountId],
            );
          } else {
            console.warn(
              `POST /team/join: inviter ${ownerVisitorId} has no owner user_accounts row; invitee not added to new-model account`,
            );
          }
          await client.query("COMMIT");
        } catch (txErr) {
          await client.query("ROLLBACK");
          throw txErr;
        } finally {
          client.release();
        }

        if (existing.rows.length === 0 && ownerVisitorId) {
          try {
            await grantBonusCredits(pool, ownerVisitorId, "invite_accepted");
            await pool.query(
              `UPDATE users SET invite_credits_granted = COALESCE(invite_credits_granted, 0) + 1 WHERE visitor_id = $1`,
              [ownerVisitorId],
            );
          } catch (creditErr) {
            console.error("Failed to grant invite bonus credits:", creditErr);
          }
        }

        res.json({ success: true, org_id: String(orgId) });
      } catch (err) {
        console.error("POST /team/join/:token error:", err);
        res.status(500).json({ error: "Failed to accept invite" });
      }
    },
  );

  // DELETE /team/members/:id - remove a member
  router.delete(
    "/team/members/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const memberId = req.params.id;

        const org = await getOrCreateOrg(visitorId);

        const callerCheck = await pool.query(
          "SELECT 1 FROM organization_members WHERE org_id = $1 AND visitor_id = $2 AND status = 'active'",
          [org.id, visitorId],
        );
        if (!callerCheck.rows.length) {
          return res
            .status(403)
            .json({ error: "Only team members can remove members" });
        }

        const memberResult = await pool.query(
          "SELECT * FROM organization_members WHERE id = $1 AND org_id = $2",
          [memberId, org.id],
        );
        if (!memberResult.rows.length) {
          return res.status(404).json({ error: "Member not found" });
        }

        const member = memberResult.rows[0];

        if (member.visitor_id === visitorId) {
          return res.status(400).json({ error: "Cannot remove yourself" });
        }

        if (member.visitor_id) {
          await pool.query(
            "DELETE FROM visitor_org_map WHERE visitor_id = $1 AND org_id = $2",
            [member.visitor_id, org.id],
          );
        }

        await pool.query("DELETE FROM organization_members WHERE id = $1", [
          memberId,
        ]);
        res.json({ success: true });
      } catch (err) {
        console.error("DELETE /team/members/:id error:", err);
        res.status(500).json({ error: "Failed to remove member" });
      }
    },
  );

  return router;
}
