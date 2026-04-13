import { useEffect } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Plus } from "lucide-react";
import type { Agent } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";
import { CircleDot } from "lucide-react";

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-400",
  low: "bg-blue-400",
  none: "bg-muted-foreground/40",
};

const COLUMNS = [
  { key: "todo", label: "To Do", statuses: ["backlog", "todo"] },
  { key: "in_progress", label: "In Progress", statuses: ["in_progress"] },
  { key: "in_review", label: "In Review", statuses: ["in_review"] },
  { key: "done", label: "Done", statuses: ["done"] },
] as const;

export function Issues() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { openNewIssue } = useDialog();

  useEffect(() => {
    setBreadcrumbs([{ label: "Tasks" }]);
  }, [setBreadcrumbs]);

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!, { includeRoutineExecutions: true }),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return <EmptyState icon={CircleDot} message="Select a company to view tasks." />;
  }

  const agentMap = new Map<string, Agent>(
    (agents ?? []).map((a: Agent) => [a.id, a]),
  );

  return (
    <div className="flex overflow-x-auto gap-4 p-6 h-full min-h-0">
      {COLUMNS.map((col) => {
        const cards = (issues ?? []).filter((i) =>
          (col.statuses as readonly string[]).includes(i.status),
        );

        return (
          <div
            key={col.key}
            className="flex-shrink-0 w-72 bg-card/50 rounded-lg p-3 flex flex-col"
          >
            {/* Column header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-foreground">
                  {col.label}
                </span>
                <span className="text-xs text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 tabular-nums">
                  {cards.length}
                </span>
              </div>
              {col.key === "todo" && (
                <button
                  onClick={() => openNewIssue({ status: "todo" })}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  title="New Task"
                >
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2 overflow-y-auto flex-1 min-h-0">
              {cards.map((issue) => {
                const agent = issue.assigneeAgentId
                  ? agentMap.get(issue.assigneeAgentId)
                  : null;
                const priorityKey =
                  issue.priority && issue.priority in PRIORITY_DOT
                    ? issue.priority
                    : "none";
                const dotClass = PRIORITY_DOT[priorityKey];

                return (
                  <Link
                    key={issue.id}
                    to={`/issues/${issue.identifier}`}
                    className="block bg-card border border-border rounded-lg p-3 hover:border-primary/50 cursor-pointer transition-colors no-underline"
                  >
                    {/* Title */}
                    <p className="text-sm font-medium text-foreground leading-snug mb-2 line-clamp-2">
                      {issue.title}
                    </p>

                    {/* Footer row */}
                    <div className="flex items-center justify-between gap-2">
                      {/* Left: ID + priority dot */}
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${dotClass}`}
                          title={issue.priority ?? "no priority"}
                        />
                        <span className="text-xs text-muted-foreground font-mono">
                          {issue.identifier ?? "—"}
                        </span>
                      </div>

                      {/* Right: assignee */}
                      {agent && (
                        <div className="flex items-center gap-1 min-w-0">
                          <Bot className="h-3 w-3 flex-shrink-0 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground truncate max-w-[90px]">
                            {agent.name}
                          </span>
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}

              {cards.length === 0 && (
                <div className="flex-1 flex items-center justify-center py-8">
                  <p className="text-xs text-muted-foreground/50">No tasks</p>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
