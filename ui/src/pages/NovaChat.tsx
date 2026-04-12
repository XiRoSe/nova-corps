import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bot, Send, User, MessageSquare, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/lib/router";
import { useCompany } from "@/context/CompanyContext";
import { agentsApi } from "@/api/agents";
import { issuesApi } from "@/api/issues";
import { queryKeys } from "@/lib/queryKeys";
import type { Agent, Issue, IssueComment } from "@paperclipai/shared";

function AgentListItem({ agent, selected, onClick, taskCount }: {
  agent: Agent;
  selected: boolean;
  onClick: () => void;
  taskCount: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 flex items-center gap-3 transition-colors ${
        selected ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate">{agent.name}</p>
        <p className="text-xs text-muted-foreground">{agent.title || agent.role}</p>
      </div>
      {taskCount > 0 && (
        <span className="text-[11px] text-muted-foreground bg-muted rounded-full px-2 py-0.5">
          {taskCount} task{taskCount > 1 ? "s" : ""}
        </span>
      )}
    </button>
  );
}

function ChatMessage({ comment, agents }: { comment: IssueComment; agents: Agent[] }) {
  const isAgent = !!comment.authorAgentId;
  const agent = agents.find((a) => a.id === comment.authorAgentId);
  const time = new Date(comment.createdAt);
  const ago = Math.round((Date.now() - time.getTime()) / 60000);
  const agoText = ago < 1 ? "just now" : ago < 60 ? `${ago}m ago` : ago < 1440 ? `${Math.round(ago / 60)}h ago` : `${Math.round(ago / 1440)}d ago`;

  return (
    <div className={`mb-3 flex ${isAgent ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[80%] rounded-xl px-4 py-3 ${
        isAgent ? "bg-card border border-border" : "bg-primary text-primary-foreground"
      }`}>
        <div className="flex items-center gap-1.5 mb-1">
          {isAgent ? <Bot className="h-3 w-3 text-primary" /> : <User className="h-3 w-3" />}
          <span className={`text-[11px] ${isAgent ? "text-muted-foreground" : "text-primary-foreground/70"}`}>
            {isAgent ? agent?.name ?? "Agent" : "You"}
          </span>
          <span className={`text-[11px] ${isAgent ? "text-muted-foreground/60" : "text-primary-foreground/50"}`}>
            {agoText}
          </span>
        </div>
        <div className="text-sm whitespace-pre-wrap break-words leading-relaxed">
          {comment.body}
        </div>
      </div>
    </div>
  );
}

export function NovaChat() {
  const { selectedCompanyId } = useCompany();
  const queryClient = useQueryClient();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch agents
  const { data: agents = [] } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  // Auto-select first agent
  useEffect(() => {
    if (!selectedAgentId && agents.length > 0) {
      setSelectedAgentId(agents[0]!.id);
    }
  }, [agents, selectedAgentId]);

  // Fetch all issues to find agent's assigned tasks
  const { data: allIssues = [] } = useQuery({
    queryKey: ["nova-chat-issues", selectedCompanyId],
    queryFn: () => issuesApi.list(selectedCompanyId!, { limit: 100 }),
    enabled: !!selectedCompanyId,
  });

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  // Get issues assigned to or participated in by selected agent
  const agentIssues = allIssues.filter(
    (i: Issue) => i.assigneeAgentId === selectedAgentId
  );

  // Task counts per agent (for sidebar badges)
  const taskCountByAgent = new Map<string, number>();
  for (const issue of allIssues) {
    if (issue.assigneeAgentId) {
      taskCountByAgent.set(issue.assigneeAgentId, (taskCountByAgent.get(issue.assigneeAgentId) ?? 0) + 1);
    }
  }

  // Fetch comments for agent's issues
  const { data: comments = [], isLoading: loadingComments } = useQuery({
    queryKey: ["nova-chat-comments", selectedAgentId, agentIssues.map((i: Issue) => i.id).join(",")],
    queryFn: async () => {
      if (agentIssues.length === 0) return [];
      const all: IssueComment[] = [];
      for (const issue of agentIssues) {
        try {
          const issueComments = await issuesApi.listComments(issue.id, { limit: 50, order: "asc" });
          all.push(...issueComments);
        } catch { /* skip */ }
      }
      return all.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    },
    enabled: !!selectedAgentId && agentIssues.length > 0,
    refetchInterval: 10_000,
  });

  // Send comment to agent's first in-progress issue (or first assigned issue)
  const activeIssue = agentIssues.find((i: Issue) => i.status === "in_progress") ?? agentIssues[0];

  const sendComment = useMutation({
    mutationFn: async (body: string) => {
      if (!activeIssue) throw new Error("No active issue");
      return issuesApi.addComment(activeIssue.id, body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nova-chat-comments"] });
      setInput("");
    },
  });

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  const handleSend = () => {
    if (!input.trim() || !activeIssue) return;
    sendComment.mutate(input.trim());
  };

  return (
    <div className="h-full flex">
      {/* Agent List */}
      <div className="w-60 border-r border-border bg-background flex flex-col shrink-0">
        <div className="px-4 h-12 border-b border-border flex items-center">
          <h2 className="text-sm font-semibold text-foreground">Agent Chat</h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {agents.map((agent) => (
            <AgentListItem
              key={agent.id}
              agent={agent}
              selected={agent.id === selectedAgentId}
              onClick={() => setSelectedAgentId(agent.id)}
              taskCount={taskCountByAgent.get(agent.id) ?? 0}
            />
          ))}
          {agents.length === 0 && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">No agents yet</p>
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedAgent ? (
          <>
            {/* Chat Header */}
            <div className="px-6 h-12 border-b border-border flex items-center gap-3 shrink-0">
              <Bot className="h-5 w-5 text-primary" />
              <div>
                <span className="text-sm font-semibold">{selectedAgent.name}</span>
                <span className="text-xs text-muted-foreground ml-2">{selectedAgent.title || selectedAgent.role}</span>
              </div>
              {activeIssue && (
                <Link
                  to={`/issues/${activeIssue.identifier}`}
                  className="ml-auto text-xs text-primary hover:underline"
                >
                  {activeIssue.identifier}: {activeIssue.title}
                </Link>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-6 scrollbar-auto-hide">
              {loadingComments && (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}

              {!loadingComments && comments.length === 0 && (
                <div className="text-center mt-[15vh] text-muted-foreground">
                  <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <h3 className="text-lg font-medium text-muted-foreground/80">No messages yet</h3>
                  <p className="text-sm text-muted-foreground/50 mt-1">
                    {agentIssues.length === 0
                      ? `Assign a task to ${selectedAgent.name} to start chatting.`
                      : `Send a message to ${selectedAgent.name} about their task.`}
                  </p>
                </div>
              )}

              {comments.map((comment) => (
                <ChatMessage key={comment.id} comment={comment} agents={agents} />
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
                placeholder={
                  activeIssue
                    ? `Message ${selectedAgent.name} about ${activeIssue.identifier}...`
                    : `No active task — assign one first`
                }
                className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 disabled:opacity-50"
                disabled={!activeIssue || sendComment.isPending}
              />
              <Button
                size="default"
                onClick={handleSend}
                disabled={!activeIssue || !input.trim() || sendComment.isPending}
              >
                {sendComment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center text-muted-foreground">
              <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-30" />
              <p className="text-sm">Select an agent to start chatting</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
