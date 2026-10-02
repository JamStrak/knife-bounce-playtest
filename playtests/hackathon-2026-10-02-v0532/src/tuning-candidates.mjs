// Experimental balance packages are applied only when explicitly selected by URL.
const workbuddyR4 = Object.freeze({
  xpCurveP3: 70,
  damageUpgrade: 8,
  pierceUpgrade: 2,
  enemyBounceUpgrade: 2,
  wallBounceUpgrade: 2,
  splitUpgrade: 2,
  sizeUpgrade: 0.5,
});
export const tuningCandidates = Object.freeze({
  "workbuddy-r4": workbuddyR4,
  "workbuddy-r4-early": Object.freeze({
    ...workbuddyR4,
    xpCurveP0: 5,
    xpCurveP1: 14,
    xpCurveP2: 23,
  }),
});

export function applyTuningCandidate(config, id) {
  const values = tuningCandidates[id];
  return values ? { ...config, ...values } : config;
}
