import { apiGet, apiPost, apiPut } from './client';

export type ExpertDraftOperation = 'create' | 'edit';
export type ExpertDraftStatus = 'editing' | 'valid' | 'published';

export interface ExpertDraftProfile {
  name: string;
  prompt: string;
  skillIds: string[];
  description: string;
  tags: string[];
  quickPrompts: string[];
  icon: string;
  categoryId: string;
}

export interface ExpertDraftValidationItem {
  code: string;
  message: string;
  field?: string;
}

export interface ExpertDraftValidation {
  revision: number;
  valid: boolean;
  errors: ExpertDraftValidationItem[];
  warnings: ExpertDraftValidationItem[];
  checkedAt: number;
}

export interface ExpertDraft {
  id: string;
  conversationId: string;
  operation: ExpertDraftOperation;
  status: ExpertDraftStatus;
  revision: number;
  profile: ExpertDraftProfile;
  expertId?: string;
  baseRevision?: string;
  publishedRevision?: string;
  validation?: ExpertDraftValidation;
  publishedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface PublishedExpertDraft {
  expertId: string;
  revision: string;
  name: string;
}

function draftPath(id: string, suffix = ''): string {
  return `/api/expert-drafts/${encodeURIComponent(id)}${suffix}`;
}

export function getExpertDraftByConversation(conversationId: string): Promise<ExpertDraft> {
  return apiGet(`/api/expert-drafts/by-conversation/${encodeURIComponent(conversationId)}`);
}

export function getExpertDraft(id: string): Promise<ExpertDraft> {
  return apiGet(draftPath(id));
}

export function updateExpertDraft(
  id: string,
  profile: ExpertDraftProfile,
  expectedRevision: number,
): Promise<ExpertDraft> {
  return apiPut(draftPath(id), { profile, expectedRevision });
}

export function validateExpertDraft(id: string): Promise<ExpertDraftValidation> {
  return apiPost(draftPath(id, '/validate'));
}

export function publishExpertDraft(
  id: string,
  expectedRevision: number,
  baseRevision?: string,
): Promise<PublishedExpertDraft> {
  return apiPost(draftPath(id, '/publish'), {
    expectedRevision,
    ...(baseRevision ? { baseRevision } : {}),
  });
}

