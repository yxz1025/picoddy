import { readFile, readdir, lstat, mkdir, mkdtemp, writeFile, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseArgs } from "node:util";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import semver from "semver";
import { syncPublishedVersion } from "./version.mjs";
import { parse } from "yaml";
import { buildRelease, releaseConfiguration } from "./build.mjs";
import { stageFeed, publishPlan, checksum } from "./feed.mjs";

async function writeManualUploadGuide(path, plan, baseUrl) {
  const base = new URL(baseUrl);
  const artifacts = await Promise.all(plan.objects.map(async (object, index) => ({
    ...object,
    order: index + 1,
    key: decodeURIComponent(new URL(object.url).pathname.slice(1)),
    sha512: await checksum(object.path),
  })));
  const feed = {
    path: plan.feedPath,
    url: plan.feedUrl,
    key: decodeURIComponent(new URL(plan.feedUrl).pathname.slice(1)),
    size: (await stat(plan.feedPath)).size,
    sha512: await checksum(plan.feedPath),
  };
  const rows = artifacts.map(item =>
    `${item.order}. **先上传制品**：\`${item.path}\` → \`${item.key}\`（${item.size} bytes，SHA-512 \`${item.sha512}\`）\n   下载地址：${item.url}`);
  rows.push(`\n最后上传更新清单：\`${feed.path}\` → \`${feed.key}\`（${feed.size} bytes，SHA-512 \`${feed.sha512}\`）\n下载地址：${feed.url}`);
  await writeFile(path, [
    "# 手动上传发布文件", "", `发布 ID：\`${plan.releaseId}\``, `下载根地址：${base.href}`, "",
    "确认目标 Bucket 对应上述下载根地址，并保持对象 Key 不变。按顺序上传全部制品，确认下载地址可访问且 SHA-512 匹配后，**最后上传更新清单**。", "",
    "请使用下面标出的 `feed-staging/` 清单。构建输出根目录中同名的 electron-builder 原始清单不含客户端要求的平台、架构、安装范围和发布字段，不能上传到更新源。", "",
    "此模式不会读取线上版本或 ETag，不持有发布锁，也不会自动校验源站、刷新 CDN 或同步源码版本。上传前请人工确认没有并发发布且版本符合发布策略。", "",
    ...rows, "", `机器可读计划：\`${join(path.replace(/manual-upload\.md$/, ""), "feed-staging", "publish.json")}\``, "",
  ].join("\n"), "utf8");
}

export async function currentFeed(url, version, request = fetch) {
  const response = await request(url, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { "Cache-Control": "no-cache" } });
  if (response.status === 404) { await response.body?.cancel(); return "new"; }
  if (!response.ok) { await response.body?.cancel(); throw new Error(`读取更新源失败 (${response.status})`); }
  const etag = response.headers.get("etag");
  if (!etag || !/^"[^"\r\n]*"$/.test(etag)) {
    await response.body?.cancel(); throw new Error("更新源必须返回强 ETag，以防覆盖其他发布");
  }
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body ?? []) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) throw new Error("更新清单过大");
    chunks.push(chunk);
  }
  const info = parse(Buffer.concat(chunks).toString("utf8"), { maxAliasCount: 0 });
  if (!semver.valid(info?.version) || !semver.gt(version, info.version)) throw new Error("新版本必须高于线上版本；同版本失败重试请使用已生成的 publish.json");
  return etag;
}

export async function directoryBytes(path) {
  const info = await lstat(path);
  if (!info.isDirectory()) return info.size;
  let size = 0;
  for (const name of await readdir(path)) size += await directoryBytes(join(path, name));
  return size;
}

export async function findApplication(output, platform) {
  const found = [];
  async function scan(path, depth) {
    const entries = await readdir(path, { withFileTypes: true });
    if (platform === "win32" && entries.some((item) => item.isFile() && item.name === "PiCoddy.exe")) { found.push(path); return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const next = join(path, entry.name);
      if (platform === "darwin" && entry.name === "PiCoddy.app") found.push(next);
      else if (depth > 0) await scan(next, depth - 1);
    }
  }
  await scan(output, 2);
  if (found.length !== 1) throw new Error(`预期一个解包应用，实际找到 ${found.length} 个`);
  return found[0];
}

export async function ship(values, dependencies = {}) {
  const manualUpload = values["manual-upload"] === true || values.manualUpload === true;
  const root = dependencies.root ?? resolve(import.meta.dirname, "../..");
  const platform = dependencies.platform ?? process.platform;
  const arch = values.arch ?? dependencies.arch ?? process.arch;
  const scope = values.scope ?? "user", channel = values.channel ?? "stable";
  const provider = values.provider ?? "generic";
  if (!["generic", "qiniu"].includes(provider)) throw new Error("--provider 只支持 generic 或 qiniu");
  if (manualUpload && provider !== "qiniu") throw new Error("--manual-upload 目前仅支持七牛发布配置");
  if (!values.version || semver.valid(values.version) !== values.version || values.version.includes("+") || (channel === "stable" && semver.prerelease(values.version))) throw new Error("请提供有效的 --version（不含构建后缀）；stable 不接受预发布版本");
  const rootUrl = values.url ?? (provider === "qiniu" ? process.env.QINIU_UPDATE_URL : undefined);
  if (!rootUrl) throw new Error("请用 --url 指定 HTTPS 更新根地址，例如 https://你的七牛下载域名/picoddy/");
  const url = new URL(rootUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/")) throw new Error("--url 必须是无认证参数且以 / 结尾的 HTTPS 更新根地址");
  const feed = new URL(`feeds/${channel}/${platform}/${arch}/${scope}/`, url).href;
  const feedName = `${channel === "beta" ? "beta" : "latest"}${platform === "darwin" ? "-mac" : ""}.yml`;
  releaseConfiguration({}, { platform, arch, scope, channel, feedUrl: feed });
  const percentage = Number(values.percentage ?? 100);
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) throw new Error("--percentage 必须为 0–100 整数");
  const notes = values.notes ? await readFile(resolve(values.notes), "utf8") : "";
  const commit = dependencies.commit ?? (await promisify(execFile)("git", ["rev-parse", "HEAD"], { cwd: root })).stdout.trim();
  if (!/^[a-f\d]{7,40}$/i.test(commit)) throw new Error("无效的源码 commit");
  // Capture the compare-and-swap precondition before the potentially long build.
  let qiniu, settings;
  if (provider === "qiniu" && !manualUpload) {
    const { qiniuSettings, createQiniuPublisher } = await import("./qiniu.mjs");
    settings = qiniuSettings(dependencies.env ?? process.env, url.href);
    qiniu = await (dependencies.qiniuFactory ?? createQiniuPublisher)(settings);
  }
  const etag = manualUpload ? undefined : qiniu
    ? await qiniu.currentFeed(new URL(feedName, feed).href, values.version)
    : await currentFeed(new URL(feedName, feed).href, values.version, dependencies.fetch ?? fetch);
  const parent = join(root, "build", "releases");
  await mkdir(parent, { recursive: true });
  const output = await mkdtemp(join(parent, `${values.version}-${platform}-${arch}-${scope}-${channel}-`));
  console.log(`构建 ${values.version} (${platform}/${arch}/${scope})，发布比例 ${percentage}%\n输出：${output}`);
  await (dependencies.build ?? buildRelease)({ platform, arch, scope, channel, feed, version: values.version, output });
  const metadata = join(output, feedName);
  const info = parse(await readFile(metadata, "utf8"));
  if (info.version !== values.version) throw new Error("构建产物版本与请求版本不一致，禁止发布");
  const unpackedSize = await directoryBytes(await findApplication(output, platform));
  const staging = join(output, "feed-staging");
  const plan = await (dependencies.stage ?? stageFeed)({ metadata, updateConfig: join(output, "update-config.json"), output: staging,
    releasesUrl: new URL("releases/", url).href, commit, percentage, unpackedSize, notes });
  const planPath = join(staging, "publish.json");
  await writeFile(join(output, "ship.json"), JSON.stringify({ version: values.version, commit, ...(etag ? { etag } : {}), planPath, feedUrl: plan.feedUrl,
    provider, ...(manualUpload ? { mode: "manual-upload" } : {}), ...(settings ? { bucket: settings.bucket, baseUrl: settings.baseUrl } : {}) }, null, 2));
  if (manualUpload) {
    const guidePath = join(output, "manual-upload.md");
    await writeManualUploadGuide(guidePath, plan, url.href);
    console.log(`本地构建完成，未连接发布服务或上传文件。\n产物目录：${output}\n手动上传顺序：${guidePath}`);
    return { output, planPath, feedUrl: plan.feedUrl, guidePath, manualUpload: true };
  }
  console.log(`上传并发布：${plan.feedUrl}\n若上传中断，请保留该目录并使用 ${qiniu ? "release:qiniu:publish" : "release:feed publish"} 重试：${planPath}`);
  await (qiniu ? qiniu.publish : dependencies.publish ?? publishPlan)(planPath, etag);
  try { await syncPublishedVersion(root, values.version); }
  catch (error) { throw new Error(`远端发布已成功，但本地版本同步失败：${error.message}。请同步 package.json/package-lock.json 至 ${values.version}，不要重新构建发布。`, { cause: error }); }
  console.log(`${qiniu ? "七牛清单已发布，CDN 刷新已提交" : "发布完成"}：${values.version}\n更新源：${plan.feedUrl}`);
  return { output, planPath, feedUrl: plan.feedUrl };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { ...Object.fromEntries(["version", "url", "provider", "arch", "scope", "channel", "percentage", "notes"].map((key) => [key, { type: "string" }])), "manual-upload": { type: "boolean" }, help: { type: "boolean" } } });
  if (values.help) console.log("npm run release:qiniu -- --version 1.1.0 --url https://你的七牛下载域名/picoddy/ [--arch x64] [--scope machine] [--channel beta] [--percentage 5] [--notes notes.txt] [--manual-upload]\n默认自动构建并发布。--manual-upload 仅本地构建并生成上传说明，不访问线上、不使用发布凭据。\n七牛凭据读取 .env.qiniu；--url 优先于 QINIU_UPDATE_URL。通用 PUT 服务仍可用 npm run release:ship（默认 --provider generic）。");
  else await ship(values);
}
