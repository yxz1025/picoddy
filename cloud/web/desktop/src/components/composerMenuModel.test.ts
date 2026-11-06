import assert from "node:assert/strict";
import test from "node:test";

import {
  buildComposerPayload,
  decodeAttachmentLayout,
  deleteSkillTagAtOffset,
  encodeAttachmentLayout,
  insertComposerTextAtCaret,
  insertSkillAtCursor,
  insertAttachmentGapAtCursor,
  interleaveComposerAttachments,
  SKILL_TOKEN_BOUNDARY,
  tokenizeSkillCommands,
  applyComposerSelectionDelete,
  consumeSlashTrigger,
  matchSlashTrigger,
  matchSlashTriggerAfterChip,
  resolveSlashTrigger,
  normalizeComposerSlashCharacters,
  normalizePastedComposerText,
  preparePastedComposerContent,
} from "./composerMenuModel.ts";

const KNOWN = new Set(["/read-doc", "/a", "/b"]);

test("buildComposerPayload preserves the selected managed connector kind", () => {
  assert.deepEqual(
    buildComposerPayload({
      text: "查询待办",
      connector: { id: "dingtalk", kind: "managed-cli" },
      attachmentIds: [],
    }),
    {
      text: "查询待办",
      attachmentIds: [],
      preferredConnector: "dingtalk",
      preferredConnectorKind: "managed-cli",
    },
  );
});

test("buildComposerPayload omits both connector fields without a selection", () => {
  assert.deepEqual(buildComposerPayload({ text: "hello", attachmentIds: [] }), {
    text: "hello",
    attachmentIds: [],
  });
});

test("buildComposerPayload 把技能零宽边界恢复成 slash 解析空格", () => {
  assert.deepEqual(
    buildComposerPayload({
      text: `/read-doc${SKILL_TOKEN_BOUNDARY}ask`,
      attachmentIds: [],
    }),
    {
      text: "/read-doc ask",
      attachmentIds: [],
    },
  );
  assert.equal(
    buildComposerPayload({
      text: `/read-doc${SKILL_TOKEN_BOUNDARY}`,
      attachmentIds: [],
    }).text,
    "/read-doc",
  );
});

test("insertAttachmentGapAtCursor 不改正文，偏移即光标", () => {
  assert.deepEqual(insertAttachmentGapAtCursor("", 0), {
    text: "",
    offset: 0,
    caret: 0,
  });
  assert.deepEqual(insertAttachmentGapAtCursor("x", 1), {
    text: "x",
    offset: 1,
    caret: 1,
  });
  assert.deepEqual(insertAttachmentGapAtCursor("x  y", 2), {
    text: "x  y",
    offset: 2,
    caret: 2,
  });
});

test("insertSkillAtCursor 用零宽边界切开命令，不插入可见空格", () => {
  assert.deepEqual(insertSkillAtCursor("", 0, "/read-doc"), {
    text: `/read-doc${SKILL_TOKEN_BOUNDARY}`,
    caret: 10,
  });
  assert.deepEqual(insertSkillAtCursor("x", 1, "/read-doc"), {
    text: `x${SKILL_TOKEN_BOUNDARY}/read-doc${SKILL_TOKEN_BOUNDARY}`,
    caret: 12,
  });
});

test("insertSkillAtCursor 后面已是空白时不重复补边界", () => {
  const inserted = insertSkillAtCursor("x  y", 2, "/read-doc");
  assert.equal(inserted.text, "x /read-doc y");
  assert.equal(inserted.caret, 11);
});

test("insertSkillAtCursor 后接正文时加零宽边界，避免 ASCII 粘连拆掉标签", () => {
  assert.deepEqual(insertSkillAtCursor("ask", 0, "/read-doc"), {
    text: `/read-doc${SKILL_TOKEN_BOUNDARY}ask`,
    caret: 10,
  });
  assert.deepEqual(insertSkillAtCursor("你好", 0, "/read-doc"), {
    text: `/read-doc${SKILL_TOKEN_BOUNDARY}你好`,
    caret: 10,
  });
});

test("tokenizeSkillCommands 中文紧贴标签后仍识别为标签", () => {
  assert.deepEqual(tokenizeSkillCommands("/read-doc你", KNOWN), [
    { type: "tag", text: "/read-doc" },
    { type: "text", text: "你" },
  ]);
  assert.deepEqual(tokenizeSkillCommands("x /read-doc你 y", KNOWN), [
    { type: "text", text: "x " },
    { type: "tag", text: "/read-doc" },
    { type: "text", text: "你 y" },
  ]);
});

test("tokenizeSkillCommands 标签后紧跟 ASCII 或斜杠仍保持标签", () => {
  assert.deepEqual(tokenizeSkillCommands("/read-docasdasd", KNOWN), [
    { type: "tag", text: "/read-doc" },
    { type: "text", text: "asdasd" },
  ]);
  assert.deepEqual(tokenizeSkillCommands("/read-doc/", KNOWN), [
    { type: "tag", text: "/read-doc" },
    { type: "text", text: "/" },
  ]);
  assert.deepEqual(tokenizeSkillCommands("x /read-docx", KNOWN), [
    { type: "text", text: "x " },
    { type: "tag", text: "/read-doc" },
    { type: "text", text: "x" },
  ]);
  assert.deepEqual(tokenizeSkillCommands("/read-doc.", KNOWN), [
    { type: "tag", text: "/read-doc" },
    { type: "text", text: "." },
  ]);
});

test("tokenizeSkillCommands 重叠命令取最长已知前缀", () => {
  const known = new Set(["/read", "/read-doc"]);
  assert.deepEqual(tokenizeSkillCommands("/read-docx", known), [
    { type: "tag", text: "/read-doc" },
    { type: "text", text: "x" },
  ]);
});

test("tokenizeSkillCommands 未知路径与非边界斜杠不被误伤", () => {
  assert.deepEqual(tokenizeSkillCommands("/usr/local", KNOWN), [
    { type: "text", text: "/usr/local" },
  ]);
  assert.deepEqual(tokenizeSkillCommands("点/read-doc你", KNOWN), [
    { type: "text", text: "点/read-doc你" },
  ]);
});

test("tokenizeSkillCommands 原有空白/结尾用例不回归", () => {
  assert.deepEqual(tokenizeSkillCommands("/read-doc", KNOWN), [
    { type: "tag", text: "/read-doc" },
  ]);
  assert.deepEqual(tokenizeSkillCommands("x /read-doc ", KNOWN), [
    { type: "text", text: "x " },
    { type: "tag", text: "/read-doc" },
    { type: "text", text: " " },
  ]);
});

test("tokenizeSkillCommands 零宽边界后的 ASCII 仍识别为标签", () => {
  assert.deepEqual(
    tokenizeSkillCommands(`/read-doc${SKILL_TOKEN_BOUNDARY}ask`, KNOWN),
    [
      { type: "tag", text: "/read-doc" },
      { type: "text", text: `${SKILL_TOKEN_BOUNDARY}ask` },
    ],
  );
});

test("tokenizeSkillCommands 标签前输入 ASCII 需零宽边界才能保持标签", () => {
  assert.deepEqual(
    tokenizeSkillCommands("sad/read-doc", KNOWN),
    [{ type: "text", text: "sad/read-doc" }],
  );
  assert.deepEqual(
    tokenizeSkillCommands(`sad${SKILL_TOKEN_BOUNDARY}/read-doc`, KNOWN),
    [
      { type: "text", text: `sad${SKILL_TOKEN_BOUNDARY}` },
      { type: "tag", text: "/read-doc" },
    ],
  );
});

test("deleteSkillTagAtOffset 仅在紧贴标签或只隔零宽边界时删除", () => {
  assert.deepEqual(deleteSkillTagAtOffset("/read-doc", 9, KNOWN), {
    text: "",
    caret: 0,
  });
  assert.deepEqual(
    deleteSkillTagAtOffset(`/read-doc${SKILL_TOKEN_BOUNDARY}`, 10, KNOWN),
    { text: "", caret: 0 },
  );
  assert.deepEqual(
    deleteSkillTagAtOffset(`x${SKILL_TOKEN_BOUNDARY}/read-doc${SKILL_TOKEN_BOUNDARY}ask`, 12, KNOWN),
    { text: "xask", caret: 1 },
  );
});

test("deleteSkillTagAtOffset 标签后普通空格或正文时返回 null", () => {
  assert.equal(deleteSkillTagAtOffset("x /read-doc ", 12, KNOWN), null);
  assert.equal(deleteSkillTagAtOffset("x /read-doc 你好", 14, KNOWN), null);
  assert.equal(deleteSkillTagAtOffset("x /read-doc你", 12, KNOWN), null);
});

test("deleteSkillTagAtOffset 光标在标签内部返回 null", () => {
  assert.equal(deleteSkillTagAtOffset("x /read-doc ", 7, KNOWN), null);
});

test("deleteSkillTagAtOffset 多标签场景只删紧贴的那颗", () => {
  assert.deepEqual(deleteSkillTagAtOffset("x /a /b", 2, KNOWN), {
    text: "x  /b",
    caret: 2,
  });
  assert.deepEqual(deleteSkillTagAtOffset("x /a /b", 5, KNOWN), {
    text: "x /a ",
    caret: 5,
  });
  assert.equal(deleteSkillTagAtOffset("x /a hello", 8, KNOWN), null);
});

test("deleteSkillTagAtOffset 行首标签紧贴时空格仍留给后面的字", () => {
  assert.deepEqual(deleteSkillTagAtOffset("/b x", 0, KNOWN), {
    text: " x",
    caret: 0,
  });
  assert.deepEqual(deleteSkillTagAtOffset("/b x", 2, KNOWN), {
    text: " x",
    caret: 0,
  });
});

test("interleaveComposerAttachments 同偏移多附件保持插入顺序", () => {
  const files = [
    {
      id: "a1",
      name: "一.md",
      size: 1,
      mimeType: "text/markdown",
      extension: "md",
    },
    {
      id: "a2",
      name: "二.md",
      size: 1,
      mimeType: "text/markdown",
      extension: "md",
    },
  ];
  const parts = interleaveComposerAttachments(
    "字",
    files,
    { a1: 0, a2: 0 },
    KNOWN,
  );
  assert.deepEqual(
    parts.map((part) =>
      part.type === "attachment" ? part.attachment.id : part
    ),
    [
      "a1",
      "a2",
      { type: "text", text: "字" },
    ],
  );
});

test("encodeAttachmentLayout 保留正文偏移与同位置次序", () => {
  assert.deepEqual(decodeAttachmentLayout(encodeAttachmentLayout(12, 3)), {
    offset: 12,
    order: 3,
  });
  assert.deepEqual(decodeAttachmentLayout(encodeAttachmentLayout(0, 1)), {
    offset: 0,
    order: 1,
  });
});

test("interleaveComposerAttachments 按偏移把文件插回文字与技能之间", () => {
  const file = {
    id: "a1",
    name: "衣橱.md",
    size: 24,
    mimeType: "text/markdown",
    extension: "md",
  };
  const parts = interleaveComposerAttachments(
    "前面 /a 后面",
    [file],
    { a1: 2 },
    KNOWN,
  );
  assert.deepEqual(
    parts.map((part) =>
      part.type === "attachment" ? { type: "attachment", id: part.attachment.id } : part
    ),
    [
      { type: "text", text: "前面" },
      { type: "attachment", id: "a1" },
      { type: "text", text: " " },
      { type: "tag", text: "/a" },
      { type: "text", text: " 后面" },
    ],
  );
});

test("matchSlashTrigger 普通文字后必须空格，技能边界后可直接斜杠", () => {
  assert.equal(matchSlashTrigger("文字/"), null);
  assert.equal(matchSlashTrigger("文字/read"), null);
  assert.deepEqual(matchSlashTrigger("/"), { type: "command", query: "" });
  assert.deepEqual(matchSlashTrigger("文字 /"), { type: "command", query: "" });
  assert.deepEqual(matchSlashTrigger("文字 /a"), { type: "command", query: "a" });
  assert.deepEqual(
    matchSlashTrigger(`/read-doc${SKILL_TOKEN_BOUNDARY}/`),
    { type: "command", query: "" },
  );
  assert.deepEqual(matchSlashTrigger("/skill "), { type: "skill", query: "" });
  assert.deepEqual(matchSlashTrigger("/skill foo"), { type: "skill", query: "foo" });
});

test("matchSlashTriggerAfterChip 仅当前节点是斜杠查询时命中", () => {
  assert.deepEqual(matchSlashTriggerAfterChip("/"), {
    type: "command",
    query: "",
  });
  assert.deepEqual(matchSlashTriggerAfterChip(`${SKILL_TOKEN_BOUNDARY}/b`), {
    type: "command",
    query: "b",
  });
  assert.equal(matchSlashTriggerAfterChip("文字/"), null);
  assert.equal(matchSlashTriggerAfterChip("hello/"), null);
});

test("resolveSlashTrigger 标签后英文不会把前面命令当成斜杠查询", () => {
  assert.equal(
    resolveSlashTrigger("/read-docasdasd", "asdasd"),
    null,
  );
  assert.deepEqual(
    resolveSlashTrigger("/read-doc/", "/"),
    { type: "command", query: "" },
  );
  assert.deepEqual(
    resolveSlashTrigger("/read-doc /a", " /a"),
    { type: "command", query: "a" },
  );
  assert.equal(
    resolveSlashTrigger("/read-doc", ""),
    null,
  );
});

test("consumeSlashTrigger 去掉斜杠查询并保留边界", () => {
  assert.equal(consumeSlashTrigger("/"), "");
  assert.equal(consumeSlashTrigger("文字 /a"), "文字 ");
  assert.equal(
    consumeSlashTrigger(`/read-doc${SKILL_TOKEN_BOUNDARY}/b`),
    `/read-doc${SKILL_TOKEN_BOUNDARY}`,
  );
  assert.equal(consumeSlashTrigger("hello/", "/"), "hello");
});

test("附件末尾 caret anchor 前缀不多删除正文字符", () => {
  assert.equal(consumeSlashTrigger("hello/a", "/a"), "hello");
});

test("normalizeComposerSlashCharacters 统一输入法斜杠字形", () => {
  assert.equal(
    normalizeComposerSlashCharacters("／打卡时间∕end⁄"),
    "/打卡时间/end/",
  );
});

test("applyComposerSelectionDelete 删除文字并平移未选中附件", () => {
  const fileA = {
    id: "a1",
    name: "一.md",
    size: 1,
    mimeType: "text/markdown",
    extension: "md",
  };
  const fileB = {
    id: "a2",
    name: "二.md",
    size: 1,
    mimeType: "text/markdown",
    extension: "md",
  };
  assert.deepEqual(
    applyComposerSelectionDelete({
      text: "hello /a world",
      rangeStart: 4,
      rangeEnd: 9,
      removeAttachmentIds: ["a1"],
      attachments: [fileA, fileB],
      anchors: { a1: 6, a2: 9 },
    }),
    {
      text: "hellworld",
      caret: 4,
      attachments: [fileB],
      anchors: { a2: 4 },
    },
  );
});

test("applyComposerSelectionDelete 反向选区与同位置附件", () => {
  const fileA = {
    id: "a1",
    name: "一.md",
    size: 1,
    mimeType: "text/markdown",
    extension: "md",
  };
  const fileB = {
    id: "a2",
    name: "二.md",
    size: 1,
    mimeType: "text/markdown",
    extension: "md",
  };
  const result = applyComposerSelectionDelete({
    text: "abc",
    rangeStart: 3,
    rangeEnd: 0,
    removeAttachmentIds: ["a1"],
    attachments: [fileA, fileB],
    anchors: { a1: 0, a2: 0 },
  });
  assert.equal(result.text, "");
  assert.equal(result.caret, 0);
  assert.deepEqual(result.attachments.map((item) => item.id), ["a2"]);
  assert.equal(result.anchors.a2, 0);
});

test("consumeSlashTrigger + insertSkillAtCursor 连续技能无需空格", () => {
  const first = insertSkillAtCursor("", 0, "/a");
  const prefix = consumeSlashTrigger(`${first.text}/`);
  const second = insertSkillAtCursor(prefix, prefix.length, "/b");
  assert.equal(
    second.text,
    `/a${SKILL_TOKEN_BOUNDARY}/b${SKILL_TOKEN_BOUNDARY}`,
  );
});

test("applyComposerSelectionDelete 行首退格只删换行，光标停在上一行末尾", () => {
  const result = applyComposerSelectionDelete({
    text: "/read-doc hello\nworld",
    rangeStart: "/read-doc hello".length,
    rangeEnd: "/read-doc hello\n".length,
  });
  assert.equal(result.text, "/read-doc helloworld");
  assert.equal(result.caret, "/read-doc hello".length);
});

test("applyComposerSelectionDelete 仅删除零长度附件标签", () => {
  const fileA = {
    id: "a1",
    name: "一.md",
    size: 1,
    mimeType: "text/markdown",
    extension: "md",
  };
  const result = applyComposerSelectionDelete({
    text: "ab",
    rangeStart: 1,
    rangeEnd: 1,
    removeAttachmentIds: ["a1"],
    attachments: [fileA],
    anchors: { a1: 1 },
  });
  assert.equal(result.text, "ab");
  assert.equal(result.caret, 1);
  assert.deepEqual(result.attachments, []);
});

test("normalizePastedComposerText 统一换行并归一化斜杠", () => {
  assert.equal(normalizePastedComposerText("a\r\nb\rc"), "a\nb\nc");
  assert.equal(normalizePastedComposerText("查询／技能"), "查询/技能");
});

test("普通粘贴内容保持内联", () => {
  assert.deepEqual(preparePastedComposerContent("{\"a\":1}", 32), {
    inlineText: "{\"a\":1}",
  });
});

test("超长 JSON 粘贴转为附件并保留尾部用户指令", () => {
  const json = JSON.stringify({ data: "x".repeat(80) });
  assert.deepEqual(
    preparePastedComposerContent(`${json}\r\n帮我提取 productCode`, 32),
    {
      inlineText: "帮我提取 productCode",
      attachment: {
        content: json,
        extension: "json",
        mimeType: "application/json",
      },
    },
  );
});

test("超长非 JSON 粘贴转为 UTF-8 文本附件", () => {
  const text = "中".repeat(20);
  assert.deepEqual(preparePastedComposerContent(text, 32), {
    inlineText: "",
    attachment: {
      content: text,
      extension: "txt",
      mimeType: "text/plain",
    },
  });
});

test("insertComposerTextAtCaret 保留换行并后移附件锚点", () => {
  const fileA = {
    id: "a1",
    name: "一.md",
    size: 1,
    mimeType: "text/markdown",
    extension: "md",
  };
  assert.deepEqual(
    insertComposerTextAtCaret({
      text: "ab",
      caret: 1,
      insert: "x\ny",
      attachments: [fileA],
      anchors: { a1: 1 },
    }),
    {
      text: "ax\nyb",
      caret: 4,
      attachments: [fileA],
      anchors: { a1: 4 },
    },
  );
});

test("粘贴保留换行时行首 ASCII 不会把上一行技能标签拆成正文", () => {
  const pasted = `/read-doc\nassss`;
  assert.deepEqual(tokenizeSkillCommands(pasted, KNOWN), [
    { type: "tag", text: "/read-doc" },
    { type: "text", text: "\nassss" },
  ]);
  assert.deepEqual(tokenizeSkillCommands("/read-docassss", KNOWN), [
    { type: "tag", text: "/read-doc" },
    { type: "text", text: "assss" },
  ]);
});

test('multiple selected connectors survive each message without altering user text', () => {
  const connectors = [{ id: 'gitlab', kind: 'mcp' as const }, { id: 'jenkins', kind: 'mcp' as const }];
  for (const text of ['检查代码后查看构建结果', '再查一下上一次构建']) {
    const result = buildComposerPayload({ text, connectors, attachmentIds: [] });
    assert.deepEqual(result.preferredConnectors, connectors);
    assert.equal(result.text, text);
    assert.equal(result.preferredConnector, undefined);
  }
});
