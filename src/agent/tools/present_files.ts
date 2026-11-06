// src/agent/tools/present_files.ts
// 交付工具（对标 参考设计 present_files）：任务完成时向用户一次性展示所有成果文件。
// 只读声明，不写文件不写库；顺序即查看优先级，第一个文件前端自动打开。

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { verifyArtifact } from "../artifact_verification.ts";
import { connect } from "node:net";
import { resolve, isAbsolute } from "node:path";
import { getDb } from "../../infra/db.ts";
import { sessionContext } from "../../infra/context.ts";
import { platformPaths } from "../../platform/paths.ts";
import { sessionFallbackArtifactDir } from "../session_output_path.ts";

const presentFilesSchema = Type.Object({
  files: Type.Array(
    Type.Union([
      Type.String({ description: "文件路径或 URL（http/https）" }),
      Type.Object({
        path: Type.String({ description: "文件路径或 URL" }),
        title: Type.Optional(Type.String({ description: "展示名称（默认用文件名）" })),
      }),
    ]),
    { description: "交付文件列表，顺序即查看优先级，第一个自动打开" },
  ),
  explanation: Type.Optional(Type.String({ description: "交付物简要说明" })),
});

const FILE_ICONS: Record<string, string> = {
  html: "🌐", htm: "🌐", svg: "🖼️", png: "🖼️", jpg: "🖼️", jpeg: "🖼️", gif: "🖼️", webp: "🖼️",
  pdf: "📄", docx: "📄", pptx: "📊", xlsx: "📋",
  mp4: "🎬", mov: "🎬", webm: "🎬",
  py: "🐍", js: "📜", ts: "📜", go: "📜", rs: "📜",
  json: "📋", csv: "📋", yaml: "📋", xml: "📋",
  md: "📝", txt: "📝",
};

function extOf(name: string): string {
  const base = name.split("?")[0];
  return base.split(".").pop()?.toLowerCase() || "";
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** 探测 localhost 服务器是否可达（2 秒超时） */
function checkLocalhost(url: URL): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const port = url.port ? Number(url.port) : 80;
    const sock = connect({ host: url.hostname, port, timeout: 2000 });
    const done = (ok: boolean) => {
      sock.destroy();
      resolveProbe(ok);
    };
    sock.on("connect", () => done(true));
    sock.on("error", () => done(false));
    sock.on("timeout", () => done(false));
  });
}

function isLocalhost(url: URL): boolean {
  return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
}

/** 当前会话绑定的工作空间目录（无会话时回退 artifacts 目录） */
async function resolveWorkspaceDir(): Promise<string> {
  const sessionId = sessionContext.getStore()?.sessionId;
  if (sessionId) {
    try {
      const db = getDb();
      const conv = db.prepare(
        "SELECT workspace_id FROM conversations WHERE id = ?",
      ).get(sessionId) as { workspace_id?: string } | undefined;
      if (conv?.workspace_id) {
        const ws = db.prepare("SELECT dir_path FROM workspaces WHERE id = ?")
          .get(conv.workspace_id) as { dir_path: string } | undefined;
        if (ws?.dir_path) return platformPaths.expandHome(ws.dir_path);
      }
    } catch (e) {
      console.error("[present_files] 获取工作空间失败:", e);
    }
  }
  return sessionFallbackArtifactDir(
    platformPaths.artifactsDir,
    sessionId ?? "unbound",
    process.platform === "win32" ? "windows" : "posix",
  );
}

export const presentFilesTool: AgentTool<typeof presentFilesSchema, any> = {
  name: "present_files",
  label: "展示交付文件",
  description:
    "文件或链接成果的展示入口：把成果一次性展示给用户，第一个会自动打开预览。支持任意类型的非空本地文件和 http/https URL（localhost 会先探测可达性）。文件统一检查可读性，专项结构校验取决于任务约定。代码修改、纯文本回答或外部操作任务不必额外生成文件。",
  parameters: presentFilesSchema,
  execute: async (_id, p, signal) => {
    if (!p.files || p.files.length === 0) {
      throw new Error("[present_files] files 不能为空，至少要传一个文件路径或 URL。");
    }

    const workspaceDir = await resolveWorkspaceDir();
    const presented: Record<string, unknown>[] = [];
    const problems: string[] = [];

    for (const item of p.files) {
      signal?.throwIfAborted();
      const raw = typeof item === "string" ? item : item.path;
      const title = typeof item === "string" ? undefined : item.title;
      const trimmed = raw.trim();

      if (/^https?:\/\//i.test(trimmed)) {
        try {
          const url = new URL(trimmed);
          if (isLocalhost(url) && !(await checkLocalhost(url))) {
            problems.push(`localhost 服务器 ${trimmed} 不可达，请先用 bash 后台启动服务器再 present`);
            continue;
          }
          presented.push({
            url: trimmed,
            title: title ?? (url.pathname.split("/").pop() || url.host),
            type: "url",
            icon: "🌐",
            exists: true,
          });
          continue;
        } catch {
          problems.push(`URL 格式非法: ${trimmed}`);
          continue;
        }
      }

      // 本地文件：相对路径基于工作空间解析
      const abs = isAbsolute(trimmed) ? trimmed : resolve(workspaceDir, trimmed);
      try {
        const verify = sessionContext.getStore()?.verifyArtifactForDelivery ?? verifyArtifact;
        const verified = await verify(abs, signal);
        const name = abs.split("/").pop() || abs;
        const ext = extOf(name);
        presented.push({
          path: abs,
          title: title ?? name,
          type: verified.extension,
          icon: FILE_ICONS[ext] ?? "📎",
          size: formatSize(verified.bytes),
          bytes: verified.bytes,
          digest: verified.digest,
          exists: true,
        });
      } catch (error) {
        signal?.throwIfAborted();
        problems.push(`${abs}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    if (presented.length === 0 || problems.length > 0) {
      throw new Error(`[present_files] 交付验收未通过：\n${problems.join("\n")}`);
    }

    return {
      content: [{
        type: "text",
        text: p.explanation ?? "已展示以下交付物，任务要求由最终验收确认：",
      }],
      details: { files: presented, explanation: p.explanation, problems },
    };
  },
};
