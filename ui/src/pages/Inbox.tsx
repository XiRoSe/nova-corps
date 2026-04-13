import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  Inbox as InboxIcon,
  HelpCircle,
  AlertTriangle,
  CheckCircle2,
  Lightbulb,
  Send,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { messagesApi, type NovaMessage } from "@/api/messages";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";

type TagType = "question" | "blocker" | "decision" | "done" | "reply" | "message";

function detectTag(tag: string | null, body: string): TagType {
  if (tag === "reply") return "reply";
  if (tag === "question" || body.includes("**Question**")) return "question";
  if (tag === "blocker" || body.includes("**Blocker**")) return "blocker";
  if (tag === "decision" || body.includes("**Decision**")) return "decision";
  if (tag === "done" || body.includes("**Done**")) return "done";
  return "message";
}

const TAG_CONFIG: Record<TagType, { label: string; color: string; icon: typeof HelpCircle }> = {
  question: { label: "Question", color: "bg-blue-500/10 text-blue-400", icon: HelpCircle },
  blocker: { label: "Blocker", color: "bg-red-500/10 text-red-400", icon: AlertTriangle },
  decision: { label: "Decision", color: "bg-purple-500/10 text-purple-400", icon: Lightbulb },
  done: { label: "Done", color: "bg-green-500/10 text-green-400", icon: CheckCircle2 },
  reply: { label: "Your Reply", color: "bg-muted text-muted-foreground", icon: User },
  message: { label: "Message", color: "bg-muted text-muted-foreground", icon: Bot },
};

function stripTags(body: string): string {
  return body.replace(/^\*\*(Question|Blocker|Decision|Done|Update)\*\*:?\s*/i, "").replace(/@owner,?\s*/gi, "").trim();
}

function timeAgo(date: Date): string {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function Inbox() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  useEffect(() => {
    setBreadcrumbs([{ label: "Inbox" }]);
  }, [setBreadcrumbs]);

  const { data: messages, isLoading } = useQuery({
    queryKey: ["nova-messages", selectedCompanyId],
    queryFn: () => messagesApi.list(selectedCompanyId!, { limit: 50 }),
    enabled: !!selectedCompanyId,
    refetchInterval: 15_000,
  });

  const markRead = useMutation({
    mutationFn: (id: string) => messagesApi.markRead(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["nova-messages"] }),
  });

  const sendReply = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => messagesApi.reply(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nova-messages"] });
      setReplyingTo(null);
      setReplyText("");
    },
  });

  const unreadCount = (messages ?? []).filter((m) => !m.is_read && m.recipient_type === "owner").length;

  if (!selectedCompanyId) {
    return <EmptyState icon={InboxIcon} message="Select a company." />;
  }
  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <h1 className="text-lg font-semibold text-foreground">Inbox</h1>
        {unreadCount > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-blue-500 text-white text-xs font-medium min-w-[20px] h-5 px-1.5">
            {unreadCount}
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          Direct messages from your agents
        </span>
      </div>

      {/* Messages */}
      {(messages ?? []).length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState icon={InboxIcon} message="No messages from your agents yet." />
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-y-auto flex-1">
          {(messages ?? []).map((msg) => {
            const tag = detectTag(msg.tag, msg.body);
            const cfg = TAG_CONFIG[tag];
            const Icon = cfg.icon;
            const isOwnerMsg = msg.sender_type === "owner";

            return (
              <li key={msg.id}>
                {/* Message row */}
                <div
                  className={`flex items-start gap-3 px-6 py-4 ${!msg.is_read && !isOwnerMsg ? "bg-blue-500/5" : ""} hover:bg-muted/30 transition-colors cursor-pointer`}
                  onClick={() => {
                    if (!msg.is_read && !isOwnerMsg) markRead.mutate(msg.id);
                    setReplyingTo(replyingTo === msg.id ? null : msg.id);
                  }}
                >
                  {/* Unread dot */}
                  <div className="w-2 shrink-0 pt-2">
                    {!msg.is_read && !isOwnerMsg && <span className="w-2 h-2 rounded-full bg-blue-500 block" />}
                  </div>

                  {/* Avatar */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isOwnerMsg ? "bg-muted" : cfg.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${!msg.is_read && !isOwnerMsg ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                        {isOwnerMsg ? "You" : msg.sender_name}
                      </span>
                      {!isOwnerMsg && (
                        <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${cfg.color}`}>
                          {cfg.label}
                        </span>
                      )}
                      {msg.related_issue_identifier && (
                        <span className="text-[11px] text-muted-foreground/60">{msg.related_issue_identifier}</span>
                      )}
                    </div>
                    <p className={`text-sm mt-1 whitespace-pre-wrap ${!msg.is_read && !isOwnerMsg ? "text-foreground" : "text-muted-foreground"}`}>
                      {stripTags(msg.body).slice(0, 500)}
                    </p>
                  </div>

                  {/* Time */}
                  <span className="text-xs text-muted-foreground shrink-0 pt-1">
                    {timeAgo(new Date(msg.created_at))}
                  </span>
                </div>

                {/* Reply area */}
                {replyingTo === msg.id && !isOwnerMsg && (
                  <div className="px-6 pb-4 pl-[4.5rem] flex gap-2">
                    <input
                      type="text"
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && replyText.trim() && sendReply.mutate({ id: msg.id, body: replyText.trim() })}
                      placeholder={`Reply to ${msg.sender_name}...`}
                      className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      onClick={() => replyText.trim() && sendReply.mutate({ id: msg.id, body: replyText.trim() })}
                      disabled={!replyText.trim() || sendReply.isPending}
                    >
                      <Send className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
