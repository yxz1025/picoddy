import assert from "node:assert/strict";
import test from "node:test";

import { mapPromptRequestToSessionContinue } from "./promptRequestModel";

test('testing publish field survives the Electron continuation mapping', () => {
  const mapped = mapPromptRequestToSessionContinue({ sessionId: 'testing', testingPublishField: 'custom_field_two' });
  assert.equal(mapped.testingPublishField, 'custom_field_two');
  assert.equal('testingPublishField' in mapPromptRequestToSessionContinue({ sessionId: 'ordinary' }), false);
});

test("maps selected skill names to session.continue in their selected order", () => {
  assert.deepEqual(
    mapPromptRequestToSessionContinue({
      sessionId: "expert-1",
      text: "创建测试专家",
      modelProvider: "qwen",
      modelId: "qwen-max",
      selectedSkillNames: ["report-writer", "data-analysis"],
    }),
    {
      sessionId: "expert-1",
      text: "创建测试专家",
      mode: undefined,
      permission: undefined,
      modelProvider: "qwen",
      modelId: "qwen-max",
      attachmentIds: undefined,
      attachments: undefined,
      preferredConnector: undefined,
      preferredConnectorKind: undefined,
      displayText: undefined,
      attachmentAnchors: undefined,
      selectedSkillNames: ["report-writer", "data-analysis"],
      selectedExpertId: undefined,
    },
  );
});

test("omits an incomplete model selection instead of forwarding a mismatched pair", () => {
  assert.deepEqual(
    mapPromptRequestToSessionContinue({
      sessionId: "s1",
      text: "hello",
      modelProvider: "qwen",
    }),
    {
      sessionId: "s1",
      text: "hello",
      mode: undefined,
      permission: undefined,
      modelProvider: undefined,
      modelId: undefined,
      attachmentIds: undefined,
      attachments: undefined,
      preferredConnector: undefined,
      preferredConnectorKind: undefined,
      displayText: undefined,
      attachmentAnchors: undefined,
      selectedSkillNames: undefined,
      selectedExpertId: undefined,
    },
  );
});

test("preserves raw turn fields without composing prompt markup", () => {
  const request = mapPromptRequestToSessionContinue({
    sessionId: "s1",
    text: "</turn_payload>",
    attachmentIds: ["a1"],
    attachments: [{ id: "a1", content: "raw" }],
    preferredConnector: "docs",
    preferredConnectorKind: "mcp",
    selectedExpertId: "architect",
  });

  assert.equal(request.text, "</turn_payload>");
  assert.deepEqual(request.attachments, [{ id: "a1", content: "raw" }]);
  assert.equal(request.preferredConnector, "docs");
  assert.equal(request.preferredConnectorKind, "mcp");
  assert.equal(request.selectedExpertId, "architect");
});

test('all selected connectors pass through Electron session continue', () => {
  const preferredConnectors = [{ id: 'gitlab', kind: 'mcp' as const }, { id: 'jenkins', kind: 'mcp' as const }];
  assert.deepEqual(mapPromptRequestToSessionContinue({ text: '查询', preferredConnectors }).preferredConnectors, preferredConnectors);
});
