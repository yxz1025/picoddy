import test from "node:test";
import assert from "node:assert/strict";
import {
  DOCUMENT_PROCESSING_COMMAND,
  DOCUMENT_PROCESSING_LABEL,
  isDocumentProcessingCapability,
} from "./documentProcessingModel";

test("recognizes the unified document processing skill and plugin ids", () => {
  assert.equal(isDocumentProcessingCapability("document-processing"), true);
  assert.equal(isDocumentProcessingCapability("doc-qa"), true);
  assert.equal(isDocumentProcessingCapability("pi-local-rag"), true);
  assert.equal(isDocumentProcessingCapability("pi-web-access"), false);
});

test("exposes one composer command and label for document processing", () => {
  assert.equal(DOCUMENT_PROCESSING_COMMAND, "/document-processing");
  assert.equal(DOCUMENT_PROCESSING_LABEL, "文档处理");
});
