export type TapdRecoveryStatus = {
  attempt?: { state: string };
  grants: Array<{ authorization: string }>;
};
export function tapdRecovery(status: TapdRecoveryStatus) {
  const path = '请前往「专家·技能·连接器 → 连接器 → TAPD」';
  if (status.attempt?.state === 'awaiting_confirmation') return {
    title: 'TAPD 授权待确认', message: `${path}，点击「确认连接」，完成后返回刷新需求。`,
  };
  if (status.attempt && ['creating', 'waiting_browser', 'exchanging'].includes(status.attempt.state)) return {
    title: 'TAPD 授权尚未完成', message: `${path}，完成浏览器授权并确认连接后，再返回刷新需求。`,
  };
  if (status.grants.length && status.grants.every(g => g.authorization !== 'authorized')) return {
    title: 'TAPD 授权已过期', message: `${path}，点击「重新授权」，完成后点击「确认连接」。`,
  };
  if (!status.grants.length) return {
    title: '请先连接 TAPD', message: `${path}，授权并确认连接后，即可查看需求。`,
  };
  return null;
}
