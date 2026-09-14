import { stageConfig } from "./stage-schema.mjs";
import { resolveStagePlan } from "./campaign-model.mjs";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const count = (value) => Math.max(0, Math.floor(Number(value) || 0));

// Pure planning functions shared by the engine, tuning UI and simulations.
export function pressureProfile(config, index, round = 1, prepTurns, plan) {
  const c = stageConfig(config),
    p = resolveStagePlan(c, index, plan),
    turns = Math.max(1, prepTurns ?? c.stagePrepTurns),
    progress = turns === 1 ? 0 : clamp((round - 1) / (turns - 1), 0, 1),
    curve = progress ** c.stagePressurePower;
  return {
    openingCount: count(p.openingCount),
    target: Math.round(p.targetStart + (p.targetEnd - p.targetStart) * curve),
    depth: count(p.spawnDepth),
    openingDepth: count(p.openingDepth),
    frontChance: clamp(p.frontChance + c.stageFrontGrowth * curve, 0, 1),
    frontRow: Math.max(1, count(c.stageFrontRow)),
    reactionTurns: Math.max(1, count(c.stageEntryReactionTurns)),
    refillRatio: Math.max(0, c.stageRefillRatio),
    waveCap: count(c.stageWaveCap),
    progress,
  };
}

export function pressureRequest(config, state) {
  const { index, round, prepTurns, opening = false } = state,
    p = pressureProfile(config, index, round, prepTurns, state.plan),
    alive = count(state.alive),
    remaining = Math.max(0, count(state.budget) - count(state.spawned)),
    capSpace = Math.max(0, count(config.enemyCap) - alive),
    deficit = Math.max(0, p.target - alive),
    burstFloor = Math.ceil(count(state.kills) * p.refillRatio);
  let requested = opening
      ? p.openingCount
      : Math.ceil(Math.max(deficit, count(state.kills)) * p.refillRatio),
    warning = null;
  // Zero targets/ratios may be useful tests, but must not strand a finite stage.
  if (!requested && !alive && remaining > 0 && capSpace > 0) {
    requested = 1;
    warning = "empty-board-minimum";
  }
  const waveLimit = opening ? Infinity : Math.max(1, p.waveCap),
    planned = Math.min(requested, waveLimit, remaining, capSpace),
    limitedBy = [];
  if (requested > waveLimit) limitedBy.push("wave-cap");
  if (requested > remaining) limitedBy.push("budget");
  if (requested > capSpace) limitedBy.push("enemy-cap");
  if (warning) limitedBy.push(warning);
  return {
    target: p.target,
    deficit,
    burstFloor,
    requested,
    planned,
    remaining,
    capSpace,
    warning,
    limitedBy,
  };
}

export function pressureRows(config, state) {
  const p = pressureProfile(
      config,
      state.index,
      state.round,
      state.prepTurns,
      state.plan,
    ),
    rows = count(config.rows),
    depth = state.opening ? p.openingDepth : p.depth,
    step =
      Math.max(0, Number(config.advance) || 0) *
      (state.type === "ultraFast"
        ? Math.max(0, Number(config.ultraFastAdvance) || 0)
        : state.type === "fast"
          ? Math.max(0, Number(config.fastAdvance) || 0)
          : 1),
    lastSafe = rows - 1 - Math.ceil(step * (p.reactionTurns - 1)),
    last = Math.min(depth - 1, rows - 1, lastSafe);
  return Array.from({ length: Math.max(0, last + 1) }, (_, row) => ({
    row,
    forward: row >= p.frontRow - 1,
    weight: 1,
  }));
}
