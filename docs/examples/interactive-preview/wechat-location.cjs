let app;
exports.setup = async ({ miniProgram }) => {
  app = miniProgram;
  await miniProgram.mockWxMethod('chooseLocation', {
    name: '演示地址', address: '仅用于设计评审', latitude: 30.2741, longitude: 120.1551,
  });
};
exports.cleanup = async () => {
  if (app) await app.restoreWxMethod('chooseLocation');
};
