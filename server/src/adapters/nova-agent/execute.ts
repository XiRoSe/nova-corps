import Anthropic from "@anthropic-ai/sdk";
import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";

const MAX_TOOL_ROUNDS = 20;
const API_BASE = "http://localhost:3100/api";

// ---------------------------------------------------------------------------
// Tool definitions for the Anthropic API
// ---------------------------------------------------------------------------

function buildTools(companyId: string): Anthropic.Tool[] {
  return [
    {
      name: "get_issue",
      description:
        "Retrieve a single issue/task by its ID. Returns title, description, status, assignee, comments, and sub-issues.",
      input_schema: {
        type: "object" as const,
        properties: {
          issueId: { type: "string", description: "The ID of the issue to retrieve." },
        },
        required: ["issueId"],
      },
    },
    {
      name: "update_issue_status",
      description:
        "Update the status of a task. Valid statuses: backlog, todo, in_progress, in_review, done, cancelled.",
      input_schema: {
        type: "object" as const,
        properties: {
          issueId: { type: "string", description: "The ID of the issue to update." },
          status: { type: "string", description: "The new status for the issue." },
        },
        required: ["issueId", "status"],
      },
    },
    {
      name: "add_comment",
      description: "Add a comment to a task. Use for status updates, decisions, questions, or deliverables. The user reads these — make them useful.",
      input_schema: {
        type: "object" as const,
        properties: {
          issueId: { type: "string", description: "The ID of the issue to comment on." },
          content: { type: "string", description: "The comment text (supports markdown)." },
        },
        required: ["issueId", "content"],
      },
    },
    {
      name: "create_sub_issue",
      description:
        "Create a sub-task under a parent task. Use to break work into smaller pieces or delegate.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Title of the new sub-task." },
          description: { type: "string", description: "Detailed description of what needs to be done." },
          parentId: { type: "string", description: "The ID of the parent task." },
          assigneeAgentId: {
            type: "string",
            description: "The agent ID to assign this sub-task to (optional).",
          },
        },
        required: ["title", "description", "parentId"],
      },
    },
    {
      name: "list_issues",
      description:
        "List all tasks for the company. Returns an array of task objects with status, assignee, and details.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "list_agents",
      description: "List all agents in the company. Check this BEFORE hiring to avoid duplicates.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "hire_agent",
      description:
        "Hire a new agent to join the team. The new agent will wake up autonomously and start working on assigned tasks. ALWAYS call list_agents first to check for duplicates.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Name for the new agent (use Nova Corps Marvel character names)." },
          role: { type: "string", description: "Role key: general, engineer, ceo, designer, etc." },
          title: { type: "string", description: "Human-readable job title: CTO, Product Manager, etc." },
          adapterType: {
            type: "string",
            description: 'Must be "nova_agent".',
          },
          capabilities: {
            type: "string",
            description: "What this agent specializes in. This becomes their instructions. Be specific about their responsibilities.",
          },
        },
        required: ["name", "role", "title", "adapterType"],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Role-based behavior profiles
// ---------------------------------------------------------------------------

const ROLE_PROFILES: Record<string, string> = {
  ceo: `You are the CEO. Your job is LEADERSHIP and DELEGATION, not execution.

Your responsibilities:
- Review the big picture: what tasks exist, who's working on what, what's blocked
- Break high-level goals into concrete tasks and assign them to the right people
- Hire new agents when the workload demands it (too many unassigned tasks, or skills gaps)
- Make strategic decisions and document them as comments
- Unblock your team — if someone's stuck, help or reassign
- Mark tasks as done when deliverables are complete

You should NOT:
- Do the detailed work yourself (that's what your team is for)
- Repeat the same status update every heartbeat
- Say "everything looks good" without checking

Decision framework for hiring:
- If there are 3+ unassigned tasks → consider hiring
- If tasks need skills your team lacks → hire a specialist
- If one agent has 3+ tasks → hire to distribute load
- Never hire if an equivalent agent already exists`,

  engineer: `You are an Engineer. Your job is EXECUTION — getting tasks done.

Your responsibilities:
- Work on your assigned tasks: analyze, plan, implement, deliver
- Add substantive comments showing your work and decisions
- Break complex tasks into sub-tasks when needed
- Update task status as you progress (todo → in_progress → in_review → done)
- Ask for help or flag blockers in comments

Your comments should contain REAL WORK:
- Analysis, plans, recommendations, code snippets, research findings
- Not just "I'm looking at this" or "Working on it"
- Each comment should move the task forward

When a task is done:
- Add a final comment with deliverables/summary
- Set status to "done"`,

  designer: `You are a Designer. Your job is creating user experiences and visual designs.

Your responsibilities:
- Create UI/UX designs, wireframes, and mockups (described in markdown)
- Review existing interfaces and suggest improvements
- Document design decisions and rationale
- Create style guides and component specifications`,

  general: `You are a team member. Adapt to whatever tasks are assigned to you.

Your responsibilities:
- Work on assigned tasks diligently
- Add useful comments showing progress and decisions
- Flag blockers and ask questions when stuck
- Update task status as you progress`,
};

function getRoleProfile(role: string): string {
  return ROLE_PROFILES[role] || ROLE_PROFILES.general!;
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(agent: AdapterExecutionContext["agent"]): string {
  const roleProfile = getRoleProfile(agent.role ?? "general");
  const capabilities = (agent as Record<string, unknown>).capabilities as string | undefined;

  return `You are ${agent.name}, ${agent.title || agent.role || "team member"} at Nova Corps.

${roleProfile}

${capabilities ? `Your specific focus:\n${capabilities}\n` : ""}Available tools: list_issues, get_issue, update_issue_status, add_comment, create_sub_issue, list_agents, hire_agent

Nova Corps character names for hiring: Sam Alexander, Irani Rael, Garthan Saal, Jesse Alexander, Titus, Ko-Rel, Adora, Pyreus Kril.
Always set adapterType to "nova_agent". Give real job titles (CTO, Product Manager, DevOps, etc.).

Rules:
- Check list_agents before hiring — never create duplicates.
- Always check list_issues to understand the current state before acting.
- Every comment should add value. No filler like "checking in" or "nothing to report".
- If truly nothing needs action, just stop. Don't comment to say nothing happened.`;
}

// ---------------------------------------------------------------------------
// User prompt builder
// ---------------------------------------------------------------------------

function buildUserPrompt(context: Record<string, unknown>): string {
  const parts: string[] = [];

  const wake = context.paperclipWake as Record<string, unknown> | undefined;
  const handoff = context.paperclipSessionHandoffMarkdown as string | undefined;

  if (wake) {
    parts.push("## Wake Event");
    parts.push(JSON.stringify(wake, null, 2));
  }

  if (handoff) {
    parts.push("## Session Handoff");
    parts.push(handoff);
  }

  if (parts.length === 0) {
    parts.push(
      "Heartbeat. Check the current state of tasks and your team, then take meaningful action. " +
        "Do NOT comment just to say everything is fine — only act if there's something to do.",
    );
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Paperclip API caller
// ---------------------------------------------------------------------------

interface ToolInput {
  issueId?: string;
  status?: string;
  content?: string;
  title?: string;
  description?: string;
  parentId?: string;
  assigneeAgentId?: string;
  name?: string;
  role?: string;
  adapterType?: string;
  capabilities?: string;
}

async function executeToolCall(
  toolName: string,
  toolInput: ToolInput,
  companyId: string,
  authToken: string,
  runId: string,
): Promise<{ ok: boolean; body: unknown }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
    "X-Paperclip-Run-Id": runId,
  };

  let url: string;
  let method: string;
  let body: string | undefined;

  switch (toolName) {
    case "get_issue":
      url = `${API_BASE}/companies/${companyId}/issues/${toolInput.issueId}`;
      method = "GET";
      break;

    case "update_issue_status":
      url = `${API_BASE}/issues/${toolInput.issueId}`;
      method = "PATCH";
      body = JSON.stringify({ status: toolInput.status });
      break;

    case "add_comment":
      url = `${API_BASE}/issues/${toolInput.issueId}/comments`;
      method = "POST";
      body = JSON.stringify({ body: toolInput.content });
      break;

    case "create_sub_issue": {
      url = `${API_BASE}/companies/${companyId}/issues`;
      method = "POST";
      const issueBody: Record<string, unknown> = {
        title: toolInput.title,
        description: toolInput.description,
        parentId: toolInput.parentId,
      };
      if (toolInput.assigneeAgentId) {
        issueBody.assigneeAgentId = toolInput.assigneeAgentId;
      }
      body = JSON.stringify(issueBody);
      break;
    }

    case "list_issues":
      url = `${API_BASE}/companies/${companyId}/issues`;
      method = "GET";
      break;

    case "list_agents":
      url = `${API_BASE}/companies/${companyId}/agents`;
      method = "GET";
      break;

    case "hire_agent": {
      url = `${API_BASE}/companies/${companyId}/agent-hires`;
      method = "POST";
      const hireBody: Record<string, unknown> = {
        name: toolInput.name,
        role: toolInput.role,
        title: toolInput.title,
        adapterType: toolInput.adapterType || "nova_agent",
        runtimeConfig: {
          heartbeat: {
            enabled: true,
            intervalSec: 7200,
            cooldownSec: 30,
            wakeOnDemand: true,
            maxConcurrentRuns: 1,
          },
        },
      };
      if (toolInput.capabilities) {
        hireBody.capabilities = toolInput.capabilities;
      }
      body = JSON.stringify(hireBody);
      break;
    }

    default:
      return { ok: false, body: { error: `Unknown tool: ${toolName}` } };
  }

  try {
    const res = await fetch(url, {
      method,
      headers,
      ...(body ? { body } : {}),
    });

    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }

    return { ok: res.ok, body: parsed };
  } catch (err) {
    return { ok: false, body: { error: String(err) } };
  }
}

// ---------------------------------------------------------------------------
// Main execute function
// ---------------------------------------------------------------------------

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, authToken } = ctx;

  const model = (config.model as string) || "claude-sonnet-4-5-20250929";
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    await onLog("stderr", "ANTHROPIC_API_KEY is not set\n");
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "ANTHROPIC_API_KEY environment variable is not set",
    };
  }

  if (!authToken) {
    await onLog("stderr", "No authToken provided in execution context\n");
    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage: "No authToken provided — cannot call Paperclip API",
    };
  }

  const anthropic = new Anthropic({ apiKey });
  const systemPrompt = buildSystemPrompt(agent);
  const userPrompt = buildUserPrompt(context);
  const tools = buildTools(agent.companyId);

  await onLog("stdout", `[nova-agent] Starting run ${runId} for ${agent.name} (${agent.title || agent.role})\n`);
  await onLog("stdout", `[nova-agent] Model: ${model}\n`);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let lastTextResponse = "";
  let rounds = 0;

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  try {
    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      await onLog("stdout", `[nova-agent] API call round ${rounds}/${MAX_TOOL_ROUNDS}\n`);

      const response = await anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        messages,
        tools,
      });

      // Accumulate usage
      totalInputTokens += response.usage?.input_tokens ?? 0;
      totalOutputTokens += response.usage?.output_tokens ?? 0;
      if ("cache_creation_input_tokens" in response.usage) {
        totalCacheCreation += (response.usage as Record<string, number>).cache_creation_input_tokens ?? 0;
      }
      if ("cache_read_input_tokens" in response.usage) {
        totalCacheRead += (response.usage as Record<string, number>).cache_read_input_tokens ?? 0;
      }

      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      for (const tb of textBlocks) {
        if (tb.text) {
          lastTextResponse = tb.text;
          await onLog("stdout", `[nova-agent] ${tb.text}\n`);
        }
      }

      if (toolUseBlocks.length === 0) {
        await onLog("stdout", `[nova-agent] No more tool calls — finishing.\n`);
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        await onLog(
          "stdout",
          `[nova-agent] Tool call: ${toolUse.name}(${JSON.stringify(toolUse.input)})\n`,
        );

        const result = await executeToolCall(
          toolUse.name,
          toolUse.input as ToolInput,
          agent.companyId,
          authToken,
          runId,
        );

        const resultText = typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2);

        await onLog(
          "stdout",
          `[nova-agent] Tool result (${result.ok ? "ok" : "error"}): ${resultText.slice(0, 500)}${resultText.length > 500 ? "..." : ""}\n`,
        );

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: resultText,
          is_error: !result.ok,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    if (rounds >= MAX_TOOL_ROUNDS) {
      await onLog("stderr", `[nova-agent] Reached maximum tool call rounds (${MAX_TOOL_ROUNDS})\n`);
    }

    await onLog(
      "stdout",
      `[nova-agent] Completed. Rounds: ${rounds}, Input tokens: ${totalInputTokens}, Output tokens: ${totalOutputTokens}\n`,
    );

    // Estimate cost (Sonnet 4.5: $3/M input, $15/M output)
    const inputCost = ((totalInputTokens + totalCacheCreation) / 1_000_000) * 3;
    const outputCost = (totalOutputTokens / 1_000_000) * 15;
    const cachedCost = (totalCacheRead / 1_000_000) * 0.3;
    const totalCost = inputCost + outputCost + cachedCost;

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: lastTextResponse || `Completed ${rounds} round(s) of tool calls`,
      usage: {
        inputTokens: totalInputTokens + totalCacheCreation + totalCacheRead,
        outputTokens: totalOutputTokens,
        cachedInputTokens: totalCacheRead,
      },
      costUsd: Math.round(totalCost * 10000) / 10000,
      model,
      provider: "anthropic",
      billingType: "api",
    };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    await onLog("stderr", `[nova-agent] Error: ${errorMessage}\n`);

    return {
      exitCode: 1,
      signal: null,
      timedOut: false,
      errorMessage,
      usage:
        totalInputTokens > 0 || totalOutputTokens > 0
          ? {
              inputTokens: totalInputTokens + totalCacheCreation + totalCacheRead,
              outputTokens: totalOutputTokens,
              cachedInputTokens: totalCacheRead,
            }
          : undefined,
      model,
      provider: "anthropic",
    };
  }
}
