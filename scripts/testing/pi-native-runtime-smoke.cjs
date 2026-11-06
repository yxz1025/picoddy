const { mkdtemp, rm, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { pathToFileURL } = require('node:url');
(async () => {
 const appRoot = process.argv[2];
 const pkg = name => pathToFileURL(join(appRoot,'node_modules','@earendil-works',name,'dist/index.js')).href;
 const sdk = await import(pkg('pi-coding-agent'));
 const ai = await import(pkg('pi-ai'));
 const root = await mkdtemp(join(tmpdir(),'pi-package-smoke-'));
 try {
  const faux = ai.fauxProvider();
  const runtime = await sdk.ModelRuntime.create({ authPath: join(root,'auth.json'), modelsPath:null });
  runtime.registerNativeProvider(faux.provider);
  const settings = sdk.SettingsManager.inMemory({ compaction:{enabled:false},retry:{enabled:false} });
  const loader = new sdk.DefaultResourceLoader({cwd:root,agentDir:root,settingsManager:settings,extensionFactories:[sdk.createCodemodeExtension({mode:"on",models:false}),sdk.createToolSearchExtension()],noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});
  await loader.reload();
  const { session } = await sdk.createAgentSession({cwd:root,agentDir:root,modelRuntime:runtime,model:faux.getModel(),settingsManager:settings,resourceLoader:loader,sessionManager:sdk.SessionManager.inMemory(root),tools:["read","codemode","tool_search"]});
  await session.bindExtensions({mode:'rpc'});
  if (!session.getAllTools().some(tool => tool.name === 'tool_search')) throw Error('packaged tool_search not registered');
  await readFile(join(appRoot,'node_modules/@earendil-works/pi-coding-agent/docs/codemode.md'));
  const imagePath = join(appRoot,'resources/app-icon.iconset/icon_16x16.png');
  const image = await sdk.createReadTool(root).execute('read-image',{path:imagePath});
  if(!image.content.some(c=>c.type==='image')) throw Error('packaged image reader failed');
  let seenImage=false;
  faux.setResponses([ctx=>{seenImage=JSON.stringify(ctx.messages).includes('image/png');return ai.fauxAssistantMessage('packaged-native-ok')}]);
  await session.prompt('Verify packaged runtime',{images:image.content.filter(c=>c.type==='image')});
  faux.setResponses([ai.fauxAssistantMessage([ai.fauxToolCall('codemode',{code:'const result = await tools.read({path:'+JSON.stringify(imagePath)+'}); image(result); text(6*7);'})],{stopReason:'toolUse'}),ai.fauxAssistantMessage('codemode-ok')]);
  await session.prompt('Verify packaged codemode worker');
  const script = session.messages.find(m=>m.role==='toolResult'&&m.toolName==='codemode');
  if(!script || script.isError || !JSON.stringify(script.content).includes('42') || !script.content.some(c=>c.type==='image')) throw Error('packaged codemode failed: '+JSON.stringify(script));
  await session.extensionRunner.emit({type:'session_shutdown',reason:'quit'});
  session.dispose();
  if(!seenImage) throw Error('packaged image pipeline lost image');
  console.log(JSON.stringify({ok:true,node:process.versions.node,electron:process.versions.electron,pi:sdk.VERSION,image:true,session:true,codemode:true,toolSearchRegistered:true}));
 } finally {await rm(root,{recursive:true,force:true})}
})().catch(e=>{console.error(e);process.exitCode=1});
