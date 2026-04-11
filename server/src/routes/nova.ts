/**
 * Nova Agent Routes
 *
 * Provides the bridge between Nova Corps UI and per-user Nova agent
 * environments running on Railway. Handles:
 * - Agent status checking
 * - Chat message proxying
 * - Chat history retrieval
 * - Media proxying (images from channels)
 * - Channel connection status
 * - Cost/usage tracking
 */

import { Router } from "express";
import { eq, and, gte, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { novaEnvironments, novaUsageRecords } from "@paperclipai/db";
import { assertBoard } from "./authz.js";
import {
  createAgentService,
  deleteAgentService,
  restartAgentService,
} from "../services/nova-railway-manager.js";

export function novaRoutes(db: Db) {
  const router = Router();

  // Get agent environment status for the current user
  router.get("/nova/status", async (req, res) => {
    try {
      assertBoard(req);
      const userId = req.actor.userId!;

      const envs = await db
        .select()
        .from(novaEnvironments)
        .where(eq(novaEnvironments.userId, userId));

      if (envs.length === 0) {
        res.json({ environment: null });
        return;
      }

      const env = envs[0];

      // If agent has a Railway URL, check if it's actually healthy
      if (env.railwayUrl && env.status === "running") {
        try {
          const health = await fetch(`https://${env.railwayUrl}/health`, {
            signal: AbortSignal.timeout(5000),
          });
          if (health.ok) {
            const data = await health.json();
            res.json({
              environment: {
                ...env,
                channels: data.channels || [],
              },
            });
            return;
          }
        } catch {
          // Agent unreachable — still return the env data
        }
      }

      res.json({ environment: env });
    } catch (err) {
      res.status(500).json({ error: "Failed to fetch agent status" });
    }
  });

  // Get channel connection info for the current user
  router.get("/nova/channels", async (req, res) => {
    try {
      assertBoard(req);
      const userId = req.actor.userId!;

      const envs = await db
        .select()
        .from(novaEnvironments)
        .where(eq(novaEnvironments.userId, userId));

      if (envs.length === 0) {
        res.json({ channels: [] });
        return;
      }

      const env = envs[0];
      let connectedChannels: string[] = [];

      // If agent has a Railway URL, fetch live channel data from /health
      if (env.railwayUrl && env.status === "running") {
        try {
          const health = await fetch(`https://${env.railwayUrl}/health`, {
            signal: AbortSignal.timeout(5000),
          });
          if (health.ok) {
            const data = await health.json();
            connectedChannels = data.channels || [];
          }
        } catch {
          // Agent unreachable — fall back to stored metadata
        }
      }

      // If no live data, infer from stored environment metadata
      if (connectedChannels.length === 0) {
        if (env.whatsappNumber) connectedChannels.push("whatsapp");
        if (env.telegramId) connectedChannels.push("telegram");
        if (env.slackWorkspace) connectedChannels.push("slack");
        if (env.discordGuild) connectedChannels.push("discord");
        if (env.gmailEmail) connectedChannels.push("gmail");
      }

      res.json({
        channels: connectedChannels,
        metadata: {
          whatsappNumber: env.whatsappNumber,
          telegramId: env.telegramId,
          slackWorkspace: env.slackWorkspace,
          discordGuild: env.discordGuild,
          gmailEmail: env.gmailEmail,
        },
      });
    } catch {
      res.status(500).json({ error: "Failed to fetch channels" });
    }
  });

  // Send a chat message to the user's Nova agent (HTTP fallback)
  router.post("/nova/chat", async (req, res) => {
    try {
      assertBoard(req);
      const userId = req.actor.userId!;
      const { message } = req.body;

      if (!message) {
        res.status(400).json({ error: "Message required" });
        return;
      }

      const envs = await db
        .select()
        .from(novaEnvironments)
        .where(eq(novaEnvironments.userId, userId));

      if (envs.length === 0 || !envs[0].railwayUrl) {
        res.status(404).json({ error: "No running agent environment" });
        return;
      }

      const agentUrl = `https://${envs[0].railwayUrl}`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      const agentRes = await fetch(`${agentUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!agentRes.ok) {
        const errText = await agentRes.text();
        res.status(502).json({ error: `Agent error: ${errText}` });
        return;
      }

      const agentData = await agentRes.json();

      // Record usage
      await db.insert(novaUsageRecords).values({
        userId,
        envId: envs[0].id,
        type: "claude",
        amount: "0.02",
        metadata: { channel: "platform", message: message?.slice(0, 100) },
      });

      res.json({ response: agentData.response || "No response from agent." });
    } catch (err) {
      res.status(500).json({ error: "Failed to send message" });
    }
  });

  // Get chat history from the Nova agent
  router.get("/nova/history", async (req, res) => {
    try {
      assertBoard(req);
      const userId = req.actor.userId!;
      const limit = parseInt(req.query.limit as string) || 100;

      const envs = await db
        .select()
        .from(novaEnvironments)
        .where(eq(novaEnvironments.userId, userId));

      if (envs.length === 0 || !envs[0].railwayUrl) {
        res.json({ messages: [] });
        return;
      }

      const agentUrl = `https://${envs[0].railwayUrl}`;
      const agentRes = await fetch(`${agentUrl}/api/history?limit=${limit}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (!agentRes.ok) {
        res.json({ messages: [] });
        return;
      }

      const data = await agentRes.json();
      res.json(data);
    } catch {
      res.json({ messages: [] });
    }
  });

  // Get live messages from the Nova agent (for cross-channel real-time push)
  router.get("/nova/live-messages", async (req, res) => {
    try {
      assertBoard(req);
      const userId = req.actor.userId!;
      const since = req.query.since as string;

      const envs = await db
        .select()
        .from(novaEnvironments)
        .where(eq(novaEnvironments.userId, userId));

      if (envs.length === 0 || !envs[0].railwayUrl) {
        res.json({ messages: [] });
        return;
      }

      const agentUrl = `https://${envs[0].railwayUrl}`;
      const agentRes = await fetch(
        `${agentUrl}/api/live-messages?since=${encodeURIComponent(since || new Date().toISOString())}`,
        { signal: AbortSignal.timeout(5000) },
      );

      if (!agentRes.ok) {
        res.json({ messages: [] });
        return;
      }

      const data = await agentRes.json();

      // Record cross-channel messages in Postgres for persistent counts
      if (data.messages?.length > 0) {
        let botResponses = 0;
        let userMessages = 0;
        for (const msg of data.messages) {
          if (msg.channel !== "platform") {
            if (msg.is_bot_message) botResponses++;
            else userMessages++;
          }
        }
        if (botResponses + userMessages > 0) {
          await db.insert(novaUsageRecords).values({
            userId,
            envId: envs[0].id,
            type: "message",
            amount: String(botResponses * 0.02),
            metadata: { bot: botResponses, user: userMessages, source: "cross-channel" },
          }).catch(() => {});
        }
      }

      res.json(data);
    } catch {
      res.json({ messages: [] });
    }
  });

  // Proxy media files from the Nova agent (images from Telegram, WhatsApp, etc.)
  router.get("/nova/media/:filename", async (req, res) => {
    try {
      assertBoard(req);
      const userId = req.actor.userId!;
      const { filename } = req.params;

      const envs = await db
        .select()
        .from(novaEnvironments)
        .where(eq(novaEnvironments.userId, userId));

      if (envs.length === 0 || !envs[0].railwayUrl) {
        res.status(404).json({ error: "No agent" });
        return;
      }

      const agentUrl = `https://${envs[0].railwayUrl}`;
      const agentRes = await fetch(`${agentUrl}/media/${filename}`, {
        signal: AbortSignal.timeout(10000),
      });

      if (!agentRes.ok) {
        res.status(404).json({ error: "Media not found" });
        return;
      }

      const contentType = agentRes.headers.get("content-type") || "application/octet-stream";
      res.set("Content-Type", contentType);
      res.set("Cache-Control", "public, max-age=86400");

      const buffer = Buffer.from(await agentRes.arrayBuffer());
      res.send(buffer);
    } catch {
      res.status(500).json({ error: "Failed to proxy media" });
    }
  });

  // Get cost/usage summary
  router.get("/nova/costs", async (req, res) => {
    try {
      assertBoard(req);
      const userId = req.actor.userId!;

      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const todayRecords = await db
        .select({ total: sql<string>`COALESCE(SUM(${novaUsageRecords.amount}::numeric), 0)` })
        .from(novaUsageRecords)
        .where(and(
          eq(novaUsageRecords.userId, userId),
          gte(novaUsageRecords.createdAt, todayStart),
        ));

      const monthRecords = await db
        .select({ total: sql<string>`COALESCE(SUM(${novaUsageRecords.amount}::numeric), 0)` })
        .from(novaUsageRecords)
        .where(and(
          eq(novaUsageRecords.userId, userId),
          gte(novaUsageRecords.createdAt, monthStart),
        ));

      // Count messages from metadata
      const msgCount = await db
        .select({
          total: sql<string>`COALESCE(SUM(
            CASE
              WHEN ${novaUsageRecords.type} = 'claude' THEN 1
              WHEN ${novaUsageRecords.type} = 'message' THEN
                COALESCE((${novaUsageRecords.metadata}->>'bot')::int, 0) +
                COALESCE((${novaUsageRecords.metadata}->>'user')::int, 0)
              ELSE 0
            END
          ), 0)`,
        })
        .from(novaUsageRecords)
        .where(and(
          eq(novaUsageRecords.userId, userId),
          gte(novaUsageRecords.createdAt, monthStart),
        ));

      const todayCost = parseFloat(todayRecords[0]?.total || "0");
      const monthCost = parseFloat(monthRecords[0]?.total || "0");
      const monthMessages = parseInt(msgCount[0]?.total || "0");

      res.json({
        costs: {
          today: Math.round(todayCost * 100) / 100,
          month: Math.round(monthCost * 100) / 100,
          messageCount: monthMessages,
        },
      });
    } catch {
      res.status(500).json({ error: "Failed to fetch costs" });
    }
  });

  // Get notifications from the Nova agent
  router.get("/nova/notifications", async (req, res) => {
    try {
      assertBoard(req);
      const userId = req.actor.userId!;

      const envs = await db
        .select()
        .from(novaEnvironments)
        .where(eq(novaEnvironments.userId, userId));

      if (envs.length === 0 || !envs[0].railwayUrl) {
        res.json({ notifications: [] });
        return;
      }

      const agentUrl = `https://${envs[0].railwayUrl}`;
      const agentRes = await fetch(`${agentUrl}/api/notifications`, {
        signal: AbortSignal.timeout(5000),
      });

      if (!agentRes.ok) {
        res.json({ notifications: [] });
        return;
      }

      const data = await agentRes.json();
      res.json(data);
    } catch {
      res.json({ notifications: [] });
    }
  });

  // -----------------------------------------------------------------------
  // Provision a new Nova agent environment on Railway
  // -----------------------------------------------------------------------
  router.post("/nova/provision", async (req, res) => {
    try {
      assertBoard(req);
      const userId = req.actor.userId!;

      // Check if user already has an environment
      const existing = await db
        .select()
        .from(novaEnvironments)
        .where(eq(novaEnvironments.userId, userId));

      if (existing.length > 0) {
        const env = existing[0];
        if (env.status === "running" || env.status === "provisioning") {
          res
            .status(409)
            .json({ error: "Agent environment already exists", environment: env });
          return;
        }
      }

      // Create a DB record in "provisioning" state
      const extraVars =
        req.body.extraVars && typeof req.body.extraVars === "object"
          ? (req.body.extraVars as Record<string, string>)
          : undefined;

      const inserted = await db
        .insert(novaEnvironments)
        .values({
          userId,
          status: "provisioning",
          config: { extraVars },
        })
        .returning();

      const envRecord = inserted[0];

      // Kick off Railway provisioning (runs in the background so we can
      // return quickly; the status route lets the client poll for readiness).
      createAgentService(userId, envRecord.id, { extraVars })
        .then(async (result) => {
          await db
            .update(novaEnvironments)
            .set({
              railwayServiceId: result.serviceId,
              railwayServiceName: result.serviceName,
              railwayUrl: result.domain,
              status: "running",
              updatedAt: new Date(),
            })
            .where(eq(novaEnvironments.id, envRecord.id));
        })
        .catch(async (err) => {
          console.error("[nova/provision] Railway provisioning failed:", err);
          await db
            .update(novaEnvironments)
            .set({ status: "error", updatedAt: new Date() })
            .where(eq(novaEnvironments.id, envRecord.id));
        });

      res.json({ environment: envRecord });
    } catch (err) {
      console.error("[nova/provision]", err);
      res.status(500).json({ error: "Failed to provision agent" });
    }
  });

  // -----------------------------------------------------------------------
  // Stop (delete) the user's Nova agent environment
  // -----------------------------------------------------------------------
  router.post("/nova/stop", async (req, res) => {
    try {
      assertBoard(req);
      const userId = req.actor.userId!;

      const envs = await db
        .select()
        .from(novaEnvironments)
        .where(eq(novaEnvironments.userId, userId));

      if (envs.length === 0) {
        res.status(404).json({ error: "No agent environment found" });
        return;
      }

      const env = envs[0];

      if (env.railwayServiceId) {
        await db
          .update(novaEnvironments)
          .set({ status: "stopping", updatedAt: new Date() })
          .where(eq(novaEnvironments.id, env.id));

        try {
          await deleteAgentService(env.railwayServiceId);
        } catch (err) {
          console.error("[nova/stop] Railway delete failed:", err);
          // Continue — mark as stopped locally even if Railway call fails
        }
      }

      await db
        .update(novaEnvironments)
        .set({
          status: "stopped",
          railwayUrl: null,
          railwayServiceId: null,
          railwayServiceName: null,
          updatedAt: new Date(),
        })
        .where(eq(novaEnvironments.id, env.id));

      res.json({ success: true });
    } catch (err) {
      console.error("[nova/stop]", err);
      res.status(500).json({ error: "Failed to stop agent" });
    }
  });

  // -----------------------------------------------------------------------
  // Restart a stopped Nova agent environment
  // -----------------------------------------------------------------------
  router.post("/nova/start", async (req, res) => {
    try {
      assertBoard(req);
      const userId = req.actor.userId!;

      const envs = await db
        .select()
        .from(novaEnvironments)
        .where(eq(novaEnvironments.userId, userId));

      if (envs.length === 0) {
        res.status(404).json({ error: "No agent environment found" });
        return;
      }

      const env = envs[0];

      // If the service was fully deleted we need to re-provision
      if (!env.railwayServiceId) {
        await db
          .update(novaEnvironments)
          .set({ status: "provisioning", updatedAt: new Date() })
          .where(eq(novaEnvironments.id, env.id));

        const extraVars =
          env.config && typeof env.config === "object" && "extraVars" in env.config
            ? (env.config.extraVars as Record<string, string> | undefined)
            : undefined;

        createAgentService(userId, env.id, { extraVars })
          .then(async (result) => {
            await db
              .update(novaEnvironments)
              .set({
                railwayServiceId: result.serviceId,
                railwayServiceName: result.serviceName,
                railwayUrl: result.domain,
                status: "running",
                updatedAt: new Date(),
              })
              .where(eq(novaEnvironments.id, env.id));
          })
          .catch(async (err) => {
            console.error("[nova/start] Railway provisioning failed:", err);
            await db
              .update(novaEnvironments)
              .set({ status: "error", updatedAt: new Date() })
              .where(eq(novaEnvironments.id, env.id));
          });

        res.json({ environment: { ...env, status: "provisioning" } });
        return;
      }

      // Service ID exists — just trigger a redeploy
      await db
        .update(novaEnvironments)
        .set({ status: "starting", updatedAt: new Date() })
        .where(eq(novaEnvironments.id, env.id));

      restartAgentService(env.railwayServiceId)
        .then(async () => {
          await db
            .update(novaEnvironments)
            .set({ status: "running", updatedAt: new Date() })
            .where(eq(novaEnvironments.id, env.id));
        })
        .catch(async (err) => {
          console.error("[nova/start] Railway restart failed:", err);
          await db
            .update(novaEnvironments)
            .set({ status: "error", updatedAt: new Date() })
            .where(eq(novaEnvironments.id, env.id));
        });

      res.json({ environment: { ...env, status: "starting" } });
    } catch (err) {
      console.error("[nova/start]", err);
      res.status(500).json({ error: "Failed to start agent" });
    }
  });

  return router;
}
