export function aimOpacity(progress, config) {
  return (
    config.aimOpacity *
    (config.aimFade ? Math.max(0, 1 - progress) ** config.aimFadePower : 1)
  );
}
export function aimPoints(g, origin, angle) {
  const c = g.config,
    steps = c.aimSeconds * 60,
    points = [],
    stats = g.stats;
  let x = origin.x,
    y = origin.y,
    vx = Math.cos(angle) * c.speed,
    vy = Math.sin(angle) * c.speed,
    travel = 0;
  let nextSample = Math.max(c.aimStartOffset, c.aimDotSpacing);
  for (let i = 0; i < steps; i++) {
    vx *= Math.exp(-c.drag / 60);
    vy *= Math.exp(-c.drag / 60);
    if (g.gravityActive(stats))
      vy = Math.min(c.terminalSpeed, vy + c.gravity / 60);
    const nx = x + vx / 60,
      ny = y + vy / 60;
    if (nx < 0 || nx > g.width || ny < 0 || ny > g.height) break;
    const distance = Math.hypot(nx - x, ny - y);
    const available =
      c.aimMaxLength > 0
        ? Math.min(distance, Math.max(0, c.aimMaxLength - travel))
        : distance;
    if (available <= 0) break;
    if (c.aimDotSpacing > 0) {
      while (nextSample <= travel + available && points.length < 2048) {
        const t = (nextSample - travel) / distance;
        points.push({
          x: x + (nx - x) * t,
          y: y + (ny - y) * t,
          progress: (i + t) / steps,
        });
        nextSample += c.aimDotSpacing;
      }
    } else if (i % 3 === 0 && travel + available >= c.aimStartOffset) {
      const t = available / distance;
      points.push({
        x: x + (nx - x) * t,
        y: y + (ny - y) * t,
        progress: i / steps,
      });
    }
    travel += available;
    x = nx;
    y = ny;
    if (available < distance || points.length >= 2048) break;
  }
  return points;
}
