import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bot, Send, User, Rocket, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { novaApi, type NovaChatMessage } from "../api/nova";
import { useNovaChat, type WsMessage } from "../hooks/useNovaChat";
import { queryKeys } from "../lib/queryKeys";

interface ChatMessage {
  role: "user" | "agent" | "system";
  content: string;
  timestamp: Date;
  streaming?: boolean;
  channel?: string;
}

const CHANNEL_MAP: Record<string, string> = {
  whatsapp: "WhatsApp",
  "whatsapp-group": "WhatsApp",
  telegram: "Telegram",
  slack: "Slack",
  discord: "Discord",
  platform: "Web",
  gmail: "Gmail",
};

const CHANNEL_COLORS: Record<string, string> = {
  WhatsApp: "bg-green-600",
  Telegram: "bg-blue-500",
  Slack: "bg-orange-500",
  Discord: "bg-purple-500",
  Web: "bg-cyan-500",
  Gmail: "bg-red-500",
  Instagram: "bg-pink-500",
};

function channelFromJid(jid: string): string | undefined {
  if (jid.includes("whatsapp")) return "WhatsApp";
  if (jid.startsWith("tg:")) return "Telegram";
  if (jid.startsWith("slack:")) return "Slack";
  if (jid.startsWith("dc:")) return "Discord";
  if (jid.startsWith("platform:")) return "Web";
  if (jid.includes("instagram")) return "Instagram";
  if (jid.includes("gmail:")) return "Gmail";
  return undefined;
}

/** Render message content with inline images */
function renderContent(content: string) {
  const parts: React.ReactNode[] = [];
  const imageMarkerRegex = /\[image:([\w.-]+)\]/g;
  const imageUrlRegex = /(https?:\/\/[^\s]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s]*)?)/gi;

  let remaining = content;

  // Handle [image:filename] markers
  const markerMatch = remaining.match(imageMarkerRegex);
  if (markerMatch) {
    for (const marker of markerMatch) {
      const idx = remaining.indexOf(marker);
      if (idx > 0) parts.push(remaining.slice(0, idx));
      const filename = marker.slice(7, -1);
      parts.push(
        <img
          key={filename}
          src={`/api/nova/media/${filename}`}
          alt="Attachment"
          className="max-w-full max-h-96 rounded-lg my-2 block"
          loading="lazy"
        />,
      );
      remaining = remaining.slice(idx + marker.length);
    }
  }

  // Handle image URLs in remaining text
  const urlParts = remaining.split(imageUrlRegex);
  for (let i = 0; i < urlParts.length; i++) {
    const part = urlParts[i];
    if (!part) continue;
    if (part.match(imageUrlRegex)) {
      parts.push(
        <img
          key={`url-${i}`}
          src={part}
          alt="Image"
          className="max-w-full max-h-96 rounded-lg my-2 block"
          loading="lazy"
        />,
      );
    } else {
      parts.push(part);
    }
  }

  if (parts.length === 0) return content;
  return <>{parts}</>;
}

export function NovaChat() {
  const [input, setInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [agentStatus, setAgentStatus] = useState<
    "loading" | "none" | "deploying" | "running" | "failed" | "stopped"
  >("loading");
  const [provisioning, setProvisioning] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Only connect WebSocket if agent is running
  const { connected, messages, send } = useNovaChat(agentStatus === "running");

  // Check agent status on load
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const data = await novaApi.getStatus();
        if (!data.environment) {
          setAgentStatus("none");
        } else {
          setAgentStatus((data.environment.status as typeof agentStatus) || "none");
        }
      } catch {
        setAgentStatus("none");
      }
    };
    checkStatus();
  }, []);

  // Poll status while deploying
  useEffect(() => {
    if (agentStatus !== "deploying") return;
    const interval = setInterval(async () => {
      try {
        const data = await novaApi.getStatus();
        if (data.environment?.status === "running") setAgentStatus("running");
        else if (data.environment?.status === "failed") setAgentStatus("failed");
      } catch {
        // keep polling
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [agentStatus]);

  // Fetch chat history when agent is running
  useEffect(() => {
    if (agentStatus !== "running") return;

    const fetchHistory = async () => {
      try {
        const data = await novaApi.getHistory(100);
        const history: ChatMessage[] = (data.messages ?? []).map((msg: NovaChatMessage) => {
          const isBot = !!(msg.is_from_me || msg.is_bot_message);
          const jid = (msg.chat_jid as string) || "";
          const channel = channelFromJid(jid);

          return {
            role: isBot ? "agent" : "user",
            content: msg.content || msg.text || "",
            timestamp: msg.timestamp ? new Date(msg.timestamp) : new Date(),
            channel,
          } as ChatMessage;
        });
        setChatMessages(history);
      } catch {
        // Silently ignore
      }
    };

    fetchHistory();
  }, [agentStatus]);

  // Handle incoming WebSocket messages
  useEffect(() => {
    const latest = messages[messages.length - 1];
    if (!latest) return;

    if (latest.type === "connected") {
      setAgentStatus("running");
    }

    if (latest.type === "stream") {
      setChatMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.streaming && last.role === "agent") {
          return [
            ...prev.slice(0, -1),
            { ...last, content: last.content + (latest.content as string) },
          ];
        }
        const filtered =
          last?.role === "system" && last.content.startsWith("Thinking")
            ? prev.slice(0, -1)
            : prev;
        return [
          ...filtered,
          {
            role: "agent",
            content: latest.content as string,
            timestamp: new Date(),
            streaming: true,
          },
        ];
      });
    }

    if (latest.type === "response_end") {
      setChatMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.streaming) {
          return [...prev.slice(0, -1), { ...last, streaming: false }];
        }
        return prev;
      });
    }

    if (latest.type === "thinking") {
      setChatMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last?.role === "system" && last.content.startsWith("Thinking")) return prev;
        return [...prev, { role: "system", content: "Thinking...", timestamp: new Date() }];
      });
    }

    if (latest.type === "error" && latest.content) {
      setChatMessages((prev) => [
        ...prev,
        { role: "system", content: latest.content as string, timestamp: new Date() },
      ]);
    }

    // Real-time cross-channel messages
    if (latest.type === "channel_message" && latest.message) {
      const msg = latest.message;
      const isBot = !!(msg.is_from_me || msg.is_bot_message);
      const channelLabel = CHANNEL_MAP[(msg.channel as string) || ""] || undefined;
      const newMsg: ChatMessage = {
        role: isBot ? "agent" : "user",
        content: (msg.content as string) || "",
        timestamp: msg.timestamp ? new Date(msg.timestamp as string) : new Date(),
        channel: channelLabel,
      };
      setChatMessages((prev) => {
        const last = prev[prev.length - 1];
        if (
          last &&
          last.content === newMsg.content &&
          last.role === newMsg.role &&
          Math.abs(last.timestamp.getTime() - newMsg.timestamp.getTime()) < 2000
        ) {
          return prev;
        }
        return [...prev, newMsg];
      });
    }
  }, [messages]);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleSend = () => {
    if (!input.trim() || !connected) return;
    setChatMessages((prev) => [
      ...prev,
      { role: "user", content: input, timestamp: new Date() },
    ]);
    send({ type: "chat", content: input });
    setInput("");
  };

  // Loading state
  if (agentStatus === "loading") {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No agent — show setup prompt
  if (agentStatus === "none" || agentStatus === "failed" || agentStatus === "stopped") {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center max-w-md">
          <Rocket className="h-12 w-12 mx-auto mb-4 text-primary" />
          <h2 className="text-xl font-semibold">Launch Your Nova Agent</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {agentStatus === "failed"
              ? "Previous launch failed. Try again — your agent will be deployed on Railway."
              : "Your personal AI agent will be deployed on Railway. It can chat, browse the web, handle email, generate images, and more."}
          </p>
          <Button
            className="mt-4"
            size="lg"
            onClick={() => {
              setProvisioning(true);
              // TODO: implement provisioning endpoint
              setAgentStatus("deploying");
              setProvisioning(false);
            }}
            disabled={provisioning}
          >
            <Rocket className="h-4 w-4 mr-2" />
            {agentStatus === "failed" ? "Retry Launch" : "Launch Agent"}
          </Button>
        </div>
      </div>
    );
  }

  // Deploying state
  if (agentStatus === "deploying") {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <h3 className="text-lg font-medium text-muted-foreground">Deploying your Nova agent...</h3>
        <p className="text-sm text-muted-foreground/60">
          Setting up on Railway. This takes 1-2 minutes.
        </p>
      </div>
    );
  }

  // Agent running — show chat
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-6 h-12 border-b border-border flex items-center gap-3 shrink-0">
        <Bot className="h-5 w-5 text-primary" />
        <span className="text-sm font-semibold">Your Nova Agent</span>
        <span
          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
            connected
              ? "bg-green-500/10 text-green-400"
              : "bg-red-500/10 text-red-400"
          }`}
        >
          {connected ? "Connected" : "Connecting..."}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-auto-hide">
        {chatMessages.length === 0 && (
          <div className="text-center mt-[20vh] text-muted-foreground">
            <Bot className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-muted-foreground/80">
              Your Nova agent is ready
            </h3>
            <p className="text-sm text-muted-foreground/50">Say hello to get started.</p>
          </div>
        )}

        {chatMessages.map((msg, i) => (
          <div
            key={i}
            className={`mb-4 flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[70%] rounded-xl px-4 py-3 ${
                msg.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : msg.role === "system"
                    ? "bg-muted/50 border border-border"
                    : "bg-card border border-border"
              }`}
            >
              {/* Header with role + channel badge */}
              <div className="flex items-center gap-1.5 mb-1">
                {msg.role === "agent" && <Bot className="h-3 w-3 text-primary" />}
                {msg.role === "user" && <User className="h-3 w-3" />}
                <span className="text-[11px] text-muted-foreground">
                  {msg.role === "user" ? "You" : msg.role === "agent" ? "Nova" : "System"}
                </span>
                {msg.channel && (
                  <span
                    className={`inline-flex items-center rounded px-1 py-0 text-[10px] font-medium text-white ${
                      CHANNEL_COLORS[msg.channel] || "bg-gray-500"
                    }`}
                  >
                    {msg.channel}
                  </span>
                )}
              </div>
              {/* Message content */}
              <div
                className={`text-sm whitespace-pre-wrap break-words ${
                  msg.role === "system" ? "text-yellow-500" : ""
                }`}
              >
                {renderContent(msg.content)}
              </div>
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-border flex gap-2 shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Message your Nova agent..."
          className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
          disabled={!connected}
        />
        <Button
          size="default"
          onClick={handleSend}
          disabled={!connected || !input.trim()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
