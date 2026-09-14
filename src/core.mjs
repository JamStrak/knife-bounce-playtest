import {
  curveValue,
  permanentDamageAt,
  enemyHpAt,
  hybridDamage,
  giantWhirlAt,
  shopPrice,
  spawnBudget,
} from "./balance-model.mjs";
import { triggerPickup, plantSeed, updateSeeds } from "./field-effects.mjs";
import { updatePickups } from "./pickup-motion.mjs";
import { shopItems, shopEffect } from "./shop.mjs";
import { discShots } from "./launcher-layout.mjs";
import { weightedChoice, entryRows, pickupTypes } from "./field-rules.mjs";
import {
  defaultKnifeArt,
  knifeCenterOffset,
  knifeAnchorAt,
} from "./knife-motion.mjs";
import { stageConfig } from "./stage-schema.mjs";
import { newCombo, comboHit, comboKillXp } from "./combo-rewards.mjs";
import { recordStageReward, stageResult } from "./stage-results.mjs";
import { resizeArenaState } from "./arena-resize.mjs";
import {
  beginStage,
  stageStatus,
  stageFinished,
  stageKill,
  bossDamageFactor,
  bossMove,
  advanceStage,
} from "./stage-mode.mjs";
export const upgrades = {
  recall: ["万刃归心", "出刀时5%概率震起墙刀，瞄准最近敌人错落齐射", "✺"],
  platforms: ["并锋", "增加一把齐射飞刀；旧模式增加发射台，最多10把", "⋮"],
  damage: ["锋芒", "提高每次命中的伤害", "✦"],
  bounce: ["回响", "怪物与墙壁各增加 1 次弹射", "↗"],
  pierce: ["破阵", "多穿过 1 个目标", "➶"],
  size: ["旋风斩", "最终落点旋风斩；升级扩大斩击范围，提高斩击倍率", "◆"],
  split: ["分影", "首次命中释放更多小飞刀", "⋔"],
};
const copy = (x) => structuredClone(x);
// Largest affordable integer count; logarithmic even for imported huge XP values.
function affordableCount(xp, level, firstCost, cost) {
  let low = 0,
    high = Math.min(
      Number.MAX_SAFE_INTEGER - level,
      Math.floor(xp / firstCost),
    );
  while (low < high) {
    const mid = low + Math.ceil((high - low) / 2);
    if (cost(mid) <= xp) low = mid;
    else high = mid - 1;
  }
  return low;
}
export class Game {
  constructor(config) {
    this.config = stageConfig(config);
    this.reset();
  }
  reset() {
    this.width = this.config.cols * this.config.cell;
    this.height = this.arenaHeight ?? this.config.rows * this.config.cell;
    this.rng = this.config.seed;
    this.round = 1;
    this.lives = this.config.lives;
    this.score = 0;
    this.kills = 0;
    this.coins = this.config.shopStartCoins;
    this.shopPurchases = Object.fromEntries(
      Object.keys(shopItems).map((id) => [id, 0]),
    );
    this.xp = 0;
    this.level = 1;
    this.phase = "aim";
    this.enemies = [];
    this.pickups = [];
    this.seeds = [];
    this.fieldShotCount = 0;
    this.fieldBuffs = { power: 1, seed: false };
    this.powerBuff = { shots: 0, factor: 1 };
    this.knives = [];
    this.pins = [];
    this.recall = null;
    this.events = [];
    this.choices = [];
    this.buffs = {
      recall: 0,
      platforms: 0,
      damage: 0,
      bounce: 0,
      pierce: 0,
      size: 0,
      split: 0,
    };
    this.id = 0;
    this.clock = 0;
    this.effectsUntil = 0;
    this.lastReason = "等待出刀";
    this.shotCount = 0;
    this.shotKills = 0;
    this.snapshot = null;
    this.stage = null;
    this.combo = newCombo();
    if (this.config.gameMode === "stages") beginStage(this, 1);
    else for (let r = 0; r < this.config.initialRows; r++) this.spawn(r);
    this.spawnPickup();
    if (this.enemies.some((e) => e.entry)) this.phase = "entry";
    else if (this.stage && stageFinished(this)) this.checkUpgrade();
  }
  get stageStatus() {
    return stageStatus(this);
  }
  get rowHeight() {
    return this.height / this.config.rows;
  }
  setArenaHeight(nextHeight) {
    if (
      !Number.isFinite(nextHeight) ||
      nextHeight <= 0 ||
      Math.abs(nextHeight - this.height) < 0.001
    )
      return false;
    const oldHeight = this.height;
    resizeArenaState(this, oldHeight, nextHeight);
    this.height = nextHeight;
    this.arenaHeight = nextHeight;
    return true;
  }
  get stageResult() {
    return stageResult(this);
  }
  nextStage() {
    if (
      this.phase !== "stageClear" ||
      !this.stage ||
      this.stage.index >= this.stage.total
    )
      return false;
    const index = this.stage.index + 1;
    this.enemies = [];
    this.pickups = [];
    this.knives = [];
    this.seeds = [];
    this.recall = null;
    this.snapshot = null;
    this.choices = [];
    this.events = [];
    this.combo = newCombo();
    this.fieldBuffs = { power: 1, seed: false };
    this.effectsUntil = 0;
    beginStage(this, index);
    this.spawnPickup();
    if (this.enemies.some((e) => e.entry)) this.phase = "entry";
    else this.checkUpgrade();
    return true;
  }
  random() {
    this.rng = (Math.imul(this.rng, 1664525) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }
  addEnemy(col, row, hp = this.config.enemyHp, type = "normal") {
    const e = {
      id: ++this.id,
      bornAt: this.clock,
      animationSeed: (Math.imul(this.id, 0x9e3779b1) ^ this.config.seed) >>> 0,
      col,
      row,
      type,
      variant:
        type === "ultraFast"
          ? 3
          : type === "bomb"
            ? 2
            : type === "fast"
              ? 1
              : this.config.enemyTypesOn
                ? 0
                : (this.id - 1) % 2,
      x: (col + 0.5) * this.config.cell,
      y: (row + 0.5) * this.rowHeight,
      hp,
      maxHp: hp,
      r: this.config.cell * this.config.enemyRadius,
      stuck: [],
      hitAt: -10,
    };
    this.enemies.push(e);
    return e;
  }
  spawn(row = 0) {
    const budget = spawnBudget(
      this.config,
      this.round,
      this.enemies.filter((e) => e.hp > 0).length,
    );
    const cols = Array.from({ length: this.config.cols }, (_, i) => i);
    for (let i = cols.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      [cols[i], cols[j]] = [cols[j], cols[i]];
    }
    let added = 0;
    for (const col of cols) {
      if (added >= budget) break;
      let destination = row;
      if (this.config.spawnScatterOn) {
        const hasWeights = [1, 2, 3].some(
          (r) => this.config[`spawnRow${r}Weight`] > 0,
        );
        const candidates = entryRows(this, col).filter(
          (r) => !hasWeights || this.config[`spawnRow${r + 1}Weight`] > 0,
        );
        if (!candidates.length) continue;
        destination = weightedChoice(
          candidates,
          (r) => this.config[`spawnRow${r + 1}Weight`],
          () => this.random(),
        );
      } else if (this.enemies.some((e) => e.col === col && e.row === row))
        continue;
      const e = this.addEnemy(
        col,
        destination,
        enemyHpAt(this.config, this.round, this.permanentAtk),
        this.enemyType(),
      );
      if (this.config.enemyEntryOn) {
        const delay =
          this.enemies.filter((e) => e.entry).length *
            this.config.entryStagger +
          this.random() * this.config.entryJitter;
        e.entry = {
          age: 0,
          delay,
          from: -this.rowHeight * this.config.entryStartCells - e.r,
          to: e.y,
          duration: this.config.entryDuration,
          power: this.config.entryEase,
        };
        e.y = e.entry.from;
      }
      added++;
    }
  }
  spawnPickup() {
    const c = this.config;
    if (
      !c.fieldItemsOn ||
      !this.enemies.length ||
      this.pickups.length >= c.pickupCap ||
      this.random() >= c.pickupChance
    )
      return;
    const cells = [];
    for (
      let row = Math.max(0, c.pickupMinRow - 1);
      row <= Math.min(this.config.rows - 2, c.pickupMaxRow - 1);
      row++
    )
      for (let col = 0; col < c.cols; col++)
        if (
          !this.enemies.some((e) => e.col === col && e.row === row) &&
          !this.pickups.some((p) => p.col === col && p.row === row)
        )
          cells.push({ col, row });
    if (!cells.length) return;
    const cell = cells[Math.floor(this.random() * cells.length)];
    const type = weightedChoice(
      Object.keys(pickupTypes),
      (id) => c[`pickup${id[0].toUpperCase() + id.slice(1)}Weight`],
      () => this.random(),
    );
    this.pickups.push({
      id: ++this.id,
      ...cell,
      type,
      x: (cell.col + 0.5) * c.cell,
      y: (cell.row + 0.5) * this.rowHeight,
      expires: this.round + c.pickupLife,
    });
  }
  collectPickup(p) {
    if (!this.config.fieldItemsOn || !this.pickups.includes(p)) return false;
    this.pickups = this.pickups.filter((item) => item !== p);
    triggerPickup(this, p);
    this.emit("pickup", p.x, p.y, { pickupType: p.type });
    return true;
  }
  enemyType() {
    if (!this.config.enemyTypesOn) return "normal";
    const r = this.random(),
      bomb = this.config.bombChance;
    // Existing bomb/fast intervals retain priority; ultra-fast consumes the normal remainder.
    return r < bomb
      ? "bomb"
      : r < Math.min(1, bomb + this.config.fastChance)
        ? "fast"
        : r <
            Math.min(
              1,
              bomb + this.config.fastChance + this.config.ultraFastChance,
            )
          ? "ultraFast"
          : "normal";
  }
  get origin() {
    return {
      x: this.width * this.config.launchX,
      y: this.height - this.config.cell * this.config.launchInset,
    };
  }
  get volleyCount() {
    return Math.min(10, this.config.launchers + this.buffs.platforms);
  }
  get launcherCount() {
    return this.config.discLauncher ? 1 : this.volleyCount;
  }
  launchPattern(angle) {
    if (this.config.discLauncher)
      return discShots(
        this.origin,
        angle,
        this.volleyCount,
        this.config,
        this,
        this.stats.r,
      );
    return this.origins.map((p, i) => ({ ...p, angle, index: i + 1 }));
  }
  get origins() {
    if (this.launcherCount === 1) return [this.origin];
    const margin = this.config.cell * 0.3,
      span = Math.min(
        this.width * this.config.launcherSpread,
        this.width - 2 * margin,
      );
    const start = Math.max(
      margin,
      Math.min(this.origin.x - span / 2, this.width - margin - span),
    );
    return Array.from({ length: this.launcherCount }, (_, i) => ({
      x: start + (span * i) / (this.launcherCount - 1),
      y: this.origin.y,
    }));
  }
  upgradeLimit(id) {
    return id === "recall"
      ? 1
      : id === "platforms"
        ? 9
        : this.config.upgradeCap;
  }
  get threshold() {
    return curveValue(this.config, "xp", this.level);
  }
  get recallStats() {
    const c = this.config,
      level = this.shopPurchases.recall;
    return {
      chance: Math.min(1, c.recallChance + level * c.shopRecallChanceGain),
      damage: this.recallKnifeStats.damage,
    };
  }
  get recallKnifeStats() {
    const c = this.config,
      s = this.stats;
    return {
      damage: c.recallInheritDamage
        ? s.damage
        : permanentDamageAt(c, 0, this.level),
      r: c.recallInheritSize ? s.r : c.radius,
      scale: c.recallInheritSize ? s.scale : 1,
      giantLevel: c.recallInheritSize ? s.giantLevel : 0,
      pierce: c.recallInheritPierce ? s.pierce : 0,
      enemy: c.recallInheritEnemyBounces ? s.enemy : 0,
      wall: c.recallInheritWallBounces ? s.wall : 0,
      split: 0,
    };
  }
  shopOffer(id) {
    if (!Object.hasOwn(shopItems, id))
      return { id, ok: false, reason: "商品不存在" };
    const item = shopItems[id],
      c = this.config,
      count = this.shopPurchases[id];
    const price = shopPrice(c, item.priceKey, count);
    const owned =
      id === "damage" ||
      id === "platforms" ||
      this.buffs[id] > 0 ||
      (id === "bounce" && (c.enemyBounces > 0 || c.wallBounces > 0)) ||
      (id === "pierce" && c.pierce > 0) ||
      (id === "split" && c.split > 0);
    const capped =
      count >= c.shopMaxPurchases ||
      (id !== "recall" && this.buffs[id] >= this.upgradeLimit(id)) ||
      (id === "platforms" && this.volleyCount >= 10) ||
      (id === "recall" &&
        (this.recallStats.chance >= 1 || c.shopRecallChanceGain <= 0));
    const reason = !c.shopEnabled
      ? "商店已关闭"
      : this.phase !== "aim"
        ? "出刀与升级结束后可购买"
        : !owned
          ? "先通过三选一获得此能力"
          : capped
            ? "已达强化上限"
            : this.coins < price
              ? `还差 ${price - this.coins} 金币`
              : "";
    return {
      id,
      name: item.name,
      icon: item.icon,
      price,
      count,
      cap: c.shopMaxPurchases,
      owned,
      capped,
      effect: capped ? "已达强化上限" : shopEffect(this, id),
      ok: !reason,
      reason,
    };
  }
  buy(id) {
    const offer = this.shopOffer(id);
    if (!offer.ok) return offer;
    this.coins -= offer.price;
    this.shopPurchases[id]++;
    if (id !== "recall") this.buffs[id]++;
    this.lastReason = `金币强化：${offer.name}`;
    return { ...offer, ok: true };
  }
  get attackPower() {
    return Math.max(
      this.fieldBuffs.power,
      this.powerBuff.shots > 0 ? this.powerBuff.factor : 1,
    );
  }
  get permanentAtk() {
    return permanentDamageAt(this.config, this.buffs.damage, this.level);
  }
  get stats() {
    const c = this.config,
      b = this.buffs;
    return {
      damage: this.permanentAtk * this.attackPower,
      r: c.radius,
      scale: 1,
      giantLevel: b.size,
      pierce: c.pierce + b.pierce * c.pierceUpgrade,
      enemy: c.enemyBounces + b.bounce * c.enemyBounceUpgrade,
      wall: c.wallBounces + b.bounce * c.wallBounceUpgrade,
      split: c.split + b.split * c.splitUpgrade,
    };
  }
  normalizeAngle(a) {
    return Math.atan2(Math.sin(a), Math.cos(a));
  }
  fire(angle) {
    if (this.phase === "entry" && !this.enemies.some((e) => e.entry))
      this.checkUpgrade();
    if (this.phase !== "aim") return false;
    this.effectsUntil = 0;
    angle = this.normalizeAngle(angle);
    this.snapshot = copy({
      enemies: this.enemies,
      pickups: this.pickups,
      fieldBuffs: this.fieldBuffs,
      powerBuff: this.powerBuff,
      seeds: this.seeds,
      pins: this.pins,
      round: this.round,
      lives: this.lives,
      score: this.score,
      kills: this.kills,
      coins: this.coins,
      xp: this.xp,
      level: this.level,
      buffs: this.buffs,
      shopPurchases: this.shopPurchases,
      rng: this.rng,
      id: this.id,
      clock: this.clock,
      stage: this.stage,
      combo: this.combo,
    });
    if (this.stage) this.stage.resultStats.shots++;
    this.combo = newCombo();
    this.lastAngle = angle;
    // One charge powers the complete volley, including its delayed and derived knives.
    this.fieldBuffs.power = this.attackPower;
    if (this.powerBuff.shots > 0) this.powerBuff.shots--;
    this.phase = "flight";
    this.shotKills = 0;
    this.shotCount = 0;
    this.fieldShotCount = 0;
    this.shotLimit = Math.max(this.config.maxKnives, this.volleyCount);
    if (
      this.buffs.recall > 0 &&
      this.pins.length &&
      this.random() < this.recallStats.chance
    )
      this.activateRecall();
    for (const shot of this.launchPattern(angle))
      this.spawnKnife(shot.x, shot.y, shot.angle, this.stats, false);
    this.emit("launch", this.origin.x, this.origin.y, {
      angle,
      count: this.volleyCount,
    });
    return true;
  }
  spawnKnife(x, y, a, stats, child, recalled = false) {
    const reserved = recalled
      ? 0
      : this.recall?.items.filter((item) => !item.launched).length || 0;
    if (stats.fieldAttack) {
      if (this.fieldShotCount >= this.config.pickupRingCap) return;
      this.fieldShotCount++;
    } else {
      if (
        this.shotCount >=
        (this.shotLimit ?? this.config.maxKnives) - reserved
      )
        return;
      this.shotCount++;
    }
    this.knives.push({
      id: ++this.id,
      x,
      y,
      vx: Math.cos(a) * this.config.speed,
      vy: Math.sin(a) * this.config.speed,
      ...stats,
      age: 0,
      energy: this.config.energy,
      exhausted: false,
      child,
      recalled,
      splitDone: child || recalled,
      contacts: [],
      trail: [],
      alive: true,
      pinCandidate: null,
      maxLife: this.config.maxLife,
    });
  }
  retry() {
    if (!this.snapshot) return false;
    Object.assign(this, copy(this.snapshot));
    this.knives = [];
    this.recall = null;
    this.events = [];
    this.choices = [];
    this.phase = "aim";
    this.lastReason = "已恢复上一刀前的布局";
    this.effectsUntil = 0;
    return true;
  }
  emit(type, x, y, extra = {}) {
    this.events.push({ type, x, y, ...extra });
    if (this.events.length > 256) this.events.shift();
  }
  finish(k, reason, enemy = null) {
    if (!k.alive) return;
    k.alive = false;
    this.lastReason = reason;
    const a = Math.atan2(k.vy, k.vx);
    this.whirlwind(k, a);
    if (enemy && enemy.hp > 0) {
      enemy.stuck.push({
        angle: a,
        at: this.clock,
        dx: k.x - enemy.x,
        dy: k.y - enemy.y,
        radius: k.r,
        scale: k.scale,
      });
      if (enemy.stuck.length > this.config.pinCap) enemy.stuck.shift();
    } else if (reason === "边缘钉住") {
      this.pins.push({
        x: k.x,
        y: k.y,
        angle: a,
        corpse: k.pinCandidate,
        radius: k.r,
        nx: k.x <= k.r + 0.01 ? -1 : k.x >= this.width - k.r - 0.01 ? 1 : 0,
        ny: k.y <= k.r + 0.01 ? -1 : k.y >= this.height - k.r - 0.01 ? 1 : 0,
        scale: k.scale,
        age: 0,
      });
      if (this.pins.length > this.config.pinCap) this.pins.shift();
      this.emit("pin", k.x, k.y, { enemyId: k.pinCandidate?.enemyId });
    }
    this.emit("end", k.x, k.y, { reason });
  }
  whirlwind(k, angle) {
    const c = this.config;
    if (!c.giantWhirlOn || !(k.giantLevel > 0)) return;
    const { radius, multiplier } = giantWhirlAt(c, k.giantLevel, k.scale),
      damage = k.damage * multiplier;
    this.emit("whirlwind", k.x, k.y, {
      radius,
      damage,
      angle,
      duration: c.giantWhirlDuration,
    });
    this.effectsUntil = Math.max(
      this.effectsUntil,
      this.clock + c.giantWhirlDuration,
    );
    // Resolve area damage once; never create knives, collect pickups or plant seeds.
    if (damage <= 0) return;
    for (const e of this.enemies) {
      if (e.hp > 0 && Math.hypot(e.x - k.x, e.y - k.y) <= radius + e.r)
        this.damageEnemy(e, damage, false, {
          vx: e.x === k.x && e.y === k.y ? k.vx : e.x - k.x,
          vy: e.x === k.x && e.y === k.y ? k.vy : e.y - k.y,
        });
    }
  }
  reflect(k, nx, ny, surface = "wall", enemyId = undefined) {
    // Only a kill on the final uninterrupted flight segment may appear at the wall.
    k.pinCandidate = null;
    const dot = k.vx * nx + k.vy * ny;
    k.vx = (k.vx - 2 * dot * nx) * this.config.restitution;
    k.vy = (k.vy - 2 * dot * ny) * this.config.restitution;
    if (!k.exhausted) {
      const speed = Math.hypot(k.vx, k.vy);
      if (speed) {
        k.vx *= 1 + this.config.bounceBoost / speed;
        k.vy *= 1 + this.config.bounceBoost / speed;
      }
      k.energy = Math.min(
        this.config.energy,
        k.energy + this.config.energyGain,
      );
    }
    const speed = Math.hypot(k.vx, k.vy) || 1;
    this.emit("bounce", k.x, k.y, {
      surface,
      enemyId,
      normal: { x: nx, y: ny },
      direction: { x: k.vx / speed, y: k.vy / speed },
    });
  }
  damageEnemy(e, damage, fromExplosion = false, impact = { vx: 0, vy: 1 }) {
    if (e.hp <= 0 || !(damage > 0)) return false;
    if (e.boss) damage *= bossDamageFactor(this, e);
    comboHit(this, e);
    e.hitAt = this.clock;
    e.hp -= damage;
    const speed = Math.hypot(impact.vx, impact.vy) || 1,
      direction = { x: impact.vx / speed, y: impact.vy / speed };
    this.emit("hit", e.x, e.y, {
      damage,
      enemyId: e.id,
      direction,
      lethal: e.hp <= 0,
    });
    if (e.hp > 0) return false;
    this.kills++;
    this.shotKills++;
    const scoreGain =
      this.config.killScore + (this.shotKills - 1) * this.config.comboBonus;
    this.score += scoreGain;
    stageKill(this, e);
    const bossPrefix = e.boss === "fortress" ? "bossFortress" : "bossSummoner";
    const xp = comboKillXp(
        this,
        e.boss ? this.config[bossPrefix + "Xp"] : this.config.xpDrop,
      ),
      coins = e.boss ? this.config[bossPrefix + "Coins"] : this.config.coinDrop;
    this.xp += xp;
    this.coins += coins;
    recordStageReward(this, xp, coins);
    this.emit("kill", e.x, e.y, {
      enemyId: e.id,
      scoreGain,
      shotKills: this.shotKills,
      effectProfile: e.effectProfile,
      at: this.clock,
      bornAt: e.bornAt,
      animationSeed: e.animationSeed,
      impactOffset:
        Number.isFinite(impact.x) && Number.isFinite(impact.y)
          ? { x: (impact.x - e.x) / e.r, y: (impact.y - e.y) / e.r }
          : { x: 0, y: 0 },
      direction,
      variant: e.variant,
      r: e.r,
      enemyType: e.type,
    });
    if (e.type === "bomb" && (!fromExplosion || this.config.bombChain)) {
      // A work queue resolves each bomb once without a recursive stack, including chain kills.
      this.bombQueue ??= [];
      this.bombQueue.push({ x: e.x, y: e.y });
      if (!this.resolvingBombs) {
        this.resolvingBombs = true;
        try {
          for (let i = 0; i < this.bombQueue.length; i++) {
            const center = this.bombQueue[i],
              radius = this.config.bombRadius * this.config.cell;
            this.emit("explode", center.x, center.y, { radius });
            this.effectsUntil = Math.max(
              this.effectsUntil,
              this.clock + this.config.bombFxDuration,
            );
            for (const target of this.enemies) {
              if (
                target.hp > 0 &&
                Math.hypot(target.x - center.x, target.y - center.y) <= radius
              )
                this.damageEnemy(target, this.config.bombDamage, true, {
                  vx: target.x - center.x,
                  vy: target.y - center.y,
                });
            }
          }
        } finally {
          this.bombQueue = [];
          this.resolvingBombs = false;
        }
      }
    }
    return true;
  }
  activateRecall() {
    if (!this.pins.length || this.recall) return false;
    const c = this.config,
      stats = this.recallKnifeStats;
    const knifeArt = { ...defaultKnifeArt, ...this.knifeArt },
      knifeLength = c.knifeLength;
    // Use the configured inward offset directly; a knife-length floor hid small edits.
    const clearance = c.recallPullDistance;
    const timing = {
      shake: c.recallShakeDuration,
      amount: (c.recallShakeAmount * Math.PI) / 180,
      frequency: c.recallShakeFrequency,
      pull: c.recallPullDuration,
      hover: c.recallHoverDuration,
      turnPower: c.recallTurnPower,
    };
    const interval =
      this.pins.length > 1
        ? Math.min(c.recallStagger, c.recallStaggerMax / (this.pins.length - 1))
        : 0;
    this.recall = {
      age: 0,
      stats,
      knifeArt,
      knifeLength,
      timing,
      items: this.pins.map((p, i) => {
        let nx =
          p.nx ??
          (p.x <= (p.radius || 0) + 1
            ? -1
            : p.x >= this.width - (p.radius || 0) - 1
              ? 1
              : 0);
        let ny =
          p.ny ??
          (p.y <= (p.radius || 0) + 1
            ? -1
            : p.y >= this.height - (p.radius || 0) - 1
              ? 1
              : 0);
        if (!nx && !ny) {
          nx = p.x - this.width / 2;
          ny = p.y - this.height / 2;
        }
        const len = Math.hypot(nx, ny) || 1;
        nx /= len;
        ny /= len;
        const marginX = Math.min(stats.r + 0.1, this.width / 2),
          marginY = Math.min(stats.r + 0.1, this.height / 2);
        const x = Math.max(
          marginX,
          Math.min(this.width - marginX, p.x - nx * clearance),
        );
        const y = Math.max(
          marginY,
          Math.min(this.height - marginY, p.y - ny * clearance),
        );
        const centerOffset = knifeCenterOffset(
          knifeArt,
          knifeLength,
          stats.scale,
          p.angle ?? Math.atan2(ny, nx),
        );
        return {
          source: { ...p, angle: p.angle ?? Math.atan2(ny, nx) },
          x,
          y,
          center: { x: x + centerOffset.x, y: y + centerOffset.y },
          aimAngle: Math.atan2(this.height / 2 - y, this.width / 2 - x),
          targetId: null,
          launched: false,
          releaseAt: timing.shake + timing.pull + timing.hover + i * interval,
        };
      }),
    };
    this.shotLimit = Math.max(
      this.shotLimit || 0,
      c.maxKnives,
      this.shotCount + this.recall.items.length + this.volleyCount,
    );
    this.pins = [];
    this.emit("recall", this.width / 2, this.height / 2);
    return true;
  }
  updateRecall(dt) {
    const r = this.recall;
    if (!r) return;
    r.age += dt;
    for (const item of r.items) {
      if (item.launched) continue;
      if (r.age >= r.timing.shake + r.timing.pull) {
        let target = null,
          distance = Infinity;
        for (const e of this.enemies) {
          if (e.hp <= 0) continue;
          const d = Math.hypot(e.x - item.center.x, e.y - item.center.y);
          if (d < distance) {
            target = e;
            distance = d;
          }
        }
        item.targetId = target?.id ?? null;
        item.aimAngle = Math.atan2(
          (target?.y ?? this.height / 2) - item.center.y,
          (target?.x ?? this.width / 2) - item.center.x,
        );
      }
      if (r.age >= item.releaseAt) {
        item.launched = true;
        const anchor = knifeAnchorAt(
          item.center,
          item.aimAngle,
          r.knifeArt,
          r.knifeLength,
          r.stats.scale,
        );
        this.spawnKnife(
          anchor.x,
          anchor.y,
          item.aimAngle,
          r.stats,
          false,
          true,
        );
        this.knives.at(-1).recallAppearance = {
          knifeLength: r.knifeLength,
          knifeArt: r.knifeArt,
        };
        this.emit("recallLaunch", anchor.x, anchor.y);
      }
    }
    if (r.items.every((item) => item.launched)) this.recall = null;
  }
  hit(k, e) {
    plantSeed(this, e, k);
    if (this.config.energyOn) k.energy -= this.config.energyCost;
    if (
      this.damageEnemy(e, hybridDamage(k.damage, k.hpDamageRatio, e), false, k)
    )
      k.pinCandidate =
        k.pierce > 0 && e.type !== "bomb"
          ? { r: e.r, variant: e.variant, type: e.type, enemyId: e.id }
          : null;
    if (!k.splitDone && k.split > 0) {
      k.splitDone = true;
      const a = Math.atan2(k.vy, k.vx);
      for (let i = 0; i < k.split; i++) {
        const da =
          ((i - (k.split - 1) / 2) * this.config.splitAngle * Math.PI) / 180;
        const childStats = {
          ...this.stats,
          damage: k.damage * this.config.splitDamage,
          split: 0,
          r: k.r * this.config.splitScale,
          scale: k.scale * this.config.splitScale,
          giantLevel: k.giantLevel,
        };
        const count = this.knives.length;
        this.spawnKnife(k.x, k.y, a + da, childStats, true);
        if (this.knives.length > count) this.knives.at(-1).contacts.push(e.id);
      }
    }
    if (k.pierce > 0) {
      k.pierce--;
      return;
    }
    if (k.enemy > 0) {
      k.enemy--;
      let nx = k.x - e.x,
        ny = k.y - e.y;
      let d = Math.hypot(nx, ny);
      if (d < 0.00001) {
        d = Math.hypot(k.vx, k.vy) || 1;
        nx = -k.vx / d;
        ny = -k.vy / d;
        d = 1;
      }
      nx /= d;
      ny /= d;
      this.reflect(k, nx, ny, "enemy", e.id);
      k.x = e.x + nx * (e.r + k.r + 0.1);
      k.y = e.y + ny * (e.r + k.r + 0.1);
      return;
    }
    this.finish(k, "命中终止", e);
  }
  gravityActive(k) {
    return (
      this.config.gravityOn &&
      (!this.config.gravityAfterBounces || (k.enemy <= 0 && k.wall <= 0))
    );
  }
  integrate(k, dt) {
    const c = this.config;
    k.age += dt;
    if (k.age >= k.maxLife) {
      this.finish(k, "最长存续时间");
      return;
    }
    if (c.energyOn) {
      k.energy -= c.energyDrain * dt;
      if (k.energy <= 0) {
        k.exhausted = true;
        k.energy = 0;
        if (!c.gravityOn) {
          this.finish(k, "动力耗尽");
          return;
        }
      }
    }
    const count = Math.max(
      1,
      Math.ceil(
        (Math.hypot(k.vx, k.vy) * dt) /
          Math.max(1, Math.min(k.r, c.cell * c.enemyRadius) * 0.5),
      ),
    );
    const h = dt / count;
    for (let s = 0; s < count && k.alive; s++) {
      k.vx *= Math.exp(-c.drag * h);
      k.vy *= Math.exp(-c.drag * h);
      if (this.gravityActive(k))
        k.vy = Math.min(c.terminalSpeed, k.vy + c.gravity * h);
      k.x += k.vx * h;
      k.y += k.vy * h;
      let nx = 0,
        ny = 0;
      if (k.x < k.r) {
        k.x = k.r;
        nx = 1;
      } else if (k.x > this.width - k.r) {
        k.x = this.width - k.r;
        nx = -1;
      }
      if (k.y < k.r) {
        k.y = k.r;
        ny = 1;
      } else if (k.y > this.height - k.r) {
        k.y = this.height - k.r;
        ny = -1;
      }
      if (nx || ny) {
        if (k.wall > 0) {
          k.wall--;
          const norm = Math.hypot(nx, ny);
          this.reflect(k, nx / norm, ny / norm);
        } else {
          this.finish(k, "边缘钉住");
          break;
        }
      }
      if (c.fieldItemsOn)
        for (const p of [...this.pickups])
          if (Math.hypot(k.x - p.x, k.y - p.y) <= k.r + c.cell * c.pickupRadius)
            this.collectPickup(p);
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        const touching = Math.hypot(k.x - e.x, k.y - e.y) <= e.r + k.r;
        if (!touching) {
          k.contacts = k.contacts.filter((id) => id !== e.id);
          continue;
        }
        if (k.contacts.includes(e.id)) continue;
        k.contacts.push(e.id);
        this.hit(k, e);
        if (!k.alive) break;
      }
    }
    k.trail.push({ x: k.x, y: k.y });
    while (k.trail.length > c.trail) k.trail.shift();
  }
  update(dt) {
    // Stage state must remain frozen while choices/clear screens are awaiting input.
    if (
      this.stage &&
      (!(dt > 0) ||
        ["upgrade", "stageClear", "victory", "over"].includes(this.phase))
    )
      return;
    this.clock += dt;
    for (const e of this.enemies)
      if (e.boss) e.hpRatioFactor = this.config.stageBossHpRatioFactor;
    updatePickups(this, dt);
    this.pins = this.pins.filter((p) => (p.age += dt) < this.config.pinLife);
    if (this.phase === "flight") {
      this.updateRecall(dt);
      updateSeeds(this);
      for (const k of [...this.knives]) this.integrate(k, dt);
      this.knives = this.knives.filter((k) => k.alive);
      this.enemies = this.enemies.filter((e) => e.hp > 0);
      if (
        !this.knives.length &&
        !this.recall &&
        !this.seeds.length &&
        this.clock >= this.effectsUntil
      ) {
        if (this.stage) {
          this.emit("comboEnd", this.origin.x, this.origin.y, {
            hits: this.combo.hits,
            kills: this.combo.kills,
            multiplier: this.combo.multiplier,
            bonusXp: this.combo.bonusXp,
          });
          if (stageFinished(this)) {
            this.fieldBuffs = { power: 1, seed: false };
            this.checkUpgrade();
            return;
          }
        }
        this.phase = "advance";
        this.fieldBuffs = { power: 1, seed: false };
        this.moveT = 0;
        this.moveBy =
          this.round % this.config.moveEvery === 0 ? this.config.advance : 0;
        const occupied = new Map();
        for (const e of [...this.enemies].sort((a, b) => b.row - a.row)) {
          e.fromY = e.y;
          const wanted = e.boss
            ? bossMove(this, e)
            : e.summoned
              ? this.moveBy > 0
                ? this.config.bossSummonAdvance
                : 0
              : this.moveBy *
                (e.type === "ultraFast"
                  ? this.config.ultraFastAdvance
                  : e.type === "fast"
                    ? this.config.fastAdvance
                    : 1);
          // Front-to-back reservations prevent fast enemies stacking on another monster.
          const target = Math.min(
            e.row + wanted,
            (occupied.get(e.col) ?? Infinity) - 1,
          );
          e.moveBy = Math.max(0, target - e.row);
          occupied.set(e.col, e.row + e.moveBy);
        }
      }
    } else if (this.phase === "advance") {
      this.moveT += dt;
      const t = Math.min(1, this.moveT / this.config.moveDuration),
        ease = t * t * (3 - 2 * t);
      for (const e of this.enemies)
        e.y = e.fromY + (e.moveBy ?? this.moveBy) * this.rowHeight * ease;
      if (t >= 1) {
        for (const e of this.enemies) {
          e.row += e.moveBy ?? this.moveBy;
          if (e.row >= this.config.rows) {
            const before = this.lives;
            this.lives = e.boss
              ? 0
              : Math.max(0, this.lives - this.config.leakDamage);
            if (this.stage) {
              this.stage.leaked++;
              this.stage.resultStats.livesLost += before - this.lives;
            }
            this.emit("leak", e.x, this.height);
          }
        }
        this.enemies = this.enemies.filter((e) => e.row < this.config.rows);
        this.round++;
        if (this.lives <= 0) {
          this.phase = "over";
          return;
        }
        this.pickups = this.pickups.filter(
          (p) =>
            p.expires > this.round &&
            (this.config.pickupDriftOn ||
              !this.enemies.some((e) => e.col === p.col && e.row === p.row)),
        );
        if (this.stage) advanceStage(this);
        else this.spawn();
        this.spawnPickup();
        if (this.enemies.some((e) => e.entry)) this.phase = "entry";
        else this.checkUpgrade();
      }
    } else if (this.phase === "entry") {
      for (const e of this.enemies)
        if (e.entry) {
          const a = e.entry;
          a.age += dt;
          const t = Math.max(0, Math.min(1, (a.age - a.delay) / a.duration));
          e.y = a.from + (a.to - a.from) * (1 - (1 - t) ** a.power);
          if (t >= 1) {
            e.y = a.to;
            delete e.entry;
          }
        }
      if (!this.enemies.some((e) => e.entry)) this.checkUpgrade();
    }
  }
  checkUpgrade() {
    const eligible = Object.keys(upgrades).filter(
      (k) =>
        this.buffs[k] < this.upgradeLimit(k) &&
        (k !== "platforms" || this.volleyCount < 10),
    );
    if (this.xp >= this.threshold && eligible.length) {
      this.phase = "upgrade";
      for (let i = eligible.length - 1; i > 0; i--) {
        const j = Math.floor(this.random() * (i + 1));
        [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
      }
      this.choices = eligible.slice(0, 3);
    } else {
      this.choices = [];
      if (
        !eligible.length &&
        this.stage?.campaignMode === "campaign" &&
        this.config.campaignOverflowLevelOn
      )
        this.consumeNaturalLevels();
      if (stageFinished(this)) {
        this.phase =
          this.stage.index === this.stage.total ? "victory" : "stageClear";
        if (!this.stage.completed) {
          this.stage.completed = true;
          this.emit(this.phase, this.width / 2, this.height / 2, {
            index: this.stage.index,
          });
        }
      } else this.phase = "aim";
    }
  }
  consumeNaturalLevels() {
    if (!Number.isFinite(this.xp) || !(this.xp >= this.threshold)) return;
    const c = this.config,
      fromLevel = this.level,
      fromAtk = this.permanentAtk,
      cap = c.xpCurveMax > 0 ? Math.max(1, Math.ceil(c.xpCurveMax)) : Infinity;
    // Exotic nonlinear imported curves have bounded work per check. Unspent XP is
    // retained in full and is considered again on the next settlement/check.
    for (
      let work = 0;
      work < 4096 && this.level < Number.MAX_SAFE_INTEGER;
      work++
    ) {
      const first = this.threshold;
      if (!Number.isFinite(first) || this.xp < first) break;
      const formula = c.xpCurveMode !== "points",
        tailSlope = (c.xpCurveP3 - c.xpCurveP2) / 15,
        constant = formula
          ? c.xpGrowth === 0 || (c.xpGrowth >= 0 && first >= cap)
          : this.level >= 30 &&
            (tailSlope === 0 ||
              (tailSlope > 0 && first >= cap) ||
              (tailSlope < 0 && first <= 1)),
        linear =
          formula &&
          c.xpCurvePower === 1 &&
          Number.isInteger(c.xpGrowth) &&
          c.xpGrowth >= 0;
      if (constant || linear) {
        const gain = constant ? 0 : c.xpGrowth,
          cost = (count) => {
            const ramp =
                gain > 0
                  ? Math.min(
                      count,
                      Math.max(0, Math.ceil((cap - first) / gain)),
                    )
                  : count,
              sum = (ramp * (2 * first + (ramp - 1) * gain)) / 2;
            return sum + (count > ramp ? (count - ramp) * cap : 0);
          },
          count = affordableCount(this.xp, this.level, first, cost);
        if (!count) break;
        this.xp -= cost(count);
        this.level += count;
        break;
      }
      this.xp -= first;
      this.level++;
    }
    if (this.level > fromLevel)
      this.emit("naturalLevelUp", this.origin.x, this.origin.y, {
        fromLevel,
        level: this.level,
        levels: this.level - fromLevel,
        fromAtk,
        atk: this.permanentAtk,
      });
  }
  choose(id) {
    if (this.phase !== "upgrade" || !this.choices.includes(id)) return false;
    this.xp -= this.threshold;
    this.level++;
    this.buffs[id]++;
    this.checkUpgrade();
    return true;
  }
}
