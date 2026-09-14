// Keep stage counters inside stage so the existing pre-shot snapshot restores them.
export function newStageResultStats(g) {
  return {
    levelStart: g.level,
    atkStart: g.permanentAtk,
    scoreStart: g.score,
    livesStart: g.lives,
    buffsStart: { ...g.buffs },
    shopPurchasesStart: { ...g.shopPurchases },
    shots: 0,
    xpEarned: 0,
    coinsEarned: 0,
    maxKills: 0,
    livesLost: 0,
  };
}

export function recordStageReward(g, xp, coins) {
  const stats = g.stage?.resultStats;
  if (!stats) return;
  stats.xpEarned += xp;
  stats.coinsEarned += coins;
  if (g.phase === "flight")
    stats.maxKills = Math.max(stats.maxKills, g.shotKills);
}

export function stageResult(g) {
  const s = g.stage,
    stats = s?.resultStats;
  if (!stats) return null;
  const ids = new Set([
    ...Object.keys(stats.buffsStart),
    ...Object.keys(g.buffs),
    ...Object.keys(g.shopPurchases),
  ]);
  const buildChanges = [...ids]
    .map((id) => {
      const from = stats.buffsStart[id] || 0,
        to = g.buffs[id] || 0,
        shopFrom = stats.shopPurchasesStart[id] || 0,
        shopTo = g.shopPurchases[id] || 0;
      return {
        id,
        from,
        to,
        delta: to - from,
        shopFrom,
        shopTo,
        shopDelta: shopTo - shopFrom,
      };
    })
    .filter((change) => change.delta !== 0 || change.shopDelta !== 0);
  return {
    index: s.index,
    name: s.name,
    completed: s.completed,
    score: g.score - stats.scoreStart,
    kills: s.killed,
    shots: stats.shots,
    xpEarned: stats.xpEarned,
    coinsEarned: stats.coinsEarned,
    maxKills: stats.maxKills,
    leaked: s.leaked,
    livesLost: stats.livesLost,
    levelStart: stats.levelStart,
    levelEnd: g.level,
    atkStart: stats.atkStart,
    atkEnd: g.permanentAtk,
    livesStart: stats.livesStart,
    livesEnd: g.lives,
    buildChanges,
  };
}
