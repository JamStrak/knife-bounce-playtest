// A live pressure control, separate from finite stage budgets and enemy limits.
export function realtimeDensityScale(config) {
  if (config.combatMode !== "realtime") return 1;
  const value = Number(config.realtimeDensity ?? 1);
  return Number.isFinite(value) ? Math.max(0.25, Math.min(5, value)) : 1;
}

export const densityCount = (config, count) =>
  Math.ceil(Math.max(0, count) * realtimeDensityScale(config));
