export interface BrowserAutomationStatus {
  supported: boolean;
  platform: string;
  version: string;
  enabled: boolean;
  installed: boolean;
  phase: 'idle' | 'packages' | 'browser' | 'checking' | 'ready' | 'error';
  progress?: number;
  message: string;
}
