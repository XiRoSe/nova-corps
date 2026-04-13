import { useEffect, useMemo } from "react";
import { useQueries, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { Bot, Inbox as InboxIcon, HelpCircle, AlertTriangle, CheckCircle2, Lightbulb } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { agentsApi } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { timeAgo } from "@/lib/timeAgo";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import type { Agent, Issue, IssueComment } from "@paperclipai/shared";

/* Tags that mean "this needs the owner's attention" */
const OWNER_TAGS = ["**Question**", "**Blocker**", "**Decision**", "**Done**"] as const;

type TagType = "question" | "blocker" | "decision" | "done" | "update";

function detectTag(body: string): TagType {
  const start = body.slice(0, 120);
  if (start.includes("**Question**") || start.includes("**question**")) return "question";
  if (start.includes("**Blocker**") || start.includes("**blocker**")) return "blocker";
  if (start.includes("**Decision**") || start.includes("**decision**")) return "decision";
  if (start.includes("**Done**") || start.includes("**done**")) return "done";
  // @owner means the agent is addressing the user directly
  if (body.includes("@owner")) return "question";
  return "update";
}

const TAG_CONFIG: Record<TagType, { label: string; color: string; icon: typeof HelpCircle }> = {
  question: { label: "Question", color: "bg-blue-500/10 text-blue-400", icon: HelpCircle },
  blocker: { label: "Blocker", color: "bg-red-500/10 text-red-400", icon: AlertTriangle },
  decision: { label: "Decision", color: "bg-purple-500/10 text-purple-400", icon: Lightbulb },
  done: { label: "Done", color: "bg-green-500/10 text-green-400", icon: CheckCircle2 },
  update: { label: "Update", color: "bg-muted text-muted-foreground", icon: Bot },
};

function stripTag(body: string): string {
  return body.replace(/^\*\*(Question|Blocker|Decision|Done|Update)\*\*:?\s*/i, "").trim();
}

interface AgentMessage {
  comment: IssueComment;
  issue: Issue;
  agentName: string;
  isUnread: boolean;
  tag: TagType;
}

export function Inbox() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Inbox" }]);
  }, [setBreadcrumbs]);

  const { data: issues, isLoading: issuesLoading } = useQuery({
    queryKey: queryKeys.issues.listTouchedByMe(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!, { limit: 50 }),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const commentQueries = useQueries({
    queries: (issues ?? []).map((issue) => ({
      queryKey: queryKeys.issues.comments(issue.id),
      queryFn: () => issuesApi.listComments(issue.id, { order: "desc", limit: 10 }),
      enabled: !!selectedCompanyId,
    })),
  });

  const markRead = useMutation({
    mutationFn: (issueId: string) => issuesApi.markRead(issueId),
    onSuccess: (_data, issueId) => {
      queryClient.setQueryData(
        queryKeys.issues.listTouchedByMe(selectedCompanyId!),
        (old: Issue[] | undefined) =>
          old?.map((i) => (i.id === issueId ? { ...i, isUnreadForMe: false } : i)),
      );
    },
  });

  const agentById = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const messages = useMemo((): AgentMessage[] => {
    if (!issues) return [];
    const result: AgentMessage[] = [];
    for (let i = 0; i < issues.length; i++) {
      const issue = issues[i]!;
      const comments = commentQueries[i]?.data ?? [];
      for (const comment of comments) {
        if (!comment.authorAgentId) continue;
        const tag = detectTag(comment.body);
        // Only show messages that need owner attention (tagged) — skip plain updates
        if (tag === "update") continue;
        const agent = agentById.get(comment.authorAgentId);
        result.push({
          comment,
          issue,
          agentName: agent?.name ?? "Agent",
          isUnread: !!issue.isUnreadForMe,
          tag,
        });
      }
    }
    return result.sort(
      (a, b) => new Date(b.comment.createdAt).getTime() - new Date(a.comment.createdAt).getTime(),
    );
  }, [issues, commentQueries, agentById]);

  const unreadCount = messages.filter((m) => m.isUnread).length;
  const commentsLoading = commentQueries.some((q) => q.isLoading);
  const isLoading = issuesLoading || (commentsLoading && messages.length === 0);

  if (!selectedCompanyId) {
    return <EmptyState icon={InboxIcon} message="Select a company to view your inbox." />;
  }
  if (isLoading) {
    return <PageSkeleton variant="list" />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <h1 className="text-lg font-semibold text-foreground">Inbox</h1>
        {unreadCount > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-blue-500 text-white text-xs font-medium min-w-[20px] h-5 px-1.5">
            {unreadCount}
          </span>
        )}
        <span className="text-xs text-muted-foreground ml-auto">
          Questions, blockers, and decisions from your agents
        </span>
      </div>

      {messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState icon={InboxIcon} message="No messages needing your attention." />
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-y-auto">
          {messages.map(({ comment, issue, agentName, isUnread, tag }) => {
            const cfg = TAG_CONFIG[tag];
            const Icon = cfg.icon;
            return (
              <li key={comment.id}>
                <Link
                  to={`/issues/${issue.identifier ?? issue.id}`}
                  onClick={() => { if (isUnread) markRead.mutate(issue.id); }}
                  className="flex items-center gap-3 px-6 py-4 hover:bg-muted/50 transition-colors"
                >
                  {/* Unread dot */}
                  <div className="w-2 shrink-0">
                    {isUnread && <span className="w-2 h-2 rounded-full bg-blue-500 block" />}
                  </div>

                  {/* Tag icon */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${cfg.color}`}>
                    <Icon className="w-4 h-4" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm ${isUnread ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
                        {agentName}
                      </span>
                      <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 ${cfg.color}`}>
                        {cfg.label}
                      </span>
                      <span className="text-xs text-muted-foreground">{issue.identifier}</span>
                    </div>
                    <p className={`text-sm truncate mt-0.5 ${isUnread ? "text-foreground" : "text-muted-foreground"}`}>
                      {stripTag(comment.body).slice(0, 140)}
                    </p>
                  </div>

                  {/* Time */}
                  <span className="text-xs text-muted-foreground shrink-0 ml-2">
                    {timeAgo(new Date(comment.createdAt))}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
