import { createRequire } from "node:module";

// 不能用静态 import 引入 koffi：它会在模块求值时立即加载原生扩展。在
// Windows 企业终端环境中，这可能被安全软件拦截并直接终止 Electron。所有
// FFI 功能都应在真正使用时经由此加载器获取模块。
const require = createRequire(import.meta.url);
type Koffi = typeof import("koffi").default;

let cached: Koffi | undefined;

export function loadKoffi(): Koffi {
  if (cached) return cached;
  const loaded = require("koffi") as { default?: Koffi } & Partial<Koffi>;
  const resolved = (loaded.default ?? loaded) as Koffi;
  cached = resolved;
  return resolved;
}
