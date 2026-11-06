import type { Run } from '../cloud/runs/types.ts';
import { inputPathForCloudFile } from './prompt-runtime/context-assembler.ts';
import { buildCloudPromptEnvelope } from './prompt-runtime/envelope-builder.ts';

export function inputPath(file: { id: string; name: string }): string {
  return inputPathForCloudFile(file);
}

export function buildSystemPrompt(run: Run): string {
  return buildCloudPromptEnvelope(run).systemPrompt;
}
