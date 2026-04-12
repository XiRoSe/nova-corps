import type {
  ServerAdapterModule,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterModel,
} from "../types.js";
import { execute } from "./execute.js";

export const type = "nova_agent";
export const label = "Nova Agent (Direct API)";
export { execute };

export const models: AdapterModel[] = [
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
];

export async function testEnvironment(
  _ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  return {
    adapterType: type,
    status: apiKey ? "pass" : "fail",
    checks: [
      {
        code: apiKey ? "api_key_present" : "api_key_missing",
        level: apiKey ? "info" : "error",
        message: apiKey
          ? "ANTHROPIC_API_KEY is set"
          : "ANTHROPIC_API_KEY environment variable is not set",
      },
    ],
    testedAt: new Date().toISOString(),
  };
}

export const novaAgentAdapter: ServerAdapterModule = {
  type,
  execute,
  testEnvironment,
  models,
  supportsLocalAgentJwt: true,
  agentConfigurationDoc: `# Nova Agent (Direct API) configuration

Adapter: nova_agent

This adapter calls the Anthropic Claude API directly using the @anthropic-ai/sdk package.
No local CLI installation is required — only an ANTHROPIC_API_KEY environment variable.

Config fields:
- model (string, optional): Claude model to use (default: claude-sonnet-4-5-20250929)

Environment variables:
- ANTHROPIC_API_KEY (required): Your Anthropic API key
`,
};
