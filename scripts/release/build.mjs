import { readFile, writeFile, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { parse } from "yaml";
import { pathToFileURL } from "node:url";
import semver from "semver";

export function releaseConfiguration(base, { platform, arch, scope = "user", channel = "stable", feedUrl, eventsUrl, output }) {
  if (!["win32", "darwin"].includes(platform) || !["x64", "ia32", "arm64"].includes(arch) ||
      !["user", "machine"].includes(scope) || !["stable", "beta"].includes(channel) ||
      (platform === "darwin" && (arch === "ia32" || scope !== "user")) || (platform === "win32" && arch === "arm64")) throw new Error("Unsupported release target");
  const url = new URL(feedUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || !feedUrl.endsWith("/")) throw new Error("HTTPS feed directory required");
  if (!url.pathname.endsWith(`/${channel}/${platform}/${arch}/${scope}/`)) throw new Error("Feed path must end in channel/platform/arch/scope/");
  if (eventsUrl) {
    const events = new URL(eventsUrl);
    if (events.protocol !== "https:" || events.username || events.password) throw new Error("HTTPS events URL required");
  }
  const update = { schemaVersion: 1, platform, arch, scope, channel, feedUrl, unsigned: true, ...(eventsUrl ? { eventsUrl } : {}) };
  const config = { ...base,
    directories: { ...base.directories, output },
    publish: { provider: "generic", url: feedUrl, channel: channel === "stable" ? "latest" : "beta" },
    artifactName: `PiCoddy-\${version}-${platform}-${arch}-${scope}.\${ext}`,
    forceCodeSigning: false,
    win: { ...base.win, target: [{ target: "nsis", arch: [arch] }], verifyUpdateCodeSignature: false },
    nsis: { oneClick: true, perMachine: scope === "machine", deleteAppDataOnUninstall: false },
    mac: { ...base.mac, identity: null, notarize: false, forceCodeSigning: false, target: [{ target: "dmg", arch: [arch] }, { target: "zip", arch: [arch] }] },
  };
  return { config, update };
}
function run(args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: "inherit", env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false", PICODDY_UNSIGNED_RELEASE: "1" } });
    child.once("error", reject); child.once("exit", (code) => code === 0 ? resolvePromise() : reject(new Error(`Build command failed (${code})`)));
  });
}
export async function buildRelease(values) {
  const root = resolve(import.meta.dirname, "../..");
  const platform = values.platform ?? process.platform, arch = values.arch ?? process.arch;
  if (platform !== process.platform) throw new Error("Release builds must run on the target operating system");
  const output = resolve(values.output ?? join(root, "build", "releases", `${platform}-${arch}-${values.scope ?? "user"}`));
  const base = parse(await readFile(join(root, "electron-builder.yml"), "utf8"));
  const result = releaseConfiguration(base, { ...values, platform, arch, output, feedUrl: values.feed });
  if (values.version !== undefined) {
    if (!semver.valid(values.version)) throw new Error("Invalid release version");
    result.config.extraMetadata = { ...base.extraMetadata, version: values.version };
  }
  await mkdir(output, { recursive: true });
  const metadata = join(output, "update-config.json");
  await writeFile(metadata, JSON.stringify(result.update, null, 2));
  result.config.extraResources = [...base.extraResources, { from: metadata, to: "update-config.json" }];
  const configPath = join(output, "builder-config.json");
  await writeFile(configPath, JSON.stringify(result.config, null, 2));
  await run([join(root, "node_modules/tsx/dist/cli.mjs"), "scripts/build-builtin-skills.ts", "resources/builtin-skills", "src/agent/builtin_skills"], root);
  await run([join(root, "frontend/node_modules/typescript/bin/tsc"), "-b"], join(root, "frontend"));
  await run([join(root, "frontend/node_modules/vite/bin/vite.js"), "build"], join(root, "frontend"));
  await run(["scripts/runtime/prepare-runtime.mjs", "--platform", platform, "--arch", arch], root);
  await run(["scripts/run-electron-builder.mjs", "--config", configPath, platform === "win32" ? "--win" : "--mac", `--${arch}`, "--publish", "never"], root);
  console.log(`Unsigned release artifacts: ${output}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: Object.fromEntries(["platform", "arch", "scope", "channel", "feed", "eventsUrl", "output"].map((key) => [key, { type: "string" }])) });
  await buildRelease(values);
}
