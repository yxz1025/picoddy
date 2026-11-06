/** 在系统文件管理器中定位文件（macOS Finder / Windows 资源管理器）。非 Electron 降级为直接打开文件。 */
export function showItemInFolder(filePath: string): void {
  const api = (window as any).electronAPI;
  if (api?.showItemInFolder) {
    Promise.resolve(api.showItemInFolder(filePath)).catch((error: unknown) => {
      console.error("[file] 在文件夹中显示失败:", error);
    });
  } else {
    console.warn("[file] 当前环境不支持打开系统文件夹:", filePath);
  }
}
