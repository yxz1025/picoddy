# 会员运营专家

> WorkBuddy Agent 型专家 · `membership-ops-expert` · v1.0.0

把会员体系当成**要算清账的金融产品**来设计，而不是一份漂亮的 PPT。
交付物是一份**精美、自包含、可交互的 HTML 方案报告**——打开就能拿去汇报和执行。

---

## 一、这个专家能做什么

| 模块 | 交付内容 |
|---|---|
| **现状诊断** | 交互式访谈 → 业务适配度判断 → 11 项健康度体检 → 问题优先级矩阵 → 数据缺口清单 |
| **会员体系架构** | 会员制形态选型、等级档数与门槛（分位数法测算）、成长值公式、保级降级机制、付费会员定价与回本模型 |
| **权益体系** | 感知价值/成本四象限、100+ 权益弹药库、记忆点权益设计、权益成本三情景测算 |
| **积分经济** | 汇率定价、发放系数、行为价目表、出口结构、**积分负债五池模型**、沉淀率估算、通胀治理 |
| **生命周期运营** | 六阶段模型、RFM 八分群、CLV 测算、Cohort 留存、流失预警、12 条分群动作剧本（含话术） |
| **活动与日历** | 30+ 活动机制库、ROI 模型、A/B 实验设计、防薅羊毛、年度营销日历 |
| **合规检查** | 中国大陆促销合规红线自查（有奖销售、价格促销、自动续费、预付卡、个人信息、积分清零、裂变） |
| **报告交付** | 12 章标准结构 HTML 报告，含内联 SVG 图表 + 可调参数测算器 |

---

## 二、和普通"会员方案"的区别

1. **先算账再提案。**任何权益/积分规则，先给单会员年化成本，再谈效果。方案必含**三张账**：权益成本账、积分负债账、生命周期迁移账。
2. **增量思维（Uplift）。**不为"本来就会发生的行为"付费。明确区分自然发生率与增量转化，强制要求 holdout 对照组。
3. **积分是负债，不是营销费。**建五池模型（发行/流通/核销/沉淀/清零），给出会计口径与敏感性测算。
4. **合规前置。**涉及抽奖、赠品、折价、自动续费、储值、积分清零、个性化推荐时，主动逐项核对红线，报告单列合规章节。
5. **老体系迁移必给方案。**积分换算、等级映射、老会员安抚、沟通节奏、客诉预案、灰度策略——实操中最容易翻车、也最少人写的部分。
6. **强交互。**分 2 轮结构化提问（带选项和默认值，可批量回答），出稿前给方案大纲确认，交付后给 3 个深化方向。

---

## 三、目录结构

```
membership-ops-expert/
├── .picoddy-plugin/
│   └── plugin.json                      # 市场配置
├── avatars/
│   └── expert.png                       # 512×512 头像
├── agents/
│   └── membership-ops-expert.md         # 专家系统提示词（含交互协议与 SOP）
├── skills/
│   ├── membership-diagnosis/            # 诊断与访谈
│   │   ├── SKILL.md
│   │   └── references/{industry-benchmarks,interview-bank}.md
│   ├── tier-benefit-design/             # 等级与权益
│   │   ├── SKILL.md
│   │   ├── references/{tier-models,benefit-library}.md
│   │   └── scripts/tier_calc.py
│   ├── points-economy/                  # 积分经济
│   │   ├── SKILL.md
│   │   ├── references/{points-accounting,points-design-patterns}.md
│   │   └── scripts/points_model.py
│   ├── lifecycle-ops/                   # 生命周期运营
│   │   ├── SKILL.md
│   │   └── references/{rfm-clv-cookbook,segment-playbooks}.md
│   ├── campaign-playbook/               # 活动与日历
│   │   ├── SKILL.md
│   │   ├── references/{campaign-library,compliance-redlines}.md
│   │   └── scripts/campaign_roi.py
│   └── membership-report/               # HTML 报告
│       ├── SKILL.md
│       ├── references/{design-system,chart-recipes}.md
│       └── templates/report-template.html
└── README.md
```

---

## 四、内置测算脚本（纯标准库，无需安装依赖）

```bash
# 等级门槛（分位数法）+ 人数分布 + 升级难度校验
python3 skills/tier-benefit-design/scripts/tier_calc.py tiers --data spend.csv --column amount --levels 3

# 权益成本三情景测算（保守 / 基准 / 压力）
python3 skills/tier-benefit-design/scripts/tier_calc.py benefit --demo

# 付费会员定价与回本
python3 skills/tier-benefit-design/scripts/tier_calc.py paid \
    --price 99 --perceived-saving 320 --member-gmv 3600 --control-gmv 2400 \
    --gross-margin 0.35 --benefit-cost 60

# 积分发放系数反推
python3 skills/points-economy/scripts/points_model.py design \
    --gmv 50000000 --target-cost-rate 0.008 --redemption 0.6

# 积分负债五池 + 沉淀率敏感性
python3 skills/points-economy/scripts/points_model.py liability \
    --issued 120000000 --redeemed 55000000 --expired 8000000

# 12 个月流通池推演（含大促加倍与成本熔断）
python3 skills/points-economy/scripts/points_model.py simulate \
    --monthly-gmv 4000000 --growth 0.03 --rate 1 --redemption 0.55 \
    --campaign-months 6,11 --cost-rate-cap 0.012

# 兑换出口效率（负债消化效率）
python3 skills/points-economy/scripts/points_model.py outlet --demo

# 活动 ROI / 盈亏平衡 / A-B 样本量 / 年度日历
python3 skills/campaign-playbook/scripts/campaign_roi.py roi \
    --reach 50000 --participate-rate 0.12 --test-gmv 320 --control-gmv 240 \
    --gross-margin 0.45 --benefit-cost-per-user 18 --fixed-cost 20000
python3 skills/campaign-playbook/scripts/campaign_roi.py sample --baseline 0.08 --mde 0.015
python3 skills/campaign-playbook/scripts/campaign_roi.py calendar --brand "某某品牌" --member-day 8
```

---

## 五、报告模板

`skills/membership-report/templates/report-template.html` 是一个**开箱即用的完整模板**：

- 单文件自包含，**零外部依赖**（无 CDN / 外链字体 / 外链图片）
- 12 章结构，含 9 张内联 SVG 图表（漏斗、金字塔、四象限、环形、分组柱状、五池流向、甘特…）
- **可调参数的积分成本测算器**（拖动滑块实时出结果与安全判定）
- 侧边目录 + 阅读进度 + 章节折叠 + 深浅色切换（跟随系统 & 手动，带记忆）
- 响应式（375px 无横向滚动，宽表独立滚动）+ 打印适配

---

## 六、使用示例

```
帮我从 0 到 1 设计一套会员体系，并输出可落地的 HTML 方案报告
诊断我现有的积分体系，算清积分成本与积分负债，给出优化方案
为我的会员做全生命周期分层运营，并规划一年的会员活动日历
我们要把旧会员体系升级换代，帮我出迁移方案（积分怎么换、等级怎么映射、老会员怎么安抚）
帮我算一下做付费会员划不划算，定价多少合适
```

---

## 七、边界

- 不做法律意见书——合规部分是运营层面的风险提示清单，具体判定请咨询法务
- 不做财务审计——积分负债为管理会计口径测算，对外报表口径需财务确认
- 不做系统开发——输出的是产品与运营需求（字段、规则、运营指标）
- 不编造用户的经营数据——数据缺失时用行业经验值代入并**显式登记为假设**

---

## 八、上架前需要替换的项

| 位置 | 字段 | 说明 |
|---|---|---|
| `.picoddy-plugin/plugin.json` | `author.name` / `author.email` | 当前为占位值，请改为实际开发者信息 |
| `avatars/expert.png` | 头像 | AI 生成的统一专业漫画插画（粉品红背景，512×512 PNG，<500KB）；如需替换，保持文件名与尺寸不变 |

打包提交（**根目录名须与 plugin.name 一致，用 ASCII，避免中文目录名在审核流水线中乱码；且必须排除 `playbooks/`**）：

```bash
STAGE=$(mktemp -d)
rsync -a --exclude='.DS_Store' --exclude='playbooks' \
      --exclude='__pycache__' --exclude='*.pyc' --exclude='.playwright-mcp' \
      "会员运营专家/" "$STAGE/membership-ops-expert/"
(cd "$STAGE" && zip -rq membership-ops-expert.zip membership-ops-expert/)
mv "$STAGE/membership-ops-expert.zip" .
```

已生成两个包：

| 包 | 内容 | 提交去向 |
|---|---|---|
| `../membership-ops-expert.zip` | 专家本体（plugin.json / agents / skills / avatars / README） | 专家市场审核 |
| `../membership-ops-playbooks.zip` | 3 个灵感模块案例（case.json + output.html + cover.png） | 灵感模块（Discover）联动展示位 |

---

## 九、灵感模块（Playbook）案例

`playbooks/` 下有 3 个配套案例，对应专家的三条 `quickPrompts`：

| # | 案例 | 场景 | 产物 |
|---|---|---|---|
| 01 | 会员体系 0→1 全案 | 从零搭建（茶饮连锁示例） | 12 章完整方案报告 |
| 02 | 积分体系诊断 | 积分没人用 + 成本失控（美妆示例） | 积分专项诊断报告 |
| 03 | 全生命周期分层 + 年度日历 | 老客留不住（母婴示例） | 生命周期运营手册 |

> 灵感模块要求「Prompt 一次成功，不是多轮对话完成」，与本专家默认的 2 轮访谈冲突。
> 解决方式是专家内置的**一次成型模式**（`agents/membership-ops-expert.md` §3.6）：从灵感模块进入或参数已给全时，自动跳过访谈直接产出，并在报告首页列出「我替你做的关键决策」。
>
> 详见 `playbooks/README.md`。
