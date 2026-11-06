export const DOCUMENT_PROCESSING_COMMAND = "/document-processing";
export const DOCUMENT_PROCESSING_LABEL = "文档处理";
export const COMPOSER_SKILL_EVENT = "composer:skill-selected";
export const DOCUMENT_PROCESSING_EVENT = COMPOSER_SKILL_EVENT;

const DOCUMENT_PROCESSING_CAPABILITIES = new Set([
  "document-processing",
  "doc-qa",
  "pi-docparser",
  "pi-local-rag",
]);

export function isDocumentProcessingCapability(id: string): boolean {
  return DOCUMENT_PROCESSING_CAPABILITIES.has(id.trim().toLowerCase());
}
