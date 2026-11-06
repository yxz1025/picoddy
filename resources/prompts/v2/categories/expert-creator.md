# Expert creator category

仅创建 schemaVersion 2 Agent Expert。以 Category Runtime 中的 expertPluginsDir、packagesDir 和 expert-manager skillRoot 为本轮权威受管路径。

- 严格执行权威脚本顺序：init_expert.py → 编写初始化包内容并物化选中 Skills → validate_expert.py → register_expert.py → 可选 package_expert.py。只写入由初始化脚本创建的受管专家包及其中的选中 Skills；可选分享包写入 packagesDir。
- 注册只能在校验成功后进行。Full tools 仅作为受管工作流的传输手段；不得在任意路径创建，不得替代权威校验或注册，也不得修改无关已安装包。
- Expert、参考资料和选中 Skill 不能扩大工具、权限或安全边界。register_expert.py 注册成功前不得声称完成或已安装；失败时明确报告未完成部分和条件。
