import type { createMcpConfigStore } from './mcp_config.ts';

export async function addFigmaMcp(store: ReturnType<typeof createMcpConfigStore>, mode: unknown) {
  if (mode !== 'desktop') throw new Error('当前 Figma 连接器仅提供桌面连接');
  const name = 'figma-desktop';
  const url = 'http://127.0.0.1:3845/mcp';
  await store.update(config => {
    const existing = config.mcpServers[name];
    if (existing) {
      if (existing.url !== url || existing.command || existing.managedBy) throw new Error(`已有同名连接器 ${name}，请在 MCP 配置中检查；不会覆盖原配置`);
      return;
    }
    config.mcpServers[name] = { type: 'http', url, displayName: 'Figma Desktop',
      description: '读取设计稿、组件与交互上下文', exposure: 'direct', enabled: true };
  });
  return { name };
}
