import "./language-ui.mjs";
import { t, getLocale, localize } from "./i18n.mjs";
import { officialConfig } from "./official-config.mjs";
import {
  applyTuningCandidate,
  tuningCandidates,
} from "./tuning-candidates.mjs";
import { setupReleaseLab } from "./release-lab.mjs";
import { setupStartScreen } from "./start-screen.mjs";
import { setupAudioLab, audioKeys } from "./audio-lab.mjs";
import {
  syncMusic,
  loadAudioLibrary,
  snapshotAudioAssets,
  importAudioAssets,
} from "./audio-assets.mjs";
import {
  createSettingsPackage,
  validateSettingsPackage,
  prepareSettingsAudio,
  SETTINGS_KIND,
} from "./settings-package.mjs";
import { validateReleasePackage, RELEASE_KIND } from "./release-package.mjs";
import { updateStageUI } from "./stage-ui.mjs";
import { playCombatCue } from "./combat-feedback.mjs";
import { StagePresentation, playStageCue } from "./stage-presentation.mjs";
import { setupBalanceLab, mergeBalance } from "./balance-lab.mjs";
import { damageAt, permanentDamageAt } from "./balance-model.mjs";
import { shopEffect } from "./shop.mjs";
import { UpgradeFeedback, playLevelUp } from "./upgrade-feedback.mjs";
import { Game, upgrades } from "./core.mjs";
import { syncBarrage } from "./barrage.mjs";
import {
  schema,
  defaults,
  validate,
  exportConfig,
  presets,
} from "./config.mjs";
import { Assets } from "./assets.mjs";
import { setupShop } from "./shop-ui.mjs";
import { turnProgress } from "./knife-motion.mjs";
import { setupThemeLab } from "./theme-lab.mjs";
import { Renderer } from "./render.mjs";
import { setupMaskEditor } from "./mask-editor.mjs";
import { arenaFit, arenaPoint } from "./arena-layout.mjs";
import { knife3DStatus } from "./knife-3d.mjs";
import { setupPresetLibrary } from "./preset-library.mjs";
import { pickupTypes } from "./field-rules.mjs";
import { entityTypes } from "./entity-effects.mjs";
const $ = (s) => document.getElementById(s),
  storageKey = "knife-club.config.v1";
let config = validate(officialConfig).config,
  startupError = "",
  dirty = false,
  paused = false,
  settingsTransferBusy = false,
  aiming = false,
  hoverPointer = null,
  angle = -Math.PI / 2,
  preset = "basic";
try {
  const saved = localStorage.getItem(storageKey);
  if (saved) {
    config = validate(JSON.parse(saved)).config;
    preset = "custom";
  }
} catch (e) {
  startupError = `保存配置读取失败，已使用默认值：${e.message}`;
}
if (new URLSearchParams(location.search).get("scene") === "crystal") {
  config = { ...config, ...presets.crystal.values };
  preset = "crystal";
  dirty = true;
}
if (new URLSearchParams(location.search).get("mode") === "stages") {
  config.gameMode = "stages";
  dirty = true;
}
const combatURL = new URL(location.href);
if (["turn", "realtime"].includes(combatURL.searchParams.get("combat"))) {
  config.combatMode = combatURL.searchParams.get("combat");
  dirty = true;
  combatURL.searchParams.delete("combat");
  history.replaceState(null, "", combatURL);
}
const tuningCandidate = combatURL.searchParams.get("tuning");
if (Object.hasOwn(tuningCandidates, tuningCandidate)) {
  config = validate({
    schemaVersion: 1,
    config: applyTuningCandidate(config, tuningCandidate),
  }).config;
  // A preview link is a one-time import. Keeping it in the URL would override
  // the player's saved adjustments on every refresh.
  combatURL.searchParams.delete("tuning");
  history.replaceState(null, "", combatURL);
  preset = "custom";
  dirty = true;
  document.title +=
    tuningCandidate === "workbuddy-r4-early"
      ? " · R4 前期放缓测试"
      : " · R4 数值测试";
}
let game = new Game(config);
const assets = new Assets(),
  renderer = new Renderer($("arena"), assets);
const startScreen = setupStartScreen({ onStart: () => renderer.unlock() });
// Load audio alongside theme images; keep a handled promise until startup finishes.
const startupAudio = loadAudioLibrary().then(
  () => null,
  (error) => error,
);
const upgradeFeedback = new UpgradeFeedback($("overlay"), (c) =>
  playLevelUp(renderer.audio, c),
);
const stagePresentation = new StagePresentation($("stageScreen"), assets, {
  next: () => {
    if (game.nextStage()) {
      renderer.resetEffects();
      lastOverlay = null;
      stagePresentation.sync(game);
    }
  },
  restart: () => reset(),
  endless: () => {
    config.gameMode = "endless";
    reset();
    buildFields($("search").value);
    changed();
  },
  sound: (kind, c) => {
    renderer.unlock();
    playStageCue(renderer.audio, c, kind);
  },
});
$("stageRouteButton").onclick = () => {
  aiming = false;
  stagePresentation.openRoute();
};
let toastTimer;
function toast(message) {
  $("toast").dataset.i18n = message;
  $("toast").textContent = t(message);
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 4500);
}
let themeLab, balanceLab, audioLab, releaseLab;
try {
  themeLab = await setupThemeLab(assets, toast);
} catch (e) {
  toast(`主题系统加载失败：${e.message}，使用默认素材`);
  try {
    await assets.load();
    $("artState").textContent = assets.errors.length
      ? `后备素材缺图：${assets.errors.join("；")}`
      : "正式素材已加载 · 后备清单";
  } catch {
    $("artState").textContent = "素材清单不可用 · 几何占位仍可试玩";
  }
  $("themeState").textContent = "主题系统不可用，请检查主题目录后刷新";
}
if (startupError) toast(startupError);
if (Object.hasOwn(tuningCandidates, tuningCandidate))
  toast(
    tuningCandidate === "workbuddy-r4-early"
      ? "已加载 R4 前期放缓数值，未覆盖保存的参数"
      : "已加载 WorkBuddy R4 临时数值，未覆盖保存的参数",
  );
const shopUI = setupShop(
  () => game,
  toast,
  () => {
    aiming = false;
  },
);
function changed() {
  dirty = true;
  $("saveState").textContent =
    "● 参数已修改，尚未保存。重开项需点“应用并重开”。";
}
function liveConfig() {
  for (const [key, s] of Object.entries(schema))
    if (s.when !== "重开") game.config[key] = config[key];
  syncBarrage(game);
}
const maskEditor = setupMaskEditor({
  assets,
  getConfig: () => config,
  change: (values) => {
    config = { ...config, ...values };
    liveConfig();
    changed();
  },
  save: () => {
    $("save").click();
    return !dirty;
  },
  close: () => buildFields($("search").value),
});
function reset() {
  shopUI.close();
  stagePresentation.hide();
  game = new Game(config);
  renderer.resetEffects();
  upgradeFeedback.reset();
  paused = false;
  aiming = false;
  angle = -Math.PI / 2;
  lastOverlay = null;
  $("pause").textContent = "Ⅱ 暂停";
}
$("gameModeChoice").onchange = () => {
  config.gameMode = $("gameModeChoice").value;
  reset();
  buildFields($("search").value);
  changed();
  toast(
    config.gameMode === "stages"
      ? "关卡远征已开始 · 清理来敌，逐关成长，迎战首领"
      : "已切换到无尽挑战",
  );
};
$("combatModeChoice").onchange = () => {
  config.combatMode = $("combatModeChoice").value;
  changed();
};
$("realtimeDensityQuick").onchange = (event) => {
  try {
    const value = Number(event.target.value);
    config = validate({
      schemaVersion: 1,
      config: { ...config, realtimeDensity: value },
    }).config;
    liveConfig();
    changed();
    buildFields($("search").value);
  } catch (error) {
    event.target.value = config.realtimeDensity;
    toast(error.message);
  }
};
$("applyCombatMode").onclick = () => {
  reset();
  changed();
  closeDebug();
  toast(
    game.isRealtime
      ? "实时模式已开始 · 每次点击发射一把"
      : "已恢复伪回合制 · 每刀结算后怪物推进",
  );
};
function setText(id, text) {
  const value = t(text);
  if ($(id).textContent !== value) $(id).textContent = value;
}
let animationType = "normal";
function buildFields(filter = "") {
  $("fields").replaceChildren();
  const animationGroup = "怪物动画 · 单怪设置";
  const matches = ([key, s]) =>
    key !== "combatMode" &&
    !s.balanceOnly &&
    !audioKeys.has(key) &&
    `${key}${s.label}${s.group}`.toLowerCase().includes(filter.toLowerCase());
  const animationMatches = Object.entries(schema).filter(
    (entry) => entry[1].entityType && matches(entry),
  );
  if (
    animationMatches.length &&
    !animationMatches.some(([, s]) => s.entityType === animationType)
  )
    animationType = animationMatches[0][1].entityType;
  const groups = [
    ...new Set(
      Object.values(schema).map((s) =>
        s.entityType ? animationGroup : s.group,
      ),
    ),
  ];
  for (const group of groups) {
    const isAnimation = group === animationGroup;
    const items = Object.entries(schema).filter((entry) =>
      isAnimation
        ? animationMatches.length && entry[1].entityType === animationType
        : entry[1].group === group && matches(entry),
    );
    if (!items.length) continue;
    const section = document.createElement("details");
    section.className = "debug-section";
    section.open =
      !!filter ||
      group.startsWith("实时模式") ||
      group.startsWith("弹幕与完美防御") ||
      ["飞刀", "物理实验"].includes(group);
    const sum = document.createElement("summary");
    sum.textContent = `${group} · ${items.length}`;
    section.append(sum);
    if (group.startsWith("弹幕与完美防御")) {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        "仅实时制。飞行中的飞刀可以击落敌方子弹，不消耗飞刀本身；可关闭下方开关对比。空格或右下角防御按钮从底部发出光波；最初完美阶段碰到子弹会向上反弹，后续光波推进并淡出，只抵挡子弹。可切回固定屏障对比：固定模式使用原持续时间和完美窗口，光波使用独立参数。冷却从释放起计，长按不连发。";
      const demo = document.createElement("button");
      demo.id = "barragePractice";
      demo.textContent = "创建三射手测试场（切实时 / 重开）";
      demo.onclick = () => {
        config.combatMode = "realtime";
        config.barrageOn = true;
        reset();
        game = new Game({ ...config, gameMode: "endless" });
        game.barrage.training = true;
        game.enemies = [];
        game.pickups = [];
        game.phase = "aim";
        const cols = [0.2, 0.5, 0.8].map((x) =>
          Math.min(config.cols - 1, Math.floor(config.cols * x)),
        );
        cols.forEach((col, index) => {
          const enemy = game.addEnemy(
            col,
            Math.min(config.rows - 3, 1 + index),
            game.stats.damage * 8,
            "shooter",
          );
          enemy.shootCooldown = Math.max(
            0.2,
            config.shooterFirstDelayMin + index * config.shooterTelegraph,
          );
          enemy.shootInterval = enemy.shootCooldown;
        });
        renderer.resetEffects();
        lastOverlay = null;
        changed();
        if (!wide.matches) closeDebug();
        toast("格挡测试场：空格 / 右下角按钮；不补怪，重开返回正常对局。");
      };
      section.append(note, demo);
    }
    if (group.startsWith("实时模式")) {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        "推进倍率1为原速，0.5为半速，2为两倍；0只让怪物停止前进，飞刀和补怪时钟仍运行。电脑停靠调参可直接观察变化，需要静止检查时点战场下方“暂停”；手机关闭调试台后继续。";
      section.append(note);
      const supplyNote = document.createElement("p");
      supplyNote.className = "small";
      supplyNote.textContent =
        "自适应补怪开启时，清空战场后快速接波；击杀后存量低于目标比例也会提前补怪，0.35代表35%。仍受本关总量和同屏上限约束。基础周期独立控制Boss行动和道具倒计时，提前补怪不会加速它们。关闭自适应可对比原固定间隔。";
      section.append(supplyNote);
    }
    if (group === "炸弹爆炸动画") {
      const preview = document.createElement("button");
      preview.id = "previewBombAtlas";
      preview.textContent = "预览炸弹爆炸叠加动画";
      preview.onclick = () => {
        game.emit("explode", game.width / 2, game.height / 2, {
          radius: game.config.bombRadius * game.config.cell,
        });
        if (!wide.matches) closeDebug();
        toast("已预览爆炸；若游戏已暂停，请继续后播放。需开启战斗特效总开关。");
      };
      section.append(preview);
    }
    if (group === "关卡界面与反馈") {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        "关卡模式专用。预览暂停当前战场，关闭后继续；结算预览使用当前真实战绩，不发奖、不跳关。";
      section.append(note);
      for (const [kind, label] of [
        ["intro", "预览入关界面"],
        ["boss", "预览首领警报"],
        ["result", "预览通关结算"],
      ]) {
        const button = document.createElement("button");
        button.id = `previewStage-${kind}`;
        button.textContent = label;
        button.onclick = () => {
          if (!stagePresentation.previewScene(kind, game)) {
            toast("先将游戏模式切换为关卡远征，再预览关卡界面");
            return;
          }
          aiming = false;
          if (!wide.matches) closeDebug();
        };
        section.append(button);
      }
    }
    if (group === "战斗反馈") {
      const previews = document.createElement("div");
      previews.className = "debug-preview-buttons";
      for (const [kind, label] of Object.entries({
        hit: "命中",
        kill: "击杀",
        bounce: "反弹",
        pin: "扎入",
        explode: "爆炸",
        pickup: "拾取",
        recall: "归心",
        whirlwind: "旋风",
        combo: "连击",
      })) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = `预览${label}特效`;
        button.dataset.feedbackPreview = kind;
        button.onclick = () => {
          renderer.unlock();
          renderer.previewFeedback(kind, game, false);
          if (!wide.matches) closeDebug();
        };
        previews.append(button);
      }
      section.append(previews);
    }
    if (group === "怪物入场" || group === "战场增益道具") {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        group === "怪物入场"
          ? "新怪从顶部滑入，落点按三行权重在可用格子中随机分配。权重会归一化；同列已有怪物挡路时仅选其前方空位。入场完毕才可出刀。关闭随机落点可恢复旧行布局。"
          : "碰到即拾取、不截停飞刀：狂热晶石立即加伤并为后续出手充能（默认2次），发射台图标显示剩余次数；雷链晶核立即串联附近敌人；环刃符向四周射刀；爆弹种子让本轮碰到的敌人挂上定时炸弹。炸弹结算后才推进。道具超时消失；关闭移动时也会因怪物占位清理。";
      section.append(note);
      if (group === "战场增益道具") {
        const demo = document.createElement("button");
        demo.id = "demoPickups";
        demo.textContent = "布置四种道具测试局（重开）";
        demo.onclick = () => {
          reset();
          game.enemies = [];
          game.phase = "aim";
          game.pickups = [];
          for (const [i, type] of Object.keys(pickupTypes).entries()) {
            const col = Math.min(
                game.config.cols - 1,
                Math.floor((i * game.config.cols) / 4),
              ),
              row = Math.max(1, game.config.rows - 4);
            game.pickups.push({
              id: ++game.id,
              col,
              row,
              x: (col + 0.5) * game.config.cell,
              y: (row + 0.5) * game.rowHeight,
              type,
              expires: game.round + game.config.pickupLife,
            });
            game.addEnemy(
              col,
              Math.max(0, row - 2),
              damageAt(game.config, 0) * 3,
              "normal",
            );
          }
          toast("已布置四种增益道具，瞄准符文试射；手机关闭调参台后继续。");
        };
        section.append(demo);
      }
    }
    if (group === "飞刀插入蒙版") {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        "刀口贴住怪物可见表面，蒙版只裁刀身。插入深度与隐藏倍率同步推进刀身，飞刀不随怪物呼吸缩放；最少露出比例避免整刀消失。需开启“插刀隐藏插入部分”总开关。关闭本模式可对比旧圆形；旧遮挡编辑器只用于旧模式。";
      const demo = document.createElement("button");
      demo.id = "previewKnifeMask";
      demo.textContent = "布置插入蒙版对比场（重开并暂停）";
      demo.onclick = () => {
        reset();
        game.enemies = [];
        game.phase = "aim";
        game.pickups = [];
        Object.assign(game.config, {
          spawnCount: 0,
          spawnGrowth: 0,
          spawnCurveMode: "formula",
        });
        const types = ["normal", "fast", "bomb"];
        for (let i = 0; i < types.length; i++) {
          const e = game.addEnemy(
            Math.min(game.config.cols - 1, i * 2),
            Math.min(3, game.config.rows - 2),
            100,
            types[i],
          );
          e.stuck = [-Math.PI / 2, 0, Math.PI * 0.65].map((a) => ({
            dx: -Math.cos(a) * e.r * 0.65,
            dy: -Math.sin(a) * e.r * 0.65,
            angle: a,
            scale: 1,
            radius: 0,
            at: -1,
          }));
        }
        for (const [x, y, nx, ny, a] of [
          [game.width * 0.5, 0, 0, -1, -Math.PI / 2],
          [game.width, game.height * 0.55, 1, 0, 0.4],
          [game.width * 0.5, game.height, 0, 1, Math.PI / 2],
          [0, game.height * 0.55, -1, 0, Math.PI + 0.4],
        ])
          game.pins.push({
            x,
            y,
            nx,
            ny,
            angle: a,
            scale: 1,
            radius: 0,
            age: 1,
            corpse: {
              r: game.config.cell * game.config.enemyRadius,
              variant: 0,
              type: "normal",
            },
          });
        paused = true;
        $("pause").textContent = "▶ 继续";
        toast(
          "已布置三种怪物与四墙插刀，当前暂停。切换蒙版、调整插入深度可直接对比；手机关闭调参台查看。",
        );
      };
      section.append(note, demo);
    }
    if (isAnimation) {
      section.id = "enemyAnimationSettings";
      const label = document.createElement("label");
      label.className = "field choice-field";
      const text = document.createElement("span");
      text.textContent = "选择怪物";
      const select = document.createElement("select");
      select.id = "animationEntitySelect";
      select.setAttribute("aria-label", "选择动画调参怪物");
      for (const [value, title] of Object.entries(entityTypes))
        select.add(new Option(title, value));
      select.value = animationType;
      select.onchange = () => {
        animationType = select.value;
        const scroll = $("debug").scrollTop;
        if (!animationMatches.some(([, s]) => s.entityType === animationType))
          $("search").value = "怪物动画";
        buildFields($("search").value);
        $("enemyAnimationSettings").open = true;
        $("animationEntitySelect").focus({ preventScroll: true });
        $("debug").scrollTop = scroll;
      };
      label.append(text, select);
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        "只显示当前怪物的动画参数。切换不会重置数值；修改后统一点击保存参数。";
      section.append(label, note);
    }
    if (group === "怪物动画 · 总开关") {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        "在单怪设置的下拉菜单中选择怪物，再调整待机和死亡效果；道具为预留配置。只改变显示，不改变碰撞和回合节奏。手机关闭调参台才播放，遮挡编辑器保持静止。";
      const preview = document.createElement("button");
      preview.id = "previewEnemyEffects";
      preview.textContent = "新建三怪动画测试局（重开）";
      preview.onclick = () => {
        reset();
        game.enemies = [];
        game.phase = "aim";
        game.pickups = [];
        for (const [i, type] of ["normal", "fast", "bomb"].entries()) {
          game.addEnemy(
            Math.min(game.config.cols - 1, i * 2),
            Math.min(2, game.config.rows - 2),
            10,
            type,
          );
        }
        toast("已新建三怪测试局；手机请关闭调参台观察。参数和存档未改变。");
      };
      const kill = document.createElement("button");
      kill.id = "previewEnemyDeaths";
      kill.textContent = "测试死亡：向右上击倒场上怪物";
      kill.onclick = () => {
        if (game.phase !== "aim")
          return toast("请等本回合结束再测试死亡效果。");
        for (const e of game.enemies)
          game.damageEnemy(e, e.hp, false, { vx: 1, vy: -1 });
        game.enemies = game.enemies.filter((e) => e.hp > 0);
        toast("已触发测试击杀；手机关闭调参台后播放，测试会产生正常击杀奖励。");
      };
      const squid = document.createElement("button");
      squid.id = "previewSquid";
      squid.textContent = "新建鱿鱼序列帧测试局（重开）";
      squid.onclick = () => {
        reset();
        game.enemies = [];
        game.pickups = [];
        game.stage = null;
        game.config.gameMode = "endless";
        game.phase = "aim";
        for (let i = 0; i < 3; i++) {
          const e = game.addEnemy(
            Math.min(game.config.cols - 1, i * 2),
            0,
            10,
            "ultraFast",
          );
          e.entry = null;
        }
        paused = false;
        $("pause").textContent = "Ⅱ 暂停";
        renderer.resetEffects();
        toast(
          "鱿鱼测试局：待机播放30帧，每轮推进3格。可试射或点击测试死亡；未改保存参数。",
        );
      };
      section.append(note, preview, squid, kill);
    }
    if (group === "发射台") {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        "飞刀锚点偏移只移动待发飞刀、瞄准和实际出生点，不移动圆盘与ATK。横向正数向右，纵向负数向上，单位为战场像素；刀尖离圆盘中心距离沿瞄准方向生效。实时制每次一刀；伪回合圆盘按中、左、右交替展开，最多10把齐射。圆盘整体位置用“发射横向位置”和“发射点距底边/格”调整。";
      const preview = document.createElement("button");
      preview.textContent = "开启齐射预览（至少五刀）";
      preview.id = "previewDiscFan";
      preview.onclick = () => {
        config = {
          ...config,
          discLauncher: true,
          launchers: Math.max(config.launchers, 5 - game.buffs.platforms),
          discShowOrder: true,
          aimAlwaysShow: true,
        };
        liveConfig();
        changed();
        buildFields("发射台");
        $("search").value = "发射台";
        toast(
          "已开启圆盘与排列序号；飞刀总数仍叠加当前并锋。待发射时可直接观察，拖动瞄准同步转向。",
        );
      };
      section.append(note, preview);
    }
    if (group === "背景碰撞框") {
      const edit = document.createElement("button");
      edit.textContent = "显示范围并拖动调整背景碰撞框";
      edit.onclick = () =>
        themeLab
          ? themeLab.openArenaEditor()
          : toast("主题工作台暂不可用，请刷新后再试。");
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        "在固定背景上拖动绿色框或八个手柄，关闭后继续游戏。碰撞框随主题保存；下方开关只显示实战参考线。";
      section.append(edit, note);
    }
    if (group === "3D飞刀与统一灯光") {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        "勾选即可在当前局切换；灯光固定在战场方向，0°右、90°下、180°左、270°上。粗糙度越小高光越集中。颜色在主题工作台的战场与特效配色中调整。清晰度和方向数越高越精细，也会增加缓存开销。";
      const status = document.createElement("p");
      status.id = "knife3DState";
      status.className = "small";
      status.setAttribute("role", "status");
      const demo = document.createElement("button");
      demo.id = "knife3DDemo";
      demo.textContent = "布置多角度飞刀对比场（重开并暂停）";
      demo.onclick = () => {
        reset();
        game.enemies = [];
        game.phase = "aim";
        game.pickups = [];
        Object.assign(game.config, {
          spawnCount: 0,
          spawnGrowth: 0,
          spawnCurveMode: "formula",
        });
        game.shotLimit = Math.max(game.config.maxKnives, 12);
        for (let i = 0; i < 12; i++) {
          const a = (i * Math.PI) / 6,
            r = Math.min(game.width, game.height) * 0.3;
          game.spawnKnife(
            game.width / 2 + Math.cos(a) * r,
            game.height * 0.46 + Math.sin(a) * r,
            a,
            game.stats,
            true,
          );
        }
        for (let i = 0; i < 4; i++) {
          const p = (i + 1) / 5;
          game.pins.push(
            { x: game.width * p, y: 0, angle: -Math.PI / 2, scale: 1, age: 1 },
            { x: game.width, y: game.height * p, angle: 0, scale: 1, age: 1 },
            {
              x: game.width * p,
              y: game.height,
              angle: Math.PI / 2,
              scale: 1,
              age: 1,
            },
            { x: 0, y: game.height * p, angle: Math.PI, scale: 1, age: 1 },
          );
        }
        paused = true;
        $("pause").textContent = "▶ 继续";
        toast(
          "多角度对比场已暂停，可切换2D/3D并移动统一灯光；点新一局回到正常试玩。",
        );
      };
      section.append(note, status, demo);
    }
    if (group === "瞄准线") {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        "白蓝光尖刺是直线方向指示（不预测重力曲线），可调长度、根部宽度和发光；圆点轨迹保留物理预览。两种样式共用起点留空、长度上限、透明度及渐隐；光刺不受点距/预览秒数影响，固定白蓝配色。半径、间距、留空和长度单位为战场像素。间距0沿用原自动间距，正数为固定点距；长度上限0由预览秒数决定。开启常显可松手后继续调效果，实际只在待发射阶段显示。渐隐曲线越大，末端淡出越快；圆点颜色沿用主题。圆点轨迹按当前速度/阻力/重力预览至首次触墙。";
      section.append(note);
    }
    if (group === "怪物 HP 标签") {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        "位置与尺寸用战场像素，正数向右/向下。默认从怪物下沿定位，关闭跟随后从怪物中心定位；标签移动底板和数字一起，数字微调只移动文字。底板与数字不透明度独立，0完全透明、1不透明。颜色沿用主题工作台设置。";
      const button = document.createElement("button");
      button.textContent = "布置 HP 对比场（重开）";
      button.onclick = () => {
        reset();
        game.enemies = [];
        game.phase = "aim";
        game.pickups = [];
        Object.assign(game.config, {
          spawnCount: 0,
          spawnGrowth: 0,
          spawnCurveMode: "formula",
        });
        [9, 99, 9999].forEach((hp, i) =>
          game.addEnemy(
            Math.floor(config.cols / 2),
            1 + i * Math.min(2, Math.floor((config.rows - 2) / 2)),
            hp,
          ),
        );
        paused = true;
        $("pause").textContent = "▶ 继续";
        toast("HP 对比场已暂停：9 / 99 / 9999，可实时调整标签并保存参数。");
      };
      section.append(note, button);
    }
    if (group === "怪物大小与层级") {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        "层级越大越靠前。原地活怪与上/右/下/左四面墙的圆形遮挡各自保存，可缩放成椭圆并偏移。正数向右/向下，负数向左/向上；某面墙倍率0仅关闭该墙遮挡。软体凹陷仍为共用参数，不影响碰撞。";
      const actions = document.createElement("div");
      actions.className = "debug-actions";
      const layouts = {
        怪物在前: {
          layerEnemy: 60,
          layerCorpse: 60,
          layerStuckKnife: 40,
          layerWallKnife: 40,
          layerFlyingKnife: 40,
          stuckKnifeMask: false,
        },
        飞刀在前: {
          layerEnemy: 30,
          layerCorpse: 30,
          layerStuckKnife: 60,
          layerWallKnife: 60,
          layerFlyingKnife: 60,
          stuckKnifeMask: false,
        },
        插入遮挡: {
          layerEnemy: 30,
          layerCorpse: 10,
          layerStuckKnife: 40,
          layerWallKnife: 20,
          layerFlyingKnife: 60,
          stuckKnifeMask: true,
        },
      };
      for (const [name, values] of Object.entries(layouts)) {
        const button = document.createElement("button");
        button.textContent = name;
        button.onclick = () => {
          config = { ...config, ...values };
          liveConfig();
          changed();
          buildFields($("search").value);
          toast(`已切换：${name}`);
        };
        actions.append(button);
      }
      const scene = document.createElement("button");
      scene.textContent = "布置遮挡测试场（重开）";
      scene.onclick = loadLayerScene;
      actions.append(scene);
      section.append(note, actions);
    }
    if (group === "万刃归心") {
      const note = document.createElement("p");
      note.className = "small";
      note.textContent =
        "继承开关只影响下次归心：关闭伤害/大小时使用基础值，关闭穿透/反弹时对应次数为0。普通出刀不受影响。";
      section.append(note);
      const curve = document.createElement("div");
      curve.className = "recall-curve";
      curve.innerHTML =
        '<svg id="recallCurve" viewBox="0 0 220 130" role="img" aria-label="转向动画曲线"><path d="M20 10V110H210" fill="none" stroke="currentColor" opacity=".4"/><path d="M20 110L210 10" fill="none" stroke="currentColor" opacity=".25" stroke-dasharray="4 4"/><path id="recallCurvePath" fill="none" stroke="currentColor" stroke-width="3"/></svg><input id="recallCurveSlider" type="range" min="0.25" max="6" step="0.05" aria-label="拖动调整转向曲线"/><p id="recallCurveText" class="small"></p>';
      section.append(curve);
      curve.querySelector("input").oninput = (e) => {
        config = validate({
          schemaVersion: 1,
          config: { ...config, recallTurnPower: Number(e.target.value) },
        }).config;
        liveConfig();
        changed();
        preset = "custom";
        const numberInput = document.querySelector(
          'input[data-key="recallTurnPower"]',
        );
        if (numberInput) numberInput.value = config.recallTurnPower;
        updateRecallCurve();
      };
    }
    for (const [key, s] of items) {
      const label = document.createElement("label");
      label.className = "field";
      if (s.type === "select") label.classList.add("choice-field");
      const text = document.createElement("span");
      text.textContent = s.label;
      const input = document.createElement(
        s.type === "select" ? "select" : "input",
      );
      input.dataset.key = key;
      input.setAttribute("aria-label", s.label);
      if (s.type === "boolean") {
        input.type = "checkbox";
        input.checked = config[key];
      } else if (s.type === "select") {
        for (const [value, title] of Object.entries(s.options))
          input.add(new Option(title, value));
        input.value = config[key];
      } else {
        input.type = "number";
        input.min = s.min;
        input.max = s.max;
        input.step = s.step;
        input.value = config[key];
      }
      const when = document.createElement("small");
      when.textContent = s.when;
      input.addEventListener("change", () => {
        const v =
          s.type === "boolean"
            ? input.checked
            : s.type === "select"
              ? input.value
              : input.valueAsNumber;
        try {
          config = validate({
            schemaVersion: 1,
            config: { ...config, [key]: v },
          }).config;
          liveConfig();
          preset = "custom";
          changed();
          if (key === "recallTurnPower") updateRecallCurve();
        } catch (e) {
          toast(e.message);
          input.value = config[key];
          input.checked = config[key];
        }
      });
      label.append(text, input, when);
      section.append(label);
    }
    $("fields").append(section);
  }
  updateRecallCurve();
}
function updateRecallCurve() {
  if (!$("recallCurvePath")) return;
  const power = config.recallTurnPower;
  $("recallCurvePath").setAttribute(
    "d",
    Array.from(
      { length: 41 },
      (_, i) =>
        `${i ? "L" : "M"}${20 + (i / 40) * 190} ${110 - turnProgress(i / 40, power) * 100}`,
    ).join(" "),
  );
  $("recallCurveSlider").value = power;
  $("recallCurveText").textContent =
    `指数 ${power} · 时间过半时完成 ${(turnProgress(0.5, power) * 100).toFixed(1)}% 转向。横轴时间，纵轴转向进度；1匀速，>1先慢后快，<1先快后慢。时长由“拔刀后瞄准停顿秒数”控制。`;
}
buildFields();
$("crystalTest").onclick = async () => {
  try {
    await themeLab.select("crystal");
    config = { ...config, ...presets.crystal.values };
    preset = "crystal";
    reset();
    changed();
    buildFields($("search").value);
    toast("晶糖试玩已就绪：普通 / 快速 / 爆炸怪。参数与主题可分别保存。");
  } catch (e) {
    toast(`晶糖主题加载失败：${e.message}`);
  }
};
if (dirty) changed();
$("search").oninput = (e) => buildFields(e.target.value);
const presetLibrary = setupPresetLibrary({
  getConfig: () => config,
  toast,
  onDelete: (id) => {
    if (preset === id) preset = "custom";
  },
  apply: (p) => {
    if (p.builtin && p.id === "crystal") {
      $("crystalTest").click();
      return;
    }
    const next = validate({
      schemaVersion: 1,
      config: { ...config, ...p.values },
    }).config;
    const rebuild = Object.entries(schema).some(
      ([k, s]) => s.when === "重开" && next[k] !== game.config[k],
    );
    config = next;
    if (rebuild) reset();
    else liveConfig();
    preset = p.id;
    changed();
    buildFields($("search").value);
    toast(
      p.name +
        "已应用" +
        (rebuild ? "，已按新结构重开" : "，新属性用于后续攻击"),
    );
  },
});
balanceLab = setupBalanceLab({
  getConfig: () => config,
  getGame: () => game,
  onOpen: () => {
    aiming = false;
  },
  onClose: () => {
    if ($("debug").open) {
      $("debug").close();
      openDebug();
    }
    $("openBalanceLab").focus();
  },
  apply: (values, { restart, save }) => {
    const next = mergeBalance(config, values);
    if (
      !restart &&
      ((!game.isRealtime && game.phase !== "aim") ||
        (game.isRealtime && !game.canAim) ||
        Object.entries(schema).some(
          ([k, s]) => s.when === "重开" && next[k] !== game.config[k],
        ))
    )
      throw new Error("当前阶段或结构修改需要重开，请选择应用并重开测试。");
    if (save) {
      try {
        localStorage.setItem(storageKey, exportConfig(next));
      } catch {
        throw new Error(
          "保存失败，原参数保留。可先导出平衡JSON或取消同时保存进行临时测试。",
        );
      }
    }
    config = next;
    preset = "custom";
    if (restart) reset();
    else {
      liveConfig();
      if (!game.isRealtime) game.checkUpgrade();
    }
    if (save) {
      dirty = false;
      $("saveState").textContent = "✓ 平衡参数已保存；手感和表现数值保留。";
    } else changed();
    buildFields($("search").value);
    toast(save ? "平衡参数已应用并保存" : "平衡参数已临时应用，尚未保存");
  },
});
$("openBalanceLab").onclick = () => balanceLab.open();
audioLab = setupAudioLab({
  onExportSettings: () => $("export").click(),
  onImportSettings: () => $("import").click(),
  getConfig: () => config,
  getAudio: (unlock = false) => {
    if (unlock) renderer.unlock();
    return renderer.audio;
  },
  onOpen: () => {
    aiming = false;
    hoverPointer = null;
  },
  onClose: () => {
    $("openAudioLab").focus();
  },
  apply: (values, save) => {
    const next = { ...config, ...values };
    if (save) {
      // Audio save merges into persisted config; unrelated unsaved tuning stays a draft.
      const raw = localStorage.getItem(storageKey);
      const stored = raw
        ? validate(JSON.parse(raw)).config
        : validate(officialConfig).config;
      localStorage.setItem(
        storageKey,
        exportConfig({
          ...stored,
          ...Object.fromEntries([...audioKeys].map((k) => [k, next[k]])),
        }),
      );
    }
    config = next;
    liveConfig();
    if (!save) changed();
  },
});
$("openAudioLab").onclick = () => audioLab.open();
releaseLab = setupReleaseLab({
  getConfig: () => config,
  getGame: () => game,
  snapshotTheme: () => {
    if (!themeLab) throw new Error("主题尚未准备好，无法生成完整发布包");
    return themeLab.snapshot();
  },
  onOpen: () => {
    aiming = false;
    hoverPointer = null;
  },
});
const wide = matchMedia("(min-width: 900px) and (orientation: landscape)");
function externalBlocked() {
  return (
    settingsTransferBusy ||
    startScreen.isBlocking ||
    releaseLab?.isOpen ||
    audioLab?.isOpen ||
    balanceLab?.isOpen ||
    maskEditor.isOpen ||
    themeLab?.arenaEditorOpen ||
    $("shop").open ||
    ($("debug").open && !wide.matches)
  );
}
function playBlocked() {
  return externalBlocked() || stagePresentation.blocking;
}
function syncDebugLayout() {
  const docked = $("debug").open && wide.matches;
  document.body.classList.toggle("debug-docked", docked);
  $("debug").classList.toggle("docked", docked);
  $("tune").setAttribute("aria-expanded", String($("debug").open));
}
function openDebug() {
  if ($("shop").open) return;
  aiming = false;
  if ($("debug").open) return;
  wide.matches ? $("debug").show() : $("debug").showModal();
  syncDebugLayout();
}
function closeDebug() {
  $("debug").close();
  syncDebugLayout();
  $("tune").focus();
}
$("tune").onclick = () => ($("debug").open ? closeDebug() : openDebug());
$("closeDebug").onclick = closeDebug;
$("debug").addEventListener("close", syncDebugLayout);
$("debug").addEventListener("cancel", () => {
  aiming = false;
});
wide.addEventListener("change", () => {
  if (audioLab?.isOpen || balanceLab?.isOpen) {
    syncDebugLayout();
    return;
  }
  if ($("debug").open) {
    $("debug").close();
    openDebug();
  } else syncDebugLayout();
});
$("fullscreen").onclick = async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen)
      await document.documentElement.requestFullscreen();
    else toast("浏览器不支持全屏，当前已适配可用屏幕");
  } catch {
    toast("浏览器未允许全屏，仍可正常试玩");
  }
};
$("save").onclick = () => {
  try {
    localStorage.setItem(storageKey, exportConfig(config));
    dirty = false;
    $("saveState").textContent =
      "✓ 数值已保存，替换音效自动保存在本浏览器。跨浏览器请导出“设置与音效 JSON”。";
    toast("参数已保存");
  } catch (e) {
    toast("保存失败，请用“导出 JSON”保留配置。" + e.message);
  }
};
function download(name, text) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
$("exportNumbers").onclick = () =>
  download("飞刀弹弹乐-手感预设.json", exportConfig(config));
async function runSettingsTransfer(action) {
  if (settingsTransferBusy) return;
  settingsTransferBusy = true;
  aiming = false;
  const controls = [
    ...document.querySelectorAll(
      "#debug button,#debug input,#debug select,#audioLab button,#audioLab input,#audioLab select",
    ),
  ].map((el) => [el, el.disabled]);
  for (const [el] of controls) el.disabled = true;
  try {
    await action();
  } catch (error) {
    $("saveState").textContent = `未完成：${error.message}`;
    toast(`设置迁移失败：${error.message}`);
  } finally {
    for (const [el, disabled] of controls) el.disabled = disabled;
    settingsTransferBusy = false;
  }
}
$("export").onclick = () =>
  runSettingsTransfer(async () => {
    $("saveState").textContent = "正在收集当前参数与真实音效文件…";
    const snapshot = structuredClone(config);
    const bundle = createSettingsPackage({
      config: snapshot,
      audio: await snapshotAudioAssets(),
    });
    download("飞刀弹弹乐-设置与音效.json", JSON.stringify(bundle));
    $("saveState").textContent =
      `已导出 ${Object.keys(bundle.config).length} 项数值、${bundle.audio.filter((row) => row.key !== "music").length} 项音效；背景音乐${bundle.audio.some((row) => row.key === "music") ? "已包含" : "未设置"}。主题美术请使用完整发布包。`;
  });
$("import").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  await runSettingsTransfer(async () => {
    if (file.size > 200 * 1024 * 1024)
      throw new Error("设置文件超过200 MB，请压缩音频后重试。");
    $("saveState").textContent = "正在校验设置并恢复音效…";
    const raw = JSON.parse(await file.text());
    let next,
      audio = [],
      isPortable = false,
      isRelease = false;
    if (raw.kind === SETTINGS_KIND) {
      const bundle = validateSettingsPackage(raw);
      next = bundle.config;
      audio = prepareSettingsAudio(bundle);
      isPortable = true;
    } else if (raw.kind === RELEASE_KIND) {
      const bundle = await validateReleasePackage(raw);
      next = validate({ schemaVersion: 1, config: bundle.config }).config;
      audio = prepareSettingsAudio(
        createSettingsPackage({ config: next, audio: bundle.audio }),
      );
      isPortable = isRelease = true;
    } else {
      if (raw.kind) throw new Error("不支持的设置文件类型");
      next = validate(raw).config;
    }
    if (isPortable) await importAudioAssets(audio);
    config = next;
    liveConfig();
    buildFields();
    changed();
    preset = "custom";
    const audioNote = isPortable
      ? `已保存 ${audio.length} 项音频，文件未包含的音效保留。`
      : "此文件仅含数值，不含音效文件；现有音效未变。";
    $("saveState").textContent =
      `${audioNote}数值已应用，点“保存参数”后刷新保留；结构参数需应用并重开。${isRelease ? "已提取发布包参数与音频，主题美术未切换。" : ""}`;
    toast(
      isPortable
        ? `已导入参数与 ${audio.length} 项音频；保存参数可保留数值。`
        : "已导入纯数值；迁移声音请使用“设置与音效 JSON”。",
    );
  });
  e.target.value = "";
};
$("defaults").onclick = () => {
  if (!confirm("恢复所有参数为默认值？当前局会重新开始，保存的配置暂不覆盖。"))
    return;
  config = validate(officialConfig).config;
  preset = "basic";
  reset();
  changed();
  buildFields();
};
$("applyBoard").onclick = () => {
  reset();
  toast("已按当前全部参数重新开局");
};
$("restart").onclick = () => {
  if (
    game.round > 1 &&
    !confirm(t("开始新一局？当前得分和构筑会清空，参数保留。"))
  )
    return;
  reset();
};
$("retry").onclick = () => {
  if (!game.retry()) {
    toast("先发射一刀，才有可重试的布局");
    return;
  }
  paused = false;
  renderer.resetEffects();
  angle = game.lastAngle || angle;
  toast("已恢复上一刀前：金币、购买次数、经验和构筑均还原");
};
$("pause").onclick = () => {
  paused = !paused;
  setText("pause", paused ? "▶ 继续" : "Ⅱ 暂停");
};
$("step").onclick = () => {
  if (stagePresentation.blocking) {
    toast("请先关闭关卡界面，再单步推进战场");
    return;
  }
  paused = true;
  $("pause").textContent = "▶ 继续";
  game.update(1 / 60);
  renderer.draw(game, angle, false, 1 / 60);
  hud(1 / 60);
};
$("testScene").onclick = () => {
  reset();
  game.enemies = [];
  game.phase = "aim";
  game.pickups = [];
  const col = Math.floor(config.cols / 2);
  for (let row = 1; row < Math.min(5, config.rows - 2); row++)
    game.addEnemy(col, row, damageAt(config, 0) * (row === 4 ? 3 : 1));
  Object.assign(game.config, {
    spawnCount: 0,
    spawnGrowth: 0,
    spawnCurveMode: "formula",
  });
  toast("测试场：中央竖列，上方弱怪、下方高血怪；本场不补怪");
};
function loadLayerScene() {
  reset();
  game.enemies = [];
  game.phase = "aim";
  game.pickups = [];
  const e = game.addEnemy(
    Math.floor(config.cols / 2),
    Math.floor(config.rows / 2),
    100,
  );
  e.stuck = [
    { angle: 0, dx: -e.r * 0.65, dy: 0, scale: 1, at: -1 },
    { angle: Math.PI, dx: e.r * 0.65, dy: 0, scale: 1, at: -1 },
    { angle: -Math.PI / 2, dx: 0, dy: e.r * 0.65, scale: 1, at: -1 },
  ];
  game.pins = [
    {
      x: game.width - 5,
      y: game.height * 0.3,
      nx: 1,
      ny: 0,
      radius: 5,
      angle: 0,
      scale: 1,
      age: 1,
      corpse: { r: e.r, variant: 1 },
    },
  ];
  Object.assign(game.config, {
    spawnCount: 0,
    spawnGrowth: 0,
    spawnCurveMode: "formula",
  });
  paused = true;
  $("pause").textContent = "▶ 继续";
  maskEditor.open();
}
$("addXp").onclick = () => {
  if (!game.canAim) {
    toast("请在瞄准回合添加经验");
    return;
  }
  renderer.unlock();
  game.xp += game.threshold;
  game.checkUpgrade();
};
$("grantRecall").onclick = () => {
  game.buffs.recall = 1;
  toast("已获得万刃归心：正常出刀按概率触发");
};
$("grantPlatform").onclick = () => {
  if (game.volleyCount >= 10) {
    toast(game.isRealtime ? "飞刀储备已达上限 10" : "齐射数量已达上限 10");
    return;
  }
  game.buffs.platforms++;
  toast(
    game.isRealtime
      ? `飞刀储备增加至 ${game.volleyCount} 把`
      : game.config.discLauncher
        ? `圆盘齐射增加至 ${game.volleyCount} 把`
        : `发射台增加至 ${game.launcherCount} 个`,
  );
};
$("demoRecall").onclick = () => {
  if (game.phase !== "aim") {
    toast("请在瞄准回合演示");
    return;
  }
  if (!game.pins.length) {
    for (let i = 0; i < 4; i++) {
      game.pins.push({
        x: 0,
        y: (game.height * (i + 1)) / 5,
        angle: Math.PI,
        scale: 1,
        age: 0,
      });
      game.pins.push({
        x: game.width,
        y: (game.height * (i + 1)) / 5,
        angle: 0,
        scale: 1,
        age: 0,
      });
    }
  }
  game.knifeArt = assets.entries.knife?.meta;
  if (game.isRealtime) {
    // Give the preview a normal magazine owner so the real-time scheduler can
    // advance and retire its recall sequence without orphaned attacks.
    if (!game.fire(angle)) return;
    const shot = game.realtime.shots.at(-1);
    game.knives = game.knives.filter((knife) => knife.shotId !== shot.id);
    game.withShot(shot.id, () => {
      if (!game.recall) game.activateRecall();
    });
  } else {
    game.phase = "flight";
    game.shotKills = 0;
    game.shotCount = 0;
    game.activateRecall();
  }
  toast("正在演示墙刀齐射；关闭调试台后继续");
};
$("addCoins").onclick = () => {
  game.coins += 20;
  toast("金币 +20，可在金币强化中使用");
};
$("artFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    await assets.preview($("assetSlot").value, file);
    $("artState").textContent = `临时预览：${file.name}。刷新后恢复正式清单。`;
    toast("新图片已接入战场，关闭调试台可查看");
  } catch {
    toast("图片读取失败，请使用有效的 PNG / WebP / SVG 图片");
  }
  e.target.value = "";
};
$("reloadArt").onclick = async () => {
  try {
    if (themeLab) await themeLab.reload();
    else await assets.load();
    $("artState").textContent = assets.errors.length
      ? assets.errors.join("；")
      : "正式素材已重新加载";
    toast("已重新读取素材清单");
  } catch (e) {
    toast(e.message);
  }
};
$("phone").onclick = async () => {
  try {
    const info = await (await fetch("/__knife_health")).json();
    alert(
      t(
        `手机与电脑连接同一 Wi-Fi，在手机浏览器打开：\n\n${info.lanUrls.join("\n") || "未找到局域网地址"}\n\n若无法访问，请确认 Windows 防火墙允许 Node 的专用网络连接。参数跨设备用 JSON 导入。`,
      ),
    );
  } catch {
    toast("请通过双击启动器打开，以获取手机访问地址");
  }
};
function point(e) {
  const r = $("arena").getBoundingClientRect();
  return arenaPoint(e, r, game, assets.arena);
}
function aim(e) {
  const p = point(e),
    o = game.aimOrigin;
  angle = game.normalizeAngle(Math.atan2(p.y - o.y, p.x - o.x));
}
$("arena").addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !game.canAim || paused || playBlocked()) return;
  renderer.unlock();
  aiming = true;
  aim(e);
  $("arena").setPointerCapture(e.pointerId);
  e.preventDefault();
});
$("arena").addEventListener("pointermove", (e) => {
  if (e.pointerType === "mouse")
    hoverPointer = { clientX: e.clientX, clientY: e.clientY };
  if (
    (aiming || e.pointerType === "mouse") &&
    game.canAim &&
    !paused &&
    !playBlocked()
  )
    aim(e);
});
$("arena").addEventListener("pointerenter", (e) => {
  if (e.pointerType === "mouse")
    hoverPointer = { clientX: e.clientX, clientY: e.clientY };
});
$("arena").addEventListener("pointerleave", () => {
  hoverPointer = null;
});
window.addEventListener("blur", () => {
  hoverPointer = null;
  aiming = false;
});
$("arena").addEventListener("pointerup", (e) => {
  if (!aiming) return;
  aim(e);
  aiming = false;
  if (!paused && !playBlocked()) {
    game.knifeArt = assets.entries.knife?.meta;
    game.fire(angle);
  }
});
$("arena").addEventListener("pointercancel", () => {
  aiming = false;
});
function tryGuard() {
  if (paused || playBlocked() || document.hidden || !game.canGuard)
    return false;
  renderer.unlock();
  return game.guard();
}
$("guardButton").addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  tryGuard();
});
$("guardButton").addEventListener("click", (e) => {
  // Keyboard/assistive clicks do not have a preceding pointerdown.
  if (e.detail === 0) tryGuard();
});
document.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    if (
      e.target.closest?.("input,textarea,select,[contenteditable='true']") ||
      e.isComposing
    )
      return;
    if (
      !game.isRealtime ||
      !game.config.barrageOn ||
      !game.canAim ||
      paused ||
      playBlocked() ||
      document.hidden
    )
      return;
    e.preventDefault();
    if (!e.repeat) tryGuard();
    return;
  }
  if (
    audioLab?.isOpen ||
    balanceLab?.isOpen ||
    maskEditor.isOpen ||
    themeLab?.arenaEditorOpen
  )
    return;
  if (e.key === "Escape") {
    if ($("shop").open) {
      e.preventDefault();
      shopUI.close();
      return;
    }
    aiming = false;
    if ($("debug").open) closeDebug();
  }
  if (e.key === "F2") {
    e.preventDefault();
    $("debug").open ? closeDebug() : openDebug();
  }
});
let lastOverlay = "",
  lastStats = "",
  lastBuffs = "",
  lastOverlayLocale = "";
function choiceContents(id) {
  const u = upgrades[id];
  const description =
    id === "recall"
      ? t("每次出刀 {chance}% 震起墙刀，瞄准最近敌人齐射", {
          chance: Math.round(game.recallStats.chance * 100),
        })
      : shopEffect(game, id, true);
  return `<em class="skill-icon" data-skill="${id}">${u[2]}</em><b>${t(u[0])} <small>Lv.${game.buffs[id] + 1}</small></b><small>${description}</small>`;
}
function overlayText(node, source) {
  node.dataset.i18n = source;
  node.textContent = t(source);
}
function hud(dt = 0) {
  const guardButton = $("guardButton"),
    barrage = game.barrage;
  guardButton.hidden = !game.isRealtime || !game.config.barrageOn;
  if (!guardButton.hidden && barrage) {
    const active = barrage.guardRemaining > 0;
    const cooling = barrage.guardCooldown > 0;
    guardButton.disabled =
      !game.canGuard || paused || playBlocked() || document.hidden;
    guardButton.dataset.state = active
      ? "active"
      : cooling
        ? "cooldown"
        : "ready";
    guardButton.style.setProperty(
      "--guard-charge",
      String(
        cooling
          ? 1 -
              barrage.guardCooldown / Math.max(0.001, barrage.cooldownDuration)
          : 1,
      ),
    );
    setText(
      "guardLabel",
      active
        ? "防御中"
        : cooling
          ? `${Math.max(0.1, Math.ceil(barrage.guardCooldown * 10) / 10).toFixed(1)}s`
          : "防御",
    );
    setText(
      "guardKey",
      matchMedia("(pointer: fine)").matches ? "SPACE" : "点击防御",
    );
  }
  setText("pause", paused ? "▶ 继续" : "Ⅱ 暂停");
  setText(
    "grantPlatform",
    game.isRealtime
      ? "增加飞刀储备"
      : game.config.discLauncher
        ? "增加飞刀"
        : "增加发射台",
  );
  $("combatModeChoice").value = config.combatMode;
  if (document.activeElement !== $("realtimeDensityQuick"))
    $("realtimeDensityQuick").value = config.realtimeDensity;
  setText(
    "combatModeState",
    `当前：${game.isRealtime ? "实时制" : "伪回合制"}${config.combatMode !== game.config.combatMode ? " · 新选择待应用并重开" : ""}`,
  );
  if ($("knife3DState"))
    setText(
      "knife3DState",
      config.knife3D ? knife3DStatus() : "当前使用2D原始图片",
    );
  shopUI.update();
  setText("score", String(game.score).padStart(4, "0"));
  setText("lives", `${game.lives}`);
  setText("coins", `${game.coins}`);
  setText("level", `LV.${String(game.level).padStart(2, "0")}`);
  setText("xpLabel", `${Number(game.xp.toFixed(2))} / ${game.threshold}`);
  $("xp")
    .closest(".xp-row")
    .classList.toggle("upgrade-pending", !!game.upgradePending);
  updateStageUI(game, dt);
  $("xp").style.width = `${Math.min(100, (game.xp / game.threshold) * 100)}%`;
  setText(
    "round",
    `${game.isRealtime ? "WAVE" : "ROUND"} ${String(game.round).padStart(2, "0")}`,
  );
  const phases = {
    entry: "怪物入场",
    aim: "你的回合",
    flight: "飞刀结算中",
    advance: "怪物前进",
    upgrade: "选择强化",
    over: "防线失守",
    stageClear: "本关完成",
    victory: "冒险通关",
  };
  const ammo = game.magazine;
  const stopped = paused || (game.isRealtime && externalBlocked());
  setText(
    "phase",
    stopped
      ? "已暂停"
      : game.upgradePending
        ? "升级收尾中"
        : game.isRealtime && game.canAim
          ? `实时 · 飞刀 ${ammo.available}/${ammo.capacity}`
          : phases[game.phase],
  );
  setText(
    "hint",
    stopped
      ? paused
        ? "已暂停，点击继续"
        : $("debug").open && !wide.matches
          ? "调参中暂停，关闭调试台继续"
          : "界面打开时暂停，关闭后继续"
      : game.upgradePending
        ? "当前飞刀收尾后选择强化"
        : game.isRealtime && game.canAim
          ? ammo.available <= 0
            ? "飞刀与派生效果结束后回补 · 仍可调整瞄准"
            : "移动瞄准 · 每次点击或松手发射一把"
          : game.phase === "aim"
            ? matchMedia("(pointer: fine)").matches
              ? "移动鼠标瞄准 · 点击出刀"
              : "按住战场瞄准 · 松手出刀"
            : game.phase === "flight"
              ? "飞刀还在路上 · 怪物保持静止"
              : phases[game.phase],
  );
  setText("liveStatus", game.lastReason);
  setText(
    "physicsBadge",
    !game.config.gravityOn
      ? "重力关闭"
      : game.config.gravityAfterBounces
        ? "反弹结束后 · 重力"
        : "全程重力",
  );
  setText("presetName", presetLibrary.name(preset) || "自定义手感");
  presetLibrary.markActive(preset);
  const s = game.stats,
    statValues = [
      [
        game.isRealtime
          ? "飞刀储备"
          : game.config.discLauncher
            ? "飞刀数"
            : "发射台",
        game.volleyCount,
      ],
      ["伤害", Number(s.damage.toFixed(1))],
      ["穿透", s.pierce],
      ["怪物弹射", s.enemy],
      ["墙壁反弹", s.wall],
      ["分裂", s.split],
    ];
  const statHtml = statValues
    .map(
      ([label, v]) =>
        `<div class="stat"><span>${t(label)}</span><b>${v}</b></div>`,
    )
    .join("");
  if (statHtml !== lastStats) {
    $("stats").innerHTML = statHtml;
    lastStats = statHtml;
  }
  const fieldInfo = game.isRealtime
    ? {
        power: Math.max(
          1,
          ...game.realtime.shots.map((shot) => shot.fieldBuffs.power),
        ),
        seed: game.realtime.shots.some((shot) => shot.fieldBuffs.seed),
      }
    : game.fieldBuffs;
  const fieldHtml = [
    game.powerBuff.shots > 0
      ? `狂热 +${Math.round((game.attackPower - 1) * 100)}% · 后续 ${game.powerBuff.shots} 次`
      : fieldInfo.power > 1
        ? `狂热 +${Math.round((fieldInfo.power - 1) * 100)}% · 本次出手`
        : "",
    fieldInfo.seed
      ? game.isRealtime
        ? "爆弹种子 · 对应飞刀命中植入"
        : "爆弹种子 · 本轮命中植入"
      : "",
  ]
    .filter(Boolean)
    .map((text) => `<span>${t(text)}</span>`)
    .join("");
  const buffs =
    fieldHtml +
    (Object.entries({
      ...game.buffs,
      ...(game.shopPurchases.recall
        ? { recallForge: game.shopPurchases.recall }
        : {}),
    })
      .filter(([, v]) => v)
      .map(
        ([k, v]) =>
          `<span>${t(k === "recallForge" ? "归心锻造" : upgrades[k][0])} ×${v}</span>`,
      )
      .join("") ||
      (fieldHtml ? "" : `<span>${t("尚无强化 · 击杀升级")}</span>`));
  if (buffs !== lastBuffs) {
    $("buffs").innerHTML = buffs;
    lastBuffs = buffs;
  }
  const overlayKey =
    game.phase === "upgrade"
      ? `upgrade:${game.level}:${game.choices.join()}`
      : game.phase === "over"
        ? "over"
        : "";
  if (overlayKey !== lastOverlay) {
    const continuingUpgrade =
      lastOverlay?.startsWith("upgrade:") && game.phase === "upgrade";
    lastOverlay = overlayKey;
    if (!continuingUpgrade) upgradeFeedback.reset();
    $("overlay").classList.toggle("upgrade-overlay", game.phase === "upgrade");
    delete $("overlay").dataset.upgradeStage;
    $("overlay").replaceChildren();
    $("overlay").hidden = !overlayKey;
    if (overlayKey) {
      const h = document.createElement("h2"),
        p = document.createElement("p");
      overlayText(
        h,
        game.phase === "over" ? "这刀，还能更好。" : "选一招，再出手。",
      );
      overlayText(
        p,
        game.phase === "over"
          ? `得分 ${game.score} · 击杀 ${game.kills} · 坚持 ${game.isRealtime ? `${Math.floor(game.clock)} 秒` : `${game.round - 1} 回合`}`
          : `本次升级自然 ATK +${Number((permanentDamageAt(game.config, game.buffs.damage, game.level + 1) - game.permanentAtk).toFixed(2))} · 任意选择均获得`,
      );
      const host =
        game.phase === "upgrade" ? document.createElement("div") : $("overlay");
      if (game.phase === "upgrade") {
        host.className = "upgrade-options";
        const intro = document.createElement("div");
        intro.className = "level-up-intro";
        intro.setAttribute("role", "status");
        intro.innerHTML =
          '<div class="level-up-halo"></div><div class="level-up-mark">✦</div><strong>LEVEL UP</strong><span></span>';
        overlayText(
          intro.querySelector("span"),
          `等级 ${game.level + 1} · 新的力量`,
        );
        $("overlay").append(intro, host);
      }
      host.append(h, p);
      if (game.phase === "over") {
        playCombatCue(renderer.audio, game.config, "failure");
        const b = document.createElement("button");
        b.className = "accent";
        overlayText(b, "再来一局");
        b.onclick = reset;
        $("overlay").append(b);
      } else
        for (const id of game.choices) {
          const b = document.createElement("button");
          b.className = "choice";
          b.dataset.upgrade = id;
          b.innerHTML = choiceContents(id);
          b.onclick = () => {
            if (upgradeFeedback.ready) game.choose(id);
          };
          host.append(b);
        }
      if (game.phase === "upgrade" && !continuingUpgrade)
        upgradeFeedback.start(game.config);
    }
  }
  if (getLocale() !== lastOverlayLocale) {
    lastOverlayLocale = getLocale();
    localize($("overlay"));
    for (const button of $("overlay").querySelectorAll(".choice"))
      button.innerHTML = choiceContents(button.dataset.upgrade);
  }
  upgradeFeedback.update(dt, game.config);
  if ($("debug").open) {
    const k = game.knives[0];
    setText(
      "telemetry",
      `阶段: ${phases[game.phase]} · 活跃飞刀: ${game.knives.length} · 待发墙刀: ${game.recall?.items.filter((item) => !item.launched).length || 0} · 本刀链条: ${game.shotCount}\n基础伤害: ${damageAt(config, 0)} → 构筑后: ${s.damage}\n终止原因: ${game.lastReason}\n${k ? `首刀速度: ${Math.hypot(k.vx, k.vy).toFixed(1)} · 动力: ${k.energy.toFixed(1)}\n剩余穿透 ${k.pierce} / 怪物弹射 ${k.enemy} / 墙壁反弹 ${k.wall} · 重力${game.gravityActive(k) ? "生效" : "未生效"}` : "暂无在场飞刀"}\n固定模拟 120Hz · 帧耗时 ${frameMs.toFixed(1)}ms`,
    );
  }
}
const stage = document.querySelector(".battle-stage"),
  arenaFrame = document.querySelector(".arena-wrap");
let lastFit = "";
function fitArena() {
  const availableW = stage.clientWidth,
    availableH = stage.clientHeight;
  const borderW = assets.arena ? 0 : 16,
    borderH = assets.arena ? 0 : 34;
  const fit = arenaFit(
    game,
    assets.arena,
    availableW,
    availableH,
    borderW,
    borderH,
  );
  if (!fit) return;
  const previousHeight = game.height;
  if (game.setArenaHeight(fit.worldHeight))
    renderer.resizeArenaEffects(previousHeight, game.height);
  const w = fit.width,
    h = fit.height;
  const key = `${w},${h}`;
  if (key !== lastFit) {
    arenaFrame.style.width = `${w}px`;
    arenaFrame.style.height = `${h}px`;
    lastFit = key;
  }
}
let last = performance.now(),
  acc = 0,
  frameMs = 0;
function frame(now) {
  const start = performance.now(),
    dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  fitArena();
  stagePresentation.sync(game);
  const presentationRunning = !paused && !externalBlocked() && !document.hidden;
  stagePresentation.update(presentationRunning ? dt : 0);
  // Closing an intro can immediately reveal a queued Boss warning. Resolve it
  // before any physics tick, so the input/entry pause has no one-frame gap.
  stagePresentation.sync(game);
  const running = !paused && !playBlocked() && !document.hidden;
  if (audioLab?.isOpen) audioLab.update();
  else syncMusic(renderer.audio, config, running);
  if (running && game.phase !== "upgrade") {
    acc += dt * game.config.timeScale;
    while (acc >= 1 / 120) {
      game.update(1 / 120);
      acc -= 1 / 120;
      stagePresentation.sync(game);
      if (stagePresentation.blocking || game.phase === "upgrade") {
        acc = 0;
        break;
      }
    }
  } else acc = 0;
  const hoverAim =
    !!hoverPointer &&
    game.canAim &&
    !game.upgradePending &&
    !game.recallIntroActive &&
    running;
  if (hoverAim) aim(hoverPointer);
  renderer.draw(
    game,
    angle,
    (aiming || hoverAim) && !stagePresentation.blocking,
    running && !stagePresentation.blocking ? dt : 0,
  );
  hud(running && !stagePresentation.blocking ? dt : 0);
  frameMs = performance.now() - start;
  requestAnimationFrame(frame);
}
$("tune").disabled = false;
const audioStartupError = await startupAudio;
if (audioStartupError) toast(`音频库：${audioStartupError.message}`);
fitArena();
stagePresentation.sync(game);
renderer.draw(game, angle, false, 0);
hud(0);
if (themeLab && !assets.errors.length) startScreen.setReady();
else startScreen.fail("战场素材未完整加载，请重试");
requestAnimationFrame(frame);
