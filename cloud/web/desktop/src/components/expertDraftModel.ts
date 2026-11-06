import type { ExpertDraft } from '../api/expertDrafts';
export function canPublishExpertDraft(draft: ExpertDraft | null, busy: boolean, pending: boolean): boolean {
  return !busy && !pending && draft?.status === 'valid' && draft.validation?.valid === true && draft.validation.revision === draft.revision;
}
