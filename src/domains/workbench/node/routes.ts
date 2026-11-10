import { createWorkbenchStore } from './store.ts';
import { platformPaths } from '../../../platform/paths.ts';
import { createConversation, getConversation } from '../../session/node/store.ts';
import { getAutomation } from '../../automation/node/store.ts';
export async function workbenchRoute(req: Request, path: string, accountId: string, openBrowser?: (file: string) => Promise<void>): Promise<Response> {
    const store = createWorkbenchStore(platformPaths.appDataDir, accountId);
    const json = (data: unknown, status = 200) => Response.json(data, { status });
    try {
        if (path === '/api/workbench') {
            if (req.method === 'GET') {
                const file = new URL(req.url).searchParams.get('path');
                return json(file ? store.findByPath(file) : store.list());
            }
            if (req.method === 'POST') {
                const b = await req.json();
                if (b.sourceSessionId && !getConversation(b.sourceSessionId))
                    return json({ error: '来源会话不存在' }, 400);
                return json(store.add(b));
            }
        }
        const match = path.match(/^\/api\/workbench\/([\w-]+)(?:\/(conversation|browser))?$/);
        if (!match)
            return json({ error: 'not found' }, 404);
        const [, id, action] = match, board = store.get(id);
        if (action === 'browser' && req.method === 'POST') {
            if (!board.available)
                throw new Error('页面文件不存在或已移动');
            if (!openBrowser)
                throw new Error('当前环境无法打开浏览器');
            await openBrowser(board.path);
            return json({ ok: true });
        }
        if (!action && req.method === 'GET')
            return json(board);
        if (action === 'conversation' && req.method === 'POST') {
            let conversation = board.sourceSessionId ? getConversation(board.sourceSessionId) : null;
            if (!conversation) {
                conversation = createConversation(`修改看板：${board.name}`);
                store.update(id, { sourceSessionId: conversation.id });
            }
            return json({ sessionId: conversation.id });
        }
        if (!action && req.method === 'PUT') {
            const patch = await req.json();
            if (patch.automationId && !getAutomation(patch.automationId))
                return json({ error: '自动化任务不存在' }, 400);
            return json(store.update(id, patch));
        }
        if (!action && req.method === 'DELETE') {
            store.remove(id);
            return json({ ok: true });
        }
        return json({ error: 'Method not allowed' }, 405);
    }
    catch (error) {
        return json({ error: error instanceof Error ? error.message : '工作台操作失败' }, 400);
    }
}
