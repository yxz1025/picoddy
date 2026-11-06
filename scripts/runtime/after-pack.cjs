const { join } = require('node:path');
const { access, readFile, cp } = require('node:fs/promises');
const { dirname, resolve } = require('node:path');
const { Arch } = require('builder-util');

// Validate the target package, not the machine doing the cross-platform build.
module.exports = async context => {
  const platform = context.electronPlatformName;
  const arch = Arch[context.arch];
  const resources = context.packager.getResourcesDir(context.appOutDir);
  if (platform === 'darwin' || platform === 'win32') {
    await require('./office-runtime.cjs').verifyOfficeRuntime(join(resources, 'office-preview'), platform, arch);
  }
  const asar = require('@electron/asar');
  const { verifyNativeDependencies } = require('../verify-native-dependencies.cjs');
  const archive = join(resources, 'app.asar');
  verifyNativeDependencies(undefined, {
    read: path => asar.extractFile(archive, path).toString('utf8'),
    access: path => asar.statFile(archive, path),
  });
  if (process.env.PICODDY_UNSIGNED_RELEASE === '1') {
    const update = JSON.parse(await readFile(join(resources, 'update-config.json'), 'utf8'));
    if (update.platform !== platform || update.arch !== arch || update.unsigned !== true || !update.feedUrl.startsWith('https://')) {
      throw new Error('UPDATE_PACKAGE_CONFIG_MISMATCH');
    }
  }
  const vendor = join(resources, 'vendor');
  const manifest = JSON.parse(await readFile(join(vendor, 'runtime-manifest.json'), 'utf8'));
  if (manifest.platform !== platform || manifest.arch !== arch || manifest.key !== `${platform}-${arch}`) {
    throw new Error(`RUNTIME_PACKAGE_ARCH_MISMATCH: expected ${platform}-${arch}, found ${manifest.key}; prepare the matching runtime before packaging`);
  }
  const { verifyPackagedRuntime } = await import('./verify-packaged-runtime.mjs');
  await verifyPackagedRuntime(vendor);
  const unpacked = join(resources, 'app.asar.unpacked', 'node_modules');
  // npm runs from the physical unpacked tree. Dependencies hoisted into ASAR
  // by electron-builder cannot be resolved from there; retain npm's bundled tree.
  const npmSource = dirname(require.resolve('npm/package.json'));
  const npmTarget = join(unpacked, 'npm');
  await cp(join(npmSource, 'node_modules'), join(npmTarget, 'node_modules'), { recursive: true });
  const { stdout } = await promisify(execFile)(process.execPath,
    [join(npmTarget, 'bin', 'npm-cli.js'), '--version'],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30_000, windowsHide: true });
  const npmManifest = JSON.parse(await readFile(join(npmSource, 'package.json'), 'utf8'));
  if (stdout.trim() !== npmManifest.version) throw new Error('RUNTIME_NPM_SMOKE_CHECK_FAILED');
  const required = [
    join(unpacked, '@esbuild', `${platform}-${arch}`, ...(platform === 'win32' ? ['esbuild.exe'] : ['bin', 'esbuild'])),
    join(unpacked, 'npm', 'bin', 'npm-cli.js'),
    join(unpacked, 'npm', 'bin', 'npx-cli.js'),
  ];
  for (const file of required) {
    await access(file).catch(() => {
      throw new Error(`RUNTIME_PACKAGE_MISSING: ${file}; install dependencies for the target platform before packaging`);
    });
  }
};
