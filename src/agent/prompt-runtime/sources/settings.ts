import { PromptRuntimeError } from "../diagnostics.ts";
import type { PromptSettingsContext } from "../types.ts";
import { sourceResult, type PromptSourceResult } from "./base.ts";

const MAX_CUSTOM_INSTRUCTIONS = 8_000;

export interface SettingsSourceDependencies {
  getSetting(key: string): string | null | Promise<string | null>;
}

export class SettingsSource {
  readonly id = "settings";
  readonly required = false;

  constructor(private readonly dependencies: SettingsSourceDependencies) {}

  async collect(): Promise<PromptSourceResult<PromptSettingsContext>> {
    const customInstructions = await this.dependencies.getSetting(
      "agent_system_prompt",
    );
    if (
      customInstructions &&
      customInstructions.length > MAX_CUSTOM_INSTRUCTIONS
    ) {
      throw new PromptRuntimeError(
        "PROMPT_CONTEXT_LIMIT_EXCEEDED",
        400,
        `agent_system_prompt exceeds ${MAX_CUSTOM_INSTRUCTIONS} characters`,
      );
    }
    const language = await this.dependencies.getSetting("language");
    return sourceResult({
      customInstructions,
      language: language ?? undefined,
    });
  }
}
