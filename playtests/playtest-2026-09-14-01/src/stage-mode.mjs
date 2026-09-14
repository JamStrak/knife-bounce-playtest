import { stageConfig } from "./stage-schema.mjs";
import { weightedChoice } from "./field-rules.mjs";
import { newStageResultStats } from "./stage-results.mjs";
import { campaignStage, resolveStagePlan } from "./campaign-model.mjs";
import {
  pressureProfile,
  pressureRequest,
  pressureRows,
} from "./stage-pressure.mjs";
export function stageEnemyHp(config, index, round, prepTurns, plan) {
  const c = stageConfig(config),
    p = resolveStagePlan(c, index, plan);
  return Math.max(
    1,
    Math.floor(
      p.hp +
        Math.max(0, Math.min(round, prepTurns ?? c.stagePrepTurns) - 1) *
          p.hpGain,
    ),
  );
}
export function stagePlan(config, index) {
  const c = stageConfig(config),
    budget = campaignStage(c, index).budget;
  return Array.from({ length: c.stagePrepTurns }, (_, i) => {
    const cumulative = Math.ceil(
      budget * ((i + 1) / c.stagePrepTurns) ** c.stageSpawnCurvePower,
    );
    return {
      round: i + 1,
      cumulative,
      planned:
        cumulative -
        Math.ceil(budget * (i / c.stagePrepTurns) ** c.stageSpawnCurvePower),
      hp: stageEnemyHp(c, index, i + 1),
    };
  });
}
export function beginStage(g, index) {
  const c = stageConfig(g.config),
    previous = index > 1 ? g.stage : null,
    plan = campaignStage(
      previous
        ? {
            ...c,
            stageCampaignMode: previous.campaignMode,
            campaignTotal: previous.total,
            campaignBossEvery: previous.bossEvery,
          }
        : c,
      index,
    );
  g.stage = {
    ...plan,
    plan,
    round: 1,
    prepTurns: c.stagePrepTurns,
    spawnCurvePower: c.stageSpawnCurvePower,
    supplyMode: c.stageSupplyMode,
    openingComplete: false,
    lastSupplyRound: null,
    lastSupply: null,
    spawned: 0,
    leaked: 0,
    killed: 0,
    bossSpawned: false,
    bossDefeated: false,
    summonBudget: plan.bossKind === "summoner" ? c.bossSummonBudget : 0,
    summoned: 0,
    pendingSummons: 0,
    completed: false,
    resultStats: newStageResultStats(g),
  };
  fillStage(g);
  g.emit("stageStart", g.width / 2, g.height / 2, {
    index,
    name: g.stage.name,
  });
}
export function stageStatus(g) {
  const s = g.stage;
  if (!s) return null;
  const boss = g.enemies.find((e) => e.hp > 0 && e.boss);
  return {
    ...s,
    remainingBudget: Math.max(0, s.budget - s.spawned),
    remainingEnemies: g.enemies.filter((e) => e.hp > 0).length,
    summonRemaining: Math.max(0, s.summonBudget - s.summoned),
    liveSummons: g.enemies.filter((e) => e.hp > 0 && e.summoned).length,
    bossName: boss?.bossName || s.bossName,
    bossPhase:
      boss?.bossPhase ||
      (s.bossKind ? (s.bossDefeated ? "defeated" : "pending") : "none"),
    bossCountdown: boss?.bossCountdown || 0,
    objective: !s.bossKind
      ? s.spawned >= s.budget
        ? "清理剩余敌人，完成本关"
        : "击退本关全部敌人，守住防线"
      : s.bossDefeated
        ? "清理剩余敌人，守住防线"
        : s.bossSpawned
          ? "击败" + (boss?.bossName || s.bossName) + "，守住防线"
          : "守住防线，击杀升级，迎战" + s.bossName,
  };
}
export function enterEnemy(g, e) {
  const c = g.config;
  if (!c.enemyEntryOn) return;
  e.entry = {
    age: 0,
    delay:
      g.enemies.filter((t) => t.entry).length * c.entryStagger +
      g.random() * c.entryJitter,
    from: -g.rowHeight * c.entryStartCells - e.r,
    to: e.y,
    duration: c.entryDuration,
    power: c.entryEase,
  };
  e.y = e.entry.from;
}
function freeCells(g, radius, boss = false, rowSpecs = null) {
  const c = g.config,
    candidates = [];
  const rows = rowSpecs
    ? rowSpecs.map((p) => p.row)
    : boss
      ? [Math.max(0, radius / g.rowHeight - 0.5)]
      : c.spawnScatterOn
        ? [0, 1, 2].filter(
            (row) =>
              row < c.rows - 1 && c["spawnRow" + (row + 1) + "Weight"] > 0,
          )
        : [0];
  if (!rows.length && !rowSpecs) rows.push(0);
  // Large bosses need a continuous center position, even on an even-column board.
  const cols = Array.from({ length: c.cols }, (_, i) => i);
  if (boss) cols.unshift(c.cols / 2 - 0.5);
  for (const row of rows)
    for (const col of new Set(cols)) {
      const x = (col + 0.5) * c.cell,
        y = (row + 0.5) * g.rowHeight;
      if (x < radius || x > g.width - radius || y > g.height - radius) continue;
      if (
        g.enemies.some(
          (e) =>
            e.hp > 0 &&
            Math.hypot(e.x - x, (e.entry?.to ?? e.y) - y) < e.r + radius,
        )
      )
        continue;
      if (
        rowSpecs &&
        (g.pickups || []).some((p) => p.col === col && p.row === row)
      )
        continue;
      const spec = rowSpecs?.find((p) => p.row === row);
      candidates.push({ col, row, x, y, ...(spec || {}) });
    }
  return candidates;
}
function spawnOne(
  g,
  hp,
  type,
  scale = 1,
  extra = {},
  boss = false,
  pressure = null,
) {
  if (g.enemies.filter((e) => e.hp > 0).length >= g.config.enemyCap)
    return null;
  const radius = Math.min(
    g.config.cell * g.config.enemyRadius * scale,
    g.width / 2,
    g.height / 2,
  );
  const rowSpecs = pressure
    ? pressureRows(g.config, { ...pressure, type })
    : null;
  let cells = freeCells(g, radius, boss, rowSpecs);
  if (!cells.length) return null;
  if (pressure) {
    const forward = cells.filter((p) => p.forward),
      rear = cells.filter((p) => !p.forward),
      chance = pressureProfile(
        g.config,
        pressure.index,
        pressure.round,
        pressure.prepTurns,
        pressure.plan,
      ).frontChance;
    // Group probability stays meaningful even when the two regions differ in size.
    cells = !forward.length
      ? rear
      : !rear.length
        ? forward
        : g.random() < chance
          ? forward
          : rear;
  }
  const cell = boss
    ? cells.sort(
        (a, b) => Math.abs(a.x - g.width / 2) - Math.abs(b.x - g.width / 2),
      )[0]
    : weightedChoice(
        cells,
        (p) =>
          pressure
            ? p.weight
            : g.config.spawnScatterOn
              ? g.config["spawnRow" + (p.row + 1) + "Weight"] || 1
              : 1,
        () => g.random(),
      );
  const e = g.addEnemy(cell.col, cell.row, hp, type);
  Object.assign(e, extra, { r: radius, visualScale: scale });
  enterEnemy(g, e);
  return e;
}
function spawnBoss(g) {
  const c = stageConfig(g.config),
    p = resolveStagePlan(c, g.stage.index, g.stage.plan),
    first = g.stage.bossKind === "fortress",
    key = first ? "bossFortress" : "bossSummoner";
  if (!g.stage.bossKind) return;
  const e = spawnOne(
    g,
    p.bossHp,
    first ? "normal" : "fast",
    c[key + "Scale"],
    {
      boss: first ? "fortress" : "summoner",
      bossName: first ? "堡垒巨兽" : "召唤领主",
      bossPhase: first ? "normal" : "charge",
      bossTurns: 0,
      bossCountdown: first
        ? c.bossFortressNormalTurns
        : c.bossSummonChargeTurns,
      hpRatioFactor: c.stageBossHpRatioFactor,
    },
    true,
  );
  if (!e) return;
  g.stage.bossSpawned = true;
  g.emit("bossEntry", e.x, e.entry?.to ?? e.y, {
    enemyId: e.id,
    boss: e.boss,
    bossName: e.bossName,
  });
}
export function fillStage(g) {
  const s = g.stage,
    c = stageConfig(g.config);
  if (!s || s.completed) return;
  if (s.supplyMode === "adaptive") {
    fillPressure(g);
    if (s.bossKind && !s.bossSpawned && s.spawned >= s.budget) spawnBoss(g);
    return;
  }
  const due = Math.ceil(
    s.budget *
      (Math.min(s.round, s.prepTurns) / s.prepTurns) ** s.spawnCurvePower,
  );
  const p = resolveStagePlan(c, s.index, s.plan);
  let pending = due - s.spawned;
  while (pending-- > 0) {
    const roll = g.random(),
      type =
        roll < p.bombChance
          ? "bomb"
          : roll < Math.min(1, p.bombChance + p.fastChance)
            ? "fast"
            : roll <
                Math.min(
                  1,
                  p.bombChance + p.fastChance + (c.ultraFastChance || 0),
                )
              ? "ultraFast"
              : "normal";
    if (
      !spawnOne(g, stageEnemyHp(c, s.index, s.round, s.prepTurns, s.plan), type)
    )
      break;
    s.spawned++;
  }
  if (
    s.bossKind &&
    !s.bossSpawned &&
    s.round >= s.prepTurns &&
    s.spawned >= s.budget
  )
    spawnBoss(g);
}
function fillPressure(g) {
  const s = g.stage;
  // A second fill call in the same turn cannot spend the previous shot's burst twice.
  // Failed placements remain in the finite budget and are reconsidered next turn.
  if (s.lastSupplyRound === s.round) return;
  const c = stageConfig(g.config),
    p = resolveStagePlan(c, s.index, s.plan),
    opening = !s.openingComplete,
    aliveBefore = g.enemies.filter((e) => e.hp > 0).length,
    kills = opening ? 0 : Math.max(0, g.shotKills || 0),
    state = { ...s, opening, alive: aliveBefore, kills },
    request = pressureRequest(c, state),
    limitedBy = [...request.limitedBy];
  s.lastSupplyRound = s.round;
  s.openingComplete = true;
  let spawned = 0;
  while (spawned < request.planned) {
    const roll = g.random(),
      type =
        roll < p.bombChance
          ? "bomb"
          : roll < Math.min(1, p.bombChance + p.fastChance)
            ? "fast"
            : roll <
                Math.min(
                  1,
                  p.bombChance + p.fastChance + (c.ultraFastChance || 0),
                )
              ? "ultraFast"
              : "normal";
    let e = spawnOne(
      g,
      stageEnemyHp(c, s.index, s.round, s.prepTurns, s.plan),
      type,
      1,
      {},
      false,
      state,
    );
    // A fast monster may have no safe room while a normal monster still does.
    if (!e && (type === "fast" || type === "ultraFast"))
      e = spawnOne(
        g,
        stageEnemyHp(c, s.index, s.round, s.prepTurns, s.plan),
        "normal",
        1,
        {},
        false,
        state,
      );
    if (!e) {
      limitedBy.push(
        pressureRows(c, { ...state, type: "normal" }).length
          ? "space"
          : "no-safe-rows",
      );
      break;
    }
    spawned++;
    s.spawned++;
  }
  s.lastSupply = {
    round: s.round,
    opening,
    requested: request.requested,
    planned: request.planned,
    spawned,
    aliveBefore,
    kills,
    target: request.target,
    remaining: Math.max(0, s.budget - s.spawned),
    limitedBy: [...new Set(limitedBy)],
  };
}
export function bossDamageFactor(g, e) {
  const c = stageConfig(g.config);
  if (e.boss !== "fortress") return 1;
  return e.bossPhase === "charge"
    ? c.bossFortressChargeFactor
    : e.bossPhase === "weak"
      ? c.bossFortressWeakFactor
      : 1;
}
export function bossMove(g, e) {
  const c = stageConfig(g.config),
    prefix = e.boss === "fortress" ? "bossFortress" : "bossSummoner";
  return (e.bossTurns + 1) % c[prefix + "MoveEvery"] === 0
    ? c[prefix + "Advance"]
    : 0;
}
function flushSummons(g) {
  const s = g.stage,
    c = stageConfig(g.config),
    p = resolveStagePlan(c, s.index, s.plan);
  while (
    s.pendingSummons > 0 &&
    s.summoned < s.summonBudget &&
    g.enemies.filter((e) => e.hp > 0 && e.summoned).length < c.bossSummonCap
  ) {
    const e = spawnOne(g, p.summonHp, "fast", c.bossSummonScale, {
      summoned: true,
    });
    if (!e) break;
    s.pendingSummons--;
    s.summoned++;
    g.emit("summon", e.x, e.entry?.to ?? e.y, { enemyId: e.id });
  }
}
export function advanceStage(g) {
  const s = g.stage,
    c = stageConfig(g.config);
  for (const e of g.enemies.filter((e) => e.hp > 0 && e.boss)) {
    e.bossTurns++;
    e.hpRatioFactor = c.stageBossHpRatioFactor;
    if (e.boss === "fortress") {
      const normal = c.bossFortressNormalTurns,
        charge = c.bossFortressChargeTurns,
        total = normal + charge + c.bossFortressWeakTurns,
        turn = e.bossTurns % total;
      e.bossPhase =
        turn < normal ? "normal" : turn < normal + charge ? "charge" : "weak";
      e.bossCountdown =
        turn < normal
          ? normal - turn
          : turn < normal + charge
            ? normal + charge - turn
            : total - turn;
    } else if (s.summoned < s.summonBudget) {
      e.bossCountdown--;
      if (e.bossCountdown <= 0) {
        if (e.bossPhase === "charge") {
          s.pendingSummons = Math.min(
            s.summonBudget - s.summoned,
            s.pendingSummons + c.bossSummonCount,
          );
          e.bossPhase = "recover";
          e.bossCountdown = c.bossSummonRestTurns;
        } else {
          e.bossPhase = "charge";
          e.bossCountdown = c.bossSummonChargeTurns;
        }
      }
    } else {
      e.bossPhase = "exhausted";
      e.bossCountdown = 0;
    }
    g.emit("bossPhase", e.x, e.y, {
      enemyId: e.id,
      bossName: e.bossName,
      phase: e.bossPhase,
      countdown: e.bossCountdown,
    });
  }
  if (s.bossDefeated) s.pendingSummons = 0;
  else if (s.bossSpawned) flushSummons(g);
  s.round++;
  fillStage(g);
}
export function stageFinished(g) {
  const s = g.stage;
  return (
    !!s &&
    (!s.bossKind || s.bossDefeated) &&
    s.spawned >= s.budget &&
    !g.enemies.some((e) => e.hp > 0)
  );
}
export function stageKill(g, e) {
  if (!g.stage) return;
  g.stage.killed++;
  if (e.boss) {
    g.stage.bossDefeated = true;
    g.stage.pendingSummons = 0;
    g.emit("bossDefeated", e.x, e.y, { bossName: e.bossName });
  }
}
