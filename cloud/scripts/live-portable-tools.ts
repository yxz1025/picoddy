// Disposable sandbox fixtures only; no account or enterprise data writes.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { createSandbox, reconcileRunSandboxes } from '../src/platform/sandbox.ts';
import { runPortableOperation } from '../src/platform/portable-operations.ts';
const config = loadConfig(), id = randomUUID(), signal = AbortSignal.timeout(180000);
let sandbox;
try {
 sandbox = await createSandbox(config,id,signal);
 await sandbox.write('/workspace/.fixture.py',Buffer.from(`
import sys,json,pathlib,hashlib
sys.path.insert(0,'/opt/picoddy/runtime')
from documents import write_document,read_document
for op,args in [
 ('write_docx',{'fileName':'a.docx','sections':[{'paragraphs':['hello {{name}}','old paragraph']}]}),
 ('write_xlsx',{'fileName':'a.xlsx','sheets':[{'name':'Sheet','rows':[[1,2]]}]}),
 ('write_pptx',{'fileName':'a.pptx','slides':[{'title':'hello','body':'old text','bullets':['bullet']}]}),
]:
 result=write_document(op,args); assert pathlib.Path(result['path']).stat().st_size>0
 assert read_document({'path':result['path']})['text']
original=pathlib.Path('/workspace/output/a.xlsx').read_bytes()
try: write_document('write_xlsx',{'fileName':'a.xlsx','sheets':[{'name':'Sheet','rows':[[object()]]}]})
except Exception: pass
else: raise Exception('Expected invalid workbook failure')
assert pathlib.Path('/workspace/output/a.xlsx').read_bytes()==original
print('generation/read/atomic-failure=passed')
`));
 let execution = await sandbox.exec('python /workspace/.fixture.py',signal);
 assert.equal(execution.exitCode,0,execution.stderr); console.log(execution.stdout.trim());
 const edit = (operation:string,args:object) => runPortableOperation(sandbox!,{kind:'document_edit',operation,arguments:args},signal);
 const doc = await edit('edit_docx',{path:'/workspace/output/a.docx',vars:{name:'cloud'}});
 assert.ok(doc.backupPath.includes('/.document-versions/')); assert.equal(doc.version,1);
 await edit('edit_docx_free',{path:doc.path,ops:[{op:'replace_text',from:'hello',to:'welcome'},{op:'insert_paragraph',afterMatch:'welcome',text:'inserted'},{op:'delete_paragraph',match:'old paragraph'}]});
 await edit('edit_xlsx',{path:'/workspace/output/a.xlsx',changes:[{op:'set_cell',sheet:'Sheet',cell:'A1',value:5},{op:'set_cell',sheet:'Sheet',cell:'C1',formula:'A1+B1',value:7},{op:'add_row',sheet:'Sheet',row:[3,4]},{op:'add_sheet',name:'Added'}]});
 await edit('edit_pptx',{path:'/workspace/output/a.pptx',ops:[{op:'replace_text',slide:1,from:'old text',to:'new text'}]});
 const before = await sandbox.read('/workspace/output/a.xlsx');
 await assert.rejects(edit('edit_xlsx',{path:'/workspace/output/a.xlsx',changes:[{op:'set_cell',sheet:'missing',cell:'A1',value:1}]}));
 assert.deepEqual(await sandbox.read('/workspace/output/a.xlsx'),before);
 await sandbox.exec('mkdir -p /workspace/input; cp /workspace/output/a.docx /workspace/input/input.docx; ln -s /etc/passwd /workspace/output/outside.docx',signal);
 const input = await sandbox.read('/workspace/input/input.docx');
 const copied = await edit('edit_docx_free',{path:'/workspace/input/input.docx',ops:[{op:'replace_text',from:'welcome',to:'copied'}]});
 assert.equal(copied.path,'/workspace/output/input.docx'); assert.deepEqual(await sandbox.read('/workspace/input/input.docx'),input);
 await assert.rejects(edit('edit_docx_free',{path:'/workspace/output/outside.docx',ops:[]}));
 const targetBefore = await sandbox.read('/workspace/output/a.docx');
 const overwrite = await edit('edit_docx_free',{path:'/workspace/input/input.docx',outFileName:'a.docx',ops:[]});
 assert.deepEqual(await sandbox.read(overwrite.backupPath),targetBefore);
 await sandbox.write('/workspace/.verify.py',Buffer.from(`
from openpyxl import load_workbook
from docx import Document
from pptx import Presentation
book=load_workbook('/workspace/output/a.xlsx');assert book['Sheet']['A1'].value==5;assert book['Sheet']['C1'].value=='=A1+B1';assert 'Added' in book.sheetnames
text='\\n'.join(p.text for p in Document('/workspace/output/a.docx').paragraphs);assert 'welcome cloud' in text;assert 'inserted' in text;assert 'old paragraph' not in text
text='\\n'.join(s.text for s in Presentation('/workspace/output/a.pptx').slides[0].shapes if s.has_text_frame);assert 'new text' in text;assert 'bullet' in text
print('office4-edit/backups/readonly-input/symlink/atomic-failure=passed')
`));
 execution = await sandbox.exec('python /workspace/.verify.py',signal); assert.equal(execution.exitCode,0,execution.stderr); console.log(execution.stdout.trim());
 await sandbox.write('/workspace/.web-test.mjs',Buffer.from(`
import assert from 'node:assert/strict';
import { executePortableRequest } from '/opt/picoddy/runtime/portable-runner.mjs';
await assert.rejects(executePortableRequest({kind:'filez',method:'json',args:[]}));
console.log('excluded-netdisk=passed');
`));
 execution = await sandbox.exec('node /workspace/.web-test.mjs',signal); assert.equal(execution.exitCode,0,execution.stderr); console.log(execution.stdout.trim());
} finally {try {await sandbox?.destroy();} finally {await reconcileRunSandboxes(config,id);}}
console.log('portable sandbox fixtures passed; cleanup complete');
