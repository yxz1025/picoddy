import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { Type } from 'typebox';
import { sessionContext } from '../../infra/context.ts';

const installEnvironment = new AsyncLocalStorage<Record<string, string>>();
const NETWORK_FAILURE = /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ENETUNREACH)\b|socket hang up|network request .*failed/i;
const NPM_FAILURE = /(?:^|\n)npm (?:ERR!|error)\b/i;
const INSTALL_TIMEOUT = /command timed out|命令执行超时/i;
const DEFAULT_ENV = {
  npm_config_fetch_retries: '1', npm_config_fetch_timeout: '30000',
  npm_config_fetch_retry_mintimeout: '1000', npm_config_fetch_retry_maxtimeout: '5000',
};

export function dependencyInstallEnvironment(): Record<string, string> {
  return installEnvironment.getStore() ?? {};
}

/** Deliberately accept only direct installs and a literal `cd ... &&` prefix.
 * Complex shell programs remain untouched; this is not a security parser. */
const INSTALL_PREFIX = /^(?:cd\s+(?:\/d\s+)?(?:"[^"\n]+"|'[^'\n]+'|[^\s;&|]+)\s*&&\s*)?npm(?:\.cmd)?\s+(?:install|i|ci)(?=\s|$)/i;
export function identifyDependencyInstall(command: string, cwd = process.cwd()): string | undefined {
  command = command.trim().replace(/\s+2>&1$/, '');
  if (/[\n\r`$(){}<>]/.test(command)) return undefined;
  const match = command.match(INSTALL_PREFIX);
  if (!match) return undefined;
  if (/[;&|]/.test(command.slice(match[0].length))) return undefined;
  // Different flags are not evidence that a network failure has been resolved.
  const directory = command.match(/^\s*cd\s+(?:\/d\s+)?(.+?)\s*&&/i)?.[1] ?? '.';
  const unquote = (value: string) => value.replace(/^(["'])(.*)\1$/, '$2');
  const prefix = command.slice(match[0].length).match(/(?:^|\s)--prefix(?:=|\s+)("[^"]+"|'[^']+'|[^\s]+)/)?.[1];
  return createHash('sha256').update(resolve(cwd, unquote(directory), prefix ? unquote(prefix) : '.')).digest('hex');
}

export function withDependencyInstallPolicy<T extends AgentTool<any, any>>(tool: T, cwd: string): T {
  let turn = '';
  const failures = new Set<string>();
  return {
    ...tool,
    description: `${tool.description}\n依赖安装先检查是否必要。直接 npm install/ci 默认限时 120 秒，网络失败不要原样重试或提高 fetch 重试次数。避免将安装通过管道传给 tail，否则丢失退出码。只有用户明确要求长安装时才提高 timeout；网络条件确已恢复时用 installRetryReason 说明证据。`,
    parameters: Type.Object({
      ...tool.parameters.properties,
      installRetryReason: Type.Optional(Type.String({ description: '同轮安装网络失败后的重试依据，如 registry 已修复且探测成功；不得仅写“重试”' })),
    }),
    async execute(id: string, input: any, signal: AbortSignal | undefined, onUpdate: any) {
      const command = String(input.command ?? '');
      const install = command.trim().match(INSTALL_PREFIX);
      if (install && /[|;]|&&/.test(command.trim().slice(install[0].length))) {
        return { content: [{ type: 'text', text: '请单独执行 npm install/ci，不要接 tail、echo 或其他命令。管道会掩盖安装退出码，并让安装预算包含后续操作。终端工具会截断过长输出，无需 tail。' }], details: { dependencyInstallBlocked: true }, isError: true };
      }
      const key = identifyDependencyInstall(command, cwd);
      if (!key) return tool.execute(id, input, signal, onUpdate);
      const context = sessionContext.getStore();
      const nextTurn = `${context?.sessionId ?? ''}:${context?.turnId ?? ''}`;
      if (turn !== nextTurn) { failures.clear(); turn = nextTurn; }
      if (failures.has(key) && !(typeof input.installRetryReason === 'string' && input.installRetryReason.trim().length >= 12)) {
        return { content: [{ type: 'text', text: '本轮此目录的依赖安装已出现网络失败或超时。先诊断并验证恢复条件，再通过 installRetryReason 提供证据；不能通过增加重试次数继续等待。代码与尚未完成的验证请保留。' }], details: { dependencyInstallBlocked: true }, isError: true };
      }
      const params = { ...input, timeout: input.timeout ?? 120 };
      try {
        return await installEnvironment.run(DEFAULT_ENV, async () => {
          const result = await tool.execute(id, params, signal, onUpdate);
          const output = result.content.filter((part: any) => part.type === 'text').map((part: any) => part.text).join('\n');
          if (NETWORK_FAILURE.test(output) || INSTALL_TIMEOUT.test(output)) failures.add(key);
          return NPM_FAILURE.test(output) ? { ...result, isError: true } : result;
        });
      } catch (error) {
        if (NETWORK_FAILURE.test(String(error)) || INSTALL_TIMEOUT.test(String(error))) failures.add(key);
        throw error;
      }
    },
  } as T;
}
