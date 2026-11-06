import { readFile, writeFile, mkdir, copyFile, chmod, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { parseEnv } from 'node:util';
import { dirname, resolve, join } from 'node:path';

const [source, target] = process.argv.slice(2);
try {
  if (!source || !target) throw new Error();
  try { await access(target); console.error('目标配置已存在，不覆盖密钥。'); process.exit(1); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const env = parseEnv(await readFile(source, 'utf8'));
  for (const key of ['ENCRYPTION_KEY', 'SANDBOX_API_KEY', 'DATABASE_URL']) {
    if (!env[key]) { console.error(`本地配置缺少 ${key}`); process.exit(1); }
  }
  env.POSTGRES_PASSWORD ||= decodeURIComponent(new URL(env.DATABASE_URL).password);
  if (!env.POSTGRES_PASSWORD) throw new Error();
  env.POSTGRES_USER ||= 'picoddy';
  env.POSTGRES_DB ||= 'picoddy_cloud';
  env.DATABASE_URL = `postgresql://${encodeURIComponent(env.POSTGRES_USER)}:${encodeURIComponent(env.POSTGRES_PASSWORD)}@postgres:5432/${encodeURIComponent(env.POSTGRES_DB)}`;
  env.SANDBOX_DOMAIN = 'http://opensandbox-server:8090';
  env.SANDBOX_IMAGE ||= 'picoddy-cloud-sandbox:0.1.0';
  env.PUBLIC_ORIGIN = process.env.DEPLOY_PUBLIC_ORIGIN || 'https://CHANGE_ME.example.com';
  env.ALLOW_INSECURE_HTTP = process.env.DEPLOY_ALLOW_INSECURE_HTTP || 'false';
  env.API_BIND_ADDRESS = '127.0.0.1'; env.API_PORT = '8080';
  env.SECURE_COOKIES = new URL(env.PUBLIC_ORIGIN).protocol === 'https:' ? 'true' : 'false'; env.HOST = '0.0.0.0'; env.PORT = '8080';
  env.STORAGE_LOCAL_ROOT = '/app/data/files';
  const secrets = join(dirname(target), 'secrets');
  await mkdir(secrets, {recursive: true, mode: 0o700});
  if (!env.SKILLHUB_AUTH_ACCESS_TOKEN_SECRET && !env.SKILLHUB_ACCESS_TOKEN_SECRET_API_KEY) {
    const file = resolve(dirname(source), env.SKILLHUB_SECRET_FILE || 'data/skillhub-secret.enc');
    try {
      await copyFile(file, join(secrets, 'skillhub-secret.enc'), constants.COPYFILE_EXCL);
      await chmod(join(secrets, 'skillhub-secret.enc'), 0o600);
      env.SKILLHUB_SECRET_FILE = '/app/secrets/skillhub-secret.enc';
    } catch (error) { if (error.code !== 'ENOENT') throw error; delete env.SKILLHUB_SECRET_FILE; }
  }
  // Single quotes prevent Compose from interpolating dollar signs in credentials.
  const contents = Object.entries(env).map(([key, value]) => {
    if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /['\r\n\0]/.test(value)) throw new Error();
    return `${key}='${value}'`;
  }).join('\n') + '\n';
  await writeFile(target, contents, {flag: 'wx', mode: 0o600});
  console.log('已继承本地配置与密钥（未显示密钥）。请确认 PUBLIC_ORIGIN。');
} catch {
  console.error('初始化失败：请检查源配置、目标是否已存在、文件权限或值中是否有单引号/换行；未输出密钥。');
  process.exitCode = 1;
}
