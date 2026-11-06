import { getSetting } from '../../domains/settings/node/store.ts';
import { selectChannelModel } from './model-selection.ts';
import { provider } from '../../agent/provider.ts';
import { clearConfirmHandler, setConfirmHandler } from '../../agent/permissions.ts';
import { appendMessage, getMessages, updateConversationStatus, getConversation, updateConversationModel } from '../../domains/session/node/store.ts';
import { updateGate } from '../../infra/update-gate.ts';
import { createChannelAgentBridge } from './bridge.ts';

export const localChannelAgentBridge = createChannelAgentBridge({
  provider: {
    async attachPersistence(sessionId) {
      const conversation = getConversation(sessionId);
      if (!conversation) throw new Error('通道会话不存在');
      const model = selectChannelModel({ provider: conversation.modelProvider, modelId: conversation.modelId }, {
        provider: getSetting('default_provider', ''), modelId: getSetting('default_model_id', ''),
      });
      if (model.provider !== conversation.modelProvider || model.modelId !== conversation.modelId) updateConversationModel(sessionId, model.provider, model.modelId);
      return provider.attachPersistence(sessionId);
    },
    abort: sessionId => provider.abort(sessionId),
    prompt: (sessionId, text, options) => provider.prompt(sessionId, text, options),
  }, appendMessage, getMessages, setConfirmHandler, clearConfirmHandler,
  setStatus: updateConversationStatus,
  run: work => updateGate.run('channel', work),
});
