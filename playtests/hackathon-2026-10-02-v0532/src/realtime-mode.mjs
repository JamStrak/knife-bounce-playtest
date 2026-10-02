// Experimental combat scheduler. Each trigger owns its complete derived attack
// tree; finishing one tree returns one magazine slot independently of the rest.
import { newCombo } from "./combo-rewards.mjs";
import { advanceBossClock } from "./stage-mode.mjs";
import { updateSeeds } from "./field-effects.mjs";
import { updatePickups } from "./pickup-motion.mjs";
import { updateRealtimeSpawn } from "./realtime-spawn.mjs";
import { barrageEnabled, updateBarrage, settleBarrage } from "./barrage.mjs";

const shotFields = [
  "fieldBuffs",
  "combo",
  "shotKills",
  "shotCount",
  "fieldShotCount",
  "shotLimit",
  "recall",
  "effectsUntil",
];

export function resetRealtime(g) {
  g.upgradePending = false;
  g.upgradePendingAge = 0;
  g.realtime = {
    shots: [],
    nextShotId: 0,
    waveAge: 0,
    waveKills: 0,
    cooldown: 0,
    supplyAge: 0,
    clearAge: 0,
    lowAge: 0,
    supplyBaseline: null,
    supplyCount: 0,
    lastSupply: null,
  };
  g.activeShotId = null;
}

export function withRealtimeShot(g, id, action) {
  if (!g.isRealtime || id == null || g.activeShotId === id) return action();
  const shot = g.realtime.shots.find((s) => s.id === id);
  if (!shot) {
    const previousId = g.activeShotId;
    g.activeShotId = id;
    try {
      return action();
    } finally {
      g.activeShotId = previousId;
    }
  }
  const before = Object.fromEntries(shotFields.map((key) => [key, g[key]]));
  const previousId = g.activeShotId;
  g.activeShotId = id;
  for (const key of shotFields) g[key] = shot[key];
  try {
    return action();
  } finally {
    for (const key of shotFields) {
      shot[key] = g[key];
      g[key] = before[key];
    }
    g.activeShotId = previousId;
    // The HUD may display the last resolved shot's combo without sharing its
    // counters with the next shot or a concurrently travelling knife.
    if (previousId == null) g.combo = shot.combo;
  }
}

export function fireRealtime(g, angle) {
  if (!g.canFire) return false;
  g.snapshot = g.captureSnapshot(true);
  const shot = {
    id: ++g.realtime.nextShotId,
    fieldBuffs: {
      power: g.powerBuff.shots > 0 ? g.powerBuff.factor : 1,
      seed: false,
    },
    combo: newCombo(),
    shotKills: 0,
    shotCount: 0,
    fieldShotCount: 0,
    shotLimit: Math.max(g.config.maxKnives, 1),
    recall: null,
    effectsUntil: 0,
  };
  g.realtime.shots.push(shot);
  g.realtime.cooldown = g.config.realtimeFireInterval;
  if (g.powerBuff.shots > 0) g.powerBuff.shots--;
  if (g.stage) g.stage.resultStats.shots++;
  angle = g.normalizeAngle(angle);
  g.lastAngle = angle;
  g.phase = "flight";
  withRealtimeShot(g, shot.id, () => {
    if (
      g.buffs.recall > 0 &&
      g.pins.length &&
      g.random() < g.recallStats.chance
    )
      g.activateRecall();
    const origin = g.launchPattern(angle)[0];
    g.spawnKnife(origin.x, origin.y, angle, g.stats, false);
    g.emit("launch", origin.x, origin.y, {
      angle,
      count: 1,
      shotId: shot.id,
    });
  });
  return true;
}

export function realtimeSpeed(g, enemy) {
  if (enemy.type === "shooter" && !enemy.boss && !enemy.summoned)
    return (
      Math.max(0, g.config.shooterMoveSpeed) *
      Math.max(0, g.config.realtimeSpeedScale) *
      g.rowHeight
    );
  const type =
    enemy.boss === "fortress"
      ? "Fortress"
      : enemy.boss === "summoner"
        ? "Summoner"
        : enemy.summoned
          ? "Summon"
          : enemy.type === "ultraFast"
            ? "UltraFast"
            : enemy.type === "fast"
              ? "Fast"
              : enemy.type === "bomb"
                ? "Bomb"
                : "Normal";
  return (
    Math.max(0, g.config["realtime" + type + "Speed"]) *
    Math.max(0, g.config.realtimeSpeedScale) *
    g.rowHeight
  );
}

function moveEnemies(g, dt) {
  for (const enemy of g.enemies) {
    if (enemy.hp <= 0) continue;
    if (enemy.boss) enemy.hpRatioFactor = g.config.stageBossHpRatioFactor;
    let movingTime = dt;
    if (enemy.entry) {
      const entry = enemy.entry;
      const previousAge = entry.age;
      entry.age += dt;
      const t = Math.max(
        0,
        Math.min(1, (entry.age - entry.delay) / entry.duration),
      );
      enemy.y =
        entry.from + (entry.to - entry.from) * (1 - (1 - t) ** entry.power);
      if (t < 1) continue;
      enemy.y = entry.to;
      movingTime = Math.max(
        0,
        dt - Math.max(0, entry.delay + entry.duration - previousAge),
      );
      delete enemy.entry;
    }
    enemy.y += realtimeSpeed(g, enemy) * movingTime;
    enemy.row = enemy.y / g.rowHeight - 0.5;
    // Match the collision arena, including its bottom wall. A center crossing
    // the defense line is one leak; dead enemies cannot deduct health again.
    if (enemy.y >= g.height) {
      for (const seed of g.seeds)
        if (seed.enemyId === enemy.id) {
          seed.x = enemy.x;
          seed.y = g.height;
        }
      const before = g.lives;
      g.lives = enemy.boss ? 0 : Math.max(0, g.lives - g.config.leakDamage);
      if (g.stage) {
        g.stage.leaked++;
        g.stage.resultStats.livesLost += before - g.lives;
      }
      enemy.leaked = true;
      g.emit("leak", enemy.x, g.height);
    }
  }
  g.enemies = g.enemies.filter((enemy) => enemy.hp > 0 && !enemy.leaked);
  if (g.lives <= 0) g.phase = "over";
}

function advanceClock(g) {
  g.round++;
  g.pickups = g.pickups.filter((p) => p.expires > g.round);
}

function settleShots(g) {
  const aliveIds = new Set(
    g.knives.filter((k) => k.alive).map((k) => k.shotId),
  );
  const seedIds = new Set(g.seeds.map((s) => s.shotId));
  g.realtime.shots = g.realtime.shots.filter((shot) => {
    if (
      aliveIds.has(shot.id) ||
      seedIds.has(shot.id) ||
      shot.recall ||
      g.clock < shot.effectsUntil
    )
      return true;
    if (g.stage)
      g.emit("comboEnd", g.origin.x, g.origin.y, {
        hits: shot.combo.hits,
        kills: shot.combo.kills,
        multiplier: shot.combo.multiplier,
        bonusXp: shot.combo.bonusXp,
        shotId: shot.id,
      });
    return false;
  });
}

export function updateRealtime(g, dt) {
  if (!(dt > 0) || !Number.isFinite(dt) || !g.canAim) return;
  // Substep moving targets together with projectiles. This also makes long
  // deterministic simulations obey the same collision and wave ordering.
  let remaining = dt;
  while (remaining > 1e-9 && g.canAim) {
    const step = Math.min(remaining, 1 / 60);
    remaining -= step;
    if (g.recallIntroActive) {
      for (const shot of [...g.realtime.shots]) {
        const recall = shot.recall;
        if (recall && recall.age < (recall.timing?.intro || 0))
          withRealtimeShot(g, shot.id, () => g.updateRecall(step));
      }
      continue;
    }
    const settlingAtStepStart =
      g.upgradePending && g.realtime.shots.length === 0;
    g.clock += step;
    if (!g.upgradePending)
      g.realtime.cooldown = Math.max(0, g.realtime.cooldown - step);
    updatePickups(g, step);
    g.pins = g.pins.filter((p) => (p.age += step) < g.config.pinLife);
    const previous =
      !g.upgradePending && barrageEnabled(g)
        ? new Map(
            g.enemies.map((e) => [
              e.id,
              {
                x: e.x,
                y: e.y,
                entryRemaining: e.entry
                  ? Math.max(0, e.entry.delay + e.entry.duration - e.entry.age)
                  : 0,
              },
            ]),
          )
        : null;
    if (!g.upgradePending) {
      moveEnemies(g, step);
      if (g.phase === "over") break;
      updateBarrage(g, step, previous);
      if (g.phase === "over") break;
    }
    for (const shot of [...g.realtime.shots])
      withRealtimeShot(g, shot.id, () => g.updateRecall(step));
    updateSeeds(g);
    for (const knife of [...g.knives])
      if (knife.alive)
        withRealtimeShot(g, knife.shotId, () => g.integrate(knife, step));
    g.knives = g.knives.filter((k) => k.alive);
    g.enemies = g.enemies.filter((e) => e.hp > 0);
    settleBarrage(g);
    settleShots(g);
    if (g.upgradePending) {
      if (g.realtime.shots.length) g.upgradePendingAge = 0;
      else if (settlingAtStepStart) g.upgradePendingAge += step;
    }
    g.checkUpgrade();
    if (!g.canAim) break;
    if (g.upgradePending) continue;
    // A Boss born during fast supply gets a complete first action period.
    // Existing Bosses advance before this step's new supply is spawned.
    if (g.stage) advanceBossClock(g, step);
    g.realtime.waveAge += step;
    const interval = Math.max(0.1, g.config.realtimeWaveSeconds);
    const clockTick = g.realtime.waveAge + 1e-9 >= interval;
    if (clockTick) {
      g.realtime.waveAge -= interval;
      advanceClock(g);
    }
    const supplied = g.barrage.training ? false : updateRealtimeSpawn(g, step);
    if (clockTick && !g.barrage.training) g.spawnPickup();
    if (supplied || clockTick) g.checkUpgrade();
  }
}
