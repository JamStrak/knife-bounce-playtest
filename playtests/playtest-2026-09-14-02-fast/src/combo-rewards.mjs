import { stageConfig } from "./stage-schema.mjs";
export const newCombo = () => ({
  hits: 0,
  kills: 0,
  fastKills: 0,
  multiplier: 1,
  bonusXp: 0,
  baseXp: 0,
  hitIds: [],
  lastKillAt: null,
});
export function comboMultiplier(config, hits, kills, fastKills) {
  const c = stageConfig(config);
  const bonus =
    (c.comboHitOn
      ? Math.min(c.comboHitCap, Math.max(0, hits - 1) * c.comboHitGain)
      : 0) +
    (c.comboKillOn
      ? Math.min(c.comboKillCap, Math.max(0, kills - 1) * c.comboKillGain)
      : 0) +
    (c.comboFastOn
      ? Math.min(c.comboFastCap, Math.max(0, fastKills - 1) * c.comboFastGain)
      : 0);
  return Math.min(c.comboMaxMultiplier, 1 + bonus);
}
export function comboHit(g, enemy) {
  if (!g.stage || g.phase !== "flight") return;
  if (!g.combo.hitIds.includes(enemy.id)) {
    g.combo.hitIds.push(enemy.id);
    g.combo.hits++;
  }
}
export function comboKillXp(g, baseXp) {
  if (!g.stage || g.phase !== "flight") return baseXp;
  const c = stageConfig(g.config),
    combo = g.combo;
  combo.kills++;
  combo.fastKills =
    combo.lastKillAt !== null && g.clock - combo.lastKillAt <= c.comboFastWindow
      ? combo.fastKills + 1
      : 1;
  combo.lastKillAt = g.clock;
  combo.multiplier = comboMultiplier(
    c,
    combo.hits,
    combo.kills,
    combo.fastKills,
  );
  const xp = baseXp * combo.multiplier;
  combo.baseXp += baseXp;
  combo.bonusXp += xp - baseXp;
  g.emit("combo", g.origin.x, g.origin.y, {
    hits: combo.hits,
    kills: combo.kills,
    fastKills: combo.fastKills,
    multiplier: combo.multiplier,
    bonusXp: combo.bonusXp,
  });
  return xp;
}
