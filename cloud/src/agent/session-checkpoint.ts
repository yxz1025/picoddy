import type { FileEntry, SessionManager } from '@earendil-works/pi-coding-agent';

/** Keep the latest compacted prefix and retained messages, not the append-only log.
 * IDs and compaction references remain stable; only the parent chain is rebased.
 * Original messages continue to exist in PostgreSQL for UI/history/audit.
 */
export function sessionCheckpoint(manager: SessionManager): FileEntry[] {
  const header = manager.getHeader();
  if (!header) throw new Error('SESSION_HEADER_MISSING');
  const branch = manager.getBranch();
  const latest = branch.findLastIndex(entry => entry.type === 'compaction');
  if (latest < 0) return [header, ...branch];
  const compaction = branch[latest];
  if (compaction.type !== 'compaction') throw new Error('INVALID_COMPACTION');
  const start = compaction.firstKeptEntryId
    ? branch.findIndex(entry => entry.id === compaction.firstKeptEntryId)
    : latest;
  if (start < 0 || start > latest) throw new Error('INVALID_COMPACTION_REFERENCE');
  const prefix = branch.slice(0, start);
  const metadata = [
    prefix.findLast(entry => entry.type === 'model_change'),
    prefix.findLast(entry => entry.type === 'thinking_level_change'),
  ].filter(entry => entry !== undefined);
  const retained = [...metadata, ...branch.slice(start)];
  return [header, ...retained.map((entry, index) => ({
    ...entry, parentId: index === 0 ? null : retained[index - 1].id,
  }))];
}
