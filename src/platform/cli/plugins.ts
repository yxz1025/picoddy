import type { CliPluginManifest } from "./runtime.ts";

/** 仅列出随应用打包、经过审核的 CLI 插件；第三方来源暂不进入运行时。 */
export const BUILTIN_CLI_PLUGINS = Object.freeze([
  Object.freeze({
    id: "skillhub",
    version: "0.23.3",
    packageName: "clawhub",
    entry: "bin/clawdhub.js",
    capabilities: Object.freeze(["skill.catalog", "skill.install"]),
  } satisfies CliPluginManifest),
]);
