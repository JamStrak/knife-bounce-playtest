const fmt = (n) => Number((n || 0).toFixed(2));
const feedback = new WeakMap();
const set = (id, value) => {
  const el = document.getElementById(id);
  if (el.textContent !== String(value)) el.textContent = value;
};
export function updateStageUI(g, dt = 0) {
  const stage = g.stageStatus;
  document.querySelector(".game-shell").dataset.mode = stage
    ? "stages"
    : "endless";
  document.getElementById("gameModeChoice").value =
    g.config.gameMode || "endless";
  document.getElementById("stageStatus").hidden = !stage;
  const boss = stage && g.enemies.find((e) => e.boss && e.hp > 0);
  document.getElementById("bossStatus").hidden = !boss;
  if (stage) {
    const route = document.getElementById("stageRouteButton");
    route.disabled = !["aim", "entry"].includes(g.phase);
    route.title = `第 ${stage.index} / ${stage.total} 关 · ${stage.name} · 查看路线`;
    set(
      "stageTitle",
      `${String(stage.index).padStart(2, "0")} / ${stage.total}`,
    );
    set("stageProgress", `第 ${stage.round} 次出手`);
    set(
      "stageObjective",
      `${stage.name} · ${stage.objective} · 在场 ${stage.remainingEnemies} · 尚有 ${stage.remainingBudget} 只来敌`,
    );
    const resolved = Math.max(
      0,
      stage.budget -
        stage.remainingBudget -
        g.enemies.filter((e) => e.hp > 0 && !e.boss && !e.summoned).length,
    );
    document
      .getElementById("stageStatus")
      .style.setProperty(
        "--stage-progress",
        `${stage.budget ? Math.min(100, (resolved / stage.budget) * 100) : 100}%`,
      );
  }
  if (boss) {
    set("bossName", boss.bossName);
    set("bossHp", `${fmt(boss.hp)} / ${fmt(boss.maxHp)}`);
    document.getElementById("bossFill").style.width =
      `${Math.max(0, Math.min(100, (boss.hp / boss.maxHp) * 100))}%`;
    const intent =
      boss.boss === "summoner"
        ? boss.bossPhase === "charge"
          ? `蓄力召唤 ${g.config.bossSummonCount} 只冲线怪`
          : boss.bossPhase === "recover"
            ? "召唤后恢复 · 集中输出"
            : boss.bossPhase === "exhausted"
              ? "召唤耗尽 · 击败领主"
              : "召唤准备中"
        : boss.bossPhase === "charge"
          ? "蓄力防御 · 伤害降低"
          : boss.bossPhase === "weak"
            ? "露出破绽 · 伤害提高"
            : "缓慢逼近防线";
    set(
      "bossIntent",
      intent + (boss.bossCountdown > 0 ? ` · ${boss.bossCountdown} 回合` : ""),
    );
  }
  let state = feedback.get(g);
  if (!state) feedback.set(g, (state = { remaining: 0, shot: null, hits: 0 }));
  const combo = g.combo;
  if (state.shot !== combo) {
    state.shot = combo;
    state.remaining = 0;
    state.hits = 0;
  }
  // The final hit and transition to advance can happen within one simulation frame.
  if (combo?.hits > state.hits || (g.phase === "flight" && combo?.hits > 0))
    state.remaining = g.config.stageComboHoldDuration ?? 2;
  else state.remaining = Math.max(0, state.remaining - dt);
  state.hits = combo?.hits || 0;
  const badge = document.getElementById("comboStatus");
  badge.hidden =
    !stage || !combo?.hits || !(g.phase === "flight" || state.remaining > 0);
  if (!badge.hidden) {
    badge.dataset.active = String(g.phase === "flight");
    badge.textContent = `${combo.hits} 连击 · ${combo.kills} 连杀 · 经验 ×${fmt(combo.multiplier)}`;
    badge.title = `本次额外经验 +${fmt(combo.bonusXp)}`;
  }
}
