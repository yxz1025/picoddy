// Run: node_modules/.bin/electron scripts/testing/office-preview-smoke.cjs
// Optional OFFICE_SMOKE_SHOW=1 displays the independent test window.
const { app, BrowserWindow, webContents } = require('electron');
const { resolve, join } = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { tmpdir } = require('node:os');
const root = resolve(__dirname, '../..');
const output = fs.mkdtempSync(join(tmpdir(), 'picoddy-office-smoke-'));
process.env.GENOFFICE_DEBUG_HOOKS = '1';
app.setPath('userData', join(output, 'profile'));
// Prove startup does not depend on the extraction directories or an old cache.
const isolatedProject = join(output, 'project');
fs.mkdirSync(isolatedProject);
fs.symlinkSync(join(root, 'vendor'), join(isolatedProject, 'vendor'), process.platform === 'win32' ? 'junction' : 'dir');
app.setAppPath(isolatedProject);
require('tsx/esm/api').register();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const timeout = setTimeout(() => { console.error('Office smoke timed out:', output); app.exit(2); }, 180_000);

app.whenReady().then(async () => {
  assert.ok(require('../runtime/office-runtime.cjs').officeTarget(process.platform, process.arch), 'Office smoke requires Mac ARM64 or Windows x64');
  const { Document, Packer, Paragraph } = require('docx');
  const Excel = require('exceljs');
  const Pptx = require('pptxgenjs');
  const JSZip = require('jszip');
  fs.writeFileSync(join(output, 'sample.docx'), await Packer.toBuffer(new Document({ sections: [{ children: [new Paragraph('Original document')] }] })));
  const wb = new Excel.Workbook(); const sheet = wb.addWorksheet('Sheet'); sheet.addRow(['Item', 'Value']); sheet.addRow(['Office', 42]);
  await wb.xlsx.writeFile(join(output, 'sample.xlsx'));
  const deck = new Pptx(); deck.addSlide().addText('Original slide', { x: 1, y: 1, w: 6, h: 1 });
  await deck.writeFile({ fileName: join(output, 'sample.pptx') });
  const preload = join(output, 'preload.cjs');
  fs.writeFileSync(preload, `const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('testOffice',{call:(name,p)=>ipcRenderer.invoke('office.'+name,p)});`);
  const owner = new BrowserWindow({ show: process.env.OFFICE_SMOKE_SHOW === '1', width: 1100, height: 800, webPreferences: { preload, contextIsolation: true } });
  const { registerOfficePreview } = await import(require('node:url').pathToFileURL(join(root, 'src/electron/office-preview.ts')).href);
  const manager = registerOfficePreview(() => owner);
  await owner.loadURL('data:text/html,<body>Office integration test</body>');
  const call = (name, payload) => owner.webContents.executeJavaScript(`window.testOffice.call(${JSON.stringify(name)},${JSON.stringify(payload)})`);
  assert.equal((await call('open', { lease: 'bad', path: 'relative.docx' })).ok, false);
  const intruder = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true } });
  await intruder.loadURL('data:text/html,<body>Untrusted window</body>');
  await assert.rejects(intruder.webContents.executeJavaScript(`window.testOffice.call('open',{path:${JSON.stringify(join(output, 'sample.docx'))},lease:'bad'})`), /不可信/);
  intruder.destroy();
  const waitReady = async lease => {
    for (let i = 0; i < 130; i++) {
      const status = await call('status', { lease });
      assert.ok(status.ok && !status.error, JSON.stringify(status));
      if (status.ready) return;
      await delay(500);
    }
    throw new Error('Office did not become ready: ' + lease);
  };
  for (const kind of ['docx', 'xlsx', 'pptx']) {
    const lease = 'test-' + kind;
    const path = join(output, 'sample.' + kind);
    const bounds = { x: 0, y: 0, width: 1080, height: 760 };
    assert.equal((await call('open', { lease, path, mode: 'edit', bounds })).ok, true);
    await call('layout', { lease, bounds, visible: true, theme: 'light' });
    await waitReady(lease);
    const moduleName = { docx: 'docs', xlsx: 'sheets', pptx: 'slides' }[kind];
    const contents = webContents.getAllWebContents().find(w => w.getURL().includes('/modules/' + moduleName + '/'));
    assert.ok(contents);
    assert.match(fs.readFileSync(require('node:url').fileURLToPath(contents.getURL()), 'utf8'), /<title>PiCoddy Office /);
    // Loaded documents replace the page title with their filename.
    assert.doesNotMatch(await contents.executeJavaScript('document.title'), /360Office/i);
    assert.doesNotMatch(await contents.executeJavaScript('document.body.innerText'), /360Office/i);
    if (kind === 'docx') {
      assert.equal(await contents.executeJavaScript(`(()=>{const e=document.querySelector('[contenteditable="true"]');e.focus();getSelection().selectAllChildren(e);document.execCommand('insertText',false,'DOCX roundtrip verified');return e.innerText;})()`), 'DOCX roundtrip verified');
    } else if (kind === 'xlsx') {
      assert.equal(await contents.executeJavaScript(`(()=>{const w=window.__genofficeDebug.univerAPI.getActiveWorkbook();w.getActiveSheet().getRange('B2').setValue(99);return true;})()`), true);
    } else {
      assert.equal(await contents.executeJavaScript(`(async()=>{const slides=await window.slidesApi.getRenderSlides();const node=slides[0].nodes.find(n=>n.text);return Boolean(await window.slidesApi.editText({slideIndex:0,sourceId:node.sourceId,paragraphs:[{runs:[{text:'PPTX roundtrip verified'}]}]}));})()`), true);
    }
    await delay(500);
    assert.equal((await call('save', { lease })).ok, true);
    assert.equal((await call('close', { lease })).closed, true);
    // Independently verify the bytes on disk, not just the editor's save ACK.
    if (kind === 'xlsx') {
      const saved = new Excel.Workbook(); await saved.xlsx.readFile(path);
      assert.equal(saved.worksheets[0].getCell('B2').value, 99);
    } else {
      const zip = await JSZip.loadAsync(fs.readFileSync(path));
      const xml = await zip.file(kind === 'docx' ? 'word/document.xml' : 'ppt/slides/slide1.xml').async('string');
      assert.ok(xml.includes(kind.toUpperCase() + ' roundtrip verified'));
    }
    assert.equal((await call('open', { lease, path, mode: 'preview', bounds })).ok, true);
    await call('layout', { lease, bounds, visible: true, theme: 'dark' });
    await waitReady(lease);
    if (process.env.OFFICE_SMOKE_SHOW === '1') {
      const reopened = webContents.getAllWebContents().find(w => w.getURL().includes('/modules/' + moduleName + '/'));
      fs.writeFileSync(join(output, kind + '.png'), (await reopened.capturePage()).toPNG());
    }
    await call('hide', { lease });
    console.log('PASS', kind, 'edit, save, verify bytes, reopen preview');
  }
  assert.ok(await manager.closeAll());
  clearTimeout(timeout);
  console.log('Office smoke passed. Temporary artifacts:', output);
  app.exit(0);
}).catch(error => { console.error(error); console.error('Artifacts:', output); app.exit(1); });
