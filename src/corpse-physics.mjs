// Exact ballistic segments between circle/axis-aligned-wall contacts.
// Replaying to an age makes presentation independent of render frame rate.
const EPS = 1e-8;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const slow = (v, impulse) => Math.sign(v) * Math.max(0, Math.abs(v) - impulse);
function impactTime(p, v, a, boundary, outward) {
  if (Math.abs(p - boundary) < EPS && Math.abs(v) < EPS && a * outward > EPS)
    return 0;
  const roots =
    Math.abs(a) < EPS
      ? Math.abs(v) < EPS
        ? []
        : [(boundary - p) / v]
      : (() => {
          const d = v * v + 2 * a * (boundary - p);
          return d < 0
            ? []
            : [(-v - Math.sqrt(d)) / a, (-v + Math.sqrt(d)) / a];
        })();
  return Math.min(
    Infinity,
    ...roots
      .filter((t) => t >= -EPS && (v + a * Math.max(0, t)) * outward > EPS)
      .map((t) => Math.max(0, t)),
  );
}
export function corpseBody(initial, age, bounds, options) {
  const { gravity, restitution, friction, restSpeed } = options;
  const r = Math.min(initial.radius, bounds.width / 2, bounds.height / 2);
  const left = r,
    right = bounds.width - r,
    top = r,
    floor = bounds.height - r;
  let x = clamp(initial.x, left, right),
    y = clamp(initial.y, top, floor);
  let vx = right - left < EPS ? 0 : initial.vx,
    vy = initial.vy;
  let rotation = 0,
    omega = initial.omega,
    time = 0,
    floorHits = 0;
  let grounded = floor - top < EPS,
    restAt = grounded ? 0 : null;
  if (grounded) vy = 0;
  const contact = (nx, ny) => {
    const normalSpeed = vx * nx + vy * ny;
    if (normalSpeed >= 0) return;
    const normalImpulse = -(1 + restitution) * normalSpeed;
    const tx = -ny,
      ty = nx;
    const slip = vx * tx + vy * ty - omega * r;
    // The contact impulse changes translation and rotation together (I=m*r²/2).
    const tangentImpulse = clamp(
      -slip / 3,
      -friction * normalImpulse,
      friction * normalImpulse,
    );
    vx += normalImpulse * nx + tangentImpulse * tx;
    vy += normalImpulse * ny + tangentImpulse * ty;
    omega -= (2 * tangentImpulse) / Math.max(r, EPS);
  };
  for (let event = 0; time < age - EPS && event < 128; event++) {
    const ax = grounded ? -Math.sign(vx) * friction * gravity : 0;
    const ay = grounded ? 0 : gravity;
    const stop = grounded && Math.abs(ax) > EPS ? Math.abs(vx / ax) : Infinity;
    const wallX = impactTime(x, vx, ax, vx < 0 ? left : right, vx < 0 ? -1 : 1);
    const ceiling = grounded ? Infinity : impactTime(y, vy, ay, top, -1);
    const ground = grounded ? Infinity : impactTime(y, vy, ay, floor, 1);
    const next = Math.min(stop, wallX, ceiling, ground);
    const step = Math.min(age - time, next);
    x = clamp(x + vx * step + (ax * step * step) / 2, left, right);
    y = clamp(y + vy * step + (ay * step * step) / 2, top, floor);
    vx += ax * step;
    vy += ay * step;
    if (grounded) {
      const angularDrag = (friction * gravity) / Math.max(r, EPS);
      const spinTime =
        angularDrag > EPS
          ? Math.min(step, Math.abs(omega) / angularDrag)
          : step;
      rotation +=
        omega * spinTime -
        (Math.sign(omega) * angularDrag * spinTime * spinTime) / 2;
      omega = slow(omega, angularDrag * step);
    } else rotation += omega * step;
    time += step;
    if (next > step + EPS) break;
    if (Math.abs(stop - next) < EPS) vx = 0;
    if (Math.abs(wallX - next) < EPS) {
      contact(vx > 0 ? -1 : 1, 0);
    }
    if (Math.abs(ceiling - next) < EPS || Math.abs(ground - next) < EPS) {
      contact(0, Math.abs(ground - next) < EPS ? -1 : 1);
      if (Math.abs(ground - next) < EPS) {
        floorHits++;
        if (Math.abs(vy) <= restSpeed) {
          y = floor;
          vy = 0;
          grounded = true;
          restAt = time;
        }
      }
    }
  }
  return {
    x,
    y,
    vx,
    vy,
    omega,
    rotation,
    restAt,
    floorHits,
    grounded,
    radius: r,
  };
}
