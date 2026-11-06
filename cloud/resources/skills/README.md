# 内置技能来源

以下文件从桌面端 resources/builtin-skills 复制到独立云端目录，后续分别维护：

- data-analysis/SKILL.md
- weekly-report/SKILL.md
- polish-writing/SKILL.md

复制时间：2026-10-12。这些技能只引用已适配的 read_doc/write_docx/write_xlsx。
其他桌面技能尚未自动迁入，避免把 Electron 专有工具指令当成云端可用能力。
管理员可用 `npm run seed-skills -- --email user@example.com` 为指定用户安装这三个技能。
技能版本由云端解析器按内容计算，重复执行不覆盖用户已修改或升级的同名技能。
