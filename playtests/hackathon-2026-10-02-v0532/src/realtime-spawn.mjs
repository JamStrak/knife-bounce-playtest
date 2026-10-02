import { spawnBudget } from "./balance-model.mjs";
import { advanceStageSupply, stageFinished } from "./stage-mode.mjs";
import { pressureProfile } from "./stage-pressure.mjs";

const epsilon = 1e-9;
const aliveCount = (g) => g.enemies.filter((e) => e.hp > 0).length;

function hasSupply(g) {
  if (!g.stage) return spawnBudget(g.config, g.round, 0) > 0;
  return (
    !g.stage.completed &&
    !stageFinished(g) &&
    (g.stage.spawned < g.stage.budget ||
      (g.stage.bossKind && !g.stage.bossSpawned))
  );
}

function lowThreshold(g) {
  const base =
    g.stage?.supplyMode === "adaptive"
      ? pressureProfile(
          g.config,
          g.stage.index,
          g.stage.round,
          g.stage.prepTurns,
          g.stage.plan,
        ).target
      : g.realtime.supplyBaseline;
  return (
    Math.min(g.config.enemyCap, Math.max(0, base)) *
    g.config.realtimeLowEnemyRatio
  );
}

function supply(g, reason, before) {
  const rt = g.realtime,
    previousKills = g.shotKills,
    kills = rt.waveKills;
  g.shotKills = kills;
  try {
    if (g.stage)
      advanceStageSupply(g, {
        skipEmptyCurve: g.config.realtimeAdaptiveSpawnOn,
      });
    else g.spawn();
  } finally {
    g.shotKills = previousKills;
  }
  const after = aliveCount(g),
    added = Math.max(0, after - before);
  rt.waveKills = 0;
  rt.supplyAge = 0;
  rt.clearAge = 0;
  rt.lowAge = 0;
  if (added > 0) rt.supplyBaseline = after;
  rt.supplyCount++;
  rt.lastSupply = {
    at: g.clock,
    reason,
    added,
    before,
    after,
    kills,
    stageRound: g.stage?.round ?? null,
  };
  g.emit("realtimeSupply", g.width / 2, 0, { ...rt.lastSupply });
}

// Only supply progress is accelerated. Items keep the fixed global clock;
// Bosses keep the same period, measured from their own birth in stage-mode.mjs.
export function updateRealtimeSpawn(g, dt) {
  const rt = g.realtime,
    alive = aliveCount(g);
  rt.supplyBaseline ??= alive + rt.waveKills;
  rt.supplyAge += dt;
  if (!hasSupply(g)) {
    rt.clearAge = rt.lowAge = 0;
    return false;
  }
  const adaptive = g.config.realtimeAdaptiveSpawnOn;
  rt.clearAge = adaptive && alive === 0 ? rt.clearAge + dt : 0;
  // Leaks alone cannot count as strong play. A dead corpse is not alive, but
  // an entering monster is, so an entrance animation cannot trigger a refill.
  rt.lowAge =
    adaptive && alive > 0 && rt.waveKills > 0 && alive <= lowThreshold(g)
      ? rt.lowAge + dt
      : 0;
  const clearDelay = Math.max(0.05, g.config.realtimeClearDelay),
    lowDelay = Math.max(0.05, g.config.realtimeRefillDelay),
    period = Math.max(0.1, g.config.realtimeWaveSeconds);
  const reason =
    adaptive && rt.clearAge + epsilon >= clearDelay
      ? "clear"
      : adaptive && rt.lowAge + epsilon >= lowDelay
        ? "low"
        : rt.supplyAge + epsilon >= period
          ? "timeout"
          : null;
  if (!reason) return false;
  supply(g, reason, alive);
  return true;
}
