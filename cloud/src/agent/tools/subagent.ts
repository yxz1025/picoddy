import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Run } from '../../cloud/runs/types.ts';
import type { Database } from '../../infra/db.ts';
import type { Storage } from '../../platform/storage.ts';
import { withSandboxCreateTimeout, type CloudSandbox } from '../../platform/sandbox.ts';
import { createDelegationService } from '../../domains/delegation/node/service.ts';
import { scanWorkspace, verifyWorkspaceBytes, WORKSPACE_FILE_LIMIT } from '../../domains/workspace/node/sync.ts';
import { createAttachmentService } from '../../domains/attachment/node/service.ts';

const SUBAGENT_SANDBOX_CREATE_TIMEOUT_MS = 30_000;

export type RunChild = (child: Run, signal: AbortSignal, seed: (sandbox: CloudSandbox) => Promise<void>) => Promise<void>;
export function createSubagentTool(input: {
  database: Database; storage: Storage; sandbox: CloudSandbox; run: Run; maxBytes: number; runChild: RunChild;
  guard: () => Promise<void>;
}): AgentTool<any> {
  const {database, storage, sandbox, run, runChild, guard} = input;
  const service = createDelegationService(database, run);
  const role = Type.Union(['scout','researcher','reviewer','verifier','worker'].map(value=>Type.Literal(value)));
  const request = Type.Object({ role, task: Type.String({minLength:1,maxLength:20000}), expectedOutput:Type.Optional(Type.String({maxLength:4000})),includeAttachments:Type.Optional(Type.Boolean()) });
  return { name:'subagent',label:'子代理', executionMode:'sequential',
    description:'Delegate one scoped task or up to eight read-only tasks (four concurrent). Workers cannot run in a parallel batch. Children inherit only a subset of your tools and permissions, cannot recurse or ask questions, and use separate sandboxes seeded only from persistent /workspace/work and /workspace/output files. Input attachments are copied only when includeAttachments is true. Published child files return in output/delegated/<child-id> for review. Child work never overwrites your files.',
    parameters:Type.Object({role:Type.Optional(role), task:Type.Optional(Type.String({minLength:1,maxLength:20000})),expectedOutput:Type.Optional(Type.String({maxLength:4000})),includeAttachments:Type.Optional(Type.Boolean()), tasks:Type.Optional(Type.Array(request,{minItems:1,maxItems:8}))}),
    async execute(id,args,signal) {
      const stop = new AbortController();
      const abort = () => stop.abort(signal?.reason);
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted) abort();
      try {
        await guard(); stop.signal.throwIfAborted();
        const manifest = await scanWorkspace(sandbox,stop.signal);
        const children = await service.create(id,args);
        const results: Awaited<ReturnType<typeof service.result>>[] = new Array(children.length);
        let next=0;
        const lanes = Array.from({length:Math.min(4,children.length)},async()=>{
          while(next<children.length) {
            const index=next++, child=children[index];
            await guard(); stop.signal.throwIfAborted();
            await withSandboxCreateTimeout(SUBAGENT_SANDBOX_CREATE_TIMEOUT_MS, () =>
              runChild(child,stop.signal,async target=>{
                for(const file of manifest) {
                  await guard(); stop.signal.throwIfAborted();
                  const bytes=await sandbox.read(`/workspace/${file.path}`,WORKSPACE_FILE_LIMIT,stop.signal);
                  verifyWorkspaceBytes(file,bytes);
                  await target.write(`/workspace/${file.path}`,bytes);
                }
              })
            );
            results[index]=await service.result(child.id);
          }
        });
        // Drain every lane on failure; do not leave unobserved child work behind.
        const settled=await Promise.allSettled(lanes.map(lane=>lane.catch(error=>{stop.abort(error);throw error;})));
        const failure=settled.find(result=>result.status==='rejected');
        if(failure?.status==='rejected') throw failure.reason;
        const deliveries: Array<{childRunId:string;path:string}> = [];
        const attachments=createAttachmentService({database,storage,maxUploadBytes:input.maxBytes});
        let total=0;
        for(const child of children) {
          const files=await database.query('SELECT id,name FROM files WHERE run_id=$1 AND owner_id=$2 ORDER BY created_at,id',[child.id,run.owner_id]);
          for(const file of files.rows) {
            await guard(); stop.signal.throwIfAborted();
            const {bytes}=await attachments.download(run.owner_id,file.id);
            if((total+=bytes.byteLength)>input.maxBytes) throw new Error('DELEGATED_OUTPUT_TOO_LARGE');
            // Use generated IDs, not untrusted titles, in destination paths.
            const extension=/\.[A-Za-z0-9]{1,12}$/.exec(file.name)?.[0]??'';
            const path=`/workspace/output/delegated/${child.id}/${file.id}${extension}`;
            await sandbox.write(path,bytes); deliveries.push({childRunId:child.id,path});
          }
        }
        return {content:[{type:'text',text:JSON.stringify({results,deliveries})}],details:{results,deliveries}};
      } catch(error) {
        stop.abort(error); await service.cancelChildren(); throw error;
      } finally { signal?.removeEventListener('abort',abort); }
    },
  };
}
