import { PromptRuntimeError } from "../diagnostics.ts";
import type {
  PromptDiagnostic,
  TurnContext,
  TurnIntent,
} from "../types.ts";
import { sourceResult, type PromptSourceResult } from "./base.ts";
import { canonicalJson } from '../manifest.ts';

const QUERY_BUDGET = 64_000;
const ATTACHMENT_BUDGET = 256_000;
const CONNECTOR_BUDGET = 32_000;
const FILE_REFERENCE_BUDGET = 64_000;

function bounded<T>(
  sourceId: string,
  values: readonly T[],
  budget: number,
  diagnostics: PromptDiagnostic[],
): T[] {
  const included: T[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const value of values) {
    const serialized = canonicalJson(value);
    if (seen.has(serialized)) continue;
    seen.add(serialized);
    const bytes = Buffer.byteLength(serialized);
    if (used + bytes > budget) continue;
    included.push(value);
    used += bytes;
  }
  const dropped = seen.size - included.length;
  if (dropped > 0) {
    diagnostics.push({
      code: "PROMPT_CONTEXT_TRUNCATED",
      severity: "warning",
      sourceId,
      message: `${sourceId} omitted ${dropped} entries at ${budget} byte budget`,
    });
  }
  return included;
}

export class TurnContextSource {
  readonly id = "turn";
  readonly required = true;

  constructor(private readonly input: { turn: TurnIntent }) {}

  async collect(): Promise<PromptSourceResult<TurnContext>> {
    const turn = this.input.turn;
    if (Buffer.byteLength(turn.rawText) > QUERY_BUDGET) {
      throw new PromptRuntimeError(
        "PROMPT_CONTEXT_LIMIT_EXCEEDED",
        400,
        `turn query exceeds ${QUERY_BUDGET} bytes`,
      );
    }
    const diagnostics: PromptDiagnostic[] = [];
    const attachments = bounded(
      "turn.attachments",
      turn.attachments,
      ATTACHMENT_BUDGET,
      diagnostics,
    );
    const connectorContext = bounded(
      "turn.connectors",
      turn.connectorContext,
      CONNECTOR_BUDGET,
      diagnostics,
    );
    const fileReferences = bounded(
      "turn.files",
      turn.fileReferences,
      FILE_REFERENCE_BUDGET,
      diagnostics,
    );
    const value: TurnContext = {
      query: turn.rawText,
      attachments,
      connectorContext,
      fileReferences,
      ...(turn.referenceExpertId
        ? { referenceExpertId: turn.referenceExpertId }
        : {}),
      ...(turn.selectedExpertSkills.length > 0
        ? { selectedExpertSkills: turn.selectedExpertSkills }
        : {}),
      ...(turn.selectedExpertSkillInputs?.length
        ? { selectedExpertSkillInputs: turn.selectedExpertSkillInputs }
        : {}),
      ...(turn.categoryRuntime
        ? { categoryRuntime: turn.categoryRuntime }
        : {}),
    };
    return sourceResult(value, diagnostics, diagnostics.length > 0);
  }
}
