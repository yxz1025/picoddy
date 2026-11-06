import { PanelsTopLeft } from 'lucide-react';
import ConnectorCard from './ConnectorCard';

export default function FigmaConnectorCard({ query }: { query: string }) {
  if (!'figma desktop 设计 原型 交互 组件 桌面'.includes(query.trim().toLowerCase())) return null;
  return <ConnectorCard name="Figma" icon={<PanelsTopLeft size={25} />}
    description="通过 Figma 桌面 MCP 读取设计稿、当前选中图层和组件信息。"
    status="云端暂未对接" actionLabel="暂不可用" disabled>
    <p>Figma 桌面连接暂未对接云端，可在桌面版本中使用。</p>
  </ConnectorCard>;
}
