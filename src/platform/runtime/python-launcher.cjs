// Runs in Electron's Node mode. Bootstrap only when a Python command is invoked.
const { join, resolve } = require('node:path');
const { spawn } = require('node:child_process');

exports.run = async (config, args) => {
  const projectRoot = resolve(__dirname, '../../..');
  // This child does not execute main.mjs, so configure the unpacked compiler here.
  if (config.isPackaged) {
    process.env.ESBUILD_BINARY_PATH = join(config.resourcesPath, 'app.asar.unpacked',
      'node_modules', '@esbuild', `${process.platform}-${process.arch}`,
      ...(process.platform === 'win32' ? ['esbuild.exe'] : ['bin', 'esbuild']));
  }
  require(join(projectRoot, 'node_modules/tsx/dist/cjs/index.cjs'));
  const { createManagedRuntimeService } = require('./index.ts');
  const service = createManagedRuntimeService(config);
  const python = await service.resolvePython();
  const child = spawn(python.executable, args, {
    stdio: 'inherit', env: python.env, windowsHide: true,
  });
  const forward = signal => { if (!child.killed) child.kill(signal); };
  const interrupt = () => forward('SIGINT');
  const terminate = () => forward('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 143);
      resolveExit();
    });
  }).finally(() => {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
  });
};
