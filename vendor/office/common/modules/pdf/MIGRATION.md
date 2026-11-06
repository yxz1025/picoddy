# 360office PDF 快照

来源：2026-10-03 本机 360office/apps/pdf 源码（源目录无 Git 元数据）。

集成差异：
- main/index 导出 pdf-main 生命周期，createPdfView 使用宿主 partition/mode。
- WASM 回退到模块 main/wasm；PDF.js 字体、CMap、worker、WASM 全部内置。
- App 初始 sidebar=null，可手动展开；html[data-pdf-ready=true] 标记 ready/password。
- preload 禁用项目/drop-open/AI/联网 OCR/跨应用转换；preview mode 禁止写入。
- PDF 滚动容器统一 8px thumb 和 4px 右边距。
- 顶部 ribbon 隐藏“页面”和“填写表单”入口，表单字段聚焦不自动切到隐藏的工具栏；暂时保留底层实现及缩略图等其它入口。

附 integration-source 保存集成覆盖源；升级不得用 standalone 入口覆盖。
更新后验证打开、编辑、保存、关闭取消、缩略图切换、字体/WASM及多视图隔离。

## Startup performance
AI annotation scans are skipped when AI is disabled. Offline OCR is explicitly unsupported by this embedded preload, so its background document pass is not started. Page geometry loads in bounded batches of eight; documents explicitly reporting no AcroForm skip the form catalog scan, while unknown/form documents retain it. Persisted static fills still load before editing is enabled. A generated 326-page sample reached first canvas in 1070 ms versus 1844 ms before these changes (single-run comparison). The actual 326-page Chinese novel was opened and navigated to its final page in the full development client; exact timings for that file were not collected.
