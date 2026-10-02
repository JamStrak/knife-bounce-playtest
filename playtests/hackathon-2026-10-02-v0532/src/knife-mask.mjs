import { defaultKnifeArt, knifeCenterOffset } from "./knife-motion.mjs";
export function hiddenBladeDepth(depth, age, duration, multiplier = 1) {
  return Math.max(
    0,
    depth *
      multiplier *
      (1 - Math.exp((-Math.max(0, age) * 5) / Math.max(duration, 1e-6))),
  );
}
// Forward extent relative to the collision anchor, independent of source image orientation.
export function bladeCut(meta, length, scale, depth, mesh = false) {
  const m = { ...defaultKnifeArt, ...meta };
  const center = knifeCenterOffset(m, length, scale, 0);
  const angle = (m.rotation * Math.PI) / 180;
  const half = mesh
    ? (length * scale) / 2
    : (length *
        scale *
        (Math.abs(m.width * Math.cos(angle)) +
          Math.abs(m.height * Math.sin(angle)))) /
      2;
  return center.x + half - depth;
}
export function contactKnifePose(
  contact,
  angle,
  meta,
  length,
  scale,
  depth,
  minVisible = 0.2,
  mesh = false,
) {
  const tip = bladeCut(meta, length, scale, 0, mesh);
  const span = mesh
    ? length * scale
    : (() => {
        const m = { ...defaultKnifeArt, ...meta },
          a = (m.rotation * Math.PI) / 180;
        return (
          length *
          scale *
          (Math.abs(m.width * Math.cos(a)) + Math.abs(m.height * Math.sin(a)))
        );
      })();
  const hidden = Math.max(0, Math.min(depth, span * (1 - minVisible)));
  const cut = tip - hidden;
  return {
    x: contact.x - Math.cos(angle) * cut,
    y: contact.y - Math.sin(angle) * cut,
    hidden,
    cut,
  };
}
export function withBladeMask(ctx, x, y, angle, cut, reach, draw) {
  ctx.save();
  try {
    // Clip this draw call only. Never erase pixels already painted underneath.
    const transform = ctx.getTransform();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.rect(-reach, -reach, Math.max(0, reach + cut), reach * 2);
    ctx.clip();
    ctx.setTransform(transform);
    return draw();
  } finally {
    ctx.restore();
  }
}
