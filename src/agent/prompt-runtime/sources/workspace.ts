import { PromptRuntimeError } from "../diagnostics.ts";
import type { WorkspaceContext } from "../types.ts";
import { sourceResult, type PromptSourceResult } from "./base.ts";

export interface WorkspaceSourceDependencies {
  resolve(): WorkspaceContext | Promise<WorkspaceContext>;
}

export class WorkspaceSource {
  readonly id = "workspace";
  readonly required = true;

  constructor(private readonly dependencies: WorkspaceSourceDependencies) {}

  async collect(): Promise<PromptSourceResult<WorkspaceContext>> {
    try {
      return sourceResult(await this.dependencies.resolve());
    } catch (error) {
      throw new PromptRuntimeError(
        "PROMPT_SOURCE_FAILED",
        503,
        "Workspace context is unavailable",
        { cause: error },
      );
    }
  }
}
