import { randomUUID } from 'node:crypto';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { CloudSandbox } from '../../platform/sandbox.ts';
import type { Run } from '../../cloud/runs/types.ts';
import { assertLease } from '../../cloud/runs/events.ts';
import { runPortableOperation } from '../../platform/portable-operations.ts';
import {readDocSchema,writeDocxSchema,writeXlsxSchema,writePptxSchema,editDocxSchema,editDocxFreeSchema,editXlsxSchema,editPptxSchema} from './document-schemas.ts';

export function documentTools(run: Run, sandbox: CloudSandbox): AgentTool<any>[] {
  const invoke = (operation: string) => async (_id: string,args: any,signal?:AbortSignal) => {
    signal?.throwIfAborted(); await assertLease(run);
    const path=`/workspace/.document-${randomUUID()}.json`;
    const request = Buffer.from(JSON.stringify({operation,arguments:args}));
    if (request.length > 1024*1024) throw new Error('TOOL_REQUEST_TOO_LARGE');
    await sandbox.write(path,request);
    const result=await sandbox.exec(`python /opt/picoddy/runtime/documents.py ${path}`,signal);
    if (result.exitCode !== 0) throw new Error('文档处理失败，请检查参数、文件类型和工作目录路径');
    const details = JSON.parse(result.stdout);
    return {content:[{type:'text' as const,text:operation === 'read_doc' ? details.text : `已生成文档：${details.path}`}],details,isError:false};
  };
  const edit = (operation: string) => async (_id: string, args: any, signal?: AbortSignal) => {
    signal?.throwIfAborted(); await assertLease(run);
    const details = await runPortableOperation(sandbox, { kind: 'document_edit', operation, arguments: args }, signal);
    return { content: [{ type: 'text' as const, text: `已编辑文档：${details.path}（原文件备份 v${details.version}）` }], details };
  };
  return [
    { name: 'read_doc', label: '读文档', description: '读取 /workspace 中的 DOCX/XLSX/PPTX/PDF/CSV/文本，支持字符分页；扫描 PDF 需要另行 OCR。', parameters: readDocSchema, execute: invoke('read_doc') },
    { name: 'write_docx', label: '生成 Word', description: '按 sections 生成 /workspace/output 中的 Word，可选 title；使用 present_files 发布。', parameters: writeDocxSchema, execute: invoke('write_docx') },
    { name: 'write_xlsx', label: '生成 Excel', description: '按非空 sheets 生成 /workspace/output 中的 Excel；每张 sheet 需 name 和 rows，可选 headers。', parameters: writeXlsxSchema, execute: invoke('write_xlsx') },
    { name: 'write_pptx', label: '生成 PowerPoint', description: '按 slides 生成 /workspace/output 中的 PPT，支持 title/body/bullets；使用 present_files 发布。', parameters: writePptxSchema, execute: invoke('write_pptx') },
    { name: 'edit_docx', label: '编辑 Word', description: '用 vars 填充 Word 的 {{key}} 模板，支持循环模板；可指定 outFileName。原地修改前自动备份；输入文件会输出新副本。', parameters: editDocxSchema, execute: edit('edit_docx') },
    { name: 'edit_docx_free', label: '自由编辑 Word', description: '保留样式，替换文本、插入或删除匹配段落；修改前自动备份。', parameters: editDocxFreeSchema, execute: edit('edit_docx_free') },
    { name: 'edit_xlsx', label: '编辑 Excel', description: '修改单元格及公式、追加行、新增 sheet；保留已有格式，修改前备份。', parameters: editXlsxSchema, execute: edit('edit_xlsx') },
    { name: 'edit_pptx', label: '编辑 PPT', description: '按页码替换 PPT 文本并保留版式；修改前自动备份。', parameters: editPptxSchema, execute: edit('edit_pptx') },
  ];
}
