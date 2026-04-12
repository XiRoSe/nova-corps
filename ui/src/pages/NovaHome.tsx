import { useQuery } from "@tanstack/react-query";
import { Bot, Zap, CheckCircle2, Clock, AlertCircle, Play, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import { useDialog } from "@/context/DialogContext";
import { agentsApi } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import type { Agent } from "@paperclipai/shared";

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { color: string; label: string }> = {
    active: { color: "bg-green-500/10 text-green-400", label: "Ready" },
    idle: { color: "bg-green-500/10 text-green-400", label: "Ready" },
    running: { color: "bg-blue-500/10 text-blue-400", label: "Working" },
    error: { color: "bg-red-500/10 text-red-400", label: "Error" },
    pending_approval: { color: "bg-yellow-500/10 text-yellow-400", label: "Pending" },
    paused: { color: "bg-gray-500/10 text-gray-400", label: "Paused" },
  };
  const c = config[status] ?? { color: "bg-gray-500/10 text-gray-400", label: status };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${c.color}`}>
      {c.label}
    </span>
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <Link
      to={`/agents/${agent.id}`}
      className="block rounded-lg border border-border bg-card p-4 hover:border-primary/50 transition-colors"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{agent.name}</p>
            <p className="text-xs text-muted-foreground">{agent.title || agent.role}</p>
          </div>
        </div>
        <StatusBadge status={agent.status} />
      </div>
    </Link>
  );
}

interface Issue {
  id: string;
  title: string;
  status: string;
  identifier: string;
  assigneeAgentId: string | null;
  priority: string | null;
}

function TaskRow({ issue, agents }: { issue: Issue; agents: Agent[] }) {
  const assignee = agents.find((a) => a.id === issue.assigneeAgentId);
  const statusConfig: Record<string, { icon: typeof CheckCircle2; color: string }> = {
    done: { icon: CheckCircle2, color: "text-green-400" },
    in_progress: { icon: Zap, color: "text-blue-400" },
    in_review: { icon: Clock, color: "text-yellow-400" },
    todo: { icon: Clock, color: "text-muted-foreground" },
    backlog: { icon: Clock, color: "text-muted-foreground/50" },
  };
  const sc = statusConfig[issue.status] ?? statusConfig.todo;
  const Icon = sc.icon;

  return (
    <Link
      to={`/issues/${issue.identifier}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 hover:border-primary/50 transition-colors"
    >
      <Icon className={`h-4 w-4 shrink-0 ${sc.color}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm text-foreground truncate">{issue.title}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs text-muted-foreground">{issue.identifier}</span>
          {assignee && (
            <span className="text-xs text-muted-foreground">
              → {assignee.name}
            </span>
          )}
        </div>
      </div>
      <span className={`text-xs capitalize ${sc.color}`}>{issue.status.replace("_", " ")}</span>
    </Link>
  );
}

export function NovaHome() {
  const { selectedCompanyId } = useCompany();
  const { openNewIssue } = useDialog();

  const agentsQuery = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const issuesQuery = useQuery({
    queryKey: ["nova-home-issues", selectedCompanyId],
    queryFn: () => issuesApi.list(selectedCompanyId!, { limit: 20 }),
    enabled: !!selectedCompanyId,
  });

  const agents = agentsQuery.data ?? [];
  const issues = (issuesQuery.data as Issue[] | undefined) ?? [];
  const activeTasks = issues.filter((i) => i.status === "in_progress");
  const todoTasks = issues.filter((i) => i.status === "todo" || i.status === "backlog");
  const doneTasks = issues.filter((i) => i.status === "done" || i.status === "in_review");

  return (
    <div className="h-full overflow-y-auto scrollbar-auto-hide">
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-foreground">Nova Corps</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your AI agent team. Assign tasks, track progress, build together.
          </p>
        </div>

        {/* Team */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Your Team ({agents.length})
            </h2>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/agents/new">
                <Plus className="h-3 w-3 mr-1" /> Add Agent
              </Link>
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} />
            ))}
            {agents.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-2">
                No agents yet. Create your first agent to get started.
              </p>
            )}
          </div>
        </section>

        {/* Active Work */}
        {activeTasks.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              In Progress ({activeTasks.length})
            </h2>
            <div className="space-y-2">
              {activeTasks.map((issue) => (
                <TaskRow key={issue.id} issue={issue} agents={agents} />
              ))}
            </div>
          </section>
        )}

        {/* To Do */}
        {todoTasks.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                To Do ({todoTasks.length})
              </h2>
              <Button variant="ghost" size="sm" onClick={() => openNewIssue()}>
                <Plus className="h-3 w-3 mr-1" /> New Task
              </Button>
            </div>
            <div className="space-y-2">
              {todoTasks.map((issue) => (
                <TaskRow key={issue.id} issue={issue} agents={agents} />
              ))}
            </div>
          </section>
        )}

        {/* Done */}
        {doneTasks.length > 0 && (
          <section className="mb-8">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Completed ({doneTasks.length})
            </h2>
            <div className="space-y-2">
              {doneTasks.map((issue) => (
                <TaskRow key={issue.id} issue={issue} agents={agents} />
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {issues.length === 0 && agents.length > 0 && (
          <div className="text-center py-12">
            <Zap className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No tasks yet.</p>
            <Button className="mt-3" size="sm" onClick={() => openNewIssue()}>
              Create your first task
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
