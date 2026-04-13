# Nova Corps — Autonomous Multi-Agent Architecture

## Problem

Nova Corps has two disconnected systems:
- **Paperclip fork** (nova-corps): coordination layer with tasks, agents, runs, inbox, visibility
- **NanoClaw fork** (nova-agent): powerful container with Claude, web browsing, file system, code execution, channels

Currently agents are just Paperclip heartbeat rows making raw Anthropic API calls. They can think and comment but can't DO anything — no web search, no file creation, no code execution. The Nova Agent container exists but isn't connected to the agent team.

## Solution

Merge them. One Nova Agent container per user on Railway hosts their entire agent team. Paperclip coordinates and provides visibility. The container executes with full capabilities.

## Architecture

```
Nova Corps (Paperclip Fork)          Nova Agent Container (NanoClaw Fork)
┌──────────────────────────┐         ┌──────────────────────────────────┐
│ Coordinator & UI          │         │ Execution Engine (per user)      │
│                          │  HTTP   │                                  │
│ - Agent registry         │────────>│ POST /agents/:id/run             │
│ - Task management        │ trigger │   → Loads agent CLAUDE.md        │
│ - Heartbeat scheduler    │         │   → Runs Claude with full tools  │
│ - Run transcripts        │<────────│   → Streams JSON log lines back  │
│ - Inbox & notifications  │ results │                                  │
│ - Cost tracking          │         │ Per-agent isolation:             │
│ - Home, Chat, Detail UI  │         │   /data/agents/{id}/CLAUDE.md    │
│                          │         │   /data/agents/{id}/workspace/   │
│ Database:                │         │   /data/agents/{id}/history/     │
│   agents, issues,        │         │                                  │
│   heartbeat_runs,        │         │ Shared capabilities:             │
│   issue_comments,        │         │   Chromium (web browse)          │
│   nova_environments      │         │   Node.js (code execution)       │
└──────────────────────────┘         │   Channels (WhatsApp, etc.)      │
                                     │   File system (/data/shared/)    │
                                     └──────────────────────────────────┘
```

## Container API Contract

### POST /agents/:agentId/run

Paperclip's heartbeat calls this when an agent needs to work.

**Request:**
```json
{
  "agentId": "f2156da0-...",
  "agentName": "Richard Rider",
  "role": "ceo",
  "title": "CEO",
  "capabilities": "You lead the Nova Corps team...",
  "context": {
    "wakeReason": "timer",
    "issueId": "abc-123",
    "paperclipWake": { ... }
  },
  "paperclipApiUrl": "https://nova-corps-production.up.railway.app/api",
  "paperclipAuthToken": "jwt-xxx",
  "model": "claude-sonnet-4-5-20250929"
}
```

**Response:** Streaming JSON lines (one per line):
```json
{"type":"init","model":"claude-sonnet-4-5","agentName":"Richard Rider"}
{"type":"tool_call","name":"list_issues","input":{},"toolUseId":"tu_1"}
{"type":"tool_result","name":"list_issues","ok":true,"preview":"3 tasks found","toolUseId":"tu_1"}
{"type":"thinking","text":"I see 3 tasks. UPS-2 needs research..."}
{"type":"tool_call","name":"web_search","input":{"query":"B2B SaaS pricing models"},"toolUseId":"tu_2"}
{"type":"tool_result","name":"web_search","ok":true,"preview":"10 results","toolUseId":"tu_2"}
{"type":"tool_call","name":"write_file","input":{"path":"pricing-research.md","content":"# Pricing Research\n..."},"toolUseId":"tu_3"}
{"type":"tool_result","name":"write_file","ok":true,"toolUseId":"tu_3"}
{"type":"tool_call","name":"add_comment","input":{"issueId":"abc","content":"**Done**: Research attached"},"toolUseId":"tu_4"}
{"type":"tool_result","name":"add_comment","ok":true,"toolUseId":"tu_4"}
{"type":"result","summary":"Completed pricing research","rounds":4,"inputTokens":20000,"outputTokens":3000,"costUsd":0.11}
```

### GET /agents/:agentId/files

List files in agent's workspace. Returns `[{path, size, modified}]`.

### GET /agents/:agentId/files/*path

Read a specific file. For viewing deliverables in the UI.

### GET /health

Container health + channel status.

## Agent Tools (Two Categories)

### Paperclip Tools (HTTP callbacks to Paperclip API)
These let agents coordinate through the task system:
- `list_issues` — See all tasks
- `get_issue` — Get task details
- `update_issue_status` — Move tasks through workflow
- `add_comment` — Post updates, questions, deliverables (appears in inbox)
- `create_sub_issue` — Break work into sub-tasks
- `list_agents` — See the team
- `hire_agent` — Bring in new specialists

### Local Tools (run inside the container)
These let agents actually DO work:
- `web_search` — Search the internet (via SerpAPI/Tavily)
- `browse_url` — Read a web page (via Jina or Playwright/Chromium)
- `read_file` — Read files from workspace
- `write_file` — Create/update files (documents, code, research)
- `list_files` — List workspace contents
- `run_code` — Execute Node.js/Python scripts
- `read_shared_file` — Read from /data/shared/ (cross-agent collaboration)
- `write_shared_file` — Write to /data/shared/

## Per-Agent Configuration

Each agent gets a directory at `/data/agents/{agentId}/`:

```
/data/agents/richard-rider/
├── CLAUDE.md          # System prompt + persistent memory
├── config.json        # Role, tools, model preferences
├── workspace/         # Files this agent created
│   ├── strategy.md
│   └── hiring-plan.md
└── history/           # Conversation logs for context
    └── latest.json
```

**CLAUDE.md** is both identity and memory — the agent reads it at the start of every run and can update it (like Claude Code's memory system). Example:

```markdown
# Richard Rider — CEO, Nova Corps

## Identity
You are Richard Rider, CEO of Nova Corps. You lead the agent team.

## My Team
- Rhomann Dey (AI Engineer) — handles technical tasks
- Irani Rael (Marketing Lead) — hired 2026-04-13 for GTM strategy

## What I've Learned
- User prefers B2B focus, skip consumer
- Budget is $50/month for AI costs
- User wants weekly progress summaries
```

## Changes to Nova Corps (Paperclip Fork)

### 1. nova_agent Adapter — Delegate to Container
`server/src/adapters/nova-agent/execute.ts`

Instead of calling Anthropic directly, POST to the user's container:
```typescript
const containerUrl = await getContainerUrl(agent.companyId);
const response = await fetch(`${containerUrl}/agents/${agent.id}/run`, {
  method: "POST",
  body: JSON.stringify({ agentId, agentName, role, context, paperclipApiUrl, paperclipAuthToken }),
});
// Stream response lines → onLog() for transcript capture
for await (const line of response.body) {
  await onLog("stdout", line);
}
```

### 2. Container Provisioning
`server/src/services/nova-railway-manager.ts` (already exists, needs updates)

When a user signs up or first creates a company:
- Fork XiRoSe/nova-agent → user's GitHub
- Create Railway service with env vars (ANTHROPIC_API_KEY, etc.)
- Store container URL in `nova_environments` table
- Container starts, agents get directories created on first run

### 3. UI Transcript Parser
`ui/src/adapters/nova-agent/index.ts` (new file)

Reads the structured JSON lines and maps to `TranscriptEntry` kinds:
- `tool_call`, `tool_result`, `assistant`, `thinking`, `result`, `init`
- Registered in `ui/src/adapters/registry.ts`

### 4. Fix Run Ownership Conflict
`server/src/services/heartbeat.ts`

Clear `checkoutRunId` when releasing execution lock. Skip wakeup when commenting agent is the same as assigned agent.

### 5. Fix Inbox
`server/src/services/issues.ts`

Use `issue.createdAt` as implicit touch when `myLastTouchAt` is null.

### 6. Remove Dead Code
Delete: NovaChannels.tsx, old nova.ts routes (replaced by new container proxy), useNovaChat.ts. Remove "Channels" from sidebar.

### 7. "Give Goal" on Home Page
`ui/src/pages/NovaHome.tsx`

Text input: "What do you want your team to work on?" → Creates task assigned to CEO → Triggers immediate heartbeat → CEO runs in container with full capabilities.

## Changes to Nova Agent (NanoClaw Fork)

### 1. Multi-Agent HTTP Endpoint
Add `POST /agents/:agentId/run` to the NanoClaw HTTP server.

This endpoint:
- Receives agent identity + context from Paperclip
- Loads agent's CLAUDE.md from `/data/agents/{agentId}/`
- Creates CLAUDE.md on first run if it doesn't exist
- Builds tool set: Paperclip tools (HTTP) + local tools (files, web, code)
- Runs Claude via agent-runner with streaming output
- Returns structured JSON lines

### 2. Per-Agent Directories
On first run for an agent, create:
```
/data/agents/{agentId}/CLAUDE.md
/data/agents/{agentId}/workspace/
/data/agents/{agentId}/history/
```

### 3. Paperclip Tool Bridge
Agent-runner gets tools that call back to Paperclip API:
```typescript
const paperclipTools = buildPaperclipTools(paperclipApiUrl, paperclipAuthToken, companyId);
// Each tool makes HTTP request: GET/POST/PATCH to Paperclip API
```

### 4. File Serving Endpoint
`GET /agents/:agentId/files` and `GET /agents/:agentId/files/*path` for the Nova Corps UI to display agent-created documents.

## User Flow

1. **User signs up** → Container provisioned on Railway (once)
2. **User types goal** on Home page → Task created for CEO → Heartbeat fires
3. **CEO runs in container** with full capabilities → Researches, plans, breaks down tasks, hires agents, posts comments
4. **User gets inbox notification** → Reads CEO's update → Replies if needed
5. **Specialist agents wake up** → Work on their tasks in the container → Post deliverables
6. **User sees everything** in Home page (activity), Team Chat (comments), Agent Detail (full transcripts with tool calls), Inbox (notifications)

## Implementation Phases

### Phase 1: Nova Corps Fixes (ship immediately)
- Remove dead code (Channels, old nova routes)
- Fix run ownership conflict
- Fix inbox for agent comments
- Register UI transcript parser (even before container, improves current raw API runs)

### Phase 2: Container Multi-Agent Endpoint (nova-agent repo)
- Add POST /agents/:agentId/run
- Per-agent directory + CLAUDE.md management
- Paperclip tool bridge (HTTP callbacks)
- Local tools (files, web search, code execution)
- Structured JSON line streaming

### Phase 3: Wire It Together
- nova_agent adapter delegates to container instead of calling Anthropic directly
- Container provisioning on user signup
- "Give Goal" input on Home page
- Agent file viewer in UI

### Phase 4: Polish
- Agent memory (CLAUDE.md updates persisting across runs)
- Shared workspace for cross-agent collaboration
- Channel integration (WhatsApp/Telegram routed to specific agents)
