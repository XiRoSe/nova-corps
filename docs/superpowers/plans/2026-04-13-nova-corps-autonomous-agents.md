# Nova Corps Autonomous Multi-Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the two disconnected systems — Paperclip (coordination/visibility) and NanoClaw (execution/capabilities) — into one autonomous AI agent team platform where each user gets a container hosting their entire agent team.

**Architecture:** Paperclip heartbeat triggers agent runs via HTTP to a per-user Nova Agent container on Railway. The container loads per-agent identity (CLAUDE.md), runs Claude with full tools (web, files, code + Paperclip task API callbacks), and streams structured JSON logs back. Paperclip captures transcripts, tracks costs, and surfaces everything in the UI.

**Tech Stack:** TypeScript, Express, Anthropic SDK, NanoClaw agent-runner, Railway, PostgreSQL (Drizzle), React (Vite), Tailwind CSS

---

## File Structure

### Nova Corps repo (C:\Users\aniha\PycharmProjects\nova-corps)

**Create:**
- `ui/src/adapters/nova-agent/index.ts` — UI adapter module (type, parser, config fields)
- `ui/src/adapters/nova-agent/parse-stdout.ts` — JSON line parser for transcripts
- `ui/src/adapters/nova-agent/config-fields.tsx` — Adapter config form (model picker)
- `ui/src/adapters/nova-agent/build-config.ts` — Config builder

**Modify:**
- `ui/src/adapters/registry.ts` — Register nova_agent adapter
- `ui/src/adapters/adapter-display-registry.ts` — Display metadata
- `server/src/adapters/nova-agent/execute.ts` — Delegate to container (replaces direct Anthropic call)
- `server/src/services/heartbeat.ts:3600` — Clear checkoutRunId on release
- `server/src/routes/issues.ts:2264` — Skip self-agent wakeup
- `server/src/services/issues.ts:428` — Inbox implicit touch fallback
- `ui/src/components/Sidebar.tsx` — Remove Channels
- `ui/src/App.tsx` — Remove NovaChannels route
- `ui/src/lib/company-routes.ts` — Remove "channels" from BOARD_ROUTE_ROOTS
- `server/src/app.ts:26,140` — Remove nova routes
- `ui/src/pages/NovaHome.tsx` — Add "Give Goal" input

**Delete:**
- `ui/src/pages/NovaChannels.tsx`
- `ui/src/api/nova.ts`
- `ui/src/hooks/useNovaChat.ts`
- `server/src/routes/nova.ts`
- `server/src/realtime/nova-chat-ws.ts`
- `server/src/services/nova-railway-manager.ts`

### Nova Agent repo (C:\Users\aniha\PycharmProjects\nova-agent)

**Create:**
- `src/agent-api.ts` — HTTP server with POST /agents/:agentId/run, GET /agents/:agentId/files, GET /health
- `src/paperclip-tools.ts` — Tool definitions that callback to Paperclip API
- `src/agent-config.ts` — Per-agent directory + CLAUDE.md management

**Modify:**
- `src/index.ts` — Start HTTP server alongside message loop
- `src/config.ts` — Add PAPERCLIP_API_URL, NOVA_COMPANY_ID env vars

---

## Phase 1: Nova Corps Fixes

### Task 1: Remove Dead Code (Channels, Nova Agent provisioning)

**Files:**
- Delete: `ui/src/pages/NovaChannels.tsx`
- Delete: `ui/src/api/nova.ts`
- Delete: `ui/src/hooks/useNovaChat.ts`
- Delete: `server/src/routes/nova.ts`
- Delete: `server/src/realtime/nova-chat-ws.ts`
- Delete: `server/src/services/nova-railway-manager.ts`
- Modify: `ui/src/components/Sidebar.tsx`
- Modify: `ui/src/App.tsx`
- Modify: `ui/src/lib/company-routes.ts`
- Modify: `server/src/app.ts`

- [ ] **Step 1: Remove Channels from sidebar**

In `ui/src/components/Sidebar.tsx`, remove the Channels nav item and the `Radio` import:

```typescript
// Remove from imports:
  Radio,

// Remove this line (~line 66):
          <SidebarNavItem to="/channels" label="Channels" icon={Radio} />
```

- [ ] **Step 2: Remove NovaChannels route from App.tsx**

In `ui/src/App.tsx`:

```typescript
// Remove import (~line 26):
import { NovaChannels } from "./pages/NovaChannels";

// Remove route (~line 112):
      <Route path="channels" element={<NovaChannels />} />
```

- [ ] **Step 3: Remove "channels" from BOARD_ROUTE_ROOTS**

In `ui/src/lib/company-routes.ts`, remove `"channels"` from the Set on line 1:

```typescript
const BOARD_ROUTE_ROOTS = new Set([
  "home",
  "chat",
  // "channels",  ← REMOVE THIS
  "dashboard",
  // ... rest stays
]);
```

- [ ] **Step 4: Remove nova routes from server**

In `server/src/app.ts`:

```typescript
// Remove import (~line 26):
import { novaRoutes } from "./routes/nova.js";

// Remove registration (~line 140):
  api.use(novaRoutes(db));
```

- [ ] **Step 5: Delete dead files**

```bash
rm ui/src/pages/NovaChannels.tsx
rm ui/src/api/nova.ts
rm ui/src/hooks/useNovaChat.ts
rm server/src/routes/nova.ts
rm server/src/realtime/nova-chat-ws.ts
rm server/src/services/nova-railway-manager.ts
```

- [ ] **Step 6: Verify build**

```bash
cd ui && node_modules/.bin/tsc.CMD --noEmit 2>&1 | head -20
```

If any import errors appear (files that imported deleted modules), fix them.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "chore: remove dead NanoClaw code — Channels, nova routes, Railway manager"
```

---

### Task 2: Fix Run Ownership Conflict

**Files:**
- Modify: `server/src/services/heartbeat.ts:3600-3605`

- [ ] **Step 1: Clear checkoutRunId when releasing execution lock**

In `server/src/services/heartbeat.ts`, find the `releaseIssueExecutionAndPromote` function (~line 3600). Change the `.set({...})` call:

```typescript
// BEFORE:
      await tx
        .update(issues)
        .set({
          executionRunId: null,
          executionAgentNameKey: null,
          executionLockedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issue.id));

// AFTER:
      await tx
        .update(issues)
        .set({
          executionRunId: null,
          executionAgentNameKey: null,
          executionLockedAt: null,
          checkoutRunId: null,
          updatedAt: new Date(),
        })
        .where(eq(issues.id, issue.id));
```

- [ ] **Step 2: Commit**

```bash
git add server/src/services/heartbeat.ts && git commit -m "fix: clear checkoutRunId on run release — prevents ownership conflicts"
```

---

### Task 3: Fix Inbox for Agent Comments

**Files:**
- Modify: `server/src/services/issues.ts:428-430`

- [ ] **Step 1: Add implicit touch fallback**

In `server/src/services/issues.ts`, find line ~428 where `myLastTouchAt` is computed:

```typescript
// BEFORE:
  const myLastTouchAt = [myLastCommentAt, myLastReadAt, createdTouchAt, assignedTouchAt]
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null;

// AFTER:
  const myLastTouchAt = [myLastCommentAt, myLastReadAt, createdTouchAt, assignedTouchAt]
    .filter((value): value is Date => value instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0]
    ?? (issue.createdAt instanceof Date ? issue.createdAt : new Date(issue.createdAt));
```

This makes every issue implicitly "touched" at creation time, so any agent comment posted after that shows as unread in the inbox.

- [ ] **Step 2: Commit**

```bash
git add server/src/services/issues.ts && git commit -m "fix: inbox shows agent comments — implicit touch on issue creation"
```

---

### Task 4: Register UI Transcript Parser for nova_agent

**Files:**
- Create: `ui/src/adapters/nova-agent/parse-stdout.ts`
- Create: `ui/src/adapters/nova-agent/config-fields.tsx`
- Create: `ui/src/adapters/nova-agent/build-config.ts`
- Create: `ui/src/adapters/nova-agent/index.ts`
- Modify: `ui/src/adapters/registry.ts`
- Modify: `ui/src/adapters/adapter-display-registry.ts`

- [ ] **Step 1: Create parse-stdout.ts**

Create `ui/src/adapters/nova-agent/parse-stdout.ts`:

```typescript
import type { TranscriptEntry } from "@paperclipai/adapter-utils";

function safeJsonParse(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function parseNovaAgentStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const parsed = safeJsonParse(line);

  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    // Try to parse [nova-agent] prefixed lines (legacy format)
    const stripped = line.replace(/^\[nova-agent\]\s*/, "");
    if (stripped !== line) {
      if (stripped.startsWith("Tool call: ")) {
        const match = stripped.match(/^Tool call: (\w+)\((.+)\)$/s);
        if (match) {
          const name = match[1]!;
          let input: unknown = match[2];
          try { input = JSON.parse(match[2]!); } catch { /* keep as string */ }
          return [{ kind: "tool_call", ts, name, input }];
        }
      }
      if (stripped.startsWith("Tool result")) {
        const isError = stripped.includes("(error)");
        const content = stripped.replace(/^Tool result \((ok|error)\):\s*/, "");
        return [{ kind: "tool_result", ts, toolUseId: "", content, isError }];
      }
      if (stripped.startsWith("API call round") || stripped.startsWith("Starting run") || stripped.startsWith("Completed.") || stripped.startsWith("No more tool calls")) {
        return [{ kind: "system", ts, text: stripped }];
      }
      // Agent reasoning text
      return [{ kind: "assistant", ts, text: stripped }];
    }
    // Raw unrecognized line
    if (line.trim()) return [{ kind: "stdout", ts, text: line }];
    return [];
  }

  // Structured JSON lines (new format from container)
  switch (parsed.type) {
    case "init":
      return [{
        kind: "init",
        ts,
        model: String(parsed.model ?? "unknown"),
        sessionId: String(parsed.agentName ?? ""),
      }];

    case "tool_call":
      return [{
        kind: "tool_call",
        ts,
        name: String(parsed.name ?? "unknown"),
        input: parsed.input ?? {},
        toolUseId: parsed.toolUseId as string | undefined,
      }];

    case "tool_result":
      return [{
        kind: "tool_result",
        ts,
        toolUseId: String(parsed.toolUseId ?? ""),
        content: String(parsed.preview ?? parsed.result ?? JSON.stringify(parsed)),
        isError: parsed.ok === false,
      }];

    case "thinking":
      return [{ kind: "thinking", ts, text: String(parsed.text ?? "") }];

    case "message":
    case "assistant":
      return [{ kind: "assistant", ts, text: String(parsed.text ?? "") }];

    case "result":
      return [{
        kind: "result",
        ts,
        text: String(parsed.summary ?? "Run complete"),
        inputTokens: Number(parsed.inputTokens ?? 0),
        outputTokens: Number(parsed.outputTokens ?? 0),
        cachedTokens: Number(parsed.cachedTokens ?? 0),
        costUsd: Number(parsed.costUsd ?? 0),
        subtype: "nova_agent",
        isError: false,
        errors: [],
      }];

    case "error":
      return [{ kind: "stderr", ts, text: String(parsed.text ?? parsed.error ?? "") }];

    default:
      return [{ kind: "stdout", ts, text: line }];
  }
}
```

- [ ] **Step 2: Create config-fields.tsx**

Create `ui/src/adapters/nova-agent/config-fields.tsx`:

```tsx
import type { AdapterConfigFieldsProps } from "../types";

export function NovaAgentConfigFields(_props: AdapterConfigFieldsProps) {
  return null;
}
```

- [ ] **Step 3: Create build-config.ts**

Create `ui/src/adapters/nova-agent/build-config.ts`:

```typescript
import type { CreateConfigValues } from "../types";

export function buildNovaAgentConfig(values: CreateConfigValues): Record<string, unknown> {
  return {
    model: values.model ?? "claude-sonnet-4-5-20250929",
  };
}
```

- [ ] **Step 4: Create index.ts adapter module**

Create `ui/src/adapters/nova-agent/index.ts`:

```typescript
import type { UIAdapterModule } from "../types";
import { parseNovaAgentStdoutLine } from "./parse-stdout";
import { NovaAgentConfigFields } from "./config-fields";
import { buildNovaAgentConfig } from "./build-config";

export const novaAgentUIAdapter: UIAdapterModule = {
  type: "nova_agent",
  label: "Nova Agent",
  parseStdoutLine: parseNovaAgentStdoutLine,
  ConfigFields: NovaAgentConfigFields,
  buildAdapterConfig: buildNovaAgentConfig,
};
```

- [ ] **Step 5: Register in registry.ts**

In `ui/src/adapters/registry.ts`, add import and registration:

```typescript
// Add import near top:
import { novaAgentUIAdapter } from "./nova-agent";

// Add to the array inside registerBuiltInUIAdapters():
  for (const adapter of [
    // ... existing adapters
    novaAgentUIAdapter,
  ]) {
```

- [ ] **Step 6: Add display entry in adapter-display-registry.ts**

In `ui/src/adapters/adapter-display-registry.ts`, add to `adapterDisplayMap`:

```typescript
import { Bot } from "lucide-react";

// Add entry:
  nova_agent: {
    label: "Nova Agent",
    description: "Autonomous AI agent with full capabilities",
    icon: Bot,
  },
```

- [ ] **Step 7: Verify build**

```bash
cd ui && node_modules/.bin/tsc.CMD --noEmit 2>&1 | head -20
```

- [ ] **Step 8: Commit**

```bash
git add ui/src/adapters/nova-agent/ ui/src/adapters/registry.ts ui/src/adapters/adapter-display-registry.ts
git commit -m "feat: register nova_agent UI adapter — structured transcript parsing"
```

---

### Task 5: Update Adapter to Emit Structured JSON Logs

**Files:**
- Modify: `server/src/adapters/nova-agent/execute.ts`

- [ ] **Step 1: Replace raw text onLog calls with JSON lines**

Rewrite the logging in `server/src/adapters/nova-agent/execute.ts`. Every `onLog` call should emit one JSON line. Replace the entire execute function's logging pattern:

```typescript
// At the start of execution, emit init:
await onLog("stdout", JSON.stringify({ type: "init", agent: agent.name, role: (agent as any).role, model }) + "\n");

// For each tool call:
await onLog("stdout", JSON.stringify({
  type: "tool_call",
  name: toolUse.name,
  input: toolUse.input,
  toolUseId: toolUse.id,
}) + "\n");

// For each tool result:
await onLog("stdout", JSON.stringify({
  type: "tool_result",
  name: toolUse.name,
  ok: result.ok,
  preview: resultText.slice(0, 200),
  toolUseId: toolUse.id,
}) + "\n");

// For agent text responses:
for (const tb of textBlocks) {
  if (tb.text) {
    lastTextResponse = tb.text;
    await onLog("stdout", JSON.stringify({ type: "thinking", text: tb.text }) + "\n");
  }
}

// At the end, emit result:
await onLog("stdout", JSON.stringify({
  type: "result",
  summary: lastTextResponse || `Completed ${rounds} round(s)`,
  rounds,
  inputTokens: totalInputTokens,
  outputTokens: totalOutputTokens,
  costUsd: totalCost,
}) + "\n");
```

Also add `resultJson` to the return value:

```typescript
return {
  // ... existing fields
  resultJson: {
    summary: lastTextResponse || `Completed ${rounds} round(s)`,
    actions: actions, // track in a local array during execution
  },
};
```

Track actions by adding before the tool loop:

```typescript
const actions: Array<{ tool: string; input: unknown; ok: boolean }> = [];
// Inside the tool loop after executeToolCall:
actions.push({ tool: toolUse.name, input: toolUse.input, ok: result.ok });
```

- [ ] **Step 2: Commit**

```bash
git add server/src/adapters/nova-agent/execute.ts
git commit -m "feat: adapter emits structured JSON logs — enables rich transcript display"
```

---

### Task 6: Add "Give Goal" Input on Home Page

**Files:**
- Modify: `ui/src/pages/NovaHome.tsx`

- [ ] **Step 1: Add goal input to NovaHome**

In `ui/src/pages/NovaHome.tsx`, add a text input above the stats row. After the header section and before the stats grid:

```tsx
import { heartbeatsApi } from "@/api/heartbeats";

// Inside NovaHome component, add state:
const [goalInput, setGoalInput] = useState("");
const [submittingGoal, setSubmittingGoal] = useState(false);

// Find the CEO agent:
const ceoAgent = agents.find((a) => a.role === "ceo") ?? agents[0];

// Add handler:
const handleGiveGoal = async () => {
  if (!goalInput.trim() || !selectedCompanyId || !ceoAgent) return;
  setSubmittingGoal(true);
  try {
    await issuesApi.create(selectedCompanyId, {
      title: goalInput.trim(),
      assigneeAgentId: ceoAgent.id,
      status: "todo",
    });
    // Trigger immediate heartbeat for CEO
    await heartbeatsApi.triggerAgent(ceoAgent.id);
    setGoalInput("");
    // Refresh data
    issuesQuery.refetch();
  } catch { /* silent */ }
  setSubmittingGoal(false);
};
```

Add the UI between the header and stats row:

```tsx
{/* Give Goal */}
{agents.length > 0 && (
  <div className="mb-8 rounded-lg border border-primary/20 bg-primary/5 p-4">
    <p className="text-sm font-medium text-foreground mb-2">What should your team work on?</p>
    <div className="flex gap-2">
      <input
        type="text"
        value={goalInput}
        onChange={(e) => setGoalInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleGiveGoal()}
        placeholder="e.g. Build a go-to-market strategy for our SaaS product"
        className="flex-1 rounded-lg border border-border bg-background px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        disabled={submittingGoal}
      />
      <Button onClick={handleGiveGoal} disabled={!goalInput.trim() || submittingGoal}>
        {submittingGoal ? <Loader2 className="h-4 w-4 animate-spin" /> : "Go"}
      </Button>
    </div>
  </div>
)}
```

- [ ] **Step 2: Check if heartbeatsApi.triggerAgent exists**

Search for `triggerAgent` or `trigger` in `ui/src/api/heartbeats.ts`. If it doesn't exist, add it:

```typescript
triggerAgent: (agentId: string) =>
  api.post<void>(`/agents/${agentId}/heartbeat-trigger`, {}),
```

- [ ] **Step 3: Commit**

```bash
git add ui/src/pages/NovaHome.tsx ui/src/api/heartbeats.ts
git commit -m "feat: Give Goal input — user types a goal, CEO gets assigned and triggered"
```

---

### Task 7: Push Phase 1 and Verify Deploy

- [ ] **Step 1: Push to master**

```bash
git push origin master
```

- [ ] **Step 2: Wait for Railway deploy**

Poll until the bundle hash changes:
```bash
for i in $(seq 1 15); do sleep 20; HASH=$(curl -s https://nova-corps-production.up.railway.app/ 2>/dev/null | grep -o 'assets/index-[a-zA-Z0-9]*\.js' | head -1); echo "[$i] $HASH"; done
```

- [ ] **Step 3: Verify with Playwright**

Test Home page: stats visible, Give Goal input present, no Channels in sidebar, no red plugin errors.

Test Agent Detail → Runs tab → click a run → structured transcript visible (tool calls, not just "run started/succeeded").

Test Inbox: trigger a heartbeat, agent posts comment, check if inbox badge appears.

---

## Phase 2: Nova Agent Container — Multi-Agent Endpoint

### Task 8: Add HTTP Server to Nova Agent

**Files (in nova-agent repo):**
- Create: `src/agent-api.ts`
- Modify: `src/index.ts`
- Modify: `src/config.ts`

- [ ] **Step 1: Add config vars**

In `C:\Users\aniha\PycharmProjects\nova-agent\src\config.ts`, add:

```typescript
export const AGENT_API_PORT = parseInt(process.env.AGENT_API_PORT || process.env.PORT || "3000", 10);
export const PAPERCLIP_API_URL = process.env.PAPERCLIP_API_URL || "";
export const NOVA_COMPANY_ID = process.env.NOVA_COMPANY_ID || "";
```

- [ ] **Step 2: Create agent-api.ts**

Create `C:\Users\aniha\PycharmProjects\nova-agent\src\agent-api.ts`:

```typescript
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AGENT_API_PORT } from "./config.js";
import { runAgentForPaperclip } from "./paperclip-runner.js";
import { listAgentFiles, readAgentFile } from "./agent-config.js";
import pino from "pino";

const logger = pino({ name: "agent-api" });

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function handleRequest(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", `http://localhost:${AGENT_API_PORT}`);
  const method = req.method ?? "GET";

  // GET /health
  if (method === "GET" && url.pathname === "/health") {
    return json(res, 200, { status: "ok", agents: "multi-agent" });
  }

  // POST /agents/:agentId/run
  const runMatch = url.pathname.match(/^\/agents\/([^/]+)\/run$/);
  if (method === "POST" && runMatch) {
    const agentId = runMatch[1]!;
    const body = JSON.parse(await readBody(req));

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    });

    try {
      await runAgentForPaperclip(agentId, body, (line: string) => {
        res.write(line + "\n");
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      res.write(JSON.stringify({ type: "error", text: msg }) + "\n");
    }

    res.end();
    return;
  }

  // GET /agents/:agentId/files
  const filesMatch = url.pathname.match(/^\/agents\/([^/]+)\/files$/);
  if (method === "GET" && filesMatch) {
    const files = await listAgentFiles(filesMatch[1]!);
    return json(res, 200, files);
  }

  // GET /agents/:agentId/files/*path
  const fileMatch = url.pathname.match(/^\/agents\/([^/]+)\/files\/(.+)$/);
  if (method === "GET" && fileMatch) {
    const content = await readAgentFile(fileMatch[1]!, fileMatch[2]!);
    if (content === null) return json(res, 404, { error: "File not found" });
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end(content);
    return;
  }

  json(res, 404, { error: "Not found" });
}

export function startAgentApi() {
  const server = createServer(handleRequest);
  server.listen(AGENT_API_PORT, () => {
    logger.info({ port: AGENT_API_PORT }, "Nova Agent API started");
  });
  return server;
}
```

- [ ] **Step 3: Start HTTP server in index.ts**

In `C:\Users\aniha\PycharmProjects\nova-agent\src\index.ts`, import and start the API:

```typescript
import { startAgentApi } from "./agent-api.js";

// Near the top of main(), before or after startMessageLoop():
startAgentApi();
```

- [ ] **Step 4: Commit**

```bash
cd C:/Users/aniha/PycharmProjects/nova-agent
git add src/agent-api.ts src/config.ts src/index.ts
git commit -m "feat: add HTTP API for multi-agent runs — POST /agents/:id/run"
```

---

### Task 9: Per-Agent Directory & CLAUDE.md Management

**Files (in nova-agent repo):**
- Create: `src/agent-config.ts`

- [ ] **Step 1: Create agent-config.ts**

Create `C:\Users\aniha\PycharmProjects\nova-agent\src\agent-config.ts`:

```typescript
import { mkdir, readFile, writeFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { RAILWAY_VOLUME } from "./config.js";

const AGENTS_DIR = join(RAILWAY_VOLUME || "/data", "agents");

export function agentDir(agentId: string): string {
  return join(AGENTS_DIR, agentId);
}

export async function ensureAgentDir(agentId: string, meta: { name: string; role: string; title: string; capabilities?: string }): Promise<string> {
  const dir = agentDir(agentId);
  await mkdir(join(dir, "workspace"), { recursive: true });
  await mkdir(join(dir, "history"), { recursive: true });

  const claudeMdPath = join(dir, "CLAUDE.md");
  try {
    await stat(claudeMdPath);
  } catch {
    // Create initial CLAUDE.md
    const content = `# ${meta.name} — ${meta.title}, Nova Corps

## Identity
You are ${meta.name}, ${meta.title} at Nova Corps.
${meta.capabilities ? `\n## Focus\n${meta.capabilities}\n` : ""}
## Memory
(This section will be updated as you learn things. You can edit this file to remember important context.)
`;
    await writeFile(claudeMdPath, content, "utf-8");
  }

  return dir;
}

export async function readClaudeMd(agentId: string): Promise<string> {
  try {
    return await readFile(join(agentDir(agentId), "CLAUDE.md"), "utf-8");
  } catch {
    return "";
  }
}

export async function listAgentFiles(agentId: string): Promise<Array<{ path: string; size: number }>> {
  const dir = join(agentDir(agentId), "workspace");
  try {
    const entries = await readdir(dir, { recursive: true });
    const files: Array<{ path: string; size: number }> = [];
    for (const entry of entries) {
      const s = await stat(join(dir, entry));
      if (s.isFile()) files.push({ path: entry, size: s.size });
    }
    return files;
  } catch {
    return [];
  }
}

export async function readAgentFile(agentId: string, filePath: string): Promise<string | null> {
  try {
    return await readFile(join(agentDir(agentId), "workspace", filePath), "utf-8");
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/agent-config.ts
git commit -m "feat: per-agent directory management with CLAUDE.md identity + memory"
```

---

### Task 10: Paperclip Tool Bridge + Agent Runner

**Files (in nova-agent repo):**
- Create: `src/paperclip-tools.ts`
- Create: `src/paperclip-runner.ts`

- [ ] **Step 1: Create paperclip-tools.ts**

Create `C:\Users\aniha\PycharmProjects\nova-agent\src\paperclip-tools.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";

export function buildPaperclipTools(apiUrl: string, authToken: string, companyId: string): {
  tools: Anthropic.Tool[];
  execute: (name: string, input: Record<string, unknown>) => Promise<{ ok: boolean; body: unknown }>;
} {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${authToken}`,
  };

  const tools: Anthropic.Tool[] = [
    { name: "list_issues", description: "List all tasks for the company.", input_schema: { type: "object" as const, properties: {}, required: [] } },
    { name: "get_issue", description: "Get a task by ID.", input_schema: { type: "object" as const, properties: { issueId: { type: "string" } }, required: ["issueId"] } },
    { name: "update_issue_status", description: "Update task status: backlog, todo, in_progress, in_review, done, cancelled.", input_schema: { type: "object" as const, properties: { issueId: { type: "string" }, status: { type: "string" } }, required: ["issueId", "status"] } },
    { name: "add_comment", description: "Post a comment on a task. The user sees this in their inbox. Use tags: **Question**, **Update**, **Blocker**, **Done**.", input_schema: { type: "object" as const, properties: { issueId: { type: "string" }, content: { type: "string" } }, required: ["issueId", "content"] } },
    { name: "create_sub_issue", description: "Create a sub-task.", input_schema: { type: "object" as const, properties: { title: { type: "string" }, description: { type: "string" }, parentId: { type: "string" }, assigneeAgentId: { type: "string" } }, required: ["title", "description", "parentId"] } },
    { name: "list_agents", description: "List all agents. Check before hiring.", input_schema: { type: "object" as const, properties: {}, required: [] } },
    { name: "hire_agent", description: "Hire a new agent. Use Nova Corps names. Set adapterType to nova_agent.", input_schema: { type: "object" as const, properties: { name: { type: "string" }, role: { type: "string" }, title: { type: "string" }, adapterType: { type: "string" }, capabilities: { type: "string" } }, required: ["name", "role", "title", "adapterType"] } },
  ];

  async function execute(name: string, input: Record<string, unknown>): Promise<{ ok: boolean; body: unknown }> {
    let url: string;
    let method = "GET";
    let body: string | undefined;

    switch (name) {
      case "list_issues": url = `${apiUrl}/companies/${companyId}/issues`; break;
      case "get_issue": url = `${apiUrl}/companies/${companyId}/issues/${input.issueId}`; break;
      case "update_issue_status":
        url = `${apiUrl}/issues/${input.issueId}`;
        method = "PATCH";
        body = JSON.stringify({ status: input.status });
        break;
      case "add_comment":
        url = `${apiUrl}/issues/${input.issueId}/comments`;
        method = "POST";
        body = JSON.stringify({ body: input.content });
        break;
      case "create_sub_issue":
        url = `${apiUrl}/companies/${companyId}/issues`;
        method = "POST";
        body = JSON.stringify({ title: input.title, description: input.description, parentId: input.parentId, assigneeAgentId: input.assigneeAgentId });
        break;
      case "list_agents": url = `${apiUrl}/companies/${companyId}/agents`; break;
      case "hire_agent":
        url = `${apiUrl}/companies/${companyId}/agent-hires`;
        method = "POST";
        body = JSON.stringify({ name: input.name, role: input.role, title: input.title, adapterType: input.adapterType || "nova_agent", capabilities: input.capabilities, runtimeConfig: { heartbeat: { enabled: true, intervalSec: 7200, wakeOnDemand: true, maxConcurrentRuns: 1 } } });
        break;
      default: return { ok: false, body: { error: `Unknown tool: ${name}` } };
    }

    const res = await fetch(url, { method, headers, ...(body ? { body } : {}) });
    const text = await res.text();
    try { return { ok: res.ok, body: JSON.parse(text) }; } catch { return { ok: res.ok, body: text }; }
  }

  return { tools, execute };
}
```

- [ ] **Step 2: Create paperclip-runner.ts**

Create `C:\Users\aniha\PycharmProjects\nova-agent\src\paperclip-runner.ts`:

```typescript
import Anthropic from "@anthropic-ai/sdk";
import { ensureAgentDir, readClaudeMd } from "./agent-config.js";
import { buildPaperclipTools } from "./paperclip-tools.js";
import { ROLE_PROFILES } from "./role-profiles.js";

const MAX_ROUNDS = 20;

interface RunRequest {
  agentId: string;
  agentName: string;
  role: string;
  title: string;
  capabilities?: string;
  context: Record<string, unknown>;
  paperclipApiUrl: string;
  paperclipAuthToken: string;
  model?: string;
  companyId?: string;
}

export async function runAgentForPaperclip(
  agentId: string,
  request: RunRequest,
  emit: (line: string) => void,
): Promise<void> {
  const model = request.model || "claude-sonnet-4-5-20250929";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  // Ensure agent directory + CLAUDE.md
  await ensureAgentDir(agentId, {
    name: request.agentName,
    role: request.role,
    title: request.title,
    capabilities: request.capabilities,
  });

  // Load agent identity
  const claudeMd = await readClaudeMd(agentId);
  const roleProfile = ROLE_PROFILES[request.role] || ROLE_PROFILES.general || "";

  // Build tools
  const companyId = request.companyId || "";
  const { tools: paperclipTools, execute: executePaperclipTool } = buildPaperclipTools(
    request.paperclipApiUrl,
    request.paperclipAuthToken,
    companyId,
  );

  // TODO: Add local tools (web_search, read_file, write_file, run_code) in future task
  const allTools = [...paperclipTools];

  // Build system prompt
  const systemPrompt = `${claudeMd}\n\n${roleProfile}\n\nYour comments on tasks go directly to the user's inbox. When you need input, ASK. When you finish something, TELL. Tag: **Question**, **Update**, **Blocker**, **Done**.`;

  // Build user prompt
  const wake = request.context.paperclipWake;
  const userPrompt = wake
    ? `## Wake Event\n${JSON.stringify(wake, null, 2)}`
    : "Heartbeat. Check tasks and your team. Take meaningful action or stay silent.";

  emit(JSON.stringify({ type: "init", model, agentName: request.agentName }));

  const anthropic = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];
  let totalIn = 0, totalOut = 0, rounds = 0, lastText = "";
  const actions: Array<{ tool: string; ok: boolean }> = [];

  while (rounds < MAX_ROUNDS) {
    rounds++;
    const response = await anthropic.messages.create({ model, max_tokens: 4096, system: systemPrompt, messages, tools: allTools });

    totalIn += response.usage?.input_tokens ?? 0;
    totalOut += response.usage?.output_tokens ?? 0;

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    for (const tb of textBlocks) {
      if (tb.text) {
        lastText = tb.text;
        emit(JSON.stringify({ type: "thinking", text: tb.text }));
      }
    }

    if (toolBlocks.length === 0) break;

    messages.push({ role: "assistant", content: response.content });
    const results: Anthropic.ToolResultBlockParam[] = [];

    for (const tu of toolBlocks) {
      emit(JSON.stringify({ type: "tool_call", name: tu.name, input: tu.input, toolUseId: tu.id }));

      const result = await executePaperclipTool(tu.name, tu.input as Record<string, unknown>);
      const preview = typeof result.body === "string" ? result.body.slice(0, 200) : JSON.stringify(result.body).slice(0, 200);
      actions.push({ tool: tu.name, ok: result.ok });

      emit(JSON.stringify({ type: "tool_result", name: tu.name, ok: result.ok, preview, toolUseId: tu.id }));

      results.push({
        type: "tool_result",
        tool_use_id: tu.id,
        content: typeof result.body === "string" ? result.body : JSON.stringify(result.body),
        is_error: !result.ok,
      });
    }

    messages.push({ role: "user", content: results });
  }

  const inputCost = (totalIn / 1_000_000) * 3;
  const outputCost = (totalOut / 1_000_000) * 15;

  emit(JSON.stringify({
    type: "result",
    summary: lastText || `Completed ${rounds} rounds`,
    rounds,
    inputTokens: totalIn,
    outputTokens: totalOut,
    costUsd: Math.round((inputCost + outputCost) * 10000) / 10000,
    actions,
  }));
}
```

- [ ] **Step 3: Create role-profiles.ts**

Create `C:\Users\aniha\PycharmProjects\nova-agent\src\role-profiles.ts` — copy the `ROLE_PROFILES` object from `nova-corps/server/src/adapters/nova-agent/execute.ts` (the CEO/Engineer/Designer/General profiles).

- [ ] **Step 4: Install @anthropic-ai/sdk in nova-agent**

```bash
cd C:/Users/aniha/PycharmProjects/nova-agent
npm install @anthropic-ai/sdk
```

- [ ] **Step 5: Commit**

```bash
git add src/paperclip-tools.ts src/paperclip-runner.ts src/role-profiles.ts package.json package-lock.json
git commit -m "feat: multi-agent runner — Paperclip tool bridge + structured JSON streaming"
```

---

## Phase 3: Wire Together

### Task 11: Update nova_agent Adapter to Delegate to Container

**Files (in nova-corps repo):**
- Modify: `server/src/adapters/nova-agent/execute.ts`

- [ ] **Step 1: Rewrite execute to call container**

Replace the entire `execute` function in `server/src/adapters/nova-agent/execute.ts` to delegate to the container instead of calling Anthropic directly:

```typescript
import type { AdapterExecutionContext, AdapterExecutionResult } from "../types.js";

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const { runId, agent, config, context, onLog, authToken } = ctx;
  const model = (config.model as string) || "claude-sonnet-4-5-20250929";

  // Get container URL from environment or database
  const containerUrl = process.env.NOVA_CONTAINER_URL;
  if (!containerUrl) {
    // Fallback: run locally with Anthropic API (existing behavior)
    return executeLocal(ctx);
  }

  if (!authToken) {
    return { exitCode: 1, signal: null, timedOut: false, errorMessage: "No authToken" };
  }

  const agentExt = agent as Record<string, unknown>;

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
        paperclipApiUrl: `http://localhost:3100/api`,
        paperclipAuthToken: authToken,
        model,
        companyId: agent.companyId,
      }),
    });

    let lastResult: Record<string, unknown> = {};
    const actions: Array<{ tool: string; ok: boolean }> = [];
    const text = await response.text();

    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      await onLog("stdout", line + "\n");

      // Parse the last result line for return value
      try {
        const parsed = JSON.parse(line);
        if (parsed.type === "result") lastResult = parsed;
        if (parsed.type === "tool_result") actions.push({ tool: parsed.name, ok: parsed.ok });
      } catch { /* skip */ }
    }

    const totalCost = Number(lastResult.costUsd ?? 0);
    const inputTokens = Number(lastResult.inputTokens ?? 0);
    const outputTokens = Number(lastResult.outputTokens ?? 0);

    return {
      exitCode: 0,
      signal: null,
      timedOut: false,
      summary: String(lastResult.summary ?? "Run complete"),
      resultJson: { summary: lastResult.summary, actions },
      usage: { inputTokens, outputTokens, cachedInputTokens: 0 },
      costUsd: totalCost,
      model,
      provider: "anthropic",
      billingType: "api",
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await onLog("stderr", `Container error: ${msg}\n`);
    return { exitCode: 1, signal: null, timedOut: false, errorMessage: msg };
  }
}
```

Keep the existing `execute` function renamed to `executeLocal` as a fallback when `NOVA_CONTAINER_URL` is not set. This way existing deployments still work.

- [ ] **Step 2: Commit**

```bash
git add server/src/adapters/nova-agent/execute.ts
git commit -m "feat: nova_agent adapter delegates to container — falls back to local API"
```

---

### Task 12: Deploy Container and Set Environment Variable

- [ ] **Step 1: Push nova-agent changes**

```bash
cd C:/Users/aniha/PycharmProjects/nova-agent
git push origin main
```

- [ ] **Step 2: Deploy on Railway**

The nova-agent repo should already have a Railway service configured (from the existing nova-railway-manager setup). If not, create one via Railway dashboard:
- Connect to XiRoSe/nova-agent repo
- Set env vars: `ANTHROPIC_API_KEY`, `PORT=3000`
- Add volume at `/data`
- Wait for deploy

- [ ] **Step 3: Set NOVA_CONTAINER_URL on nova-corps**

Once the container is deployed and has a domain (e.g., `https://nova-agent-production.up.railway.app`), set the env var on the nova-corps Railway service:

```
NOVA_CONTAINER_URL=https://nova-agent-production.up.railway.app
```

- [ ] **Step 4: Push nova-corps changes**

```bash
cd C:/Users/aniha/PycharmProjects/nova-corps
git push origin master
```

- [ ] **Step 5: Verify end-to-end**

1. Navigate to Home page
2. Type a goal in the "Give Goal" input
3. CEO should be assigned and heartbeat triggered
4. Check agent detail → run should show structured transcript
5. Check inbox → should show agent comment notification
