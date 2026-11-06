import { useState } from "react";
import "./SlideDeckWidget.css";

export interface SlideItem {
  title: string;
  bullets: string[];
  notes?: string;
}

interface SlideDeckWidgetProps {
  title?: string;
  slides?: SlideItem[];
  filePath?: string;
}

export default function SlideDeckWidget({
  title = "PPT 演示文稿预览",
  slides = [
    {
      title: "产品框架与功能总览",
      bullets: ["基于 Electron + pi 框架打造", "Word / Excel / PPT 本地文档自动化引擎", "极简 3 栏桌面与生成式 Widget 交互"],
    },
    {
      title: "核心技术架构亮点",
      bullets: ["in-process bindings 零 IPC 通道", "AgentHarness 自动 Token 上下文压缩", "SKILL.md 规范自动集成与格式化"],
    },
    {
      title: "未来演进路线图",
      bullets: ["P1 引入 OS 级 Computer Use 自动化", "P2 多 Agent 协同与工作区 Worktree 隔离", "增强图形与数据图表微渲染"],
    },
  ],
  filePath,
}: SlideDeckWidgetProps) {
  const [currentSlideIndex, setCurrentSlideIndex] = useState(0);

  const slide = slides[currentSlideIndex] ?? slides[0];

  return (
    <div className="slide-deck-widget">
      <div className="slide-deck-header">
        <div className="slide-deck-title">
          <span>🎨</span>
          <span>{title}</span>
        </div>
        <div className="slide-deck-controls">
          <button
            disabled={currentSlideIndex === 0}
            onClick={() => setCurrentSlideIndex((prev) => Math.max(0, prev - 1))}
            className="slide-nav-btn"
          >
            ◀ 上一页
          </button>
          <span className="slide-page-indicator">
            {currentSlideIndex + 1} / {slides.length}
          </span>
          <button
            disabled={currentSlideIndex === slides.length - 1}
            onClick={() => setCurrentSlideIndex((prev) => Math.min(slides.length - 1, prev + 1))}
            className="slide-nav-btn"
          >
            下一页 ▶
          </button>
          {filePath && (
            <button className="slide-open-btn" onClick={() => window.open(`file://${filePath}`)}>
              ↗ 打开 PPT
            </button>
          )}
        </div>
      </div>

      <div className="slide-card-container">
        <div className="slide-card">
          <div className="slide-card-header">
            <span className="slide-number-badge">Slide {currentSlideIndex + 1}</span>
            <div className="slide-title">{slide.title}</div>
          </div>
          <ul className="slide-bullets">
            {slide.bullets.map((bullet, idx) => (
              <li key={idx}>{bullet}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
