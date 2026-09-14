export function dentAmount(age, config) {
  if (!config.wallDentEnabled || config.wallDentDepth <= 0) return 0;
  const t =
    config.wallDentDuration > 0
      ? Math.max(0, Math.min(1, age / config.wallDentDuration))
      : 1;
  return (
    config.wallDentDepth *
    (1 - (1 - t) ** 3 + config.wallDentRebound * Math.sin(Math.PI * t))
  );
}

// Knife-local +X points into the body. Compress only the entry edge and
// smoothly reduce displacement away from the contact row; interior stays fixed.
export function indentPixels(
  source,
  width,
  height,
  { depth, spread, reach, contactY },
) {
  const out = new Uint8ClampedArray(source);
  if (depth <= 0) return out;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    let left = 0,
      right = width - 1;
    while (left < width && source[row + left * 4 + 3] < 16) left++;
    while (right > left && source[row + right * 4 + 3] < 16) right--;
    if (right - left < 2) continue;
    const span = Math.min(Math.max(1, reach), right - left);
    const shift = Math.min(
      span * 0.8,
      depth * Math.exp(-0.5 * ((y - contactY) / Math.max(1, spread)) ** 2),
    );
    if (shift < 0.02) continue;
    const anchor = left + span;
    for (
      let x = Math.max(0, left - 1);
      x <= Math.min(width - 1, Math.ceil(anchor));
      x++
    ) {
      const i = row + x * 4;
      if (x < left + shift) {
        out.fill(0, i, i + 4);
        continue;
      }
      const sx =
        x >= anchor ? x : left + ((x - left - shift) * span) / (span - shift);
      const a = Math.floor(sx),
        b = Math.min(width - 1, a + 1),
        f = sx - a;
      const ia = row + a * 4,
        ib = row + b * 4;
      const alpha = source[ia + 3] * (1 - f) + source[ib + 3] * f;
      out[i + 3] = alpha;
      for (let channel = 0; channel < 3; channel++)
        out[i + channel] = alpha
          ? (source[ia + channel] * source[ia + 3] * (1 - f) +
              source[ib + channel] * source[ib + 3] * f) /
            alpha
          : 0;
    }
  }
  return out;
}

export class SoftDent {
  constructor() {
    this.cache = new WeakMap();
  }
  draw(ctx, owner, entry, size, angle, age, contactY, config, drawSprite) {
    const amount = dentAmount(age, config);
    if (amount <= 0) {
      drawSprite(ctx);
      return;
    }
    const meta = entry?.meta;
    const extent = meta
      ? Math.hypot(
          size *
            meta.width *
            Math.max(Math.abs(meta.anchorX), Math.abs(1 - meta.anchorX)),
          size *
            meta.height *
            Math.max(Math.abs(meta.anchorY), Math.abs(1 - meta.anchorY)),
        )
      : size / 2;
    const span = Math.max(8, extent * 2 + 4),
      resolution = Math.min(256, Math.max(64, Math.ceil(span * 3))),
      scale = resolution / span;
    const depth = Math.round(amount * scale * 2) / 2;
    const frame = meta
      ? meta.loop
        ? Math.floor(age * meta.fps) % meta.frames
        : Math.min(meta.frames - 1, Math.floor(age * meta.fps))
      : 0;
    const signature = JSON.stringify([
      size,
      angle,
      depth,
      contactY,
      config.wallDentWidth,
      config.wallDentReach,
      meta && [
        meta.width,
        meta.height,
        meta.anchorX,
        meta.anchorY,
        meta.rotation,
        meta.frames,
        meta.columns,
      ],
      frame,
    ]);
    let cached = this.cache.get(owner);
    if (!cached || cached.signature !== signature || cached.entry !== entry) {
      const canvas = cached?.canvas || document.createElement("canvas");
      canvas.width = canvas.height = resolution;
      const c = canvas.getContext("2d", { willReadFrequently: true });
      c.translate(resolution / 2, resolution / 2);
      c.scale(scale, scale);
      c.rotate(-angle);
      drawSprite(c);
      c.resetTransform();
      const pixels = c.getImageData(0, 0, resolution, resolution);
      pixels.data.set(
        indentPixels(pixels.data, resolution, resolution, {
          depth,
          spread: config.wallDentWidth * scale,
          reach: config.wallDentReach * scale,
          contactY: resolution / 2 + contactY * scale,
        }),
      );
      c.putImageData(pixels, 0, 0);
      cached = { signature, entry, canvas, span };
      this.cache.set(owner, cached);
    }
    ctx.save();
    ctx.rotate(angle);
    ctx.drawImage(cached.canvas, -span / 2, -span / 2, span, span);
    ctx.restore();
  }
}
