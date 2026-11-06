// src/agent/tools/web.ts
// 联网工具：web_fetch + web_search
// 对照 参考设计 的 WebFetch/WebSearch（参考设计 跑在 cbc CLI + 服务端，我们本地直连）

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

const MAX_CONTENT = 20_000; // 20KB 截断
const FETCH_TIMEOUT = 15_000; // 15 秒超时

// ===== web_fetch：抓取 URL 内容，HTML→纯文本 =====
const fetchSchema = Type.Object({
  url: Type.String({ description: "要抓取的 URL（http/https）" }),
  prompt: Type.Optional(
    Type.String({ description: "想从这个页面提取什么信息（可选，用于提示）" }),
  ),
});

export const webFetchTool: AgentTool<
  typeof fetchSchema,
  { url: string; chars: number }
> = {
  name: "web_fetch",
  label: "网页抓取",
  description:
    "抓取网页内容并转为纯文本。支持 HTML→文本提取，自动处理重定向。适合读取文章、文档、API 响应等。返回前 20000 字符。",
  parameters: fetchSchema,
  execute: async (_id, p) => {
    let url = p.url.trim();
    // HTTP → HTTPS 强升级
    if (url.startsWith("http://")) url = "https://" + url.slice(7);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    try {
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "PiCoddy/1.0 (Desktop Agent)" },
        redirect: "follow",
      });
      clearTimeout(timer);

      if (!resp.ok) {
        return {
          content: [{
            type: "text",
            text: `抓取失败：HTTP ${resp.status} ${resp.statusText}`,
          }],
          details: { url, chars: 0 },
        };
      }

      const contentType = resp.headers.get("content-type") || "";
      const raw = await resp.text();

      // JSON 直接返回
      if (contentType.includes("application/json")) {
        const text = raw.slice(0, MAX_CONTENT);
        return {
          content: [{ type: "text", text: `[JSON] ${text}` }],
          details: { url, chars: text.length },
        };
      }

      // HTML → 纯文本提取
      const text = contentType.includes("text/html") ? htmlToText(raw) : raw;
      const truncated = text.length > MAX_CONTENT;
      const result = truncated
        ? text.slice(0, MAX_CONTENT) + "\n\n[内容已截断，共显示前 20000 字符]"
        : text;

      return {
        content: [{ type: "text", text: result }],
        details: { url, chars: result.length },
      };
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text", text: `抓取失败：${msg}` }],
        details: { url, chars: 0 },
      };
    }
  },
};

// ===== web_search：搜索引擎查询 =====
const searchSchema = Type.Object({
  query: Type.String({ description: "搜索关键词" }),
  maxResults: Type.Optional(
    Type.Number({ description: "最大结果数（默认 5）" }),
  ),
});

export const webSearchTool: AgentTool<
  typeof searchSchema,
  { query: string; count: number }
> = {
  name: "web_search",
  label: "网页搜索",
  description:
    "搜索互联网获取最新信息。返回标题、链接和摘要。适合查询新闻、技术文档、产品信息等。可用 web_fetch 进一步抓取感兴趣的结果页面。",
  parameters: searchSchema,
  execute: async (_id, p) => {
    const query = p.query.trim();
    const max = p.maxResults ?? 5;

    try {
      const results = await searchDuckDuckGo(query, max);
      if (results.length === 0) {
        return {
          content: [{ type: "text", text: `搜索"${query}"没有找到结果。` }],
          details: { query, count: 0 },
        };
      }

      const text = results.map((r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`
      ).join("\n\n");

      return {
        content: [{ type: "text", text: `搜索"${query}"的结果：\n\n${text}` }],
        details: { query, count: results.length },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text", text: `搜索失败：${msg}` }],
        details: { query, count: 0 },
      };
    }
  },
};

// ===== 工具函数 =====

/** HTML → 纯文本（简易提取，去掉标签/脚本/样式） */
function htmlToText(html: string): string {
  return html
    // 移除 script/style/noscript 标签及内容
    .replace(/<(script|style|noscript|svg|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    // 移除 HTML 注释
    .replace(/<!--[\s\S]*?-->/g, "")
    // br/p/div/h/li → 换行
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, "\n")
    .replace(/<(p|div|h[1-6]|li|tr|blockquote)[^>]*>/gi, "\n")
    // 移除所有剩余标签
    .replace(/<[^>]+>/g, "")
    // HTML 实体解码
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // 压缩空白
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** DuckDuckGo HTML 搜索（无需 API Key） */
async function searchDuckDuckGo(
  query: string,
  max: number,
): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const url = `https://html.duckduckgo.com/html/?q=${
    encodeURIComponent(query)
  }`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

  try {
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });
    clearTimeout(timer);

    if (!resp.ok) return [];
    const html = await resp.text();
    return parseDuckDuckGoResults(html, max);
  } catch {
    clearTimeout(timer);
    return [];
  }
}

/** 解析 DuckDuckGo HTML 结果页 */
function parseDuckDuckGoResults(
  html: string,
  max: number,
): Array<{ title: string; url: string; snippet: string }> {
  const results: Array<{ title: string; url: string; snippet: string }> = [];

  // DuckDuckGo 结果格式：<a class="result__a" href="...">title</a> ... <a class="result__snippet">
  const linkRegex =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex =
    /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

  const links: Array<{ url: string; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(html)) !== null) {
    const rawUrl = m[1];
    const title = stripTags(m[2]).trim();
    // DuckDuckGo 的 URL 是跳转链接，提取真实 URL
    const realUrl = extractDdgUrl(rawUrl);
    if (title && realUrl) links.push({ url: realUrl, title });
  }

  const snippets: string[] = [];
  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push(stripTags(m[1]).trim());
  }

  for (let i = 0; i < Math.min(max, links.length); i++) {
    results.push({
      title: links[i].title,
      url: links[i].url,
      snippet: snippets[i] || "",
    });
  }

  return results;
}

function extractDdgUrl(rawUrl: string): string {
  // DDG 用 //duckduckgo.com/l/?uddg=<encoded_url> 格式
  const match = rawUrl.match(/uddg=([^&]+)/);
  if (match) return decodeURIComponent(match[1]);
  // 直接是 URL 的情况
  if (rawUrl.startsWith("http")) return rawUrl;
  return "";
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(
    /&lt;/g,
    "<",
  ).replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
}
