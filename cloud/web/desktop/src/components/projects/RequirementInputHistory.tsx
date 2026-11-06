import { useEffect, useState } from "react";
import { apiGet } from "../../api/client";
interface InputSnapshot { messageId: string; id: string; discussionOnly: boolean; repositories: Array<{ id: string; name: string; roles: string[]; path: string; snapshotPath?: string; sourceMode?: "working-tree"; commit: string; branch: string; scope: string[]; dirty: boolean }>; assets: Array<{ id: string; name: string; hash: string; path: string }> }
export function useRequirementInputHistory(conversationId: string | null, enabled: boolean, busy: boolean, messageCount: number) {
  const [snapshots, setSnapshots] = useState<InputSnapshot[]>([]);
  useEffect(() => { let active = true; setSnapshots([]); if (enabled && conversationId) void apiGet<InputSnapshot[]>(`/api/conversations/${encodeURIComponent(conversationId)}/requirement-inputs`).then(s => { if (active) setSnapshots(s); }).catch(() => {}); return () => { active = false; }; }, [conversationId, enabled, busy, messageCount]);
  return snapshots;
}
export function RequirementInputHistory({ snapshot }: { snapshot: InputSnapshot }) {
  return <details className="rq-message-inputs"><summary>本轮上下文 · {snapshot.repositories.length} 个仓库 · {snapshot.assets.length} 份资产{snapshot.discussionOnly ? " · 仅讨论方案" : ""}</summary>{snapshot.repositories.map(r => <div key={r.id}><strong>{r.roles.join("/")} · {r.name}</strong><p>{r.path}</p><p>{r.branch} · {r.commit.slice(0, 12)}{r.dirty ? " · 包含未提交修改" : ""}</p><p>范围：{r.scope.join("、")}</p>{r.snapshotPath ? <p>本轮代码副本：{r.snapshotPath}</p> : <p>源码按需读取；以上版本信息记录于发送时，工作目录可能继续变化。</p>}</div>)}{snapshot.assets.map(a => <div key={a.id}><strong>资产 · {a.name} · {a.hash.slice(0, 10)}</strong><p>{a.path}</p></div>)}</details>;
}
