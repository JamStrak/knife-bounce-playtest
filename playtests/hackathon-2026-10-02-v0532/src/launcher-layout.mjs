// Growth order: center, inner left, inner right, outer left, outer right, ...
export const fanSlot = (index) =>
  index === 0 ? 0 : Math.ceil(index / 2) * (index % 2 ? -1 : 1);
// Fixed arena-axis offsets move the knife's aiming/launch pivot, not its base
// artwork or ATK badge. Keep the collision anchor inside the actual arena.
export function offsetLaunchOrigin(origin, config, bounds, radius = 0) {
  const margin = Math.min(radius + 0.01, bounds.width / 2, bounds.height / 2);
  const clamp = (v, max) => Math.max(margin, Math.min(max - margin, v));
  return {
    x: clamp(origin.x + (config.launchKnifeOffsetX ?? 0), bounds.width),
    y: clamp(origin.y + (config.launchKnifeOffsetY ?? 0), bounds.height),
  };
}
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
