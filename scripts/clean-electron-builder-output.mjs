#!/usr/bin/env node

import { lstat, readFile, readdir, realpath, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, parse as parsePath, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { parse as parseYaml } from "yaml";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIR, "..");
const CONFIG_PATH = resolve(PROJECT_ROOT, "electron-builder.yml");

const currentPlatform = {
  darwin: "mac",
  win32: "win",
  linux: "linux",
}[process.platform];

const requestedPlatform = process.argv[2] === "current" ? currentPlatform : process.argv[2];
if (!requestedPlatform || !["mac", "win", "linux"].includes(requestedPlatform)) {
  throw new Error("用法: node scripts/clean-electron-builder-output.mjs <current|mac|win|linux>");
}

const config = parseYaml(await readFile(CONFIG_PATH, "utf8"));
const configuredOutput = config?.directories?.output;
if (typeof configuredOutput !== "string" || configuredOutput.trim().length === 0) {
  throw new Error("electron-builder.yml 缺少 directories.output");
}

const outputRoot = resolve(PROJECT_ROOT, configuredOutput);
const protectedRoots = new Set([
  parsePath(outputRoot).root,
  resolve(PROJECT_ROOT),
  resolve(homedir()),
]);
if (protectedRoots.has(outputRoot)) {
  throw new Error(`拒绝清理受保护目录: ${outputRoot}`);
}

let outputStat;
try {
  outputStat = await lstat(outputRoot);
} catch (error) {
  if (error?.code === "ENOENT") {
    console.log(`[build-clean] ${requestedPlatform}: 输出目录不存在，无需清理`);
    process.exit(0);
  }
  throw error;
}
if (outputStat.isSymbolicLink() || !outputStat.isDirectory()) {
  throw new Error(`拒绝清理非普通目录: ${outputRoot}`);
}
if (await realpath(outputRoot) !== outputRoot) {
  throw new Error(`拒绝清理包含符号链接的输出目录: ${outputRoot}`);
}

const metadataNames = new Set(["builder-debug.yml", "builder-effective-config.yaml"]);
const platformMatchers = {
  mac: (entry) =>
    (entry.isDirectory() && /^mac(?:-.+)?$/u.test(entry.name)) ||
    (entry.isFile() && /\.(?:dmg|zip)(?:\.blockmap)?$/u.test(entry.name)) ||
    entry.name === "latest-mac.yml",
  win: (entry) =>
    (entry.isDirectory() && /^win(?:-.+)?-unpacked$/u.test(entry.name)) ||
    // electron-builder 的 WiX 中间目录会保留 project.wixobj；必须与 MSI
    // 一同清理，否则重试构建可能复用上一次失败的中间产物。
    (entry.isDirectory() && /^__msi-.+$/u.test(entry.name)) ||
    (entry.isFile() && /\.(?:exe|msi)(?:\.blockmap)?$/u.test(entry.name)) ||
    entry.name === "latest.yml",
  linux: (entry) =>
    (entry.isDirectory() && /^linux(?:-.+)?-unpacked$/u.test(entry.name)) ||
    (entry.isFile() && /\.(?:AppImage|deb|rpm|snap)(?:\.blockmap)?$/u.test(entry.name)) ||
    entry.name === "latest-linux.yml",
};

const entries = await readdir(outputRoot, { withFileTypes: true });
const targets = entries.filter(
  (entry) => metadataNames.has(entry.name) || platformMatchers[requestedPlatform](entry),
);

for (const entry of targets) {
  const target = resolve(outputRoot, entry.name);
  const childPath = relative(outputRoot, target);
  if (!childPath || childPath === ".." || childPath.startsWith(`..${sep}`)) {
    throw new Error(`拒绝清理输出目录之外的路径: ${target}`);
  }
  await rm(target, { recursive: true, force: true });
  console.log(`[build-clean] removed ${target}`);
}

if (targets.length === 0) {
  console.log(`[build-clean] ${requestedPlatform}: 没有旧产物`);
}
