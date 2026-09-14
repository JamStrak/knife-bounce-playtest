import { stageSchema, stageBalanceKeys } from "./stage-schema.mjs";
import { campaignStage, campaignPlan } from "./campaign-model.mjs";
import { campaignAnalysis } from "./campaign-lab.mjs";
import { stagePlan, stageStatus, stageEnemyHp } from "./stage-mode.mjs";
import {
  pressureProfile,
  pressureRequest,
  pressureRows,
} from "./stage-pressure.mjs";
import { comboMultiplier } from "./combo-rewards.mjs";
import { schema, validate } from "./config.mjs";
import {
  curveProfiles,
  curveValue,
  skillValue,
  shopPrice,
  progression,
  spawnBudget,
  giantWhirlAt,
  permanentDamageAt,
  enemyHpAt,
} from "./balance-model.mjs";
import {
  balanceKeys,
  selectBalance,
  skillLabels,
  skillFields,
  pressureFields,
  economyFields,
  pickupFields,
  profileKeys,
} from "./balance-catalog.mjs";
import { shopItems } from "./shop.mjs";
const fmt = (n) =>
  n == null || !Number.isFinite(n)
    ? "—"
    : Math.abs(n) >= 1000000
      ? n.toExponential(1)
      : Number(n.toFixed(2)).toLocaleString("zh-CN");
const tabs = {
  xp: "升级节奏",
  skills: "技能成长",
  pressure: "怪物压力",
  economy: "金币与道具",
  stages: "关卡与连击",
};
const stageGroups = {
  campaign: "战役结构",
  campaignHp: "战役生命成长",
  campaignSupply: "战役供给成长",
  campaignFormation: "战役布阵成长",
  campaignTypes: "战役怪物组成",
  campaignBoss: "战役首领成长",
  supply: "关卡供给",
  formation: "关卡布阵与补压",
  combo: "连击经验",
  fortress: "堡垒巨兽",
  summoner: "召唤领主",
};
const pressureLimitNames = {
  "wave-cap": "单波数量上限",
  budget: "本关剩余预算",
  "enemy-cap": "全场存活上限",
  space: "可用落点不足",
  "no-safe-rows": "没有满足应对出手数的安全行",
  "empty-board-minimum": "空场保底补1只，避免无敌可打",
};
const pressureLimits = (items = []) =>
  items.length
    ? items.map((v) => pressureLimitNames[v] || v).join("、")
    : "未触发名额限制";
export function mergeBalance(current, values) {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new Error("平衡参数格式无效");
  for (const k of Object.keys(values))
    if (!balanceKeys.has(k)) throw new Error(`不是平衡参数：${k}`);
  return validate({ schemaVersion: 1, config: { ...current, ...values } })
    .config;
}
export function setupBalanceLab({
  getConfig,
  getGame,
  apply,
  onOpen,
  onClose,
}) {
  const root = document.createElement("dialog");
  root.id = "balanceLab";
  root.className = "balance-lab";
  root.innerHTML = `<header class="bl-header"><div><small>KNIFE PARTY / BALANCE LAB</small><h1>数值平衡工作台</h1></div><button id="balanceClose">返回游戏 ×</button></header>
    <nav class="bl-tabs" aria-label="平衡分类">${Object.entries(tabs)
      .map(([id, name]) => `<button data-btab="${id}">${name}</button>`)
      .join("")}</nav>
    <div class="bl-body"><section class="bl-analysis"><div class="bl-chart-heading"><div><span id="balanceEyebrow"></span><h2 id="balanceTitle"></h2></div><div id="balanceSelector"></div></div>
    <div class="bl-scenario" id="balanceScenario"><label>预览到 <input id="balanceHorizon" type="number" min="5" max="100" step="1" value="30"></label><label id="balanceKillsLabel">假设每回合击杀 <input id="balanceKills" type="number" min="0.1" max="20" step="0.1" value="1"></label></div>
    <div class="bl-legend" id="balanceLegend"><span class="bl-current">当前草稿</span><span class="bl-baseline">打开时的配置</span></div>
    <svg id="balanceChart" viewBox="0 0 760 300" role="img" aria-label="数值成长曲线，可拖动控制点"></svg>
    <div id="balanceStagePreview" class="bl-stage-preview" hidden></div>
    <section id="balancePressurePreview" class="bl-pressure-preview" hidden aria-label="动态补压试算"></section>
    <p id="balanceChartHelp" class="bl-note"></p><div id="balanceMetrics" class="bl-metrics"></div><div class="bl-table-wrap"><table id="balanceTable"></table></div></section>
    <aside class="bl-controls"><div class="bl-controls-title"><h2>关键参数</h2><button id="balanceRestore">还原打开时数值</button></div>
    <div class="bl-tools"><button id="balanceGentle">试试平缓升级方案</button><button id="balancePoints">由当前公式生成控制点</button></div>
    <div id="balanceFields"></div></aside></div>
    <footer class="bl-footer"><div><b id="balanceChangeCount">尚未修改</b><p id="balanceStatus" role="status">草稿不影响当前局。返回游戏时保留未应用草稿。</p></div><div class="bl-actions"><button id="balanceExport">导出平衡 JSON</button><label class="bl-file">导入<input id="balanceImport" type="file" accept=".json,application/json" hidden></label><label class="bl-save"><input id="balancePersist" type="checkbox" checked>同时保存参数</label><button id="balanceApply">应用到当前局</button><button id="balanceRestart" class="bl-primary">应用并重开测试</button></div></footer>`;
  document.body.append(root);
  const $ = (id) => root.querySelector("#" + id);
  let base,
    draft,
    pending = {},
    tab = "xp",
    skill = "damage",
    item = "damage",
    pressure = "hp",
    stageSubject = "campaign",
    horizon = 30,
    kills = 1,
    drag = null;
  // Scenario assumptions are deliberately separate from configuration and saves.
  const pressureCase = {
    index: 1,
    round: 8,
    before: 40,
    kills: 40,
    remaining: 40,
    type: "normal",
    opening: false,
  };
  const note = (text) => ($("balanceStatus").textContent = text);
  const profile = () =>
    tab === "xp"
      ? "xp"
      : tab === "pressure"
        ? pressure
        : tab === "skills" && skill === "damage"
          ? "damage"
          : null;
  const changes = () =>
    Object.fromEntries(
      [...balanceKeys]
        .filter((k) => draft[k] !== base[k])
        .map((k) => [k, draft[k]]),
    );
  const fields = () =>
    tab === "xp"
      ? [...profileKeys("xp"), "xpDrop"]
      : tab === "skills"
        ? [...(profile() ? profileKeys("damage") : []), ...skillFields[skill]]
        : tab === "pressure"
          ? ["enemyCap", ...profileKeys(pressure), ...pressureFields]
          : tab === "stages"
            ? [
                "gameMode",
                "stageCampaignMode",
                "enemyCap",
                ...(stageSubject === "campaign"
                  ? ["stagePrepTurns", "stageSupplyMode"]
                  : []),
                ...(["supply", "formation"].includes(stageSubject)
                  ? ["stageSupplyMode"]
                  : []),
                ...[...stageBalanceKeys].filter(
                  (key) =>
                    stageSchema[key]?.group === stageGroups[stageSubject] &&
                    !(
                      stageSubject === "formation" &&
                      draft.stageCampaignMode === "campaign" &&
                      /^stage[12]/.test(key)
                    ),
                ),
              ]
            : [...economyFields, ...pickupFields];
  function reflectActions() {
    const count = Object.keys(changes()).length;
    $("balanceChangeCount").textContent = count
      ? `${count} 项草稿修改`
      : `与打开时数值相同`;
    const g = getGame(),
      structural = Object.entries(schema).some(
        ([k, s]) => s.when === "重开" && draft[k] !== g.config[k],
      );
    $("balanceApply").disabled = g.phase !== "aim" || structural;
    $("balanceApply").title = structural
      ? "包含需要重开的参数，请使用应用并重开"
      : g.phase !== "aim"
        ? "请关闭工作台，让当前入场/出刀/升级结束后再应用；也可以直接重开测试"
        : "已有怪物HP与累积经验金币不重算；后续事件使用新参数";
  }
  function edit(values) {
    try {
      draft = mergeBalance(draft, values);
      note("草稿已更新；应用后才影响游戏。返回游戏会保留草稿。");
      refresh(false);
      return true;
    } catch (e) {
      note(e.message);
      return false;
    }
  }
  function renderFields() {
    const p = profile();
    $("balanceFields").replaceChildren();
    for (const key of new Set(fields())) {
      const s = schema[key];
      if (!s) throw new Error("缺少参数：" + key);
      const row = document.createElement("div");
      row.className = "bl-field";
      const label = document.createElement("label");
      label.htmlFor = "bal-" + key;
      label.textContent =
        key === "stagePrepTurns" && draft.stageSupplyMode === "adaptive"
          ? "压力成长回合数（非强制等待时长）"
          : s.label;
      const input = document.createElement(
        s.type === "select" ? "select" : "input",
      );
      input.id = "bal-" + key;
      input.dataset.balanceKey = key;
      if (s.type === "select")
        for (const [v, t] of Object.entries(s.options)) {
          const o = document.createElement("option");
          o.value = v;
          o.textContent = t;
          input.append(o);
        }
      else if (s.type === "boolean") input.type = "checkbox";
      else {
        input.type = "number";
        input.min = s.min;
        input.max = s.max;
        input.step = s.step;
      }
      if (s.type === "boolean") input.checked = draft[key];
      else input.value = draft[key];
      const inactive =
        (draft.stageCampaignMode === "campaign" &&
          (/^stage[12](Budget|Hp)/.test(key) ||
            [
              "stageFastChance",
              "stageBombChance",
              "bossFortressHp",
              "bossSummonerHp",
              "bossSummonHp",
            ].includes(key))) ||
        (draft.stageCampaignMode === "demo" && key.startsWith("campaign")) ||
        (key === "stageSpawnCurvePower" &&
          draft.stageSupplyMode === "adaptive") ||
        (p &&
          ((draft[p + "CurveMode"] === "points" &&
            [
              curveProfiles[p].base,
              curveProfiles[p].gain,
              p + "CurvePower",
            ].includes(key)) ||
            (draft[p + "CurveMode"] !== "points" &&
              key.startsWith(p + "CurveP") &&
              key !== p + "CurvePower")));
      input.disabled = !!inactive;
      row.classList.toggle("inactive", !!inactive);
      input.onchange = () => {
        const value =
          s.type === "boolean"
            ? input.checked
            : s.type === "select"
              ? input.value
              : Number(input.value);
        if (input.type === "number" && input.value.trim() === "") {
          note("数值不能为空。");
          input.value = draft[key];
          return;
        }
        if (edit({ [key]: value })) renderFields();
        else input.value = draft[key];
      };
      row.append(label, input);
      if (
        draft.stageCampaignMode === "campaign" &&
        inactive &&
        (key.startsWith("boss") ||
          (key.startsWith("stage") && key !== "stageSpawnCurvePower"))
      ) {
        const hint = document.createElement("small");
        hint.textContent = "旧双关参数保留；战役数值在战役成长分组中调整。";
        row.append(hint);
      }
      if (!s.type) {
        const range = document.createElement("input");
        range.type = "range";
        range.min = s.min;
        range.max = s.max;
        range.step = s.step;
        range.value = draft[key];
        range.disabled = !!inactive;
        range.setAttribute("aria-label", s.label + "滑条");
        range.dataset.balanceSlider = key;
        range.oninput = () => {
          input.value = range.value;
          edit({ [key]: Number(range.value) });
        };
        row.append(range);
      }
      if (s.when === "重开") {
        const small = document.createElement("small");
        small.textContent = "应用需重开";
        row.append(small);
      } else if (tab === "stages" && s.when) {
        const small = document.createElement("small");
        small.textContent = "应用后生效时机：" + s.when;
        row.append(small);
      }
      $("balanceFields").append(row);
    }
  }
  function series(c) {
    const p = profile(),
      start = p
        ? curveProfiles[p].offset
        : tab === "skills" && skill === "levelAtk"
          ? 1
          : 0;
    return Array.from({ length: horizon - start + 1 }, (_, i) => {
      const x = start + i;
      return {
        x,
        y: p
          ? curveValue(c, p, x)
          : tab === "skills"
            ? skillValue(c, skill, x)
            : shopPrice(c, shopItems[item].priceKey, x),
      };
    });
  }
  function chart() {
    if (tab === "stages") {
      renderStagePreview();
      return;
    }
    const p = profile(),
      active = series(draft),
      old = series(base),
      start = active[0].x;
    const maxY =
      drag?.maxY ??
      Math.max(
        1,
        Math.ceil(
          Math.max(...active.map((v) => v.y), ...old.map((v) => v.y)) * 1.12,
        ),
      );
    const x = (v) => 58 + ((v - start) / (horizon - start)) * 678,
      y = (v) => 260 - (v / maxY) * 220;
    const path = (rows) =>
      rows
        .map(
          (r, i) => `${i ? "L" : "M"}${x(r.x).toFixed(2)},${y(r.y).toFixed(2)}`,
        )
        .join(" ");
    let markup = `<defs><linearGradient id="balanceArea" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#e78035" stop-opacity=".2"/><stop offset="1" stop-color="#e78035" stop-opacity="0"/></linearGradient></defs>`;
    for (let i = 0; i <= 4; i++) {
      const value = (maxY * i) / 4,
        py = y(value);
      markup += `<path d="M58 ${py}H736" class="bl-grid"/><text x="48" y="${py + 4}" text-anchor="end">${fmt(value)}</text>`;
    }
    for (let i = 0; i <= 4; i++) {
      const value = Math.round(start + ((horizon - start) * i) / 4);
      markup += `<text x="${x(value)}" y="281" text-anchor="middle">${value}</text>`;
    }
    markup += `<path d="${path(active)} L736 260 L58 260Z" fill="url(#balanceArea)"/><path d="${path(old)}" class="bl-old-line"/><path d="${path(active)}" class="bl-new-line"/>`;
    if (tab === "pressure" && pressure === "hp") {
      const atk = permanentDamageAt(
        draft,
        getGame().buffs.damage,
        getGame().level,
      );
      markup += `<path d="${path(active.map((r) => ({ x: r.x, y: enemyHpAt(draft, r.x, atk) })))}" fill="none" stroke="#28a69a" stroke-width="3" stroke-dasharray="7 4"/>`;
    }
    if (p)
      curveProfiles[p].xs.forEach((v, i) => {
        if (v <= horizon)
          markup += `<g transform="translate(${x(v)} ${y(curveValue(draft, p, v))})" data-point="${i}" tabindex="0" role="slider" aria-label="${curveProfiles[p].axis}${v}控制点" aria-valuemin="${curveProfiles[p].min ?? 1}" aria-valuemax="100000" aria-valuenow="${curveValue(draft, p, v)}"><circle class="bl-hit" r="32"/><circle class="bl-handle" r="9"/><title>拖动调节：${curveProfiles[p].axis}${v} / ${fmt(curveValue(draft, p, v))}（方向键微调）</title></g>`;
      });
    $("balanceChart").innerHTML = markup;
    $("balanceChart").dataset.maxY = maxY;
    $("balanceChart").dataset.horizon = horizon;
    $("balanceChartHelp").textContent = p
      ? `横轴：${curveProfiles[p].axis} · 纵轴：${curveProfiles[p].unit}。拖橙点会切换四点曲线；左右位置固定，上下改数值。最后一个节点后沿末段斜率延伸，封顶可限制后期增长。`
      : tab === "skills"
        ? `${skill === "recall" ? "横轴是金币归心锻造次数，经验只负责解锁。" : skill === "bounce" ? "图中显示墙反弹；怪物弹射每级增量可分别修改。" : "横轴是该技能投入等级。"}图表可查看超出当前上限的理论值，实际仍受技能等级、刀链容量和10把齐射上限约束。`
        : "横轴：同类商品已购买次数；纵轴：下一次报价。价格与游戏商店共用公式；道具倍率、概率在右侧调整。";
    let heads, rows, metrics;
    if (tab === "xp") {
      const data = progression(draft, horizon, kills),
        prior = progression(base, horizon, kills),
        last = data.at(-1);
      metrics = [
        ["首次升级需要", `${fmt(data[0].kills)} 次击杀`],
        [`Lv.${horizon}本级`, `${fmt(last.kills)} 次击杀`],
        [`升到Lv.${horizon + 1}预计`, `${fmt(last.rounds)} 回合`],
        ["对照预计回合", fmt(prior.at(-1).rounds)],
      ];
      heads = ["升级", "本级经验", "本级击杀需求", "累计预计回合"];
      rows = data.map((r) => [
        `Lv.${r.level} → ${r.level + 1}`,
        fmt(r.need),
        fmt(r.kills),
        fmt(r.rounds),
      ]);
      $("balanceChartHelp").textContent +=
        " 预计回合只按假设击杀数×每怪经验计算，未模拟瞄准、掉落、开场存量或随机三选一；每怪经验为0时无法自然升级。";
    } else if (tab === "pressure" && pressure === "spawn") {
      const alive = getGame().enemies.filter((e) => e.hp > 0).length;
      metrics = [
        ["当前存活（含入场）", fmt(alive)],
        ["全场上限 · 草稿", fmt(draft.enemyCap)],
        ["剩余名额 · 草稿", fmt(Math.max(0, draft.enemyCap - alive))],
        [
          "下一波最多 · 按当前存量",
          fmt(spawnBudget(draft, getGame().round + 1, alive)),
        ],
      ];
      heads = ["回合", "计划生成", "打开时计划", "按当前存量最多生成"];
      rows = active.map((r, i) => [
        r.x,
        fmt(r.y),
        fmt(old[i].y),
        fmt(spawnBudget(draft, r.x, alive)),
      ]);
      $("balanceChartHelp").textContent +=
        " 生成数向下取整，可设0。实际生成同时受全场剩余名额、列数和入口空位限制（每波每列最多1只）。当前存量预测不模拟后续击杀/越线；达到上限停止补怪，腾出名额后按正常波次恢复，不积压补发。尸体/墙上残骸/道具不占名额；降低上限不会清除现有怪物。";
    } else if (tab === "pressure") {
      const damage = permanentDamageAt(
          draft,
          getGame().buffs.damage,
          getGame().level,
        ),
        limited = (round) => enemyHpAt(draft, round, damage);
      metrics = [
        ["当前等级/构筑永久ATK", fmt(damage)],
        [
          "血量相对上限",
          draft.hpAtkCapOn
            ? fmt(Math.max(1, Math.floor(damage * draft.hpAtkHitCap)))
            : "关闭",
        ],
        [`第${horizon}回合实际新怪HP`, fmt(limited(horizon))],
        ["单刀命中需求", fmt(Math.ceil(limited(horizon) / damage))],
      ];
      heads = ["回合", "计划HP", "限制后新怪HP", "永久单刀命中数"];
      rows = active.map((r) => [
        r.x,
        fmt(r.y),
        fmt(limited(r.x)),
        fmt(Math.ceil(limited(r.x) / damage)),
      ]);
      $("balanceChartHelp").textContent +=
        " 绿色虚线为限制后的新怪HP：取原血量曲线与永久ATK×承伤次数的较小值。预览固定当前玩家等级/锋芒构筑，不预测未来升级；临时增伤不抬高血量，旧怪不重算。";
    } else if (tab === "skills" && skill === "levelAtk") {
      metrics = [
        ["Lv.1 自然基础ATK", fmt(active[0].y)],
        [`Lv.${horizon} 自然基础ATK`, fmt(active.at(-1).y)],
        ["每级增量参数", fmt(draft.levelAtkGain)],
        ["当前等级", fmt(getGame().level)],
      ];
      heads = ["玩家等级", "自然基础ATK", "打开时ATK", "本级自然增量"];
      rows = active.map((r, i) => [
        r.x,
        fmt(r.y),
        fmt(old[i].y),
        fmt(i ? r.y - active[i - 1].y : 0),
      ]);
      $("balanceChartHelp").textContent +=
        " 每次升级选任何技能都增加自然ATK；曲线为零锋芒、无临时增伤的基础攻击。实际ATK还叠加锋芒成长及狂热倍率，金币强化不增加玩家等级。增量设0关闭自然成长。";
    } else if (tab === "skills" && skill === "size") {
      const first = giantWhirlAt(draft, 1),
        last = giantWhirlAt(draft, horizon);
      metrics = [
        ["一级旋风伤害", `${fmt(first.multiplier)} 倍刀伤`],
        ["末级旋风伤害", `${fmt(last.multiplier)} 倍刀伤`],
        ["一级斩击半径", `${fmt(first.radius / draft.cell)} 格`],
        ["末级斩击半径", `${fmt(last.radius / draft.cell)} 格`],
      ];
      heads = ["旋风斩等级", "范围倍率", "旋风半径（格）", "斩击伤害倍率"];
      rows = active.map((r) => {
        const whirl = giantWhirlAt(draft, r.x);
        return [
          r.x,
          fmt(r.y),
          fmt(whirl.radius / draft.cell),
          fmt(whirl.multiplier),
        ];
      });
      $("balanceChartHelp").textContent +=
        " 曲线显示斩击范围倍率；旋风半径=基础半径×范围倍率，伤害=该刀伤害×斩击倍率。升级不放大飞刀或普通接触碰撞。仅最终落点一次，穿透/反弹途中不触发；分裂小刀的旋风范围仍同比缩小。";
    } else {
      metrics = [
        ["起始值", fmt(active[0].y)],
        ["预览末值", fmt(active.at(-1).y)],
        ["对照末值", fmt(old.at(-1).y)],
        [
          tab === "economy" ? "每怪金币" : "等级/购买上限",
          fmt(
            tab === "economy"
              ? draft.coinDrop
              : skill === "recall"
                ? draft.shopMaxPurchases
                : skill === "platforms"
                  ? 9
                  : draft.upgradeCap,
          ),
        ],
      ];
      heads = [
        tab === "economy" ? "已购买次数" : "投入等级",
        "当前数值",
        "打开时数值",
        tab === "economy" ? "需击杀赚取" : "当前边际增量",
      ];
      rows = active.map((r, i) => [
        r.x,
        fmt(r.y),
        fmt(old[i].y),
        fmt(
          tab === "economy"
            ? draft.coinDrop > 0
              ? Math.ceil(r.y / draft.coinDrop)
              : null
            : i
              ? r.y - active[i - 1].y
              : 0,
        ),
      ]);
    }
    $("balanceMetrics").innerHTML = metrics
      .map(([t, v]) => `<div><small>${t}</small><strong>${v}</strong></div>`)
      .join("");
    if (tab === "economy")
      $("balanceChartHelp").textContent +=
        " 攻击道具=当前刀伤×原倍率＋每个受击目标最大HP×追加比例。雷链逐目标计算；环阵每次接触计算；种子在爆炸时对每个目标计算。比例设0保留旧刀伤倍率模式；狂热本身随ATK增长。";
    $("balanceTable").innerHTML =
      `<thead><tr>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((v) => `<td>${v}</td>`).join("")}</tr>`).join("")}</tbody>`;
  }
  function renderPressurePreview() {
    const box = $("balancePressurePreview"),
      show = tab === "stages" && stageSubject === "formation";
    box.hidden = !show;
    if (!show) return;
    const sc = pressureCase;
    sc.index = Math.min(sc.index, campaignStage(draft, 1).total);
    const plan = campaignStage(draft, sc.index),
      budget = plan.budget;
    sc.kills = Math.min(sc.before, sc.kills);
    sc.remaining = Math.min(budget, sc.remaining);
    const state = {
        index: sc.index,
        plan,
        round: sc.opening ? 1 : sc.round,
        prepTurns: draft.stagePrepTurns,
        budget,
        spawned: budget - sc.remaining,
        alive: sc.opening ? 0 : sc.before - sc.kills,
        kills: sc.opening ? 0 : sc.kills,
        opening: sc.opening,
        type: sc.type,
      },
      p = pressureProfile(
        draft,
        sc.index,
        state.round,
        draft.stagePrepTurns,
        plan,
      ),
      request = pressureRequest(draft, state),
      legalRows = pressureRows(draft, state),
      forward = legalRows.filter((r) => r.forward).length,
      rear = legalRows.length - forward,
      forwardChance = forward ? (rear ? p.frontChance : 1) : 0,
      rowProb = (r) =>
        r.forward ? forwardChance / forward : (1 - forwardChance) / rear,
      n = draft.stagePrepTurns,
      lines = (c, index) =>
        Array.from({ length: n }, (_, i) => ({
          round: i + 1,
          target: pressureProfile(c, index, i + 1).target,
        })),
      curves = [
        lines(draft, 1),
        lines(draft, plan.total),
        lines(base, 1),
        lines(base, campaignStage(base, 1).total),
      ],
      max = Math.max(1, ...curves.flat().map((r) => r.target)),
      x = (round) => 44 + ((round - 1) / Math.max(1, n - 1)) * 588,
      y = (target) => 178 - (target / max) * 146,
      path = (rows) =>
        rows
          .map((r, i) => `${i ? "L" : "M"}${x(r.round)},${y(r.target)}`)
          .join(" "),
      current = Math.max(1, Math.min(n, state.round)),
      selected = pressureProfile(draft, sc.index, current).target;
    const input = (id, label, value, max, min = 0) =>
      `<label>${label}<input id="${id}" type="number" min="${min}" max="${max}" step="1" value="${value}"></label>`;
    box.innerHTML = `
      <div class="bl-pressure-heading"><div><small>SCENARIO / 只做试算，不保存假设</small><h3>清屏之后，下一波补多少？</h3></div><span class="bl-pressure-mode">${draft.stageSupplyMode === "adaptive" ? "草稿：动态压力" : "草稿：旧曲线 · 以下为动态方案试算"}</span></div>
      <div class="bl-pressure-case">
        <label>假设关卡<select id="pressureIndex">${campaignPlan(draft)
          .map(
            (p) =>
              `<option value="${p.index}" ${sc.index === p.index ? "selected" : ""}>第${p.index}关 · ${p.bossName || "普通关"}</option>`,
          )
          .join("")}</select></label>
        ${input("pressureRound", "假设补怪时的关内回合", sc.round, 200, 1)}
        ${input("pressureBefore", "本刀出手前存活", sc.before, 500)}
        ${input("pressureKills", "本刀实际击杀", sc.kills, sc.before)}
        ${input("pressureRemaining", "本波投放前剩余预算", sc.remaining, budget)}
        <label>落点预览怪物<select id="pressureType"><option value="normal" ${sc.type === "normal" ? "selected" : ""}>普通怪 / 爆炸怪</option><option value="fast" ${sc.type === "fast" ? "selected" : ""}>快速怪</option></select></label>
        <label class="bl-pressure-check"><input id="pressureOpening" type="checkbox" ${sc.opening ? "checked" : ""}>查看开局布阵（忽略本刀与存量假设）</label>
      </div>
      <div class="bl-pressure-result" aria-live="polite"><div><span>${sc.opening ? "开局" : "下一波"}名额内计划</span><strong id="pressurePlanned">${fmt(request.planned)}<small>只</small></strong></div><p id="pressureEquation">${
        sc.opening
          ? `开局指定 ${fmt(p.openingCount)} 只${request.warning ? "，空场保底补1只" : ""}`
          : `目标 ${fmt(request.target)} · 剩余 ${fmt(state.alive)} · 待补缺口 ${fmt(request.deficit)}<br>向上取整〔max(缺口 ${fmt(request.deficit)}, 击杀 ${fmt(state.kills)}) × ${fmt(p.refillRatio)}〕${request.warning ? "= 0，空场保底补1只" : `= ${fmt(request.requested)} 只`}`
      }</p></div>
      <p class="bl-pressure-limits" id="pressureLimits">${pressureLimits(request.limitedBy)}。剩余预算 ${fmt(request.remaining)}，全场可用名额 ${fmt(request.capSpace)}${sc.opening ? "，开局数量不受单波上限限制" : `，单波上限 ${fmt(p.waveCap)}`}。<b>名额内计划，实际还受空位限制。</b></p>
      <div class="bl-pressure-chart-heading"><h3>目标存量成长</h3><span>第1关 <i class="bl-p1"></i>　第${plan.total}关 <i class="bl-p2"></i>　打开时 <i class="bl-pbase"></i></span></div>
      <svg id="pressureTargetChart" viewBox="0 0 656 212" role="img" aria-label="两关目标怪物存量随回合变化，右侧曲线参数可调整">
        ${[0, 0.5, 1].map((t) => `<path d="M44 ${y(max * t)} H632" stroke="#dce2d6"/><text x="35" y="${y(max * t) + 5}" text-anchor="end">${fmt(max * t)}</text>`).join("")}
        ${curves
          .map(
            (r, i) =>
              `<path d="${path(r)}" fill="none" stroke="${["#2e8175", "#ca682e", "#94a39a", "#94a39a"][i]}" stroke-width="${i < 2 ? 3 : 2}" ${i > 1 ? 'stroke-dasharray="5 5"' : ""}/>`,
          )
          .reverse()
          .join("")}
        <path d="M${x(current)} 25 V178" stroke="#344f4b" stroke-dasharray="3 4"/>
        <circle cx="${x(current)}" cy="${y(selected)}" r="5" fill="${sc.index === 1 ? "#2e8175" : "#ca682e"}"/>
        <text x="44" y="202">第1轮</text><text x="632" y="202" text-anchor="end">第${fmt(n)}轮后保持末段目标</text>
      </svg>
      <div class="bl-pressure-chart-heading"><h3>逐行入场概率</h3><span>第${fmt(sc.index)}关 · ${sc.opening ? "开局" : `第${fmt(state.round)}轮`} · ${sc.type === "fast" ? "快速怪" : "普通怪"}</span></div>
      <p class="bl-note">空场且各行空位相同时的概率；上方为顶部。橙色为前压区域，当前可用前压概率 ${fmt(forwardChance * 100)}%。拥堵会改变概率；新怪至少保留 ${fmt(p.reactionTurns)} 次应对出手。</p>
      <div id="pressureRows">${Array.from({ length: draft.rows }, (_, row) => {
        const item = legalRows.find((r) => r.row === row),
          chance = item ? rowProb(item) : 0;
        return `<div class="bl-pressure-row ${item?.forward ? "forward" : ""} ${!item ? "blocked" : ""}" data-row="${row + 1}" data-probability="${chance}"><span>第${row + 1}行</span><div><i style="width:${chance * 100}%"></i></div><b>${item ? fmt(chance * 100) + "%" : "不可入场"}</b></div>`;
      }).join("")}</div>
      ${!legalRows.length ? `<p id="pressureNoSafeRows" class="bl-pressure-warning">该类怪物没有安全入场行。${sc.type === "fast" ? "快速怪将尝试改为普通怪；若普通怪同样没有安全行，实际无法生成。" : "实际无法生成。"}请降低“应对出手”或怪物推进格数，或增加战场行数。</p>` : ""}
      <p class="bl-note">本表只计算所填场景的一次补怪，假设不会写入参数 JSON。目标存量不是必须填满的固定数量；普通关清完预算与残兵即过关，首领关还需击败首领。战役开局/深度/概率在对应战役成长分组调整。</p>`;
    for (const [id, key, min, max] of [
      ["pressureRound", "round", 1, 200],
      ["pressureBefore", "before", 0, 500],
      ["pressureKills", "kills", 0, sc.before],
      ["pressureRemaining", "remaining", 0, budget],
    ])
      $(id).onchange = (e) => {
        const v = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(v))
          sc[key] = Math.max(min, Math.min(max, Math.floor(v)));
        renderPressurePreview();
      };
    $("pressureIndex").onchange = (e) => {
      sc.index = Number(e.target.value);
      renderPressurePreview();
    };
    $("pressureType").onchange = (e) => {
      sc.type = e.target.value;
      renderPressurePreview();
    };
    $("pressureOpening").onchange = (e) => {
      sc.opening = e.target.checked;
      renderPressurePreview();
    };
  }
  function renderStagePreview() {
    const g = getGame(),
      live = g.enemies.filter((e) => e.hp > 0).length,
      mode =
        draft.gameMode === "stages"
          ? draft.stageCampaignMode === "demo"
            ? "旧版双Boss演示"
            : `${campaignStage(draft, 1).total}关远征`
          : "无尽练习";
    let heads, rows, metrics, description;
    const status = stageStatus(g),
      phaseNames = {
        normal: "普通",
        charge: "蓄力",
        weak: "破绽",
        recover: "恢复",
        exhausted: "召唤耗尽",
        defeated: "已击败",
        pending: "尚未入场",
      };
    let liveStatus = status
      ? "当前实战：长关卡模式 · 第" +
        fmt(status.index) +
        "关 / 第" +
        fmt(status.round) +
        "轮 · 待投放普通怪 " +
        fmt(status.remainingBudget) +
        " · 存活敌人 " +
        fmt(live) +
        " / " +
        fmt(g.config.enemyCap)
      : "当前实战：无尽练习 · 存活敌人 " +
        fmt(live) +
        " / " +
        fmt(g.config.enemyCap) +
        " · 关卡供给、双Boss与连击经验尚未启用。";
    if (status) {
      if (status.supplyMode)
        liveStatus +=
          "<br>本关已采样补怪方式：" +
          (status.supplyMode === "adaptive" ? "动态压力" : "旧回合曲线") +
          (status.supplyMode !== draft.stageSupplyMode
            ? "（草稿切换将在下一关生效，可重开立即测试）"
            : "");
      if (status.lastSupply && ["formation", "supply"].includes(stageSubject)) {
        const last = status.lastSupply;
        liveStatus += `<br><span id="pressureLastSupply">最近实战补怪：需求 ${fmt(last.requested)} → 名额内计划 ${fmt(last.planned)} → 实际入场 ${fmt(last.spawned)}；${pressureLimits(last.limitedBy)}。投放后剩余预算 ${fmt(last.remaining)}。</span>`;
      }
      if (status.bossKind)
        liveStatus +=
          "<br>" +
          status.bossName +
          "：" +
          (phaseNames[status.bossPhase] || status.bossPhase) +
          (status.bossCountdown
            ? " / 剩余 " + fmt(status.bossCountdown) + " 轮"
            : "");
      if (status.bossKind === "summoner")
        liveStatus +=
          "<br>召唤剩余总预算 " +
          fmt(status.summonRemaining) +
          " · 等待入口 " +
          fmt(status.pendingSummons) +
          " · 存活小怪 " +
          fmt(status.liveSummons) +
          " / " +
          fmt(g.config.bossSummonCap);
      if (stageSubject === "combo" && g.combo)
        liveStatus +=
          "<br>当前 / 最近一次出刀：命中 " +
          fmt(g.combo.hits) +
          " · 击杀 " +
          fmt(g.combo.kills) +
          " · 快杀 " +
          fmt(g.combo.fastKills) +
          " · 经验 ×" +
          fmt(g.combo.multiplier) +
          " · 额外经验 " +
          fmt(g.combo.bonusXp);
    }
    if (
      stageSubject.startsWith("campaign") ||
      (stageSubject === "supply" && draft.stageCampaignMode === "campaign")
    ) {
      const overview = campaignAnalysis(
        draft,
        base,
        stageSubject === "supply" ? "campaignSupply" : stageSubject,
      );
      ({ heads, rows, metrics, description } = overview);
      description += overview.chart;
      if (draft.stageCampaignMode === "demo")
        description += " 当前选择旧双关演示；切换关卡路线后可编辑30关成长。";
      if (stageSubject === "supply")
        description +=
          " 当前战役使用逐关成长。旧双关专属数值已禁用，选择战役供给/生命/怪物组成分组调整。";
      $("balanceChartHelp").textContent = overview.help;
    } else if (stageSubject === "formation") {
      const first = campaignStage(draft, 1),
        last = campaignStage(draft, first.total);
      description =
        "通过开局数量、目标存量和前压落点区分各关。每次结算按目标缺口与本刀击杀的较大值补充一部分；清屏后有新的压力，已有大量残兵时避免固定刷怪持续堆积。补怪消耗有限预算，不增加本关总怪量。";
      metrics = [
        [
          "开局布阵 · 第一关 → 末关",
          `${fmt(first.openingCount)} → ${fmt(last.openingCount)} 只`,
        ],
        [
          "初段前压 · 第一关 → 末关",
          `${fmt(first.frontChance * 100)}% → ${fmt(last.frontChance * 100)}%`,
        ],
        [
          "清屏40只 · 未限幅需求",
          fmt(Math.ceil(40 * draft.stageRefillRatio)) + " 只",
        ],
        [
          "单次补充 / 全场上限",
          `${fmt(draft.stageWaveCap)} / ${fmt(draft.enemyCap)} 只`,
        ],
      ];
      heads = ["关卡 / 阶段", "开局数量", "目标存量", "前压概率", "配置最深行"];
      rows = [
        ...new Set([1, Math.min(first.bossEvery, first.total), first.total]),
      ].flatMap((index) =>
        [1, draft.stagePrepTurns].map((round, i) => {
          const p = pressureProfile(draft, index, round);
          return [
            `第${index}关 · ${i ? "末段" : "开局"}`,
            i ? "—" : fmt(p.openingCount),
            fmt(p.target),
            fmt(p.frontChance * 100) + "%",
            "第" + fmt(i ? p.depth : p.openingDepth) + "行",
          ];
        }),
      );
      $("balanceChartHelp").textContent =
        "配置最深行仍受怪物推进速度、应对出手数与真实空位限制。上方图表与实战共用补压公式；前压先按区域抽签，再选区域内可用格子。右侧参数保留独立草稿，应用或重开后才影响游戏；补怪方式与开局参数在下一关采样。";
    } else if (
      stageSubject === "supply" &&
      draft.stageSupplyMode === "adaptive"
    ) {
      description =
        "动态模式按战场缺口与上一刀击杀补怪。这里的“压力成长回合数”决定目标存量、前压概率和HP达到末段数值的速度；普通预算投完即可迎来首领，不再空等固定回合。每关击败首领并清理残兵后过关。";
      metrics = [
        ["压力成长到末段", fmt(draft.stagePrepTurns) + " 回合"],
        ["第一关普通敌人预算", fmt(draft.stage1Budget)],
        ["第二关普通敌人预算", fmt(draft.stage2Budget)],
        ["全场上限 · 当前草稿", fmt(draft.enemyCap)],
      ];
      heads = [
        "关卡",
        "压力回合",
        "目标存量",
        "新怪HP",
        "前压概率",
        "后续最深行",
      ];
      rows = [1, 2].flatMap((index) =>
        Array.from({ length: draft.stagePrepTurns }, (_, i) => {
          const p = pressureProfile(draft, index, i + 1);
          return [
            "第" + index + "关",
            fmt(i + 1),
            fmt(p.target),
            fmt(stageEnemyHp(draft, index, i + 1)),
            fmt(p.frontChance * 100) + "%",
            fmt(p.depth),
          ];
        }),
      );
      $("balanceChartHelp").textContent =
        "此表是压力目标，不是每波固定生成数量。切换上方“关卡布阵与补压”可试算清屏40只后补30只，并查看逐行入场概率。实际供给取决于存活、击杀、预算、上限和安全空位；HP不跟随当前ATK追涨，已生成怪物不重算。预算与压力成长时长在下一关采样。";
    } else if (stageSubject === "supply") {
      const plans = [stagePlan(draft, 1), stagePlan(draft, 2)],
        originals = [stagePlan(base, 1), stagePlan(base, 2)];
      description =
        "有限敌人供给表与实战共用公式。每关达到供给回合且普通预算全部投放后，首领等待空位入场，可与残存普通怪同时在场。击败首领并清理残兵后过关；第二关继承构筑、经验、金币和生命。";
      metrics = [
        ["供给回合 · 当前草稿", fmt(draft.stagePrepTurns)],
        ["第一关普通敌人预算", fmt(draft.stage1Budget)],
        ["第二关普通敌人预算", fmt(draft.stage2Budget)],
        ["全场上限 · 当前草稿", fmt(draft.enemyCap)],
      ];
      heads = [
        "关卡",
        "供给回合",
        "计划数量",
        "累计计划",
        "新怪HP",
        "打开时数量",
      ];
      rows = plans.flatMap((plan, i) =>
        plan.map((r, j) => [
          "第" + (i + 1) + "关",
          fmt(r.round),
          fmt(r.planned),
          fmt(r.cumulative),
          fmt(r.hp),
          fmt(originals[i][j]?.planned),
        ]),
      );
      $("balanceChartHelp").textContent =
        "当前草稿供给计划，不是当前场内存量预测。实际生成还受全场上限、入口空位与本关剩余预算限制。拥堵时延期，未投放预算保留，不会到固定回合自动清场。HP只按关卡和供给回合计算，不随当前ATK抬高；旧怪不重算。关卡预算和供给回合在下一关采样，也可应用并重开立即测试。怪物大小仍在普通调参台的Boss表现中调整。";
    } else if (stageSubject === "combo") {
      description =
        "只在长关卡模式结算：命中不直接发经验，每次击杀按当时连击倍率发经验。各奖励相加后受总倍率上限限制；同一次出刀结束后清零。";
      metrics = [
        ["基础击杀经验 · 当前草稿", fmt(draft.xpDrop)],
        ["总倍率上限 · 当前草稿", "×" + fmt(draft.comboMaxMultiplier)],
        ["快杀允许间隔", fmt(draft.comboFastWindow) + " 秒"],
        ["示例第5次连续快杀", "×" + fmt(comboMultiplier(draft, 5, 5, 5))],
      ];
      heads = [
        "同轮目标数 / 击杀数",
        "仅不同目标命中",
        "连杀（无快杀）",
        "连续快杀总倍率",
        "该次普通击杀经验",
        "打开时快杀倍率",
      ];
      rows = Array.from({ length: 12 }, (_, i) => {
        const count = i + 1,
          multiplier = comboMultiplier(draft, count, count, count);
        return [
          count,
          "×" + fmt(comboMultiplier(draft, count, 1, 1)),
          "×" + fmt(comboMultiplier(draft, count, count, 1)),
          "×" + fmt(multiplier),
          fmt(draft.xpDrop * multiplier),
          "×" + fmt(comboMultiplier(base, count, count, count)),
        ];
      });
      $("balanceChartHelp").textContent =
        "当前草稿示例：每次击杀都命中一个新的目标；快杀列假定相邻击杀均落在快杀时间窗内。并非累计经验或命中率预测。倍率与游戏共用comboMultiplier，基础经验取升级节奏中的每怪经验；瞄准、暂停与升级选择不消耗战斗计时。关闭所有加成后为基础经验。";
    } else if (stageSubject === "fortress") {
      description =
        "普通怪放大的堡垒巨兽，慢速推进。循环进入普通期、蓄力减伤期和破绽期，玩家可选择集中输出的时机。";
      metrics = [
        [
          "首领HP · 当前草稿",
          fmt(
            campaignPlan(draft).find((p) => p.bossKind === "fortress")
              ?.bossHp ?? draft.bossFortressHp,
          ),
        ],
        [
          "推进节奏",
          "每" +
            fmt(draft.bossFortressMoveEvery) +
            "轮 / " +
            fmt(draft.bossFortressAdvance) +
            "格",
        ],
        ["击杀基础经验", fmt(draft.bossFortressXp)],
        ["全场上限 · 当前草稿", fmt(draft.enemyCap)],
      ];
      heads = [
        "循环阶段",
        "持续回合 · 草稿",
        "承伤倍率 · 草稿",
        "打开时持续回合",
      ];
      rows = [
        [
          "普通",
          fmt(draft.bossFortressNormalTurns),
          "×1",
          fmt(base.bossFortressNormalTurns),
        ],
        [
          "蓄力",
          fmt(draft.bossFortressChargeTurns),
          "×" + fmt(draft.bossFortressChargeFactor),
          fmt(base.bossFortressChargeTurns),
        ],
        [
          "破绽",
          fmt(draft.bossFortressWeakTurns),
          "×" + fmt(draft.bossFortressWeakFactor),
          fmt(base.bossFortressWeakTurns),
        ],
      ];
      $("balanceChartHelp").textContent =
        "当前草稿阶段参数表，不是预估通关率或输出曲线。首领突破底线会失败。Boss承受百分比HP伤害系数在关卡供给中调整；此系数只影响道具公式中的目标HP部分，不削减刀伤部分。修改HP不重算已生成的首领，可重开或等下一次生成。";
    } else {
      description =
        "速度怪放大的召唤领主：自身慢速推进，蓄力后召唤小型快速怪冲线，然后进入恢复期；本体不冲刺。";
      metrics = [
        [
          "首领HP · 当前草稿",
          fmt(
            campaignPlan(draft).find((p) => p.bossKind === "summoner")
              ?.bossHp ?? draft.bossSummonerHp,
          ),
        ],
        ["每关召唤总预算 · 草稿", fmt(draft.bossSummonBudget)],
        ["召唤小怪存活上限 · 草稿", fmt(draft.bossSummonCap)],
        ["全场上限 · 当前草稿", fmt(draft.enemyCap)],
      ];
      heads = ["行为 / 属性", "当前草稿", "打开时配置"];
      rows = [
        [
          "蓄力回合",
          fmt(draft.bossSummonChargeTurns),
          fmt(base.bossSummonChargeTurns),
        ],
        ["每批召唤数量", fmt(draft.bossSummonCount), fmt(base.bossSummonCount)],
        [
          "恢复回合",
          fmt(draft.bossSummonRestTurns),
          fmt(base.bossSummonRestTurns),
        ],
        [
          "小怪HP",
          fmt(
            campaignPlan(draft).find((p) => p.bossKind === "summoner")
              ?.summonHp ?? draft.bossSummonHp,
          ),
          fmt(
            campaignPlan(base).find((p) => p.bossKind === "summoner")
              ?.summonHp ?? base.bossSummonHp,
          ),
        ],
        [
          "小怪推进格数",
          fmt(draft.bossSummonAdvance),
          fmt(base.bossSummonAdvance),
        ],
        [
          "本体推进间隔 / 格数",
          fmt(draft.bossSummonerMoveEvery) +
            "轮 / " +
            fmt(draft.bossSummonerAdvance) +
            "格",
          fmt(base.bossSummonerMoveEvery) +
            "轮 / " +
            fmt(base.bossSummonerAdvance) +
            "格",
        ],
      ];
      $("balanceChartHelp").textContent =
        "当前草稿行为参数表。每批实际召唤同时受剩余总预算、召唤小怪存活上限、全场上限和可用入口位置限制，不能无限生成。总预算在下一关采样；当前首领和小怪HP不追溯重算。可应用并重开测试完整周期。";
    }
    $("balanceStagePreview").innerHTML =
      "<p><strong>当前草稿模式：" +
      mode +
      "</strong></p><p>" +
      description +
      '</p><p class="bl-live">' +
      liveStatus +
      "</p>";
    $("balanceMetrics").innerHTML = metrics
      .map(
        ([label, value]) =>
          "<div><small>" +
          label +
          "</small><strong>" +
          value +
          "</strong></div>",
      )
      .join("");
    $("balanceTable").innerHTML =
      "<thead><tr>" +
      heads.map((h) => "<th>" + h + "</th>").join("") +
      "</tr></thead><tbody>" +
      rows
        .map(
          (row) =>
            "<tr>" + row.map((v) => "<td>" + v + "</td>").join("") + "</tr>",
        )
        .join("") +
      "</tbody>";
    renderPressurePreview();
  }
  function refresh(forms = true) {
    for (const b of root.querySelectorAll("[data-btab]")) {
      b.classList.toggle("active", b.dataset.btab === tab);
      b.setAttribute("aria-pressed", String(b.dataset.btab === tab));
    }
    $("balanceChart").toggleAttribute("hidden", tab === "stages");
    $("balanceScenario").hidden = tab === "stages";
    $("balanceLegend").hidden = tab === "stages";
    $("balanceStagePreview").hidden = tab !== "stages";
    $("balancePressurePreview").hidden =
      tab !== "stages" || stageSubject !== "formation";
    $("balanceEyebrow").textContent =
      tab === "xp"
        ? "PROGRESSION / 不让成长突然停下来"
        : tab === "skills"
          ? "BUILD / 每次选择带来多少提升"
          : tab === "pressure"
            ? "PRESSURE / 怪物与成长同步"
            : tab === "stages"
              ? "STAGES / 有限供给、击杀成长与双首领"
              : "ECONOMY / 奖励、消费与爆发";
    $("balanceTitle").textContent =
      tab === "xp"
        ? "把升级节奏放在一条线上"
        : tab === "skills"
          ? skillLabels[skill]
          : tab === "pressure"
            ? pressure === "spawn"
              ? "生成节奏与全场容量"
              : "怪物血量与击杀压力"
            : tab === "stages"
              ? stageGroups[stageSubject]
              : shopItems[item].name + "价格";
    $("balanceKillsLabel").hidden = tab !== "xp";
    $("balanceGentle").hidden = tab !== "xp";
    $("balancePoints").hidden = !profile();
    if (forms) {
      $("balanceSelector").replaceChildren();
      if (["skills", "economy", "pressure", "stages"].includes(tab)) {
        const select = document.createElement("select");
        select.id = "balanceSubject";
        select.setAttribute(
          "aria-label",
          tab === "skills"
            ? "选择技能"
            : tab === "pressure"
              ? "选择怪物平衡项目"
              : tab === "stages"
                ? "选择关卡平衡项目"
                : "选择商店商品",
        );
        const options =
          tab === "skills"
            ? skillLabels
            : tab === "pressure"
              ? { hp: "血量与击杀压力", spawn: "生成数量与全场上限" }
              : tab === "stages"
                ? stageGroups
                : Object.fromEntries(
                    Object.entries(shopItems).map(([k, v]) => [k, v.name]),
                  );
        for (const [v, t] of Object.entries(options)) {
          const option = document.createElement("option");
          option.value = v;
          option.textContent = t;
          select.append(option);
        }
        select.value =
          tab === "skills"
            ? skill
            : tab === "pressure"
              ? pressure
              : tab === "stages"
                ? stageSubject
                : item;
        select.onchange = () => {
          if (tab === "skills") skill = select.value;
          else if (tab === "pressure") pressure = select.value;
          else if (tab === "stages") stageSubject = select.value;
          else item = select.value;
          refresh();
        };
        $("balanceSelector").append(select);
      }
      renderFields();
    }
    chart();
    reflectActions();
  }
  function toPoints(id) {
    const values = Object.fromEntries(
      curveProfiles[id].xs.map((x, i) => [
        id + "CurveP" + i,
        Math.min(100000, curveValue(draft, id, x)),
      ]),
    );
    draft = mergeBalance(draft, { ...values, [id + "CurveMode"]: "points" });
  }
  $("balanceChart").onpointerdown = (e) => {
    const point = e.target.closest("[data-point]"),
      id = profile();
    if (!point || !id) return;
    e.preventDefault();
    const before = selectBalance(draft);
    if (draft[id + "CurveMode"] !== "points") toPoints(id);
    drag = {
      id,
      index: Number(point.dataset.point),
      maxY: Number($("balanceChart").dataset.maxY),
      before,
    };
    $("balanceChart").setPointerCapture(e.pointerId);
    renderFields();
  };
  $("balanceChart").onpointermove = (e) => {
    if (!drag) return;
    const py = new DOMPoint(e.clientX, e.clientY).matrixTransform(
      $("balanceChart").getScreenCTM().inverse(),
    ).y;
    const precision = drag.id === "damage" ? 100 : 1;
    const value = Math.max(
      curveProfiles[drag.id].min ?? 1,
      Math.min(
        100000,
        Math.round(((260 - py) / 220) * drag.maxY * precision) / precision,
      ),
    );
    edit({ [drag.id + "CurveP" + drag.index]: value });
    const input = $("bal-" + drag.id + "CurveP" + drag.index);
    if (input) input.value = value;
  };
  const finishDrag = () => {
    if (drag) {
      drag = null;
      refresh();
    }
  };
  $("balanceChart").onpointerup = finishDrag;
  $("balanceChart").onpointercancel = () => {
    if (drag) {
      draft = mergeBalance(draft, drag.before);
      drag = null;
      refresh();
    }
  };
  $("balanceChart").onkeydown = (e) => {
    const point = e.target.closest("[data-point]"),
      id = profile();
    if (!point || !id || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const index = Number(point.dataset.point),
      key = id + "CurveP" + index;
    if (draft[id + "CurveMode"] !== "points") toPoints(id);
    edit({
      [key]: Math.max(
        curveProfiles[id].min ?? 1,
        Math.min(
          100000,
          draft[key] + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1),
        ),
      ),
    });
    renderFields();
    $("balanceChart").querySelector(`[data-point="${index}"]`)?.focus();
  };
  for (const b of root.querySelectorAll("[data-btab]"))
    b.onclick = () => {
      tab = b.dataset.btab;
      horizon = tab === "xp" ? 30 : tab === "pressure" ? 60 : 10;
      $("balanceHorizon").value = horizon;
      refresh();
    };
  $("balanceHorizon").onchange = () => {
    horizon = Math.max(
      5,
      Math.min(100, Math.round(Number($("balanceHorizon").value) || 30)),
    );
    $("balanceHorizon").value = horizon;
    chart();
  };
  $("balanceKills").onchange = () => {
    kills = Math.max(0.1, Math.min(20, Number($("balanceKills").value) || 1));
    $("balanceKills").value = kills;
    chart();
  };
  $("balanceGentle").onclick = () => {
    const unit = Math.max(1, draft.xpDrop);
    edit({
      xpCurveMode: "formula",
      xpBase: Math.min(100, 4 * unit),
      xpGrowth: Math.min(20, unit),
      xpCurvePower: 0.5,
      xpCurveMax: 12 * unit,
    });
    refresh();
    note(
      "平缓升级实验已写入草稿：提高开场门槛，放慢后期增长；尚未应用。虚线保留打开时配置。",
    );
  };
  $("balancePoints").onclick = () => {
    if (profile()) {
      toPoints(profile());
      refresh();
      note("已按当前曲线采样控制点（单点最高100000），可拖动或输入节点数值。");
    }
  };
  $("balanceRestore").onclick = () => {
    draft = structuredClone(base);
    pending = {};
    refresh();
    note("已还原打开时的数值，当前游戏未改变。");
  };
  function download(data, name) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("balanceExport").onclick = () =>
    download(
      { balanceVersion: 1, values: selectBalance(draft) },
      "飞刀弹弹乐-平衡参数.json",
    );
  $("balanceImport").onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error("平衡JSON不能超过1MiB");
      const data = JSON.parse(await file.text());
      if (data.balanceVersion !== 1) throw new Error("平衡参数版本不支持");
      draft = mergeBalance(draft, data.values);
      refresh();
      note("已导入草稿，尚未应用到游戏。");
    } catch (error) {
      note(error.message);
    } finally {
      e.target.value = "";
    }
  };
  async function commit(restart) {
    try {
      await apply(selectBalance(draft), {
        restart,
        save: $("balancePersist").checked,
      });
      base = structuredClone(draft);
      pending = {};
      root.close();
    } catch (e) {
      note(e.message);
    }
  }
  $("balanceApply").onclick = () => commit(false);
  $("balanceRestart").onclick = () => commit(true);
  $("balanceClose").onclick = () => root.close();
  root.addEventListener("close", () => {
    if (base && draft) pending = changes();
    drag = null;
    onClose?.();
  });
  return {
    get isOpen() {
      return root.open;
    },
    open() {
      if (root.open) return;
      onOpen?.();
      base = structuredClone(getConfig());
      draft = mergeBalance(base, pending);
      kills = Math.max(0.1, base.spawnCount);
      $("balanceKills").value = kills;
      refresh();
      root.showModal();
      note(
        Object.keys(pending).length
          ? "已恢复未应用草稿，虚线为本次打开时的配置。"
          : "草稿只影响图表。应用到当前局需在瞄准回合；已有怪物HP和累积奖励不重算。",
      );
    },
  };
}
