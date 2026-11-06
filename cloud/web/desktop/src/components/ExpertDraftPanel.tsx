import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, PackageCheck, LoaderCircle } from 'lucide-react';
import { getExpertDraftByConversation, validateExpertDraft, publishExpertDraft, type ExpertDraft } from '../api/expertDrafts';
import { useSkillStore } from '../store/useSkillStore';
import { useStore } from '../store/useStore';
import { canPublishExpertDraft } from './expertDraftModel';
import './SkillDraftPanel.css';
import './ExpertDraftPanel.css';

/** Same review/validate/confirm interaction and styles as the desktop skill panel. */
export default function ExpertDraftPanel({conversationId,busy,messageCount}:{conversationId:string;busy:boolean;messageCount:number}) {
  const [draft,setDraft]=useState<ExpertDraft|null>(null);
  const [pending,setPending]=useState(false);
  const [notice,setNotice]=useState('');
  const skills=useSkillStore(state=>state.skills);
  const mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
  const generation=useRef(0), action=useRef(false), busyRef=useRef(busy);
  busyRef.current=busy;
  const refresh=useCallback(async()=>{
    const token=++generation.current;
    setPending(true);
    try { const value=await getExpertDraftByConversation(conversationId); if(token===generation.current){setDraft(value);setNotice('');} }
    catch(error){if(token===generation.current)setNotice(error instanceof Error?error.message:'读取专家草稿失败');}
    finally {if(token===generation.current)setPending(false);}
  },[conversationId]);
  useEffect(()=>{if(!busy&&!action.current)void refresh();},[busy,messageCount,refresh]);
  const validate=async()=>{
    if(!draft||busy||pending||action.current)return;
    action.current=true;setPending(true);
    const token=generation.current;
    try {await validateExpertDraft(draft.id);if(token===generation.current)await refresh();}
    catch(error){if(token===generation.current)setNotice(error instanceof Error?error.message:'校验失败');}
    finally{action.current=false;if(mounted.current)setPending(false);}
  };
  const publish=async()=>{
    if(!canPublishExpertDraft(draft,busy,pending)||!draft||action.current)return;
    action.current=true;setPending(true);
    const token=generation.current;
    try {
      const confirmed=await useStore.getState().requestUiConfirm({title:draft.operation==='edit'?'更新专家':'发布专家',
        message:`确认发布「${draft.profile.name}」的已校验草稿？已运行任务保持原快照，更新仅影响后续任务。`,confirmLabel:'确认发布'});
      if(!confirmed||token!==generation.current||busyRef.current)return;
      await publishExpertDraft(draft.id,draft.revision,draft.baseRevision);
      if(token!==generation.current)return;
      await refresh();
      await Promise.all([useSkillStore.getState().loadExperts(),useSkillStore.getState().loadInstalledExperts()]);
    }catch(error){if(token===generation.current)setNotice(error instanceof Error?error.message:'发布失败，请刷新草稿后重试');}
    finally{action.current=false;if(mounted.current)setPending(false);}
  };
  return <aside className="skill-draft-panel expert-draft-panel" aria-label="专家草稿">
    <div className="skill-draft-header"><div><span className="skill-draft-eyebrow">EXPERT CREATOR</span><h2>专家草稿</h2></div>
      <span className={`skill-draft-status skill-draft-status--${draft?.status==='published'?'installed':draft?.status??'empty'}`}>{draft?.status==='published'?'已发布':draft?.status==='valid'?'已通过':'编辑中'}</span></div>
    <div className="skill-draft-content">
      {notice&&<div className="skill-draft-notice" role="alert">{notice}</div>}
      {!draft?<div className="skill-draft-empty" role="status">{pending?<LoaderCircle className="skill-draft-spin" size={18}/>:null}等待生成专家草稿</div>:<>
        <div className="skill-draft-meta"><strong>{draft.profile.name||'尚未命名'}</strong><span>草稿版本 {draft.revision}</span></div>
        <section className="skill-draft-section"><h3>专家标识</h3><p>{draft.profile.icon} · 分类：{draft.profile.categoryId}</p></section>
        <div className="skill-draft-version-context"><strong>{draft.operation==='edit'?'正在修改已安装专家':'创建私有专家'}</strong><span>{draft.status==='published'?'已发布草稿只读；需要继续修改时，从我的专家重新进入编辑。':'在对话中说明需要的能力。校验并确认发布前，不改变已安装专家。'}</span></div>
        <section className="skill-draft-section skill-draft-preview"><h3>专家指令</h3><pre tabIndex={0}>{draft.profile.prompt||'等待填写专家指令'}</pre></section>
        <section className="skill-draft-section"><h3>关联技能</h3><ul>{draft.profile.skillIds.map(id=><li key={id}>{skills.find(skill=>skill.id===id)?.name??id}</li>)}</ul></section>
        {draft.profile.description&&<section className="skill-draft-section"><h3>简介</h3><p>{draft.profile.description}</p></section>}
        {!!draft.profile.tags?.length&&<section className="skill-draft-section"><h3>标签</h3><p>{draft.profile.tags.join(' · ')}</p></section>}
        {!!draft.profile.quickPrompts?.length&&<section className="skill-draft-section"><h3>快捷提问</h3><ul>{draft.profile.quickPrompts.map((text,index)=><li key={index}>{text}</li>)}</ul></section>}
        {draft.validation?.errors.map(error=><div key={error.code+error.message} className="skill-draft-notice" role="alert">{error.message}</div>)}
      </>}
    </div>
    <div className="skill-draft-actions">
      <button type="button" className="skill-draft-secondary" disabled={busy||pending} onClick={()=>void refresh()}><RefreshCw size={14}/>刷新</button>
      {draft?.status!=='published'&&<><button type="button" className="skill-draft-secondary" disabled={!draft||busy||pending} onClick={()=>void validate()}>校验</button>
        <button type="button" className="skill-draft-primary" disabled={!canPublishExpertDraft(draft,busy,pending)} onClick={()=>void publish()}><PackageCheck size={15}/>确认发布</button></>}
    </div>
  </aside>;
}
