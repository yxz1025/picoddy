# Document processing capability

- `read_doc` 只读；`write_docx`、`write_xlsx`、`write_pptx` 会在沙箱中创建文件。
- `edit_docx` 通过 vars 填充双花括号占位的模板；`edit_docx_free` 替换、插入或删除 Word 段落；`edit_xlsx` 修改单元格、公式和工作表；`edit_pptx` 替换指定页文本。编辑前自动保存版本，失败保留原文件。
- `/workspace/input` 中的文档编辑后输出副本；生成或指定 outFileName 的输出位于 `/workspace/output`，用 `present_files` 交付。
- 操作前识别格式和结构，修改时保留用户要求的版式、层级与可访问性。
- 交付前验证格式、可打开性、关键内容和视觉可读性。
