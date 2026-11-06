import ExcelJS from 'exceljs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const testCaseHeaders = ['用例目录', '用例标题', '等级', '前置条件', '步骤描述类型', '步骤描述', '预期结果', '标签', '关联需求', '评估工时', '执行次数'] as const;
export type TestCase = Record<(typeof testCaseHeaders)[number], string | number>;

function numbered(value: string): number[] {
  const lines = value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  return lines.map((line, index) => {
    const match = /^(\d+)、\s*\S/.exec(line);
    if (!match || Number(match[1]) !== index + 1) throw new Error('步骤和预期结果须从 1、开始连续编号');
    return Number(match[1]);
  });
}

export function validateTestCase(input: TestCase, requirementUrl?: string): void {
  for (const header of testCaseHeaders) {
    const value = input[header];
    if (value !== undefined && typeof value !== 'string' && typeof value !== 'number') throw new Error(`字段必须为文本或数值：${header}`);
  }
  const value = (key: (typeof testCaseHeaders)[number]) => String(input[key] ?? '').trim();
  if (!value('用例标题')) throw new Error('用例标题不能为空');
  if (!/^P[0-3]$/.test(value('等级'))) throw new Error('等级必须为 P0/P1/P2/P3');
  const directory = value('用例目录');
  if (directory && (directory.split('/').length > 10 || directory.split('/').some(part => !part.trim()))) throw new Error('用例目录须为最多 10 层的非空目录');
  if (!['步骤', '文本'].includes(value('步骤描述类型'))) throw new Error('步骤描述类型必须为步骤或文本');
  if (!value('步骤描述') || !value('预期结果')) throw new Error('步骤描述和预期结果不能为空');
  if (value('步骤描述类型') === '步骤') {
    if (numbered(value('步骤描述')).length !== numbered(value('预期结果')).length) throw new Error('步骤和预期结果必须逐项对应');
  }
  if (value('标签').includes(',') || value('标签').includes(';')) throw new Error('多个标签须使用中文逗号分隔');
  const urls = value('关联需求').split(';').filter(Boolean);
  for (const url of urls) {
    try { if (!['http:', 'https:'].includes(new URL(url).protocol)) throw new Error(); }
    catch { throw new Error('关联需求须为英文分号分隔的有效 URL'); }
  }
  if (requirementUrl && !urls.includes(requirementUrl)) throw new Error('用例必须关联当前需求 URL');
  for (const key of ['评估工时', '执行次数'] as const) {
    if (value(key) && (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || Number(input[key]) < 0)) throw new Error(`${key}须为非负数值或留空`);
  }
  if (value('执行次数') && !Number.isInteger(input['执行次数'])) throw new Error('执行次数须为整数');
}

export async function validateTestCaseWorkbook(bytes: Uint8Array, requirementUrl?: string): Promise<number> {
  return (await readTestCaseWorkbook(bytes, requirementUrl)).length;
}

export async function readTestCaseWorkbook(bytes: Uint8Array, requirementUrl?: string): Promise<TestCase[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.columnCount !== testCaseHeaders.length) throw new Error('测试用例必须为模板固定的 11 列');
  for (const [index, header] of testCaseHeaders.entries()) if (sheet.getCell(1, index + 1).value !== header) throw new Error('测试用例表头顺序与模板不一致');
  const records: TestCase[] = [];
  sheet.eachRow((row, index) => {
    if (index === 1 || !row.hasValues) return;
    const record = {} as TestCase;
    for (const [column, header] of testCaseHeaders.entries()) {
      const value = row.getCell(column + 1).value;
      if (value !== null && typeof value !== 'string' && typeof value !== 'number') throw new Error(`用例字段不能含公式或复杂对象：第 ${index} 行 ${header}`);
      record[header] = value ?? '';
    }
    try { validateTestCase(record, requirementUrl); }
    catch (error) { throw new Error(`第 ${index} 行：${(error as Error).message}`); }
    records.push(record);
  });
  if (!records.length) throw new Error('测试用例不能为空');
  return records;
}

export async function generateTestCaseWorkbook(template: string, output: string, cases: TestCase[], requirementUrl: string): Promise<number> {
  if (!Array.isArray(cases) || !cases.length || !requirementUrl) throw new Error('须提供真实用例和当前需求 URL');
  cases.forEach(record => validateTestCase(record, requirementUrl));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(template);
  const sheet = workbook.worksheets[0];
  for (const [index, header] of testCaseHeaders.entries()) if (sheet.getCell(1, index + 1).value !== header) throw new Error('源模板表头不匹配');
  const styles = testCaseHeaders.map((_, index) => structuredClone(sheet.getCell(2, index + 1).style));
  sheet.spliceRows(2, Math.max(0, sheet.rowCount - 1));
  sheet.columns.forEach((column, index) => { column.width = [30, 48, 10, 45, 18, 60, 60, 30, 60, 14, 14][index]; });
  cases.forEach((record, index) => {
    const row = sheet.getRow(index + 2);
    testCaseHeaders.forEach((header, column) => {
      const cell = row.getCell(column + 1);
      cell.value = record[header] ?? '';
      cell.style = structuredClone(styles[column]);
      cell.alignment = { ...cell.alignment, vertical: 'top', wrapText: true };
    });
    row.getCell(3).dataValidation = { type: 'list', allowBlank: false, formulae: ['"P0,P1,P2,P3"'] };
    row.getCell(5).dataValidation = { type: 'list', allowBlank: false, formulae: ['"步骤,文本"'] };
    row.getCell(10).numFmt = '0.0';
    row.height = Math.min(300, Math.max(60, ...['前置条件', '步骤描述', '预期结果'].map(key => String(record[key as keyof TestCase] ?? '').split('\n').length * 20)));
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  await mkdir(dirname(output), { recursive: true });
  await workbook.xlsx.writeFile(output);
  return validateTestCaseWorkbook(await readFile(output), requirementUrl);
}
