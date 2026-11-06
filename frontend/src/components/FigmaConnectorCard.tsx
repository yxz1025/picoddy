import { useState } from 'react';
import { PanelsTopLeft } from 'lucide-react';
import { apiPost } from '../api/client';
import { useSkillStore } from '../store/useSkillStore';
import './TapdConnectorCard.css';
import ConnectorCard from './ConnectorCard';

export default function FigmaConnectorCard({ query }: { query: string }) {
  const config = useSkillStore(s => s.mcpConfig);
  const connections = useSkillStore(s => s.mcpConnected);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const name = 'figma-desktop';
  const server = config?.mcpServers[name];
  const expectedUrl = 'http://127.0.0.1:3845/mcp';
  const matches = !!server && server.url === expectedUrl && !server.command && !server.managedBy;
  const enabled = matches && !server?.disabled && server?.enabled !== false;
  const connected = connections.find(c => c.name === name);
  async function connect() {
    setBusy(true); setError(''); setNotice('');
    try { if (!server) { await apiPost('/api/mcp/presets/figma', { mode: 'desktop' }); await useSkillStore.getState().loadMcp(); } const result = await useSkillStore.getState().connectMcp(name); setNotice(`连接成功，可用工具 ${result.toolCount} 个。`); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  if (!'figma desktop 设计 原型 交互 组件 桌面'.includes(query.trim().toLowerCase())) return null;
  return <ConnectorCard name="Figma" icon={<PanelsTopLeft size={25} />} description="读取设计稿与组件，关联代码仓库实现可交互页面。通过本机 Figma 桌面 MCP 获取所选图层、设计上下文和组件信息，在需求关联分支完成页面与交互实现。" status={error ? '连接失败，点击查看详情' : connected ? '桌面已连接，可在会话中使用' : server ? '已配置，等待桌面连接' : '桌面连接 · 未添加'} actionLabel={connected ? '检查连接' : '连接'} busy={busy} disabled={!config || (!!server && !enabled)} onAction={() => void connect()} examples={['根据 Figma 当前选中的图层实现页面', '结合需求资产，为这个页面补充空态和重试交互']}>
    <p>在 Figma 中打开设计文件，进入 Dev Mode 并启用桌面 MCP，保持 Figma 运行。</p>
    <p>本机地址：<code>http://127.0.0.1:3845/mcp</code>。选中图层后，可在设计评审会话中读取。</p>
    {server && !matches && <p role="alert">存在同名自定义配置，已保留。请在 MCP 配置中检查地址或重命名。</p>}
    {matches && !enabled && <p>此连接器已停用，请在 MCP 配置中启用。</p>}
    {notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}
    <p><a href="https://developers.figma.com/docs/figma-mcp-server/local-server-installation/" target="_blank" rel="noreferrer">查看官方桌面连接说明</a></p>
  </ConnectorCard>;
}
