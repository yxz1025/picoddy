# PiCoddy 品牌素材

- `picoddy-icon-concept.png`：三款方向对比图，用户选择 01「折叠回环」（2026-10-29）。
- `picoddy-icon.png`：透明背景正式母版，由 OpenAI imagegen 基于初稿生成。
- 产品名：`PiCoddy`；包名、发布目录等机器标识：`picoddy`。
- 欢迎标题：你好，我是 PiCoddy
- 欢迎副标题：从一个想法开始，一起把事情做成。
- 产品说明：你的开源 AI 工作伙伴

图标为象牙白与薄荷绿构成的折叠回环，配炭黑圆角底。已替代原 π 标识，不使用字母、数学符号或角色表情。保持完整比例，不拉伸；透明外缘适配深浅背景。

使用内置 OpenAI imagegen，根据已选的 01 方向生成正式透明母版。生成要求记录在 `picoddy-icon-prompt.md`。运行 `python scripts/generate-brand-icons.py` 可从母版重新导出全部尺寸（需要 Pillow；macOS 使用 iconutil 生成 ICNS）。

已导出的应用素材位于 `resources/app-icon.png`、`resources/app-icon.ico`、`resources/app-icon.icns` 和 `resources/app-icon.iconset/`。网页与会话头像位于 `frontend/public/` 和 `cloud/web/public/`。ICO 包含 16、24、32、48、64、128、256 像素；ICNS 包含标准与 Retina 尺寸。

这些素材替代项目自身的旧品牌。第三方连接器的产品标识不属于 PiCoddy 品牌，不应替换。
