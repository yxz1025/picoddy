interface Contents { isDestroyed(): boolean; readonly mainFrame: unknown }
interface MainWindow { isDestroyed(): boolean; readonly webContents: Contents }

export function createTrustedMainWindowGuard(getWindow: () => MainWindow | null) {
  return (event: {sender: unknown; senderFrame: unknown}) => {
    const window = getWindow();
    if (!window || window.isDestroyed()) throw new Error("不可信的 TAPD 调用来源");
    const contents = window.webContents;
    if (contents.isDestroyed() || event.sender !== contents || event.senderFrame !== contents.mainFrame) {
      throw new Error("不可信的 TAPD 调用来源");
    }
  };
}
