# 样式变量与视觉基线

状态与发布条件见 [overview.md](overview.md)。以下 `--prd-*` 是给交互 PRD 提出的语义变量（C），并非仓库已经存在的 CSS 变量。源码事实（F）和统一建议分别列出；全部尚待负责人确认。

## 来源优先级

负责人已批准的规范 > 有入口导入证据的共享样式 > 代表性页面的局部样式。构建主题只证明配置意图；最终呈现须结合 CSS 导入及浏览器计算样式核验。不能从某个历史页面随手取色作为默认主题。

| 候选变量 | 值 | 源码事实或建议依据 |
| --- | --- | --- |
| `--prd-color-primary` | `#1375F2` | 构建主题配置 `primary-color`；待确认有效主题，见 X-03 |
| `--prd-color-success` | `#26B668` | 同文件 `success-color` |
| `--prd-color-error` | `#FF5151` | 同文件 `error-color` |
| `--prd-color-text` | `#102048` | 共享文字样式 `.g-text-default`；候选统一正文色，不代表所有 Antd 文本现状 |
| `--prd-color-disabled` | `#a9a9b8` | 同文件 `.g-text-disable`；不能替代所有禁用背景和边框 |
| `--prd-color-secondary` | `#8c8c8c` | 要盒需求弹窗 `.font_size`，局部辅助文字，候选提升 |
| `--prd-color-surface` | `#fff` | `rankPrice` 的白底；候选卡片底色 |
| `--prd-color-page` | `#ececec` | 独立运行外壳 独立运行 `.pl`，微前端宿主背景另行核验 |
| `--prd-color-border` | `#ebedf0` | 返回标题组件 局部边框，候选提升 |
| `--prd-font-size` | `14px` | `.g-text` |
| `--prd-font-caption` | `12px` | `.g-text-12` |
| `--prd-font-title` | `16px` | `.g-text-title` |
| `--prd-line-height` | `24px` | `.g-lh-24`；为正文选择的候选值，不继承 `.g-text-default` 的 48px |
| `--prd-control-height` | `32px` | 共享筛选样式 筛选表单控件容器高度；不是所有控件实测高度 |
| `--prd-radius` | `4px` | 原型统一建议；尚无已核实的全局圆角 token |
| `--prd-space-1/2/3/4/6/8` | `4/8/12/16/24/32px` | `.g-ml-*` 等提供这些值；候选采用子集，源码也有 6、10、20、40、64 等 |

字体候选：`-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`。这是跨平台原型建议；源码仅在部分文字类指定 `PingFangSC-Semibold` 等，未核实统一字体栈。警告色、hover/active、焦点、阴影尚未建立已核实 token；在真实 Vue 页面保留组件库行为，独立原型补充时标注新增候选。

## 布局与密度（C）

- 列表采用白色内容卡片；原型候选内边距 24px，页面区块间距 24px，控件及按钮间距 8px。这是收敛建议，不是全局已定义常量。
- 筛选区沿用 `table-page-search-wrapper`：行间距 24px，label 右间距 8px。长表单和多行输入不强制 32px 高。
- 表格采用现有 `size="default"` 风格；不固定每行高度，长内容可省略并查看全文，操作列保持可达。
- 旧公共样式 有表格上下 padding 15px，但不在 入口样式 的直接导入链，不能宣布所有表格都生效。
- 桌面筛选参考样本的 xxl=6、lg=8、md=12、sm=24 栅格；窄屏纵向堆叠。表格可以横向滚动，不把桌面后台变成小程序样式。
- 共享筛选样式 的操作区 margin-bottom 18px 与 旧公共样式 的 8px 有差异；候选统一选 16px，发布前负责人确认。

## 原型 CSS 起点（C，评审预览用）

```css
.prd-box {
  --prd-color-primary: #1375f2;
  --prd-color-success: #26b668;
  --prd-color-error: #ff5151;
  --prd-color-text: #102048;
  --prd-color-secondary: #8c8c8c;
  --prd-color-disabled: #a9a9b8;
  --prd-color-page: #ececec;
  --prd-color-surface: #fff;
  --prd-color-border: #ebedf0;
  --prd-font-size: 14px;
  --prd-font-caption: 12px;
  --prd-font-title: 16px;
  --prd-line-height: 24px;
  --prd-control-height: 32px;
  --prd-radius: 4px;
  --prd-space-1: 4px;
  --prd-space-2: 8px;
  --prd-space-3: 12px;
  --prd-space-4: 16px;
  --prd-space-6: 24px;
  --prd-space-8: 32px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: var(--prd-font-size);
  line-height: var(--prd-line-height);
  color: var(--prd-color-text);
  background: var(--prd-color-page);
}
.prd-box .prd-card {
  background: var(--prd-color-surface);
  padding: var(--prd-space-6);
  border-radius: var(--prd-radius);
}
.prd-box .prd-actions { display: flex; gap: var(--prd-space-2); }
```

变量限定在原型容器；挂到 body 的弹层要显式继承变量或放入同一作用域。不要把这些变量写回生产全局样式而声称已完成主题迁移。视觉审核至少对比主按钮、正文、筛选、表头、弹窗、禁用态和焦点态；颜色之外用文字表达成功、错误和禁用原因。
