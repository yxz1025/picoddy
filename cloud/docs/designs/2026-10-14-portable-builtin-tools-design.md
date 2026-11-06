# 网页云端内置工具完整迁入

## 授权与范围

承接用户已批准的 2026-10-12-full-desktop-parity-design.md（P1/P3/P6/P8）及本轮“桌面端内置工具全部云端可用”的要求。用户随后明确电脑操作及网盘均不需要；18 个 lianxiang_* 工具全部排除，不注册、不注入提示词、不打包网盘客户端。因此不迁 computer/screenshot/mouse_click/mouse_move/key_type/app_focus/cursor_pos，不新增虚拟桌面或本机助手。只改 cloud，桌面源码与数据保持独立。

## 实际工具核对

以 src/agent/tools/index.ts 的 getFullTools/getReadOnlyTools/Creator 注册入口为准，动态插件与第三方 MCP 不算固定内置工具。除不迁的电脑工具外：

| 工具组 | 现状与本轮修正 |
| --- | --- |
| read/write/edit/bash/grep/find/ls | 已注册；保持当前沙箱 operations 和文件边界 |
| read_me/show_widget | 纯实现和设计指引尚未迁入；前端已含 renderer，但历史转换会丢 details.widget。本轮补注册、权限、prompt、实时与重载双路径 |
| memory_recall/memory_write | 云端仅资源管理与冻结记忆，工具缺失；补 user/working/all 召回和按 owner/conversation 的写入，working 不混入其它会话 |
| read_doc/write_docx/write_xlsx/write_pptx/edit_docx/edit_docx_free/edit_xlsx/edit_pptx | 四编辑工具缺失，现有写 schema 缺桌面可选字段；对齐参数和结构化结果、原子保存及编辑前版本备份，实际文件操作在沙箱 |
| web_search/web_fetch | 搜索已有 pi-web-access；补桌面 web_fetch 参数与结果，作为同一任务 pi-web-access fetch_content 的兼容入口执行，沿用其私网/重定向检查，不另开抓取链路，保留现有四个联网工具 |
| rag_index/query/refresh/status、subagent、goal_complete、ask_user_question、present_files | 已注册；纳入可用性清单和政策/结果验证 |
| Skill/Expert Creator 工具 | 已有独立草稿工具；保持专用分类限制，不把全部工具注入 Creator |

connect_cloud_service 依赖用户电脑 CodeBuddy 的 auth 文件，并把原始 token 返回模型，已批准总设计明确不迁此实现。网页服务用自己的授权连接器；本轮不读取用户电脑登录文件，也不注册假成功的同名工具。connector_cli_execute 是受管 CLI 子会话专用工具，不在普通桌面 getFullTools；动态 delegate/插件仍按其服务配置和安装能力装配，不能算本轮静态工具或伪装成 bash。

## 方案与数据流

1. 纯 Visualizer 代码复制到 cloud 本地模块；read_me 设计指引与 show_widget 校验直接对齐桌面，返回 details.widget。在普通 Craft/Plan 的允许集合注册，在 Ask 无工具；Creator 保持现有草稿工具约束。前端 cloudAdapter 补消息级 widget 字段，刷新历史无需再解析丢失的 details。
2. memory 使用现有 resources(kind=memory)，JSON data 保存 scope/kind/conversationId，无新增表或 migration。user 记忆继续空间过滤；working 必须绑定 run.owner_id/conversation_id，并在运行快照与召回中排除其它会话。写入有配额，任务租约校验；既有管理更新不丢 scope。
3. Office schema 来自桌面可达工具，实际生成在 runtime/documents.py、编辑在 runtime/document-editor.mjs。路径限 /workspace 且编辑不修改 /workspace/input；需要编辑输入时输出新副本。原地编辑前保存版本于任务私有空间，事务式临时文件替换，失败保留原文件；后续发布仍用 present_files。DOCX 自由编辑沿用桌面 word/document.xml 算法，保留现有 XML 与样式，处理正文段落/表格；页眉页脚自由编辑及跨 run 文本替换未扩展；XLSX 保留公式/单元格信息；PPTX 替换覆盖指定页的文本形状/表格，保留原版式。
4. 新工具在注册、权限、capability prompt 和冻结运行清单中同时添加；不用工具名存在替代功能验收。MCP 保持用户最新指定的完全访问全部自动执行策略，Shell 规则不在本轮改动。

## 风险与非目标

不新增电脑环境、不共享桌面 SQLite/凭据、不自动迁移或清空业务库、不在 API/Worker 运行用户脚本或 Office I/O。外部服务不可达时返回真实 unavailable/错误，不能宣称真实账号联调通过。Office 编辑的版式需要实际文件验证，不把文本读回当作可视化保真；通用插件/CLI 的全部第三方安装生命周期不属于静态内置工具迁入。

## 验证与交付

沿用已批准总设计的测试与构建授权。建立桌面工具清单与云端覆盖回归；Widget 校验、实时消息及历史恢复/受限 iframe；记忆 owner/会话/空间隔离与配额；生成/编辑 DOCX/XLSX/PPTX 原子失败、备份和结构内容；web_fetch 受控内容读取；确认注册、提示词与沙箱均无 lianxiang_* 工具。类型、Web/执行镜像构建后，在临时沙箱验证实际操作并清理，当前无活动任务时重启。真实外部业务服务无法联调时明确记录边界。

## 本轮验证记录

40 项工具/消息/记忆/会话/Web 定向回归及 21 项 prompt 回归通过；npm run build（代码生成、双端 TypeScript、Vite）通过；沙箱镜像重建完成。临时 OpenSandbox 实际验证三类 Office 生成/读取、四编辑工具、版本备份、编辑与生成失败原文件不变、输入副本、越界符号链接拒绝及网盘协议不可用，已清理。Widget 校验/历史适配回归与实时事件链代码审查通过；未宣称完整浏览器交互或 Office 视觉保真测试。web_fetch 复用既有 pi-web-access，原网络环境的 fake-IP 抓取限制不在本轮放宽。
