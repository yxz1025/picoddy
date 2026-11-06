import { ResourceCache } from "../resource_cache.ts";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import { PromptRuntimeError } from "./diagnostics.ts";
import {
  assertPromptByteBudget,
  composePromptParts,
  PROMPT_BYTE_BUDGETS,
  utf8ByteLength,
} from "./prompt-budget.ts";
import type {
  LoadedPromptFragment,
  PromptPackDefinition,
  PromptSurface,
} from "./prompt-packs.ts";

const fragmentCache = new ResourceCache<Promise<string>>();

function invalid(message: string, cause?: unknown): PromptRuntimeError {
  return new PromptRuntimeError(
    "PROMPT_FRAGMENT_INVALID",
    500,
    message,
    cause === undefined ? undefined : { cause },
  );
}

function assertRegistry(definitions: readonly PromptPackDefinition[]): void {
  const ids = new Set<string>();
  const orders = new Set<string>();
  for (const definition of definitions) {
    if (ids.has(definition.id)) throw invalid(`Duplicate fragment id ${definition.id}`);
    ids.add(definition.id);
    const orderKey = `${definition.surface}:${definition.order}`;
    if (orders.has(orderKey)) {
      throw invalid(
        `Duplicate ${definition.surface} fragment order ${definition.order}`,
      );
    }
    orders.add(orderKey);
  }
}

function resolveRegisteredPath(root: string, fragmentPath: string): string {
  if (isAbsolute(fragmentPath)) throw invalid("Fragment path must be relative");
  const target = resolve(root, fragmentPath);
  const offset = relative(resolve(root), target);
  if (offset === ".." || offset.startsWith(`..${sep}`) || isAbsolute(offset)) {
    throw invalid("Fragment path escapes the prompt root");
  }
  return target;
}

export async function loadPromptFragments(
  root: string,
  definitions: readonly PromptPackDefinition[],
): Promise<LoadedPromptFragment[]> {
  assertRegistry(definitions);
  const loaded: LoadedPromptFragment[] = [];
  for (const definition of definitions) {
    const path = resolveRegisteredPath(root, definition.fragmentPath);
    let content: string;
    try {
      content = await fragmentCache.get([path], async () => (await readFile(path, "utf-8")).trim());
    } catch (error) {
      throw invalid(`Fragment ${definition.id} is unavailable`, error);
    }
    if (/\{\{[\s\S]*?\}\}/u.test(content)) {
      throw invalid(`Fragment ${definition.id} contains a template placeholder`);
    }
    assertPromptByteBudget(
      `fragment ${definition.id}`,
      content,
      PROMPT_BYTE_BUDGETS.fragmentBytes,
    );
    loaded.push({
      ...definition,
      content,
      contentHash: createHash("sha256").update(content).digest("hex"),
      bytes: utf8ByteLength(content),
    });
  }
  const sorted = loaded.sort((left, right) =>
    surfaceOrder(left.surface) - surfaceOrder(right.surface) ||
    left.order - right.order ||
    left.id.localeCompare(right.id)
  );
  assertPromptByteBudget(
    "core fragments",
    composePromptParts(
      sorted
        .filter((fragment) => fragment.id.startsWith("core/"))
        .map((fragment) => fragment.content),
    ),
    PROMPT_BYTE_BUDGETS.coreBytes,
  );
  assertPromptByteBudget(
    "static system fragments",
    composePromptParts(
      sorted
        .filter((fragment) => fragment.surface === "system")
        .map((fragment) => fragment.content),
    ),
    PROMPT_BYTE_BUDGETS.systemBytes,
  );
  return sorted;
}

function surfaceOrder(surface: PromptSurface): number {
  return surface === "system" ? 0 : 1;
}
