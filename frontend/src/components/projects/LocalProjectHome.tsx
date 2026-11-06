import {
  Archive, ArrowRight, ArrowUpRight, CheckCircle2, ChevronRight, Compass,
  FolderKanban, FolderPlus, GitBranch, MessageSquare, MoreHorizontal, Plus, Search, Workflow,
} from "lucide-react";
import { localProjectTemplates, type LocalProject } from "../../../../src/domains/project/shared/workflow";
import type { DemoProject } from "./projectDemo";
import { filterLocalProjects, type LocalProjectFilter } from "./LocalProjectModel";

const statusText = (project: LocalProject) => {
  if (project.archived) return "已归档";
  const stage = project.stages.find(item => item.id === project.currentStageId);
  if (!stage) return "尚未开始";
  if (stage.status === "review") return "待确认";
  if (stage.status === "completed") return "已完成";
  if (stage.status === "needs-review") return "待复核";
  return stage.status === "active" ? "进行中" : "待开始";
};

const templateIcons = [Workflow, GitBranch, Compass, FolderPlus];

export default function LocalProjectHome({ projects, legacyProjects, filter, query, onFilter, onQuery, onCreate, onOpen, onSettings, onArchive }: {
  projects: LocalProject[];
  legacyProjects: DemoProject[];
  filter: LocalProjectFilter;
  query: string;
  onFilter: (filter: LocalProjectFilter) => void;
  onQuery: (query: string) => void;
  onCreate: (templateId?: string) => void;
  onOpen: (project: LocalProject) => void;
  onSettings: (project: LocalProject) => void;
  onArchive: (project: LocalProject) => void;
}) {
  const visible = filterLocalProjects(projects, filter, query);
  const hasProjects = projects.length > 0;
  const activeCount = projects.filter(project => !project.archived).length;
  const defaultStages = localProjectTemplates[0].stages;
  const resetFilters = () => { onFilter("all"); onQuery(""); };

  return <main className="lp-home lp-dashboard">
    <header className="lp-dashboard-heading">
      <div className="lp-dashboard-title">
        <span className="lp-dashboard-emblem" aria-hidden="true"><FolderKanban size={20} strokeWidth={1.7} /></span>
        <div><h1>项目工作台</h1><p>{hasProjects ? `${activeCount} 个未归档项目，接着上次的进度继续。` : "把目标、专家和成果放在一起。"}</p></div>
      </div>
      <button type="button" className="lp-button lp-button-primary" onClick={() => onCreate()}><Plus size={15} />新建项目</button>
    </header>

    <div className="lp-dashboard-layout">
      <section className="lp-project-library" aria-labelledby="my-projects-title">
        <div className="lp-library-heading"><h2 id="my-projects-title">我的项目<span>{visible.length}</span></h2><label className="lp-library-search"><Search size={14} aria-hidden="true" /><input aria-label="搜索项目" value={query} onChange={event => onQuery(event.target.value)} placeholder="搜索项目或专家" /></label></div>
        <div className="lp-library-filters" role="group" aria-label="项目筛选">
          {([['all', '全部'], ['active', '进行中'], ['review', '待确认'], ['archived', '已归档']] as const).map(([id, label]) => <button type="button" key={id} className={filter === id ? "active" : ""} aria-pressed={filter === id} onClick={() => onFilter(id)}>{label}</button>)}
        </div>

        {visible.length > 0 ? <div className="lp-project-list">{visible.map(project => {
          const stage = project.stages.find(item => item.id === project.currentStageId);
          const completed = project.stages.filter(item => item.status === 'completed').length;
          return <article className="lp-project-list-item" key={project.id}>
            <button type="button" className="lp-project-open" onClick={() => onOpen(project)}>
              <div className="lp-project-row-heading"><strong>{project.name}</strong><span className={`lp-status lp-status-${stage?.status ?? 'pending'}`}>{statusText(project)}</span></div>
              <p>{project.description || "尚未填写项目目标"}</p>
              <div className="lp-project-row-meta"><span><MessageSquare size={12} />{stage?.title ?? '未配置阶段'}</span><span>{stage?.expertName || '未选择专家'}</span><time dateTime={new Date(project.updatedAt).toISOString()}>{new Date(project.updatedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} 更新</time></div>
              <div className="lp-project-row-progress"><span role="progressbar" aria-label={`${project.name}已确认阶段`} aria-valuemin={0} aria-valuemax={project.stages.length || 1} aria-valuenow={completed}><i style={{ width: `${project.stages.length ? completed / project.stages.length * 100 : 0}%` }} /></span><small>{completed}/{project.stages.length} 阶段</small><ArrowUpRight size={14} /></div>
            </button>
            <details className="lp-card-menu"><summary aria-label={`${project.name}更多操作`}><MoreHorizontal size={16} /></summary><div><button type="button" onClick={() => onSettings(project)}>项目设置</button><button type="button" onClick={() => onArchive(project)}>{project.archived ? "恢复项目" : "归档项目"}</button></div></details>
          </article>;
        })}</div> : <div className="lp-library-empty" aria-live="polite">
          <div className="lp-empty-copy"><span className="lp-empty-symbol" aria-hidden="true">{filter === 'archived' ? <Archive size={22} strokeWidth={1.5} /> : <FolderKanban size={22} strokeWidth={1.5} />}</span><h3>{query.trim() ? '没有找到匹配项目' : filter === 'archived' ? '还没有归档项目' : hasProjects ? '这里暂时没有项目' : '第一个项目，从一个目标开始'}</h3><p>{query.trim() || hasProjects || filter === 'archived' ? '调整关键词或筛选条件，看看其他项目。' : '选择右侧模板，让合适的专家分阶段接手。成果留在本地，每一步由你确认。'}</p>
            {query.trim() || filter !== 'all' ? <button type="button" className="lp-text-action" onClick={resetFilters}>查看全部项目<ArrowRight size={13} /></button> : <button type="button" className="lp-text-action" onClick={() => onCreate('blank')}>直接描述我的目标<ArrowRight size={13} /></button>}
          </div>
          {!hasProjects && !query.trim() && filter === 'all' && <div className="lp-flow-preview"><div className="lp-flow-caption"><span>一条清晰的交付路径</span><span>随时可调整</span></div><ol aria-label="默认项目阶段预览">{defaultStages.map((stage, index) => <li key={stage.id}><span>{String(index + 1).padStart(2, '0')}</span><strong>{stage.title}</strong>{index < defaultStages.length - 1 && <ChevronRight size={12} aria-hidden="true" />}</li>)}</ol></div>}
        </div>}

        {legacyProjects.length > 0 && <details className="lp-legacy"><summary>历史记录 · {legacyProjects.length}</summary><p>旧版项目只读保留。</p>{legacyProjects.map(item => <div key={item.id}><strong>{item.name}</strong><span>{item.description}</span><small>{item.runs.length} 条历史需求</small></div>)}</details>}
      </section>

      <aside className="lp-start-panel" aria-labelledby="templates-title">
        <div className="lp-start-heading"><h2 id="templates-title">选择开始方式</h2><p>先选方向，细节稍后完善。</p></div>
        <div className="lp-start-options">{localProjectTemplates.map((template, index) => {
          const Icon = templateIcons[index] || FolderPlus;
          return <button type="button" className="lp-start-option" key={template.id} onClick={() => onCreate(template.id)}><span className="lp-template-symbol" aria-hidden="true"><Icon size={17} strokeWidth={1.7} /></span><span className="lp-template-copy"><strong>{template.name}</strong><small>{template.description}</small><span>{template.stages.length} 个阶段</span></span><ArrowUpRight size={14} aria-hidden="true" /></button>;
        })}</div>
        <div className="lp-start-note"><CheckCircle2 size={15} strokeWidth={1.7} aria-hidden="true" /><p>创建后可调整阶段与专家。<br />每个阶段确认后，再继续下一步。</p></div>
      </aside>
    </div>
  </main>;
}
