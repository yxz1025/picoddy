export interface PresentedFile {
  path?: string;
  url?: string;
  title?: string;
  type?: string;
  icon?: string;
  size?: string;
  exists?: boolean;
}

export interface DeliveryBatch {
  files: PresentedFile[];
  explanation?: string;
  problems: string[];
}

export interface PreviewTarget extends PresentedFile {
  toolName?: string;
}

export type ArtifactKind =
  | "web"
  | "image"
  | "document"
  | "spreadsheet"
  | "presentation"
  | "video"
  | "code"
  | "data"
  | "text"
  | "unknown";

export type PreviewRenderer =
  | "browser"
  | "image"
  | "pdf"
  | "docx"
  | "table"
  | "presentation"
  | "markdown"
  | "text"
  | "video"
  | "unsupported";

export interface ArtifactViewModel {
  key: string;
  source: PresentedFile;
  kind: ArtifactKind;
  displayName: string;
  typeLabel: string;
  extension: string;
  sizeLabel?: string;
  tone: ArtifactKind;
  renderer: PreviewRenderer;
  previewMode: "internal" | "external-fallback";
  previewTarget: PreviewTarget;
  thumbnailUrl?: string;
}

export type PreviewListItem = Pick<PreviewTarget, "path" | "url">;

const GROUPS: Record<Exclude<ArtifactKind, "web" | "unknown">, readonly string[]> = {
  image: ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico", "avif"],
  document: ["pdf", "doc", "docx", "odt", "rtf"],
  spreadsheet: ["xlsx", "xls", "xlsm", "ods", "csv", "tsv"],
  presentation: ["pptx", "ppt", "odp"],
  video: ["mp4", "mov", "webm"],
  code: ["py", "js", "ts", "tsx", "jsx", "go", "rs", "java", "c", "h", "cpp", "cxx", "css", "scss", "html", "htm", "sh", "bash"],
  data: ["json", "yaml", "yml", "xml", "toml", "ini"],
  text: ["md", "markdown", "txt", "log"],
};

const WEB_EXTENSIONS = ["html", "htm"] as const;

function extensionOf(value: string): string {
  const clean = value.split(/[?#]/, 1)[0];
  const name = clean.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function classify(extension: string, isUrl: boolean): ArtifactKind {
  if (isUrl) return "web";
  if (WEB_EXTENSIONS.includes(extension as (typeof WEB_EXTENSIONS)[number])) return "web";
  for (const [kind, extensions] of Object.entries(GROUPS)) {
    if (extensions.includes(extension)) return kind as ArtifactKind;
  }
  return "unknown";
}

function rendererFor(kind: ArtifactKind, extension: string): PreviewRenderer {
  if (kind === "web") return "browser";
  if (kind === "image") return "image";
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "docx";
  if (kind === "spreadsheet" && ["xlsx", "csv", "tsv"].includes(extension)) return "table";
  if (kind === "presentation" && extension === "pptx") return "presentation";
  if (kind === "video") return "video";
  if (["md", "markdown"].includes(extension)) return "markdown";
  if (kind === "text" || kind === "code" || kind === "data") return "text";
  return "unsupported";
}

function urlHost(value: string): string | undefined {
  try {
    return new URL(value).host || undefined;
  } catch {
    return undefined;
  }
}

export function normalizePresentedFile(file: PresentedFile): ArtifactViewModel {
  const raw = file.path || file.url || "";
  const isUrl = typeof file.url === "string" && /^https?:\/\//i.test(file.url);
  const extension = file.url ? "" : extensionOf(file.path || file.type || raw);
  const kind = classify(extension, isUrl);
  const renderer = rendererFor(kind, extension);
  const pathName = file.path ? file.path.split(/[\\/]/).pop() : undefined;
  const displayName = file.title || pathName || (file.url ? urlHost(file.url) : undefined) || "未命名交付物";
  const identity = file.path || file.url || displayName;

  return {
    key: `${identity}:${file.title || ""}`,
    source: file,
    kind,
    displayName,
    typeLabel: kind === "web" ? "网页" : extension ? extension.toUpperCase() : "文件",
    extension,
    sizeLabel: file.size,
    tone: kind,
    renderer,
    previewMode: renderer === "unsupported" ? "external-fallback" : "internal",
    previewTarget: { ...file },
    thumbnailUrl: kind === "image" && file.path ? `/api/file?path=${encodeURIComponent(file.path)}` : undefined,
  };
}

export function normalizePresentedFiles(files: PresentedFile[]): ArtifactViewModel[] {
  return files.map(normalizePresentedFile);
}

export function previewTargetsFromPresentedFiles(
  files: PresentedFile[] | null | undefined,
  toolName = "present_files",
): PreviewTarget[] {
  if (!Array.isArray(files)) return [];
  return files
    .filter(isPresentedFile)
    .map((file) => ({ ...file, toolName }));
}

function previewTargetMatches(
  left: Pick<PreviewTarget, "path" | "url">,
  right: Pick<PreviewTarget, "path" | "url">,
): boolean {
  return (
    (Boolean(left.path) && left.path === right.path)
    || (Boolean(left.url) && left.url === right.url)
  );
}

export function resolveActivePreviewTarget(
  files: PreviewTarget[],
  activeFile: PreviewTarget | null | undefined,
): PreviewTarget | null {
  if (files.length === 0) return null;
  if (!activeFile) return files[0];
  return files.find((file) => previewTargetMatches(file, activeFile)) ?? files[0];
}

export function previewListItemKey(file: PreviewListItem, index: number): string {
  return `${file.path || file.url || "preview"}:${index}`;
}

function batchFromUnknown(value: unknown): DeliveryBatch | null {
  if (!value || typeof value !== "object") return null;
  const details = (value as { details?: unknown }).details;
  if (!details || typeof details !== "object") return null;
  const raw = details as { files?: unknown; explanation?: unknown; problems?: unknown };
  if (!Array.isArray(raw.files) || raw.files.length === 0) return null;
  const files = raw.files.filter(isPresentedFile);
  if (files.length === 0) return null;
  return {
    files,
    explanation: typeof raw.explanation === "string" ? raw.explanation : undefined,
    problems: Array.isArray(raw.problems) ? raw.problems.filter((item): item is string => typeof item === "string") : [],
  };
}

function isPresentedFile(file: unknown): file is PresentedFile {
  if (!file || typeof file !== "object" || Array.isArray(file)) return false;
  const candidate = file as PresentedFile;
  return (
    (typeof candidate.path === "string" && candidate.path.trim().length > 0)
    || (typeof candidate.url === "string" && candidate.url.trim().length > 0)
  );
}

export function deliveryBatchFromOutput(output: unknown): DeliveryBatch | null {
  return batchFromUnknown(output);
}

export function deliveryBatchFromContent(content: string): DeliveryBatch | null {
  try {
    return batchFromUnknown(JSON.parse(content));
  } catch {
    return null;
  }
}
