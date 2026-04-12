import { useQuery } from "@tanstack/react-query";
import { Bot, Zap, CheckCircle2, Clock, Plus, DollarSign, Loader2, MessageSquare, Users, ListTodo } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import { useDialog } from "@/context/DialogContext";
import { agentsApi } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { costsApi } from "@/api/costs";
import { heartbeatsApi } from "@/api/heartbeats";
import { queryKeys } from "@/lib/queryKeys";
import type { Agent, Issue, IssueComment } from "@paperclipai/shared";

/* ── helpers ── */

function StatCard({ icon: Icon, label, value, sub, to }: {
  icon: typeof Bot;
  label: string;
  value: string | number;
  sub?: string;
  to?: string;
}) {
  const inner = (
    <div className="rounded-lg border border-border bg-card p-4 flex items-center gap-3 hover:border-primary/40 transition-colors">
      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-lg font-bold text-foreground leading-tight">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {sub && <p className="text-[11px] text-muted-foreground/70">{sub}</p>}
      </div>
    </div>
  );
  return to ? <Link to={to} className="block">{inner}</Link> : inner;
}

interface LiveRun {
  id: string;
  status: string;
  agentId: string;
  agentName: string;
  invocationSource: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

function AgentCard({ agent, currentTask, isRunning }: {
  agent: Agent;
  currentTask?: Issue | null;
  isRunning: boolean;
}) {
  return (
    <Link
      to={`/agents/${agent.id}`}
      className={`block rounded-lg border bg-card p-4 hover:border-primary/50 transition-colors ${isRunning ? "border-blue-500/40" : "border-border"}`}
    >
      <div className="flex items-center gap-3">
        <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${isRunning ? "bg-blue-500/10" : "bg-primary/10"}`}>
          {isRunning ? <Loader2 className="h-5 w-5 text-blue-400 animate-spin" /> : <Bot className="h-5 w-5 text-primary" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-foreground">{agent.name}</p>
            {isRunning ? (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-400 animate-pulse">Working</span>
            ) : (
              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium bg-green-500/10 text-green-400">Ready</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{agent.title || agent.role}</p>
        </div>
      </div>
      {currentTask && (
        <div className="mt-3 pt-3 border-t border-border/50">
          <div className="flex items-center gap-2">
            <Zap className="h-3 w-3 text-blue-400 shrink-0" />
            <p className="text-xs text-muted-foreground truncate">
              Working on: <span className="text-foreground font-medium">{currentTask.title}</span>
            </p>
          </div>
        </div>
      )}
    </Link>
  );
}

function CommentCard({ comment, agents }: { comment: IssueComment & { issue?: Issue }; agents: Agent[] }) {
  const agent = agents.find((a) => a.id === comment.authorAgentId);
  const time = new Date(comment.createdAt);
  const ago = Math.round((Date.now() - time.getTime()) / 60000);
  const agoText = ago < 1 ? "just now" : ago < 60 ? `${ago}m ago` : ago < 1440 ? `${Math.round(ago / 60)}h ago` : `${Math.round(ago / 1440)}d ago`;
  const body = comment.body?.slice(0, 200) ?? "";

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <Bot className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-xs font-semibold text-foreground">{agent?.name ?? "Agent"}</span>
        <span className="text-[11px] text-muted-foreground">{agoText}</span>
        {(comment as any).issue && (
          <Link to={`/issues/${(comment as any).issue.identifier}`} className="ml-auto text-[11px] text-primary hover:underline">
            {(comment as any).issue.identifier}
          </Link>
        )}
      </div>
      <p className="text-xs text-muted-foreground/90 leading-relaxed line-clamp-3">{body}</p>
    </div>
  );
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
  const sc = statusConfig[issue.status] ?? statusConfig.todo!;
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
          {assignee && <span className="text-xs text-muted-foreground">→ {assignee.name}</span>}
        </div>
      </div>
      <span className={`text-xs capitalize ${sc.color}`}>{issue.status.replace("_", " ")}</span>
    </Link>
  );
}

/* ── main page ── */

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
    queryFn: () => issuesApi.list(selectedCompanyId!, { limit: 50 }),
    enabled: !!selectedCompanyId,
  });

  const costsQuery = useQuery({
    queryKey: ["nova-home-costs", selectedCompanyId],
    queryFn: () => costsApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const runsQuery = useQuery({
    queryKey: queryKeys.liveRuns(selectedCompanyId!),
    queryFn: () => heartbeatsApi.liveRunsForCompany(selectedCompanyId!, 10),
    enabled: !!selectedCompanyId,
    refetchInterval: 5_000,
  });

  // Fetch recent comments across all issues for activity feed
  const commentsQuery = useQuery({
    queryKey: ["nova-home-comments", selectedCompanyId],
    queryFn: async () => {
      const issues = issuesQuery.data ?? [];
      if (issues.length === 0) return [];
      // Fetch comments from the most recent issues (up to 5)
      const recentIssues = issues.slice(0, 5);
      const allComments: (IssueComment & { issue?: Issue })[] = [];
      for (const issue of recentIssues) {
        try {
          const comments = await issuesApi.listComments(issue.id, { limit: 5, order: "desc" });
          for (const c of comments) {
            if (c.authorAgentId) {
              allComments.push({ ...c, issue } as any);
            }
          }
        } catch { /* skip */ }
      }
      return allComments.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 8);
    },
    enabled: !!selectedCompanyId && (issuesQuery.data ?? []).length > 0,
    refetchInterval: 30_000,
  });

  const agents = agentsQuery.data ?? [];
  const issues = (issuesQuery.data ?? []) as Issue[];
  const runs = (runsQuery.data ?? []) as LiveRun[];
  const comments = commentsQuery.data ?? [];
  const costs = costsQuery.data;

  const activeTasks = issues.filter((i) => i.status === "in_progress");
  const todoTasks = issues.filter((i) => i.status === "todo" || i.status === "backlog");
  const doneTasks = issues.filter((i) => i.status === "done" || i.status === "in_review");
  const runningAgentIds = new Set(runs.filter((r) => r.status === "running").map((r) => r.agentId));

  // Map agents to their current in-progress task
  const agentCurrentTask = new Map<string, Issue>();
  for (const issue of activeTasks) {
    if (issue.assigneeAgentId && !agentCurrentTask.has(issue.assigneeAgentId)) {
      agentCurrentTask.set(issue.assigneeAgentId, issue);
    }
  }

  const totalSpend = costs ? `$${((costs as any).totalCostCents / 100).toFixed(2)}` : "$0.00";

  return (
    <div className="h-full overflow-y-auto scrollbar-auto-hide">
      <div className="max-w-4xl mx-auto px-6 py-8 pb-20">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-foreground">Nova Corps</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your AI agent team — assign tasks, track progress, build together.
          </p>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <StatCard icon={Users} label="Agents" value={agents.length} to="/agents/all" />
          <StatCard icon={ListTodo} label="Active Tasks" value={activeTasks.length} sub={`${todoTasks.length} to do · ${doneTasks.length} done`} to="/issues" />
          <StatCard icon={DollarSign} label="Total Spend" value={totalSpend} to="/costs" />
          <StatCard icon={MessageSquare} label="Messages" value={comments.length} sub="recent agent updates" to="/chat" />
        </div>

        {/* Team */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              Your Team ({agents.length})
            </h2>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/agents/new"><Plus className="h-3 w-3 mr-1" /> Add Agent</Link>
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {agents.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                currentTask={agentCurrentTask.get(agent.id)}
                isRunning={runningAgentIds.has(agent.id)}
              />
            ))}
            {agents.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-2">No agents yet. Create your first agent to get started.</p>
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
              {activeTasks.map((issue) => <TaskRow key={issue.id} issue={issue} agents={agents} />)}
            </div>
          </section>
        )}

        {/* To Do */}
        {todoTasks.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">To Do ({todoTasks.length})</h2>
              <Button variant="ghost" size="sm" onClick={() => openNewIssue()}>
                <Plus className="h-3 w-3 mr-1" /> New Task
              </Button>
            </div>
            <div className="space-y-2">
              {todoTasks.map((issue) => <TaskRow key={issue.id} issue={issue} agents={agents} />)}
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
              {doneTasks.map((issue) => <TaskRow key={issue.id} issue={issue} agents={agents} />)}
            </div>
          </section>
        )}

        {/* Agent Activity — what agents actually wrote */}
        {comments.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                Agent Activity
              </h2>
              <Button variant="ghost" size="sm" asChild>
                <Link to="/chat">View All</Link>
              </Button>
            </div>
            <div className="space-y-2">
              {comments.map((comment) => (
                <CommentCard key={comment.id} comment={comment} agents={agents} />
              ))}
            </div>
          </section>
        )}

        {/* Empty state */}
        {issues.length === 0 && agents.length > 0 && (
          <div className="text-center py-12">
            <Zap className="h-10 w-10 mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">No tasks yet.</p>
            <Button className="mt-3" size="sm" onClick={() => openNewIssue()}>Create your first task</Button>
          </div>
        )}
      </div>
    </div>
  );
}
