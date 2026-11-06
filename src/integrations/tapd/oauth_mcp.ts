export interface TapdMcpCredential {
  accessToken: string; grantId: string; revision: number; workspaceId: string; expiresAt: number;
}
interface Client {
  listTools(): Promise<any>;
  callTool(input: { name: string; arguments: Record<string, unknown> }): Promise<any>;
  close(): Promise<void>;
}
interface Options {
  resolveCredential(params?: Record<string, unknown>): Promise<TapdMcpCredential>;
  connect(credential: TapdMcpCredential): Promise<Client>;
  now?: () => number;
}

/** Serialize calls so a credential switch cannot move another call to a different account. */
export function createTapdOAuthSession(options: Options) {
  const now = options.now ?? Date.now;
  let current: { credential: TapdMcpCredential; client: Client } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let epoch = 0;
  let closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  async function invalidate() {
    epoch++;
    clearTimeout(timer); timer = undefined;
    const previous = current; current = undefined;
    await previous?.client.close().catch(() => {});
  }
  async function withClient<T>(params: Record<string, unknown> | undefined, action: (client: Client) => Promise<T>) {
    const operation = queue.then(async () => {
      if (closed) throw new Error('TAPD_MCP_CLOSED');
      const started = epoch;
      try {
        const credential = await options.resolveCredential(params);
        if (closed || started !== epoch) throw new Error('TAPD_MCP_AUTH_CHANGED');
        if (!Number.isFinite(credential.expiresAt) || credential.expiresAt <= now() + 60_000) throw new Error('TAPD_AUTH_EXPIRED');
        const previous = current?.credential;
        if (!previous || previous.accessToken !== credential.accessToken || previous.grantId !== credential.grantId || previous.revision !== credential.revision || previous.workspaceId !== credential.workspaceId) {
          const old = current; current = undefined; clearTimeout(timer);
          await old?.client.close().catch(() => {});
          const client = await options.connect(credential);
          if (closed || started !== epoch || credential.expiresAt <= now() + 60_000) {
            await client.close().catch(() => {});
            throw new Error('TAPD_MCP_AUTH_CHANGED');
          }
          current = { credential, client };
          timer = setTimeout(() => { void invalidate(); }, credential.expiresAt - now() - 60_000);
          timer.unref?.();
        }
        const result = await action(current!.client);
        if (closed || started !== epoch) throw new Error('TAPD_MCP_AUTH_CHANGED');
        return result;
      } catch (error) {
        await invalidate();
        // Never replay a call: a failed write may already have reached TAPD.
        throw error;
      }
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return {
    listTools: () => withClient(undefined, client => client.listTools()),
    callTool: (name: string, params: Record<string, unknown>) => withClient(params, client => client.callTool({ name, arguments: params })),
    invalidate,
    isConnected: () => !!current && !closed,
    async close() { closed = true; await invalidate(); },
  };
}
