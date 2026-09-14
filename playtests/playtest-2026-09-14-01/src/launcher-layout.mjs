// Growth order: center, inner left, inner right, outer left, outer right, ...
export const fanSlot = (index) =>
  index === 0 ? 0 : Math.ceil(index / 2) * (index % 2 ? -1 : 1);
export function discShots(origin, angle, count, config, bounds, radius = 0) {
  const limit = Math.ceil((count - 1) / 2),
    step =
      (Math.min(
        config.discAngleStep,
        config.discMaxAngle / Math.max(1, limit),
      ) *
        Math.PI) /
      180;
  const right = { x: -Math.sin(angle), y: Math.cos(angle) };
  const margin = Math.min(radius + 0.01, bounds.width / 2, bounds.height / 2);
  const clamp = (v, max) => Math.max(margin, Math.min(max - margin, v));
  return Array.from({ length: count }, (_, index) => {
    const slot = fanSlot(index),
      a = angle + slot * step;
    return {
      x: clamp(
        origin.x +
          Math.cos(a) * config.discTipOffset +
          right.x * slot * config.discKnifeGap,
        bounds.width,
      ),
      y: clamp(
        origin.y +
          Math.sin(a) * config.discTipOffset +
          right.y * slot * config.discKnifeGap,
        bounds.height,
      ),
      angle: Math.atan2(Math.sin(a), Math.cos(a)),
      index: index + 1,
    };
  });
}
