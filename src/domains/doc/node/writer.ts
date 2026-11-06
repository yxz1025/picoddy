// src/domains/doc/node/writer.ts
// 文档创建引擎。对照 04 文档 §四：write_docx/write_xlsx/write_pptx 工具的实现层。
// agent 输出结构化 JSON，由本模块渲染成文档（不让模型直接吐 OOXML）。

import { ensureArtifactsDir, artifactPath } from "./paths.ts";
import { writeFile } from "node:fs/promises";


// ===== 通用类型 =====
export interface DocxSection {
  heading?: string;
  paragraphs?: string[];
  bullets?: string[];
}

export interface XlsxSheet {
  name: string;
  headers?: string[];
  rows: (string | number | null)[][];
}

export interface PptxSlide {
  title?: string;
  body?: string;
  bullets?: string[];
}

// ===== docx 创建 =====
export async function writeDocx(
  title: string | undefined,
  sections: DocxSection[],
  fileName: string,
): Promise<string> {
  const { Document, Packer, Paragraph, HeadingLevel, TextRun } = await import("docx");
  const doc = new Document({
    sections: [{
      children: [
        ...(title ? [new Paragraph({ text: title, heading: HeadingLevel.TITLE })] : []),
        ...sections.flatMap((s) => {
          const parts: any[] = [];
          if (s.heading) parts.push(new Paragraph({ text: s.heading, heading: HeadingLevel.HEADING_1 }));
          for (const p of s.paragraphs ?? []) parts.push(new Paragraph({ children: [new TextRun(p)] }));
          for (const b of s.bullets ?? []) parts.push(new Paragraph({ text: b, bullet: { level: 0 } }));
          return parts;
        }),
      ],
    }],
  });
  const buf = await Packer.toBuffer(doc);
  const fullPath = artifactPath(fileName);
  await ensureArtifactsDir();
  await writeFile(fullPath, buf);
  return fullPath;
}

// ===== xlsx 创建 =====
export async function writeXlsx(sheets: XlsxSheet[], fileName: string): Promise<string> {
  const excelMod = await import("exceljs");
  const ExcelJS = (excelMod as any).default || excelMod;
  // @ts-ignore
  const workbook = new ExcelJS.Workbook();
  for (const s of sheets) {
    const sheet = workbook.addWorksheet(s.name);
    if (s.headers && s.headers.length > 0) {
      sheet.addRow(s.headers);
      // 表头加粗
      sheet.getRow(1).font = { bold: true };
    }
    for (const row of s.rows) sheet.addRow(row);
    sheet.columns.forEach((col: any) => { col.width = 18; });
  }
  const fullPath = artifactPath(fileName);
  await ensureArtifactsDir();
  const buf = await workbook.xlsx.writeBuffer();
  await writeFile(fullPath, new Uint8Array(buf as any));
  return fullPath;
}

// ===== pptx 创建 =====
export async function writePptx(slides: PptxSlide[], fileName: string): Promise<string> {
  const pptxgen = (await import("pptxgenjs")).default;
  // @ts-ignore pptxgenjs 在 Deno 的构造签名类型不匹配
  const pptx = new pptxgen();
  for (const s of slides) {
    const slide = pptx.addSlide();
    if (s.title) slide.addText(s.title, { x: 0.5, y: 0.3, w: 9, h: 0.8, fontSize: 28, bold: true });
    if (s.bullets && s.bullets.length > 0) {
      slide.addText(
        s.bullets.map((b, i) => ({ text: b, options: { bullet: true, breakLine: true } })),
        { x: 0.5, y: 1.5, w: 9, h: 4, fontSize: 18 },
      );
    } else if (s.body) {
      slide.addText(s.body, { x: 0.5, y: 1.5, w: 9, h: 4, fontSize: 18 });
    }
  }
  const fullPath = artifactPath(fileName);
  await ensureArtifactsDir();
  await pptx.writeFile({ fileName: fullPath });
  return fullPath;
}
