export class Assets {
  constructor() {
    this.entries = {};
    this.errors = [];
    this.temporary = [];
  }
  async load() {
    this.errors = [];
    for (const u of this.temporary) URL.revokeObjectURL(u);
    this.temporary = [];
    const r = await fetch(`assets/manifest.json?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!r.ok) throw new Error("素材清单读取失败");
    const data = await r.json();
    if (data.version !== 1 || !data.slots)
      throw new Error("素材清单版本不支持");
    this.entries = {};
    await Promise.all(
      Object.entries(data.slots).map(async ([key, meta]) => {
        if (!meta.src) return;
        try {
          await this.set(key, meta.src, meta);
        } catch (e) {
          this.errors.push(`${key}: ${e.message}`);
        }
      }),
    );
  }
  async set(key, url, meta = {}) {
    for (const k of ["width", "height", "fps", "frames", "columns"])
      if (meta[k] !== undefined && (!Number.isFinite(meta[k]) || meta[k] <= 0))
        throw new Error(`素材参数 ${k} 必须大于零`);
    for (const k of ["frames", "columns"])
      if (meta[k] !== undefined && !Number.isInteger(meta[k]))
        throw new Error(`素材参数 ${k} 必须为整数`);
    for (const k of ["anchorX", "anchorY", "rotation"])
      if (meta[k] !== undefined && !Number.isFinite(meta[k]))
        throw new Error(`素材参数 ${k} 必须为数字`);
    const img = new Image();
    img.src = url;
    await img.decode();
    this.entries[key] = {
      img,
      meta: {
        width: 1,
        height: 1,
        anchorX: 0.5,
        anchorY: 0.5,
        rotation: 0,
        frames: 1,
        columns: 1,
        fps: 8,
        loop: true,
        ...meta,
      },
    };
  }
  async preview(key, file) {
    const url = URL.createObjectURL(file);
    this.temporary.push(url);
    const meta = this.entries[key]?.meta || {};
    await this.set(key, url, { ...meta, frames: 1, columns: 1 });
  }
  draw(ctx, key, x, y, size, angle = 0, time = 0, override = null) {
    const entry = this.entries[key];
    if (!entry) return false;
    const { img } = entry,
      m = override ? { ...entry.meta, ...override } : entry.meta;
    const cols = Math.max(1, m.columns | 0),
      frames = Math.max(1, m.frames | 0);
    const frame = m.loop
      ? Math.floor(time * m.fps) % frames
      : Math.min(frames - 1, Math.floor(time * m.fps));
    const sw = img.naturalWidth / cols,
      sh = img.naturalHeight / Math.ceil(frames / cols);
    const w = size * m.width,
      h = size * m.height;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + ((m.rotation || 0) * Math.PI) / 180);
    if (frames === 1) ctx.drawImage(img, -w * m.anchorX, -h * m.anchorY, w, h);
    else
      ctx.drawImage(
        img,
        (frame % cols) * sw,
        Math.floor(frame / cols) * sh,
        sw,
        sh,
        -w * m.anchorX,
        -h * m.anchorY,
        w,
        h,
      );
    ctx.restore();
    return true;
  }
}
