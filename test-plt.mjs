const { app, BrowserWindow } = await import("electron");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const root = fileURLToPath(new URL(".", import.meta.url));

app.whenReady().then(async () => {
  const preloadPath = join(root, "src", "electron", "preload.cjs");
  console.log("Preload path:", preloadPath);

  const win = new BrowserWindow({
    width: 400, height: 300,
    webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false },
  });
  await win.loadURL("data:text/html,<script>window.__check=()=>!!window.electronAPI</script>");
  await new Promise(r => setTimeout(r, 1000));
  try {
    const has = await win.webContents.executeJavaScript("window.__check()");
    console.log("electronAPI exists:", has);
    if (has) {
      const keys = await win.webContents.executeJavaScript("Object.keys(window.electronAPI).slice(0,10)");
      console.log("Keys:", keys);
    }
  } catch(e) { console.log("Error:", e.message); }
  app.quit();
});
