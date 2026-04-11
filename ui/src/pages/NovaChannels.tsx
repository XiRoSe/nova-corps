import { useQuery } from "@tanstack/react-query";
import {
  MessageCircle,
  Phone,
  Send,
  Hash,
  Mail,
  Loader2,
  CheckCircle2,
  XCircle,
  ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { novaApi, type NovaEnvironment } from "../api/nova";
import { queryKeys } from "../lib/queryKeys";
import type { LucideIcon } from "lucide-react";

interface ChannelConfig {
  id: string;
  name: string;
  icon: LucideIcon;
  color: string;
  connectedLabel: (env: NovaEnvironment) => string | null;
  disconnectedHelp: string;
}

const CHANNELS: ChannelConfig[] = [
  {
    id: "whatsapp",
    name: "WhatsApp",
    icon: Phone,
    color: "text-green-500",
    connectedLabel: (env) => (env.whatsappNumber ? `Connected: ${env.whatsappNumber}` : null),
    disconnectedHelp:
      "Scan the QR code in your Nova agent to connect WhatsApp. The agent will display a QR code at startup if WHATSAPP_ENABLED=true is set.",
  },
  {
    id: "telegram",
    name: "Telegram",
    icon: Send,
    color: "text-blue-500",
    connectedLabel: (env) => (env.telegramId ? `Bot: @${env.telegramId}` : null),
    disconnectedHelp:
      "Set TELEGRAM_BOT_TOKEN in your agent environment variables. Create a bot via @BotFather on Telegram to get your token.",
  },
  {
    id: "slack",
    name: "Slack",
    icon: Hash,
    color: "text-orange-500",
    connectedLabel: (env) => (env.slackWorkspace ? `Workspace: ${env.slackWorkspace}` : null),
    disconnectedHelp:
      "Set SLACK_BOT_TOKEN and SLACK_APP_TOKEN in your agent settings. Create a Slack app at api.slack.com and enable Socket Mode.",
  },
  {
    id: "discord",
    name: "Discord",
    icon: MessageCircle,
    color: "text-purple-500",
    connectedLabel: (env) => (env.discordGuild ? `Guild: ${env.discordGuild}` : null),
    disconnectedHelp:
      "Set DISCORD_BOT_TOKEN in your agent environment variables. Create a Discord bot at discord.com/developers and invite it to your server.",
  },
  {
    id: "gmail",
    name: "Gmail",
    icon: Mail,
    color: "text-red-500",
    connectedLabel: (env) => (env.gmailEmail ? `Email: ${env.gmailEmail}` : null),
    disconnectedHelp:
      "Set GMAIL_CREDENTIALS in your agent settings. You will need a Google Cloud OAuth client ID with Gmail API access enabled.",
  },
];

function ChannelCard({
  channel,
  isConnected,
  environment,
}: {
  channel: ChannelConfig;
  isConnected: boolean;
  environment: NovaEnvironment | null;
}) {
  const Icon = channel.icon;
  const connectedInfo = environment ? channel.connectedLabel(environment) : null;
  const connected = isConnected || !!connectedInfo;

  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`flex h-10 w-10 items-center justify-center rounded-lg bg-muted/50 ${channel.color}`}
          >
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-foreground">{channel.name}</h3>
            <div className="mt-0.5 flex items-center gap-1.5">
              {connected ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-xs text-green-500">Connected</span>
                </>
              ) : (
                <>
                  <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Disconnected</span>
                </>
              )}
            </div>
          </div>
        </div>
        {connected && (
          <Button variant="outline" size="sm" className="text-xs">
            Disconnect
          </Button>
        )}
      </div>

      <div className="mt-4">
        {connected && connectedInfo ? (
          <p className="text-sm text-muted-foreground">{connectedInfo}</p>
        ) : connected ? (
          <p className="text-sm text-muted-foreground">
            Channel is connected via your Nova agent.
          </p>
        ) : (
          <div className="rounded-md bg-muted/30 border border-border px-3 py-2.5">
            <p className="text-xs text-muted-foreground leading-relaxed">
              {channel.disconnectedHelp}
            </p>
          </div>
        )}
      </div>

      {!connected && (
        <div className="mt-3">
          <Button variant="outline" size="sm" className="text-xs gap-1.5">
            <ExternalLink className="h-3 w-3" />
            Setup Guide
          </Button>
        </div>
      )}
    </div>
  );
}

export function NovaChannels() {
  const statusQuery = useQuery({
    queryKey: queryKeys.novaStatus,
    queryFn: () => novaApi.getStatus(),
    refetchInterval: 30_000,
  });

  const channelsQuery = useQuery({
    queryKey: queryKeys.novaChannels,
    queryFn: () => novaApi.getChannels(),
    refetchInterval: 30_000,
  });

  const environment = statusQuery.data?.environment ?? null;
  const connectedChannelNames = new Set(
    (channelsQuery.data?.channels ?? environment?.channels ?? []).map((c: string) =>
      c.toLowerCase(),
    ),
  );

  const isLoading = statusQuery.isLoading || channelsQuery.isLoading;
  const agentRunning = environment?.status === "running";

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scrollbar-auto-hide">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-foreground">Channels</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your messaging channel connections. Your Nova agent can receive and respond to
            messages across all connected channels.
          </p>
        </div>

        {/* Agent status banner */}
        {!agentRunning && (
          <div className="mb-6 rounded-lg border border-border bg-muted/30 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {environment
                ? "Your Nova agent is not currently running. Channels will be unavailable until the agent is online."
                : "No Nova agent found. Deploy your agent from the Chat page to start connecting channels."}
            </p>
          </div>
        )}

        {/* Channel summary */}
        {agentRunning && (
          <div className="mb-6 flex items-center gap-4">
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-2xl font-bold text-foreground">{connectedChannelNames.size}</p>
              <p className="text-xs text-muted-foreground">Connected</p>
            </div>
            <div className="rounded-lg border border-border bg-card px-4 py-3">
              <p className="text-2xl font-bold text-foreground">
                {CHANNELS.length - connectedChannelNames.size}
              </p>
              <p className="text-xs text-muted-foreground">Available</p>
            </div>
          </div>
        )}

        {/* Channel cards */}
        <div className="grid gap-4">
          {CHANNELS.map((channel) => (
            <ChannelCard
              key={channel.id}
              channel={channel}
              isConnected={connectedChannelNames.has(channel.id)}
              environment={environment}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
