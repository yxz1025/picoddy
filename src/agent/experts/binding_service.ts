import { isValidExpertId, type ExpertRegistry } from "./registry.ts";
import { logExpertEvent, type ExpertEventField } from "./observability.ts";
import type { ResolvedExpertPrompt } from "./prompt_resolver.ts";
import type { ExpertBinding, ExpertManifest } from "./types.ts";

export type ExpertBindingErrorCode =
  | "INVALID_EXPERT_ID"
  | "CONVERSATION_NOT_FOUND"
  | "EXPERT_NOT_FOUND"
  | "EXPERT_SWITCH_BUSY"
  | "EXPERT_UNAVAILABLE"
  | "EXPERT_BINDING_FAILED";

export class ExpertBindingError extends Error {
  readonly name = "ExpertBindingError";

  constructor(
    readonly code: ExpertBindingErrorCode,
    readonly status: 400 | 404 | 409 | 422 | 500,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface ExpertBindingConversation {
  id: string;
  status: string;
}

export interface ExpertBindingStore {
  getConversation(conversationId: string): ExpertBindingConversation | null;
  getBinding(conversationId: string): ExpertBinding | null;
  setBinding(conversationId: string, binding: ExpertBinding | null): void;
}

export interface ExpertBindingProvider {
  reloadProfile(sessionId: string): Promise<void>;
}

export type ExpertPromptResolver = (
  manifest: ExpertManifest,
) => Promise<ResolvedExpertPrompt | null>;

export interface ExpertBindingServiceDependencies {
  registry: Pick<ExpertRegistry, "get">;
  resolver: ExpertPromptResolver;
  store: ExpertBindingStore;
  provider: ExpertBindingProvider;
  logger?: (
    event: string,
    fields: Record<string, ExpertEventField>,
  ) => void;
}

const BUSY_STATUSES = new Set(["running", "pending", "initializing"]);

function errorCodeOf(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Coordinates the durable conversation binding and the provider's in-memory
 * profile.  This class deliberately accepts narrow interfaces so it can be
 * exercised without opening the application's singleton database.
 */
export function createExpertBindingService(
  dependencies: ExpertBindingServiceDependencies,
) {
  const logger = dependencies.logger ?? ((event, fields) => logExpertEvent(event, fields));
  const operationLocks = new Map<string, Promise<void>>();

  async function withConversationLock<T>(
    conversationId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = operationLocks.get(conversationId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    operationLocks.set(conversationId, queued);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (operationLocks.get(conversationId) === queued) {
        operationLocks.delete(conversationId);
      }
    }
  }

  function emitChanged(fields: Record<string, ExpertEventField>): void {
    // The structured logger allow-lists fields and never receives a prompt
    // body.  Callers may inject a richer event sink in tests/telemetry.
    // Observability is best-effort: a broken sink must not turn a committed
    // binding into a failed request (or trigger a second, misleading
    // compensation path).
    try {
      logger("expert.binding.changed", fields);
    } catch {
      // Deliberately do not log the sink error here; a custom sink may include
      // sensitive context in its exception message.
    }
  }

  function conversationOrThrow(conversationId: string): ExpertBindingConversation {
    const conversation = dependencies.store.getConversation(conversationId);
    if (!conversation) {
      throw new ExpertBindingError(
        "CONVERSATION_NOT_FOUND",
        404,
        `Conversation not found: ${conversationId}`,
      );
    }
    if (BUSY_STATUSES.has(conversation.status)) {
      throw new ExpertBindingError(
        "EXPERT_SWITCH_BUSY",
        409,
        `Cannot switch expert while conversation is ${conversation.status}`,
      );
    }
    return conversation;
  }

  function findManifest(expertId: string): ExpertManifest {
    if (!isValidExpertId(expertId)) {
      throw new ExpertBindingError(
        "INVALID_EXPERT_ID",
        400,
        `Invalid expert id: ${expertId}`,
      );
    }
    const manifest = dependencies.registry.get(expertId);
    if (!manifest) {
      throw new ExpertBindingError(
        "EXPERT_NOT_FOUND",
        404,
        `Expert not found: ${expertId}`,
      );
    }
    if (!manifest.available) {
      throw new ExpertBindingError(
        "EXPERT_UNAVAILABLE",
        422,
        `Expert unavailable: ${expertId}`,
      );
    }
    return manifest;
  }

  async function resolveManifest(manifest: ExpertManifest): Promise<ResolvedExpertPrompt> {
    try {
      const resolved = await dependencies.resolver(manifest);
      if (!resolved || typeof resolved.text !== "string" || !resolved.text.trim()) {
        throw new Error("resolved expert prompt is empty");
      }
      return resolved;
    } catch (error) {
      throw new ExpertBindingError(
        "EXPERT_UNAVAILABLE",
        422,
        `Expert prompt unavailable: ${manifest.id}`,
        { cause: error },
      );
    }
  }

  function mapReloadError(error: unknown): ExpertBindingError {
    if (errorCodeOf(error) === "EXPERT_SWITCH_BUSY") {
      return new ExpertBindingError(
        "EXPERT_SWITCH_BUSY",
        409,
        asMessage(error),
        { cause: error },
      );
    }
    return new ExpertBindingError(
      "EXPERT_BINDING_FAILED",
      500,
      `Failed to reload expert profile: ${asMessage(error)}`,
      { cause: error },
    );
  }

  async function saveAndReload(
    conversationId: string,
    oldBinding: ExpertBinding | null,
    nextBinding: ExpertBinding | null,
  ): Promise<void> {
    dependencies.store.setBinding(conversationId, nextBinding);
    try {
      await dependencies.provider.reloadProfile(conversationId);
    } catch (error) {
      try {
        dependencies.store.setBinding(conversationId, oldBinding);
      } catch (compensationError) {
        throw new ExpertBindingError(
          "EXPERT_BINDING_FAILED",
          500,
          `Failed to restore expert binding: ${asMessage(compensationError)}`,
          { cause: error },
        );
      }
      throw mapReloadError(error);
    }
  }

  async function assignExpertUnlocked(
    conversationId: string,
    expertId: string,
  ): Promise<ExpertBinding> {
    let oldBinding: ExpertBinding | null | undefined;
    let nextBinding: ExpertBinding | null = null;
    try {
      const conversation = conversationOrThrow(conversationId);
      const manifest = findManifest(expertId);
      const resolved = await resolveManifest(manifest);
      const revision = typeof resolved.revision === "string"
        ? resolved.revision.trim()
        : "";
      if (!revision) {
        throw new ExpertBindingError(
          "EXPERT_UNAVAILABLE",
          422,
          `Expert prompt has no revision: ${manifest.id}`,
        );
      }
      oldBinding = dependencies.store.getBinding(conversationId);
      nextBinding = {
        expertId: manifest.id,
        revision,
        catalogSource: manifest.catalogSource,
      };
      await saveAndReload(conversation.id, oldBinding, nextBinding);
      emitChanged({
        conversationId,
        oldExpertId: oldBinding?.expertId,
        newExpertId: nextBinding.expertId,
        revision: nextBinding.revision,
        catalogSource: nextBinding.catalogSource,
        result: "success",
      });
      return nextBinding;
    } catch (error) {
      const typed = error instanceof ExpertBindingError
        ? error
        : new ExpertBindingError("EXPERT_BINDING_FAILED", 500, asMessage(error), { cause: error });
      emitChanged({
        conversationId,
        oldExpertId: oldBinding?.expertId,
        newExpertId: nextBinding?.expertId ?? expertId,
        revision: nextBinding?.revision,
        catalogSource: nextBinding?.catalogSource,
        result: "error",
        errorCode: typed.code,
      });
      throw typed;
    }
  }

  async function assignExpert(
    conversationId: string,
    expertId: string,
  ): Promise<ExpertBinding> {
    return withConversationLock(conversationId, () => assignExpertUnlocked(conversationId, expertId));
  }

  async function clearExpertUnlocked(conversationId: string): Promise<void> {
    let oldBinding: ExpertBinding | null | undefined;
    try {
      const conversation = conversationOrThrow(conversationId);
      oldBinding = dependencies.store.getBinding(conversationId);
      await saveAndReload(conversation.id, oldBinding, null);
      emitChanged({
        conversationId,
        oldExpertId: oldBinding?.expertId,
        newExpertId: null,
        revision: oldBinding?.revision,
        catalogSource: oldBinding?.catalogSource,
        result: "success",
      });
    } catch (error) {
      const typed = error instanceof ExpertBindingError
        ? error
        : new ExpertBindingError("EXPERT_BINDING_FAILED", 500, asMessage(error), { cause: error });
      emitChanged({
        conversationId,
        oldExpertId: oldBinding?.expertId,
        newExpertId: null,
        revision: oldBinding?.revision,
        catalogSource: oldBinding?.catalogSource,
        result: "error",
        errorCode: typed.code,
      });
      throw typed;
    }
  }

  async function clearExpert(conversationId: string): Promise<void> {
    return withConversationLock(conversationId, () => clearExpertUnlocked(conversationId));
  }

  return {
    assignExpert,
    clearExpert,
    getBinding(conversationId: string): ExpertBinding | null {
      if (!dependencies.store.getConversation(conversationId)) {
        throw new ExpertBindingError(
          "CONVERSATION_NOT_FOUND",
          404,
          `Conversation not found: ${conversationId}`,
        );
      }
      return dependencies.store.getBinding(conversationId);
    },
  };
}

export type ExpertBindingService = ReturnType<typeof createExpertBindingService>;
