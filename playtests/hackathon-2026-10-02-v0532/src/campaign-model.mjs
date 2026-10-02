import { stageConfig } from "./stage-schema.mjs";

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const interpolate = (start, end, progress, power = 1) =>
  start + (end - start) * progress ** power;

// Fixed stage-index growth: it never reads current player ATK or build strength.
export function campaignStage(config, requestedIndex) {
  const c = stageConfig(config),
    campaignMode = c.stageCampaignMode === "demo" ? "demo" : "campaign",
    total =
      campaignMode === "demo" ? 2 : Math.max(1, Math.round(c.campaignTotal)),
    index = clamp(Math.round(requestedIndex) || 1, 1, total);
  if (campaignMode === "demo") {
    const prefix = "stage" + index,
      first = index === 1;
    return {
      campaignMode,
      index,
      total,
      bossEvery: 1,
      name: first ? "堡垒前哨" : "召唤巢穴",
      bossKind: first ? "fortress" : "summoner",
      bossName: first ? "堡垒巨兽" : "召唤领主",
      budget: c[prefix + "Budget"],
      hp: c[prefix + "Hp"],
      hpGain: c[prefix + "HpGain"],
      fastChance: c.stageFastChance,
      bombChance: c.stageBombChance,
      openingCount: c[prefix + "OpeningCount"],
      targetStart: c[prefix + "TargetStart"],
      targetEnd: c[prefix + "TargetEnd"],
      openingDepth: c[prefix + "OpeningDepth"],
      spawnDepth: c[prefix + "SpawnDepth"],
      frontChance: c[prefix + "FrontChance"],
      bossHp: c[first ? "bossFortressHp" : "bossSummonerHp"],
      summonHp: c.bossSummonHp,
    };
  }
  const bossEvery = Math.max(1, Math.round(c.campaignBossEvery)),
    scheduledBoss = index % bossEvery === 0,
    bossKind = scheduledBoss
      ? Math.floor(index / bossEvery) % 2
        ? "fortress"
        : "summoner"
      : index === total
        ? "summoner"
        : null,
    progress = total === 1 ? 0 : (index - 1) / (total - 1),
    hp = Math.max(
      1,
      Math.round(
        c.campaignHpBase + c.campaignHpGain * (index - 1) ** c.campaignHpPower,
      ),
    ),
    target = Math.round(
      interpolate(
        c.campaignTargetStart,
        c.campaignTargetEnd,
        progress,
        c.campaignPressurePower,
      ),
    ),
    front = (start, end) =>
      interpolate(start, end, progress, c.campaignFrontPower),
    bossName =
      bossKind === "fortress"
        ? "堡垒巨兽"
        : bossKind === "summoner"
          ? "召唤领主"
          : null;
  return {
    campaignMode,
    index,
    total,
    bossEvery,
    name: bossName
      ? bossName + " · 首领决战"
      : `第 ${index} 关 · ${index <= bossEvery ? "晶糖边境" : "深层前线"}`,
    bossKind,
    bossName,
    budget: Math.max(
      0,
      Math.round(
        c.campaignBudgetBase +
          c.campaignBudgetGain * (index - 1) ** c.campaignBudgetPower,
      ),
    ),
    hp,
    hpGain: hp * c.campaignHpRoundRatio,
    fastChance: clamp(
      interpolate(
        c.campaignFastStart,
        c.campaignFastEnd,
        progress,
        c.campaignFastPower,
      ),
      0,
      1,
    ),
    bombChance: clamp(c.campaignBombChance, 0, 1),
    openingCount: Math.max(
      0,
      Math.round(
        interpolate(
          c.campaignOpeningStart,
          c.campaignOpeningEnd,
          progress,
          c.campaignPressurePower,
        ),
      ),
    ),
    targetStart: target,
    targetEnd: target + c.campaignTargetLateGain,
    openingDepth: Math.round(
      front(c.campaignOpeningDepthStart, c.campaignOpeningDepthEnd),
    ),
    spawnDepth: Math.round(
      front(c.campaignSpawnDepthStart, c.campaignSpawnDepthEnd),
    ),
    frontChance: clamp(front(c.campaignFrontStart, c.campaignFrontEnd), 0, 1),
    bossHp: bossKind
      ? Math.max(
          1,
          Math.round(
            hp *
              c[
                bossKind === "fortress"
                  ? "campaignFortressHpFactor"
                  : "campaignSummonerHpFactor"
              ],
          ),
        )
      : null,
    summonHp: Math.max(1, Math.round(hp * c.campaignSummonHpFactor)),
  };
}

export function campaignPlan(config) {
  const total = campaignStage(config, 1).total;
  return Array.from({ length: total }, (_, i) => campaignStage(config, i + 1));
}

// Campaign growth is captured on entry; demo tuning retains its live legacy behavior.
export function resolveStagePlan(config, index, snapshot) {
  if (snapshot?.campaignMode === "campaign") return snapshot;
  return campaignStage(
    snapshot ? { ...config, stageCampaignMode: snapshot.campaignMode } : config,
    index,
  );
}
