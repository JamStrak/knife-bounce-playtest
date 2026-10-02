import { corpseBody } from "./corpse-physics.mjs";
// Presentation only: never move gameplay colliders or delay a turn.
export const entityTypes = {
  normal: "普通怪",
  fast: "快速怪",
  ultraFast: "鱿鱼怪 · 超快速",
  bomb: "爆炸怪",
  shooter: "棱晶射手 · 弹幕",
  item: "道具（预留）",
};
export const idleModes = {
  off: "关闭",
  breatheFloat: "呼吸＋左右漂浮",
  breathe: "呼吸缩放",
  float: "左右漂浮",
  pulse: "节奏脉动",
};
export const deathModes = {
  off: "关闭",
  fall: "击退后重力掉落",
  knockbackFade: "击退渐隐",
  fade: "原地渐隐",
};
export function effectType(e) {
  const type = e.effectProfile || e.enemyType || e.type;
  return Object.hasOwn(entityTypes, type) ? type : "normal";
}
export const entityVisualScale = (e, config) =>
  config[`${effectType(e)}VisualScale`] ?? 1;
export function idlePose(e, config, time, staticPose = false) {
  const type = effectType(e),
    mode = config[`${type}IdleMode`];
  let scale = 1,
    dx = 0,
    idleTime = 0;
  if (config.enemyIdleOn && !staticPose && mode !== "off") {
    const seed = e.animationSeed ?? (e.id || e.enemyId || 0);
    const random = (salt) => {
      let h = (seed ^ salt) >>> 0;
      h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
      h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    };
    const variation = config[`${type}IdleVariation`];
    const phase = random(1) * Math.PI * 2;
    const elapsed = Math.max(0, time - (e.bornAt ?? 0));
    const speed = 1 + (random(2) * 2 - 1) * variation;
    const amount = 1 + (random(3) * 2 - 1) * variation;
    idleTime = elapsed * speed + random(4) * config[`${type}IdlePeriod`];
    const wave = Math.sin(
      (elapsed * speed * Math.PI * 2) / config[`${type}IdlePeriod`] + phase,
    );
    if (mode === "breatheFloat" || mode === "breathe")
      scale += wave * config[`${type}IdleAmount`] * amount;
    if (mode === "pulse")
      scale +=
        Math.pow((wave + 1) / 2, config[`${type}PulsePower`]) *
        config[`${type}IdleAmount`] *
        amount;
    if (mode === "breatheFloat" || mode === "float")
      dx =
        Math.sin(
          (elapsed * (1 + (random(5) * 2 - 1) * variation) * Math.PI * 2) /
            config[`${type}FloatPeriod`] +
            random(6) * Math.PI * 2,
        ) *
        config[`${type}FloatAmount`] *
        amount;
  }
  return { ...e, x: e.x + dx, r: e.r * scale, idleScale: scale, idleTime };
}
export function deathPose(e, config, width, bottom) {
  const type = effectType(e),
    mode = config[`${type}DeathMode`],
    t = e.age;
  if (!config.enemyDeathOn || mode === "off") return null;
  const kick = config[`${type}DeathKick`],
    gravity = config[`${type}DeathGravity`],
    fade = config[`${type}DeathFade`];
  const vx = (e.direction?.x || 0) * kick,
    vy = (e.direction?.y || 0) * kick;
  const radius =
    e.r *
    config.enemyVisualScale *
    entityVisualScale(e, config) *
    config.corpseVisualScale;
  const lever = e.impactOffset || { x: 0, y: 0 };
  const leverScale = Math.max(1, Math.hypot(lever.x, lever.y));
  // Solid-disc inertia I = m*r²/2: off-centre impulse produces angular velocity.
  const omega =
    (2 * (lever.x * vy - lever.y * vx)) / (leverScale * Math.max(radius, 1));
  const body =
    mode === "fall"
      ? corpseBody(
          {
            x: e.x,
            y: e.y,
            radius: radius * config[`${type}DeathCollisionScale`],
            vx,
            vy,
            omega,
          },
          t,
          { width, height: bottom },
          {
            gravity,
            restitution: config[`${type}DeathBounceOn`]
              ? config[`${type}DeathRestitution`]
              : 0,
            friction: config[`${type}DeathFriction`],
            restSpeed: config[`${type}DeathRestSpeed`],
          },
        )
      : null;
  const fadeStart = body
    ? body.restAt == null
      ? Infinity
      : body.restAt + config[`${type}DeathRestHold`]
    : 0;
  const alpha = Math.max(0, 1 - Math.max(0, t - fadeStart) / fade);
  if (!alpha) return null;
  const travel = mode === "knockbackFade" ? t : 0;
  const x = Math.max(
    radius,
    Math.min(Math.max(radius, width - radius), e.x + vx * travel),
  );
  return {
    ...e,
    x: body ? body.x : mode === "fade" ? e.x : x,
    y: body ? body.y : e.y + vy * travel,
    alpha,
    rotation: body ? body.rotation : omega * travel,
  };
}
