export interface ModelSelection {
  provider: string;
  id: string;
}

export function resolveModelSelection<T extends ModelSelection>(
  models: readonly T[],
  selected: ModelSelection,
): T | undefined {
  return models.find(
    (model) => model.provider === selected.provider && model.id === selected.id,
  ) ?? models[0];
}
