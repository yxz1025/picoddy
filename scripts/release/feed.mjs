import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { parse, stringify } from "yaml";
import semver from "semver";

export async function checksum(path) {
  const hash = createHash("sha512");
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest("base64");
}
export async function stageFeed({ metadata, updateConfig, output, releasesUrl, commit, percentage = 100, unpackedSize, notes = "" }) {
  const config = JSON.parse(await readFile(updateConfig, "utf8"));
  const info = parse(await readFile(metadata, "utf8"));
  if (!semver.valid(info.version) || !/^[a-f\d]{7,40}$/i.test(commit) || !Array.isArray(info.files)) throw new Error("Invalid release identity");
  if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100 || !Number.isSafeInteger(unpackedSize) || unpackedSize <= 0) throw new Error("Invalid size or rollout percentage");
  const base = new URL(releasesUrl);
  if (base.protocol !== "https:" || !base.pathname.endsWith("/") || base.origin !== new URL(config.feedUrl).origin) throw new Error("Immutable release root must share the HTTPS feed origin");
  const prefix = `${info.version}/${config.platform}/${config.arch}/${config.scope}/`;
  const releaseId = `${info.version}-${commit}-${config.platform}-${config.arch}-${config.scope}`;
  const objects = [];
  const files = [];
  for (const file of info.files) {
    if (typeof file.url !== "string" || /[/\\]/.test(file.url) || file.url.includes("..")) throw new Error("Expected local builder artifact filename");
    const path = resolve(dirname(metadata), file.url);
    const size = (await stat(path)).size;
    if (size !== file.size || await checksum(path) !== file.sha512) throw new Error(`Artifact mismatch: ${basename(path)}`);
    const url = new URL(prefix + encodeURIComponent(basename(path)), base).href;
    objects.push({ path, url, size, sha512: file.sha512 });
    files.push({ ...file, url });
    const blockmap = `${path}.blockmap`;
    try { const blockStat = await stat(blockmap); objects.push({ path: blockmap, url: `${url}.blockmap`, size: blockStat.size, sha512: await checksum(blockmap) }); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!files.some((file) => new URL(file.url).pathname.endsWith(config.platform === "win32" ? ".exe" : ".dmg"))) throw new Error("Installer artifact missing");
  const manifest = { ...info, files, releaseId, platform: config.platform, arch: config.arch, scope: config.scope,
    channel: config.channel, stagingPercentage: percentage, unpackedSize, releaseNotes: notes, revoked: false };
  delete manifest.path; delete manifest.sha512;
  await mkdir(output, { recursive: true });
  const feedName = `${config.channel === "beta" ? "beta" : "latest"}${config.platform === "darwin" ? "-mac" : ""}.yml`;
  const feedPath = join(output, feedName);
  await writeFile(feedPath, stringify(manifest));
  const plan = { schemaVersion: 1, releaseId, objects, feedPath: resolve(feedPath), feedUrl: new URL(feedName, config.feedUrl).href };
  await writeFile(join(output, "publish.json"), JSON.stringify(plan, null, 2));
  return plan;
}
export async function verifyRemote(object, request = fetch) {
  const response = await request(object.url, { redirect: "error", signal: AbortSignal.timeout(300000) });
  if (!response.ok || !response.body) throw new Error("Published object is not readable");
  const hash = createHash("sha512"); let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > object.size) throw Object.assign(new Error(`Published size mismatch: ${object.url}; expected=${object.size}, received>=${bytes}`), { code: "ERR_PUBLISHED_CONTENT_MISMATCH" });
    hash.update(chunk);
  }
  const actualHash = hash.digest("base64");
  if (bytes !== object.size || actualHash !== object.sha512) throw Object.assign(new Error(
    `Published checksum mismatch: ${object.url}; size expected=${object.size}, received=${bytes}; sha512 expected=${object.sha512}, received=${actualHash}`
  ), { code: "ERR_PUBLISHED_CONTENT_MISMATCH" });
  const range = await request(object.url, { headers: { Range: "bytes=0-0" }, redirect: "error", signal: AbortSignal.timeout(15000) });
  await range.body?.cancel();
  if (range.status !== 206 || range.headers.get("content-range") !== `bytes 0-0/${object.size}`) throw new Error("CDN must support Range/206 before feed promotion");
}
export async function publishPlan(planPath, etag) {
  if (!etag) throw new Error("Provide --etag new for first publication, or the exact current feed ETag");
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const authorization = process.env.PICODDY_UPDATE_PUBLISH_TOKEN ? { Authorization: `Bearer ${process.env.PICODDY_UPDATE_PUBLISH_TOKEN}` } : {};
  for (const object of plan.objects) {
    if (await checksum(object.path) !== object.sha512) throw new Error("Local artifact changed after staging");
    const result = await fetch(object.url, { method: "PUT", redirect: "error", headers: { ...authorization,
      "If-None-Match": "*", "Cache-Control": "public, max-age=31536000, immutable", "Content-Length": String(object.size) },
      body: createReadStream(object.path), duplex: "half" });
    if (!result.ok && result.status !== 412) throw new Error(`Artifact upload failed (${result.status})`);
    await result.body?.cancel();
    await verifyRemote(object); // A 412 is only accepted for identical immutable bytes.
  }
  const feed = await readFile(plan.feedPath);
  const result = await fetch(plan.feedUrl, { method: "PUT", redirect: "error", headers: { ...authorization,
    ...(etag === "new" ? { "If-None-Match": "*" } : { "If-Match": etag }), "Content-Type": "application/yaml", "Cache-Control": "public, max-age=60" }, body: feed });
  if (!result.ok) throw new Error(`Feed conditional publication failed (${result.status}); artifacts remain unchanged`);
  console.log(JSON.stringify({ action: "publish", releaseId: plan.releaseId, at: new Date().toISOString(), etag: result.headers.get("etag") }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: Object.fromEntries(["metadata", "update-config", "output", "releases-url", "commit", "percentage", "unpacked-size", "notes", "plan", "etag", "feed"].map((key) => [key, { type: "string" }])) });
  if (positionals[0] === "stage") console.log(await stageFeed({ metadata: values.metadata, updateConfig: values["update-config"], output: values.output,
    releasesUrl: values["releases-url"], commit: values.commit, percentage: Number(values.percentage ?? 100), unpackedSize: Number(values["unpacked-size"]),
    notes: values.notes ? await readFile(values.notes, "utf8") : "" }));
  else if (positionals[0] === "publish") await publishPlan(values.plan, values.etag);
  else if (positionals[0] === "revoke" || positionals[0] === "rollout") {
    const info = parse(await readFile(values.feed, "utf8"));
    if (positionals[0] === "revoke") { info.revoked = true; info.stagingPercentage = 0; }
    else { const percentage = Number(values.percentage); if (!Number.isInteger(percentage) || percentage < 0 || percentage > 100) throw new Error("Invalid percentage"); info.stagingPercentage = percentage; }
    await writeFile(values.feed, stringify(info));
    console.log("Local feed updated; use publish with the expected current ETag to promote it.");
  } else throw new Error("Usage: feed.mjs stage|publish|revoke|rollout [options]");
}
