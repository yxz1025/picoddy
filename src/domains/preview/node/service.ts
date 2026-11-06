import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { deliveryStore } from './authoring.ts';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DatabaseSync } from 'node:sqlite';
import { createPreviewStore } from './store.ts';
import { contained, digest, bindRepository, verifyWorkspace } from './workspace.ts';
import { createRepositoryStore, stageIndex } from '../../requirement/node/repositories.ts';
import { createRequirementInputs } from '../../requirement/node/inputs.ts';
import { createRequirementAssets } from '../../requirement/node/assets.ts';
import { detectWechatCli } from '../../testing/node/wechat-cli.ts';
import { createDefaultManagedRuntimeService } from '../../../platform/runtime/index.ts';
import { activePreviewStates, type PreviewRun } from '../shared/contracts.ts';

interface LiveRun { child: ChildProcess; workspace: string; stop: () => Promise<void>; capture: () => Promise<string> }
const live = new Map<string, LiveRun>();
const locks = new Set<string>();
export async function stopAllPreviews() { await Promise.allSettled([...live.values()].map(r => r.stop())); }

export function previewService(db: DatabaseSync, root: string, account: string, space: string, assertIdentity: () => void,
  buildEnv: () => Promise<NodeJS.ProcessEnv> = () => createDefaultManagedRuntimeService().buildShellEnv()) {
  assertIdentity();
  const store = createPreviewStore(db, account, space);
  const repositories = createRepositoryStore(db, account, space);
  const deliveries = deliveryStore(db, account, space);
  function snapshot() {
    assertIdentity();
    for (const run of store.runs()) if (activePreviewStates.includes(run.state) && !live.has(run.id)) store.saveRun({ ...run, state: 'interrupted', message: '应用运行器已中断；不会自动重新执行代码' });
    return { targets: store.targets(), runs: store.runs(), deliveries: deliveries.list() };
  }
  async function start(targetId: string, scenarioId: string, deliveryId?: string) {
    const target = store.target(targetId);
    const current = store.runs().find(r => r.target.id === targetId && live.has(r.id));
    if (current) { if (current.scenarioId === scenarioId && current.deliveryId === deliveryId) return current; await live.get(current.id)!.stop(); }
    const repo = repositories.list().find(r => r.id === target.repositoryId);
    if (!repo) throw new Error('关联仓库已移除');
    await verifyWorkspace(repo, target.workspace);
    if (!target.workspace) throw new Error('请重新保存目标配置');
    if (scenarioId !== 'default' && !target.scenarios.some(s => s.id === scenarioId)) throw new Error('预览场景不存在');
    if ([...live.values()].some(r => r.workspace === target.workspace!.path)) throw new Error('此设计工作区已有预览在运行');
    const code = await verifyWorkspace(repo, target.workspace);
    const delivery = deliveryId ? deliveries.get(deliveryId) : undefined;
    if (delivery && delivery.target.id !== targetId) throw new Error("交付物与预览目标不一致");
    let changedSinceDelivery = Boolean(delivery && delivery.target.revision !== target.revision);
    if (delivery) for (const file of delivery.files) {
      try { const bytes = await readFile(await contained(target.workspace.path, file.path)); if (createHash("sha256").update(bytes).digest("hex") !== file.hash) changedSinceDelivery = true; }
      catch { changedSinceDelivery = true; }
    }
    await contained(target.workspace.path, target.projectPath);
    const inputs = await createRequirementInputs(db, root, account, space).get(target.stageKey);
    await createRequirementAssets(root, account, space).context(stageIndex(target.stageKey), inputs.selection.assets);
    const env = await buildEnv(); assertIdentity();
    const id = randomUUID(), outputDir = join(root, 'preview-runs', digest(account).slice(0, 16), digest(space).slice(0, 16), id);
    await mkdir(outputDir, { recursive: true }); assertIdentity();
    const run: PreviewRun = { id, deliveryId, changedSinceDelivery, target, scenarioId, state: 'starting', createdAt: Date.now(), updatedAt: Date.now(), ...code,
      assetRefs: inputs.selection.assets, outputDir, message: '正在启动本地预览', logs: [] };
    const requestPath = join(outputDir, 'request.json');
    await writeFile(requestPath, JSON.stringify(run), { mode: 0o600 }); assertIdentity();
    const child = spawn(process.execPath, [fileURLToPath(new URL('../../../../scripts/preview/worker.mjs', import.meta.url))], {
      cwd: target.workspace.path, env: { ...env, ELECTRON_RUN_AS_NODE: '1', PREVIEW_REQUEST_PATH: requestPath },
      windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    store.saveRun(run);
    let ended = false, stopRequested = false, resolveExit: () => void;
    const exit = new Promise<void>(resolve => { resolveExit = resolve; });
    const captures = new Map<string, { resolve: (id: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    function update(patch: Partial<PreviewRun>) { if (!ended) store.saveRun({ ...store.run(id), ...patch }); }
    function log(line: string) { if (!ended) { const r = store.run(id); store.saveRun({ ...r, logs: [...r.logs, line.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 2000)] }); } }
    const heartbeat = setInterval(() => { try { assertIdentity(); } catch { void stop(); } }, 2000); heartbeat.unref();
    const startup = setTimeout(() => { update({ state: 'failed', message: '预览启动超时，请检查构建日志与本机运行环境' }); void stop(); }, 240000); startup.unref();
    async function stop() {
      if (ended) return;
      if (!stopRequested) {
        stopRequested = true;
        if (store.run(id).state !== 'failed') update({ state: 'stopping', message: '正在关闭本次预览' });
        if (child.connected) child.send({ type: 'stop' }, () => {});
      }
      const force = setTimeout(() => {
        log('运行器未按时退出，正在结束本次进程树');
        if (process.platform === 'win32') execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }, () => {});
        else { try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); } catch {} }
      }, 15000); force.unref();
      try { await exit; } finally { clearTimeout(force); }
    }
    live.set(id, { child, workspace: target.workspace.path, stop,
      capture: () => new Promise((resolve, reject) => {
        if (ended || store.run(id).state !== 'ready') return reject(new Error('预览尚未就绪'));
        const captureId = randomUUID();
        const timer = setTimeout(() => { captures.delete(captureId); reject(new Error('截图超时')); }, 20000);
        captures.set(captureId, { resolve, reject, timer });
        child.send({ type: 'capture', id: captureId }, error => { if (error) { clearTimeout(timer); captures.delete(captureId); reject(error); } });
      }),
    });
    child.stdout?.on('data', b => log(String(b))); child.stderr?.on('data', b => log(String(b)));
    child.on('message', (raw: unknown) => {
      const m = raw as { type: string; line?: string; error?: string; id?: string };
      if (!m || ended) return;
      if (m.type === 'log') log(String(m.line || ''));
      if (m.type === 'ready' && !stopRequested) { clearTimeout(startup); update({ state: 'ready', message: target.kind === 'web' && !target.start ? '可交互 · 使用外部本地服务，代码版本未核验' : '可交互 · 仅表示预览就绪，不代表测试通过' }); }
      if (m.type === 'end') update({ state: m.error ? 'failed' : store.run(id).state === 'failed' ? 'failed' : 'stopped', message: m.error || (store.run(id).state === 'failed' ? store.run(id).message : '预览已停止') });
      if (m.type === 'capture' && m.id) {
        const pending = captures.get(m.id); if (!pending) return;
        clearTimeout(pending.timer); captures.delete(m.id);
        if (m.error) pending.reject(new Error(m.error)); else pending.resolve(m.id);
      }
    });
    function finish(error?: string) {
      if (ended) return;
      const r = store.run(id);
      if (activePreviewStates.includes(r.state)) update({ state: stopRequested && !error ? 'stopped' : 'failed', message: error || (stopRequested ? '预览已停止' : '运行器意外退出') });
      ended = true; clearInterval(heartbeat); clearTimeout(startup); live.delete(id);
      for (const c of captures.values()) { clearTimeout(c.timer); c.reject(new Error('预览已结束')); } captures.clear(); resolveExit!();
    }
    child.once('error', e => finish(e.message)); child.once('exit', (code) => finish(code && !stopRequested ? `运行器退出码 ${code}` : undefined));
    return run;
  }
  return { snapshot,
    async action(body: any) {
      assertIdentity(); snapshot();
      const key = `${account}:${space}`;
      if (locks.has(key)) throw new Error('预览操作正在进行，请稍候');
      locks.add(key);
      try {
        if (body.action === 'detectWechatCli') return await detectWechatCli();
        if (body.action === 'saveTarget') {
          const repo = repositories.list().find(r => r.id === body.target?.repositoryId); if (!repo) throw new Error('仓库不属于本需求');
          const workspace = await bindRepository(repo); assertIdentity();
          const saved = store.saveTarget(body.target); return store.setWorkspace(saved.id, workspace);
        }
        if (body.action === 'removeTarget') { store.remove(String(body.targetId)); return { message: '配置已移除；仓库代码与运行记录保留' }; }
        if (body.action === 'start') return await start(String(body.targetId), String(body.scenarioId || 'default'), body.deliveryId ? String(body.deliveryId) : undefined);
        if (body.action === 'stop') { const run = store.run(String(body.runId)); await live.get(run.id)?.stop(); return store.run(run.id); }
        if (body.action === 'deliveryDiff') {
          const delivery = deliveries.get(String(body.deliveryId));
          const repo = repositories.list().find(r => r.id === delivery.target.repositoryId);
          if (!repo) throw new Error('关联仓库已移除');
          await verifyWorkspace(repo, delivery.target.workspace);
          const result = await promisify(execFile)('git', ['--literal-pathspecs', '-C', repo.root, 'diff', 'HEAD', '--', ...delivery.files.map(f => f.path)], { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 });
          let diff = result.stdout;
          for (const file of delivery.files.filter(f => f.change === 'added')) {
            const path = await contained(repo.root, file.path);
            const info = await lstat(path); if (!info.isFile() || info.size > 100000) continue;
            const source = await readFile(path, 'utf8');
            if (source.includes('\0')) continue;
            diff += `\n新增文件当前内容：${file.path}\n${source.slice(0, 20000)}\n`;
            if (diff.length > 200000) { diff = diff.slice(0, 200000) + '\n（内容截断，请在仓库查看完整差异）'; break; }
          }
          assertIdentity();
          return { diff: diff || '没有相对 HEAD 的已跟踪文件差异；请按交付清单在仓库查看。', message: '这里展示当前目录相对 HEAD 的差异，可能包含已有修改；交付时的文件哈希保存在交付说明中。' };
        }
        if (body.action === 'capture') {
          const run = store.run(String(body.runId)); const active = live.get(run.id);
          if (!active || run.state !== 'ready') throw new Error('请先启动预览');
          const note = typeof body.note === 'string' ? body.note.trim() : '';
          if (!note || note.length > 4000) throw new Error('请填写 1 至 4000 字的评审说明');
          const repo = repositories.list().find(r => r.id === run.target.repositoryId); if (!repo) throw new Error('关联仓库已移除');
          const before = await verifyWorkspace(repo, run.target.workspace);
          const captureId = await active.capture(); assertIdentity();
          const after = await verifyWorkspace(repo, run.target.workspace);
          const path = join(run.outputDir, `${captureId}.png`), info = await lstat(path);
          if (!info.isFile() || info.isSymbolicLink() || info.size > 10 * 1024 * 1024) throw new Error('截图文件无效或超过 10MB');
          const bytes = await readFile(path); assertIdentity();
          const assets = createRequirementAssets(root, account, space), stage = stageIndex(run.target.stageKey);
          const image = await assets.save({ name: `${run.target.name}-${captureId.slice(0, 8)}.png`, stage, bytes, confirmed: false, originKey: `preview:${captureId}:image` });
          assertIdentity();
          const data = { runId: run.id, deliveryId: run.deliveryId, changedSinceDelivery: run.changedSinceDelivery, target: run.target, scenarioId: run.scenarioId, inputAssets: run.assetRefs, startedRevision: { commit: run.commit, dirty: run.dirty }, capturedBefore: before, capturedAfter: after, image: { id: image.id, hash: image.hash }, note, capturedAt: new Date().toISOString(), logs: store.run(run.id).logs };
          const record = await assets.save({ name: `${run.target.name}-${captureId.slice(0, 8)}-预览记录.md`, stage, confirmed: false, originKey: `preview:${captureId}:record`, bytes: Buffer.from(`# 交互预览评审\n\n${note}\n\n这是设计预览记录，不是测试通过报告。dirty=true 表示含未提交修改，无法仅靠 commit 重现；外部服务未核验部署代码版本。\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\`\n`) });
          return { image, record, message: '截图与评审记录已保存为待确认资产，请到资产页提交' };
        }
        throw new Error('未知预览操作');
      } finally { locks.delete(key); }
    },
  };
}
