const { resolve } = require('node:path');

// Runs for every electron-builder entry point, including direct CLI and release builds.
module.exports = async context => {
  const root = resolve(__dirname, '..');
  const { Arch } = require('builder-util');
  const platform = context.electronPlatformName;
  const arch = Arch[context.arch];
  await require('./runtime/office-runtime.cjs').prepareOfficeRuntime({
    projectRoot: root, destination: resolve(root, 'build', 'office-staging', `${platform}-${arch}`), platform, arch,
  });
};
