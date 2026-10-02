import { upgrades } from "./core.mjs";
import { playCombatCue } from "./combat-feedback.mjs";
import { campaignStage } from "./campaign-model.mjs";
import { t, localize, onLocaleChange } from "./i18n.mjs";

const bosses = {
  fortress: {
    boss: "堡垒巨兽",
    slot: "bossFortress",
    tag: "突破重围",
    tip: "防御蓄力后会露出破绽，把握时机集中输出。",
  },
  summoner: {
    boss: "召唤领主",
    slot: "bossSummoner",
    tag: "直捣巢穴",
    tip: "蓄力后召唤冲线小怪，优先清理逼近防线的威胁。",
  },
};
export function stagePortraitSlot(entries, requested) {
  if (entries[requested]) return requested;
  const fallback = requested === "bossSummoner" ? "enemyFast" : "enemy";
  return entries[fallback] ? fallback : "enemy";
}
const chapter = (g, index = g.stage.index) => {
  const p =
    index === g.stage.index
      ? g.stage.plan || campaignStage(g.config, index)
      : campaignStage(g.config, index);
  return {
    ...p,
    name: p.name.replace(/^第\s*\d+\s*关\s*[·・]\s*/, ""),
    ...(p.bossKind
      ? bosses[p.bossKind]
      : {
          boss: null,
          slot: index % 3 === 0 ? "enemyFast" : "enemy",
          tag: "清理敌群",
          tip: "击败本关全部来敌，守住防线；构筑和成长会带入下一关。",
        }),
  };
};
const fmt = (n) => Number((n || 0).toFixed(1));
const text = (el, source) => {
  source = String(source);
  if (/\p{Script=Han}/u.test(source)) el.dataset.i18n = source;
  else delete el.dataset.i18n;
  el.textContent = t(source);
};
const attribute = (el, name, source) => {
  el.setAttribute(`data-i18n-${name}`, source);
  el.setAttribute(name, t(source));
};
const node = (tag, className, source) => {
  const el = document.createElement(tag);
  el.className = className;
  if (source !== undefined) text(el, source);
  return el;
};

// Presentation owns no combat phase, currency or reward. Closing it only resumes
// the real game; all waits use the pausable UI clock supplied by main.
export class StagePresentation {
  constructor(root, assets, { next, restart, endless, sound }) {
    Object.assign(this, { root, assets, next, restart, endless, sound });
    this.banner = node("div", "stage-battle-banner");
    this.banner.hidden = true;
    this.banner.setAttribute("role", "status");
    document.getElementById("arena").parentElement.append(this.banner);
    this.game = null;
    this.index = 0;
    this.kind = "";
    this.inertTargets = document.querySelectorAll(
      ".hud-panel, .battle-heading, #stageStatus, .battle-stage, .bottom-deck",
    );
    // Translate existing nodes only: a language change must never replay cues,
    // restart transitions, reset score tallies or move the route to another act.
    onLocaleChange(() => {
      localize(this.root);
      localize(this.banner);
    });
  }
  get blocking() {
    return !!this.kind;
  }
  hide() {
    this.banner.hidden = true;
    this.inline = false;
    this.kind = "";
    this.preview = false;
    this.closing = false;
    this.root.hidden = true;
    this.root.parentElement.classList.remove("stage-screen-open");
    for (const el of this.inertTargets) el.inert = false;
    if (this.root.contains(document.activeElement))
      document.getElementById("arena").focus({ preventScroll: true });
  }
  sync(g) {
    const s = g.stage;
    if (!s) {
      if (this.kind) this.hide();
      this.game = g;
      this.index = 0;
      return;
    }
    if (g !== this.game || s.index !== this.index) {
      this.hide();
      this.game = g;
      this.index = s.index;
      this.bossShown = false;
      this.resultKey = "";
      if (g.config.stageIntroOn) this.show("intro");
    }
    if (this.preview) return;
    if (!s.bossSpawned) this.bossShown = false;
    if (["stageClear", "victory"].includes(g.phase)) {
      const key = `${s.index}:${g.phase}`;
      if (this.resultKey !== key || this.kind !== "result") {
        const firstDisplay = this.resultKey !== key;
        this.resultKey = key;
        this.show("result");
        // Closing a developer preview must restore the actual continue button,
        // without replaying the reward sound for the same completed chapter.
        if (!firstDisplay) this.soundPending = false;
      }
      return;
    }
    this.resultKey = "";
    if (this.kind === "result" || (this.kind && g.phase === "over"))
      this.hide();
    if (this.kind === "intro" && !g.config.stageIntroOn && !this.manual)
      this.hide();
    if (this.kind === "boss" && !g.config.stageBossIntroOn) this.hide();
    if (
      !this.kind &&
      !this.bossShown &&
      s.bossSpawned &&
      !s.bossDefeated &&
      g.phase !== "over"
    ) {
      this.bossShown = true;
      if (g.config.stageBossIntroOn && g.config.stageBossIntroDuration > 0)
        this.show("boss");
    }
  }
  openRoute() {
    if (!this.game?.stage || !["aim", "entry"].includes(this.game.phase))
      return;
    this.show("intro", true);
    this.manual = true;
    text(this.root.querySelector("#stageSceneAction"), "继续本关 →");
  }
  previewScene(kind, g) {
    if (!g.stage) return false;
    this.sync(g);
    this.show(kind, true);
    return true;
  }
  leave() {
    if (this.closing) return;
    this.closing = true;
    this.exitAge = 0;
    this.root.dataset.leaving = "true";
    for (const button of this.root.querySelectorAll("button"))
      button.disabled = true;
    // A deliberate close must also work when the underlying test is paused.
    // Keep combat paused, but don't wait forever on a frozen exit animation.
    if (this.frozen || !this.game.config.stageTransitionDuration) this.hide();
  }
  route(parent, complete) {
    const total = this.game.stage.total,
      perAct = 15,
      acts = Math.ceil(total / perAct),
      shell = node("section", "chapter-route-panel");
    let act = Math.floor((this.index - 1) / perAct);
    const render = () => {
      shell.replaceChildren();
      const start = act * perAct + 1,
        end = Math.min(total, start + perAct - 1),
        head = node("div", "chapter-route-heading"),
        prev = node("button", "chapter-text-button", "‹"),
        next = node("button", "chapter-text-button", "›");
      attribute(prev, "aria-label", "查看上一幕路线");
      attribute(next, "aria-label", "查看下一幕路线");
      prev.disabled = act === 0;
      next.disabled = act === acts - 1;
      prev.onclick = () => {
        act--;
        render();
      };
      next.onclick = () => {
        act++;
        render();
      };
      head.append(
        prev,
        node("strong", "", `第 ${act + 1} 幕 · ${start}—${end} 关`),
        next,
      );
      shell.append(head);
      const route = node("ol", "chapter-route");
      attribute(route, "aria-label", "冒险路线");
      for (let index = start; index <= end; index++) {
        const info = chapter(this.game, index),
          done = index < this.index || (complete && index <= this.index),
          item = node("li", "");
        item.dataset.state = done
          ? "done"
          : index === this.index
            ? "current"
            : "locked";
        item.dataset.stage = String(index);
        item.dataset.boss = String(!!info.bossKind);
        const title = `第${index}关 · ${info.name}${info.bossKind ? " · 首领关" : ""}`;
        attribute(item, "title", title);
        attribute(
          item,
          "aria-label",
          `${title} · ${done ? "已完成" : index === this.index ? "当前关卡" : "未抵达"}`,
        );
        item.append(
          node("b", "", String(index).padStart(2, "0")),
          node("span", "", info.bossKind ? "⚔ 首领" : done ? "✓" : "·"),
        );
        route.append(item);
      }
      shell.append(route);
    };
    render();
    parent.append(shell);
  }
  show(kind, preview = false) {
    if (!preview && (kind !== "result" || this.game.phase !== "victory")) {
      this.showBanner(kind);
      return;
    }
    this.banner.hidden = true;
    this.inline = false;
    const g = this.game,
      s = g.stage,
      c = chapter(g);
    this.kind = kind;
    this.preview = preview;
    this.manual = false;
    this.closing = false;
    this.age = 0;
    this.soundPending = kind !== "intro";
    this.root.hidden = false;
    this.root.dataset.scene = kind;
    this.root.dataset.chapter = String(s.index);
    this.root.dataset.act = String(Math.ceil(s.index / 15));
    this.root.dataset.boss = String(!!s.bossKind);
    this.root.dataset.leaving = "false";
    this.root.parentElement.classList.add("stage-screen-open");
    for (const el of this.inertTargets) el.inert = true;
    this.root.replaceChildren();
    const top = node("div", "chapter-top");
    top.append(
      node(
        "span",
        "chapter-eyebrow",
        preview ? "关卡反馈 · 当前战绩预览" : "晶刃远征 / KNIFE ODYSSEY",
      ),
    );
    const back = node(
      "button",
      "chapter-text-button",
      preview ? "关闭预览 ✕" : "无尽练习 ↗",
    );
    back.onclick = () => (preview ? this.leave() : this.endless());
    top.append(back);
    this.root.append(top);
    const body = node("div", "chapter-body");
    this.root.append(body);
    const footer = node("div", "chapter-footer");
    const action = node("button", "chapter-action");
    action.id = "stageSceneAction";
    if (kind === "intro") {
      this.route(body, false);
      body.append(
        node("p", "chapter-kicker", `第 ${s.index} / ${s.total} 关 · ${c.tag}`),
      );
      body.append(node("h2", "chapter-title", c.name));
      body.append(
        node(
          "p",
          "chapter-subtitle",
          s.index === 1
            ? "从第一刀开始，打造你的破阵构筑。"
            : s.bossKind
              ? "带上已经成形的力量，迎战这一路的首领。"
              : "前路未尽，准备好下一刀。",
        ),
      );
      this.portrait(body, c.slot);
      text(action, preview ? "返回当前测试 →" : `开始第 ${s.index} 关 →`);
      action.onclick = () => {
        this.sound("start", g.config);
        this.leave();
      };
    } else if (kind === "boss") {
      body.append(node("p", "chapter-kicker", "WARNING / 首领来袭"));
      const bossPreview = c.boss
        ? c
        : bosses[s.index < Math.ceil(s.total / 2) ? "fortress" : "summoner"];
      body.append(node("h2", "chapter-title", bossPreview.boss));
      this.portrait(body, bossPreview.slot);
      body.append(node("p", "boss-challenge", bossPreview.tip));
      body.append(node("p", "chapter-subtitle", "守住防线，完成这场战斗。"));
      const timer = node("div", "boss-arrival-timer");
      timer.append(node("i", ""));
      body.append(timer);
      text(action, preview ? "关闭警报预览 →" : "迎战首领 →");
      action.onclick = () => this.leave();
      footer.append(
        node("p", "chapter-footnote", "警报期间战场暂停 · 点击可立即迎战"),
      );
    } else {
      const r = g.stageResult;
      const victory = g.phase === "victory";
      const medals = [
        [
          s.bossKind ? "首领击破" : "敌群肃清",
          s.bossKind ? s.bossDefeated : s.completed,
          "⚔",
        ],
        ["无人漏网", s.completed && r.leaked === 0, "◇"],
        [
          `一刀 ${g.config.stageMedalKills} 杀`,
          r.maxKills >= g.config.stageMedalKills,
          "✦",
        ],
      ];
      body.append(
        node(
          "p",
          "chapter-kicker",
          victory ? "ADVENTURE COMPLETE" : "CHAPTER CLEAR",
        ),
      );
      const emblem = node("div", "chapter-emblem");
      emblem.append(
        node("span", "", "✦"),
        node(
          "small",
          "",
          victory ? "远征完成" : s.bossKind ? "首领击破" : "防线守住",
        ),
      );
      body.append(emblem);
      body.append(
        node(
          "h2",
          "chapter-title",
          preview
            ? "通关结算预览"
            : victory
              ? "远征，全关突破！"
              : `第 ${s.index} 关，拿下！`,
        ),
      );
      body.append(
        node(
          "p",
          "chapter-subtitle",
          victory
            ? "你的构筑，已经闯过整段旅程。"
            : "这套构筑，值得带去下一关。",
        ),
      );
      const medalRow = node("div", "chapter-medals");
      for (const [label, earned, icon] of medals) {
        const medal = node("div", "chapter-medal");
        medal.dataset.earned = String(earned);
        attribute(
          medal,
          "aria-label",
          `${label}：${earned ? "已获得" : "未达成"}`,
        );
        medal.append(node("b", "", icon), node("span", "", label));
        medalRow.append(medal);
      }
      if (s.bossKind || victory || preview) body.append(medalRow);
      const score = node("div", "chapter-score");
      score.append(node("small", "", victory ? "冒险总分" : "本关得分"));
      const scoreValue = node("strong", "", "0");
      scoreValue.dataset.tally = String(victory ? g.score : r.score);
      score.append(scoreValue);
      body.append(score);
      const stats = node("div", "chapter-results");
      for (const [label, value] of [
        ["击杀", r.kills],
        ["出手", r.shots],
        ["最高连杀", r.maxKills],
        ["剩余防线", g.lives],
      ]) {
        const cell = node("div", "");
        cell.append(node("b", "", value), node("small", "", label));
        stats.append(cell);
      }
      body.append(stats);
      const growth = node("div", "chapter-growth");
      growth.append(
        node(
          "strong",
          "",
          r.levelEnd > r.levelStart ||
            r.atkEnd > r.atkStart ||
            r.buildChanges.length
            ? "这一关，你变强了"
            : "本关收获",
        ),
      );
      const gains = node("p", "chapter-gains");
      gains.append(
        node("span", "", `LV.${r.levelStart} → ${r.levelEnd}`),
        node("span", "", `ATK ${fmt(r.atkStart)} → ${fmt(r.atkEnd)}`),
      );
      growth.append(gains);
      const receipts = node(
        "p",
        "chapter-receipts",
        `经验 +${fmt(r.xpEarned)}   /   金币 +${r.coinsEarned}`,
      );
      growth.append(
        receipts,
        node("small", "", "本关累计获得，已在战斗中计入"),
      );
      const build = node("div", "chapter-build");
      for (const item of r.buildChanges) {
        const name =
          item.id === "recallForge"
            ? "归心锻造"
            : upgrades[item.id]?.[0] || item.id;
        build.append(
          node(
            "span",
            "",
            `${name} ${item.delta > 0 ? `+${item.delta}` : `强化 +${item.shopDelta}`}`,
          ),
        );
      }
      if (r.buildChanges.length) growth.append(build);
      body.append(growth);
      if (s.bossKind || victory || preview) this.route(body, s.completed);
      footer.append(
        node(
          "p",
          "chapter-footnote",
          victory
            ? `冒险累计击杀 ${g.kills} · 试试另一套构筑，再刷新得分`
            : `下一站：${chapter(g, s.index + 1).name} · 成长与墙刀继续保留`,
        ),
      );
      text(
        action,
        preview
          ? "返回当前测试 →"
          : victory
            ? "再挑战一局"
            : `进入第 ${s.index + 1} 关 →`,
      );
      action.onclick = () => {
        if (preview) this.leave();
        else if (g.phase === "stageClear") this.next();
        else if (g.phase === "victory") this.restart();
      };
    }
    footer.append(action);
    this.root.append(footer);
    this.tallies = [...this.root.querySelectorAll("[data-tally]")];
    this.root.scrollTop = 0;
    action.focus({ preventScroll: true });
  }
  portrait(parent, slot) {
    const hero = node("div", "chapter-portrait");
    hero.append(node("div", "chapter-orbit"));
    const canvas = node("canvas", "chapter-monster");
    canvas.width = 480;
    canvas.height = 300;
    canvas.dataset.slot = slot;
    canvas.setAttribute("aria-hidden", "true");
    hero.append(canvas);
    parent.append(hero);
    this.portraitEntry = null;
  }
  showBanner(kind) {
    this.hide();
    this.kind = kind;
    this.inline = true;
    this.preview = false;
    this.age = 0;
    this.soundPending = true;
    const c = chapter(this.game);
    this.banner.dataset.kind = kind;
    this.banner.replaceChildren(
      node(
        "small",
        "",
        kind === "result"
          ? "关卡完成"
          : kind === "boss"
            ? "首领来袭"
            : "第 " + this.game.stage.index + " 关",
      ),
      node(
        "strong",
        "",
        kind === "result"
          ? "漂亮的一战"
          : kind === "boss"
            ? c.boss || "首领来袭"
            : c.name,
      ),
    );
    this.banner.hidden = false;
  }
  update(dt) {
    if (!this.kind) return;
    const c = this.game.config;
    this.frozen = !dt;
    if (this.inline) {
      this.banner.dataset.paused = String(!dt);
      if (dt && this.soundPending) {
        this.soundPending = false;
        this.sound(this.kind === "intro" ? "start" : this.kind, c);
      }
      this.age += dt;
      const hold =
        this.kind === "intro"
          ? c.stageIntroDuration
          : this.kind === "result"
            ? c.stageClearDuration
            : c.stageBossIntroDuration;
      const exit = c.stageTransitionDuration;
      this.banner.style.opacity = String(
        this.age <= hold
          ? 1
          : Math.max(0, 1 - (this.age - hold) / Math.max(0.001, exit)),
      );
      if (dt && this.age >= hold + exit) {
        const advance = this.kind === "result";
        this.hide();
        if (advance) this.next();
      }
      return;
    }
    const header = this.root.parentElement.querySelector(".game-header");
    this.root.style.top = `${header.offsetTop + header.offsetHeight + 6}px`;
    this.root.style.setProperty(
      "--scene-exit",
      `${c.stageTransitionDuration}s`,
    );
    this.root.dataset.celebrate = String(c.stageCelebrationOn);
    this.root.dataset.paused = String(!dt);
    if (dt && this.soundPending) {
      this.soundPending = false;
      this.sound(
        this.kind === "result" && this.game.phase === "victory"
          ? "victory"
          : this.kind,
        c,
      );
    }
    this.age += dt;
    const canvas = this.root.querySelector(".chapter-monster");
    if (canvas) {
      const slot = stagePortraitSlot(this.assets.entries, canvas.dataset.slot);
      const entry = this.assets.entries[slot];
      if (entry !== this.portraitEntry) {
        const ctx = canvas.getContext("2d");
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        this.assets.draw(ctx, slot, 240, 150, 175);
        this.portraitEntry = entry;
      }
    }
    const t = c.stageResultCountDuration
      ? Math.min(1, this.age / c.stageResultCountDuration)
      : 1;
    for (const el of this.tallies || [])
      el.textContent = String(
        Math.round(Number(el.dataset.tally) * (1 - (1 - t) ** 3)),
      );
    if (this.kind === "boss") {
      const duration = c.stageBossIntroDuration;
      this.root.style.setProperty(
        "--arrival-progress",
        String(duration ? Math.max(0, 1 - this.age / duration) : 0),
      );
      if (!this.preview && this.age >= duration) this.leave();
    }
    if (this.closing) {
      this.exitAge += dt;
      if (this.exitAge >= c.stageTransitionDuration) this.hide();
    }
  }
}

export function playStageCue(audio, config, kind) {
  if (
    !audio ||
    audio.state !== "running" ||
    !config.sound ||
    !config.stageSoundOn ||
    !config.volume ||
    !config.stageSoundVolume
  )
    return false;
  const cue =
    {
      boss: "bossEntry",
      start: "stageStart",
      victory: "victory",
      result: "stageClear",
    }[kind] || "stageClear";
  return playCombatCue(audio, config, cue, { gain: config.stageSoundVolume });
}
