#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
积分经济模型测算器（纯标准库）

子命令：
  design     反推发放系数：给定 GMV / 目标成本率 / 预计核销率 → 推荐 r 与汇率
  liability  积分负债五池模型 + 沉淀率敏感性
  simulate   12 个月流通池推演（含增长、大促加倍、熔断）
  outlet     兑换出口效率评估（负债消化效率）

用法示例：
  python3 points_model.py design --gmv 50000000 --target-cost-rate 0.008 --redemption 0.6
  python3 points_model.py liability --issued 120000000 --redeemed 55000000 --expired 8000000 --unit-value 0.01
  python3 points_model.py simulate --monthly-gmv 4000000 --growth 0.03 --rate 1 --unit-value 0.01 \
      --redemption 0.55 --campaign-months 6,11 --campaign-multiplier 2 --cost-rate-cap 0.012
  python3 points_model.py outlet --demo
"""

import argparse
import json
import os
import sys

# ---------------------------------------------------------------- design


def cmd_design(args):
    gmv = args.gmv
    target = args.target_cost_rate
    red = args.redemption
    v = args.unit_value

    # 积分成本率 = r * v * redemption  =>  r = target / (v * redemption)
    r = target / (v * red)

    print("=" * 72)
    print("发放系数反推")
    print("=" * 72)
    print("年 GMV                ：%s 元" % "{:,.0f}".format(gmv))
    print("目标积分成本率        ：%.3f%% of GMV" % (target * 100))
    print("预计核销率            ：%.0f%%" % (red * 100))
    print("单位积分价值          ：%.4f 元/分（即 %.0f 积分 = 1 元）" % (v, 1 / v))
    print()
    print("→ 推荐发放系数 r = %.2f 分/元" % r)
    print("  即：消费 1 元发放 %.2f 积分；名义让利率 %.2f%%；实际成本率 %.3f%%"
          % (r, r * v * 100, target * 100))
    print()
    print("年度测算：")
    issued = gmv * r
    nominal = issued * v
    actual = nominal * red
    print("  年发行积分   ：%s 分" % "{:,.0f}".format(issued))
    print("  名义价值     ：%s 元（= 潜在负债上限）" % "{:,.0f}".format(nominal))
    print("  预计实际成本 ：%s 元（= 名义 × 核销率）" % "{:,.0f}".format(actual))
    print()
    print("敏感性（核销率变化对成本的影响）：")
    print("  %-12s %16s %14s" % ("核销率", "实际成本(元)", "成本率(%GMV)"))
    for rr in (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9):
        c = nominal * rr
        print("  %-12s %16s %13.3f%%" % ("%.0f%%" % (rr * 100), "{:,.0f}".format(c), c / gmv * 100))
    print()
    print("建议：基础系数取保守值（如 r=1），把弹药留给可随时收放的『倍率』——")
    print("      基础系数一旦定高就再也降不下来，而倍率是可控阀门。")


# ---------------------------------------------------------------- liability


def cmd_liability(args):
    I, R, E, v = args.issued, args.redeemed, args.expired, args.unit_value
    O = I - R - E
    if O < 0:
        sys.exit("流通池为负，请检查输入（发行 - 核销 - 过期 应 ≥ 0）")

    print("=" * 72)
    print("积分负债五池模型")
    print("=" * 72)
    print("① 累计发行池 Issued      ：%18s 分" % "{:,.0f}".format(I))
    print("③ 已核销池 Redeemed      ：%18s 分  (%.1f%%)" % ("{:,.0f}".format(R), R / I * 100 if I else 0))
    print("⑤ 已清零池 Expired       ：%18s 分  (%.1f%%)" % ("{:,.0f}".format(E), E / I * 100 if I else 0))
    print("② 流通池 Outstanding     ：%18s 分  (%.1f%%)  ★ 这就是负债"
          % ("{:,.0f}".format(O), O / I * 100 if I else 0))
    print()
    print("单位积分价值：%.4f 元/分" % v)
    print("名义负债 = 流通池 × 单位价值 = %s 元" % "{:,.0f}".format(O * v))
    print()
    print("④ 沉淀率敏感性（预期负债 = 名义负债 × (1 − 沉淀率)）：")
    print("  %-12s %20s" % ("沉淀率 b", "预期负债(元)"))
    for b in (0.15, 0.20, 0.25, 0.30, 0.35, 0.45, 0.55):
        print("  %-12s %20s" % ("%.0f%%" % (b * 100), "{:,.0f}".format(O * v * (1 - b))))
    print()

    hist_red_rate = R / (R + E) if (R + E) > 0 else 0
    print("已结清积分的历史核销率：%.1f%%（= 已核销 ÷ (已核销+已清零)）" % (hist_red_rate * 100))
    print("→ 由此隐含的沉淀率约 %.1f%%，可作为 b 的经验起点" % ((1 - hist_red_rate) * 100))
    print()
    if I and O / I > 0.55:
        print("🔴 流通池占累计发行 %.1f%%（>55%%）：发得比用得快，负债在积累。" % (O / I * 100))
        print("   建议：立刻检查出口结构与兑换门槛，上线『积分+现金』加价购与限时兑换活动。")
    elif I and O / I < 0.20:
        print("🟢 流通池占比 %.1f%%，周转健康。" % (O / I * 100))
    else:
        print("🟡 流通池占比 %.1f%%，处于可接受区间，持续监控。" % (O / I * 100 if I else 0))
    print()
    print("提醒：会计口径下积分通常构成单独履约义务，须计入合同负债/递延收益，")
    print("      兑换或失效时转收入。最终确认口径请与财务核对。")


# ---------------------------------------------------------------- simulate


def cmd_simulate(args):
    campaign_months = set()
    if args.campaign_months:
        campaign_months = {int(x.strip()) for x in args.campaign_months.split(",") if x.strip()}

    gmv = args.monthly_gmv
    v = args.unit_value
    outstanding = args.initial_outstanding
    total_issued = 0.0
    total_redeemed = 0.0
    total_expired = 0.0
    fuse_hits = []
    rate = args.rate

    print("=" * 104)
    print("12 个月积分流通池推演")
    print("参数：月GMV %s 元｜月增长 %.1f%%｜基础系数 %.2f 分/元｜汇率 %.0f:1｜月核销率 %.1f%%｜大促月 %s（×%.1f）"
          % ("{:,.0f}".format(gmv), args.growth * 100, args.rate, 1 / v,
             args.redemption * 100, sorted(campaign_months) or "无", args.campaign_multiplier))
    if args.cost_rate_cap:
        print("熔断阈值：当月积分成本率 > %.2f%% GMV 时，次月倍率自动下调 20%%" % (args.cost_rate_cap * 100))
    print("=" * 104)
    print("%-4s %14s %8s %14s %14s %12s %16s %10s"
          % ("月", "GMV(元)", "系数", "发行(分)", "核销(分)", "过期(分)", "流通池(分)", "成本率"))
    print("-" * 104)

    for m in range(1, 13):
        mult = args.campaign_multiplier if m in campaign_months else 1.0
        eff_rate = rate * mult
        issued = gmv * eff_rate
        # 核销来自流通池（含本月新发）；月周转率 = 年化核销率 / 12
        pool = outstanding + issued
        redeemed = pool * (args.redemption / 12.0)
        expired = 0.0
        if args.expiry_months and m > args.expiry_months:
            expired = pool * args.expiry_rate
        redeemed = min(redeemed, pool)
        expired = min(expired, pool - redeemed)
        outstanding = pool - redeemed - expired

        cost = redeemed * v
        cost_rate = cost / gmv if gmv else 0
        total_issued += issued
        total_redeemed += redeemed
        total_expired += expired

        flag = ""
        if args.cost_rate_cap and cost_rate > args.cost_rate_cap:
            flag = " 🔴熔断"
            fuse_hits.append(m)
            rate = rate * 0.8  # 次月起下调

        print("%-4d %14s %8.2f %14s %14s %12s %16s %9.3f%%%s"
              % (m, "{:,.0f}".format(gmv), eff_rate, "{:,.0f}".format(issued),
                 "{:,.0f}".format(redeemed), "{:,.0f}".format(expired),
                 "{:,.0f}".format(outstanding), cost_rate * 100, flag))
        gmv *= (1 + args.growth)

    print("-" * 104)
    print("全年：发行 %s 分｜核销 %s 分｜过期 %s 分｜期末流通池 %s 分"
          % ("{:,.0f}".format(total_issued), "{:,.0f}".format(total_redeemed),
             "{:,.0f}".format(total_expired), "{:,.0f}".format(outstanding)))
    print("全年积分兑付成本：%s 元" % "{:,.0f}".format(total_redeemed * v))
    print("期末名义负债    ：%s 元" % "{:,.0f}".format(outstanding * v))
    for b in (0.2, 0.3, 0.4):
        print("  沉淀率 %.0f%% → 期末预期负债 %s 元" % (b * 100, "{:,.0f}".format(outstanding * v * (1 - b))))
    if fuse_hits:
        print("\n⚠ 熔断触发月份：%s —— 说明当前发放强度超出预算，需重新规划大促倍率" % fuse_hits)

    retain = outstanding / (args.initial_outstanding + total_issued) if (args.initial_outstanding + total_issued) else 0
    print("\n期末流通池占『期初池+全年发行』的 %.1f%%" % (retain * 100))
    if retain > 0.60:
        print("🔴 发得比用得快，负债在积累。优先增加兑换出口、降低最低兑换门槛，"
              "并考虑一次限时兑换活动集中消化流通池。")
    elif retain > 0.40:
        print("🟡 处于可接受区间，持续监控月度周转率（健康值 3–8%/月）。")
    else:
        print("🟢 周转健康。")


# ---------------------------------------------------------------- outlet

DEMO_OUTLETS = [
    {"name": "积分抵现(≤10%订单)", "points_required": 1000, "cost": 10.0, "expected_share": 0.35},
    {"name": "兑自有商品(售价30/成本9)", "points_required": 2000, "cost": 9.0, "expected_share": 0.25},
    {"name": "积分+现金加价购", "points_required": 1500, "cost": 6.0, "expected_share": 0.20},
    {"name": "联合视频会员月卡", "points_required": 1500, "cost": 5.0, "expected_share": 0.12},
    {"name": "积分抽奖", "points_required": 200, "cost": 0.8, "expected_share": 0.05},
    {"name": "公益捐赠", "points_required": 500, "cost": 5.0, "expected_share": 0.03},
]


def cmd_outlet(args):
    if args.demo:
        outlets = DEMO_OUTLETS
        print("（使用内置示例出口组合）\n")
    else:
        if not args.config or not os.path.exists(args.config):
            sys.exit("请用 --config 提供出口配置 JSON，或用 --demo 演示")
        with open(args.config, encoding="utf-8") as f:
            outlets = json.load(f)

    v = args.unit_value
    print("=" * 96)
    print("兑换出口效率评估（单位积分价值 %.4f 元）" % v)
    print("=" * 96)
    print("%-26s %10s %10s %12s %12s %10s"
          % ("出口", "所需积分", "名义价值", "实际成本", "消化效率", "预计占比"))
    print("-" * 96)
    weighted_eff = 0.0
    total_share = 0.0
    for o in outlets:
        nominal = o["points_required"] * v
        eff = nominal / o["cost"] if o["cost"] > 0 else float("inf")
        share = o.get("expected_share", 0)
        weighted_eff += eff * share
        total_share += share
        mark = "🟢" if eff >= 1.5 else ("🟡" if eff >= 1.0 else "🔴")
        print("%-26s %10s %10.2f %12.2f %10.2fx %s %8.0f%%"
              % (o["name"], "{:,}".format(o["points_required"]), nominal,
                 o["cost"], eff, mark, share * 100))
    print("-" * 96)
    if total_share > 0:
        print("加权平均消化效率：%.2fx  %s"
              % (weighted_eff / total_share,
                 "🟢 优秀" if weighted_eff / total_share >= 1.5
                 else ("🟡 一般" if weighted_eff / total_share >= 1.0 else "🔴 亏损，须调整选品")))
    print()
    print("消化效率 = 名义积分价值 ÷ 实际成本。>1.5x 说明兑换品选得好（高售价、低成本）。")
    print("提升方式：多用自有高毛利商品、闲置产能型权益、批采成本低的联合会员。")
    if total_share and abs(total_share - 1.0) > 0.02:
        print("\n⚠ 各出口预计占比之和为 %.0f%%，建议校准为 100%%。" % (total_share * 100))


# ---------------------------------------------------------------- main


def main():
    p = argparse.ArgumentParser(description="积分经济模型测算器")
    sub = p.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("design", help="反推发放系数")
    d.add_argument("--gmv", type=float, required=True, help="年 GMV(元)")
    d.add_argument("--target-cost-rate", type=float, required=True, help="目标积分成本率，小数，如 0.008")
    d.add_argument("--redemption", type=float, default=0.6, help="预计核销率，默认 0.6")
    d.add_argument("--unit-value", type=float, default=0.01, help="单位积分价值(元/分)，默认 0.01 即 100:1")
    d.set_defaults(func=cmd_design)

    l = sub.add_parser("liability", help="积分负债五池模型")
    l.add_argument("--issued", type=float, required=True, help="累计发行积分数")
    l.add_argument("--redeemed", type=float, required=True, help="累计已核销积分数")
    l.add_argument("--expired", type=float, default=0, help="累计已清零积分数")
    l.add_argument("--unit-value", type=float, default=0.01, help="单位积分价值(元/分)")
    l.set_defaults(func=cmd_liability)

    s = sub.add_parser("simulate", help="12 个月流通池推演")
    s.add_argument("--monthly-gmv", type=float, required=True, help="首月 GMV(元)")
    s.add_argument("--growth", type=float, default=0.0, help="月环比增长率，小数")
    s.add_argument("--rate", type=float, default=1.0, help="基础发放系数(分/元)")
    s.add_argument("--unit-value", type=float, default=0.01, help="单位积分价值(元/分)")
    s.add_argument("--redemption", type=float, default=0.6, help="年化核销率(作用于流通池)")
    s.add_argument("--initial-outstanding", type=float, default=0, help="期初流通池积分数")
    s.add_argument("--campaign-months", help="大促月份，逗号分隔，如 6,11")
    s.add_argument("--campaign-multiplier", type=float, default=2.0, help="大促月倍率")
    s.add_argument("--cost-rate-cap", type=float, default=0, help="月度成本率熔断阈值，小数，如 0.012")
    s.add_argument("--expiry-months", type=int, default=0, help="积分有效期(月)，0 表示不模拟过期")
    s.add_argument("--expiry-rate", type=float, default=0.02, help="到期后每月过期比例")
    s.set_defaults(func=cmd_simulate)

    o = sub.add_parser("outlet", help="兑换出口效率评估")
    o.add_argument("--config", help="出口配置 JSON")
    o.add_argument("--demo", action="store_true")
    o.add_argument("--unit-value", type=float, default=0.01)
    o.set_defaults(func=cmd_outlet)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
