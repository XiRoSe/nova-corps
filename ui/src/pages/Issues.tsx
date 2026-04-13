import { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Bot, Plus, CircleDot } from "lucide-react";
import type { Agent, Issue } from "@paperclipai/shared";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useDialog } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { EmptyState } from "../components/EmptyState";

const PRIORITY_DOT: Record<string, string> = {
  critical: "bg-red-500",
  high: "bg-orange-500",
  medium: "bg-yellow-400",
  low: "bg-blue-400",
  none: "bg-muted-foreground/40",
};

// Stable avatar colors per agent initial
const AVATAR_COLORS = [
  "bg-violet-600", "bg-blue-600", "bg-emerald-600",
  "bg-rose-600", "bg-amber-600", "bg-cyan-600",
];
function avatarColor(name: string) {
  let n = 0;
  for (let i = 0; i < name.length; i++) n += name.charCodeAt(i);
  return AVATAR_COLORS[n % AVATAR_COLORS.length];
}

const COLUMNS = [
  {
    key: "todo",
    label: "To Do",
    statuses: ["backlog", "todo"],
    headerColor: "text-muted-foreground",
    dotColor: "bg-muted-foreground/50",
    emptyMsg: "No tasks queued. Add one to get started.",
  },
  {
    key: "in_progress",
    label: "In Progress",
    statuses: ["in_progress"],
    headerColor: "text-blue-400",
    dotColor: "bg-blue-500",
    emptyMsg: "Nothing in flight right now.",
  },
  {
    key: "in_review",
    label: "In Review",
    statuses: ["in_review"],
    headerColor: "text-yellow-400",
    dotColor: "bg-yellow-400",
    emptyMsg: "No tasks awaiting review.",
  },
  {
    key: "done",
    label: "Done",
    statuses: ["done"],
    headerColor: "text-emerald-400",
    dotColor: "bg-emerald-500",
    emptyMsg: "Nothing completed yet — let's change that.",
  },
] as const;

// Agent avatar circle (small)
function AgentAvatar({ agent, size = "sm" }: { agent: Agent; size?: "sm" | "xs" }) {
  const initial = agent.name.charAt(0).toUpperCase();
  const color = avatarColor(agent.name);
  const cls = size === "xs"
    ? "h-5 w-5 text-[10px]"
    : "h-6 w-6 text-xs";
  return (
    <span
      className={`${cls} ${color} rounded-full flex items-center justify-center font-semibold text-white flex-shrink-0`}
      title={agent.name}
    >
      {initial}
    </span>
  );
}

// Single kanban card
function IssueCard({ issue, agent }: { issue: Issue; agent: Agent | null }) {
  const priorityKey = issue.priority && issue.priority in PRIORITY_DOT ? issue.priority : "none";
  const isSubTask = !!issue.parentId;

  return (
    <Link
      to={`/issues/${issue.identifier}`}
      className="block bg-card border border-border rounded-lg p-3 hover:border-primary/50 cursor-pointer transition-colors no-underline"
    >
      {/* Title row with priority dot */}
      <div className="flex items-start gap-2 mb-2">
        <span
          className={`mt-1 inline-block h-2 w-2 rounded-full flex-shrink-0 ${PRIORITY_DOT[priorityKey]}`}
          title={issue.priority ?? "no priority"}
        />
        <p className="text-sm font-medium text-foreground leading-snug line-clamp-2">
          {issue.title}
        </p>
      </div>

      {/* Sub-task indicator */}
      {isSubTask && (
        <div className="flex items-center gap-1 mb-1.5 ml-4">
          <span className="text-[10px] text-muted-foreground/60 font-mono">↳ sub-task</span>
        </div>
      )}

      {/* Footer: ID + agent */}
      <div className="flex items-center justify-between gap-2 ml-4">
        <span className="text-xs text-muted-foreground font-mono">
          {issue.identifier ?? "—"}
        </span>
        {agent ? (
          <div className="flex items-center gap-1.5 min-w-0">
            <AgentAvatar agent={agent} size="xs" />
            <span className="text-xs text-muted-foreground truncate max-w-[80px]">
              {agent.name}
            </span>
          </div>
        ) : (
          <Bot className="h-3.5 w-3.5 text-muted-foreground/30 flex-shrink-0" />
        )}
      </div>
    </Link>
  );
}

export function Issues() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const { openNewIssue } = useDialog();
  const [filterAgentId, setFilterAgentId] = useState<string | null>(null); // null = All, "" = Unassigned

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

  const agentMap = new Map<string, Agent>((agents ?? []).map((a: Agent) => [a.id, a]));

  // Assignee filter logic
  const visibleIssues = (issues ?? []).filter((i: Issue) => {
    if (filterAgentId === null) return true;
    if (filterAgentId === "") return !i.assigneeAgentId;
    return i.assigneeAgentId === filterAgentId;
  });

  // Task count summary
  const total = (issues ?? []).length;
  const inProgress = (issues ?? []).filter((i: Issue) => i.status === "in_progress").length;
  const done = (issues ?? []).filter((i: Issue) => i.status === "done").length;

  // Agents that appear on at least one issue (for filter row)
  const assignedAgentIds = new Set((issues ?? []).map((i: Issue) => i.assigneeAgentId).filter(Boolean));
  const filterAgents = (agents ?? []).filter((a: Agent) => assignedAgentIds.has(a.id));
  const hasUnassigned = (issues ?? []).some((i: Issue) => !i.assigneeAgentId);

  function toggleFilter(id: string | null) {
    setFilterAgentId(prev => prev === id ? null : id);
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Page toolbar */}
      <div className="flex items-center justify-between px-6 pt-5 pb-3 flex-shrink-0">
        {/* Summary */}
        <p className="text-xs text-muted-foreground">
          {total} task{total !== 1 ? "s" : ""}
          {inProgress > 0 && <> · <span className="text-blue-400">{inProgress} in progress</span></>}
          {done > 0 && <> · <span className="text-emerald-400">{done} done</span></>}
        </p>
        {/* Top-level New Task button */}
        <button
          onClick={() => openNewIssue({ status: "todo" })}
          className="flex items-center gap-1.5 text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-3 py-1.5 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          New Task
        </button>
      </div>

      {/* Assignee filter row */}
      {(filterAgents.length > 0 || hasUnassigned) && (
        <div className="flex items-center gap-2 px-6 pb-3 flex-shrink-0 flex-wrap">
          <button
            onClick={() => setFilterAgentId(null)}
            className={`text-xs rounded-full px-2.5 py-1 transition-colors border ${
              filterAgentId === null
                ? "bg-primary/20 border-primary/50 text-foreground"
                : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50"
            }`}
          >
            All
          </button>
          {filterAgents.map((agent: Agent) => (
            <button
              key={agent.id}
              onClick={() => toggleFilter(agent.id)}
              className={`flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 transition-colors border ${
                filterAgentId === agent.id
                  ? "bg-primary/20 border-primary/50 text-foreground"
                  : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50"
              }`}
            >
              <AgentAvatar agent={agent} size="xs" />
              {agent.name}
            </button>
          ))}
          {hasUnassigned && (
            <button
              onClick={() => toggleFilter("")}
              className={`flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 transition-colors border ${
                filterAgentId === ""
                  ? "bg-primary/20 border-primary/50 text-foreground"
                  : "bg-transparent border-border text-muted-foreground hover:text-foreground hover:border-muted-foreground/50"
              }`}
            >
              <Bot className="h-3.5 w-3.5" />
              Unassigned
            </button>
          )}
        </div>
      )}

      {/* Kanban columns */}
      <div className="flex overflow-x-auto gap-4 px-6 pb-6 flex-1 min-h-0">
        {COLUMNS.map((col) => {
          const cards = visibleIssues.filter((i: Issue) =>
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
                  <span className={`h-2 w-2 rounded-full flex-shrink-0 ${col.dotColor}`} />
                  <span className={`text-sm font-semibold ${col.headerColor}`}>
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
                {cards.map((issue: Issue) => {
                  const agent = issue.assigneeAgentId ? agentMap.get(issue.assigneeAgentId) ?? null : null;
                  return <IssueCard key={issue.id} issue={issue} agent={agent} />;
                })}

                {cards.length === 0 && (
                  <div className="flex-1 flex items-center justify-center py-10 px-2">
                    <p className="text-xs text-muted-foreground/50 text-center leading-relaxed">
                      {col.emptyMsg}
                    </p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
