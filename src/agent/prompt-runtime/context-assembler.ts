import { randomUUID } from "node:crypto";

import { freezePromptSnapshot } from "./types.ts";
import type {
  PromptContextSnapshot,
  PromptDiagnostic,
} from "./types.ts";
import type { PromptSourceResult } from "./sources/base.ts";

type ContextKey =
  | "environment"
  | "workspace"
  | "settings"
  | "memory"
  | "skills"
  | "expert"
  | "capabilities"
  | "turn";

export interface SnapshotSource {
  key: ContextKey;
  id: string;
  collect(input: AssembleContextInput): Promise<PromptSourceResult<unknown>>;
}

export interface AssembleContextInput {
  sessionId: string;
  turnId: string;
  createdAt?: string;
  snapshotId?: string;
}

export class ContextAssembler {
  constructor(private readonly sources: readonly SnapshotSource[]) {}

  async assemble(input: AssembleContextInput): Promise<PromptContextSnapshot> {
    const values: Partial<Record<ContextKey, unknown>> = {};
    const sourceRevisions: PromptContextSnapshot["sourceRevisions"] = {};
    const diagnostics: PromptDiagnostic[] = [];

    for (const source of this.sources) {
      const result = await source.collect(input);
      values[source.key] = result.value;
      sourceRevisions[source.id] = result.revision;
      diagnostics.push(...result.diagnostics);
    }

    const required: Exclude<ContextKey, "expert">[] = [
      "environment",
      "workspace",
      "settings",
      "memory",
      "skills",
      "capabilities",
      "turn",
    ];
    for (const key of required) {
      if (values[key] === undefined) {
        throw new TypeError(`Context source ${key} was not collected`);
      }
    }

    return freezePromptSnapshot({
      schemaVersion: 2,
      snapshotId: input.snapshotId ?? randomUUID(),
      sessionId: input.sessionId,
      turnId: input.turnId,
      createdAt: input.createdAt ?? new Date().toISOString(),
      environment: values.environment as PromptContextSnapshot["environment"],
      workspace: values.workspace as PromptContextSnapshot["workspace"],
      settings: values.settings as PromptContextSnapshot["settings"],
      memory: values.memory as PromptContextSnapshot["memory"],
      skills: values.skills as PromptContextSnapshot["skills"],
      ...(values.expert === undefined
        ? {}
        : { expert: values.expert as PromptContextSnapshot["expert"] }),
      capabilities: values.capabilities as PromptContextSnapshot["capabilities"],
      turn: values.turn as PromptContextSnapshot["turn"],
      sourceRevisions,
      diagnostics,
    });
  }
}
