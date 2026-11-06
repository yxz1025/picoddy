// src/agent/tools/doc.ts
// 文档工具：read_doc / write_docx / write_xlsx / write_pptx
// 包装 domains/doc 的 reader/writer 为 pi AgentTool
// 这些工具生成格式化文档（结构化 JSON → docx/xlsx/pptx），与 pi 的 write（纯文本）互补

import { Type } from "typebox";
import { stat } from "node:fs/promises";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { readDoc } from "../../domains/doc/node/reader.ts";
import {
  writeDocx,
  writePptx,
  writeXlsx,
} from "../../domains/doc/node/writer.ts";
import type {
  DocxSection,
  PptxSlide,
  XlsxSheet,
} from "../../domains/doc/node/writer.ts";
import { createArtifact } from "../../domains/artifact/node/store.ts";
import { platformPaths } from "../../platform/paths.ts";
import {
  artifactPath,
  currentArtifactOutputDir,
} from "../../domains/doc/node/paths.ts";

// ===== read_doc：读文档（比 pi read 更强，支持 docx/xlsx/csv 结构化解析） =====
const readDocSchema = Type.Object({
  path: Type.String({
    description: "文件路径（支持 ~ 路径，如 ~/Desktop/report.xlsx）",
  }),
  offset: Type.Optional(Type.Integer({ minimum: 0, description: "提取文本的字符偏移，首次读取为 0" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 12_000, description: "单次返回字符数，默认 8000" })),
});

export const readDocTool: AgentTool<
  typeof readDocSchema,
  { kind: string; truncated: boolean }
> = {
  name: "read_doc",
  label: "读文档",
  description:
    "读取本地文档的唯一统一工具，支持 docx/xlsx/pptx/pdf/csv/md/json/txt。读取 .xlsx 也必须调用 read_doc，不存在 read_xlsx；不得根据文件扩展名推导其他工具名。xlsx 和 csv 会解析成表格格式，Office 文档会提取可分析文本。",
  parameters: readDocSchema,
  execute: async (_id, p) => {
    const fullPath = resolvePath(p.path);
    const result = await readDoc(fullPath);
    const offset = p.offset ?? 0;
    const end = Math.min(result.text.length, offset + (p.limit ?? 8_000));
    const hasMore = end < result.text.length;
    const notice = hasMore
      ? `\n[还有内容：使用 read_doc，path 保持不变，offset=${end} 继续读取。]`
      : result.truncated
      ? "\n[文档提取器已达到提取上限，此结果不是完整正文；原文件仍保留。]"
      : "";
    return {
      content: [{ type: "text", text: `[${result.kind}] 来源：${fullPath}\n${result.text.slice(offset, end)}${notice}` }],
      details: { kind: result.kind, truncated: result.truncated || hasMore },
    };
  },
};

// ===== write_docx：生成 Word 文档 =====
const writeDocxSchema = Type.Object({
  fileName: Type.String({ description: "文件名，如 周报.docx" }),
  title: Type.Optional(Type.String({ description: "文档标题" })),
  sections: Type.Array(
    Type.Object({
      heading: Type.Optional(Type.String()),
      paragraphs: Type.Optional(Type.Array(Type.String())),
      bullets: Type.Optional(Type.Array(Type.String())),
    }),
    { description: "章节列表，每节可有标题/段落/要点" },
  ),
});

export const writeDocxTool: AgentTool<
  typeof writeDocxSchema,
  { path: string }
> = {
  name: "write_docx",
  label: "生成 Word",
  description:
    "生成 Word 文档(.docx)。提供 fileName、可选 title、sections（章节列表，每节可有 heading/paragraphs/bullets）。文件存到 ~/.picoddy/artifacts/。",
  parameters: writeDocxSchema,
  execute: async (_id, p) => {
    const path = await writeDocx(
      p.title,
      p.sections as DocxSection[],
      p.fileName,
    );
    trackArtifact(path);
    return {
      content: [{ type: "text", text: `已生成 Word 文档：${path}` }],
      details: { path },
    };
  },
};

// ===== write_xlsx：生成 Excel 表格 =====
const writeXlsxSchema = Type.Object({
  fileName: Type.String({
    description: "必填。输出文件名，例如 data.xlsx。必须与 sheets 在同一次调用中提供。",
  }),
  sheets: Type.Array(
    Type.Object({
      name: Type.String({ description: "必填。工作表名称。" }),
      headers: Type.Optional(Type.Array(Type.String(), {
        description: "可选。表头字符串数组，与 rows 中各列按位置对应。",
      })),
      rows: Type.Array(
        Type.Array(Type.Union([Type.String(), Type.Number(), Type.Null()])),
        {
          description:
            "必填。数据行二维数组；每个内层数组是一行。允许空数组以生成只有表头的工作表。",
        },
      ),
    }),
    {
      description:
        '必填且至少一项。示例：[{"name":"分析总览","headers":["指标","数值"],"rows":[["销售额",952]]}]',
      minItems: 1,
    },
  ),
});

export const writeXlsxTool: AgentTool<
  typeof writeXlsxSchema,
  { path: string }
> = {
  name: "write_xlsx",
  label: "生成 Excel",
  description:
    "生成 Excel 表格(.xlsx)。单次调用必须同时提供 fileName 和非空 sheets；禁止仅传 fileName。每个 sheet 必须包含 name 和 rows，可选 headers。请先整理完整数据再调用。文件存到 ~/.picoddy/artifacts/。",
  parameters: writeXlsxSchema,
  execute: async (_id, p) => {
    const path = await writeXlsx(p.sheets as XlsxSheet[], p.fileName);
    trackArtifact(path);
    return {
      content: [{ type: "text", text: `已生成 Excel 表格：${path}` }],
      details: { path },
    };
  },
};

// ===== write_pptx：生成 PPT 演示文稿 =====
const writePptxSchema = Type.Object({
  fileName: Type.String({ description: "文件名，如 季度汇报.pptx" }),
  slides: Type.Array(
    Type.Object({
      title: Type.Optional(Type.String()),
      body: Type.Optional(Type.String()),
      bullets: Type.Optional(Type.Array(Type.String())),
    }),
    { description: "幻灯片列表，每页可有 title/body/bullets" },
  ),
});

export const writePptxTool: AgentTool<
  typeof writePptxSchema,
  { path: string }
> = {
  name: "write_pptx",
  label: "生成 PPT",
  description:
    "生成 PowerPoint 演示文稿(.pptx)。提供 fileName 和 slides（每页可有 title/body/bullets）。文件存到 ~/.picoddy/artifacts/。",
  parameters: writePptxSchema,
  execute: async (_id, p) => {
    const path = await writePptx(p.slides as PptxSlide[], p.fileName);
    trackArtifact(path);
    return {
      content: [{ type: "text", text: `已生成 PPT 演示文稿：${path}` }],
      details: { path },
    };
  },
};

import {
  createBackupVersion,
  editDocxFree,
  editDocxTemplate,
  editPptx,
  editXlsx,
} from "../../domains/doc/node/editor.ts";
import { getDb } from "../../infra/db.ts";
import { getArtifactByPath } from "../../domains/artifact/node/store.ts";

// ===== edit_xlsx：编辑 Excel 表格 =====
const editXlsxSchema = Type.Object({
  path: Type.String({ description: "Excel 文件路径（支持 ~ 路径）" }),
  changes: Type.Array(
    Type.Object({
      op: Type.Union([
        Type.Literal("set_cell"),
        Type.Literal("add_row"),
        Type.Literal("add_sheet"),
      ]),
      sheet: Type.Optional(
        Type.String({ description: "工作表名称，add_sheet 模式下可选" }),
      ),
      cell: Type.Optional(
        Type.String({ description: "单元格位置，如 A1，仅 set_cell 模式需要" }),
      ),
      value: Type.Optional(
        Type.Any({ description: "单元格的值，仅 set_cell 模式需要" }),
      ),
      formula: Type.Optional(
        Type.String({
          description: "单元格的公式，可选，仅 set_cell 模式需要",
        }),
      ),
      row: Type.Optional(
        Type.Array(
          Type.Any({ description: "整行数据数组，仅 add_row 模式需要" }),
        ),
      ),
      name: Type.Optional(
        Type.String({ description: "工作表名称，仅 add_sheet 模式需要" }),
      ),
    }),
    { description: "修改操作列表" },
  ),
});

export const editXlsxTool: AgentTool<
  typeof editXlsxSchema,
  { path: string; version: number }
> = {
  name: "edit_xlsx",
  label: "编辑 Excel",
  description:
    "编辑已有的 Excel 表格。支持 set_cell (修改单元格)、add_row (追加行)、add_sheet (新建表)。在修改前，会自动将当前状态备份存为历史版本。",
  parameters: editXlsxSchema,
  execute: async (_id, p) => {
    const fullPath = resolvePath(p.path);

    // 获取当前活跃会话 ID
    const db = getDb();
    const activeConv = db.prepare(
      "SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1",
    ).get() as { id: string } | undefined;
    const sessionId = activeConv?.id;

    // 创建历史版本备份
    const version = await createBackupVersion(fullPath, sessionId);

    // 执行修改
    await editXlsx(fullPath, p.changes);

    // 更新工件大小记录
    const statInfo = await stat(fullPath).catch(() => ({ size: 0 }));
    const art = getArtifactByPath(fullPath);
    if (art) {
      db.prepare("UPDATE artifacts SET bytes = ? WHERE id = ?").run(
        statInfo.size,
        art.id,
      );
    }

    return {
      content: [{
        type: "text",
        text:
          `已成功编辑 Excel 表格：${fullPath} (已自动备份原版本为 v${version})`,
      }],
      details: { path: fullPath, version },
    };
  },
};

// ===== edit_docx：编辑 Word 文档 (模板填充) =====
const editDocxSchema = Type.Object({
  path: Type.String({
    description: "Word 文档路径（支持 ~ 路径，作为模版文件）",
  }),
  vars: Type.Record(Type.String(), Type.Any(), {
    description: "模版中占位符 {{key}} 对应替换的值",
  }),
  outFileName: Type.Optional(
    Type.String({
      description: "输出文件名，若不提供则原地覆盖原有文件并存为新版本",
    }),
  ),
});

export const editDocxTool: AgentTool<
  typeof editDocxSchema,
  { path: string; version: number }
> = {
  name: "edit_docx",
  label: "编辑 Word",
  description:
    "使用模板方式编辑 Word 文档。利用 vars 字典替换文档中的 {{key}} 占位符。在修改前，会自动将当前状态备份存为历史版本。",
  parameters: editDocxSchema,
  execute: async (_id, p) => {
    const fullPath = resolvePath(p.path);

    // 获取当前活跃会话 ID
    const db = getDb();
    const activeConv = db.prepare(
      "SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1",
    ).get() as { id: string } | undefined;
    const sessionId = activeConv?.id;

    let targetPath = fullPath;
    let version = -1;

    if (p.outFileName) {
      // 写入新文件
      const { artifactPath } = await import("../../domains/doc/node/paths.ts");
      targetPath = artifactPath(p.outFileName);
      await editDocxTemplate(fullPath, p.vars, targetPath);
      // 注册为新工件
      const statInfo = await stat(targetPath).catch(() => ({ size: 0 }));
      createArtifact({
        conversationId: sessionId,
        fileName: p.outFileName,
        filePath: targetPath,
        bytes: statInfo.size,
      });
    } else {
      // 原地修改：先备份
      version = await createBackupVersion(fullPath, sessionId);
      await editDocxTemplate(fullPath, p.vars);
      // 更新大小
      const statInfo = await stat(fullPath).catch(() => ({ size: 0 }));
      const art = getArtifactByPath(fullPath);
      if (art) {
        db.prepare("UPDATE artifacts SET bytes = ? WHERE id = ?").run(
          statInfo.size,
          art.id,
        );
      }
    }

    return {
      content: [{
        type: "text",
        text: `已成功生成/编辑 Word 文档：${targetPath} ${
          version !== -1 ? `(已自动备份原版本为 v${version})` : ""
        }`,
      }],
      details: { path: targetPath, version },
    };
  },
};

// ===== edit_docx_free：自由编辑 Word（增删段落/替换文本，对照 08 计划功能11） =====
const editDocxFreeSchema = Type.Object({
  path: Type.String({ description: "Word 文档路径（支持 ~ 路径）" }),
  ops: Type.Array(
    Type.Union([
      Type.Object({
        op: Type.Literal("replace_text"),
        from: Type.String({ description: "原文本" }),
        to: Type.String({ description: "新文本" }),
      }),
      Type.Object({
        op: Type.Literal("insert_paragraph"),
        afterMatch: Type.String({ description: "在此文本所在段落后插入" }),
        text: Type.String({ description: "新段落文本" }),
        heading: Type.Optional(
          Type.Union([
            Type.Literal("h1"),
            Type.Literal("h2"),
            Type.Literal("normal"),
          ], { description: "标题级别" }),
        ),
      }),
      Type.Object({
        op: Type.Literal("delete_paragraph"),
        match: Type.String({ description: "删除含此文本的段落" }),
      }),
    ]),
    {
      description:
        "操作数组：replace_text 替换 / insert_paragraph 插入段落 / delete_paragraph 删除段落",
    },
  ),
});

export const editDocxFreeTool: AgentTool<
  typeof editDocxFreeSchema,
  { path: string; version: number }
> = {
  name: "edit_docx_free",
  label: "自由编辑 Word",
  description:
    "自由编辑 Word 文档：替换文本、在某段后插入段落、删除含某文本的段落。保留原有样式。修改前自动备份版本。适合非模板的已有文档编辑。",
  parameters: editDocxFreeSchema,
  execute: async (_id, p) => {
    const fullPath = resolvePath(p.path);
    const db = getDb();
    const activeConv = db.prepare(
      "SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1",
    ).get() as { id: string } | undefined;
    const sessionId = activeConv?.id;
    const version = await createBackupVersion(fullPath, sessionId);
    await editDocxFree(fullPath, p.ops as any);
    const statInfo = await stat(fullPath).catch(() => ({ size: 0 }));
    const art = getArtifactByPath(fullPath);
    if (art) {
      db.prepare("UPDATE artifacts SET bytes = ? WHERE id = ?").run(
        statInfo.size,
        art.id,
      );
    }
    return {
      content: [{
        type: "text",
        text: `✓ 已编辑 Word 文档：${fullPath} ${
          version !== -1 ? `(原版本已备份为 v${version})` : ""
        }`,
      }],
      details: { path: fullPath, version },
    };
  },
};

// ===== edit_pptx：编辑 PPT（替换文本，对照 08 计划功能11） =====
const editPptxSchema = Type.Object({
  path: Type.String({ description: "PPT 文件路径（支持 ~ 路径）" }),
  ops: Type.Array(
    Type.Object({
      op: Type.Literal("replace_text"),
      slide: Type.Number({ description: "页码（从 1 开始）" }),
      from: Type.String({ description: "要替换的原文本" }),
      to: Type.String({ description: "替换为的新文本" }),
    }),
    { description: "替换操作数组：指定页码替换文本" },
  ),
});

export const editPptxTool: AgentTool<
  typeof editPptxSchema,
  { path: string; version: number }
> = {
  name: "edit_pptx",
  label: "编辑 PPT",
  description: "编辑 PPT 演示文稿：替换指定页的文本。修改前自动备份版本。",
  parameters: editPptxSchema,
  execute: async (_id, p) => {
    const fullPath = resolvePath(p.path);
    const db = getDb();
    const activeConv = db.prepare(
      "SELECT id FROM conversations ORDER BY updated_at DESC LIMIT 1",
    ).get() as { id: string } | undefined;
    const sessionId = activeConv?.id;
    const version = await createBackupVersion(fullPath, sessionId);
    await editPptx(fullPath, p.ops as any);
    // 更新工件字节数（和 editXlsx/editDocx 一致）
    const statInfo = await stat(fullPath).catch(() => ({ size: 0 }));
    const art = getArtifactByPath(fullPath);
    if (art) {
      db.prepare("UPDATE artifacts SET bytes = ? WHERE id = ?").run(
        statInfo.size,
        art.id,
      );
    }
    return {
      content: [{
        type: "text",
        text: `✓ 已编辑 PPT：${fullPath} ${
          version !== -1 ? `(原版本已备份为 v${version})` : ""
        }`,
      }],
      details: { path: fullPath, version },
    };
  },
};

/** 注册工件到 DB（便于 UI 列出和预览） */
function trackArtifact(path: string): void {
  try {
    const fileName = platformPaths.basename(path) || path;
    createArtifact({ fileName, filePath: path });
  } catch (e) {
    console.warn("[doc] 工件注册失败:", e);
  }
}

/** 展开 ~ 路径 */
export function resolveDocPath(p: string): string {
  const expanded = platformPaths.expandHome(p);
  return platformPaths.isAbsolute(expanded)
    ? expanded
    : platformPaths.join(currentArtifactOutputDir(), expanded);
}

function resolvePath(p: string): string {
  return resolveDocPath(p);
}

/** Must stay aligned with each document tool's execute implementation. */
export function resolveDocToolWriteTargets(
  toolName: string,
  input: Record<string, unknown>,
): string[] {
  if (["write_docx", "write_xlsx", "write_pptx"].includes(toolName)) {
    return [artifactPath(String(input.fileName ?? ""))];
  }
  const source = resolveDocPath(String(input.path ?? ""));
  if (toolName === "edit_docx" && input.outFileName) {
    return [artifactPath(String(input.outFileName))];
  }
  return [source];
}
