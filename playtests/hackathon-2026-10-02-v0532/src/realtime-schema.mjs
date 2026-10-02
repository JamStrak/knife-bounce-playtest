// This experimental clock is independent of the existing turn-based balance.
const group = "实时模式 · 怪物与飞刀";
const field = (label, value, min, max, step) => ({
  group,
  label,
  value,
  min,
  max,
  step,
  when: "立即（仅实时模式）",
});
const speed = (label, value) =>
  field(`${label}推进速度（格/秒，0停止）`, value, 0, 2, 0.005);
const adaptiveSchema = {
  realtimeAdaptiveSpawnOn: {
    group,
    label: "启用实时自适应补怪",
    value: true,
    type: "boolean",
    when: "立即（仅实时模式）",
  },
  realtimeClearDelay: field("清空战场后补怪等待（秒）", 0.35, 0.05, 5, 0.05),
  realtimeLowEnemyRatio: field("低存量补怪触发比例", 0.35, 0.05, 0.95, 0.05),
  realtimeRefillDelay: field("低存量补怪等待（秒）", 1.5, 0.1, 15, 0.1),
};

export const realtimeSchema = {
  combatMode: {
    group,
    label: "战斗节奏模式",
    value: "turn",
    type: "select",
    options: { turn: "伪回合制", realtime: "实时制 · 连续出刀" },
    when: "重开",
  },
  realtimeSpeedScale: field("全部怪物推进速度倍率", 1, 0, 5, 0.05),
  realtimeDensity: field("怪物数量快捷倍率（仅实时制）", 1, 0.25, 5, 0.05),
  realtimeNormalSpeed: speed("普通怪", 0.06),
  realtimeFastSpeed: speed("快速怪", 0.12),
  realtimeUltraFastSpeed: speed("超快速怪", 0.18),
  realtimeBombSpeed: speed("炸弹怪", 0.05),
  realtimeFortressSpeed: speed("堡垒首领", 0.025),
  realtimeSummonerSpeed: speed("召唤首领", 0.03),
  realtimeSummonSpeed: speed("召唤冲线小怪", 0.15),
  realtimeWaveSeconds: field(
    "基础补怪 / Boss行动 / 道具时钟周期（秒）",
    8,
    1,
    60,
    0.5,
  ),
  ...adaptiveSchema,
  realtimeFireInterval: field("逐把发射最小间隔（秒）", 0.16, 0, 2, 0.01),
};

export const realtimeAdaptiveKeys = Object.keys(adaptiveSchema);
export const realtimeKeys = Object.keys(realtimeSchema);
export const realtimeDefaults = Object.fromEntries(
  Object.entries(realtimeSchema).map(([key, spec]) => [key, spec.value]),
);
