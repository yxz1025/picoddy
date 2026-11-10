import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import type { BoardInput, BoardPatch, WorkbenchBoard } from '../shared/contracts.ts';
type StoredBoard = Omit<WorkbenchBoard, 'available' | 'fileModifiedAt'>;
function name(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 100)
        throw new Error('看板名称须为 1–100 个字符');
    return value.trim();
}
function description(value: unknown): string {
    if (value !== undefined && (typeof value !== 'string' || value.length > 500))
        throw new Error('描述不能超过 500 个字符');
    return (value as string | undefined)?.trim() ?? '';
}
function optionalId(value: unknown): string | null {
    if (value == null)
        return null;
    if (typeof value !== 'string' || !value.trim() || value.length > 200)
        throw new Error('关联任务无效');
    return value.trim();
}
export function createWorkbenchStore(root: string, accountId: string) {
    if (!accountId)
        throw new Error('请先登录');
    const dir = join(root, 'workbench', createHash('sha256').update(accountId).digest('hex'));
    const file = join(dir, 'boards.json');
    const read = (): StoredBoard[] => existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
    const save = (boards: StoredBoard[]) => {
        mkdirSync(dir, { recursive: true });
        const temp = join(dir, `${randomUUID()}.tmp`);
        writeFileSync(temp, JSON.stringify(boards, null, 2), { mode: 0o600 });
        renameSync(temp, file);
    };
    const view = (b: StoredBoard): WorkbenchBoard => {
        try {
            const s = statSync(b.path);
            return { ...b, available: s.isFile(), fileModifiedAt: s.mtimeMs };
        }
        catch {
            return { ...b, available: false, fileModifiedAt: null };
        }
    };
    const get = (id: string) => { const b = read().find(b => b.id === id); if (!b)
        throw new Error('看板不存在'); return view(b); };
    return {
        list: () => read().map(view).sort((a, b) => b.createdAt - a.createdAt),
        get,
        findByPath: (path: string) => {
            let canonical = path;
            try {
                canonical = realpathSync(path);
            }
            catch { }
            return read().map(view).find(b => b.path === canonical) ?? null;
        },
        add(input: BoardInput): WorkbenchBoard {
            if (typeof input.path !== 'string' || !isAbsolute(input.path))
                throw new Error('请选择本地 HTML 文件的绝对路径');
            const path = realpathSync(input.path);
            if (!/\.html?$/i.test(path) || !statSync(path).isFile())
                throw new Error('仅支持 HTML 看板页面');
            const boards = read(), existing = boards.find(b => b.path === path);
            if (existing) {
                if (!existing.sourceSessionId && input.sourceSessionId) {
                    existing.sourceSessionId = optionalId(input.sourceSessionId);
                    save(boards);
                }
                return view(existing);
            }
            const board: StoredBoard = { id: randomUUID(), path, name: name(input.name), description: description(input.description), sourceSessionId: optionalId(input.sourceSessionId), automationId: null, createdAt: Date.now() };
            save([board, ...boards]);
            return view(board);
        },
        update(id: string, patch: BoardPatch): WorkbenchBoard {
            const boards = read(), index = boards.findIndex(b => b.id === id);
            if (index < 0)
                throw new Error('看板不存在');
            const b = { ...boards[index] };
            if (patch.name !== undefined)
                b.name = name(patch.name);
            if (patch.description !== undefined)
                b.description = description(patch.description);
            if (patch.sourceSessionId !== undefined)
                b.sourceSessionId = optionalId(patch.sourceSessionId);
            if (patch.automationId !== undefined)
                b.automationId = optionalId(patch.automationId);
            boards[index] = b;
            save(boards);
            return view(b);
        },
        remove(id: string) { get(id); save(read().filter(b => b.id !== id)); },
    };
}
