// Battlefield pickups are temporary attacks, separate from permanent upgrades.
import { hybridDamage } from "./balance-model.mjs";
export function triggerPickup(g, p) {
  const c = g.config;
  if (p.type === "power") {
    const factor = Math.max(1 + c.pickupPowerGain, g.attackPower);
    g.powerBuff = {
      shots: Math.max(g.powerBuff.shots, c.pickupPowerShots),
      factor,
    };
    if (g.phase === "flight") {
      const ratio = factor / g.fieldBuffs.power;
      g.fieldBuffs.power = factor;
      for (const k of g.knives) if (k.alive) k.damage *= ratio;
      if (g.recall) g.recall.stats.damage *= ratio;
    }
  } else if (p.type === "lightning") {
    const points = [{ x: p.x, y: p.y }],
      hit = new Set();
    const damage = g.stats.damage * c.pickupLightningDamage;
    for (let i = 0; i < c.pickupLightningCount; i++) {
      const from = points.at(-1);
      const target = g.enemies
        .filter((e) => e.hp > 0 && !hit.has(e.id))
        .map((e) => ({ e, d: Math.hypot(e.x - from.x, e.y - from.y) }))
        .filter((t) => t.d <= c.cell * c.pickupLightningRange)
        .sort((a, b) => a.d - b.d || a.e.id - b.e.id)[0]?.e;
      if (!target) break;
      hit.add(target.id);
      points.push({ x: target.x, y: target.y });
      g.damageEnemy(
        target,
        hybridDamage(damage, c.pickupLightningHpRatio, target),
        false,
        {
          vx: target.x - from.x,
          vy: target.y - from.y,
        },
      );
    }
    g.emit("lightning", p.x, p.y, {
      points,
      duration: c.pickupLightningDuration,
    });
    g.effectsUntil = Math.max(
      g.effectsUntil,
      g.clock + c.pickupLightningDuration,
    );
  } else if (p.type === "ring") {
    const stats = {
      ...g.stats,
      damage: g.stats.damage * c.pickupRingDamage,
      hpDamageRatio: c.pickupRingHpRatio,
      pierce: c.pickupRingPierce,
      wall: 0,
      enemy: 0,
      split: 0,
      fieldAttack: true,
    };
    for (let i = 0; i < c.pickupRingCount; i++)
      g.spawnKnife(
        p.x,
        p.y,
        (c.pickupRingAngle / 180 + (i * 2) / c.pickupRingCount) * Math.PI,
        stats,
        true,
      );
    g.emit("ring", p.x, p.y);
  } else if (p.type === "seed") g.fieldBuffs.seed = true;
}

export function plantSeed(g, e, k) {
  // One pending bomb per target. Further hits do not postpone its fuse.
  if (!g.fieldBuffs.seed || g.seeds.some((s) => s.enemyId === e.id)) return;
  const c = g.config;
  g.seeds.push({
    enemyId: e.id,
    x: e.x,
    y: e.y,
    at: g.clock,
    due: g.clock + c.pickupSeedDelay,
    damage: k.damage * c.pickupSeedDamage,
    hpDamageRatio: c.pickupSeedHpRatio,
    radius: c.cell * c.pickupSeedRadius,
  });
  g.emit("plant", e.x, e.y);
}

export function updateSeeds(g) {
  const ready = g.seeds.filter((s) => s.due <= g.clock);
  g.seeds = g.seeds.filter((s) => s.due > g.clock);
  for (const s of ready) {
    // A killed target leaves its seed at the hit point; it still detonates.
    g.emit("explode", s.x, s.y, { radius: s.radius, seed: true });
    g.effectsUntil = Math.max(
      g.effectsUntil,
      g.clock + g.config.bombFxDuration,
    );
    for (const e of g.enemies)
      if (e.hp > 0 && Math.hypot(e.x - s.x, e.y - s.y) <= s.radius + e.r)
        g.damageEnemy(e, hybridDamage(s.damage, s.hpDamageRatio, e), false, {
          vx: e.x - s.x,
          vy: e.y - s.y,
        });
  }
}
