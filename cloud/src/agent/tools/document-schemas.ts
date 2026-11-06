// Independent desktop parameter schemas; cloud file operations remain in the sandbox.
import {Type} from "typebox";
export const readDocSchema = Type.Object({
  path: Type.String({
    description: "文件路径（仅 /workspace/input、work、output）",
  }),
  offset: Type.Optional(Type.Integer({ minimum: 0, description: "提取文本的字符偏移，首次读取为 0" })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 12_000, description: "单次返回字符数，默认 8000" })),
});

export const writeDocxSchema = Type.Object({
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

export const writeXlsxSchema = Type.Object({
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

export const writePptxSchema = Type.Object({
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

export const editDocxSchema = Type.Object({
  path: Type.String({
    description: "Word 文档路径（仅当前沙箱工作目录，作为模板文件）",
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

export const editDocxFreeSchema = Type.Object({
  path: Type.String({ description: "Word 文档路径（仅当前沙箱工作目录）" }),
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

export const editXlsxSchema = Type.Object({
  path: Type.String({ description: "Excel 文件路径（仅当前沙箱工作目录）" }),
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

export const editPptxSchema = Type.Object({
  path: Type.String({ description: "PPT 文件路径（仅当前沙箱工作目录）" }),
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
