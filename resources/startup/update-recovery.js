const api = window.electronAPI.updates;
for (const [id, action] of Object.entries({ logs: () => api.openLogs(), restore: () => api.restoreBackup(), retry: () => api.retryBoot() })) {
  document.getElementById(id).addEventListener("click", async () => {
    const button = document.getElementById(id); button.disabled = true;
    try { await action(); } catch { document.getElementById("message").textContent = "操作未完成。请查看更新记录，或联系管理员提供修复安装包。"; }
    finally { button.disabled = false; }
  });
}
