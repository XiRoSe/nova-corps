/**
 * Nova Chat WebSocket Bridge
 *
 * Real-time bridge between the Nova Corps UI and the user's Nova agent.
 * Handles:
 * - User messages → agent HTTP API
 * - Agent responses → user via WebSocket
 * - Cross-channel message polling (WhatsApp, Telegram, etc.)
 * - Notification polling
 * - Usage tracking in Postgres
 */

import type { IncomingMessage, Server as HttpServer } from "node:http";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import { eq, and } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { novaEnvironments, novaUsageRecords } from "@paperclipai/db";
import type { DeploymentMode } from "@paperclipai/shared";
import type { BetterAuthSessionResult } from "../auth/better-auth.js";
import { logger } from "../middleware/logger.js";
import { instanceUserRoles, companyMemberships } from "@paperclipai/db";

const require = createRequire(import.meta.url);
const { WebSocket, WebSocketServer } = require("ws") as {
  WebSocket: { OPEN: number };
  WebSocketServer: new (opts: { noServer: boolean }) => WsServer;
};

interface WsSocket {
  readyState: number;
  ping(): void;
  send(data: string): void;
  terminate(): void;
  close(code?: number, reason?: string): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

interface WsServer {
  clients: Set<WsSocket>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  handleUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws: WsSocket) => void,
  ): void;
  emit(event: string, ...args: unknown[]): boolean;
}

function headersFromReq(req: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [key, raw] of Object.entries(req.headers)) {
    if (!raw) continue;
    if (Array.isArray(raw)) {
      for (const v of raw) headers.append(key, v);
    } else {
      headers.set(key, raw);
    }
  }
  return headers;
}

export function setupNovaChatWebSocket(
  server: HttpServer,
  db: Db,
  opts: {
    deploymentMode: DeploymentMode;
    resolveSessionFromHeaders?: (headers: Headers) => Promise<BetterAuthSessionResult | null>;
  },
) {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", async (ws: WsSocket, req: IncomingMessage & { novaChatUserId?: string }) => {
    const userId = req.novaChatUserId;
    if (!userId) {
      ws.close(4001, "No user");
      return;
    }

    // Find the user's agent environment
    const envs = await db
      .select()
      .from(novaEnvironments)
      .where(eq(novaEnvironments.userId, userId));

    if (envs.length === 0 || envs[0].status !== "running") {
      ws.send(JSON.stringify({
        type: "error",
        message: "No running agent environment. Provision one first.",
      }));
      ws.close(4004, "No agent environment");
      return;
    }

    const env = envs[0];
    if (!env.railwayUrl) {
      ws.send(JSON.stringify({
        type: "error",
        message: "Agent is running but has no URL yet. Try again in a moment.",
      }));
      ws.close(4503, "No agent URL");
      return;
    }

    const agentBaseUrl = `https://${env.railwayUrl}`;

    // Verify agent is reachable
    try {
      const health = await fetch(`${agentBaseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      if (!health.ok) throw new Error("Agent not healthy");
    } catch {
      ws.send(JSON.stringify({
        type: "error",
        message: "Agent is not reachable. It may still be starting up.",
      }));
      ws.close(4503, "Agent unreachable");
      return;
    }

    // Connected — send status and any pending notifications
    try {
      const healthData = await (await fetch(`${agentBaseUrl}/health`)).json();
      ws.send(JSON.stringify({ type: "connected", message: "Connected to your Nova agent" }));

      if (healthData.notifications?.length > 0) {
        for (const notif of healthData.notifications) {
          ws.send(JSON.stringify({ type: "stream", content: notif.message }));
        }
        ws.send(JSON.stringify({ type: "response_end" }));
        fetch(`${agentBaseUrl}/api/notifications`).catch(() => {});
      }
    } catch {
      ws.send(JSON.stringify({ type: "connected", message: "Connected" }));
    }

    // Track cursor for live message polling
    let liveMessageCursor = new Date().toISOString();

    // Notification polling — every 5s
    const notificationInterval = setInterval(async () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        const notifRes = await fetch(`${agentBaseUrl}/api/notifications`, {
          signal: AbortSignal.timeout(4000),
        });
        if (notifRes.ok) {
          const data = await notifRes.json();
          if (data.notifications?.length > 0) {
            for (const notif of data.notifications) {
              ws.send(JSON.stringify({ type: "stream", content: notif.message }));
            }
            ws.send(JSON.stringify({ type: "response_end" }));
          }
        }
      } catch {
        // Agent might be restarting
      }
    }, 5000);

    // Live message polling — push cross-channel messages to web chat in real-time
    const liveMessageInterval = setInterval(async () => {
      if (ws.readyState !== WebSocket.OPEN) return;
      try {
        const res = await fetch(
          `${agentBaseUrl}/api/live-messages?since=${encodeURIComponent(liveMessageCursor)}`,
          { signal: AbortSignal.timeout(4000) },
        );
        if (res.ok) {
          const data = await res.json();
          if (data.messages?.length > 0) {
            let botResponses = 0;
            let userMessages = 0;
            for (const msg of data.messages) {
              ws.send(JSON.stringify({ type: "channel_message", message: msg }));
              if (msg.channel !== "platform") {
                if (msg.is_bot_message) botResponses++;
                else userMessages++;
              }
            }
            // Record cross-channel messages in Postgres for persistent counts
            if (botResponses + userMessages > 0) {
              db.insert(novaUsageRecords).values({
                userId,
                envId: env.id,
                type: "message",
                amount: String(botResponses * 0.02),
                metadata: { bot: botResponses, user: userMessages, source: "cross-channel" },
              }).catch(() => {});
            }
            liveMessageCursor = data.messages[data.messages.length - 1].timestamp;
          }
        }
      } catch {
        // Agent might be restarting
      }
    }, 3000);

    // Handle messages from the user
    ws.on("message", async (data: unknown) => {
      try {
        const raw = typeof data === "string" ? data : (data as Buffer).toString();
        const message = JSON.parse(raw);

        if (message.type === "chat" && message.content) {
          ws.send(JSON.stringify({ type: "thinking", content: "Thinking..." }));

          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 30000);
            const agentRes = await fetch(`${agentBaseUrl}/api/chat`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: message.content }),
              signal: controller.signal,
            });
            clearTimeout(timeout);

            if (!agentRes.ok) {
              const errText = await agentRes.text();
              ws.send(JSON.stringify({ type: "error", content: `Agent error: ${errText}` }));
              return;
            }

            const agentData = await agentRes.json();

            // Record usage
            db.insert(novaUsageRecords).values({
              userId,
              envId: env.id,
              type: "claude",
              amount: "0.02",
              metadata: { channel: "platform", message: message.content?.slice(0, 100) },
            }).catch(() => {});

            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: "stream",
                content: agentData.response || "No response from agent.",
              }));
              ws.send(JSON.stringify({ type: "response_end" }));
            }
          } catch {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({
                type: "stream",
                content: "I'm restarting to apply changes (this takes about 2 minutes). I'll send you any setup info as soon as I'm back.",
              }));
              ws.send(JSON.stringify({ type: "response_end" }));
            }
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      clearInterval(notificationInterval);
      clearInterval(liveMessageInterval);
    });
  });

  // Handle upgrade requests for /api/nova/chat/ws
  server.on("upgrade", (req, socket, head) => {
    if (!req.url) return;

    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/api/nova/chat/ws") return;

    // Authenticate
    void authenticateNovaChatUpgrade(db, req, url, opts)
      .then((userId) => {
        if (!userId) {
          socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\nForbidden");
          socket.destroy();
          return;
        }

        (req as IncomingMessage & { novaChatUserId?: string }).novaChatUserId = userId;

        wss.handleUpgrade(req, socket, head, (ws: WsSocket) => {
          wss.emit("connection", ws, req);
        });
      })
      .catch((err) => {
        logger.error({ err }, "Nova chat WS upgrade failed");
        socket.write("HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n");
        socket.destroy();
      });
  });

  logger.info("Nova chat WebSocket bridge ready on /api/nova/chat/ws");
  return wss;
}

async function authenticateNovaChatUpgrade(
  db: Db,
  req: IncomingMessage,
  url: URL,
  opts: {
    deploymentMode: DeploymentMode;
    resolveSessionFromHeaders?: (headers: Headers) => Promise<BetterAuthSessionResult | null>;
  },
): Promise<string | null> {
  // In local_trusted mode, return a default user
  if (opts.deploymentMode === "local_trusted") {
    return "local-user";
  }

  // Try session-based auth
  if (opts.resolveSessionFromHeaders) {
    const session = await opts.resolveSessionFromHeaders(headersFromReq(req));
    if (session?.user?.id) return session.user.id;
  }

  // Try token query param (for backwards compatibility)
  const token = url.searchParams.get("token")?.trim();
  if (token) {
    // Simple JWT verification — import jsonwebtoken if available
    // For now, use session-based auth only
  }

  return null;
}
