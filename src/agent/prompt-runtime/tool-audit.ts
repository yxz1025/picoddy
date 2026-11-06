import type { AgentTool } from "@earendil-works/pi-agent-core";

import { PromptRuntimeError } from "./diagnostics.ts";

export function assertToolMetadata(tools: readonly AgentTool[]): void {
  for (const tool of tools) {
    const invalid = new Set<string>();
    const rawName = (tool as { name?: unknown }).name;
    const name = typeof rawName === "string" ? rawName.trim() : "";
    const label = typeof tool.label === "string" ? tool.label.trim() : "";
    const description = typeof tool.description === "string"
      ? tool.description.trim()
      : "";
    if (!name) invalid.add("name");
    if (!label) invalid.add("label");
    if (
      !description ||
      (name && description.toLowerCase() === name.toLowerCase()) ||
      description.toLowerCase() === label.toLowerCase()
    ) {
      invalid.add("description");
    }
    if (!tool.parameters || typeof tool.parameters !== "object") {
      invalid.add("parameters");
    }
    if (invalid.size === 0) continue;
    throw new PromptRuntimeError(
      "PROMPT_TOOL_METADATA_INVALID",
      500,
      `Tool ${name || "<unnamed>"} has invalid metadata: ${[...invalid].join(", ")}`,
    );
  }
}
