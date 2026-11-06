import type { EnvironmentContext } from "../types.ts";
import { sourceResult, type PromptSourceResult } from "./base.ts";

export interface EnvironmentSourceDependencies {
  read(): EnvironmentContext;
}

export class EnvironmentSource {
  readonly id = "environment";
  readonly required = true;

  constructor(private readonly dependencies: EnvironmentSourceDependencies) {}

  async collect(): Promise<PromptSourceResult<EnvironmentContext>> {
    return sourceResult(this.dependencies.read());
  }
}
