const group = "弹幕与完美防御 · 实时模式";
const n = (label, value, min, max, step = 1, when = "立即") => ({
  group,
  label,
  value,
  min,
  max,
  step,
  when,
});
const b = (label, value, when = "立即") => ({
  group,
  label,
  value,
  type: "boolean",
  when,
});
const guardWaveSchema = {
  guardMode: {
    group,
    label: "防御表现与判定方式",
    value: "wave",
    type: "select",
    options: { wave: "向前推进光波", fixed: "原固定屏障（对比）" },
    when: "下次格挡",
  },
  guardWavePerfectDuration: n(
    "光波：初始完美防御阶段（秒）",
    0.2,
    0,
    2,
    0.01,
    "下次格挡",
  ),
  guardWaveFadeDuration: n(
    "光波：淡出普通抵挡阶段（秒）",
    0.45,
    0.02,
    3,
    0.01,
    "下次格挡",
  ),
  guardWaveSpeed: n(
    "光波：向前推进速度（像素/秒）",
    260,
    0,
    1600,
    10,
    "下次格挡",
  ),
  guardWaveWidth: n("光波：发光拖尾宽度（像素）", 28, 2, 150, 1, "下次格挡"),
  guardWaveOpacity: n("光波：初始不透明度", 0.85, 0.1, 1, 0.01, "下次格挡"),
  guardWaveFadePower: n(
    "光波：淡出曲线（越大越早变淡）",
    1.5,
    0.2,
    5,
    0.1,
    "下次格挡",
  ),
};
export const guardWaveKeys = Object.keys(guardWaveSchema);
export const barrageSchema = {
  barrageOn: b("启用射手弹幕与屏障（仅实时制）", true),
  shooterChance: n("普通怪替换为射手的概率", 0.18, 0, 1, 0.01, "下次生成"),
  shooterCooldown: n("射手攻击冷却（秒）", 4, 0.4, 20, 0.1, "下次装填"),
  shooterFirstDelayMin: n(
    "射手首次攻击等待最小值（秒）",
    2,
    0.2,
    20,
    0.1,
    "下次生成",
  ),
  shooterFirstDelayMax: n(
    "射手首次攻击等待最大值（秒）",
    4,
    0.2,
    20,
    0.1,
    "下次生成",
  ),
  shooterTelegraph: n("射手开火前蓄力预告（秒）", 0.55, 0, 2, 0.05),
  shooterMoveSpeed: n("射手推进速度（格/秒）", 0.05, 0, 2, 0.005),
  shooterMinFireDistance: n(
    "停火距离：靠近屏障多少格内不再射击",
    1.25,
    0.25,
    5,
    0.05,
  ),
  enemyBulletSpeed: n("敌方子弹速度（像素/秒）", 220, 30, 1600, 10, "下次射击"),
  enemyBulletRadius: n("子弹碰撞半径（像素）", 7, 2, 24, 0.5, "下次射击"),
  enemyBulletDamage: n("子弹突破底墙扣除防线", 1, 0, 5, 1, "下次射击"),
  enemyBulletLife: n("子弹最长存续（秒）", 12, 1, 60, 0.5, "下次射击"),
  enemyBulletCap: n("全场子弹数量上限（含反弹）", 80, 1, 300, 1),
  knifeBlocksBullets: b("飞行飞刀可击落敌弹（飞刀继续飞行）", true),
  ...guardWaveSchema,
  guardDuration: n("固定屏障：持续时间（秒）", 0.2, 0.02, 2, 0.01, "下次格挡"),
  guardCooldown: n("屏障冷却：从展开起计（秒）", 0.8, 0, 5, 0.05, "下次格挡"),
  guardInset: n("屏障高于底墙距离（倍基础格距）", 0.25, 0, 2, 0.05),
  perfectGuardOn: b("启用超级完美防御反弹", true, "下次格挡"),
  perfectGuardWindow: n(
    "固定屏障：刚展开的完美窗口（秒）",
    0.07,
    0,
    0.5,
    0.005,
    "下次格挡",
  ),
  reflectedSpeedScale: n("反弹子弹速度倍率", 1.5, 0.25, 5, 0.05, "下次反弹"),
  reflectedDamageScale: n(
    "反弹伤害：当前飞刀伤害倍率",
    2,
    0,
    10,
    0.1,
    "下次反弹",
  ),
  reflectedHpRatio: n(
    "反弹伤害：叠加目标最大血量比例",
    0.1,
    0,
    1,
    0.01,
    "下次反弹",
  ),
  shooterHue: n("射手换色色相（度）", 145, 0, 360, 1),
  barrageFxOn: b("显示弹幕命中与格挡反馈特效", true),
};
export const barrageKeys = Object.keys(barrageSchema);
export const barrageBalanceKeys = barrageKeys.filter(
  (key) =>
    ![
      "shooterHue",
      "barrageFxOn",
      "guardWaveWidth",
      "guardWaveOpacity",
      "guardWaveFadePower",
    ].includes(key),
);
export const barrageDefaults = Object.fromEntries(
  Object.entries(barrageSchema).map(([key, spec]) => [key, spec.value]),
);
