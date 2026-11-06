import { useEffect, useState } from 'react';
import { apiGet, apiPost } from '../api/client';
import type { BrowserAutomationStatus } from '../../shared/browser';

export default function BrowserAutomationSetting() {
  const [status, setStatus] = useState<BrowserAutomationStatus | null>(null);
  const [error, setError] = useState('');
  const [changing, setChanging] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    const read = async () => {
      if (pending) return;
      pending = true;
      try { const value = await apiGet<BrowserAutomationStatus>('/api/system/browser-automation'); if (active) setStatus(value); }
      catch (e) { if (active) setError(String(e)); }
      finally { pending = false; }
    };
    void read(); const timer = setInterval(() => void read(), 1500);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const installing = status && ['packages', 'browser', 'checking'].includes(status.phase);
  async function toggle(on: boolean) {
    setChanging(true); setError('');
    try { setStatus(await apiPost<BrowserAutomationStatus>('/api/system/browser-automation', { enabled: on })); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setChanging(false); }
  }
  return <div className="settings-section">
    <div className="security-card-box full-width">
      <div className="security-card-header">
        <div className="security-card-title-group"><h3 className="security-card-title">浏览器自动化</h3></div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input type="checkbox" role="switch" aria-label="浏览器自动化" checked={Boolean(status?.enabled || installing)} disabled={changing || !status?.supported} onChange={e => void toggle(e.target.checked)} />
          {changing ? '处理中…' : installing ? '安装中' : status?.enabled ? '已开启' : status?.installed ? '开启' : '安装并开启'}
        </label>
      </div>
      <p className="settings-section-desc">首次开启将按当前电脑平台下载 Playwright 和 Chromium。测试专家可在本地执行 Web / H5 测试，无需修改业务项目依赖。</p>
      {status && <>
        <small style={{ color: 'var(--text-3)' }}>{status.platform} · Playwright {status.version}</small>
        <p role="status" style={{ fontSize: 13, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{status.message}</p>
        {installing && <progress aria-label="安装进度" max={100} value={status.progress} style={{ width: '100%' }} />}
        {status.phase === 'error' && status.supported && <button className="settings-btn" disabled={changing} onClick={() => void toggle(true)}>重试安装</button>}
      </>}
      <small style={{ color: 'var(--text-3)' }}>关闭保留安装文件，并阻止新的受管测试启动；已运行的任务继续完成。安装中关闭可取消下载。</small>
      {error && <p role="alert">{error}</p>}
    </div>
  </div>;
}
