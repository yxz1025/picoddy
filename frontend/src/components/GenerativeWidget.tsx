import TableWidget from "./TableWidget";
import SlideDeckWidget from "./SlideDeckWidget";
import DocPreviewWidget from "./DocPreviewWidget";

interface GenerativeWidgetProps {
  toolName?: string;
  content?: string;
  filePath?: string;
}

export default function GenerativeWidget({ toolName, content = "", filePath }: GenerativeWidgetProps) {
  // 根据 filePath 或 toolName 判断格式
  const pathLower = (filePath || content).toLowerCase();
  const nameLower = (toolName || "").toLowerCase();

  // Excel / CSV / 表格数据
  if (
    pathLower.endsWith(".xlsx") ||
    pathLower.endsWith(".csv") ||
    nameLower.includes("xlsx") ||
    nameLower.includes("table") ||
    nameLower.includes("data-analysis")
  ) {
    return <TableWidget title={filePath ? filePath.split("/").pop() : "数据表格"} filePath={filePath} rawText={content} />;
  }

  // PPT 演示文稿
  if (pathLower.endsWith(".pptx") || nameLower.includes("pptx") || nameLower.includes("presentation")) {
    return <SlideDeckWidget title={filePath ? filePath.split("/").pop() : "PPT 演示文稿"} filePath={filePath} />;
  }

  // Word 文档 / 报告
  if (pathLower.endsWith(".docx") || nameLower.includes("docx") || nameLower.includes("weekly-report")) {
    return <DocPreviewWidget title={filePath ? filePath.split("/").pop() : "Word 结构化文档"} filePath={filePath} />;
  }

  // 默认：尝试检测 JSON/表格文本
  if (content.includes(",") && content.includes("\n") && content.length > 30) {
    return <TableWidget title="数据分析视图" rawText={content} filePath={filePath} />;
  }

  return null;
}
