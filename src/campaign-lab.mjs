import { campaignPlan } from "./campaign-model.mjs";

const fmt = (n) => Number(n.toFixed(2)).toLocaleString("zh-CN");
export function campaignAnalysis(draft, base, subject) {
  const plan = campaignPlan(draft),
    prior = campaignPlan(base);
  const metric =
    subject === "campaignTypes"
      ? "fastChance"
      : subject === "campaignFormation"
        ? "frontChance"
        : subject === "campaignSupply"
          ? "budget"
          : subject === "campaignBoss"
            ? "bossHp"
            : "hp";
  const label = {
    hp: "普通怪基础HP",
    budget: "本关怪物总量",
    fastChance: "快速怪概率",
    frontChance: "初段前压概率",
    bossHp: "首领HP",
  }[metric];
  const percent = metric.endsWith("Chance");
  const value = (p) =>
    (metric === "fastChance"
      ? Math.min(p.fastChance, 1 - p.bombChance)
      : p[metric] || 0) * (percent ? 100 : 1);
  const max = Math.max(1, ...plan.map(value), ...prior.map(value));
  const x = (index, total) => 52 + ((index - 1) / Math.max(1, total - 1)) * 650;
  const y = (v) => 230 - (v / max) * 186;
  const path = (rows) =>
    rows
      .map(
        (p, i) => `${i ? "L" : "M"}${x(p.index, rows.length)},${y(value(p))}`,
      )
      .join(" ");
  const chart = `<svg id="campaignGrowthChart" viewBox="0 0 740 270" role="img" aria-label="逐关${label}曲线"><style>text{font:12px sans-serif;fill:#436159}</style>${[0, 0.5, 1].map((t) => `<path d="M52 ${y(max * t)}H702" stroke="#d6dfd2"/><text x="44" y="${y(max * t) + 4}" text-anchor="end">${fmt(max * t)}${percent ? "%" : ""}</text>`).join("")}<path d="${path(prior)}" fill="none" stroke="#99aba0" stroke-width="2" stroke-dasharray="5 4"/><path d="${path(plan)}" fill="none" stroke="#db7335" stroke-width="3"/>${plan
    .filter((p) => p.bossKind)
    .map(
      (p) =>
        `<path d="M${x(p.index, plan.length)} 30V230" stroke="#9e4c68" stroke-dasharray="3 4"/><circle cx="${x(p.index, plan.length)}" cy="${y(value(p))}" r="5" fill="#9e4c68"/><text x="${x(p.index, plan.length)}" y="20" text-anchor="middle">首领 ${p.index}</text>`,
    )
    .join(
      "",
    )}<text x="52" y="254">第1关</text><text x="702" y="254" text-anchor="end">第${plan.length}关</text></svg>`;
  return {
    description: `逐关曲线由当前草稿生成，与实战共用 campaignStage。${plan.filter((p) => !p.bossKind).length}个普通关清完有限来敌即可过关；首领关：${plan
      .filter((p) => p.bossKind)
      .map((p) => p.index)
      .join("、")}。所有成长按关卡序号计算，不追涨玩家当前ATK。`,
    chart,
    metrics: [
      [
        "战役长度 / 首领战",
        `${plan.length}关 / ${plan.filter((p) => p.bossKind).length}场`,
      ],
      ["基础HP · 首关 → 末关", `${fmt(plan[0].hp)} → ${fmt(plan.at(-1).hp)}`],
      [
        "总量 · 首关 → 末关",
        `${fmt(plan[0].budget)} → ${fmt(plan.at(-1).budget)}`,
      ],
      [
        "快怪概率 · 首关 → 末关",
        `${fmt(Math.min(plan[0].fastChance, 1 - plan[0].bombChance) * 100)}% → ${fmt(Math.min(plan.at(-1).fastChance, 1 - plan.at(-1).bombChance) * 100)}%`,
      ],
    ],
    heads: [
      "关卡 / 目标",
      "小怪HP",
      "总量",
      "开局数",
      "目标存量",
      "快怪概率",
      "前压概率",
      "开局/补怪最深行",
      "首领HP",
    ],
    rows: plan.map((p) => [
      `第${p.index}关 · ${p.bossName || "清理来敌"}`,
      fmt(p.hp),
      fmt(p.budget),
      fmt(p.openingCount),
      `${fmt(p.targetStart)}→${fmt(p.targetEnd)}`,
      `${fmt(Math.min(p.fastChance, 1 - p.bombChance) * 100)}%`,
      `${fmt(p.frontChance * 100)}%`,
      `${p.openingDepth}/${p.spawnDepth}`,
      p.bossHp ? fmt(p.bossHp) : "—",
    ]),
    help: `图表：${label}（橙色当前草稿，灰虚线打开时配置）。HP=首关基础+增长系数×(关号−1)^指数；总量同式。开局/目标存量、快怪、前压使用首末关锚点与指数插值。普通关无Boss；阶段成长在下一关采样，改路线/关数/周期需重开。总量不是同屏存量，仍受全场上限、安全行和补压公式控制。表中最深行是配置上限；实际受安全出手和空位裁减。右侧选择不同成长分组调节曲线。`,
  };
}
