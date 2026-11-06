// src/domains/doc/node/reader.ts
// 文档读取引擎。对照 04 文档 §四：read_doc 工具的实现层。
// 支持: txt/md/json/csv(纯文本) + docx(mammoth) + xlsx(exceljs) + pptx(pizzip) + pdf(pdfjs-dist)

import Pizzip from "pizzip";
import { readFile, stat } from "node:fs/promises";

import { startOperation } from "../../../infra/operation_log.ts";


const MAX_CHARS = 50_000;

export interface ReadResult {
  kind: string; // text|markdown|json|csv|docx|xlsx|pptx|error
  text: string;
  truncated: boolean;
  tables?: string[][]; // 表格类文档的结构化数据（xlsx/csv）
}

function memoryUsageMetadata(): Record<string, number> {
  const memory = process.memoryUsage();
  return {
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    heapTotalBytes: memory.heapTotal,
    externalBytes: memory.external,
  };
}

async function sourceSize(path: string): Promise<number | undefined> {
  return await stat(path).then((info) => info.size).catch(() => undefined);
}

/** 统一读取入口：按扩展名路由 */
export async function readDoc(path: string): Promise<ReadResult> {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const operation = startOperation("document.read", {
    format: ext || "unknown",
    sourceBytes: await sourceSize(path),
    memory: memoryUsageMetadata(),
  });

  try {
    let result: ReadResult;
    switch (ext) {
      case "txt":
        result = await readText(path, "text");
        break;
      case "md":
      case "markdown":
        result = await readText(path, "markdown");
        break;
      case "json":
        result = await readText(path, "json");
        break;
      case "csv":
        result = await readCsv(path);
        break;
      case "docx":
        result = await readDocx(path);
        break;
      case "xlsx":
        result = await readXlsx(path);
        break;
      case "pptx":
        result = await readPptx(path);
        break;
      case "pdf":
        result = await readPdf(path);
        break;
      default:
        // 未知扩展名尝试当文本读
        result = await readText(path, "text");
    }
    operation.success({
      kind: result.kind,
      extractedChars: result.text.length,
      truncated: result.truncated,
      memory: memoryUsageMetadata(),
    });
    return result;
  } catch (e) {
    operation.error(e, { memory: memoryUsageMetadata() });
    const msg = e instanceof Error ? e.message : String(e);
    return { kind: "error", text: `读取失败 (${ext}): ${msg}`, truncated: false };
  }
}

async function readText(path: string, kind: string): Promise<ReadResult> {
  const raw = await readFile(path, "utf-8");
  return truncate(raw, kind);
}

function truncate(raw: string, kind: string): ReadResult {
  const truncated = raw.length > MAX_CHARS;
  const text = truncated ? raw.slice(0, MAX_CHARS) + "\n...[已截断]" : raw;
  return { kind, text, truncated };
}

/** CSV：解析成表格，也返回纯文本表示 */
async function readCsv(path: string): Promise<ReadResult> {
  const raw = await readFile(path, "utf-8");
  const tables = parseCsv(raw);
  const text = tables.map((row) => row.join("\t")).join("\n");
  const r = truncate(text, "csv");
  return { ...r, tables: tables.slice(0, 100) }; // 限 100 行
}

function parseCsv(text: string): string[][] {
  // 简易 CSV 解析（支持逗号分隔，带引号）。生产可换 papaparse
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else inQuotes = false;
      } else cell += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((x) => x !== "")) rows.push(row);
        row = [];
      } else cell += c;
    }
  }
  if (cell !== "" || row.length > 0) { row.push(cell); rows.push(row); }
  return rows;
}

/** docx：mammoth 转 HTML，再剥成纯文本 */
async function readDocx(path: string): Promise<ReadResult> {
  const mammothMod = await import("mammoth");
  const mammoth = (mammothMod as any).default || mammothMod;
  // @ts-ignore
  const result = await mammoth.extractRawText({ path });
  return truncate(result.value || "(空文档)", "docx");
}

/** xlsx：exceljs 读所有 sheet，转成 markdown 表格文本 */
async function readXlsx(path: string): Promise<ReadResult> {
  const operation = startOperation("document.read.xlsx", {
    memory: memoryUsageMetadata(),
  });
  let stage = "read-file";
  let sheetCount = 0;
  let rowCount = 0;
  let cellCount = 0;
  try {
    const excelMod = await import("exceljs");
    const ExcelJS = (excelMod as any).default || excelMod;
    const buf = await readFile(path);
    stage = "workbook-load";
    // @ts-ignore exceljs 在 Deno 的类型不完全匹配
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buf as any);
    stage = "worksheet-enumeration";

    const parts: string[] = [];
    const allTables: string[][] = [];

    workbook.eachSheet((sheet: any) => {
      sheetCount += 1;
      parts.push(`## ${sheet.name}`);
      const rows: string[][] = [];
      sheet.eachRow({ includeEmpty: false }, (row: any) => {
        rowCount += 1;
        const vals = row.values as any[];
        // exceljs 的 values 数组从 index 1 开始
        const cells = (vals.slice(1) || []).map((v) => v?.toString?.() ?? "");
        cellCount += cells.length;
        rows.push(cells);
        parts.push("| " + cells.join(" | ") + " |");
      });
      parts.push("");
      allTables.push(...rows.slice(0, 50));
    });

    stage = "text-assembly";
    const result = truncate(parts.join("\n"), "xlsx");
    operation.success({
      sheetCount,
      rowCount,
      cellCount,
      extractedChars: result.text.length,
      truncated: result.truncated,
      memory: memoryUsageMetadata(),
    });
    return result;
  } catch (error) {
    operation.error(error, {
      stage,
      sheetCount,
      rowCount,
      cellCount,
      memory: memoryUsageMetadata(),
    });
    throw error;
  }
}

/** pptx：用 Pizzip 解压并扫描 ppt/slides/slide*.xml，提取 <a:t> 标签生成幻灯片文字大纲 */
async function readPptx(path: string): Promise<ReadResult> {
  const buf = await readFile(path);
  // @ts-ignore
  const zip = new Pizzip(buf);
  const slideFiles: string[] = [];

  for (const filename of Object.keys(zip.files)) {
    if (filename.startsWith("ppt/slides/slide") && filename.endsWith(".xml")) {
      slideFiles.push(filename);
    }
  }

  slideFiles.sort((a, b) => {
    const numA = parseInt(a.replace(/[^0-9]/g, ""));
    const numB = parseInt(b.replace(/[^0-9]/g, ""));
    return numA - numB;
  });

  const outline: string[] = [];
  for (let i = 0; i < slideFiles.length; i++) {
    const slideFile = slideFiles[i];
    const xmlText = zip.files[slideFile].asText();
    // 简易正则匹配 <a:t> 文本内容
    const matches = xmlText.match(/<a:t>([\s\S]*?)<\/a:t>/g) || [];
    const slideText = matches.map((m) => m.replace(/<\/?a:t>/g, "")).join(" ");
    if (slideText.trim()) {
      outline.push(`## Slide ${i + 1}\n${slideText.trim()}`);
    }
  }

  const resultText = outline.length > 0 ? outline.join("\n\n") : "(空幻灯片文档)";
  return truncate(resultText, "pptx");
}

/** PDF：pdfjs-dist 提取文本 */
async function readPdf(path: string): Promise<ReadResult> {
  const pdfjs: any = await import("pdfjs-dist/legacy/build/pdf.mjs");
  // Deno 不会像 Node 一样为 pdfjs 推导 fake worker 的模块位置。
  if (pdfjs.GlobalWorkerOptions) {
    pdfjs.GlobalWorkerOptions.workerSrc = "./pdf.worker.mjs";
  }
  const data = new Uint8Array(await readFile(path));
  const doc = await pdfjs.getDocument({ data, useWorker: false, isEvalSupported: false }).promise;
  const pages: string[] = [];
  const maxPages = Math.min(doc.numPages, 50); // 最多读 50 页
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item: any) => item.str || "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text) pages.push(`--- 第 ${i} 页 ---\n${text}`);
  }
  await doc.destroy();
  return truncate(pages.join("\n\n") || "(空 PDF)", "pdf");
}
