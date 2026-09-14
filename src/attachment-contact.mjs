// Use sprite alpha only to locate an attachment, never as the knife's mask.
export class AttachmentContacts {
  constructor() {
    this.images = new WeakMap();
    this.points = new WeakMap();
  }
  contact(entry, time, hint, angle, squash = 1, token = null) {
    if (!entry) return hint;
    const m = entry.meta,
      cols = Math.max(1, m.columns | 0),
      frames = Math.max(1, m.frames | 0);
    const frame = m.loop
      ? Math.floor(time * m.fps) % frames
      : Math.min(frames - 1, Math.floor(time * m.fps));
    const key = `${cols}:${frames}:${frame}:${entry.revision || ""}`;
    let maps = this.images.get(entry.img);
    if (!maps) {
      maps = new Map();
      this.images.set(entry.img, maps);
    }
    let map = maps.get(key);
    if (!map) {
      const sw = (entry.img.naturalWidth || entry.img.width) / cols,
        sh =
          (entry.img.naturalHeight || entry.img.height) /
          Math.ceil(frames / cols);
      const canvas = document.createElement("canvas"),
        ratio = Math.min(1, 256 / Math.max(sw, sh));
      canvas.width = Math.max(1, Math.round(sw * ratio));
      canvas.height = Math.max(1, Math.round(sh * ratio));
      const c = canvas.getContext("2d", { willReadFrequently: true });
      c.drawImage(
        entry.img,
        (frame % cols) * sw,
        Math.floor(frame / cols) * sh,
        sw,
        sh,
        0,
        0,
        canvas.width,
        canvas.height,
      );
      map = {
        w: canvas.width,
        h: canvas.height,
        pixels: c.getImageData(0, 0, canvas.width, canvas.height).data,
      };
      if (maps.size >= 8) maps.delete(maps.keys().next().value);
      maps.set(key, map);
    }
    const geometry = [
      key,
      hint.x,
      hint.y,
      angle,
      squash,
      m.width,
      m.height,
      m.anchorX,
      m.anchorY,
      m.rotation,
    ]
      .map((v) => (typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v))
      .join(":");
    const cached = token && this.points.get(token);
    if (cached?.entry === entry && cached.geometry === geometry)
      return cached.point;
    const a = ((m.rotation || 0) * Math.PI) / 180,
      ca = Math.cos(a),
      sa = Math.sin(a);
    const toPixel = (x, y) => ({
      x:
        (((x / squash) * ca + y * squash * sa) / (2 * m.width) + m.anchorX) *
        map.w,
      y:
        (((-x / squash) * sa + y * squash * ca) / (2 * m.height) + m.anchorY) *
        map.h,
    });
    const toPoint = (x, y) => {
      const u = (x / map.w - m.anchorX) * 2 * m.width,
        v = (y / map.h - m.anchorY) * 2 * m.height;
      return { x: (u * ca - v * sa) * squash, y: (u * sa + v * ca) / squash };
    };
    const origin = toPixel(hint.x, hint.y),
      next = toPixel(hint.x + Math.cos(angle), hint.y + Math.sin(angle));
    const dx = next.x - origin.x,
      dy = next.y - origin.y;
    let enter = -Infinity,
      leave = Infinity;
    for (const [p, d, limit] of [
      [origin.x, dx, map.w],
      [origin.y, dy, map.h],
    ]) {
      if (Math.abs(d) < 1e-9) {
        if (p < 0 || p >= limit) {
          enter = 1;
          leave = 0;
        }
      } else {
        const t1 = -p / d,
          t2 = (limit - p) / d;
        enter = Math.max(enter, Math.min(t1, t2));
        leave = Math.min(leave, Math.max(t1, t2));
      }
    }
    const opaque = (x, y) =>
      x >= 0 &&
      x < map.w &&
      y >= 0 &&
      y < map.h &&
      map.pixels[(Math.floor(y) * map.w + Math.floor(x)) * 4 + 3] >= 96;
    let point = null;
    const step = 0.5 / Math.max(Math.abs(dx), Math.abs(dy));
    if (Number.isFinite(enter))
      for (let t = enter; t <= leave; t += step) {
        const x = origin.x + dx * t,
          y = origin.y + dy * t;
        if (opaque(x, y)) {
          point = toPoint(x, y);
          break;
        }
      }
    // A gameplay circle may be hit through a transparent wing gap. Snap the
    // attachment to the nearest visible texel while retaining the knife angle.
    if (!point) {
      let distance = Infinity;
      for (let y = 0; y < map.h; y++)
        for (let x = 0; x < map.w; x++)
          if (opaque(x, y)) {
            const p = toPoint(x + 0.5, y + 0.5),
              d = (p.x - hint.x) ** 2 + (p.y - hint.y) ** 2;
            if (d < distance) {
              distance = d;
              point = p;
            }
          }
    }
    point ??= hint;
    if (token) this.points.set(token, { entry, geometry, point });
    return point;
  }
}
