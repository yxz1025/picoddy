export const PREVIEW_COMPOSER_EVENT = 'picoddy:preview-compose';
export function composePreviewRequest(conversationId: string, text: string) {
  window.dispatchEvent(new CustomEvent(PREVIEW_COMPOSER_EVENT, { detail: { conversationId, text } }));
}
