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
        "Retrieve a single issue by its ID. Returns the full issue object including title, description, status, assignee, comments, and sub-issues.",
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
        "Update the status of an issue. Valid statuses typically include: backlog, todo, in_progress, in_review, done, cancelled.",
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
      description: "Add a comment to an issue. Use this to provide status updates, ask questions, or document decisions.",
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
        "Create a new sub-issue under a parent issue. Use this to break down work into smaller tasks.",
      input_schema: {
        type: "object" as const,
        properties: {
          title: { type: "string", description: "Title of the new sub-issue." },
          description: { type: "string", description: "Detailed description of the sub-issue." },
          parentId: { type: "string", description: "The ID of the parent issue." },
          assigneeAgentId: {
            type: "string",
            description: "The agent ID to assign this sub-issue to (optional).",
          },
        },
        required: ["title", "description", "parentId"],
      },
    },
    {
      name: "list_issues",
      description:
        "List all issues for the company. Returns an array of issue objects. Use this to get an overview of current work.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "list_agents",
      description: "List all agents in the company. Check this BEFORE hiring to avoid creating duplicates.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: [],
      },
    },
    {
      name: "hire_agent",
      description:
        "Hire a new agent. IMPORTANT: First call list_agents to check if one already exists for this role.",
      input_schema: {
        type: "object" as const,
        properties: {
          name: { type: "string", description: "Name for the new agent." },
          role: { type: "string", description: "Role description for the agent." },
          title: { type: "string", description: "Job title for the agent." },
          adapterType: {
            type: "string",
            description: 'The adapter type for the new agent (e.g. "nova_agent").',
          },
        },
        required: ["name", "role", "title", "adapterType"],
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// System prompt builder
// ---------------------------------------------------------------------------

function buildSystemPrompt(agent: AdapterExecutionContext["agent"], authToken: string | undefined): string {
  return `You are ${agent.name}, a Nova Corps officer.

Identity: ${agent.id} | Company ${agent.companyId}

You manage tasks and coordinate your team.

When hiring new agents, use Nova Corps character names from Marvel:
- Sam Alexander, Irani Rael, Garthan Saal, Jesse Alexander, Titus, Ko-Rel, Adora, Pyreus Kril
Give them real job titles: CTO, Product Manager, Designer, DevOps Engineer, etc.
Always set adapterType to "nova_agent".

Tools: list_issues, get_issue, update_issue_status, add_comment, create_sub_issue, list_agents, hire_agent

Rules:
- Check list_agents before hiring — never create duplicates.
- Update task status as you work (todo → in_progress → done).
- Keep comments brief and actionable.
- If nothing needs action, confirm and stop. No busywork.`;
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
      "You have been woken up for a heartbeat check. Review your assigned issues and take any necessary actions. " +
        "If there is nothing to do, briefly confirm that everything is up to date.",
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
      body = JSON.stringify({ content: toolInput.content });
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

    case "hire_agent":
      url = `${API_BASE}/companies/${companyId}/agent-hires`;
      method = "POST";
      body = JSON.stringify({
        name: toolInput.name,
        role: toolInput.role,
        title: toolInput.title,
        adapterType: toolInput.adapterType,
      });
      break;

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
  const systemPrompt = buildSystemPrompt(agent, authToken);
  const userPrompt = buildUserPrompt(context);
  const tools = buildTools(agent.companyId);

  await onLog("stdout", `[nova-agent] Starting run ${runId} for agent "${agent.name}" (${agent.id})\n`);
  await onLog("stdout", `[nova-agent] Model: ${model}\n`);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let lastTextResponse = "";
  let rounds = 0;

  // Build the initial messages array
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

      // Check for text blocks and tool_use blocks
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text",
      );
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
      );

      // Capture any text output
      for (const tb of textBlocks) {
        if (tb.text) {
          lastTextResponse = tb.text;
          await onLog("stdout", `[nova-agent] ${tb.text}\n`);
        }
      }

      // If no tool calls, we're done
      if (toolUseBlocks.length === 0) {
        await onLog("stdout", `[nova-agent] No more tool calls — finishing.\n`);
        break;
      }

      // Add the assistant's response to conversation history
      messages.push({ role: "assistant", content: response.content });

      // Execute each tool call and collect results
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

      // Add tool results to conversation
      messages.push({ role: "user", content: toolResults });

      // If the model signaled stop (end_turn) alongside tool calls, continue
      // to let it process the results. If stop_reason is "end_turn" with no
      // tool calls that was already handled above.
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
