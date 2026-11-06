import { chmod, mkdir, rename, rm, writeFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, dirname, win32 } from "node:path";

export interface RuntimeWrapperOptions {
  platform: "darwin" | "win32";
  wrapperDir: string;
  hostExecutable: string;
  npmCliPath: string;
  pythonExecutable?: string;
  pythonLauncher?: { bootstrap: string; config: Record<string, unknown> };
}

async function atomicWrite(path: string, content: string, mode: number): Promise<void> {
  if (await readFile(path, "utf8").catch(() => undefined) === content) {
    await chmod(path, mode);
    return;
  }
  await mkdir(join(path, ".."), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: "wx", mode });
  try {
    await rename(temporary, path);
    await chmod(path, mode);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function quotePosix(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function quoteCmd(value: string): string {
  return `"${value.replaceAll("%", "%%").replaceAll("\"", "\"\"")}"`;
}

export async function ensureRuntimeWrappers(options: RuntimeWrapperOptions): Promise<void> {
  await mkdir(options.wrapperDir, { recursive: true, mode: 0o700 });
  const npxCli = options.platform === "win32"
    ? win32.join(win32.dirname(options.npmCliPath), "npx-cli.js")
    : join(dirname(options.npmCliPath), "npx-cli.js");
  let pythonCommand: string[];
  if (options.pythonLauncher) {
    const launcher = join(options.wrapperDir, "python-launcher.cjs");
    await atomicWrite(launcher,
      `require(${JSON.stringify(options.pythonLauncher.bootstrap)}).run(${JSON.stringify(options.pythonLauncher.config)}, process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });\n`, 0o600);
    pythonCommand = [options.hostExecutable, launcher];
  } else if (options.pythonExecutable) {
    pythonCommand = [options.pythonExecutable];
  } else {
    throw new Error("RUNTIME_WRAPPER_INVALID: Python launcher or executable is required");
  }
  const commands: Record<string, { args: string[]; node: boolean }> = {
    node: { args: [options.hostExecutable], node: true },
    npm: { args: [options.hostExecutable, options.npmCliPath], node: true },
    npx: { args: [options.hostExecutable, npxCli], node: true },
    python: { args: pythonCommand, node: Boolean(options.pythonLauncher) },
    python3: { args: pythonCommand, node: Boolean(options.pythonLauncher) },
    pip: { args: [...pythonCommand, "-m", "pip"], node: Boolean(options.pythonLauncher) },
    pip3: { args: [...pythonCommand, "-m", "pip"], node: Boolean(options.pythonLauncher) },
  };
  for (const [name, command] of Object.entries(commands)) {
    if (options.platform === "darwin") {
      await atomicWrite(join(options.wrapperDir, name),
        `#!/bin/sh\nexec ${command.node ? "env ELECTRON_RUN_AS_NODE=1 " : ""}${command.args.map(quotePosix).join(" ")} "$@"\n`, 0o700);
    } else {
      await atomicWrite(join(options.wrapperDir, `${name}.cmd`),
        `@echo off\r\nsetlocal DisableDelayedExpansion\r\nchcp 65001 >nul\r\nset "ELECTRON_RUN_AS_NODE=${command.node ? "1" : ""}"\r\n${command.args.map(quoteCmd).join(" ")} %*\r\nexit /b %errorlevel%\r\n`, 0o600);
    }
  }
}
