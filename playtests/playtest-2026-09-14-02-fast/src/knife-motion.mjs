// The same geometry converts between the collision anchor and visual center.
export const defaultKnifeArt = {
  width: 1,
  height: 0.3,
  anchorX: 0.83,
  anchorY: 0.5,
  rotation: 0,
};
export function knifeCenterOffset(
  meta = defaultKnifeArt,
  length,
  scale,
  angle,
) {
  const m = { ...defaultKnifeArt, ...meta },
    a = angle + (m.rotation * Math.PI) / 180;
  const x = (0.5 - m.anchorX) * length * scale * m.width,
    y = (0.5 - m.anchorY) * length * scale * m.height;
  return {
    x: x * Math.cos(a) - y * Math.sin(a),
    y: x * Math.sin(a) + y * Math.cos(a),
  };
}
export function knifeAnchorAt(center, angle, meta, length, scale) {
  const offset = knifeCenterOffset(meta, length, scale, angle);
  return { x: center.x - offset.x, y: center.y - offset.y };
}
export function turnProgress(t, power = 3) {
  return Math.max(0, Math.min(1, t)) ** power;
}
