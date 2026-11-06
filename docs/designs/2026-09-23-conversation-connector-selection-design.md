# 按会话恢复连接器选择

## 背景与现状
composerConnectors 是单份界面状态，selectConversation 默认清空，回到会话不能恢复。发送消息已经保留选择。

## 目标
当前应用运行期间按 conversationId 保存选择，切换回来恢复；手动增删同步保存，删除会话清理。欢迎页选择在首次发送创建会话时绑定到新会话。

## 非目标
不持久化到磁盘，不修改启动、后端工具注入、授权、会话消息与交付物。应用重启后不恢复连接器选择。

## 方案
Zustand 增加 composerConnectorsByConversation。增删连接器同时更新当前会话映射；切换使用目标会话选择。preserveComposerConnector 仅在欢迎页创建会话时转移草稿，已存在会话的选择优先。需求隔离会话使用普通恢复路径，避免继承其他会话的连接器。删除会话同时删除映射。

## 影响范围
useStore、ProjectPanel 与 MCP 文档，纯前端跨平台状态修改。

## 风险与验证
区分欢迎页草稿与已有会话，保留空数组代表主动清空，避免恢复旧选项。静态审查普通会话、需求阶段切换、创建和删除路径；执行 TypeScript 与 git diff --check，不运行测试或构建。
