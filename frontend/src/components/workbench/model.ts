import { apiPost } from '../../api/client';
import { useStore } from '../../store/useStore';
export type { WorkbenchBoard } from '../../../../src/domains/workbench/shared/contracts';
import type { WorkbenchBoard } from '../../../../src/domains/workbench/shared/contracts';
export function previewBoard(board: WorkbenchBoard) {
    useStore.getState().openPreview({ path: board.path });
}
export async function editBoard(board?: WorkbenchBoard) {
    const state = useStore.getState();
    const id = board
        ? (await apiPost<{
            sessionId: string;
        }>(`/api/workbench/${board.id}/conversation`)).sessionId
        : await state.createConversation('创建个人看板');
    if (board)
        await state.selectConversation(id);
    useStore.setState({ workbenchDraft: { conversationId: id, text: board
                ? `请修改个人工作台中的「${board.name}」，原页面路径：${board.path}。请在原文件上修改，保留现有数据和页面结构，完成后预览该页面。${board.automationId ? `此看板已关联项目自动化任务 ID：${board.automationId}。如果我明确要求修改定时任务的执行时间、提示词或连接器，请调用 automation_update 更新这个 ID 对应的原任务；先 view 确认任务信息，不要另建任务。只修改看板页面时不要改动自动化任务。` : ''}我的修改需求：`
                : '我想创建一个个人看板。请根据接下来的需求生成本地 HTML 页面，完成后使用 present_files 展示预览，方便添加到个人工作台。我的需求：' } });
    if (board?.available)
        previewBoard(board);
}
