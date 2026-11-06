// Shared by the desktop host and build hooks. Never select by the build host OS.
const { join } = require('node:path');
const { mkdir, cp, writeFile, readFile, access, chmod, rm } = require('node:fs/promises');
const VERSION = '3.29.0';
const REVISION = 5;
function officeTarget(platform, arch) {
  if (platform === 'darwin' && arch === 'arm64') return { platform, arch, sidecar: 'xlsx-sidecar', nativeDirectory: 'darwin-arm64' };
  if (platform === 'win32' && arch === 'x64') return { platform, arch, sidecar: 'xlsx-sidecar.exe', nativeDirectory: 'win32-x64' };
  return null;
}
function validateBinary(bytes, platform) {
  if (platform === 'win32') {
    const offset = bytes.length >= 64 ? bytes.readUInt32LE(60) : -1;
    if (bytes.toString('ascii',0,2) === 'MZ' && offset >= 64 && offset + 6 <= bytes.length && bytes.toString('ascii',offset,offset+4) === 'PE\0\0' && bytes.readUInt16LE(offset+4) === 0x8664) return;
  } else if (platform === 'darwin' && bytes.length >= 8 && bytes.readUInt32LE(0) === 0xfeedfacf && bytes.readUInt32LE(4) === 0x0100000c) return;
  throw new Error('Office 原生程序架构不匹配 (architecture mismatch)');
}
async function verifyOfficeRuntime(root, platform, arch) {
  const target = officeTarget(platform, arch);
  const manifest = JSON.parse(await readFile(join(root,'office-runtime.json'),'utf8'));
  if (manifest.platform !== platform || manifest.arch !== arch || manifest.version !== VERSION || manifest.revision !== REVISION || manifest.supported !== Boolean(target)) throw new Error('Office runtime target manifest mismatch');
  if (!target) return;
  await access(join(root,'runtime','index.js'));
  validateBinary(await readFile(join(root,'native',target.sidecar)), platform);
}
async function prepareOfficeRuntime({ projectRoot, destination, platform, arch, reuse = false }) {
  if (reuse) {
    try { await verifyOfficeRuntime(destination,platform,arch); return destination; } catch { /* stale/incomplete cache */ }
  }
  const target = officeTarget(platform,arch);
  // Destination is a dedicated generated runtime directory, never the source bundle.
  const common = join(projectRoot,'vendor','office','common');
  let binary;
  if (target) {
    binary = join(projectRoot,'vendor','office','native',target.nativeDirectory,target.sidecar);
    validateBinary(await readFile(binary),platform);
    await access(join(common,'runtime','index.js'));
  }
  await rm(destination,{recursive:true,force:true});
  await mkdir(destination,{recursive:true});
  if (target) {
    await cp(common,destination,{recursive:true});
    await mkdir(join(destination,'native'),{recursive:true});
    await cp(binary,join(destination,'native',target.sidecar));
    if (platform === 'darwin') await chmod(join(destination,'native',target.sidecar),0o755);
    await writeFile(join(destination,'package.json'),'{"type":"commonjs"}\n');
  }
  await writeFile(join(destination,'office-runtime.json'),JSON.stringify({version:VERSION,revision:REVISION,platform,arch,supported:Boolean(target)},null,2)+'\n');
  await verifyOfficeRuntime(destination,platform,arch);
  return destination;
}
module.exports = { officeTarget, prepareOfficeRuntime, verifyOfficeRuntime, VERSION };
