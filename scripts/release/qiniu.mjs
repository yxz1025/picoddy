import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";
import semver from "semver";
import { syncPublishedVersion } from "./version.mjs";
import { checksum, verifyRemote } from "./feed.mjs";
import { releaseConfiguration } from "./build.mjs";

export function qiniuSettings(env = process.env, baseUrl = env.QINIU_UPDATE_URL) {
  for (const name of ["QINIU_ACCESS_KEY", "QINIU_SECRET_KEY", "QINIU_BUCKET"]) {
    if (!env[name]?.trim()) throw new Error(`缺少 ${name}，请配置 .env.qiniu 或 CI 环境变量`);
  }
  if (!baseUrl) throw new Error("请用 --url 或 QINIU_UPDATE_URL 指定你的七牛 HTTPS 下载域名和目录");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !url.pathname.endsWith("/")) throw new Error("QINIU_UPDATE_URL 必须是以 / 结尾的 HTTPS 更新根地址");
  if (!/^[a-zA-Z0-9_-]+$/.test(env.QINIU_BUCKET)) throw new Error("QINIU_BUCKET 无效");
  if (env.QINIU_REGION && !/^[a-z0-9-]+$/.test(env.QINIU_REGION)) throw new Error("QINIU_REGION 无效");
  return { accessKey: env.QINIU_ACCESS_KEY, secretKey: env.QINIU_SECRET_KEY, bucket: env.QINIU_BUCKET,
    region: env.QINIU_REGION || undefined, baseUrl: url.href };
}

export function objectKey(input, baseUrl) {
  const url = new URL(input), base = new URL(baseUrl);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname) || url.username || url.password || url.search || url.hash) throw new Error("发布对象必须属于配置的七牛更新根地址");
  const key = decodeURIComponent(url.pathname.slice(1));
  if (!key || Buffer.byteLength(key) > 750 || key.split("/").some((p) => !p || p === "." || p === "..") || /[\\\x00-\x1f]/.test(key)) throw new Error("无效的七牛对象 Key");
  return key;
}

// Qiniu's documented QETag for objects <= 4 MiB. Feeds and locks are capped at 1 MiB.
export function smallEtag(bytes) {
  if (bytes.length > 1024 * 1024) throw new Error("更新清单过大");
  return Buffer.concat([Buffer.from([0x16]), createHash("sha1").update(bytes).digest()]).toString("base64url");
}
export async function fileEtag(path) {
  const blockSize = 4 * 1024 * 1024;
  const hashes = []; let size = 0, hash = createHash("sha1");
  for await (const chunk of createReadStream(path)) {
    let offset = 0;
    while (offset < chunk.length) {
      const count = Math.min(blockSize - size, chunk.length - offset);
      hash.update(chunk.subarray(offset, offset + count)); size += count; offset += count;
      if (size === blockSize) { hashes.push(hash.digest()); hash = createHash("sha1"); size = 0; }
    }
  }
  if (size || !hashes.length) hashes.push(hash.digest());
  const multi = hashes.length > 1;
  return Buffer.concat([Buffer.from([multi ? 0x96 : 0x16]), multi ? createHash("sha1").update(Buffer.concat(hashes)).digest() : hashes[0]]).toString("base64url");
}
function etagOf(info) {
  if (info === null) return "new";
  if (!info || !/^[A-Za-z0-9_-]{28}$/.test(info.hash)) throw new Error("七牛返回了无效的对象摘要");
  return `"${info.hash}"`;
}
async function readSmall(url, request) {
  const response = await request(url, { redirect: "error", signal: AbortSignal.timeout(15000), headers: { "Cache-Control": "no-cache" } });
  if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error(`读取 CDN 清单失败 (${response.status})`); }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 1024 * 1024) throw new Error("更新清单过大");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function createQiniuPublisher(settings, dependencies = {}) {
  const client = dependencies.client ?? (await import("./qiniu-sdk.mjs")).createQiniuClient(settings);
  const request = dependencies.fetch ?? fetch;
  const record = dependencies.record ?? ((value) => console.log(JSON.stringify(value)));
  async function current(feedUrl, version) {
    const info = await client.stat(objectKey(feedUrl, settings.baseUrl));
    const etag = etagOf(info);
    if (etag === "new") return etag;
    // Never take a cached CDN ETag as the storage precondition. Match its bytes
    // to the authoritative Kodo stat before trusting the embedded version.
    const url = new URL(feedUrl); url.searchParams.set("picoddy_publish_check", randomUUID());
    const bytes = await readSmall(url.href, request);
    if (smallEtag(bytes) !== info.hash) throw new Error("CDN 清单尚未同步七牛源站，请等待缓存刷新后重试");
    const previous = parse(bytes.toString("utf8"), { maxAliasCount: 0 });
    if (!semver.valid(previous?.version)) throw new Error("线上版本清单无效");
    if (version && !semver.gt(version, previous.version)) throw new Error("新版本必须高于线上版本；重试请使用原 publish.json");
    return etag;
  }
  async function publish(planPath, expected) {
    if (expected !== "new" && !/^"[A-Za-z0-9_-]{28}"$/.test(expected ?? "")) throw new Error("缺少有效的七牛发布基线，请使用原 ship.json 中的 etag");
    const plan = JSON.parse(await readFile(planPath, "utf8"));
    const feedKey = objectKey(plan.feedUrl, settings.baseUrl);
    const relativeFeed = new URL(plan.feedUrl).pathname.slice(new URL(settings.baseUrl).pathname.length);
    if (!/^feeds\/(stable|beta)\/(win32|darwin)\/(x64|ia32|arm64)\/(user|machine)\/(latest|beta)(-mac)?\.yml$/.test(relativeFeed)) throw new Error("无效的 feed 路径");
    const bytes = await readFile(plan.feedPath);
    const targetHash = smallEtag(bytes);
    const feed = parse(bytes.toString("utf8"), { maxAliasCount: 0 });
    if (plan.schemaVersion !== 1 || feed.releaseId !== plan.releaseId || !semver.valid(feed.version) || !Array.isArray(feed.files) || !feed.files.length || !Array.isArray(plan.objects)) throw new Error("发布计划与清单不一致");
    const feedDirectory = new URL(`feeds/${feed.channel}/${feed.platform}/${feed.arch}/${feed.scope}/`, settings.baseUrl).href;
    releaseConfiguration({}, { platform: feed.platform, arch: feed.arch, scope: feed.scope, channel: feed.channel, feedUrl: feedDirectory });
    const feedName = `${feed.channel === "beta" ? "beta" : "latest"}${feed.platform === "darwin" ? "-mac" : ""}.yml`;
    if (plan.feedUrl !== new URL(feedName, feedDirectory).href || !Number.isInteger(feed.stagingPercentage) || feed.stagingPercentage < 0 || feed.stagingPercentage > 100 ||
        !Number.isSafeInteger(feed.unpackedSize) || feed.unpackedSize <= 0 || (feed.channel === "stable" && semver.prerelease(feed.version))) throw new Error("清单目标或灰度配置无效");
    const releasePrefix = new URL(`releases/${feed.version}/${feed.platform}/${feed.arch}/${feed.scope}/`, settings.baseUrl).pathname;
    const keys = new Set();
    for (const object of plan.objects) {
      const key = objectKey(object.url, settings.baseUrl);
      if (!new URL(object.url).pathname.startsWith(releasePrefix) || keys.has(key)) throw new Error("无效或重复的制品路径");
      keys.add(key);
      if (!Number.isSafeInteger(object.size) || object.size <= 0 || (await stat(object.path)).size !== object.size || await checksum(object.path) !== object.sha512) throw new Error("本地制品已变化，禁止上传");
    }
    if (!feed.files.every((file) => plan.objects.some((o) => o.url === file.url && o.sha512 === file.sha512 && o.size === file.size))) throw new Error("清单引用了未校验的制品");
    for (const object of plan.objects) {
      const key = objectKey(object.url, settings.baseUrl);
      const hash = await fileEtag(object.path);
      if (!await client.stat(key)) {
        try {
          await client.putFile(key, object.path, object.size, join(dirname(planPath), `.qiniu-resume-${createHash("sha256").update(key).digest("hex")}.json`));
        } catch (error) { if (error.status !== 614) throw error; }
      }
      const origin = await client.stat(key);
      if (origin?.hash !== hash || origin.fsize !== object.size) throw new Error("七牛源站存在不同内容的同版本制品，禁止覆盖");
      // Existing keys are only reusable if their real downloadable bytes match.
      try {
        await verifyRemote(object, request);
      } catch (error) {
        if (error.code !== "ERR_PUBLISHED_CONTENT_MISMATCH") throw error;
        // Origin matches the local artifact, but the public URL does not.
        // Refresh that exact URL; never bypass the client-visible integrity check.
        let requestId;
        try { requestId = await client.refresh([object.url]); }
        catch {
          throw new Error(`七牛源站校验通过，但 CDN 制品不匹配且刷新失败；请检查 CDN 配置/刷新额度后使用原 publish.json 重试，不要重建或覆盖制品。${error.message}`, { cause: error });
        }
        record({ action: "qiniu-artifact-refresh", releaseId: plan.releaseId, url: object.url, requestId });
        throw new Error(`七牛源站校验通过，但 CDN 制品不匹配；刷新已提交，等待缓存生效后使用原 publish.json 重试，不要重建或覆盖制品。${error.message}`, { cause: error });
      }
      await client.headers(key, "public, max-age=31536000, immutable");
    }
    const lockKey = `${feedKey}.publish-lock`;
    const lockBytes = Buffer.from(JSON.stringify({ owner: randomUUID(), releaseId: plan.releaseId, at: new Date().toISOString() }));
    const lockHash = smallEtag(lockBytes);
    try {
      const result = await client.putBuffer(lockKey, lockBytes, { insertOnly: true });
      if (result.hash !== lockHash) throw new Error("锁摘要不匹配");
    } catch {
      throw new Error(`未取得七牛发布锁：${lockKey}。可能有其他发布或上次中断；确认相关进程已停止后才可在七牛控制台删除此锁。`);
    }
    let keepLock = false;
    const receiptPath = join(dirname(planPath), "qiniu-publication.json");
    const receipt = { provider: "qiniu", bucket: settings.bucket, feedUrl: plan.feedUrl, releaseId: plan.releaseId, expected, targetHash };
    async function save(phase, extra = {}) {
      await writeFile(receiptPath, JSON.stringify({ ...receipt, phase, at: new Date().toISOString(), ...extra }, null, 2));
    }
    try {
      const actual = await client.stat(feedKey);
      if (actual?.hash !== targetHash) {
        if (etagOf(actual) !== expected) throw new Error("七牛源站清单已被其他发布修改，禁止覆盖；请重新核对版本");
        if ((await client.stat(lockKey))?.hash !== lockHash) throw new Error("发布锁所有权已变化");
        await save("publishing");
        keepLock = true; // An uncertain write must never allow another publisher to race it.
        const result = await client.putBuffer(feedKey, bytes, { insertOnly: expected === "new", mimeType: "application/yaml" });
        if (result.hash !== targetHash || (await client.stat(feedKey))?.hash !== targetHash) throw new Error("七牛清单写入结果未确认");
        keepLock = false;
      }
      await save("feed-published-refresh-pending");
      await client.headers(feedKey, "public, max-age=60, must-revalidate");
      let requestId;
      try { requestId = await client.refresh([plan.feedUrl]); }
      catch { throw new Error("清单已写入七牛，但 CDN 刷新失败；请用同一 publish.json 和原基线重试，不要重建或回滚"); }
      await save("cdn-refresh-submitted", { requestId });
      record({ action: "qiniu-publish", releaseId: plan.releaseId, feedUrl: plan.feedUrl, requestId, status: "cdn-refresh-submitted" });
      // A refresh acknowledgement is not proof of global CDN propagation.
      return { requestId, status: "cdn-refresh-submitted" };
    } finally {
      if (keepLock) record({ action: "qiniu-lock-retained", lockKey, reason: "write-result-uncertain" });
      else if ((await client.stat(lockKey))?.hash === lockHash) await client.remove(lockKey);
    }
  }
  return { currentFeed: current, publish };
}

export async function publishSaved(values, dependencies = {}) {
  if (!values.plan) throw new Error("请提供 --plan <原 feed-staging/publish.json>");
  const planPath = resolve(values.plan);
  const saved = JSON.parse(await readFile(join(dirname(planPath), "..", "ship.json"), "utf8"));
  if (saved.provider !== "qiniu" || resolve(saved.planPath) !== planPath) throw new Error("该计划不属于七牛发布，或已移动；请核对 ship.json");
  const env = dependencies.env ?? process.env;
  const settings = qiniuSettings(env, values.url ?? (env.QINIU_UPDATE_URL || saved.baseUrl));
  if (settings.bucket !== saved.bucket || settings.baseUrl !== saved.baseUrl) throw new Error("七牛 Bucket/更新根地址与原发布计划不一致");
  const publisher = await (dependencies.factory ?? createQiniuPublisher)(settings);
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  if (plan.feedUrl !== saved.feedUrl) throw new Error("更新清单地址与原发布计划不一致");
  const bytes = await readFile(plan.feedPath);
  const intentPath = join(dirname(planPath), "qiniu-intent.json");
  let expected = saved.etag;
  let intent;
  try { intent = JSON.parse(await readFile(intentPath, "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (intent?.targetHash === smallEtag(bytes)) expected = intent.expected;
  if (values.percentage !== undefined || values.revoke) {
    if (values.percentage !== undefined && values.revoke) throw new Error("--percentage 和 --revoke 不能同时使用");
    const feed = parse(bytes.toString("utf8"), { maxAliasCount: 0 });
    const percentage = values.revoke ? 0 : Number(values.percentage);
    if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) throw new Error("--percentage 必须为 0–100 整数");
    if (!values.revoke && feed.revoked) throw new Error("不能重新推广已撤回版本，请发布更高版本修复");
    expected = await publisher.currentFeed(plan.feedUrl);
    if (expected !== `"${smallEtag(bytes)}"`) throw new Error("本地清单不是线上当前内容，禁止修改其他发布的灰度或撤回状态");
    feed.stagingPercentage = percentage;
    if (values.revoke) feed.revoked = true;
    const updated = Buffer.from(stringify(feed));
    // Persist the original hash before editing the feed, so a failed rollout or
    // refresh can be retried without adopting an intervening publication.
    await writeFile(intentPath, JSON.stringify({ expected, targetHash: smallEtag(updated) }, null, 2));
    await writeFile(plan.feedPath, updated);
  }
  const result = await publisher.publish(planPath, expected);
  const published = parse(await readFile(plan.feedPath, "utf8"), { maxAliasCount: 0 });
  if (!published.revoked) {
    try { await syncPublishedVersion(dependencies.root ?? resolve(import.meta.dirname, "../.."), published.version); }
    catch (error) { throw new Error(`远端发布已成功，但本地版本同步失败：${error.message}。请用原发布计划重试同步，不要重新构建。`, { cause: error }); }
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { plan: { type: "string" }, url: { type: "string" }, percentage: { type: "string" }, revoke: { type: "boolean" }, help: { type: "boolean" } } });
  if (values.help) console.log("npm run release:qiniu:publish -- --plan <原 feed-staging/publish.json> [--percentage 20 | --revoke]\n无附加参数为失败重试。下载域名沿用原 ship.json；.env.qiniu 只需配置相同 Bucket 和凭据。");
  else await publishSaved(values);
}
