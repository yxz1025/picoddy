export const MAX_EXPERT_BUSINESS_SKILLS = 8;

const RESERVED_SKILL_NAME = "expert-manager";

function canonicalName(name: string): string {
  return name.trim();
}

function comparisonKey(name: string): string {
  return canonicalName(name).toLowerCase();
}

export function isExpertSkillSelectionAtLimit(
  current: readonly string[],
): boolean {
  return current.length >= MAX_EXPERT_BUSINESS_SKILLS;
}

export function addExpertSkill(
  current: readonly string[],
  name: string,
): string[] {
  const next = [...current];
  const canonical = canonicalName(name);
  const key = comparisonKey(canonical);
  if (
    !canonical ||
    next.some((skill) => comparisonKey(skill) === key)
  ) {
    return next;
  }
  if (key === RESERVED_SKILL_NAME) {
    throw new Error("expert-manager is reserved");
  }
  if (isExpertSkillSelectionAtLimit(next)) {
    throw new Error("maximum of 8 expert business skills reached");
  }
  next.push(canonical);
  return next;
}

export function removeExpertSkill(
  current: readonly string[],
  name: string,
): string[] {
  const key = comparisonKey(name);
  if (!key) return [...current];
  return current.filter((skill) => comparisonKey(skill) !== key);
}
