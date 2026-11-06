export interface SkillHubVersion {
  id: number;
  version: string;
  status: string;
}

export interface SkillHubSkill {
  registrySource?: "clawhub";
  id: number;
  slug: string;
  displayName: string;
  summary: string;
  status: string;
  downloadCount: number;
  namespace: string;
  updatedAt: string;
  headlineVersion: SkillHubVersion | null;
  publishedVersion: SkillHubVersion | null;
}

export interface SkillHubExpertDetail extends SkillHubSkill {
  ownerDisplayName: string;
  subscriptionCount: number;
  avatarPath: string;
  tags: string[];
  quickPrompts: string[];
}

export interface SkillHubNamespace {
  id: number;
  slug: string;
  displayName: string;
  status: string;
  description: string | null;
  type: string;
}

export interface SkillHubCategory {
  slug: string;
  displayName: string;
}

export function skillHubIdentity(skill: SkillHubSkill): string {
  return `${skill.registrySource === "clawhub" ? "clawhub:" : ""}${skill.namespace}/${skill.slug}`;
}

export function skillHubInstallVersion(skill: SkillHubSkill): string | null {
  if (skill.publishedVersion?.status === "PUBLISHED") {
    return skill.publishedVersion.version;
  }
  return skill.headlineVersion?.status === "PUBLISHED"
    ? skill.headlineVersion.version
    : null;
}

export function skillHubCategories(
  namespaces: readonly SkillHubNamespace[],
): SkillHubCategory[] {
  const categories = new Map<string, string>();
  for (const namespace of namespaces) {
    if (namespace.status === "ACTIVE" && namespace.slug && namespace.displayName) {
      categories.set(namespace.slug, namespace.displayName);
    }
  }
  return [
    { slug: "全部", displayName: "全部" },
    ...Array.from(categories, ([slug, displayName]) => ({ slug, displayName })),
  ];
}

export function skillHubNamespaceDisplayName(
  slug: string,
  namespaces: readonly SkillHubNamespace[],
): string {
  return namespaces.find((namespace) => namespace.slug === slug)?.displayName ?? slug;
}

export function filterSkillHubSkills(
  skills: readonly SkillHubSkill[],
  category: string,
  query: string,
): SkillHubSkill[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return skills.filter((skill) => {
    if (category !== "全部" && skill.namespace !== category) return false;
    if (!normalizedQuery) return true;
    return [skill.displayName, skill.slug, skill.summary, skill.namespace].some(
      (value) => value.toLocaleLowerCase().includes(normalizedQuery),
    );
  });
}

export function skillVersionLabel(version: string | null | undefined): string {
  const value = version?.trim();
  return value ? value : "暂无版本号";
}

export function resolveLocalSkillVersion(
  skill: { name: string; displayName?: string; version?: string },
  catalog: readonly SkillHubSkill[],
  installedNames: Record<string, string>,
): string | null {
  if (skill.version?.trim()) return skill.version.trim();
  const foldedName = skill.name.toLocaleLowerCase();
  const foldedDisplay = (skill.displayName || "").toLocaleLowerCase();
  for (const hub of catalog) {
    const installedName = installedNames[skillHubIdentity(hub)]?.toLocaleLowerCase();
    const slug = hub.slug.toLocaleLowerCase();
    const displayName = hub.displayName.toLocaleLowerCase();
    if (
      installedName === foldedName ||
      slug === foldedName ||
      slug === foldedDisplay ||
      displayName === foldedName ||
      displayName === foldedDisplay
    ) {
      return skillHubInstallVersion(hub);
    }
  }
  return null;
}

export function isSkillHubInstalled(
  skill: SkillHubSkill,
  installedSkillNames: readonly string[],
  installedName?: string,
): boolean {
  const names = new Set(installedSkillNames.map((name) => name.toLocaleLowerCase()));
  return names.has((installedName ?? skill.slug).toLocaleLowerCase()) ||
    names.has(skill.slug.toLocaleLowerCase());
}
