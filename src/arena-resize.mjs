// Remap world positions only. Directions, velocities, radii and local knife
// attachment offsets must not stretch with the arena's row spacing.
export function resizeArenaState(state, oldHeight, height) {
  const ratio = height / oldHeight,
    seenPoints = new WeakSet(),
    seenStates = new WeakSet();
  const finite = (value) => typeof value === "number" && Number.isFinite(value);
  function point(p, mappedY) {
    if (!p || typeof p !== "object" || !finite(p.y) || seenPoints.has(p))
      return;
    seenPoints.add(p);
    p.y = mappedY ?? p.y * ratio;
  }
  function wallSide(p, radius) {
    if (p.ny !== undefined) return Math.sign(p.ny);
    return p.y <= radius + 0.01 ? -1 : p.y >= oldHeight - radius - 0.01 ? 1 : 0;
  }
  function wallPoint(p) {
    if (!p) return;
    const side = wallSide(p, p.radius || 0);
    point(
      p,
      side > 0 ? height - (oldHeight - p.y) : side < 0 ? p.y : undefined,
    );
    point(p.corpse);
  }
  function positions(s) {
    if (!s || seenStates.has(s)) return;
    seenStates.add(s);
    for (const e of s.enemies || []) {
      point(e);
      if (finite(e.fromY)) e.fromY *= ratio;
      if (e.entry) {
        if (finite(e.entry.from)) e.entry.from *= ratio;
        if (finite(e.entry.to)) e.entry.to *= ratio;
      }
    }
    for (const p of s.pickups || []) {
      point(p);
      if (finite(p.homeY)) p.homeY *= ratio;
    }
    for (const k of s.knives || []) {
      const radius = k.r || 0,
        oldY = k.y,
        onTop = Math.abs(oldY - radius) < 0.01,
        onBottom = Math.abs(oldY - (oldHeight - radius)) < 0.01,
        margin = Math.min(radius, height / 2),
        mapped = onTop ? radius : onBottom ? height - radius : oldY * ratio;
      point(k, Math.max(margin, Math.min(height - margin, mapped)));
      for (const p of k.trail || []) point(p);
      point(k.pinCandidate);
    }
    for (const p of s.pins || []) wallPoint(p);
    if (s.recall) {
      for (const item of s.recall.items || []) {
        const source = item.source,
          oldSourceY = source?.y,
          oldY = item.y,
          centerOffsetY = item.center?.y - oldY,
          side = source ? wallSide(source, source.radius || 0) : 0;
        wallPoint(source);
        // Keep the sampled pull clearance and the knife's center-to-anchor vector.
        point(
          item,
          side && finite(oldSourceY) ? source.y + oldY - oldSourceY : undefined,
        );
        if (item.center) point(item.center, item.y + centerOffsetY);
      }
    }
    for (const seed of s.seeds || []) point(seed);
    for (const event of s.events || []) {
      point(event);
      for (const p of event.points || []) point(p);
    }
    positions(s.snapshot);
    if (Object.hasOwn(s, "height")) s.height = height;
    if (Object.hasOwn(s, "arenaHeight")) s.arenaHeight = height;
  }
  positions(state);
}
