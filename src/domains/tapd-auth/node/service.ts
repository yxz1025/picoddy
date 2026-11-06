/** Compatibility boundary for historical requirement records. No broker or credentials. */
interface RetiredProjectGrant { authorization: string; tapdNick?: string; grantId: string; revision: number; workspaceId: string; workspaceName: string; accountDisplayName: string }
export async function refreshProjectGrants(): Promise<RetiredProjectGrant[]> { return []; }
export async function acquireTapdCredential(_workspaceId: string, _minTtlMs = 0): Promise<{ accessToken: string }> {
  throw new Error('原企业 TAPD 授权已移除，请配置标准 TAPD MCP；历史需求记录仅供查看');
}
