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
  ceo: `You are the CEO. You LEAD this team — plan, delegate, hire, unblock.

HOW YOU COMMUNICATE:
- Your comments on tasks go directly to the user's inbox. They READ them.
- When you need input, ASK in a comment: "Should we prioritize X or Y?" / "Do you want me to hire a designer for this?"
- Give status updates that matter: what's done, what's next, what needs the user's decision
- Tag your comments clearly: start with **Decision**, **Question**, **Update**, or **Blocker**

YOUR JOB:
- Check all tasks and agents. Understand the big picture.
- Break goals into tasks. Assign them to the right agent.
- When workload is heavy (3+ unassigned tasks, or someone overloaded) → hire a new agent
- When you're blocked or unsure → ask the user via a comment
- Review completed work and close tasks
- Proactively suggest next steps: "Task X is done. I suggest we move to Y next — thoughts?"

YOU DON'T:
- Do detailed work (delegate to engineers/specialists)
- Repeat yourself across heartbeats
- Stay silent when there's something to communicate`,

  engineer: `You are an Engineer. You BUILD things and DELIVER results.

HOW YOU COMMUNICATE:
- Your comments go to the user's inbox. Make them count.
- Show your work: analysis, plans, findings, recommendations, code
- When stuck, say so clearly: "**Blocker**: I need X to proceed. Can you help?"
- When done, give a clear deliverable: "**Done**: Here's what I built/found/recommend..."

YOUR JOB:
- Work on assigned tasks. Each heartbeat should make real progress.
- Break complex tasks into sub-tasks when useful
- Add comments with substance — each one should move the task forward
- Update status as you go: todo → in_progress → in_review → done
- If a task is unclear, ask the user: "**Question**: What exactly do you want for X?"
- When finished, add a summary and mark done

YOU DON'T:
- Write empty status updates ("looking at this", "working on it")
- Wait silently when blocked — always communicate`,

  designer: `You are a Designer. You create great user experiences.

HOW YOU COMMUNICATE:
- Comments go to the user's inbox. Share designs, wireframes, mockups.
- Ask for feedback: "**Review**: Here's the layout for X — does this match your vision?"
- When stuck on direction, ask: "**Question**: Do you prefer approach A or B?"

YOUR JOB:
- Create UI/UX designs described in detailed markdown
- Suggest improvements to existing interfaces
- Document design decisions and rationale`,

  general: `You are a team member. Work on what's assigned, communicate clearly.

HOW YOU COMMUNICATE:
- Your comments go to the user's inbox. Make them useful.
- Ask when stuck: "**Question**: I need clarity on X"
- Show progress: "**Update**: Completed Y, moving to Z"
- Flag issues: "**Blocker**: Can't proceed because..."

YOUR JOB:
- Work on assigned tasks
- Show progress with substantive comments
- Ask questions when unclear — don't guess`,
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

IMPORTANT — Your comments are how you talk to the user. They see every comment in their inbox.
When you need something, ASK. When you finish something, TELL. When you're stuck, SAY SO.
The user wants to feel like they have a capable team that keeps them informed and asks smart questions.

For hiring: use Nova Corps names (Sam Alexander, Irani Rael, Garthan Saal, Jesse Alexander, Titus, Ko-Rel, Adora, Pyreus Kril).
Always set adapterType to "nova_agent". Give real job titles.

Rules:
- Always start by checking list_issues and list_agents to understand current state.
- Check list_agents before hiring — never create duplicates.
- Every comment should add value. No filler.
- If truly nothing needs action, stop silently. Don't comment to say nothing happened.`;
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
// Container delegation — routes to per-user Nova Agent container if available
// ---------------------------------------------------------------------------

async function executeViaContainer(
  ctx: AdapterExecutionContext,
  containerUrl: string,
): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, authToken } = ctx;
  const model = (config.model as string) || "claude-sonnet-4-5-20250929";
  const agentExt = agent as Record<string, unknown>;

  await onLog("stdout", JSON.stringify({ type: "system", text: `Delegating to container: ${containerUrl}` }) + "\n");

  try {
    const response = await fetch(`${containerUrl}/agents/${agent.id}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId: agent.id,
        agentName: agent.name,
        role: agentExt.role ?? "general",
        title: agentExt.title ?? "",
        capabilities: agentExt.capabilities ?? "",
        context,
        paperclipApiUrl: API_BASE,
        paperclipAuthToken: authToken,
        model,
        companyId: agent.companyId,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      await onLog("stderr", `Container error (${response.status}): ${errText}\n`);
      return { exitCode: 1, signal: null, timedOut: false, errorMessage: `Container returned ${response.status}` };
    }

    let lastResult: Record<string, unknown> = {};
    const actions: Array<{ tool: string; ok: boolean }> = [];
    const text = await response.text();

    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      await onLog("stdout", line + "\n");
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "result") lastResult = parsed;
        if (parsed.type === "tool_result") actions.push({ tool: parsed.name, ok: parsed.ok });
      } catch { /* skip non-JSON lines */ }
    }

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: String(lastResult.summary ?? "Run complete"),
      resultJson: { summary: lastResult.summary, actions },
      usage: {
        inputTokens: Number(lastResult.inputTokens ?? 0),
        outputTokens: Number(lastResult.outputTokens ?? 0),
        cachedInputTokens: 0,
      },
      costUsd: Number(lastResult.costUsd ?? 0),
      model,
      provider: "anthropic",
      billingType: "api",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await onLog("stderr", `Container connection failed: ${msg}\n`);
    return { exitCode: 1, signal: null, timedOut: false, errorMessage: msg };
  }
}

// ---------------------------------------------------------------------------
// Main execute function — delegates to container or runs locally
// ---------------------------------------------------------------------------

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const containerUrl = process.env.NOVA_CONTAINER_URL;
  if (containerUrl && ctx.authToken) {
    return executeViaContainer(ctx, containerUrl);
  }
  // Fall back to local execution (direct Anthropic API call)
  return executeLocal(ctx);
}

async function executeLocal(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
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

  await onLog("stdout", JSON.stringify({ type: "init", agent: agent.name, role: (agent as any).role, model }) + "\n");

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let lastTextResponse = "";
  let rounds = 0;

  const actions: Array<{ tool: string; input: unknown; ok: boolean }> = [];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: userPrompt },
  ];

  try {
    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      await onLog("stdout", JSON.stringify({ type: "system", text: `API call round ${rounds}/${MAX_TOOL_ROUNDS}` }) + "\n");

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
          await onLog("stdout", JSON.stringify({ type: "thinking", text: tb.text }) + "\n");
        }
      }

      if (toolUseBlocks.length === 0) {
        break;
      }

      messages.push({ role: "assistant", content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolUse of toolUseBlocks) {
        await onLog("stdout", JSON.stringify({ type: "tool_call", name: toolUse.name, input: toolUse.input, toolUseId: toolUse.id }) + "\n");

        const result = await executeToolCall(
          toolUse.name,
          toolUse.input as ToolInput,
          agent.companyId,
          authToken,
          runId,
        );

        const resultText = typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2);
        const preview = resultText.slice(0, 300);

        await onLog("stdout", JSON.stringify({ type: "tool_result", name: toolUse.name, ok: result.ok, preview, toolUseId: toolUse.id }) + "\n");
        actions.push({ tool: toolUse.name, input: toolUse.input, ok: result.ok });

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

    // Estimate cost (Sonnet 4.5: $3/M input, $15/M output)
    const inputCost = ((totalInputTokens + totalCacheCreation) / 1_000_000) * 3;
    const outputCost = (totalOutputTokens / 1_000_000) * 15;
    const cachedCost = (totalCacheRead / 1_000_000) * 0.3;
    const totalCost = inputCost + outputCost + cachedCost;

    await onLog("stdout", JSON.stringify({ type: "result", summary: lastTextResponse || `Completed ${rounds} round(s)`, rounds, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, costUsd: Math.round(totalCost * 10000) / 10000 }) + "\n");

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: lastTextResponse || `Completed ${rounds} round(s) of tool calls`,
      resultJson: { summary: lastTextResponse || `Completed ${rounds} round(s)`, actions },
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
