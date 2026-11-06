import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { channelCall } from './api';
interface QrLogin { loginId: string; qrImage: string; expiresAt: number }
const messages: Record<string, string> = {
  wait: '请用手机微信扫一扫，确认连接这台电脑', scaned: '已扫码，请在手机微信上确认', confirmed: '微信已授权，点击下方“保存并连接”完成绑定',
  expired: '二维码已过期，请重新获取', need_verifycode: '请填写手机微信显示的配对码', verify_code_blocked: '配对码尝试次数过多，请重新扫码', binded_redirect: '微信提示此机器人已连接，请返回通道列表检查已有绑定，或重新获取二维码',
};
export default function WeixinLoginPanel({ bound, disabled, onAuthorized, onPendingChange }: { bound: boolean; disabled: boolean; onAuthorized(id: string | undefined): void; onPendingChange(pending: boolean): void }) {
  const [qr, setQr] = useState<QrLogin>();
  const [status, setStatus] = useState(''); const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const [code, setCode] = useState(''); const [attempt, setAttempt] = useState(0);
  const current = useRef<string | undefined>(undefined); const generation = useRef(0); const pendingCode = useRef<string | undefined>(undefined);
  useEffect(() => () => { generation.current++; if (current.current) void channelCall('weixin.cancel', { loginId: current.current }).catch(() => {}); }, []);
  async function start() {
    const sequence = ++generation.current; onPendingChange(true); onAuthorized(undefined); setError(''); setStatus(''); setQr(undefined); setLoading(true);
    if (current.current) { void channelCall('weixin.cancel', { loginId: current.current }).catch(() => {}); current.current = undefined; }
    try {
      const next = await channelCall<QrLogin>('weixin.start');
      if (sequence !== generation.current) { void channelCall('weixin.cancel', { loginId: next.loginId }).catch(() => {}); return; }
      current.current = next.loginId; setQr(next); setStatus('wait');
    } catch (e) { if (sequence === generation.current) setError(e instanceof Error ? e.message : '无法获取微信二维码'); }
    finally { if (sequence === generation.current) setLoading(false); }
  }
  useEffect(() => {
    if (!qr) return;
    let cancelled = false; let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        if (Date.now() >= qr!.expiresAt) { setStatus('expired'); onAuthorized(undefined); return; }
        const verifyCode = pendingCode.current; pendingCode.current = undefined;
        const next = await channelCall<{ status: string }>('weixin.poll', { loginId: qr!.loginId, ...(verifyCode ? { verifyCode } : {}) });
        if (cancelled) return;
        setStatus(next.status); setError('');
        if (next.status === 'confirmed') { onPendingChange(false); onAuthorized(qr!.loginId); return; }
        if (['expired', 'need_verifycode', 'verify_code_blocked', 'binded_redirect'].includes(next.status)) return;
        timer = setTimeout(() => { void poll(); }, 1000);
      } catch (e) { if (!cancelled) { setError(e instanceof Error ? e.message : '微信授权状态读取失败，请重新获取二维码'); onAuthorized(undefined); } }
    }
    void poll(); return () => { cancelled = true; clearTimeout(timer); };
  }, [qr, attempt]);
  return <section className="weixin-login" aria-label="微信扫码绑定">
    <p>使用微信 ClawBot 私聊当前电脑，无需 App Key 或密钥。</p>
    {qr && status !== 'confirmed' && <img className="weixin-qr" src={qr.qrImage} alt="微信绑定二维码" width="240" height="240" />}
    {status && <p role="status">{messages[status] ?? '正在等待微信确认…'}</p>}
    {status === 'need_verifycode' && <div className="channel-directory"><input aria-label="微信配对码" value={code} maxLength={16} onChange={e => setCode(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))} /><button type="button" className="channel-button" disabled={disabled || !code} onClick={() => { pendingCode.current = code; setCode(''); setAttempt(value => value + 1); }}>提交配对码</button></div>}
    <button type="button" className="channel-button" disabled={disabled || loading} onClick={() => void start()}>{loading && <LoaderCircle size={15} className="channels-spin" />}{loading ? '获取二维码…' : qr || bound ? '重新扫码绑定' : '生成微信二维码'}</button>
    {bound && (qr || loading || error) && <button type="button" className="channel-text-button" disabled={disabled} onClick={() => {
      generation.current++; if (current.current) void channelCall('weixin.cancel', { loginId: current.current }).catch(() => {});
      current.current = undefined; setQr(undefined); setStatus(''); setError(''); setLoading(false); onAuthorized(undefined); onPendingChange(false);
    }}>取消重新绑定</button>}
    {error && <p className="channels-error" role="alert">{error}</p>}
    <p className="channel-form-note">仅绑定账号本人可发起文字私聊任务。请在支持 ClawBot 的最新版微信中扫码；暂不支持普通微信群、图片、语音和文件。</p>
  </section>;
}
