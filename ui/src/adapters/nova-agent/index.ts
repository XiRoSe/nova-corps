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
