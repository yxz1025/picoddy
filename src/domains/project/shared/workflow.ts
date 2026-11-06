export type LocalStageStatus = 'pending' | 'active' | 'review' | 'completed' | 'needs-review';
export interface LocalStage {
  id: string; title: string; goal: string; expertId: string; expertName: string;
  status: LocalStageStatus; conversationId: string | null;
  review: { summary: string; risks: string; assetIds: string[]; version: number } | null;
  approvedAt: number | null;
}
export interface LocalRepository {
  id: string; name: string; path: string; role: string; branch: string; commit: string; dirty: boolean;
}
export interface LocalAsset {
  id: string; name: string; path: string; hash: string; stageId: string; version: number;
  createdAt: number; confirmed: boolean;
}
export interface LocalProjectEvent { id: string; text: string; createdAt: number }
export interface LocalProject {
  id: string; name: string; description: string; instructions: string; dirPath: string;
  templateId: string; connectors: string[]; repositories: LocalRepository[];
  stages: LocalStage[]; assets: LocalAsset[]; events: LocalProjectEvent[];
  currentStageId: string; archived: boolean; createdAt: number; updatedAt: number; revision: number;
}
export interface LocalProjectCreate {
  name: string; description: string; instructions?: string; dirPath?: string; templateId: string;
  connectors?: string[]; repositories?: Array<{name: string; path: string; role: string}>;
  stages: Array<{id: string; title: string; goal: string; expertId: string; expertName: string}>;
}
export interface LocalProjectTemplate {
  id: string; name: string; description: string; instructions: string;
  stages: Array<{id: string; title: string; goal: string; role: string}>;
}
const developmentStages = [
  {id:'discovery',title:'需求澄清',role:'产品专家',goal:'明确目标、使用场景、范围、约束和待确认问题，保存需求澄清记录。'},
  {id:'product',title:'产品方案',role:'产品专家',goal:'编写产品方案与可验证的验收标准，保存 PRD 和关键使用流程。'},
  {id:'architecture',title:'技术设计',role:'架构专家',goal:'读取所关联仓库，提出有源码依据的技术方案、接口和任务拆解。'},
  {id:'development',title:'开发实现',role:'开发专家',goal:'按确认方案实现功能，保留代码变更并记录实际执行的检查结果。'},
  {id:'testing',title:'测试验收',role:'测试专家',goal:'依据验收标准执行测试，保存真实测试证据与未解决缺陷。'},
  {id:'delivery',title:'交付归档',role:'交付专家',goal:'整理交付清单、实际构建产物和运行说明；不自动发布或部署。'},
];
export const localProjectTemplates: LocalProjectTemplate[] = [
  {id:'development',name:'产品研发全流程',description:'从需求到代码、测试与交付',instructions:'围绕项目目标逐阶段开展工作。每阶段先确认输入，交付本地文件并说明验证证据。由用户确认后交接下一阶段。',stages:developmentStages},
  {id:'iteration',name:'已有代码迭代',description:'基于现有仓库完成一次改进',instructions:'先读取现有实现和约束，明确本次改动范围，完成实现、验证和交付。保留已有未提交修改。',stages:developmentStages.filter(s=>s.id!=='product')},
  {id:'research',name:'调研与方案',description:'梳理问题，整理依据，形成方案',instructions:'明确研究问题，记录资料依据与不确定性，形成可供用户审核的本地报告。',stages:[developmentStages[0],{id:'research',title:'调研分析',role:'研究专家',goal:'依据所提供资料开展分析，保留来源并保存研究记录。'},{id:'proposal',title:'方案交付',role:'方案专家',goal:'汇总发现、备选方案与建议，保存报告和资料清单。'}]},
  {id:'blank',name:'空白项目',description:'按自己的方式安排阶段与专家',instructions:'',stages:[{id:'work',title:'开始工作',role:'项目专家',goal:'围绕项目目标开展工作，保存成果供用户确认。'}]},
];
