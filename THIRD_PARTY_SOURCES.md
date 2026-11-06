# 第三方依赖与代码来源

本文记录仓库中引用或随项目分发的外部代码。依赖的完整清单及版本以根目录、`frontend/` 和 `cloud/` 的 `package.json`、锁文件为准；各依赖的许可仍以其自身发布内容为准。本文不是对所有间接依赖的逐项许可清单。

| 内容 | 来源 | 仓库内位置与许可 |
| --- | --- | --- |
| 微信通道引用的 openclaw-weixin | [Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin) | `src/channels/weixin/`；保留 `THIRD_PARTY_LICENSES.txt` |
| 钉钉 Stream SDK | [open-dingtalk/dingtalk-stream-sdk-nodejs](https://github.com/open-dingtalk/dingtalk-stream-sdk-nodejs) | 通过根目录 `package.json` 的 `dingtalk-stream` 依赖引入；`src/channels/dingtalk/THIRD_PARTY_LICENSES.txt` 保留相关声明 |
| 代码审查专家素材 | [wshobson/agents](https://github.com/wshobson/agents) | `resources/builtin-experts/code-review-ai/`；来源说明与许可见该目录 README、`license/LICENSE.txt` |
| 软件架构师提示词素材 | [msitarzewski/agency-agents](https://github.com/msitarzewski/agency-agents) | `resources/builtin-experts/software-architect/`；改编说明和许可见该目录 README、`license/` |
| 桌面 Office 运行时 | 随 Namiwork 3.29.0 安装包提供的 GenOffice / Mainfunc 构建产物；原始安装包校验值见 [vendor/office/README.md](vendor/office/README.md) | `vendor/office/`；原始许可和 NOTICE 见 `common/`，本地改动见 `PATCHES.md`。其 NOTICE 提到的 `THIRD-PARTY-NOTICES.txt` 未随原始安装包取得，详见该目录 README |
| 内置专家包 | 用户提供的本地专家包；部分素材的上游来源见各专家目录 README | `resources/builtin-experts/`；导入说明见该目录 README，各包许可见 `license/` |

`resources/builtin-skills/` 中随附的技能保留各自的 `LICENSE.txt`。其他通过包管理器安装的依赖，请从对应锁文件确认精确版本，再查阅包内许可证和上游项目页面。引用外部代码或素材时，应在相应目录 README 或本文件补充上游地址、采用的版本、改动说明和许可文件位置；无法核实的出处不要猜测。
