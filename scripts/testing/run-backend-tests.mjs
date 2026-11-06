import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../../", import.meta.url));
async function collect(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? collect(path) : /\.(?:test|spec)\.tsx?$/.test(entry.name) ? [path] : [];
  }));
  return files.flat().sort();
}
const files = (await Promise.all(["test/src", "test/scripts"].map(path => collect(join(root, path))))).flat();
const child = spawn(process.execPath, ["--import", "tsx", "--test", "--test-timeout=60000", "--test-concurrency=4", ...files], {
  cwd: root, stdio: "inherit", windowsHide: true,
});
child.on("error", error => { console.error(error); process.exitCode = 1; });
child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
