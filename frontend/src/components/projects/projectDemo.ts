export interface Stage {
  title: string;
  role: string;
  description: string;
  output: string;
  action: string;
  checks: string[];
}

// Persisted IDs stay stable; 4 and 5 are no longer active stages.
export const activeStageIds = [0, 1, 2, 3, 6, 7, 8, 9];
export const stageRequestKey = (id: number) => `stage:${id === 3 ? '架构设计' : stages[id].title}`;
export const nextStage = (id: number) => activeStageIds[activeStageIds.indexOf(id) + 1] ?? 10;
export const previousStage = (id: number) => activeStageIds[activeStageIds.indexOf(id) - 1];
export const stages: Stage[] = Object.assign(new Array<Stage>(10), {
  0:{ title: "设计分析", role: "产品专家", description: "对已确认进入产研的需求细化设计范围、使用场景和实现约束。", output: "需求澄清记录.md", action: "保存分析，进入 PRD", checks: ["需求已确认进入产研", "记录范围和技术约束", "确认验收方式"] },
  1:{ title: "产品 PRD", role: "产品专家", description: "将确认的需求整理为功能说明和可验证的验收标准。", output: "产品需求文档.md", action: "模拟生成 PRD", checks: ["功能与需求逐项对应", "定义异常与边界行为", "验收标准具有明确编号"] },
  2:{ title: "设计评审", role: "人工审核", description: "审核 PRD 与设计产物，通过后冻结设计基线；不替代 TAPD 需求状态流转。", output: "需求基线.md", action: "通过并冻结基线", checks: ["产品设计符合已确认需求", "验收标准可执行", "本次批准绑定当前文档版本"] },
  3:{ title: "研发设计", role: "软件架构师", description: "关联仓库代码与需求基线，明确现有实现、模块边界和详细研发方案。", output: "技术设计与任务拆解.md", action: "模拟完成研发设计", checks: ["已保存仓库、代码引用与分析范围", "详细设计需基于真实源码分析（当前仅演示）", "明确接口、数据变更与任务依赖"] },


  6:{ title: "代码审核", role: "人工审核", description: "检查变更和验证证据，批准的代码版本将交给测试专家。", output: "代码审核记录.md", action: "审核通过，进入测试", checks: ["代码变更符合需求基线", "基础检查记录已附齐", "批准绑定当前代码版本"] },
  7:{ title: "自动测试", role: "测试专家", description: "基于前序产品与研发资产生成模板测试用例，并上传至当前需求附件。", output: "测试用例说明.md", action: "模拟生成用例说明", checks: ["验收标准均有用例或明确缺口", "用例符合 TAPD 导入模板", "记录资产版本与待确认问题"] },
  8:{ title: "构建验证", role: "构建执行器", description: "将通过测试的代码构建为交付包，并进行启动验证。", output: "构建与验证报告.md", action: "模拟构建成功", checks: ["构建与测试使用同一代码版本", "记录构建产物与来源", "启动冒烟验证通过"] },
  9:{ title: "交付归档", role: "交付负责人", description: "汇总基线、代码、测试与构建记录，形成完整交付清单。", output: "交付清单.md", action: "确认归档，完成流程", checks: ["完整保留需求与设计基线", "审核、测试、产物版本一致", "交付清单可追溯"] },
});

export interface DemoEvent { id: string; time: string; text: string }
export interface RepositoryContext {
  repository: string;
  localPath: string;
  ref: string;
  scope: string;
  notes: string;
}
export interface DemoRun {
  activeStage?: number;
  id: string;
  title: string;
  description: string;
  clarification: string;
  intakeStatus?: "pending" | "confirmed";
  tapdId?: string;
  tapdWorkspaceId?: string;
  tapdTasks?: Array<{ id: string; name: string; status: string; owner: string; description: string }>;
  tapdAttachments?: Array<{ id: string; filename: string; url: string; size: number; contentType: string; createdAt: string }>;
  tapdStatus?: string;
  tapdSyncedAt?: number;
  repositoryContext?: RepositoryContext;
  stage: number;
  revision: number;
  paused: boolean;
  events: DemoEvent[];
  outputs: {
    stage: number;
    revision: number;
    content: string;
    createdAt: string;
    tapdSyncStatus?: "local-only" | "pending" | "synced" | "failed";
    tapdAttachmentId?: string;
    tapdSyncError?: string;
  }[];
}
export interface DemoProject {
  id: string;
  name: string;
  description: string;
  repo: string;
  tapd: string;
  tapdAttachmentField?: string;
  runs: DemoRun[];
}
export const demoKey = "picoddy-project-workflow-demo-v1";
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toLocaleString("zh-CN", { hour12: false });
export const event = (text: string): DemoEvent => ({ id: uid(), text, time: now() });
export const version = (run: DemoRun) => `demo-r${run.revision}`;

export function outputFor(run: DemoRun, index: number, project: DemoProject): string {
  const common = `# ${stages[index].output.replace(".md", "")}\n\n> 前端演示产物，未调用专家、TAPD、Git 或测试服务。\n\n需求：${run.title}\n项目：${project.name}\n演示版本：${version(run)}\n\n`;
  const body = [
    `## 业务原话\n${run.description}\n\n## 已确认的范围\n${run.clarification || "待补充"}`,
    `## 目标\n${run.description}\n\n## 范围与约束\n${run.clarification}\n\n## 验收标准（示例）\n- AC-01：主流程可以完成，结果在刷新后保持一致。\n- AC-02：异常输入得到明确提示，不产生错误数据。\n- AC-03：无权限操作被阻止，原有业务不受影响。\n\n实际接入后由产品专家针对业务生成验收标准。`,
    "## 基线冻结\n产品需求与验收标准已在演示中确认。\n后续设计、开发与测试引用此需求记录；本记录不是正式业务审批。",
    `## 关联代码上下文\n仓库：${run.repositoryContext?.repository || "未配置"}\n本地目录：${run.repositoryContext?.localPath || "未配置"}\n分支 / Tag / Commit：${run.repositoryContext?.ref || "未配置"}\n\n## 重点分析范围\n${run.repositoryContext?.scope || "未配置"}\n\n## 架构约束与参考\n${run.repositoryContext?.notes || "无补充"}\n\n## 源码分析状态\n未读取代码。以上为用户配置，尚未校验仓库、解析 commit 或扫描文件。\n\n## 实现策略（示例）\n沿用现有技术栈，将需求划分为数据与接口、业务交互、验证与集成三项任务。真实接入后需补充文件路径、关键符号、现有调用关系、复用点及具体修改方案。\n\n## 任务依赖\nDEV-01 数据与接口 → DEV-02 业务交互 → DEV-03 验证与集成\n\n## 变更原则\n独立工作目录开发，接口变更与兼容性一起评估。`,
    ,
    ,
    `## 审核对象\n代码版本标识：${version(run)}\n\n审核结果见流程时间线。代码返修后需重新审核。`,
    "## 模拟验收结果\nAC-01 主流程：通过\nAC-02 异常边界：通过\nAC-03 权限检查：通过\n\n测试数：3 / 3（示例）\n覆盖率：未提供\n\n没有执行真实测试命令，该报告不可作为发布证据。",
    `## 模拟构建记录\n输入代码版本标识：${version(run)}\n构建结果：演示通过\n冒烟检查：演示通过\n实际安装包：未生成\n校验和：未提供`,
    `## 交付追溯\n${run.title}\n→ 产品需求文档\n→ 技术设计与任务拆解\n→ TAPD 模拟任务\n→ ${version(run)}\n→ 代码审核记录\n→ 验收测试报告\n→ 构建与验证报告\n\n交付状态：演示流程归档。没有真实部署或发布。`,
  ];
  return common + body[index];
}

export function seedProjects(): DemoProject[] {
  const run: DemoRun = {
    id: "inventory-alert", title: "门店库存预警与补货建议", description: "门店库存低于安全阈值时提醒负责人，并生成补货建议；支持按门店筛选，保留人工确认。", clarification: "面向门店运营人员；沿用现有 React 与 Node 技术栈；本期只生成建议，不自动下单。", intakeStatus: "confirmed", tapdId: "DEMO-STORY-001", tapdStatus: "实现中", stage: 6, revision: 1, paused: false,
    events: [event("开发专家提交 demo-r1，等待人工代码审核"), event("TAPD 需求与 3 项开发任务已模拟关联"), event("需求基线已确认，研发设计已完成")], outputs: [],
  };
  const project: DemoProject = { id: "retail", name: "零售运营工作台", description: "把门店业务需求，变成可审核、可追溯的软件交付。", repo: "retail/operations-console", tapd: "零售数字化", runs: [run] };
  run.outputs = activeStageIds.filter(stage => stage < 6).map(stage => ({ stage, revision: 1, content: outputFor(run, stage, project), createdAt: now() }));
  return [project];
}

export function readProjects(): DemoProject[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(demoKey) || "null");
    if (Array.isArray(raw) && raw.length > 0 && raw.every((p) => typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.runs) && p.runs.every((r: DemoRun) => Number.isInteger(r.stage) && r.stage >= 0 && r.stage <= stages.length && Array.isArray(r.outputs) && Array.isArray(r.events)))) return (raw as DemoProject[]).map(project => ({ ...project, runs: project.runs.map(run => ({ ...run, stage: [4, 5].includes(run.stage) ? 3 : run.stage, activeStage: run.activeStage !== undefined && [4, 5].includes(run.activeStage) ? 3 : run.activeStage })) }));
  } catch { /* Missing or invalid demo storage starts a fresh example. */ }
  return seedProjects();
}
