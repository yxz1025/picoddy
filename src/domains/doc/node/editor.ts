// src/domains/doc/node/editor.ts
// 文档编辑引擎 (Layer 1 JS) + 历史版本备份逻辑。
// 对照 04 文档 §4.3: edit_docx(模板) / edit_xlsx。

import Pizzip from "pizzip";
import { mkdir, stat, writeFile, readFile, copyFile } from "node:fs/promises";

import Docxtemplater from "docxtemplater";
import excelMod from "exceljs";
// @ts-ignore
const ExcelJS = excelMod.default || excelMod;
import {
  getArtifactByPath,
  createArtifact,
  getNextVersion,
  createArtifactVersion,
} from "../../artifact/node/store.ts";
import { platformPaths } from "../../../platform/paths.ts";

const VERSIONS_DIR = platformPaths.join(platformPaths.artifactsDir, ".versions");

/** 确保版本备份目录存在 */
async function ensureVersionsDir(): Promise<void> {
  try {
    await mkdir(VERSIONS_DIR, { recursive: true });
  } catch { /* 已存在 */ }
}

/**
 * 在编辑前备份当前工件为一个历史版本。
 * @param filePath 绝对文件路径
 * @param conversationId 会话 ID（用于新工件关联）
 * @returns 备份的版本号，失败返回 -1
 */
export async function createBackupVersion(filePath: string, conversationId?: string): Promise<number> {
  try {
    await ensureVersionsDir();

    // 1. 获取或创建工件记录
    let artifact = getArtifactByPath(filePath);
    if (!artifact) {
      const fileName = platformPaths.basename(filePath) || filePath;
      const statInfo = await stat(filePath).catch(() => ({ size: 0 }));
      artifact = createArtifact({
        conversationId,
        fileName,
        filePath,
        bytes: statInfo.size,
      });
    }

    const artifactId = artifact.id;
    const nextVer = getNextVersion(artifactId);

    // 2. 复制文件到版本备份库
    const ext = filePath.split(".").pop()?.toLowerCase() || "tmp";
    const backupPath = platformPaths.join(VERSIONS_DIR, `${artifactId}_v${nextVer}.${ext}`);
    await copyFile(filePath, backupPath);

    // 3. 写入数据库
    createArtifactVersion(artifactId, nextVer, backupPath);
    console.log(`[editor] 成功备份工件版本: ${filePath} -> v${nextVer} (${backupPath})`);
    return nextVer;
  } catch (e) {
    console.warn("[editor] 创建历史备份版本失败:", (e as Error).message);
    return -1;
  }
}

/**
 * 编辑 Excel 表格 (exceljs 读-改-写)
 */
export async function editXlsx(filePath: string, changes: any[]): Promise<string> {
  // @ts-ignore
  const workbook = new ExcelJS.Workbook();
  const buf = await readFile(filePath);
  // @ts-ignore
  await workbook.xlsx.load(buf as any);

  for (const c of changes) {
    if (c.op === "add_sheet") {
      workbook.addWorksheet(c.name);
    } else {
      const sheet = workbook.getWorksheet(c.sheet);
      if (!sheet) throw new Error(`找不到工作表: "${c.sheet}"`);

      if (c.op === "set_cell") {
        const cell = sheet.getCell(c.cell);
        if (c.formula) {
          cell.value = { formula: c.formula, result: c.value };
        } else {
          cell.value = c.value;
        }
      } else if (c.op === "add_row") {
        sheet.addRow(c.row);
      }
    }
  }

  const newBuf = await workbook.xlsx.writeBuffer();
  await writeFile(filePath, new Uint8Array(newBuf as any));
  return filePath;
}

/**
 * 模板填充 Word 文档 (docxtemplater)
 */
export async function editDocxTemplate(
  filePath: string,
  vars: Record<string, any>,
  outPath?: string,
): Promise<string> {
  const content = await readFile(filePath);
  // @ts-ignore
  const zip = new Pizzip(content);
  // @ts-ignore
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: {
      start: "{{",
      end: "}}",
    },
  });
  doc.render(vars);
  const buf = doc.getZip().generate({
    type: "nodebuffer",
    compression: "DEFLATE",
  });
  const targetPath = outPath || filePath;
  await writeFile(targetPath, buf);
  return targetPath;
}

/** XML 转义 */
function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** docx 自由编辑操作（结构化 op 驱动，对照 08 计划功能11） */
export type DocxOp =
  | { op: "replace_text"; from: string; to: string }
  | { op: "insert_paragraph"; afterMatch: string; text: string; heading?: "h1" | "h2" | "normal" }
  | { op: "delete_paragraph"; match: string };

/**
 * 自由编辑 Word 文档（pizzip 直接操作 word/document.xml，保真度高）。
 * 支持：替换文本、在某段后插入段落、删除含某文本的段落。复杂样式保留。
 */
export async function editDocxFree(filePath: string, ops: DocxOp[]): Promise<string> {
  const buf = await readFile(filePath);
  // @ts-ignore
  const zip = new Pizzip(buf);
  const docFile = zip.file("word/document.xml");
  if (!docFile) throw new Error("文档格式异常：找不到 word/document.xml");
  let xml = docFile.asText();
  for (const o of ops) {
    if (o.op === "replace_text") {
      xml = xml.split(escapeXml(o.from)).join(escapeXml(o.to));
    } else if (o.op === "delete_paragraph") {
      // 跨 run 修复：先提取每个 <w:p> 的纯文本，在纯文本上匹配，命中则删原始段落
      const matchText = o.match.toLowerCase();
      xml = removeParagraphsByText(xml, (plainText) => plainText.toLowerCase().includes(matchText), 1);
    } else if (o.op === "insert_paragraph") {
      // 跨 run 修复：在纯文本匹配到的段落后面插入新段落
      const afterText = o.afterMatch.toLowerCase();
      const style = o.heading === "h1" ? '<w:pStyle w:val="Heading1"/>'
        : o.heading === "h2" ? '<w:pStyle w:val="Heading2"/>' : "";
      const newP = `<w:p>${style ? `<w:pPr>${style}</w:pPr>` : ""}<w:r><w:t xml:space="preserve">${escapeXml(o.text)}</w:t></w:r></w:p>`;
      xml = insertAfterParagraphByText(xml, afterText, newP, 1);
    }
  }
  zip.file("word/document.xml", xml);
  const out = zip.generate({ type: "nodebuffer" });
  await writeFile(filePath, out);
  return filePath;
}

/**
 * 从 XML 中按纯文本条件查找并删除段落（跨 run 安全）
 * @param xml 原始 XML
 * @param predicate 接收段落纯文本，返回 true 则删除
 * @param maxDelete 最多删几个（默认 1，防误删）
 */
function removeParagraphsByText(xml: string, predicate: (plainText: string) => boolean, maxDelete = 1): string {
  const paraRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let deleted = 0;
  return xml.replace(paraRegex, (para) => {
    if (deleted >= maxDelete) return para;
    // 提取纯文本：去掉所有标签 + 解码实体
    const plain = para.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    if (predicate(plain)) {
      deleted++;
      return ""; // 删除该段落
    }
    return para;
  });
}

/**
 * 在纯文本匹配的段落后面插入新内容（跨 run 安全）
 */
function insertAfterParagraphByText(xml: string, matchText: string, newXml: string, maxInsert = 1): string {
  const paraRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let inserted = 0;
  return xml.replace(paraRegex, (para) => {
    if (inserted >= maxInsert) return para;
    const plain = para.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    if (plain.toLowerCase().includes(matchText)) {
      inserted++;
      return para + newXml; // 在匹配段落后面插入
    }
    return para;
  });
}

/** pptx 编辑操作 */
export type PptxOp =
  | { op: "replace_text"; slide: number; from: string; to: string };

/**
 * 编辑 PPT 演示文稿（pizzip 操作 ppt/slides/slideN.xml）。
 * 支持：替换某页文本。（duplicate_slide 涉及 rels/Content_Types 较复杂，留 P2）
 */
export async function editPptx(filePath: string, ops: PptxOp[]): Promise<string> {
  const buf = await readFile(filePath);
  // @ts-ignore
  const zip = new Pizzip(buf);
  for (const o of ops) {
    if (o.op === "replace_text") {
      const file = `ppt/slides/slide${o.slide}.xml`;
      const f = zip.file(file);
      if (!f) throw new Error(`幻灯片第 ${o.slide} 页不存在`);
      let sxml = f.asText();
      sxml = sxml.split(escapeXml(o.from)).join(escapeXml(o.to));
      zip.file(file, sxml);
    }
  }
  const out = zip.generate({ type: "nodebuffer" });
  await writeFile(filePath, out);
  return filePath;
}
