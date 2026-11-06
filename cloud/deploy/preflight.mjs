import { loadConfig } from '../src/config.ts';
import { Sandbox } from '@alibaba-group/opensandbox';

try {
  for (const key of ['PUBLIC_ORIGIN', 'SANDBOX_DOMAIN', 'SANDBOX_API_KEY', 'ENCRYPTION_KEY', 'POSTGRES_PASSWORD']) {
    if (!process.env[key] || /CHANGE_ME|GENERATE_ON_INIT/.test(process.env[key])) throw new Error(`请填写 ${key}`);
  }
  if (!/^[A-Za-z0-9_-]+$/.test(process.env.POSTGRES_PASSWORD)) throw new Error('POSTGRES_PASSWORD 需为非空 URL-safe 字符');
  const config = loadConfig();
  if (new URL(config.publicOrigin).protocol !== 'https:' && !['true', '1'].includes(process.env.ALLOW_INSECURE_HTTP?.trim() || '')) throw new Error('生产 PUBLIC_ORIGIN 必须使用 HTTPS');
  if (['localhost', '127.0.0.1', '[::1]'].includes(new URL(config.sandboxDomain).hostname)) throw new Error('SANDBOX_DOMAIN 不能是业务容器自身的 localhost');
  if (typeof Sandbox.prototype.filesWithIdentity !== 'function') throw new Error('OpenSandbox SDK 不支持工作负载身份，请核对依赖版本');
  console.log('生产配置校验通过');
} catch (error) {
  // Configuration exceptions can include credential-bearing URLs. Do not echo them.
  const allowed = ['请填写 ', 'POSTGRES_PASSWORD ', '生产 PUBLIC_ORIGIN ', 'SANDBOX_DOMAIN ', 'OpenSandbox SDK '];
  if (/^(PUBLIC_ORIGIN|SECURE_COOKIES|ALLOW_INSECURE_HTTP) /.test(error.message)) {
    console.error('访问地址配置无效：内网 IP 使用 HTTP 时需 ALLOW_INSECURE_HTTP=true、SECURE_COOKIES=false；HTTPS 需 SECURE_COOKIES=true。PUBLIC_ORIGIN 只能包含协议、主机和端口。');
  } else console.error(allowed.some(prefix => error.message.startsWith(prefix)) ? error.message : '配置校验失败，请检查域名、密钥、存储配置及数值范围（未输出配置内容）');
  process.exitCode = 1;
}
