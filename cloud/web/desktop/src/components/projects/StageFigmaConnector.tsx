import { useEffect, useRef, useState } from 'react';
import { apiGet, ApiError } from '../../api/client';
import { useStore } from '../../store/useStore';
import { useSkillStore, type McpConfig, type McpConnectionInfo } from '../../store/useSkillStore';
import McpOAuthControls from '../McpOAuthControls';
import { chooseFigmaConnector, figmaConnectorCandidates } from './figmaConnectorSelection';

export default function StageFigmaConnector({ conversationId, bound, disabled, showControls = true }: { conversationId: string; bound: string[]; disabled: boolean; showControls?: boolean }) {
  const [candidates, setCandidates] = useState<{ id: string; displayName: string }[]>([]);
  const [name, setName] = useState(''), [message, setMessage] = useState('正在检查 Figma 连接器…');
  const [working, setWorking] = useState(false), [needsAuth, setNeedsAuth] = useState(false);
  const [reload, setReload] = useState(0);
  const [autoConnect, setAutoConnect] = useState('');
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const selected = useStore(s => s.composerConnectors);
  const alive = useRef(false), generation = useRef(0);
  const boundKey = JSON.stringify([...new Set(bound)].sort());
  useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
  async function connect(id: string) {
    const attempt = ++generation.current;
    const current = () => alive.current && attempt === generation.current && useStore.getState().currentConvId === conversationId;
    setName(id); setWorking(true); setNeedsAuth(false); setMessage('正在连接 Figma…');
    try {
      const connection = await useSkillStore.getState().connectMcp(id);
      if (!current()) return;
      if (!connection.tools.some(t => /(^|_)get_design_context$/.test(t))) throw new Error('连接已建立，但未提供 Figma 设计读取工具，请检查连接器配置');
      if (disabledRef.current) { setAutoConnect(id); setMessage('已连接，等待当前操作结束后加入会话。'); return; }
      useStore.getState().addComposerConnector({ id, kind: 'mcp', displayName: connection.displayName || id });
      setMessage('已连接并加入本阶段会话；设计节点由本次需求指定。');
    } catch (error) {
      if (!current()) return;
      setNeedsAuth(error instanceof ApiError && error.code === 'MCP_AUTH_REQUIRED');
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { if (current()) setWorking(false); }
  }
  useEffect(() => {
    let active = true;
    setWorking(false); setAutoConnect('');
    void apiGet<{ availableConfig: McpConfig; connected: McpConnectionInfo[] }>('/api/mcp').then(data => {
      if (!active || useStore.getState().currentConvId !== conversationId) return;
      const bindings: string[] = JSON.parse(boundKey);
      const options = figmaConnectorCandidates(data.availableConfig.mcpServers, data.connected, bindings);
      setCandidates(options);
      const chosen = chooseFigmaConnector(options, bindings, useStore.getState().composerConnectors);
      if (chosen) { setName(chosen); setAutoConnect(chosen); }
      else { setName(''); setNeedsAuth(false); setMessage(bindings.length ? '已有设计绑定不可用或存在多个绑定，请选择对应连接器，或检查预览设置。' : options.length ? '发现多个 Figma 连接器，请选择本阶段使用的一个。' : '尚未配置可识别的 Figma MCP，请到连接器管理添加或启用。'); }
    }).catch(error => { if (active) setMessage(String(error)); });
    return () => { active = false; generation.current++; };
  // Connect once when entering this stage or its explicit binding changes, not on every message/poll.
  }, [conversationId, boundKey, reload]);
  useEffect(() => {
    if (!disabled && autoConnect) { setAutoConnect(''); void connect(autoConnect); }
  }, [autoConnect, disabled]);
  const included = selected.some(s => s.kind === 'mcp' && s.id === name);
  // Keep automatic connection active even when the stage hides its toolbar.
  if (!showControls) return null;
  return <div className="rq-figma-connector">
    <label>Figma<select aria-label="本阶段 Figma 连接器" value={name} disabled={disabled || working} onChange={e => { setName(e.target.value); setNeedsAuth(false); setAutoConnect(''); setMessage('点击连接并用于本阶段；预览目标已有的绑定保持不变。'); }}><option value="">选择连接器</option>{candidates.map(c => <option key={c.id} value={c.id}>{c.displayName}</option>)}</select></label>
    <button disabled={disabled || working || !name} onClick={() => void connect(name)}>{working ? '连接中…' : included ? '重新连接' : '连接并用于本阶段'}</button>
    <button disabled={disabled || working} onClick={() => setReload(v => v + 1)}>刷新</button>
    <button disabled={disabled} onClick={() => { useStore.getState().setExpertPanelTab('connector'); useStore.getState().setCategory('expert'); }}>管理连接器</button>
    <small role="status">{!included && message.startsWith('已连接并加入') ? '连接已建立，当前未选入会话；可点击重新选用。' : message}</small>
    {needsAuth && name && !disabled && <McpOAuthControls key={name} name={name} onConnected={() => void connect(name)} />}
  </div>;
}
