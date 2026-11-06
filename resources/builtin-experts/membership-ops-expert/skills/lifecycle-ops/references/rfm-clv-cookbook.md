# RFM / CLV / Cohort 计算手册

> SQL 以标准 ANSI SQL 编写，注释标出各引擎（MySQL / PostgreSQL / Hive / ClickHouse）的差异点。
> 假设有一张订单表 `orders(user_id, order_id, pay_time, amount, gross_profit, status)`，
> `status='PAID'` 表示有效订单（已剔除退款/取消）。

---

## 〇、开始之前：三条口径纪律

1. **必须剔除退款/取消订单**。否则 F 和 M 全部虚高，分群失真。
2. **必须明确统计窗口**（建议 12 个月滚动）。窗口不同，结论完全不同。
3. **必须用你自己的分位数分箱**，不要用别人的固定阈值。

---

## 一、购买间隔中位数 T（**所有阶段阈值的基础**）

```sql
-- 计算全站购买间隔中位数 T（天）
WITH gaps AS (
  SELECT
    user_id,
    DATEDIFF(pay_time, LAG(pay_time) OVER (PARTITION BY user_id ORDER BY pay_time)) AS gap_days
    -- PostgreSQL: (pay_time::date - LAG(pay_time) OVER (...)::date)
    -- ClickHouse: dateDiff('day', lagInFrame(pay_time) OVER (...), pay_time)
  FROM orders
  WHERE status = 'PAID'
    AND pay_time >= DATE_SUB(CURRENT_DATE, INTERVAL 12 MONTH)
)
SELECT
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY gap_days) AS T_median,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY gap_days) AS p25,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY gap_days) AS p75
FROM gaps
WHERE gap_days IS NOT NULL AND gap_days > 0;
-- MySQL 8.0 无 PERCENTILE_CONT，可用 NTILE 或 变量法近似
```

> **为什么用中位数而不是平均数**：购买间隔是**右偏分布**（少数用户间隔极长），平均数会被长尾严重拉高。
> 用平均数定义"沉睡"，会把大量还活着的用户误判为沉睡，浪费召回预算。

**个人基线（更准，用于流失预警）**：

```sql
SELECT user_id,
       AVG(gap_days) AS personal_avg_gap,
       COUNT(*)      AS gap_count
FROM gaps
WHERE gap_days IS NOT NULL
GROUP BY user_id
HAVING COUNT(*) >= 2;   -- 至少 3 笔订单才有个人基线
```

---

## 二、RFM 计算与分箱

### Step 1：算出每个用户的 R / F / M

```sql
CREATE TABLE rfm_base AS
SELECT
  user_id,
  DATEDIFF(CURRENT_DATE, MAX(pay_time)) AS recency_days,
  COUNT(DISTINCT order_id)              AS frequency,
  SUM(amount)                           AS monetary,
  SUM(gross_profit)                     AS gross_profit_total,
  MIN(pay_time)                         AS first_order_at,
  MAX(pay_time)                         AS last_order_at
FROM orders
WHERE status = 'PAID'
  AND pay_time >= DATE_SUB(CURRENT_DATE, INTERVAL 12 MONTH)
GROUP BY user_id;
```

### Step 2：按中位数二分箱（八分群标准做法）

```sql
WITH med AS (
  SELECT
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY recency_days) AS r_med,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY frequency)    AS f_med,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY monetary)     AS m_med
  FROM rfm_base
)
SELECT
  b.user_id, b.recency_days, b.frequency, b.monetary,
  CASE WHEN b.recency_days <= m.r_med THEN 1 ELSE 0 END AS r_high,  -- R 越小越好
  CASE WHEN b.frequency    >= m.f_med THEN 1 ELSE 0 END AS f_high,
  CASE WHEN b.monetary     >= m.m_med THEN 1 ELSE 0 END AS m_high,
  CASE
    WHEN b.recency_days <= m.r_med AND b.frequency >= m.f_med AND b.monetary >= m.m_med THEN '1_重要价值客户'
    WHEN b.recency_days >  m.r_med AND b.frequency >= m.f_med AND b.monetary >= m.m_med THEN '2_重要保持客户'
    WHEN b.recency_days <= m.r_med AND b.frequency <  m.f_med AND b.monetary >= m.m_med THEN '3_重要发展客户'
    WHEN b.recency_days >  m.r_med AND b.frequency <  m.f_med AND b.monetary >= m.m_med THEN '4_重要挽留客户'
    WHEN b.recency_days <= m.r_med AND b.frequency >= m.f_med AND b.monetary <  m.m_med THEN '5_一般价值客户'
    WHEN b.recency_days >  m.r_med AND b.frequency >= m.f_med AND b.monetary <  m.m_med THEN '6_一般保持客户'
    WHEN b.recency_days <= m.r_med AND b.frequency <  m.f_med AND b.monetary <  m.m_med THEN '7_一般发展客户'
    ELSE '8_一般挽留客户'
  END AS rfm_segment
FROM rfm_base b CROSS JOIN med m;
```

### Step 3：分群健康度检查

```sql
SELECT rfm_segment,
       COUNT(*)                    AS users,
       ROUND(AVG(monetary), 2)     AS avg_monetary,
       ROUND(SUM(monetary), 2)     AS total_monetary,
       ROUND(SUM(monetary) * 100.0 / SUM(SUM(monetary)) OVER (), 2) AS gmv_share_pct
FROM rfm_result
GROUP BY rfm_segment
ORDER BY rfm_segment;
```

**判读**：
- `1_重要价值客户` 人数占比通常 10–20%，但 GMV 占比可能 40–60%。若 GMV 占比不高，说明高价值客户没被养出来。
- `2_重要保持客户` 是**最值得抢救**的一群——他们曾经很好，现在沉默了。这一群的人数如果在增加，是最危险的信号。
- `8_一般挽留客户` 占比过高（>40%）说明获客质量差，或新客运营完全失效。

---

## 三、生命周期阶段打标

```sql
-- 假设已算出 T（购买间隔中位数），此处以 T=30 为例
SELECT
  user_id,
  CASE
    WHEN frequency = 0                          THEN '潜客'
    WHEN frequency = 1 AND recency_days <= 30    THEN '新客'
    WHEN frequency BETWEEN 2 AND 3 AND recency_days <= 45  THEN '成长'
    WHEN frequency >= 4 AND recency_days <= 30   THEN '成熟'
    WHEN recency_days BETWEEN 46 AND 90          THEN '预沉睡'
    WHEN recency_days BETWEEN 91 AND 180         THEN '沉睡'
    ELSE '流失'
  END AS lifecycle_stage
FROM rfm_base;
-- 注意：阈值 30/45/90/180 应替换为 1×T / 1.5×T / 3×T / 6×T
```

### 阶段迁移矩阵（**比存量分布更重要**）

```sql
-- 对比本月与上月的阶段，得到迁移矩阵
SELECT
  prev.lifecycle_stage AS stage_last_month,
  cur.lifecycle_stage  AS stage_this_month,
  COUNT(*)             AS users
FROM stage_snapshot_202607 prev
JOIN stage_snapshot_202608 cur ON prev.user_id = cur.user_id
GROUP BY 1, 2
ORDER BY 1, 2;
```

> **这张矩阵是会员运营最有价值的一张表。**存量分布告诉你"现在长什么样"，
> 迁移矩阵告诉你"正在往哪里走"。所有运营动作的效果，最终都体现在迁移率的变化上。

---

## 四、Cohort 留存

```sql
WITH first_order AS (
  SELECT user_id,
         DATE_FORMAT(MIN(pay_time), '%Y-%m') AS cohort_month
         -- PostgreSQL: to_char(MIN(pay_time), 'YYYY-MM')
  FROM orders WHERE status = 'PAID'
  GROUP BY user_id
),
activity AS (
  SELECT DISTINCT
         o.user_id,
         f.cohort_month,
         PERIOD_DIFF(DATE_FORMAT(o.pay_time, '%Y%m'),
                     DATE_FORMAT(STR_TO_DATE(CONCAT(f.cohort_month,'-01'),'%Y-%m-%d'), '%Y%m')) AS month_index
  FROM orders o JOIN first_order f ON o.user_id = f.user_id
  WHERE o.status = 'PAID'
)
SELECT
  cohort_month,
  COUNT(DISTINCT CASE WHEN month_index = 0 THEN user_id END) AS m0,
  ROUND(COUNT(DISTINCT CASE WHEN month_index = 1 THEN user_id END) * 100.0
      / NULLIF(COUNT(DISTINCT CASE WHEN month_index = 0 THEN user_id END), 0), 1) AS m1_pct,
  ROUND(COUNT(DISTINCT CASE WHEN month_index = 3 THEN user_id END) * 100.0
      / NULLIF(COUNT(DISTINCT CASE WHEN month_index = 0 THEN user_id END), 0), 1) AS m3_pct,
  ROUND(COUNT(DISTINCT CASE WHEN month_index = 6 THEN user_id END) * 100.0
      / NULLIF(COUNT(DISTINCT CASE WHEN month_index = 0 THEN user_id END), 0), 1) AS m6_pct
FROM activity
GROUP BY cohort_month
ORDER BY cohort_month;
```

---

## 五、CLV 计算

### 5.1 历史 CLV

```sql
SELECT user_id,
       SUM(gross_profit)                                   AS historical_clv,
       COUNT(DISTINCT order_id)                            AS orders,
       DATEDIFF(MAX(pay_time), MIN(pay_time)) / 365.0      AS tenure_years
FROM orders WHERE status = 'PAID'
GROUP BY user_id;
```

### 5.2 预测 CLV（简化模型，适合大多数场景）

```
预测 CLV = ATV × 年频次 × 毛利率 × (1 / 年流失率)

若要考虑折现（生命周期 >2 年时建议）：
预测 CLV = (年毛利贡献 × 留存率) / (1 + 折现率 − 留存率)
其中折现率取 8–12%
```

```sql
-- 分群计算预测 CLV 的输入参数
SELECT
  segment,
  AVG(monetary / NULLIF(frequency, 0))              AS atv,
  AVG(frequency)                                    AS annual_freq,
  AVG(gross_profit_total / NULLIF(monetary, 0))     AS gross_margin
FROM rfm_result GROUP BY segment;
```

### 5.3 年留存率

```sql
SELECT
  COUNT(DISTINCT CASE WHEN active_this_year = 1 AND active_last_year = 1 THEN user_id END) * 1.0
/ NULLIF(COUNT(DISTINCT CASE WHEN active_last_year = 1 THEN user_id END), 0) AS annual_retention
FROM user_yearly_activity;
```

---

## 六、会员体系效果验证（**最重要，也最容易做错**）

### ❌ 错误做法
「会员 CLV 是非会员的 3 倍 → 会员体系有效」
这是**选择性偏差**：本来就买得多的人才会入会。

### ✅ 正确做法一：前后对比 + 匹配对照组

```sql
-- 1) 取入会用户，计算入会前后各 12 个月的消费
WITH joiners AS (
  SELECT user_id, join_date FROM members
  WHERE join_date BETWEEN '2025-01-01' AND '2025-03-31'
),
pre_post AS (
  SELECT j.user_id,
    SUM(CASE WHEN o.pay_time <  j.join_date
             AND o.pay_time >= DATE_SUB(j.join_date, INTERVAL 12 MONTH) THEN o.amount ELSE 0 END) AS pre_12m,
    SUM(CASE WHEN o.pay_time >= j.join_date
             AND o.pay_time <  DATE_ADD(j.join_date, INTERVAL 12 MONTH) THEN o.amount ELSE 0 END) AS post_12m
  FROM joiners j JOIN orders o ON o.user_id = j.user_id AND o.status = 'PAID'
  GROUP BY j.user_id
)
SELECT AVG(post_12m - pre_12m) AS avg_lift, COUNT(*) AS n FROM pre_post;

-- 2) 关键：对同期未入会、且入会前消费水平相近的用户做同样计算
--    两者之差（差中差 / DID）才是会员体系的真实增量
```

### ✅ 正确做法二：断点回归
比较"刚好达到入会/升级门槛"与"差一点点"的两批人——他们本质特征接近，差异主要来自会员身份本身。

### ✅ 正确做法三：随机 holdout（最严谨）
对符合条件的用户随机 90% 开放入会邀请、10% 不邀请，对比两组表现。
**任何长期运行的会员体系，都应保留一个 5–10% 的 holdout 组**——这是唯一能持续、可信地衡量体系真实价值的方式。

---

## 七、常见口径陷阱

| 陷阱 | 后果 | 正解 |
|---|---|---|
| 用平均购买间隔定义沉睡 | 大量活跃用户被误判 | 用中位数；预警用个人基线 |
| M 用销售额不用毛利 | 高退货/低毛利品类用户被高估 | 分群用金额，投入决策用毛利 |
| 不剔除退款订单 | F/M 虚高 | 只取有效已支付且未退款订单 |
| 用全生命周期算 RFM | 老用户永远排前面 | 固定 12 个月滚动窗口 |
| 会员/非会员直接对比 | 选择性偏差 | 前后对比 + 对照组 / 断点回归 / holdout |
| 只看留存率不分 Cohort | 看不出体系改进 | 按首购月分组看竖列 |
| 用固定阈值分箱 | 分群严重倾斜 | 用自己数据的分位数 |
