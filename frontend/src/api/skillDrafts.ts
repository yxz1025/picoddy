import { apiGet, apiPost } from "./client";

export type SkillDraftStatus = "editing" | "valid" | "installed";

export interface SkillDraftValidationItem {
  path?: string;
  code: string;
  message: string;
}

export interface SkillDraftValidation {
  valid: boolean;
  errors: SkillDraftValidationItem[];
  warnings: SkillDraftValidationItem[];
  checkedAt: number;
}

export interface SkillDraft {
  id: string;
  conversationId: string;
  status: SkillDraftStatus;
  skillName?: string;
  revisionOf?: string;
  revisionBaseDigest?: string;
  revisionCreatedAt?: number;
  createdAt: number;
  updatedAt: number;
  installedAt?: number;
  validation?: SkillDraftValidation;
}

export type SkillDraftMetadata = SkillDraft;

export interface SkillDraftFile {
  path: string;
  size: number;
  binary: boolean;
}

export interface SkillDraftReadResponse {
  text?: string;
  size: number;
  binary: boolean;
}

function draftPath(id: string, suffix = ""): string {
  return `/api/skill-drafts/${encodeURIComponent(id)}${suffix}`;
}

export function getDraftByConversation(
  conversationId: string,
): Promise<SkillDraft> {
  return apiGet(
    `/api/skill-drafts/by-conversation/${encodeURIComponent(conversationId)}`,
  );
}

export function getDraft(id: string): Promise<SkillDraft> {
  return apiGet(draftPath(id));
}

export function listDraftFiles(id: string): Promise<SkillDraftFile[]> {
  return apiGet(draftPath(id, "/files"));
}

export function readDraftFile(
  id: string,
  path: string,
): Promise<SkillDraftReadResponse> {
  const query = new URLSearchParams({ path });
  return apiGet(`${draftPath(id, "/file")}?${query.toString()}`);
}

export function createDraftRevision(id: string): Promise<SkillDraft> {
  return apiPost(draftPath(id, "/revision"));
}

export function listInstalledSkillFiles(
  id: string,
): Promise<SkillDraftFile[]> {
  return apiGet(draftPath(id, "/installed-files"));
}

export function readInstalledSkillFile(
  id: string,
  path: string,
): Promise<SkillDraftReadResponse> {
  const query = new URLSearchParams({ path });
  return apiGet(`${draftPath(id, "/installed-file")}?${query.toString()}`);
}

export function validateDraft(id: string): Promise<SkillDraftValidation> {
  return apiPost(draftPath(id, "/validate"));
}

export function installDraft(id: string): Promise<{ name: string }> {
  return apiPost(draftPath(id, "/install"));
}
