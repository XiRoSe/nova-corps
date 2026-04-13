import type { CreateConfigValues } from "../types";

export function buildNovaAgentConfig(values: CreateConfigValues): Record<string, unknown> {
  return { model: values.model ?? "claude-sonnet-4-5-20250929" };
}
