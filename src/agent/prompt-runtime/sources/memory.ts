import type {
  MemoryContext,
  MemoryContextEntry,
  PromptDiagnostic,
} from "../types.ts";
import {
  sourceResult,
  takeWholeEntriesWithinBudget,
  type PromptSourceResult,
} from "./base.ts";

export interface MemorySourceDependencies {
  recallWorking(sessionId: string): Promise<MemoryContextEntry[]>;
  recallUser(): Promise<MemoryContextEntry[]>;
  workingBudget?: number;
  userBudget?: number;
}

export class MemorySource {
  readonly id = "memory";
  readonly required = false;
  private readonly workingBudget: number;
  private readonly userBudget: number;

  constructor(private readonly dependencies: MemorySourceDependencies) {
    this.workingBudget = dependencies.workingBudget ?? 8_000;
    this.userBudget = dependencies.userBudget ?? 4_000;
  }

  async collect(input: {
    sessionId: string;
  }): Promise<PromptSourceResult<MemoryContext>> {
    const diagnostics: PromptDiagnostic[] = [];
    const working = await this.recallSafely(
      "working",
      () => this.dependencies.recallWorking(input.sessionId),
      diagnostics,
    );
    const user = await this.recallSafely(
      "user",
      () => this.dependencies.recallUser(),
      diagnostics,
    );

    working.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt) ||
      left.id.localeCompare(right.id)
    );
    user.sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt) ||
      left.id.localeCompare(right.id)
    );

    const seenContent = new Set<string>();
    const unique = (entries: MemoryContextEntry[]) => entries.filter((entry) => {
      if (seenContent.has(entry.content)) return false;
      seenContent.add(entry.content);
      return true;
    });
    const boundedWorking = takeWholeEntriesWithinBudget(
      unique(working),
      this.workingBudget,
      (entry) => entry.content,
    );
    const boundedUser = takeWholeEntriesWithinBudget(
      user.filter((entry, index) =>
        user.findIndex((candidate) => candidate.content === entry.content) === index &&
        !boundedWorking.included.some((workingEntry) =>
          workingEntry.content === entry.content
        )
      ),
      this.userBudget,
      (entry) => entry.content,
    );
    this.reportDropped(
      "working",
      boundedWorking.dropped,
      this.workingBudget,
      diagnostics,
    );
    this.reportDropped("user", boundedUser.dropped, this.userBudget, diagnostics);

    return sourceResult(
      { working: boundedWorking.included, user: boundedUser.included },
      diagnostics,
      boundedWorking.dropped > 0 || boundedUser.dropped > 0,
    );
  }

  private async recallSafely(
    scope: "working" | "user",
    recall: () => Promise<MemoryContextEntry[]>,
    diagnostics: PromptDiagnostic[],
  ): Promise<MemoryContextEntry[]> {
    try {
      return await recall();
    } catch {
      diagnostics.push({
        code: "PROMPT_SOURCE_OPTIONAL_FAILED",
        severity: "warning",
        sourceId: `memory.${scope}`,
        message: `${scope} memory is unavailable`,
      });
      return [];
    }
  }

  private reportDropped(
    scope: "working" | "user",
    dropped: number,
    budget: number,
    diagnostics: PromptDiagnostic[],
  ): void {
    if (dropped === 0) return;
    diagnostics.push({
      code: "PROMPT_CONTEXT_TRUNCATED",
      severity: "warning",
      sourceId: `memory.${scope}`,
      message: `${scope} memory omitted ${dropped} entries at ${budget} character budget`,
    });
  }
}
