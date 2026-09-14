const unit = (seed) => {
  let n = seed | 0;
  n = Math.imul(n ^ (n >>> 16), 0x7feb352d);
  n = Math.imul(n ^ (n >>> 15), 0x846ca68b);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
};
// Mirror the whole travelled distance, so even a long frame cannot escape the walls.
export function reflectAxis(position, velocity, dt, min, max) {
  const span = max - min;
  if (span <= 0) return [min, 0];
  const start = Math.max(min, Math.min(max, position));
  if (velocity === 0) return [start, 0];
  const phase =
    (((start - min + velocity * dt) % (span * 2)) + span * 2) % (span * 2);
  return [
    min + (phase <= span ? phase : span * 2 - phase),
    phase === 0
      ? Math.abs(velocity)
      : phase === span
        ? -Math.abs(velocity)
        : phase < span
          ? velocity
          : -velocity,
  ];
}
export function updatePickups(g, dt) {
  const c = g.config;
  if (!c.fieldItemsOn) return;
  const running = g.phase === "aim" || g.phase === "flight";
  for (const p of g.pickups) {
    p.homeX ??= p.x;
    p.homeY ??= p.y;
    if (!c.pickupDriftOn) {
      p.x = p.homeX;
      p.y = p.homeY;
      continue;
    }
    if (!running || dt <= 0) continue;
    const seed = Math.imul(p.id, 0x9e3779b1) ^ c.seed;
    if (p.driftMode !== c.pickupDriftMode) {
      const angle = unit(seed) * Math.PI * 2;
      p.driftX =
        c.pickupDriftMode === "horizontal"
          ? unit(seed) < 0.5
            ? -1
            : 1
          : Math.cos(angle);
      p.driftY = c.pickupDriftMode === "horizontal" ? 0 : Math.sin(angle);
      p.driftMode = c.pickupDriftMode;
      p.driftSpeedUnit = unit(seed ^ 0x51ed270b);
    }
    const minSpeed = Math.min(c.pickupDriftSpeedMin, c.pickupDriftSpeedMax);
    const speed =
      (minSpeed +
        Math.abs(c.pickupDriftSpeedMax - c.pickupDriftSpeedMin) *
          p.driftSpeedUnit) *
      c.cell;
    const r = c.pickupRadius * c.cell,
      range = c.pickupDriftRange * c.cell;
    const local = p.driftMode === "local";
    const left = Math.max(r, local ? p.homeX - range : r),
      right = Math.min(g.width - r, local ? p.homeX + range : g.width - r);
    const top = Math.max(r, local ? p.homeY - range : r),
      bottom = Math.min(g.height - r, local ? p.homeY + range : g.height - r);
    const [x, vx] = reflectAxis(p.x, p.driftX * speed, dt, left, right);
    const [y, vy] = reflectAxis(
      p.driftMode === "horizontal" ? p.homeY : p.y,
      p.driftY * speed,
      dt,
      top,
      bottom,
    );
    p.x = x;
    p.y = y;
    if (speed > 0) {
      if (right > left) p.driftX = vx / speed;
      if (bottom > top) p.driftY = vy / speed;
    }
  }
}
export const remainingTurns = (p, g) => Math.max(0, p.expires - g.round);
