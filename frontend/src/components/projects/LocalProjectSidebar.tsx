import { useEffect, useState } from 'react';
import { apiGet } from '../../api/client';
import { useStore } from '../../store/useStore';
import { CollapsibleSection, timeAgo } from '../SidebarListParts';
import type { LocalProject } from '../../../../src/domains/project/shared/workflow';

export default function LocalProjectSidebar({ account }: { account:string }) {
  const [projects,setProjects] = useState<LocalProject[]>([]);
  const [error,setError] = useState(false);
  const activeCategory = useStore(state => state.activeCategory);
  useEffect(() => {
    let active = true;
    setProjects([]);
    const refresh = () => {
      if (!account) return;
      void apiGet<LocalProject[]>('/api/local-projects').then(items => {
        if (active) { setProjects(items.filter(item => !item.archived).slice(0,5));setError(false); }
      }).catch(() => { if (active) setError(true); });
    };
    refresh();
    window.addEventListener('local-projects-updated',refresh);
    return () => { active=false;window.removeEventListener('local-projects-updated',refresh); };
  },[account,activeCategory]);
  if (!account || (!projects.length && !error)) return null;
  return <CollapsibleSection label="项目" count={projects.length}>
    <div className="sidebar-conv-list">{projects.map(project => {
      const stage = project.stages.find(item => item.id === project.currentStageId);
      return <button type="button" key={project.id} className="sidebar-conv-item" title={`${project.name} · ${stage?.title || '已完成'}`} onClick={() => {
        try { sessionStorage.setItem(`picoddy-local-project-open:${account}`,project.id); } catch { /* Direct event still works. */ }
        useStore.getState().setCategory('project');
        window.dispatchEvent(new CustomEvent('local-project-open',{detail:{projectId:project.id}}));
      }}><span className="sidebar-conv-title">{project.name}</span><span className="sidebar-conv-time">{timeAgo(project.updatedAt)}</span></button>;
    })}</div>
    {error && <p className="sidebar-section-empty" role="status">项目暂时无法读取，可在项目页重试。</p>}
  </CollapsibleSection>;
}
