export const pickupTypes = {
  power: {
    name: "狂热晶石",
    glyph: "✦",
    slot: "pickupPower",
    color: "pickupPower",
    effect: "发射台增伤充能",
  },
  lightning: {
    name: "雷链晶核",
    glyph: "ϟ",
    slot: "pickupLightning",
    color: "pickupLightning",
    effect: "连锁闪电",
  },
  ring: {
    name: "环刃符",
    glyph: "✺",
    slot: "pickupRing",
    color: "pickupRing",
    effect: "环形刀阵",
  },
  seed: {
    name: "爆弹种子",
    glyph: "✹",
    slot: "pickupSeed",
    color: "pickupSeed",
    effect: "爆弹附刃",
  },
};
export function weightedChoice(values, weight, random) {
  const total = values.reduce((s, v) => s + Math.max(0, weight(v)), 0);
  if (!total) return values[0];
  let pick = random() * total;
  for (const value of values) {
    pick -= Math.max(0, weight(value));
    if (pick < 0) return value;
  }
  return values.at(-1);
}
export function entryRows(game, col) {
  const limit = Math.min(3, Math.max(1, game.config.rows - 1));
  const front = game.enemies
    .filter((e) => e.hp > 0 && e.col === col)
    .reduce((min, e) => Math.min(min, e.row), limit);
  return Array.from({ length: limit }, (_, i) => i).filter(
    (row) =>
      row < front &&
      !(game.pickups || []).some((p) => p.col === col && p.row === row),
  );
}
