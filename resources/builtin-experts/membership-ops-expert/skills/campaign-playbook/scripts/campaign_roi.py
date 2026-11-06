#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
活动 ROI 测算器（纯标准库）

子命令：
  roi        活动 ROI 测算（基于实验组/对照组人均 GMV 差）
  breakeven  盈亏平衡分析：需要多大增量才能回本
  sample     A/B 实验样本量估算
  calendar   生成年度会员营销日历骨架（Markdown）

用法示例：
  python3 campaign_roi.py roi --reach 50000 --participate-rate 0.12 \
      --test-gmv 320 --control-gmv 240 --gross-margin 0.45 \
      --benefit-cost-per-user 18 --touch-cost-per-user 0.04 --fixed-cost 20000
  python3 campaign_roi.py breakeven --total-cost 80000 --gross-margin 0.45 --participants 6000
  python3 campaign_roi.py sample --baseline 0.08 --mde 0.015
  python3 campaign_roi.py calendar --brand "某某品牌" --member-day 8
"""

import argparse
import math


# ---------------------------------------------------------------- roi


def cmd_roi(args):
    reach = args.reach
    participants = reach * args.participate_rate
    lift_per_user = args.test_gmv - args.control_gmv
    incr_gmv = lift_per_user * participants
    incr_margin = incr_gmv * args.gross_margin

    benefit_cost = args.benefit_cost_per_user * participants
    touch_cost = args.touch_cost_per_user * reach
    total_cost = benefit_cost + touch_cost + args.fixed_cost

    roi = (incr_margin - total_cost) / total_cost if total_cost else 0

    print("=" * 76)
    print("活动 ROI 测算")
    print("=" * 76)
    print("触达人数           ：%s" % "{:,.0f}".format(reach))
    print("参与率 / 参与人数   ：%.1f%% / %s" % (args.participate_rate * 100, "{:,.0f}".format(participants)))
    print()
    print("实验组人均 GMV     ：%.2f 元" % args.test_gmv)
    print("对照组人均 GMV     ：%.2f 元  ← 必须是随机 holdout，不能是『未参与者』" % args.control_gmv)
    print("人均增量           ：%.2f 元" % lift_per_user)
    print("增量 GMV           ：%s 元" % "{:,.0f}".format(incr_gmv))
    print("增量毛利           ：%s 元（毛利率 %.0f%%）" % ("{:,.0f}".format(incr_margin), args.gross_margin * 100))
    print()
    print("成本构成：")
    print("  权益/奖品成本    ：%s 元（%.2f/人 × %s 参与）"
          % ("{:,.0f}".format(benefit_cost), args.benefit_cost_per_user, "{:,.0f}".format(participants)))
    print("  触达成本        ：%s 元（%.3f/人 × %s 触达）"
          % ("{:,.0f}".format(touch_cost), args.touch_cost_per_user, "{:,.0f}".format(reach)))
    print("  固定/人力成本    ：%s 元" % "{:,.0f}".format(args.fixed_cost))
    print("  合计            ：%s 元" % "{:,.0f}".format(total_cost))
    print()
    print("净收益             ：%s 元" % "{:,.0f}".format(incr_margin - total_cost))
    print("ROI                ：%.2f" % roi)
    if roi > 3:
        print("→ 🟢 优秀：可加大投入或考虑常态化")
    elif roi >= 1:
        print("→ 🟢 良好：净收益为正且回报可观，可优化人群精准度后放量")
    elif roi > 0:
        print("→ 🟡 微利：净收益为正但回报有限，需压缩成本或提高人群精准度")
    elif roi == 0:
        print("→ 🟡 打平：刚好覆盖成本，仅在有战略目的时保留")
    else:
        print("→ 🔴 亏损：立即复盘，重点排查是否补贴了本来就会发生的购买")

    print()
    print("敏感性（人均增量变化对 ROI 的影响）：")
    print("  %-16s %16s %10s" % ("人均增量(元)", "增量毛利(元)", "ROI"))
    for delta in (0.5, 0.75, 1.0, 1.25, 1.5):
        lu = lift_per_user * delta
        im = lu * participants * args.gross_margin
        r = (im - total_cost) / total_cost if total_cost else 0
        mark = " ←当前" if abs(delta - 1.0) < 1e-9 else ""
        print("  %-16.2f %16s %10.2f%s" % (lu, "{:,.0f}".format(im), r, mark))

    print()
    print("⚠ 提醒：观察窗口应覆盖活动后 30 天，排查『需求透支』——")
    print("   若活动后 30 天 GMV 显著低于常态，说明只是把未来的购买提前了，真实增量要打折。")


# ---------------------------------------------------------------- breakeven


def cmd_breakeven(args):
    need_margin = args.total_cost
    need_gmv = need_margin / args.gross_margin
    per_user_gmv = need_gmv / args.participants if args.participants else 0

    print("=" * 68)
    print("盈亏平衡分析")
    print("=" * 68)
    print("活动总成本        ：%s 元" % "{:,.0f}".format(args.total_cost))
    print("毛利率            ：%.0f%%" % (args.gross_margin * 100))
    print("预计参与人数      ：%s" % "{:,.0f}".format(args.participants))
    print()
    print("要回本，需要：")
    print("  增量毛利 ≥ %s 元" % "{:,.0f}".format(need_margin))
    print("  增量 GMV ≥ %s 元" % "{:,.0f}".format(need_gmv))
    print("  人均增量 GMV ≥ %.2f 元  ★ 这是最关键的一个数" % per_user_gmv)
    print()
    print("对照检查：这个人均增量相对于你的客单价合理吗？")
    if args.atv:
        ratio = per_user_gmv / args.atv
        print("  客单价 %.2f 元 → 需要人均多买 %.2f 单" % (args.atv, ratio))
        if ratio > 1.0:
            print("  🔴 需要人均多买超过 1 单才能回本，目标偏激进，建议降低成本或缩小人群")
        elif ratio > 0.5:
            print("  🟡 需要人均多买半单以上，有挑战但可行")
        else:
            print("  🟢 目标合理")
    print()
    print("ROI 目标下的要求：")
    for target in (1, 2, 3):
        gmv = (args.total_cost * (1 + target)) / args.gross_margin
        print("  ROI=%d → 需增量 GMV %s 元，人均 %.2f 元"
              % (target, "{:,.0f}".format(gmv), gmv / args.participants if args.participants else 0))


# ---------------------------------------------------------------- sample size


def cmd_sample(args):
    """双样本比例检验样本量估算，alpha=0.05 双侧, power=0.8"""
    p1 = args.baseline
    p2 = args.baseline + args.mde
    z_alpha = 1.96
    z_beta = 0.84
    p_bar = (p1 + p2) / 2
    numerator = (z_alpha * math.sqrt(2 * p_bar * (1 - p_bar))
                 + z_beta * math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2
    n = numerator / ((p2 - p1) ** 2)

    print("=" * 68)
    print("A/B 实验样本量估算")
    print("=" * 68)
    print("基线转化率          ：%.2f%%" % (p1 * 100))
    print("希望检测的最小提升   ：%.2f pp（即提升到 %.2f%%）" % (args.mde * 100, p2 * 100))
    print("显著性水平 α        ：0.05（双侧）")
    print("统计功效 power      ：0.80")
    print()
    print("→ 每组需要样本量    ：%s 人" % "{:,.0f}".format(math.ceil(n)))
    print("→ 两组合计          ：%s 人" % "{:,.0f}".format(math.ceil(n) * 2))
    print()
    if n > 100000:
        print("⚠ 样本量过大，实际难以满足。建议：")
        print("   ① 放宽最小可检测提升（MDE），只检测更大的效果")
        print("   ② 改用时间轮换设计（本周 A、下周 B），但需控制季节性影响")
        print("   ③ 用连续指标（人均 GMV）代替比例指标，通常所需样本更小")
    elif n < 500:
        print("🟢 样本量要求不高，容易达成")
    else:
        print("🟡 样本量适中，注意保证随机分流质量（按 user_id 哈希，不要按时间/地区分）")
    print()
    print("提醒：观察期至少覆盖 1 个购买周期 T，并额外观察活动后 30 天是否存在需求透支。")


# ---------------------------------------------------------------- calendar


CALENDAR = [
    (1, "开年焕新 / 春节", "囤货、送礼场景；节前 2 周启动", "拉新 + 客单"),
    (2, "情人节 / 元宵 / 开工", "情感向、小额高频", "活跃"),
    (3, "春季上新 / 女王节", "新品优先购给高等级会员", "等级牵引"),
    (4, "品牌日 / 春季会员周", "纯会员专属，强化身份", "渗透 + 情感"),
    (5, "母亲节 / 五一", "礼赠场景，套装组合", "客单"),
    (6, "618 大促", "会员预售专享 + 积分加倍(设上限)", "GMV"),
    (7, "暑期 / 年中会员盘点", "半年账单 + 积分消耗活动", "积分健康度"),
    (8, "周年庆 / 七夕", "按入会年限差异化权益", "情感 + 复购"),
    (9, "秋季上新 / 开学季", "跨品类拓展任务", "品类渗透"),
    (10, "国庆 / 秋季会员周", "召回专场：沉睡会员回归礼", "召回"),
    (11, "双 11", "会员预售 + 非价格特权（优先发货/专属客服）", "GMV"),
    (12, "双 12 / 年末冲刺 / 年度账单", "保级冲刺 + 年度账单 + 续费引导", "保级 + 续费"),
]


def cmd_calendar(args):
    brand = args.brand or "品牌"
    md = args.member_day

    print("# %s 年度会员营销日历（骨架）\n" % brand)
    print("## 常态层（全年不变，建立用户预期）\n")
    print("| 动作 | 节奏 | 说明 |")
    print("|---|---|---|")
    print("| **会员日** | 每月 %d 日 | 双倍积分 + 会员专享价 + 积分兑换折上折；建议排在销售低谷日 |" % md)
    print("| 积分商城上新 | 每月 1 日 | 至少更换 20% 的兑换品 |")
    print("| 生日营销 | 滚动触发 | 生日前 7 天预告 / 当天权益 / 后 3 天到期提醒 |")
    print("| 自动化旅程 | 事件触发 | 首购→二购、权益激活、升级冲刺、保级提醒、到期提醒 |")
    print()
    print("## 脉冲层（季度大动作）\n")
    print("| 月份 | 主题 | 会员侧动作 | 主攻指标 |")
    print("|---|---|---|---|")
    for m, theme, action, target in CALENDAR:
        print("| %d 月 | %s | %s | %s |" % (m, theme, action, target))
    print()
    print("## 机动层（随时可上，用于补窟窿）\n")
    print("- 积分流通池连续膨胀 → 限时兑换活动（积分五折兑）")
    print("- 某月 GMV 缺口 → 定向人群冲刺（高潜人群 + 短效券）")
    print("- 竞品动作 → 高价值客防守（RFM #1/#2 专属触达）")
    print("- 沉睡率上升 → 召回专场")
    print()
    print("## 排期纪律\n")
    print("1. 两个大活动之间留 2 周空窗，避免疲劳与互相稀释")
    print("2. 大促期会员权益给『非价格』的，避免双重让利击穿毛利")
    print("3. 每季度至少一次纯情感活动（无直接销售目标）")
    print("4. 每个活动保留 5–10% holdout 对照组")
    print("5. 每个活动结束后 7 天内完成复盘，沉淀进全年 ROI 台账")


# ---------------------------------------------------------------- main


def main():
    p = argparse.ArgumentParser(description="活动 ROI 测算器")
    sub = p.add_subparsers(dest="cmd", required=True)

    r = sub.add_parser("roi", help="活动 ROI 测算")
    r.add_argument("--reach", type=float, required=True, help="触达人数")
    r.add_argument("--participate-rate", type=float, required=True, help="参与率，小数")
    r.add_argument("--test-gmv", type=float, required=True, help="实验组人均 GMV")
    r.add_argument("--control-gmv", type=float, required=True, help="对照组人均 GMV")
    r.add_argument("--gross-margin", type=float, default=0.4, help="毛利率，小数")
    r.add_argument("--benefit-cost-per-user", type=float, default=0, help="人均权益成本")
    r.add_argument("--touch-cost-per-user", type=float, default=0, help="人均触达成本")
    r.add_argument("--fixed-cost", type=float, default=0, help="固定成本(人力/制作/物料)")
    r.set_defaults(func=cmd_roi)

    b = sub.add_parser("breakeven", help="盈亏平衡分析")
    b.add_argument("--total-cost", type=float, required=True)
    b.add_argument("--gross-margin", type=float, required=True)
    b.add_argument("--participants", type=float, required=True)
    b.add_argument("--atv", type=float, default=0, help="客单价，用于合理性校验")
    b.set_defaults(func=cmd_breakeven)

    s = sub.add_parser("sample", help="A/B 实验样本量估算")
    s.add_argument("--baseline", type=float, required=True, help="基线转化率，小数")
    s.add_argument("--mde", type=float, required=True, help="最小可检测提升，小数(绝对值)")
    s.set_defaults(func=cmd_sample)

    c = sub.add_parser("calendar", help="生成年度营销日历骨架")
    c.add_argument("--brand", help="品牌名")
    c.add_argument("--member-day", type=int, default=8, help="会员日日期，默认每月 8 日")
    c.set_defaults(func=cmd_calendar)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
