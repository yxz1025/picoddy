import { object, string } from '../../../shared/validation.ts';
export type DelegationRole = 'scout' | 'researcher' | 'reviewer' | 'verifier' | 'worker';
export interface DelegationRequest { role: DelegationRole; task: string; expectedOutput?: string; includeAttachments: boolean }
const roles = ['scout','researcher','reviewer','verifier','worker'];
const read = new Set(['read_doc','read','grep','find','ls','rag_query','rag_status']);
const never = new Set(['subagent','goal_complete','ask_user_question']);

export function parseDelegation(input: unknown): DelegationRequest[] {
  const value = object(input);
  if (value.tasks !== undefined && ['role','task','expectedOutput','includeAttachments'].some(key => value[key] !== undefined)) throw new Error('Use single request or tasks, not both');
  const tasks = value.tasks ?? [value];
  if (!Array.isArray(tasks) || tasks.length < 1 || tasks.length > 8) throw new Error('Provide 1-8 tasks');
  const requests = tasks.map(input => {
    const task = object(input);
    if (!roles.includes(task.role as string)) throw new Error('Invalid delegation role');
    if (task.includeAttachments !== undefined && typeof task.includeAttachments !== 'boolean') throw new Error('Invalid attachment selection');
    return { role: task.role as DelegationRole, task: string(task.task, 'task', 1, 20000),
      ...(task.expectedOutput === undefined ? {} : { expectedOutput: string(task.expectedOutput, 'expectedOutput', 1, 4000) }), includeAttachments: task.includeAttachments === true };
  });
  if (requests.length > 1 && requests.some(task => task.role === 'worker')) throw new Error('Parallel workers are not allowed');
  return requests;
}
export function delegatedTools(role: string, parent: readonly string[], parallel = false): string[] {
  if (!roles.includes(role)) throw new Error('Invalid delegation role');
  return parent.filter(name => !never.has(name) && !name.includes('_draft_') &&
    (role === 'worker' || read.has(name) || (role === 'verifier' && !parallel && name === 'bash')));
}
