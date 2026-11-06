#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
会员等级与权益成本测算器（纯标准库，无需安装依赖）

三个子命令：
  tiers        分位数法测算等级门槛 + 人数分布 + 升级难度校验
  benefit      权益成本三情景测算（保守 / 基准 / 压力）
  paid         付费会员定价与回本测算

用法示例：
  python3 tier_calc.py tiers --data spend.csv --column amount --levels 3
  python3 tier_calc.py tiers --values 120,300,80,1500,600,220,90,4000 --levels 3
  python3 tier_calc.py benefit --config benefits.json
  python3 tier_calc.py benefit --demo
  python3 tier_calc.py paid --price 99 --perceived-saving 320 --member-gmv 3600 \
      --control-gmv 2400 --gross-margin 0.35 --benefit-cost 60

所有输出均为「测算结果」，依赖输入假设；报告中必须同时列出假设。
"""

import argparse
import csv
import json
import math
import os
import sys

# ---------------------------------------------------------------- utilities


def percentile(sorted_vals, p):
    """线性插值分位数。p 为 0-100。"""
    if not sorted_vals:
        return 0.0
    if p <= 0:
        return float(sorted_vals[0])
    if p >= 100:
        return float(sorted_vals[-1])
    k = (len(sorted_vals) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return float(sorted_vals[int(k)])
    return sorted_vals[int(f)] * (c - k) + sorted_vals[int(c)] * (k - f)


def pretty_round(x):
    """把分位数结果取整成有记忆点的数字，偏离不超过 ±10%。"""
    if x <= 0:
        return 0
    candidates = []
    for base in (1, 10, 50, 100, 500, 1000, 5000, 10000):
        for mult in range(1, 200):
            v = base * mult
            if abs(v - x) / x <= 0.10:
                # 偏好尾数 8 / 88 / 888 / 整百
                score = 0
                s = str(int(v))
                if s.endswith("888"):
                    score = 4
                elif s.endswith("88"):
                    score = 3
                elif s.endswith("8"):
                    score = 2
                elif s.endswith("00"):
                    score = 2
                elif s.endswith("0"):
                    score = 1
                candidates.append((score, -abs(v - x), v))
    if not candidates:
        return int(round(x))
    candidates.sort(reverse=True)
    return int(candidates[0][2])


def load_values(args):
    vals = []
    if args.values:
        for token in args.values.split(","):
            token = token.strip()
            if token:
                vals.append(float(token))
    elif args.data:
        if not os.path.exists(args.data):
            sys.exit("找不到文件：%s" % args.data)
        with open(args.data, newline="", encoding="utf-8-sig") as f:
            sniff = f.read(4096)
            f.seek(0)
            has_header = csv.Sniffer().has_header(sniff) if sniff.strip() else False
            reader = csv.reader(f)
            rows = list(reader)
        if not rows:
            sys.exit("文件为空")
        col_idx = 0
        if has_header:
            header = [h.strip() for h in rows[0]]
            if args.column and args.column in header:
                col_idx = header.index(args.column)
            rows = rows[1:]
        for r in rows:
            if col_idx < len(r):
                try:
                    vals.append(float(str(r[col_idx]).replace(",", "").strip()))
                except ValueError:
                    continue
    else:
        sys.exit("请用 --values 或 --data 提供年度累计消费额数据")
    vals = [v for v in vals if v >= 0]
    if len(vals) < 5:
        sys.exit("有效样本不足（<5 条），无法做分位数测算")
    return sorted(vals)


# ---------------------------------------------------------------- tiers

DEFAULT_ANCHORS = {
    3: [(60, 70), (90, 93)],
    4: [(50, 60), (80, 85), (95, 97)],
    5: [(40, 50), (70, 75), (88, 92), (97, 98.5)],
}
TIER_NAMES = {
    3: ["普通会员", "银卡", "金卡"],
    4: ["普通会员", "银卡", "金卡", "黑卡"],
    5: ["普通会员", "银卡", "金卡", "白金卡", "黑卡"],
}


def cmd_tiers(args):
    vals = load_values(args)
    n = len(vals)
    levels = args.levels
    if levels not in DEFAULT_ANCHORS:
        sys.exit("--levels 仅支持 3 / 4 / 5")

    atv = args.atv if args.atv else (sum(vals) / n) / max(args.freq, 1e-9)

    print("=" * 72)
    print("等级门槛测算（分位数法）")
    print("=" * 72)
    print("样本量：%d  人均年度消费：%.1f  中位数：%.1f  Top10%%线：%.1f"
          % (n, sum(vals) / n, percentile(vals, 50), percentile(vals, 90)))
    print("假设客单价：%.1f（用于估算升级所需笔数）" % atv)
    print()

    thresholds = [0]
    for lo, hi in DEFAULT_ANCHORS[levels]:
        p = (lo + hi) / 2.0
        raw = percentile(vals, p)
        thresholds.append(pretty_round(raw))

    # 频次分档：决定升级难度用「笔数」还是「月数」衡量
    mfreq = args.monthly_freq
    if mfreq >= 3:
        band, lo_m, hi_m = "高频", 2.0, 3.0
    elif mfreq >= 1:
        band, lo_m, hi_m = "中频", 3.0, 5.0
    else:
        band, lo_m, hi_m = "低频", 0, 0
    print("购买频次：月均 %.1f 次（%s）→ 升级难度按 %s 衡量"
          % (mfreq, band, "月数" if band != "低频" else "笔数"))
    print()

    names = TIER_NAMES[levels]
    print("%-10s %12s %12s %10s %16s" % ("等级", "门槛(元)", "预计人数", "占比", "升级需再买"))
    print("-" * 72)
    warnings = []
    for i in range(levels):
        lo = thresholds[i]
        hi = thresholds[i + 1] if i + 1 < levels else None
        cnt = sum(1 for v in vals if v >= lo and (hi is None or v < hi))
        share = cnt / n * 100
        if i + 1 < levels:
            gap = thresholds[i + 1] - lo
            need = gap / atv if atv > 0 else 0
            if band == "低频":
                need_s = "%.1f 笔" % need
                if need > 8:
                    warnings.append("L%d→L%d 需再买 %.1f 笔，跨度过大，用户容易放弃（低频业务建议 2–4 笔）"
                                    % (i + 1, i + 2, need))
                if 0 < need < 2:
                    warnings.append("L%d→L%d 仅需 %.1f 笔，门槛过低，等级会显得廉价" % (i + 1, i + 2, need))
            else:
                months = need / mfreq if mfreq > 0 else 0
                need_s = "%.1f 笔 / %.1f 月" % (need, months)
                if months > hi_m:
                    warnings.append("L%d→L%d 需 %.1f 个月才能达成，超出 %s业务的合理区间（%.0f–%.0f 个月），建议下调门槛"
                                    % (i + 1, i + 2, months, band, lo_m, hi_m))
                if 0 < months < lo_m:
                    warnings.append("L%d→L%d 仅需 %.1f 个月，门槛过低，等级会显得廉价（建议 ≥%.0f 个月）"
                                    % (i + 1, i + 2, months, lo_m))
        else:
            need_s = "—"
        print("%-10s %12s %12d %9.1f%% %16s"
              % (names[i], "{:,}".format(lo), cnt, share, need_s))
        if i == 0 and share > 92:
            warnings.append("最低档占比 %.1f%%（>92%%），第一级门槛过高，体系将失去牵引力" % share)
        if i > 0 and cnt < 50:
            warnings.append("%s 仅 %d 人，人数过少，无法支撑差异化运营动作" % (names[i], cnt))

    print()
    print("保级门槛建议（= 升级门槛 × 65%）：")
    for i in range(1, levels):
        print("  %s 保级：%s 元" % (names[i], "{:,}".format(pretty_round(thresholds[i] * 0.65))))

    if warnings:
        print()
        print("⚠ 校验提示：")
        for w in warnings:
            print("  · " + w)
    print()
    print("提示：以上门槛为测算起点，落地前需结合品牌调性与竞品做微调；")
    print("      门槛美化后与原始分位点的偏离已控制在 ±10% 以内。")


# ---------------------------------------------------------------- benefit cost

DEMO_BENEFITS = {
    "gross_margin": 0.45,
    "tiers": [
        {"name": "普通会员", "members": 80000, "annual_gmv_per_member": 400,
         "benefits": [
             {"name": "消费积分(1%)", "unit_cost": 4, "times_per_year": 1, "redemption": 0.55},
             {"name": "生日券", "unit_cost": 15, "times_per_year": 1, "redemption": 0.30}]},
        {"name": "银卡", "members": 15000, "annual_gmv_per_member": 1200,
         "benefits": [
             {"name": "消费积分(1.2%)", "unit_cost": 14.4, "times_per_year": 1, "redemption": 0.60},
             {"name": "生日券", "unit_cost": 25, "times_per_year": 1, "redemption": 0.35},
             {"name": "免运费", "unit_cost": 6, "times_per_year": 6, "redemption": 0.70},
             {"name": "延长退换30天", "unit_cost": 40, "times_per_year": 1, "redemption": 0.05}]},
        {"name": "金卡", "members": 4000, "annual_gmv_per_member": 3600,
         "benefits": [
             {"name": "消费积分(1.5%)", "unit_cost": 54, "times_per_year": 1, "redemption": 0.65},
             {"name": "生日礼盒", "unit_cost": 60, "times_per_year": 1, "redemption": 0.45},
             {"name": "免运费", "unit_cost": 6, "times_per_year": 12, "redemption": 0.75},
             {"name": "专属客服", "unit_cost": 30, "times_per_year": 1, "redemption": 0.20},
             {"name": "新品试用装", "unit_cost": 25, "times_per_year": 2, "redemption": 0.50}]}
    ]
}

SCENARIOS = [("保守", 0.6), ("基准", 1.0), ("压力", 1.8)]


def cmd_benefit(args):
    if args.demo:
        cfg = DEMO_BENEFITS
        print("（使用内置示例数据；实际使用请传 --config your.json，格式见 --demo 输出结构）\n")
    else:
        if not args.config or not os.path.exists(args.config):
            sys.exit("请用 --config 指定配置 JSON，或用 --demo 查看示例")
        with open(args.config, encoding="utf-8") as f:
            cfg = json.load(f)

    gm = cfg.get("gross_margin", 0.4)
    print("=" * 88)
    print("权益成本三情景测算（毛利率 %.0f%%）" % (gm * 100))
    print("=" * 88)

    grand = {name: 0.0 for name, _ in SCENARIOS}
    total_gmv = 0.0

    for tier in cfg["tiers"]:
        members = tier["members"]
        gmv_pm = tier.get("annual_gmv_per_member", 0)
        tier_gmv = members * gmv_pm
        total_gmv += tier_gmv
        print("\n【%s】 会员数 %s ｜ 人均年 GMV %s 元 ｜ 该档 GMV %s 元"
              % (tier["name"], "{:,}".format(members),
                 "{:,.0f}".format(gmv_pm), "{:,.0f}".format(tier_gmv)))
        print("  %-18s %10s %8s %8s %12s" % ("权益", "单次成本", "年次数", "核销率", "基准人均成本"))
        print("  " + "-" * 62)
        per_member = {name: 0.0 for name, _ in SCENARIOS}
        for b in tier["benefits"]:
            base = b["unit_cost"] * b["times_per_year"] * b["redemption"]
            print("  %-18s %10.2f %8.1f %7.0f%% %12.2f"
                  % (b["name"], b["unit_cost"], b["times_per_year"],
                     b["redemption"] * 100, base))
            for name, mult in SCENARIOS:
                r = min(b["redemption"] * mult, 1.0)
                per_member[name] += b["unit_cost"] * b["times_per_year"] * r

        print("  " + "-" * 62)
        for name, _ in SCENARIOS:
            cost = per_member[name] * members
            grand[name] += cost
            rate = (cost / tier_gmv * 100) if tier_gmv else 0
            margin_share = (cost / (tier_gmv * gm) * 100) if tier_gmv else 0
            print("  %s情景：人均 %.2f 元 ｜ 总成本 %s 元 ｜ 占该档 GMV %.2f%% ｜ 占该档毛利 %.1f%%"
                  % (name, per_member[name], "{:,.0f}".format(cost), rate, margin_share))

    print("\n" + "=" * 88)
    print("合计（会员 GMV %s 元）" % "{:,.0f}".format(total_gmv))
    print("=" * 88)
    for name, _ in SCENARIOS:
        rate = (grand[name] / total_gmv * 100) if total_gmv else 0
        margin_share = (grand[name] / (total_gmv * gm) * 100) if total_gmv else 0
        if margin_share <= 15:
            flag = "🟢 安全"
        elif margin_share <= 25:
            flag = "🟡 需有增量证明"
        else:
            flag = "🔴 危险，须削减或设熔断"
        print("%s情景：总成本 %s 元 ｜ 成本率 %.2f%% GMV ｜ 占毛利 %.1f%%  → %s"
              % (name, "{:,.0f}".format(grand[name]), rate, margin_share, flag))
    print("\n判定线：占毛利 ≤15% 安全；15–25% 需增量证明；>25% 危险。")
    print("务必用「压力情景」做预算规划，用「基准情景」做效果评估。")


# ---------------------------------------------------------------- paid membership


def cmd_paid(args):
    price = args.price
    saving = args.perceived_saving
    k = saving / price if price else 0

    incr_gmv = args.member_gmv - args.control_gmv
    incr_margin = incr_gmv * args.gross_margin
    unit_profit = incr_margin + price - args.benefit_cost
    payback_months = (args.benefit_cost / (incr_margin / 12.0)) if incr_margin > 0 else None

    print("=" * 72)
    print("付费会员定价与回本测算")
    print("=" * 72)
    print("会员费：%.2f 元/年" % price)
    print("用户可感知年省额：%.2f 元" % saving)
    print("→ 心理回本倍数 k = %.2f" % k)
    if k < 1.5:
        print("  ⚠ k<1.5：仅在身份/服务驱动型品类可行；价格敏感人群会觉得不划算")
    elif k < 2:
        print("  🟡 k 在 1.5–2：中度敏感人群勉强可接受，需强化非省钱类权益")
    elif k <= 5:
        print("  🟢 k 在 2–5：定价合理区间")
    else:
        print("  ⚠ k>5：定价可能过低，存在提价空间（或权益给太多）")

    print()
    print("公司侧单位经济：")
    print("  会员年 GMV       ：%.2f" % args.member_gmv)
    print("  对照组年 GMV     ：%.2f  ← 必须用匹配特征的对照组，不能用全站均值" % args.control_gmv)
    print("  增量 GMV         ：%.2f" % incr_gmv)
    print("  增量毛利         ：%.2f （毛利率 %.0f%%）" % (incr_margin, args.gross_margin * 100))
    print("  + 会员费收入     ：%.2f" % price)
    print("  − 权益履约成本   ：%.2f" % args.benefit_cost)
    print("  = 单会员年净贡献 ：%.2f" % unit_profit)
    if unit_profit <= 0:
        print("  🔴 单位经济为负：该定价/权益组合不成立，必须提价或削减权益")
    else:
        print("  🟢 单位经济为正")
    if payback_months:
        print("  权益成本回本周期：%.1f 个月 %s"
              % (payback_months, "🟢" if payback_months <= 12 else "🔴 超过 12 个月，风险高"))

    print()
    print("续费率敏感性（单会员年净贡献 × 续费衰减）：")
    for r in (0.4, 0.5, 0.6, 0.7, 0.8):
        y2 = unit_profit * r
        print("  首年续费率 %.0f%% → 第二年人均贡献 %.2f 元" % (r * 100, y2))
    print()
    print("提醒：续费率的第一驱动力是「用户能否感知到自己回本」。")
    print("      必须在会员中心持续展示「你今年已省 XX 元」，并在到期前 30 天推送年度省钱账单。")
    print("      自动续费须在购买前与续费日前以显著方式提示（消保条例第十条第二款）。")


# ---------------------------------------------------------------- main


def main():
    p = argparse.ArgumentParser(description="会员等级与权益成本测算器")
    sub = p.add_subparsers(dest="cmd", required=True)

    t = sub.add_parser("tiers", help="分位数法测算等级门槛")
    t.add_argument("--data", help="CSV 文件路径（年度累计消费额）")
    t.add_argument("--column", help="CSV 中金额列的列名")
    t.add_argument("--values", help="直接传入逗号分隔的金额，如 120,300,80")
    t.add_argument("--levels", type=int, default=3, help="等级档数 3/4/5，默认 3")
    t.add_argument("--atv", type=float, default=0, help="客单价；不传则由 总额/频次 估算")
    t.add_argument("--freq", type=float, default=3, help="人均年购买频次，默认 3（仅在未传 --atv 时使用）")
    t.add_argument("--monthly-freq", type=float, default=0.5,
                   help="人均月购买频次。≥3 高频/1–3 中频/<1 低频，决定升级难度按月数还是笔数衡量")
    t.set_defaults(func=cmd_tiers)

    b = sub.add_parser("benefit", help="权益成本三情景测算")
    b.add_argument("--config", help="配置 JSON 路径")
    b.add_argument("--demo", action="store_true", help="用内置示例数据演示")
    b.set_defaults(func=cmd_benefit)

    m = sub.add_parser("paid", help="付费会员定价与回本测算")
    m.add_argument("--price", type=float, required=True, help="会员费(元/年)")
    m.add_argument("--perceived-saving", type=float, required=True, help="用户可感知年省额(元)")
    m.add_argument("--member-gmv", type=float, required=True, help="会员年 GMV(元)")
    m.add_argument("--control-gmv", type=float, required=True, help="对照组年 GMV(元)")
    m.add_argument("--gross-margin", type=float, default=0.35, help="毛利率，小数，默认 0.35")
    m.add_argument("--benefit-cost", type=float, default=0, help="单会员年权益履约成本(元)")
    m.set_defaults(func=cmd_paid)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
