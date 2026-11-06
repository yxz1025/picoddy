/**
 * 内置浏览器管理器 — 使用 Electron WebContentsView（官方推荐，替代已废弃的 webview 标签）。
 * 参考 agent-1.0.24 / docs/14-浏览器与文件预览实现参考.md
 */

import { WebContentsView, BrowserWindow } from "electron";

export interface BrowserStatus {
  visible: boolean;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export class BrowserViewManager {
  private view: WebContentsView | null = null;
  private parentWindow: BrowserWindow | null = null;
  private visible = false;
  private _blankPageTheme: "dark" | "light" = "dark";
  private _blankPageBgColor = "#121214";
  private _isOnBlankPage = true;
  private onStatusChange: ((status: BrowserStatus) => void) | null = null;

  create(parentWindow: BrowserWindow): void {
    if (this.view) return;
    this.parentWindow = parentWindow;

    this.view = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    const wc = this.view.webContents;
    wc.on("did-start-loading", () => this._pushStatus());
    wc.on("did-stop-loading", () => this._pushStatus());
    wc.on("did-navigate", (_e, url) => {
      if (url !== this._blankPageUrl()) this._isOnBlankPage = false;
      this._pushStatus();
    });
    wc.on("did-navigate-in-page", () => this._pushStatus());
    wc.on("page-title-updated", () => this._pushStatus());

    wc.loadURL(this._blankPageUrl());
    this._isOnBlankPage = true;
  }

  destroy(): void {
    if (this.visible) this._removeFromWindow();
    this.view?.webContents.close();
    this.view = null;
    this.visible = false;
  }

  setStatusChangeHandler(handler: (status: BrowserStatus) => void): void {
    this.onStatusChange = handler;
  }

  show(): void {
    if (!this.view || !this.parentWindow || this.visible) return;
    this.parentWindow.contentView.addChildView(this.view);
    this.view.setVisible(false);
    this.visible = true;
    this._pushStatus();
  }

  hide(): void {
    if (!this.view || !this.visible) return;
    this.view.setVisible(false);
    this._removeFromWindow();
    this.visible = false;
    this._pushStatus();
  }

  toggle(): void {
    this.visible ? this.hide() : this.show();
  }

  setBounds(x: number, y: number, width: number, height: number): void {
    if (!this.view || !this.visible) return;
    if (width <= 0 || height <= 0) {
      this.view.setVisible(false);
      return;
    }
    this.view.setBounds({ x, y, width, height });
    this.view.setVisible(true);
  }

  navigate(url: string): void {
    if (!this.view) return;
    if (!this.visible) this.show();
    if (url === "about:blank") {
      this._isOnBlankPage = true;
      this.view.webContents.loadURL(this._blankPageUrl());
    } else {
      this._isOnBlankPage = false;
      this.view.webContents.loadURL(url);
    }
  }

  goBack(): void { this.view?.webContents.goBack(); }
  goForward(): void { this.view?.webContents.goForward(); }
  reload(): void { this.view?.webContents.reload(); }
  stop(): void { this.view?.webContents.stop(); }

  getStatus(): BrowserStatus {
    const wc = this.view?.webContents;
    return {
      visible: this.visible,
      url: this._isOnBlankPage ? "about:blank" : (wc?.getURL() ?? "about:blank"),
      title: wc?.getTitle() ?? "",
      isLoading: wc?.isLoading() ?? false,
      canGoBack: wc?.navigationHistory.canGoBack() ?? false,
      canGoForward: wc?.navigationHistory.canGoForward() ?? false,
    };
  }

  setTheme(theme: "dark" | "light", bgColor?: string): void {
    if (bgColor) this._blankPageBgColor = bgColor;
    this._blankPageTheme = theme;
    if (this.view && this._isOnBlankPage) {
      this.view.webContents.loadURL(this._blankPageUrl());
    }
  }

  getWebContentsView(): WebContentsView | null {
    return this.view;
  }

  private _removeFromWindow(): void {
    if (this.view && this.parentWindow) {
      this.parentWindow.contentView.removeChildView(this.view);
    }
  }

  private _pushStatus(): void {
    if (this.onStatusChange) {
      this.onStatusChange(this.getStatus());
    }
  }

  private _blankPageUrl(): string {
    const bg = this._blankPageBgColor;
    const theme = this._blankPageTheme;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="color-scheme" content="${theme}">
<style>html,body{margin:0;padding:0;height:100%;background:${bg};}</style>
</head><body></body></html>`;
    return `data:text/html;base64,${Buffer.from(html).toString("base64")}`;
  }
}
