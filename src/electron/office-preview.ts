import { app, ipcMain, type BrowserWindow, type WebContents } from 'electron';
import { createRequire } from 'node:module';
import { join, isAbsolute, basename } from 'node:path';
import { realpath, stat, access, mkdir, cp } from 'node:fs/promises';
import { constants } from 'node:fs';
import { OfficeSessions, officeKind, type OfficeMode } from './office-sessions.ts';

const { officeTarget, prepareOfficeRuntime, verifyOfficeRuntime, VERSION } = createRequire(import.meta.url)('../../scripts/runtime/office-runtime.cjs');

type Bounds = { x: number; y: number; width: number; height: number };
export function registerOfficePreview(getWindow: () => BrowserWindow | null) {
  let runtime: any;
  let runtimeRoot = '';
  let theme = 'light';
  let initialBounds: Bounds | undefined;
  let queue = Promise.resolve<unknown>(undefined);
  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const result = queue.then(fn); queue = result.catch(() => {}); return result;
  }
  async function loadRuntime() {
    if (runtime) return runtime;
    const target = officeTarget(process.platform, process.arch);
    if (!target) throw new Error('Office 编辑器支持 Windows x64 和 Mac ARM64，当前平台请使用基础预览');
    if (app.isPackaged) {
      runtimeRoot = join(process.resourcesPath, 'office-preview');
      await verifyOfficeRuntime(runtimeRoot, process.platform, process.arch);
    } else {
      runtimeRoot = join(app.getPath('userData'), 'office-runtime', VERSION, `${process.platform}-${process.arch}`);
      await prepareOfficeRuntime({ projectRoot: app.getAppPath(), destination: runtimeRoot, platform: process.platform, arch: process.arch, reuse: true });
    }
    runtime = createRequire(import.meta.url)(join(runtimeRoot, 'runtime', 'index.js'));
    runtime.registerPreviewShellIpc(() => theme);
    return runtime;
  }
  const sessions = new OfficeSessions(async (filePath: string, mode: OfficeMode) => {
    const api = await loadRuntime();
    const owner = getWindow();
    if (!owner || owner.isDestroyed()) throw new Error('应用窗口已关闭');
    const paths = Object.fromEntries(['docs', 'sheets', 'slides'].map(kind => [kind, {
      preload: join(runtimeRoot, 'modules', kind, 'preload', 'index.js'),
      renderer: join(runtimeRoot, 'modules', kind, 'renderer', 'index.html'),
      ...(kind === 'sheets' ? { sidecar: join(runtimeRoot, 'native', officeTarget(process.platform, process.arch).sidecar) } : {}),
    }]));
    if (mode === 'edit') {
      const backupDir = join(app.getPath('userData'), 'office-backups');
      await mkdir(backupDir, { recursive: true });
      await cp(filePath, join(backupDir, `${Date.now()}-${basename(filePath)}`), { errorOnExist: true, force: false });
    }
    const native = api.createOfficePreviewHost(owner, paths);
    const view = native.mount({ kind: officeKind(filePath), filePath, mode, bounds: initialBounds ?? { x: 0, y: 0, width: 800, height: 600 } });
    native.setVisible(false);
    const contents: WebContents = view.webContents;
    let error = '';
    let ready = false;
    let disposed = false;
    let desiredVisible = false;
    let positioned = false;
    let timeout: ReturnType<typeof setTimeout>;
    const fail = (message: string) => {
      if (disposed) return;
      error = message;
      if (!contents.isDestroyed()) native.setVisible(false);
      clearTimeout(timeout);
    };
    contents.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
      if (mainFrame && code !== -3) fail(`Office 页面加载失败：${description}`);
    });
    contents.on('render-process-gone', () => fail('Office 编辑器进程已退出，未保存内容可能需要恢复'));
    contents.on('ipc-message', (_event, channel, payload) => {
      if (channel !== 'nami-office-preview:status') return;
      if (payload?.state === 'error') fail(`Office 文档加载失败：${payload.code || '未知错误'}`);
      if (payload?.state === 'ready' || payload?.state === 'awaiting-input') {
        ready = true; clearTimeout(timeout);
        if (!disposed && !contents.isDestroyed()) native.setVisible(desiredVisible && positioned && !error);
      }
    });
    // Some modules report DOM readiness instead of emitting a status event.
    const poll = setInterval(async () => {
      if (disposed || contents.isDestroyed() || ready || error) return;
      try {
        const selector = officeKind(filePath) === 'docx' ? '.doc-page, .pv-page'
          : officeKind(filePath) === 'pptx' ? '.stage-wrap canvas, .reading-slide canvas' : '.univer-sheet-container, .univer-render-canvas';
        if (await contents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) {
          ready = true; clearTimeout(timeout); native.setVisible(desiredVisible && positioned);
        }
      } catch { /* load still in progress */ }
    }, 500);
    timeout = setTimeout(() => fail('Office 文档加载超时，可使用基础预览或重试'), 60_000);
    return {
      status: () => ({ ready, error, mode }),
      layout(bounds: Bounds, visible: boolean, nextTheme: string) {
        if (disposed || contents.isDestroyed()) return;
        theme = nextTheme === 'dark' ? 'dark' : 'light';
        contents.send('app:theme-changed', theme);
        native.setBounds(bounds); positioned = true; desiredVisible = visible;
        native.setVisible(visible && ready && !error);
      },
      setVisible(visible: boolean) {
        desiredVisible = visible;
        if (!visible) positioned = false;
        if (!disposed && !contents.isDestroyed()) native.setVisible(visible && positioned && ready && !error);
      },
      async save() {
        if (error || !ready || contents.isDestroyed()) throw new Error(error || '文档尚未加载完成');
        return native.saveChanges();
      },
      async requestClose() {
        if (disposed || contents.isDestroyed()) return true;
        return native.requestClose();
      },
      dispose() {
        if (disposed) return;
        disposed = true; clearInterval(poll); clearTimeout(timeout);
        if (!owner.isDestroyed() && !contents.isDestroyed()) native.dispose();
        else if (!contents.isDestroyed()) contents.close();
      },
    };
  });
  function trusted(event: Electron.IpcMainInvokeEvent) {
    const owner = getWindow();
    if (!owner || owner.isDestroyed() || owner.webContents.isDestroyed() || event.sender !== owner.webContents || event.senderFrame !== owner.webContents.mainFrame) throw new Error('不可信的 Office 调用来源');
  }
  function handle(name: string, fn: (input: any) => any) {
    ipcMain.handle(`office.${name}`, async (event, input) => {
      trusted(event);
      try { return { ok: true, ...await fn(input ?? {}) }; }
      catch (error) { return { ok: false, error: error instanceof Error ? error.message : String(error) }; }
    });
  }
  handle('open', input => serialize(async () => {
    if (typeof input.path !== 'string' || !isAbsolute(input.path) || !officeKind(input.path)) throw new Error('不支持的 Office 文件');
    if (typeof input.lease !== 'string' || input.lease.length > 100) throw new Error('无效的编辑会话');
    const filePath = await realpath(input.path);
    if (!officeKind(filePath) || !(await stat(filePath)).isFile()) throw new Error('Office 文件不存在');
    const mode: OfficeMode = input.mode === 'resume' ? (sessions.entries.get(filePath)?.mode ?? 'preview') : input.mode === 'edit' ? 'edit' : 'preview';
    if (mode === 'edit') await access(filePath, constants.W_OK);
    const b = input.bounds;
    const zoom = getWindow()?.webContents.getZoomFactor() ?? 1;
    initialBounds = b && ['x','y','width','height'].every(k => Number.isFinite(b[k]) && b[k] >= 0 && b[k] <= 20_000)
      ? { x: Math.round(b.x * zoom), y: Math.round(b.y * zoom), width: Math.max(1, Math.round(b.width * zoom)), height: Math.max(1, Math.round(b.height * zoom)) } : undefined;
    const host = await sessions.open(filePath, mode, input.lease);
    return host.status();
  }));
  handle('layout', input => {
    const b = input.bounds;
    if (!b || !['x','y','width','height'].every(k => Number.isFinite(b[k]) && b[k] >= 0 && b[k] <= 20_000)) throw new Error('无效的预览区域');
    const zoom = getWindow()?.webContents.getZoomFactor() ?? 1;
    sessions.get(input.lease)?.layout({ x: Math.round(b.x * zoom), y: Math.round(b.y * zoom), width: Math.max(1, Math.round(b.width * zoom)), height: Math.max(1, Math.round(b.height * zoom)) }, input.visible === true, input.theme);
    return {};
  });
  handle('status', input => sessions.get(input.lease)?.status() ?? { error: '编辑会话已切换' });
  handle('hide', input => { sessions.hide(input.lease); return {}; });
  handle('save', input => serialize(async () => {
    const host = sessions.get(input.lease);
    if (!host || !await host.save()) throw new Error('保存未完成，请在编辑器中检查文件状态');
    return {};
  }));
  handle('close', input => serialize(async () => ({ closed: await sessions.close(input.lease) })));
  return { closeAll: () => serialize(() => sessions.closeAll()) };
}
