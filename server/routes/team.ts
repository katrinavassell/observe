import { Router, Request, Response } from "express";
import type { Pool } from "pg";
import crypto from "crypto";
import { type AuthRequest } from "./auth.js";
import { grantBonusCredits } from "../billing.js";

export function createTeamRoutes(pool: Pool, ensureVisitor: any) {
  const router = Router();

  async function getOrCreateOrg(visitorId: string) {
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
      return orgResult.rows[0];
    }

    const orgResult = await pool.query(
      "INSERT INTO organizations (name, owner_visitor_id) VALUES ($1, $2) RETURNING *",
      ["My Team", visitorId],
    );
    const org = orgResult.rows[0];

    await pool.query(
      "INSERT INTO visitor_org_map (visitor_id, org_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [visitorId, org.id],
    );

    await pool.query(
      `INSERT INTO organization_members (org_id, visitor_id, role, status, joined_at)
       VALUES ($1, $2, 'admin', 'active', NOW())`,
      [org.id, visitorId],
    );

    return org;
  }

  // GET /team - get current user's org info and members
  router.get(
    "/team",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const org = await getOrCreateOrg(visitorId);

        const membersResult = await pool.query(
          `SELECT om.*, a.email AS account_email, a.name AS account_name
         FROM organization_members om
         LEFT JOIN accounts a ON a.visitor_id = om.visitor_id
         WHERE om.org_id = $1
         ORDER BY om.created_at ASC`,
          [org.id],
        );

        const members = membersResult.rows.map((m: any) => ({
          ...m,
          invited_email: m.invited_email || m.account_email || null,
          account_name: undefined,
          account_email: undefined,
        }));

        const myMember = members.find((m: any) => m.visitor_id === visitorId);
        const myRole = myMember?.role || "viewer";

        res.json({
          org,
          members,
          my_role: myRole,
        });
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
          "SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2",
          [org.id, visitorId],
        );
        if (
          !memberResult.rows.length ||
          memberResult.rows[0].role !== "admin"
        ) {
          return res
            .status(403)
            .json({ error: "Only admins can rename the team" });
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

  // POST /team/invite - create an invite
  router.post(
    "/team/invite",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const { email, role } = req.body;

        const org = await getOrCreateOrg(visitorId);

        const memberResult = await pool.query(
          "SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2",
          [org.id, visitorId],
        );
        if (
          !memberResult.rows.length ||
          memberResult.rows[0].role !== "admin"
        ) {
          return res
            .status(403)
            .json({ error: "Only admins can invite members" });
        }

        const validRole = role === "admin" ? "admin" : "viewer";
        const normalizedEmail = email ? email.trim().toLowerCase() : null;

        if (normalizedEmail) {
          const existing = await pool.query(
            `SELECT id, status FROM organization_members WHERE org_id = $1 AND LOWER(invited_email) = $2`,
            [org.id, normalizedEmail],
          );
          if (existing.rows.length > 0) {
            const match = existing.rows[0];
            if (match.status === "active") {
              return res
                .status(409)
                .json({ error: "This person is already a team member" });
            }
            await pool.query("DELETE FROM organization_members WHERE id = $1", [
              match.id,
            ]);
          }
        }

        const inviteToken = crypto.randomUUID();

        await pool.query(
          `INSERT INTO organization_members (org_id, invited_email, invite_token, role, status)
         VALUES ($1, $2, $3, $4, 'pending')`,
          [org.id, normalizedEmail, inviteToken, validRole],
        );

        res.json({ success: true, invite_token: inviteToken });
      } catch (err) {
        console.error("POST /team/invite error:", err);
        res.status(500).json({ error: "Failed to create invite" });
      }
    },
  );

  // GET /team/invite/:token - get invite info (no auth required)
  router.get("/team/invite/:token", async (req: Request, res: Response) => {
    try {
      const { token } = req.params;
      const result = await pool.query(
        `SELECT om.invited_email, om.role, o.name AS org_name
         FROM organization_members om
         JOIN organizations o ON o.id = om.org_id
         WHERE om.invite_token = $1 AND om.status = 'pending'`,
        [token],
      );

      if (!result.rows.length) {
        return res
          .status(404)
          .json({ error: "Invite not found or already used" });
      }

      const row = result.rows[0];
      res.json({
        org_name: row.org_name,
        invited_email: row.invited_email,
        role: row.role,
      });
    } catch (err) {
      console.error("GET /team/invite/:token error:", err);
      res.status(500).json({ error: "Failed to get invite info" });
    }
  });

  // POST /team/join/:token - accept an invite
  router.post(
    "/team/join/:token",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const { token } = req.params;

        const result = await pool.query(
          `SELECT om.*, o.id AS organization_id
         FROM organization_members om
         JOIN organizations o ON o.id = om.org_id
         WHERE om.invite_token = $1 AND om.status = 'pending'`,
          [token],
        );

        if (!result.rows.length) {
          return res
            .status(404)
            .json({ error: "Invite not found or already used" });
        }

        const invite = result.rows[0];

        await pool.query(
          `UPDATE organization_members
         SET visitor_id = $1, status = 'active', joined_at = NOW(), invite_token = NULL
         WHERE id = $2`,
          [visitorId, invite.id],
        );

        await pool.query(
          `INSERT INTO visitor_org_map (visitor_id, org_id) VALUES ($1, $2)
         ON CONFLICT (visitor_id) DO UPDATE SET org_id = $2`,
          [visitorId, invite.organization_id],
        );

        // Grant bonus credits to the org owner who invited
        try {
          const orgOwner = await pool.query(
            `SELECT owner_visitor_id FROM organizations WHERE id = $1`,
            [invite.organization_id],
          );
          const ownerVisitorId = orgOwner.rows[0]?.owner_visitor_id;
          if (ownerVisitorId) {
            await grantBonusCredits(pool, ownerVisitorId, "invite_accepted");
            await pool.query(
              `UPDATE accounts SET invite_credits_granted = COALESCE(invite_credits_granted, 0) + 1 WHERE visitor_id = $1`,
              [ownerVisitorId],
            );
          }
        } catch (creditErr) {
          console.error("Failed to grant invite bonus credits:", creditErr);
        }

        res.json({
          success: true,
          org_id: String(invite.organization_id),
          role: invite.role,
        });
      } catch (err) {
        console.error("POST /team/join/:token error:", err);
        res.status(500).json({ error: "Failed to accept invite" });
      }
    },
  );

  // PATCH /team/members/:id - update member role
  router.patch(
    "/team/members/:id",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;
        const memberId = req.params.id;
        const { role } = req.body;

        if (!role || !["admin", "viewer"].includes(role)) {
          return res.status(400).json({ error: "Invalid role" });
        }

        const org = await getOrCreateOrg(visitorId);

        const adminCheck = await pool.query(
          "SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2",
          [org.id, visitorId],
        );
        if (!adminCheck.rows.length || adminCheck.rows[0].role !== "admin") {
          return res
            .status(403)
            .json({ error: "Only admins can change roles" });
        }

        const targetMember = await pool.query(
          "SELECT * FROM organization_members WHERE id = $1 AND org_id = $2",
          [memberId, org.id],
        );
        if (!targetMember.rows.length) {
          return res.status(404).json({ error: "Member not found" });
        }

        if (targetMember.rows[0].visitor_id === visitorId && role !== "admin") {
          const adminCount = await pool.query(
            "SELECT COUNT(*) FROM organization_members WHERE org_id = $1 AND role = 'admin' AND status = 'active'",
            [org.id],
          );
          if (parseInt(adminCount.rows[0].count) <= 1) {
            return res.status(400).json({
              error: "Cannot demote yourself — you are the only admin",
            });
          }
        }

        const updateResult = await pool.query(
          "UPDATE organization_members SET role = $1 WHERE id = $2 AND org_id = $3 RETURNING id",
          [role, memberId, org.id],
        );

        if (!updateResult.rows.length) {
          return res.status(404).json({ error: "Member not found" });
        }

        res.json({ success: true });
      } catch (err) {
        console.error("PATCH /team/members/:id error:", err);
        res.status(500).json({ error: "Failed to update role" });
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

        const adminCheck = await pool.query(
          "SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2",
          [org.id, visitorId],
        );
        if (!adminCheck.rows.length || adminCheck.rows[0].role !== "admin") {
          return res
            .status(403)
            .json({ error: "Only admins can remove members" });
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

  // GET /team/my-role - get current user's role
  router.get(
    "/team/my-role",
    ensureVisitor,
    async (req: AuthRequest, res: Response) => {
      try {
        const visitorId = req.visitorId!;

        const mapResult = await pool.query(
          "SELECT org_id FROM visitor_org_map WHERE visitor_id = $1",
          [visitorId],
        );

        if (!mapResult.rows.length) {
          return res.json({ role: "viewer", org_id: "" });
        }

        const orgId = mapResult.rows[0].org_id;
        const memberResult = await pool.query(
          "SELECT role FROM organization_members WHERE org_id = $1 AND visitor_id = $2",
          [orgId, visitorId],
        );

        res.json({
          role: memberResult.rows.length ? memberResult.rows[0].role : "viewer",
          org_id: String(orgId),
        });
      } catch (err) {
        console.error("GET /team/my-role error:", err);
        res.status(500).json({ error: "Failed to get role" });
      }
    },
  );

  return router;
}
