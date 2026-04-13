/**
 * Nova Messages API — direct messaging between agents and the owner.
 * Separate from task comments. This is the agent inbox.
 */
import { Router } from "express";
import { sql as rawSql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";

export function messagesRoutes(db: PgDatabase<any>) {
  const router = Router();

  // GET /companies/:companyId/messages — list messages for the owner
  router.get("/companies/:companyId/messages", async (req, res) => {
    try {
      const { companyId } = req.params;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const unreadOnly = req.query.unread === "true";

      const filter = unreadOnly
        ? rawSql`AND is_read = false`
        : rawSql``;

      const messages = await db.execute(
        rawSql`SELECT * FROM nova_messages WHERE company_id = ${companyId} ${filter} ORDER BY created_at DESC LIMIT ${limit}`,
      );

      res.json(messages.rows ?? messages);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /companies/:companyId/messages — send a message (from agent or owner)
  router.post("/companies/:companyId/messages", async (req, res) => {
    try {
      const { companyId } = req.params;
      const { senderType, senderAgentId, senderName, recipientType, subject, body, tag, relatedIssueId, relatedIssueIdentifier } = req.body;

      if (!body || !senderName || !senderType) {
        return res.status(400).json({ error: "body, senderName, and senderType are required" });
      }

      const result = await db.execute(
        rawSql`INSERT INTO nova_messages (company_id, sender_type, sender_agent_id, sender_name, recipient_type, subject, body, tag, related_issue_id, related_issue_identifier)
        VALUES (${companyId}, ${senderType}, ${senderAgentId || null}, ${senderName}, ${recipientType || "owner"}, ${subject || null}, ${body}, ${tag || null}, ${relatedIssueId || null}, ${relatedIssueIdentifier || null})
        RETURNING *`,
      );

      res.status(201).json((result.rows ?? result)[0]);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // PATCH /messages/:messageId/read — mark a message as read
  router.patch("/messages/:messageId/read", async (req, res) => {
    try {
      const { messageId } = req.params;
      await db.execute(
        rawSql`UPDATE nova_messages SET is_read = true, updated_at = now() WHERE id = ${messageId}`,
      );
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /messages/:messageId/reply — owner replies to a message
  router.post("/messages/:messageId/reply", async (req, res) => {
    try {
      const { messageId } = req.params;
      const { body } = req.body;

      if (!body) return res.status(400).json({ error: "body is required" });

      // Get original message to get context
      const original = await db.execute(
        rawSql`SELECT * FROM nova_messages WHERE id = ${messageId}`,
      );
      const origMsg = (original.rows ?? original)[0] as any;
      if (!origMsg) return res.status(404).json({ error: "Message not found" });

      // Mark original as read
      await db.execute(
        rawSql`UPDATE nova_messages SET is_read = true, updated_at = now() WHERE id = ${messageId}`,
      );

      // Create reply message
      const result = await db.execute(
        rawSql`INSERT INTO nova_messages (company_id, sender_type, sender_name, recipient_type, subject, body, tag, related_issue_id, related_issue_identifier)
        VALUES (${origMsg.company_id}, 'owner', 'Owner', 'agent', ${origMsg.subject ? 'Re: ' + origMsg.subject : null}, ${body}, 'reply', ${origMsg.related_issue_id}, ${origMsg.related_issue_identifier})
        RETURNING *`,
      );

      res.status(201).json((result.rows ?? result)[0]);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /companies/:companyId/messages/unread-count — for sidebar badge
  router.get("/companies/:companyId/messages/unread-count", async (req, res) => {
    try {
      const { companyId } = req.params;
      const result = await db.execute(
        rawSql`SELECT COUNT(*)::int as count FROM nova_messages WHERE company_id = ${companyId} AND is_read = false AND recipient_type = 'owner'`,
      );
      res.json({ count: ((result.rows ?? result)[0] as any)?.count ?? 0 });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
