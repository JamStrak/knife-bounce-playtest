import { hybridDamage } from "./balance-model.mjs";
import { newCombo } from "./combo-rewards.mjs";

const EPS = 1e-9;
export const barrageEnabled = (g) => g.isRealtime && g.config.barrageOn;
export const shieldY = (g) =>
  Math.max(
    0,
    Math.min(g.height, g.height - g.config.guardInset * g.config.cell),
  );
// One shared leading edge for physics and drawing. The sampled origin also
// belongs to retry snapshots; arena-resize maps it with the projectiles.
export const guardY = (g, offset = 0) =>
  g.barrage.guardMode === "wave"
    ? Math.max(
        0,
        g.barrage.guardOriginY -
          g.barrage.guardWaveSpeed * (g.barrage.guardAge + offset),
      )
    : shieldY(g);

export const guardOpacity = (g) => {
  const b = g.barrage;
  if (b.guardMode !== "wave") return 1;
  const fade = Math.max(
    0,
    Math.min(
      1,
      (b.guardAge - b.guardWavePerfectDuration) / b.guardWaveFadeDuration,
    ),
  );
  return b.guardWaveOpacity * (1 - fade) ** b.guardWaveFadePower;
};
// The muzzle is on the monster's lower edge. Use the actual arena row height,
// which can differ from cell width after fitting a tall phone viewport.
export const shooterHasClearance = (g, enemy, centerY = enemy.y) =>
  shieldY(g) - centerY - enemy.r + EPS >=
  g.config.shooterMinFireDistance * g.rowHeight;

export function resetBarrage(g) {
  g.barrage = {
    projectiles: [],
    guardRemaining: 0,
    guardAge: 0,
    guardCooldown: 0,
    guardDuration: 0,
    guardMode: "fixed",
    guardOriginY: 0,
    guardWaveSpeed: 0,
    guardWavePerfectDuration: 0,
    guardWaveFadeDuration: 0,
    guardWaveWidth: 0,
    guardWaveOpacity: 0,
    guardWaveFadePower: 1,
    cooldownDuration: 0,
    perfectWindow: 0,
    effectsUntil: 0,
    training: false,
    stats: { shots: 0, blocks: 0, perfects: 0, hits: 0 },
  };
}

// Disabling the experiment must also clear it while the game is paused.
export function syncBarrage(g) {
  if (barrageEnabled(g)) return;
  if (
    g.barrage.projectiles.length ||
    g.barrage.guardRemaining ||
    g.barrage.guardCooldown ||
    g.barrage.effectsUntil
  ) {
    const training = g.barrage.training;
    resetBarrage(g);
    g.barrage.training = training;
  }
  for (const enemy of g.enemies) {
    delete enemy.shootCooldown;
    delete enemy.shootInterval;
  }
}

export function prepareShooter(g, enemy) {
  if (
    !barrageEnabled(g) ||
    enemy.type !== "shooter" ||
    enemy.boss ||
    enemy.summoned
  )
    return;
  const low = Math.min(
    g.config.shooterFirstDelayMin,
    g.config.shooterFirstDelayMax,
  );
  const high = Math.max(
    g.config.shooterFirstDelayMin,
    g.config.shooterFirstDelayMax,
  );
  enemy.shootCooldown = low + g.random() * (high - low);
  enemy.shootInterval = enemy.shootCooldown;
}

export function canGuard(g) {
  return !!(
    barrageEnabled(g) &&
    g.canAim &&
    g.lives > 0 &&
    g.barrage.guardRemaining <= EPS &&
    g.barrage.guardCooldown <= EPS
  );
}

export function activateGuard(g) {
  if (!canGuard(g)) return false;
  const b = g.barrage,
    c = g.config;
  b.guardAge = 0;
  b.guardMode = c.guardMode === "wave" ? "wave" : "fixed";
  b.guardOriginY = shieldY(g);
  b.guardWaveSpeed = Math.max(0, c.guardWaveSpeed);
  b.guardWavePerfectDuration = Math.max(0, c.guardWavePerfectDuration);
  b.guardWaveFadeDuration = Math.max(EPS, c.guardWaveFadeDuration);
  b.guardWaveWidth = c.guardWaveWidth;
  b.guardWaveOpacity = c.guardWaveOpacity;
  b.guardWaveFadePower = c.guardWaveFadePower;
  b.guardDuration = b.guardRemaining =
    b.guardMode === "wave"
      ? b.guardWavePerfectDuration + b.guardWaveFadeDuration
      : Math.max(0, c.guardDuration);
  if (b.guardMode === "wave" && b.guardWaveSpeed > 0)
    b.guardRemaining = Math.min(
      b.guardRemaining,
      b.guardOriginY / b.guardWaveSpeed,
    );
  b.cooldownDuration = b.guardCooldown = Math.max(0, c.guardCooldown);
  b.perfectWindow = c.perfectGuardOn
    ? Math.min(
        b.guardDuration,
        b.guardMode === "wave"
          ? b.guardWavePerfectDuration
          : Math.max(0, c.perfectGuardWindow),
      )
    : 0;
  g.emit("guard", g.width / 2, shieldY(g), { duration: b.guardDuration });
  return true;
}

// First contact of a relative-motion segment with a circle, including tangency.
function circleTime(x, y, vx, vy, radius, duration) {
  const c = x * x + y * y - radius * radius;
  if (c <= EPS) return 0;
  const a = vx * vx + vy * vy;
  if (a <= EPS) return null;
  const b = 2 * (x * vx + y * vy),
    discriminant = b * b - 4 * a * c;
  if (discriminant < -EPS) return null;
  const t = (-b - Math.sqrt(Math.max(0, discriminant))) / (2 * a);
  return t >= -EPS && t <= duration + EPS
    ? Math.max(0, Math.min(duration, t))
    : null;
}

// Match integrate's per-knife movement steps without changing combat state.
// A segment ends when that knife would stop at a wall or an enemy; its bullet
// contacts are then ordered with guard and bottom contacts on one timeline.
function knifeSegments(g, dt, initialEnemies, enemyDeaths) {
  if (!g.config.knifeBlocksBullets) return [];
  const c = g.config,
    segments = [];
  for (const knife of g.knives) {
    if (!knife.alive || knife.age + dt >= knife.maxLife) continue;
    if (c.energyOn && knife.energy - c.energyDrain * dt <= 0 && !c.gravityOn)
      continue;
    const k = {
      x: knife.x,
      y: knife.y,
      vx: knife.vx,
      vy: knife.vy,
      wall: knife.wall,
      enemy: knife.enemy,
      pierce: knife.pierce,
      energy: c.energyOn
        ? Math.max(0, knife.energy - c.energyDrain * dt)
        : knife.energy,
      exhausted:
        knife.exhausted ||
        (c.energyOn && knife.energy - c.energyDrain * dt <= 0),
      contacts: [...knife.contacts],
    };
    const count = Math.max(
        1,
        Math.ceil(
          (Math.hypot(k.vx, k.vy) * dt) /
            Math.max(1, Math.min(knife.r, c.cell * c.enemyRadius) * 0.5),
        ),
      ),
      h = dt / count;
    const reflect = (nx, ny) => {
      const dot = k.vx * nx + k.vy * ny;
      k.vx = (k.vx - 2 * dot * nx) * c.restitution;
      k.vy = (k.vy - 2 * dot * ny) * c.restitution;
      if (!k.exhausted) {
        const speed = Math.hypot(k.vx, k.vy);
        if (speed) {
          k.vx *= 1 + c.bounceBoost / speed;
          k.vy *= 1 + c.bounceBoost / speed;
        }
        k.energy = Math.min(c.energy, k.energy + c.energyGain);
      }
    };
    for (let s = 0; s < count; s++) {
      const x = k.x,
        y = k.y;
      k.vx *= Math.exp(-c.drag * h);
      k.vy *= Math.exp(-c.drag * h);
      if (
        c.gravityOn &&
        (!c.gravityAfterBounces || (k.enemy <= 0 && k.wall <= 0))
      )
        k.vy = Math.min(c.terminalSpeed, k.vy + c.gravity * h);
      k.x += k.vx * h;
      k.y += k.vy * h;
      let nx = 0,
        ny = 0;
      if (k.x < knife.r) {
        k.x = knife.r;
        nx = 1;
      } else if (k.x > g.width - knife.r) {
        k.x = g.width - knife.r;
        nx = -1;
      }
      if (k.y < knife.r) {
        k.y = knife.r;
        ny = 1;
      } else if (k.y > g.height - knife.r) {
        k.y = g.height - knife.r;
        ny = -1;
      }
      segments.push({
        knifeId: knife.id,
        r: knife.r,
        start: s * h,
        end: (s + 1) * h,
        x,
        y,
        vx: (k.x - x) / h,
        vy: (k.y - y) / h,
      });
      if (nx || ny) {
        if (k.wall <= 0) break;
        k.wall--;
        const norm = Math.hypot(nx, ny);
        reflect(nx / norm, ny / norm);
      }
      let stopped = false;
      for (const enemy of g.enemies) {
        // A reflected hit can kill an enemy during this frame. Replaying from
        // the frame start must keep it solid only until that hit's time.
        if (
          !initialEnemies.has(enemy.id) ||
          (enemyDeaths.has(enemy.id) &&
            enemyDeaths.get(enemy.id) <= (s + 1) * h + EPS)
        )
          continue;
        const touching =
          Math.hypot(k.x - enemy.x, k.y - enemy.y) <= enemy.r + knife.r;
        if (!touching) {
          k.contacts = k.contacts.filter((id) => id !== enemy.id);
          continue;
        }
        if (k.contacts.includes(enemy.id)) continue;
        k.contacts.push(enemy.id);
        if (k.pierce > 0) {
          k.pierce--;
        } else if (k.enemy > 0) {
          k.enemy--;
          let ex = k.x - enemy.x,
            ey = k.y - enemy.y,
            distance = Math.hypot(ex, ey);
          if (distance < 0.00001) {
            distance = Math.hypot(k.vx, k.vy) || 1;
            ex = -k.vx / distance;
            ey = -k.vy / distance;
            distance = 1;
          }
          ex /= distance;
          ey /= distance;
          reflect(ex, ey);
          k.x = enemy.x + ex * (enemy.r + knife.r + 0.1);
          k.y = enemy.y + ey * (enemy.r + knife.r + 0.1);
        } else {
          stopped = true;
          break;
        }
      }
      if (stopped) break;
    }
  }
  return segments;
}

function reflectedDamage(g, projectile, enemy) {
  // A reflected bullet earns normal rewards but never joins a travelling knife's
  // combo or attack tree. Bomb chains remain in this independent damage context.
  const before = {
    combo: g.combo,
    shotKills: g.shotKills,
    phase: g.phase,
    activeShotId: g.activeShotId,
    effectsUntil: g.effectsUntil,
  };
  g.combo = newCombo();
  g.shotKills = 0;
  g.phase = "aim";
  g.activeShotId = null;
  g.effectsUntil = g.barrage.effectsUntil;
  try {
    g.damageEnemy(
      enemy,
      hybridDamage(projectile.damage, projectile.hpRatio, enemy),
      false,
      projectile,
    );
  } finally {
    g.barrage.effectsUntil = g.effectsUntil;
    Object.assign(g, before);
  }
}

// Predict one projectile's next event on the shared frame timeline. Cached
// absolute event times remain valid while other projectiles advance, except
// when a scheduled target dies; those predictions are recalculated below.
function nextEvent(g, p, offset, dt, previous, knives) {
  const life = Math.max(0, p.life - p.age),
    duration = Math.min(Math.max(0, dt - offset), life);
  let event =
    life <= dt - offset + EPS
      ? { kind: "expire", time: offset + life, p }
      : null;
  const offer = (kind, time, extra = {}) => {
    if (
      time === null ||
      !Number.isFinite(time) ||
      time < -EPS ||
      time > duration + EPS
    )
      return;
    const at = offset + Math.max(0, Math.min(duration, time));
    // Contact at the expiry instant still resolves. Enemy contact at the top
    // boundary precedes removal, as does guard contact at the bottom boundary.
    if (
      !event ||
      at < event.time - EPS ||
      (Math.abs(at - event.time) <= EPS && event.kind === "expire")
    )
      event = { kind, time: at, p, ...extra };
  };
  if (p.reflected) {
    for (const enemy of g.enemies) {
      if (enemy.hp <= 0 || enemy.leaked) continue;
      const start = previous.get(enemy.id) || enemy,
        vx = (enemy.x - start.x) / dt,
        vy = (enemy.y - start.y) / dt;
      const time = circleTime(
        p.x - start.x - vx * offset,
        p.y - start.y - vy * offset,
        p.vx - vx,
        p.vy - vy,
        p.r + enemy.r,
        duration,
      );
      // Equal-time overlapping targets use stable entity IDs rather than array
      // order. Valid spawned enemies normally do not overlap.
      if (
        time !== null &&
        event?.kind === "enemy" &&
        Math.abs(offset + time - event.time) <= EPS &&
        enemy.id < event.enemy.id
      )
        event = { kind: "enemy", time: offset + time, p, enemy };
      else offer("enemy", time, { enemy });
    }
    offer("wall", p.vy < 0 ? Math.max(0, (p.r - p.y) / p.vy) : Infinity);
  } else {
    for (const knife of knives) {
      const start = Math.max(offset, knife.start),
        end = Math.min(offset + duration, knife.end);
      if (end < start - EPS) continue;
      const time = circleTime(
        p.x +
          p.vx * (start - offset) -
          knife.x -
          knife.vx * (start - knife.start),
        p.y +
          p.vy * (start - offset) -
          knife.y -
          knife.vy * (start - knife.start),
        p.vx - knife.vx,
        p.vy - knife.vy,
        p.r + knife.r,
        Math.max(0, end - start),
      );
      if (time !== null)
        offer("knife", start + time - offset, { knifeId: knife.knifeId });
    }
    const b = g.barrage,
      shield = guardY(g, offset),
      waveSpeed = b.guardMode === "wave" ? b.guardWaveSpeed : 0,
      relativeSpeed = p.vy + waveSpeed,
      time =
        relativeSpeed > 0 && p.y + p.r <= shield + EPS
          ? Math.max(0, (shield - p.r - p.y) / relativeSpeed)
          : Infinity;
    if (b.guardRemaining > 0 && offset + time <= b.guardRemaining + EPS)
      offer("guard", time);
    offer(
      "bottom",
      p.vy > 0 ? Math.max(0, (g.height - p.r - p.y) / p.vy) : Infinity,
    );
  }
  return event;
}

function earlier(a, b) {
  if (!b) return true;
  if (Math.abs(a.time - b.time) > EPS) return a.time < b.time;
  // Existing contacts at an exact firing instant resolve before new births.
  if ((a.kind === "birth") !== (b.kind === "birth")) return a.kind !== "birth";
  return (a.p?.id ?? a.enemy.id) < (b.p?.id ?? b.enemy.id);
}

function resolveTimeline(g, dt, previous, births) {
  const b = g.barrage,
    active = new Set(b.projectiles),
    cache = new Map(),
    initialEnemies = new Set(
      g.enemies.filter((e) => e.hp > 0).map((e) => e.id),
    ),
    enemyDeaths = new Map(),
    needsKnives = births.length || b.projectiles.some((p) => !p.reflected);
  let knives = needsKnives
    ? knifeSegments(g, dt, initialEnemies, enemyDeaths)
    : [];
  let offset = 0,
    birthIndex = 0;
  births.sort((a, z) => a.time - z.time || a.enemy.id - z.enemy.id);
  const advance = (at) => {
    const elapsed = Math.max(0, at - offset);
    for (const p of active) {
      p.x += p.vx * elapsed;
      p.y += p.vy * elapsed;
      p.age += elapsed;
    }
    offset = at;
  };
  const remove = (p) => {
    active.delete(p);
    cache.delete(p);
  };
  while (g.phase !== "over") {
    let event = births[birthIndex] || null;
    for (const p of active) {
      let next = cache.get(p);
      if (
        !cache.has(p) ||
        (next?.enemy && (next.enemy.hp <= 0 || next.enemy.leaked))
      ) {
        next = nextEvent(g, p, offset, dt, previous, knives);
        cache.set(p, next);
      }
      if (next && earlier(next, event)) event = next;
    }
    if (!event) {
      advance(dt);
      break;
    }
    advance(Math.max(offset, Math.min(dt, event.time)));
    if (event.kind === "birth") {
      birthIndex++;
      const { enemy, x, y } = event,
        c = g.config;
      if (enemy.hp <= 0 || enemy.leaked || active.size >= c.enemyBulletCap)
        continue;
      const p = {
        id: ++g.id,
        x,
        y,
        vx: 0,
        vy: c.enemyBulletSpeed,
        r: c.enemyBulletRadius,
        age: 0,
        life: c.enemyBulletLife,
        reflected: false,
        sourceId: enemy.id,
        damage: c.enemyBulletDamage,
        hpRatio: 0,
      };
      active.add(p);
      b.stats.shots++;
      g.emit("enemyShot", x, y, { enemyId: enemy.id });
      continue;
    }
    const p = event.p;
    cache.delete(p);
    if (event.kind === "knife") {
      g.emit("knifeBulletBlock", p.x, p.y, {
        knifeId: event.knifeId,
        bulletId: p.id,
      });
      remove(p);
    } else if (event.kind === "guard") {
      if (b.perfectWindow > 0 && b.guardAge + offset <= b.perfectWindow + EPS) {
        b.stats.perfects++;
        p.reflected = true;
        p.vy = -Math.abs(p.vy) * g.config.reflectedSpeedScale;
        p.vx *= g.config.reflectedSpeedScale;
        p.damage = g.stats.damage * g.config.reflectedDamageScale;
        p.hpRatio = g.config.reflectedHpRatio;
        g.emit("perfectGuard", p.x, guardY(g, offset), {
          direction: { x: 0, y: -1 },
        });
      } else {
        b.stats.blocks++;
        g.emit("guardBlock", p.x, guardY(g, offset));
        remove(p);
      }
    } else if (event.kind === "enemy") {
      reflectedDamage(g, p, event.enemy);
      g.emit("reflectedHit", p.x, p.y, {
        enemyId: event.enemy.id,
        damage: p.damage,
      });
      remove(p);
      let changed = false;
      for (const enemy of g.enemies)
        if (
          initialEnemies.has(enemy.id) &&
          enemy.hp <= 0 &&
          !enemyDeaths.has(enemy.id)
        ) {
          enemyDeaths.set(enemy.id, offset);
          changed = true;
        }
      if (changed && needsKnives) {
        knives = knifeSegments(g, dt, initialEnemies, enemyDeaths);
        cache.clear();
      }
      // The final kill clears hostile bullets immediately, before a later
      // bottom contact in this frame. Reflected bullets retain their lifetime.
      if (!g.enemies.some((e) => e.hp > 0))
        for (const hostile of active) if (!hostile.reflected) remove(hostile);
    } else if (event.kind === "bottom") {
      const before = g.lives;
      g.lives = Math.max(0, g.lives - p.damage);
      if (g.stage) g.stage.resultStats.livesLost += before - g.lives;
      b.stats.hits++;
      g.emit("bulletImpact", p.x, g.height, { damage: before - g.lives });
      remove(p);
      if (g.lives <= 0) g.phase = "over";
    } else remove(p);
  }
  b.projectiles = [...active];
  return offset;
}

export function updateBarrage(g, dt, previous) {
  if (!barrageEnabled(g)) return;
  settleBarrage(g);
  const b = g.barrage,
    c = g.config;
  if (b.guardMode === "wave" && b.guardRemaining > 0) {
    b.guardRemaining = Math.max(
      0,
      Math.min(
        b.guardDuration - b.guardAge,
        b.guardWaveSpeed > 0 ? guardY(g) / b.guardWaveSpeed : Infinity,
      ),
    );
  }
  const births = [];
  for (const enemy of g.enemies) {
    if (
      enemy.hp <= 0 ||
      enemy.type !== "shooter" ||
      enemy.boss ||
      enemy.summoned
    )
      continue;
    if (!Number.isFinite(enemy.shootCooldown)) prepareShooter(g, enemy);
    if (enemy.entry) continue;
    const before = previous.get(enemy.id) || enemy;
    const wait = Math.min(dt, before.entryRemaining || 0);
    const activeTime = dt - wait;
    if (!(activeTime > 0)) continue;
    enemy.shootCooldown -= activeTime;
    while (enemy.shootCooldown <= EPS) {
      const offset = Math.max(wait, dt + enemy.shootCooldown);
      const x = before.x + ((enemy.x - before.x) * offset) / dt;
      const y = before.y + ((enemy.y - before.y) * offset) / dt + enemy.r;
      if (shooterHasClearance(g, enemy, y - enemy.r))
        births.push({ kind: "birth", time: offset, enemy, x, y });
      enemy.shootInterval = Math.max(0.01, c.shooterCooldown);
      enemy.shootCooldown += enemy.shootInterval;
    }
  }
  const elapsed = resolveTimeline(g, dt, previous, births);
  b.guardAge += Math.min(elapsed, b.guardRemaining);
  b.guardRemaining = Math.max(0, b.guardRemaining - elapsed);
  b.guardCooldown = Math.max(0, b.guardCooldown - elapsed);
  settleBarrage(g);
}

export function settleBarrage(g) {
  if (!g.enemies.some((e) => e.hp > 0))
    g.barrage.projectiles = g.barrage.projectiles.filter((p) => p.reflected);
}

export const barragePending = (g) =>
  barrageEnabled(g) &&
  (g.barrage.projectiles.some((p) => p.reflected) ||
    g.clock + EPS < g.barrage.effectsUntil);
