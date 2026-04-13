import { useState, useEffect, useMemo } from "react";
import { useQueries, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { Bot, Inbox as InboxIcon } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { agentsApi } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { timeAgo } from "@/lib/timeAgo";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import type { Agent, Issue, IssueComment } from "@paperclipai/shared";

interface AgentMessage {
  comment: IssueComment;
  issue: Issue;
  agentName: string;
  isUnread: boolean;
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
    queryFn: () => issuesApi.list(selectedCompanyId!, { limit: 30 }),
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
      queryFn: () => issuesApi.listComments(issue.id, { order: "desc", limit: 5 }),
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
      const issue = issues[i];
      const comments = commentQueries[i]?.data ?? [];
      for (const comment of comments) {
        if (!comment.authorAgentId) continue;
        const agent = agentById.get(comment.authorAgentId);
        result.push({
          comment,
          issue,
          agentName: agent?.name ?? "Agent",
          isUnread: !!issue.isUnreadForMe,
        });
      }
    }

    return result.sort(
      (a, b) =>
        new Date(b.comment.createdAt).getTime() - new Date(a.comment.createdAt).getTime(),
    );
  }, [issues, commentQueries, agentById]);

  const unreadCount = useMemo(
    () => new Set(messages.filter((m) => m.isUnread).map((m) => m.issue.id)).size,
    [messages],
  );

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
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-4 border-b border-border">
        <h1 className="text-lg font-semibold text-foreground">Inbox</h1>
        {unreadCount > 0 && (
          <span className="inline-flex items-center justify-center rounded-full bg-blue-500 text-white text-xs font-medium min-w-[20px] h-5 px-1.5">
            {unreadCount}
          </span>
        )}
      </div>

      {/* Message list */}
      {messages.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState icon={InboxIcon} message="No agent messages yet." />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {messages.map(({ comment, issue, agentName, isUnread }) => (
            <li key={comment.id}>
              <Link
                to={`/issues/${issue.identifier ?? issue.id}`}
                onClick={() => {
                  if (isUnread) markRead.mutate(issue.id);
                }}
                className="flex items-center gap-3 px-6 py-3.5 hover:bg-muted/50 transition-colors cursor-pointer"
              >
                {/* Unread dot */}
                <div className="w-2 shrink-0">
                  {isUnread && <span className="w-2 h-2 rounded-full bg-blue-500 block" />}
                </div>

                {/* Agent avatar */}
                <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4 text-primary" />
                </div>

                {/* Message content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm ${isUnread ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                    >
                      {agentName}
                    </span>
                    {issue.identifier && (
                      <span className="text-xs text-muted-foreground">{issue.identifier}</span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground truncate mt-0.5">
                    {comment.body.slice(0, 120)}
                  </p>
                </div>

                {/* Time */}
                <span className="text-xs text-muted-foreground shrink-0">
                  {timeAgo(new Date(comment.createdAt))}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
