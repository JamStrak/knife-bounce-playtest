import { densityCount } from "./realtime-density.mjs";

export const curveProfiles = {
  xp: {
    name: "升级经验",
    axis: "当前等级",
    unit: "经验",
    xs: [1, 5, 15, 30],
    base: "xpBase",
    gain: "xpGrowth",
    offset: 1,
    values: [2, 6, 16, 31],
  },
  damage: {
    name: "锋芒成长",
    axis: "锋芒等级",
    unit: "总伤害",
    xs: [0, 1, 4, 8],
    base: "damage",
    gain: "damageUpgrade",
    offset: 0,
    values: [10, 15, 30, 50],
  },
  hp: {
    name: "怪物血量",
    axis: "回合",
    unit: "普通怪HP",
    xs: [1, 10, 25, 50],
    base: "enemyHp",
    gain: "hpGrowth",
    offset: 1,
    values: [10, 19, 34, 59],
  },
  spawn: {
    name: "每波生成数量",
    axis: "回合",
    unit: "计划生成数",
    xs: [1, 10, 25, 50],
    base: "spawnCount",
    gain: "spawnGrowth",
    offset: 1,
    min: 0,
    values: [1, 1, 1, 1],
  },
};
const field = (label, value, min, max, step = 1) => ({
  group: "数值平衡专用",
  label,
  value,
  min,
  max,
  step,
  when: "下次事件",
  balanceOnly: true,
});
export const balanceSchema = {};
for (const [id, p] of Object.entries(curveProfiles)) {
  balanceSchema[id + "CurveMode"] = {
    ...field(p.name + "曲线模式", "formula"),
    type: "select",
    options: { formula: "关键参数公式", points: "四点曲线" },
  };
  balanceSchema[id + "CurvePower"] = field(
    p.name + "增长指数",
    1,
    0.1,
    3,
    0.05,
  );
  balanceSchema[id + "CurveMax"] = field(
    p.name + "封顶（0不限制）",
    0,
    0,
    100000,
  );
  p.xs.forEach(
    (x, i) =>
      (balanceSchema[id + "CurveP" + i] = field(
        p.axis + x + "时的" + p.unit,
        p.values[i],
        p.min ?? 1,
        100000,
        id === "damage" ? 0.01 : 1,
      )),
  );
}
Object.assign(balanceSchema, {
  levelAtkGain: field("每级自然ATK增量", 2, 0, 100, 0.1),
  levelAtkPower: field("自然ATK成长指数", 1, 0.1, 2, 0.05),
  hpAtkCapOn: { ...field("按永久ATK限制新怪血量", true), type: "boolean" },
  hpAtkHitCap: field("新怪最多承受单刀次数", 6, 0.5, 100, 0.5),
  spawnGrowth: field("每回合生成数量增长", 0, 0, 3, 0.1),
  enemyCap: field("全场存活怪物上限", 30, 1, 500),
  sizeGrowthPower: field("旋风范围成长指数", 1, 0.1, 2, 0.05),
  pierceUpgrade: field("破阵每级追加穿透", 1, 1, 5),
  enemyBounceUpgrade: field("回响每级追加怪物弹射", 1, 1, 5),
  wallBounceUpgrade: field("回响每级追加墙壁反弹", 1, 1, 5),
  splitUpgrade: field("分影每级追加飞刀", 1, 1, 5),
});
export function interpolate(xs, ys, x) {
  let i = 0;
  while (i < xs.length - 2 && x > xs[i + 1]) i++;
  const t = (x - xs[i]) / (xs[i + 1] - xs[i]);
  return ys[i] + (ys[i + 1] - ys[i]) * t;
}
export function curveValue(c, id, x) {
  const p = curveProfiles[id],
    v =
      c[id + "CurveMode"] === "points"
        ? interpolate(
            p.xs,
            p.xs.map((_, i) => c[id + "CurveP" + i]),
            x,
          )
        : c[p.base] +
          c[p.gain] * Math.max(0, x - p.offset) ** (c[id + "CurvePower"] ?? 1);
  const capped = Math.max(
    p.min ?? 1,
    Math.min(c[id + "CurveMax"] > 0 ? c[id + "CurveMax"] : Infinity, v),
  );
  return id === "damage"
    ? Math.round(capped * 100) / 100
    : id === "spawn"
      ? Math.floor(capped)
      : id === "xp"
        ? Math.ceil(capped)
        : Math.round(capped);
}
// One monster per column per wave; actual free spawn cells can reduce this further.
export const spawnBudget = (c, round, alive) =>
  Math.max(
    0,
    Math.min(
      densityCount(c, curveValue(c, "spawn", round)),
      c.cols,
      c.enemyCap - alive,
    ),
  );
export const damageAt = (c, level) => curveValue(c, "damage", level);
export const permanentDamageAt = (c, sharpLevel, playerLevel = 1) =>
  Math.round(
    (damageAt(c, sharpLevel) +
      c.levelAtkGain * Math.max(0, playerLevel - 1) ** c.levelAtkPower) *
      100,
  ) / 100;
export const enemyHpAt = (c, round, atk) =>
  Math.max(
    1,
    Math.min(
      curveValue(c, "hp", round),
      c.hpAtkCapOn ? Math.floor(atk * c.hpAtkHitCap) : Infinity,
    ),
  );
export const hybridDamage = (attackPart, hpRatio, target) =>
  attackPart +
  Math.max(0, target.maxHp ?? target.hp) *
    (hpRatio || 0) *
    (target.boss ? (target.hpRatioFactor ?? 1) : 1);
// Keep the legacy parameter/export names for saved settings; this now scales only the slash.
export const sizeAt = (c, level) =>
  1 + c.sizeUpgrade * level ** (c.sizeGrowthPower ?? 1);
export function giantWhirlAt(c, level, scale = 1) {
  const enabled = c.giantWhirlOn && level > 0;
  return {
    radius: enabled
      ? c.cell * c.giantWhirlRadius * sizeAt(c, level) * scale
      : 0,
    multiplier: enabled
      ? c.giantWhirlDamage + Math.max(0, level - 1) * c.giantWhirlDamageGain
      : 0,
  };
}
export const shopPrice = (c, key, count) =>
  Math.ceil(c[key] * c.shopPriceGrowth ** count);
export function skillValue(c, id, level) {
  if (id === "levelAtk") return permanentDamageAt(c, 0, level);
  if (id === "damage") return damageAt(c, level);
  if (id === "size") return sizeAt(c, level);
  if (id === "pierce") return c.pierce + level * (c.pierceUpgrade ?? 1);
  if (id === "bounce")
    return c.wallBounces + level * (c.wallBounceUpgrade ?? 1);
  if (id === "split") return c.split + level * (c.splitUpgrade ?? 1);
  if (id === "platforms") return Math.min(10, c.launchers + level);
  if (id === "recall")
    return Math.min(1, c.recallChance + level * c.shopRecallChanceGain) * 100;
}
export function progression(c, maxLevel, killsPerRound) {
  let cumulative = 0;
  return Array.from({ length: maxLevel }, (_, i) => {
    const level = i + 1,
      need = curveValue(c, "xp", level);
    cumulative += need;
    return {
      level,
      need,
      kills: c.xpDrop > 0 ? Math.ceil(need / c.xpDrop) : null,
      cumulativeKills: c.xpDrop > 0 ? Math.ceil(cumulative / c.xpDrop) : null,
      rounds:
        c.xpDrop > 0 && killsPerRound > 0
          ? cumulative / c.xpDrop / killsPerRound
          : null,
    };
  });
}
