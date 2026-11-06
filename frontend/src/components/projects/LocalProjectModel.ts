import { defaultProjectExpert } from "../../../../src/domains/project/shared/experts";
import {
  localProjectTemplates,
  type LocalProject,
  type LocalProjectCreate,
  type LocalStage,
} from "../../../../src/domains/project/shared/workflow";

export type LocalProjectFilter = "all" | "active" | "review" | "archived";

export function filterLocalProjects(
  projects: readonly LocalProject[],
  filter: LocalProjectFilter,
  query: string,
): LocalProject[] {
  const needle = query.trim().toLocaleLowerCase("zh-CN");
  return projects.filter(project => {
    const current = project.stages.find(stage => stage.id === project.currentStageId);
    const matchesFilter = filter === "all"
      ? !project.archived
      : filter === "archived"
        ? project.archived
        : filter === "review"
          ? !project.archived && current?.status === "review"
          : !project.archived && current?.status !== "review" && current?.status !== "completed";
    if (!matchesFilter) return false;
    if (!needle) return true;
    return [project.name, project.description, project.instructions, current?.title, current?.expertName]
      .some(value => value?.toLocaleLowerCase("zh-CN").includes(needle));
  });
}

export function stageStartBlocker(stage: LocalStage, availableExpertIds: readonly string[]): string | null {
  if (stage.status === "completed") return "已完成阶段无需重新开始";
  if (!stage.expertId || !availableExpertIds.includes(stage.expertId)) return "请先为本阶段选择可用的专家";
  return null;
}

export function createProjectDraft(templateId: string): LocalProjectCreate {
  const template = localProjectTemplates.find(item => item.id === templateId) ?? localProjectTemplates[0];
  return {
    name: "",
    description: "",
    instructions: template.instructions,
    dirPath: "",
    templateId: template.id,
    connectors: [],
    repositories: [],
    stages: template.stages.map(stage => ({
      id: stage.id,
      title: stage.title,
      goal: stage.goal,
      expertId: defaultProjectExpert(stage.role).id,
      expertName: defaultProjectExpert(stage.role).name,
    })),
  };
}

export function projectDraftError(draft: LocalProjectCreate): string | null {
  if (!draft.name.trim()) return '请为项目起个名字';
  if (draft.name.trim().length > 40) return '项目名称请控制在 40 个字以内';
  if (!draft.description.trim()) return '请简单描述你想完成什么';
  if (!draft.stages.length) return '请至少保留一个项目阶段';
  if (draft.stages.some(stage => !stage.title.trim() || !stage.goal.trim())) return '请补全已调整阶段的名称和目标';
  return null;
}
