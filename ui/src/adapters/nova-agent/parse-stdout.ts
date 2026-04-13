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
      return [{ kind: "assistant", ts, text: stripped }];
    }
    if (line.trim()) return [{ kind: "stdout", ts, text: line }];
    return [];
  }

  switch (parsed.type) {
    case "init":
      return [{ kind: "init", ts, model: String(parsed.model ?? "unknown"), sessionId: String(parsed.agentName ?? "") }];
    case "tool_call":
      return [{ kind: "tool_call", ts, name: String(parsed.name ?? "unknown"), input: parsed.input ?? {}, toolUseId: parsed.toolUseId as string | undefined }];
    case "tool_result":
      return [{ kind: "tool_result", ts, toolUseId: String(parsed.toolUseId ?? ""), content: String(parsed.preview ?? parsed.result ?? JSON.stringify(parsed)), isError: parsed.ok === false }];
    case "thinking":
      return [{ kind: "thinking", ts, text: String(parsed.text ?? "") }];
    case "message":
    case "assistant":
      return [{ kind: "assistant", ts, text: String(parsed.text ?? "") }];
    case "result":
      return [{ kind: "result", ts, text: String(parsed.summary ?? "Run complete"), inputTokens: Number(parsed.inputTokens ?? 0), outputTokens: Number(parsed.outputTokens ?? 0), cachedTokens: Number(parsed.cachedTokens ?? 0), costUsd: Number(parsed.costUsd ?? 0), subtype: "nova_agent", isError: false, errors: [] }];
    case "error":
      return [{ kind: "stderr", ts, text: String(parsed.text ?? parsed.error ?? "") }];
    default:
      return [{ kind: "stdout", ts, text: line }];
  }
}
