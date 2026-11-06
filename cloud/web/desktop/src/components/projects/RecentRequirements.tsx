import { useEffect, useState } from 'react';
import { MoreHorizontal, Pin, X } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { CollapsibleSection, ListPagerFooter, timeAgo } from '../SidebarListParts';
import { SIDEBAR_LIST_INITIAL, sidebarListPagerState, expandSidebarVisible, collapseSidebarVisible } from '../sidebarListPaging';
import { loadHistory, openRecent, updateRecent, useProjectHistory, type RecentRequirement } from './projectHistory';
import { stages } from './projectDemo';

function RecentItem({ account, item }: { account: string; item: RecentRequirement }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const inProjects = useStore(s => s.activeCategory === 'project');
  const isCurrentRequirement = useProjectHistory(s => s.account === account && s.activeRequirementId === item.id);
  const active = inProjects && isCurrentRequirement;
  const open = () => { openRecent(account, item); useStore.getState().setCategory('project'); };
  const description = `${item.run.title}\n${item.project.name} · ${stages[item.stage]?.title || ''}\n${new Date(item.visitedAt).toLocaleString()}${item.pinned ? '\n已固定' : ''}`;
  return <div className={`sidebar-conv-item recent-requirement-item ${active ? 'active' : ''} ${menuOpen ? 'menu-open' : ''}`} tabIndex={0} role="button" aria-current={active ? "page" : undefined} aria-label={item.run.title} title={description}
    onClick={open} onMouseLeave={() => setMenuOpen(false)} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setMenuOpen(false); }}
    onKeyDown={e => { if (e.key === 'Escape') setMenuOpen(false); if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); open(); } }}>
    <div className="sidebar-conv-title">{item.run.title}</div>
    <span className="sidebar-conv-time">{timeAgo(item.visitedAt)}</span>
    <div className="sidebar-conv-actions">
      <button type="button" className="sidebar-conv-icon-btn" title="更多" aria-label={`${item.run.title}：更多操作`} aria-expanded={menuOpen} onClick={e => { e.stopPropagation(); setMenuOpen(v => !v); }}><MoreHorizontal size={14} /></button>
      {menuOpen && <div className="conv-move-menu" onClick={e => e.stopPropagation()}>
        <button type="button" className="conv-move-item" onClick={() => { updateRecent(account, item.id, { pinned: !item.pinned }); setMenuOpen(false); }}><Pin size={12} fill={item.pinned ? 'currentColor' : 'none'} />{item.pinned ? '取消固定' : '固定'}</button>
        <button type="button" className="conv-move-item" onClick={() => updateRecent(account, item.id, null)}><X size={12} />移除入口</button>
      </div>}
    </div>
  </div>;
}

export default function RecentRequirements({ account }: { account: string }) {
  const { account: owner, items, storageError } = useProjectHistory();
  const [visible, setVisible] = useState(SIDEBAR_LIST_INITIAL);
  useEffect(() => { loadHistory(account); setVisible(SIDEBAR_LIST_INITIAL); }, [account]);
  if (!account || owner !== account || !items.length) return null;
  const pager = sidebarListPagerState(items.length, visible);
  return <CollapsibleSection label="最近产研需求" count={items.length}>
    <div className="sidebar-conv-list">
      {items.slice(0, pager.shown).map(item => <RecentItem key={item.id} account={account} item={item} />)}
      <ListPagerFooter remaining={pager.remaining} showMore={pager.showMore} showCollapse={pager.showCollapse}
        onExpand={() => setVisible(current => expandSidebarVisible(current, items.length))} onCollapse={() => setVisible(collapseSidebarVisible())} />
    </div>
    {storageError && <p className="sidebar-section-empty" role="alert">本地历史保存失败，重启后可能无法恢复。</p>}
  </CollapsibleSection>;
}
