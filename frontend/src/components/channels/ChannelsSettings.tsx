import { useEffect, useRef, useState } from 'react';
import { BookOpen, Eye, EyeOff, FolderOpen, LoaderCircle, Radio, X } from 'lucide-react';
import { pickDirectory } from '../../api/client';
import { channelCall, type ChannelConnectionView, type ChannelDescriptor, type ChannelSnapshot } from './api';
import WeixinLoginPanel from './WeixinLoginPanel';
import './channels.css';

const labels = { disconnected: '未连接', connecting: '连接中', connected: '已连接', reconnecting: '重新连接中', error: '连接异常' };

export default function ChannelsSettings() {
  const [snapshot, setSnapshot] = useState<ChannelSnapshot>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<ChannelDescriptor>();
  const sequence = useRef(0);
  async function refresh() {
    const current = ++sequence.current;
    try { const next = await channelCall('snapshot'); if (sequence.current === current) { setSnapshot(next); setError(''); } }
    catch (e) { if (sequence.current === current) setError(e instanceof Error ? e.message : '无法读取通道状态'); }
  }
  useEffect(() => { void refresh(); const timer = setInterval(() => { void refresh(); }, 3_000); return () => { clearInterval(timer); sequence.current++; }; }, []);
  async function action(kind: 'disconnect' | 'reconnect', id: string) {
    setBusy(true); setError('');
    try { sequence.current++; setSnapshot(await channelCall(kind, { id })); }
    catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(false); }
  }
  return <section className="settings-tab-content channels-settings">
    <h2 className="settings-content-title">远程通道</h2>
    <p className="channels-description">连接消息通道，即可从聊天窗口向这台电脑下达任务。</p>
    {error && <div className="channels-error" role="alert">{error}</div>}
    {!snapshot && !error && <p className="channels-description"><LoaderCircle size={16} className="channels-spin" /> 正在读取通道…</p>}
    <div className="channels-grid">{snapshot?.channels.map(channel => {
      const connection = snapshot.connections.find(item => item.channelId === channel.id);
      const state = connection?.status.state ?? 'disconnected';
      const connected = ['connected', 'connecting', 'reconnecting'].includes(state);
      return <article className="channel-card" key={channel.id}>
        <div className="channel-card-top"><span className="channel-mark"><Radio size={22} /></span><h3>{channel.name}</h3>
          <button className={connected ? 'channel-button' : 'channel-button primary'} disabled={busy} onClick={() => connected && connection ? void action('disconnect', connection.id) : connection ? void action('reconnect', connection.id) : setSelected(channel)}>{connected ? '断开连接' : '连接'}</button>
        </div>
        <p>{channel.id === 'weixin' ? '使用个人微信 ClawBot 私聊，任务由当前电脑执行，结果返回微信。' : '在钉钉群中 @机器人，任务由当前电脑执行，结果回复原群。'}</p>
        <div className="channel-card-bottom"><span className={`channel-state ${state}`}><i />{labels[state]}</span>
          {connection && <button className="channel-text-button" disabled={busy} onClick={() => setSelected(channel)}>修改配置</button>}
        </div>
        {channel.id === 'weixin' && state === 'error' && <p className="channels-error">微信连接失败或授权已过期，请检查网络，或在修改配置中重新扫码。</p>}
        {connection?.lastError && <p className="channels-error">{connection.lastError}</p>}
        {connection?.knowledge && <p className="channel-knowledge-summary"><BookOpen size={14} /> 知识库问答 · {connection.knowledge.directory.split(/[\\/]/).filter(Boolean).pop()}</p>}
      </article>;
    })}</div>
    <div className="channel-device-note"><Radio size={17} /><div><strong>凭证仅保存在本机</strong><p>请为这台电脑配置独立机器人。客户端运行且电脑在线时，远程通道才可响应。未限制访问范围时，所有能向该机器人发消息的用户均可发起任务。</p></div></div>
    {selected && <ConnectDialog channel={selected} existing={snapshot?.connections.find(item => item.channelId === selected.id)} onClose={() => setSelected(undefined)} onConnected={next => { sequence.current++; setSnapshot(next); setSelected(undefined); }} />}
  </section>;
}

function ConnectDialog({ channel, existing, onClose, onConnected }: { channel: ChannelDescriptor; existing?: ChannelConnectionView; onClose(): void; onConnected(snapshot: ChannelSnapshot): void }) {
  const [credentials, setCredentials] = useState<Record<string, string>>({ ...existing?.identity });
  const [config, setConfig] = useState<Record<string, string>>(Object.fromEntries(channel.configFields.map(field => [field.key, String(existing?.config[field.key] ?? '')])));
  const isWeixin = channel.id === 'weixin';
  const [weixinPending, setWeixinPending] = useState(false);
  const [loginId, setLoginId] = useState<string>();
  const [visible, setVisible] = useState(false);
  const [knowledgeEnabled, setKnowledgeEnabled] = useState(Boolean(existing?.knowledge));
  const [directory, setDirectory] = useState(existing?.knowledge?.directory ?? '');
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); prior?.focus(); };
  }, []);
  async function connect(e: React.FormEvent) {
    e.preventDefault();
    if (isWeixin && !existing && !loginId) { setError('请先使用微信扫码确认绑定'); return; }
    if (knowledgeEnabled && !directory.trim()) { setError('请选择知识库文件夹'); return; }
    setBusy(true); setError('');
    try { onConnected(await channelCall('connect', { id: existing?.id ?? `${channel.id}-default`, channelId: channel.id, ...(isWeixin ? (loginId ? { loginId } : {}) : { ...credentials, clientSecret: credentials.clientSecret ?? '' }), config,
      ...(knowledgeEnabled ? { knowledge: { kind: 'directory', directory: directory.trim() } } : {}) })); }
    catch (e) { setError(e instanceof Error ? e.message : '连接失败'); }
    finally { setBusy(false); }
  }
  async function chooseDirectory() {
    setChoosing(true); setError('');
    try { const result = await pickDirectory(); if (!result.cancelled && result.path) setDirectory(result.path); }
    catch (e) { setError(e instanceof Error ? e.message : '无法选择目录'); }
    finally { setChoosing(false); }
  }
  return <dialog ref={dialog} className="channel-dialog" aria-labelledby="channel-dialog-title" onCancel={e => { if (busy) e.preventDefault(); else onClose(); }}>
    <form onSubmit={connect}>
      <header><h3 id="channel-dialog-title">连接{channel.name}</h3><button type="button" className="channel-icon-button" aria-label="关闭" disabled={busy} onClick={onClose}><X size={20} /></button></header>
      <div className="channel-dialog-body">
      <div className="channel-transport">{isWeixin ? <>微信官方通道 <span>ClawBot</span></> : <>WebSocket 长连接 <span>Stream</span></>}</div>
      {isWeixin && <WeixinLoginPanel bound={Boolean(existing)} disabled={busy} onAuthorized={setLoginId} onPendingChange={setWeixinPending} />}
      {!isWeixin && channel.credentialFields.map(field => <label className="channel-field" key={field.key}>{field.label}<span className="channel-input-wrap"><input autoFocus={field.key === 'clientId'} autoComplete="off" required={field.required && !(field.type === 'password' && existing && credentials.clientId === existing.identity.clientId)} disabled={busy} type={field.type === 'password' && !visible ? 'password' : 'text'} placeholder={field.type === 'password' && existing ? '留空保留当前账号的密钥' : '请输入'} value={credentials[field.key] ?? ''} onChange={e => setCredentials({ ...credentials, [field.key]: e.target.value })} />{field.type === 'password' && <button type="button" className="channel-icon-button" aria-label={visible ? '隐藏密钥' : '显示密钥'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button>}</span></label>)}
      <section className="channel-knowledge" aria-label="知识库绑定">
        <label className="channel-knowledge-toggle"><span><BookOpen size={16} />启用知识库问答</span><input type="checkbox" checked={knowledgeEnabled} disabled={busy} onChange={e => setKnowledgeEnabled(e.target.checked)} /></label>
        <p>选择本机文件夹，先参考索引与笔记，再按需调用现有技能处理任务。</p>
        {knowledgeEnabled && <><label className="channel-field">知识库文件夹<span className="channel-directory"><input aria-label="知识库文件夹" placeholder="选择知识库文件夹" value={directory} disabled={busy || choosing} onChange={e => setDirectory(e.target.value)} /><button type="button" className="channel-button" disabled={busy || choosing} onClick={() => void chooseDirectory()}><FolderOpen size={15} />{choosing ? '选择中…' : '选择目录'}</button></span></label><p className="channel-knowledge-policy">支持任意文件夹。此目录作为通道任务的知识参考，AI 可继续使用现有技能与工具；执行权限沿用普通任务规则，无需启动 Obsidian。</p></>}
      </section>
      {!isWeixin && <details className="channel-advanced"><summary>访问范围（可选）</summary>{channel.configFields.map(field => <label className="channel-field" key={field.key}>{field.label}<input disabled={busy} value={config[field.key] ?? ''} onChange={e => setConfig({ ...config, [field.key]: e.target.value })} /></label>)}<p>留空表示不限制。群 ID 和发送人 ID 使用钉钉回调中的标识。</p></details>}
      {!isWeixin && <p className="channel-form-note">在钉钉开发者后台启用机器人 Stream 模式并发布后，填写应用凭证即可连接。</p>}
      {error && <div className="channels-error" role="alert">{error}</div>}
      </div>
      <footer><button type="button" className="channel-button" disabled={busy || choosing} onClick={onClose}>取消</button><button className="channel-button primary" type="submit" disabled={busy || choosing || weixinPending || (isWeixin && !existing && !loginId)}>{busy && <LoaderCircle size={15} className="channels-spin" />}{busy ? '正在连接…' : existing || isWeixin ? '保存并连接' : '连接'}</button></footer>
    </form>
  </dialog>;
}
