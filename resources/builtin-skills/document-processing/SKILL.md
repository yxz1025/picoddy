---
name: document-processing
description: 统一处理文档上传、解析、检索、生成、编辑与预览
---

# 文档处理

当用户上传或提到 PDF、Word、Excel、PPT、Markdown、CSV 或其他文档时，统一使用文档处理能力：

1. 先识别文件类型和用户目标。
2. `read_doc` 是读取 Excel、Word、PPT、PDF、CSV 和文本的唯一统一工具。读取 `.xlsx` 仍调用 `read_doc`；不存在 `read_xlsx`，不要根据扩展名推导工具名。
3. 如果用户上传了附件，附件会在 `<turn_payload>` 的 `attachments` 中提供真实 `path` 和已解析内容。优先使用附件内容；需要重新解析表格或长文档时，直接把该 `path` 传给 `read_doc`，不要去工作区或 `artifacts` 目录盲目搜索。
4. 只有需要跨轮复用或检索长附件时，才使用附件的真实 `path` 调用 `rag_index`，随后用 `rag_query` 检索；`rag_index` 的路径必须来自附件上下文，不得自行猜测。
5. 需要生成或修改 Office 文档时，使用项目内置的对应文档工具，并将最终文件写入当前工作空间的产物目录。
6. 需要预览时，调用 `present_files` 返回产物，不要只输出文件路径。
7. 回答文档问题时引用来源文件和相关片段；检索不到时明确说明，不要臆测。

文档处理是一个整体能力，底层可以组合解析器、RAG 检索器、Office 生成器和预览器，用户不需要了解这些工具的内部实现。
