import { useEffect, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@/lib/router";
import { Bot, Inbox as InboxIcon } from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { agentsApi } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import { timeAgo } from "@/lib/timeAgo";
import { issueLastActivityTimestamp, sortIssuesByMostRecentActivity } from "@/lib/inbox";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import type { Agent, Issue } from "@paperclipai/shared";

export function Inbox() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Inbox" }]);
  }, [setBreadcrumbs]);

  const { data: issues, isLoading } = useQuery({
    queryKey: queryKeys.issues.listTouchedByMe(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!, { limit: 50 }),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
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

  const sortedIssues = useMemo(
    () => [...(issues ?? [])].sort(sortIssuesByMostRecentActivity),
    [issues],
  );

  const unreadCount = useMemo(
    () => sortedIssues.filter((i) => i.isUnreadForMe).length,
    [sortedIssues],
  );

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
      {sortedIssues.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <EmptyState icon={InboxIcon} message="You're all caught up." />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {sortedIssues.map((issue) => {
            const agent = issue.assigneeAgentId ? agentById.get(issue.assigneeAgentId) : null;
            const activityTs = issueLastActivityTimestamp(issue);
            const activityDate = activityTs > 0 ? new Date(activityTs) : new Date(issue.updatedAt);
            const isUnread = !!issue.isUnreadForMe;

            return (
              <li key={issue.id}>
                <Link
                  to={`/issues/${issue.identifier ?? issue.id}`}
                  onClick={() => {
                    if (isUnread) markRead.mutate(issue.id);
                  }}
                  className="flex items-center gap-3 px-6 py-3.5 hover:bg-muted/50 transition-colors cursor-pointer"
                >
                  {/* Unread dot */}
                  <div className="w-2 flex-shrink-0 flex items-center justify-center">
                    {isUnread && (
                      <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
                    )}
                  </div>

                  {/* Agent avatar */}
                  <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-muted-foreground" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-sm truncate ${isUnread ? "font-semibold text-foreground" : "font-medium text-muted-foreground"}`}
                      >
                        {agent?.name ?? "Agent"}
                      </span>
                      {issue.identifier && (
                        <span className="text-xs text-muted-foreground flex-shrink-0">
                          {issue.identifier}
                        </span>
                      )}
                    </div>
                    <p
                      className={`text-sm truncate mt-0.5 ${isUnread ? "text-foreground" : "text-muted-foreground"}`}
                    >
                      {issue.title}
                    </p>
                  </div>

                  {/* Time */}
                  <span className="text-xs text-muted-foreground flex-shrink-0 ml-2">
                    {timeAgo(activityDate)}
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
