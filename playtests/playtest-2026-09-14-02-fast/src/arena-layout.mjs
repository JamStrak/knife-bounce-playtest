// Core coordinates stay in the inner collision rectangle. The art frame extends outside it.
export function arenaViewport(game, arena) {
  const a = arena || { left: 0, top: 0, right: 1, bottom: 1 };
  const width = game.width / (a.right - a.left),
    height = game.height / (a.bottom - a.top);
  return { width, height, x: a.left * width, y: a.top * height };
}
export function arenaPoint(client, rect, game, arena) {
  const v = arenaViewport(game, arena);
  return {
    x: ((client.clientX - rect.left) / rect.width) * v.width - v.x,
    y: ((client.clientY - rect.top) / rect.height) * v.height - v.y,
  };
}

// Spend spare vertical space on the logical battlefield, not CSS stretching.
// Keep the configured row count; a short/landscape viewport never compresses rows.
export function arenaFit(game, arena, width, height, borderW = 0, borderH = 0) {
  if (width <= borderW || height <= borderH) return null;
  const spanY = arena ? arena.bottom - arena.top : 1,
    baseHeight = game.config.rows * game.config.cell,
    base = arenaViewport({ width: game.width, height: baseHeight }, arena),
    widthScale = (width - borderW) / base.width,
    worldHeight = Math.max(
      baseHeight,
      ((height - borderH) / widthScale) * spanY,
    ),
    view = arenaViewport({ width: game.width, height: worldHeight }, arena),
    scale = Math.min(widthScale, (height - borderH) / view.height);
  return {
    worldHeight,
    width: Math.min(width, Math.floor(view.width * scale + 1e-6) + borderW),
    height: Math.min(height, Math.floor(view.height * scale + 1e-6) + borderH),
  };
}
