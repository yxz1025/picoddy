/** Template defaults refer to the actual bundled expert packages. */
const roleExperts: Record<string, { id: string; name: string }> = {
  '产品专家': { id: 'product-management', name: '产品管理专家' },
  '架构专家': { id: 'software-architect', name: '软件架构师' },
  '开发专家': { id: 'software-architect', name: '软件架构师' },
  '测试专家': { id: 'testing-expert', name: '测试专家' },
  '交付专家': { id: 'product-management', name: '产品管理专家' },
  '研究专家': { id: 'product-management', name: '产品管理专家' },
  '方案专家': { id: 'product-management', name: '产品管理专家' },
};
export function defaultProjectExpert(role: string) {
  return roleExperts[role] ?? roleExperts['开发专家'];
}
