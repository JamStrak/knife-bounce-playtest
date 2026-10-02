import { feedbackConfig } from "./feedback-schema.mjs";
import { t } from "./i18n.mjs";
import { fitEffectFont } from "./i18n-effects.mjs";
export {
  playCombatCue,
  combatMixer,
  resetCombatAudio,
  cueRecipe,
  CombatMixer,
} from "./combat-audio.mjs";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const f = (n) => Number((n || 0).toFixed(1));
const barrageEvents = new Set([
  "enemyShot",
  "guard",
  "guardBlock",
  "knifeBulletBlock",
  "perfectGuard",
  "bulletImpact",
  "reflectedHit",
]);
const barrageEnabled = (config) =>
  config.combatMode === "realtime" &&
  config.barrageOn &&
  config.barrageFxOn !== false;
const palette = (event, colors) => {
  const defaults = {
    hit: "#6de9ff",
    kill: "#b0f5ff",
    bounce: "#8ee9ff",
    pin: "#ffe1a0",
    explode: "#ffc67a",
    lightning: "#99a9ff",
    ring: "#88fff3",
    plant: "#ffad9b",
    recallIntro: "#d8faff",
    recall: "#a6d3ff",
    whirlwind: "#b3edff",
    pickup: "#ffe79e",
    combo: "#ffe8ae",
    leak: "#ff7f83",
    launch: "#d5f9ff",
    recallLaunch: "#bedaff",
    summon: "#e5b9ff",
    bossEntry: "#e5b9ff",
    naturalLevelUp: "#fff0b0",
    enemyShot: "#ffb17d",
    guard: "#87dfff",
    guardBlock: "#99eaff",
    knifeBulletBlock: "#d6f8ff",
    perfectGuard: "#e4fbff",
    bulletImpact: "#ff859c",
    reflectedHit: "#adf7ff",
  };
  const key =
    event.type === "kill"
      ? "killParticle"
      : event.type === "hit"
        ? "hitParticle"
        : event.type === "leak"
          ? "leakParticle"
          : event.type === "lightning"
            ? "pickupLightning"
            : event.type === "plant" || event.seed
              ? "pickupSeed"
              : null;
  return (key && colors[key]) || defaults[event.type] || "#bdefff";
};
export class CombatFeedback {
  constructor() {
    this.reset();
  }
  reset() {
    this.particles = [];
    this.marks = [];
    this.texts = [];
    this.serial = 0;
    this.bursts = 0;
    this.time = 0;
    this.lastGuardText = -Infinity;
    this.lastKnifeBlockText = -Infinity;
    this.lastPerfectFlash = -Infinity;
    this.recallTitle = null;
  }
  random() {
    const v = Math.sin(++this.serial * 12.9898) * 43758.5453;
    return v - Math.floor(v);
  }
  consume(events, game, colors = {}) {
    const c = feedbackConfig(game.config);
    if (!c.combatFxOn || !c.combatFxIntensity) {
      this.reset();
      return;
    }
    this.bursts = 0;
    for (const e of events) {
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) continue;
      if (barrageEvents.has(e.type) && !barrageEnabled(c)) continue;
      const color = palette(e, colors),
        angle = Number.isFinite(e.angle)
          ? e.angle
          : e.direction
            ? Math.atan2(e.direction.y, e.direction.x)
            : -Math.PI / 2,
        life = Math.max(0.05, c.particleLife || 0.5),
        size = c.combatFxScale,
        progress = clamp((e.shotKills || e.kills || 1) - 1, 0, 12) / 12;
      const mark = (kind, radius, duration = life * 0.7) =>
        this.marks.push({
          kind,
          eventType: e.type,
          x: e.x,
          y: e.y,
          color,
          angle,
          radius: radius * size,
          duration,
          age: 0,
          progress,
        });
      const burst = (amount, direction = false) => {
        if (!c.combatFxParticles || this.bursts >= c.combatFxBurstLimit) return;
        this.bursts++;
        const count = Math.min(
          c.combatFxBudget - this.particles.length,
          Math.round((c.particleCount || 0) * amount * c.combatFxIntensity),
        );
        for (let i = 0; i < count; i++) {
          const a = direction
              ? angle + (this.random() - 0.5) * Math.PI * 1.3
              : this.random() * Math.PI * 2,
            speed = (55 + this.random() * 155) * size * (1 + progress * 0.3);
          this.particles.push({
            x: e.x,
            y: e.y,
            vx: Math.cos(a) * speed,
            vy: Math.sin(a) * speed,
            age: 0,
            duration: life * (0.5 + this.random() * 0.65),
            color,
            size: (1.8 + this.random() * 3.2) * size,
            angle: a,
            spin: (this.random() - 0.5) * 14,
            crystal: ["kill", "explode", "pickup"].includes(e.type),
            eventType: e.type,
          });
        }
      };
      const text = (sourceText, strong = false, vars = {}) => {
        if (!c.combatFxNumbers || !c.combatFxNumberCap) return;
        this.texts.push({
          x: clamp(e.x, 30, game.width - 30),
          y: e.y - 12 * size,
          text: sourceText.replace(/\{(\w+)\}/g, (token, key) =>
            Object.hasOwn(vars, key) ? String(vars[key]) : token,
          ),
          sourceText,
          vars,
          color: strong ? color : "#ffffff",
          age: 0,
          duration: c.floatLife || 0.65,
          strong,
          progress,
          kind: e.type,
        });
      };
      if (e.type === "recallIntro") {
        const duration = Number.isFinite(e.duration)
          ? e.duration
          : c.recallIntroDuration;
        if (duration > 0) {
          this.recallTitle = {
            age: 0,
            duration,
            x: game.width / 2,
            y: game.height * 0.4,
            sourceText: "万刃归心",
            color: colors.recall || color,
          };
        }
      } else if (barrageEvents.has(e.type)) {
        if (e.type === "perfectGuard") {
          // One white-blue accent, even when a whole volley is parried at once.
          if (this.time - this.lastPerfectFlash < 0.12) continue;
          this.lastPerfectFlash = this.time;
          this.marks = this.marks.filter((m) => m.kind !== "perfectGuard");
          if (c.combatFxRings) mark("perfectGuard", 44, 0.36);
          burst(1.2, true);
          this.texts = this.texts.filter(
            (p) => p.kind !== "perfectGuard" && p.kind !== "guardBlock",
          );
          text("完美防御", true);
          const latest = this.texts.at(-1);
          if (latest?.kind === "perfectGuard") {
            latest.x = game.width / 2;
            latest.y = clamp(e.y - 35, 28, game.height - 45);
            latest.duration = Math.max(0.4, Math.min(0.8, c.floatLife || 0.65));
            latest.scale = 1.12;
          }
          this.lastGuardText = this.time;
        } else if (e.type === "guardBlock") {
          if (c.combatFxRings) mark("guardBlock", 23, 0.22);
          burst(0.4, true);
          if (this.time - this.lastGuardText >= 0.2) {
            this.lastGuardText = this.time;
            this.texts = this.texts.filter((p) => p.kind !== "guardBlock");
            text("格挡", true);
          }
        } else if (e.type === "knifeBulletBlock") {
          if (c.combatFxSlashes) mark("knifeBulletBlock", 14, 0.16);
          burst(0.35, true);
          if (this.time - this.lastKnifeBlockText >= 0.18) {
            this.lastKnifeBlockText = this.time;
            this.texts = this.texts.filter(
              (p) => p.kind !== "knifeBulletBlock",
            );
            text("击落", true);
          }
        } else if (e.type === "guard") {
          if (c.combatFxRings) mark("guardBlock", 20, 0.18);
        } else if (e.type === "enemyShot") {
          if (c.combatFxSlashes) mark("launch", 10, 0.12);
          burst(0.18, true);
        } else if (e.type === "bulletImpact") {
          if (c.combatFxRings) mark("ring", 21, 0.22);
          burst(0.4);
        } else if (e.type === "reflectedHit") {
          if (c.combatFxRings) mark("star", 23, 0.2);
          burst(0.5, true);
        }
      } else if (e.type === "naturalLevelUp") {
        if (!c.upgradeFxOn || !(c.upgradeIntroDuration > 0)) continue;
        const duration = c.upgradeIntroDuration,
          scale = c.upgradeFxScale || 1;
        this.marks = this.marks.filter((m) => m.kind !== "naturalLevelUp");
        this.texts = this.texts.filter((t) => t.kind !== "naturalLevelUp");
        if (c.combatFxRings) mark("naturalLevelUp", 36 * scale, duration);
        text(
          "Lv." + f(e.level) + " · ATK +" + f(Math.max(0, e.atk - e.fromAtk)),
          true,
        );
        const label = this.texts.at(-1);
        if (label?.kind === "naturalLevelUp") {
          label.header = "LEVEL UP";
          label.duration = duration;
          label.scale = scale;
          label.x = clamp(e.x, 70, game.width - 70);
          label.y = clamp(e.y - 45 * scale, 45, game.height - 35);
        }
      } else if (e.type === "hit") {
        if (c.combatFxSlashes) mark("slash", 19, life * 0.45);
        burst(e.lethal ? 0.3 : 0.55, true);
        if (!e.lethal && Number.isFinite(e.damage)) text("−" + f(e.damage));
      } else if (e.type === "kill") {
        if (c.combatFxRings) mark("star", 18 + progress * 15);
        burst(1.15 + progress * 0.5);
        text(
          Number.isFinite(e.scoreGain) ? "+" + f(e.scoreGain) : "击破",
          true,
        );
      } else if (e.type === "bounce" || e.type === "pin") {
        if (c.combatFxSlashes)
          mark(
            e.type === "pin" ? "pin" : "slash",
            e.type === "pin" ? 15 : 12,
            life * 0.5,
          );
        burst(0.4, true);
      } else if (
        [
          "explode",
          "ring",
          "pickup",
          "recall",
          "whirlwind",
          "lightning",
          "plant",
          "summon",
          "bossEntry",
        ].includes(e.type)
      ) {
        if (c.combatFxRings)
          mark(
            e.type === "recall" ? "converge" : "ring",
            Math.min(
              game.width * 0.48,
              e.radius ||
                (e.type === "recall" ? 75 : e.type === "ring" ? 48 : 28),
            ),
            e.duration || life,
          );
        burst(e.type === "explode" ? 1.8 : 0.85);
        if (e.type === "pickup")
          text(
            e.pickupType === "power"
              ? "狂热 · 后续 {count} 次"
              : { lightning: "连锁闪电", ring: "环形刀阵", seed: "爆弹种子" }[
                  e.pickupType
                ] || "战场增益",
            true,
            { count: game.powerBuff.shots },
          );
      } else if (e.type === "launch" || e.type === "recallLaunch") {
        if (c.combatFxSlashes) mark("launch", 26, life * 0.32);
        burst(0.2, true);
      } else if (e.type === "leak") {
        if (c.combatFxRings) mark("ring", 30);
        burst(0.5);
      } else if (e.type === "combo" && c.combatFxCombo && e.kills >= 3) {
        this.texts = this.texts.filter((t) => t.kind !== "combo");
        if (c.combatFxNumbers) {
          text("{count} 连斩 · EXP ×{multiplier}", true, {
            count: e.kills,
            multiplier: f(e.multiplier),
          });
          const latest = this.texts.at(-1);
          if (latest?.kind === "combo") {
            latest.x = game.width / 2;
            latest.y = Math.min(game.height - 50, e.y - 35);
          }
        }
        // A single growing flourish replaces all same-frame combo rings.
        this.marks = this.marks.filter((m) => m.kind !== "combo");
        if (c.combatFxRings) mark("combo", 30 + progress * 25);
      }
    }
    this.particles =
      c.combatFxBudget > 0
        ? this.particles.slice(-Math.floor(c.combatFxBudget))
        : [];
    const perfect = this.marks.findLast((m) => m.kind === "perfectGuard"),
      markLimit = Math.max(8, Math.floor(c.combatFxBurstLimit) * 3);
    this.marks = this.marks
      .filter((m) => m.kind !== "perfectGuard")
      .slice(-(markLimit - (perfect ? 1 : 0)));
    if (perfect) this.marks.push(perfect);
    this.texts =
      c.combatFxNumberCap > 0
        ? this.texts.slice(-Math.floor(c.combatFxNumberCap))
        : [];
  }
  update(dt, config) {
    const c = feedbackConfig(config);
    if (!c.combatFxOn || !c.combatFxIntensity) {
      this.reset();
      return;
    }
    if (!barrageEnabled(c)) {
      this.particles = this.particles.filter(
        (p) => !barrageEvents.has(p.eventType),
      );
      this.marks = this.marks.filter((m) => !barrageEvents.has(m.eventType));
      this.texts = this.texts.filter((p) => !barrageEvents.has(p.kind));
    }
    this.particles = c.combatFxParticles
      ? this.particles.slice(0, Math.max(0, Math.floor(c.combatFxBudget)))
      : [];
    this.texts =
      c.combatFxNumbers && c.combatFxNumberCap > 0
        ? this.texts.slice(-Math.floor(c.combatFxNumberCap))
        : [];
    if (!c.upgradeFxOn || !(c.upgradeIntroDuration > 0)) {
      this.marks = this.marks.filter((m) => m.kind !== "naturalLevelUp");
      this.texts = this.texts.filter((t) => t.kind !== "naturalLevelUp");
    }
    if (!(dt > 0)) return;
    this.time += dt;
    if (
      this.recallTitle &&
      (this.recallTitle.age += dt) >= this.recallTitle.duration
    )
      this.recallTitle = null;
    this.particles = this.particles
      .filter((p) => (p.age += dt) < p.duration)
      .slice(0, Math.max(0, c.combatFxBudget));
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 160 * dt;
      p.vx *= Math.exp(-1.8 * dt);
      p.angle += p.spin * dt;
    }
    this.marks = this.marks.filter((p) => (p.age += dt) < p.duration);
    this.texts = this.texts
      .filter((p) => (p.age += dt) < p.duration)
      .slice(0, c.combatFxNumberCap);
  }
  draw(ctx, game) {
    const c = feedbackConfig(game.config);
    if (!c.combatFxOn || !c.combatFxIntensity) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, game.width, game.height);
    ctx.clip();
    const strength = Math.min(1, c.combatFxIntensity);
    for (const m of this.marks) {
      if (barrageEvents.has(m.eventType) && !barrageEnabled(c)) continue;
      if (
        ["slash", "pin", "launch", "knifeBulletBlock"].includes(m.kind)
          ? !c.combatFxSlashes
          : !c.combatFxRings
      )
        continue;
      const t = m.age / m.duration,
        radius = Math.max(0.1, m.radius * (0.45 + Math.sqrt(t) * 0.75));
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.angle);
      ctx.globalAlpha = (1 - t) ** 1.3 * strength;
      ctx.strokeStyle = m.color;
      ctx.fillStyle = m.color;
      ctx.shadowBlur = 12 * c.combatFxGlow;
      ctx.shadowColor = m.color;
      if (m.kind === "knifeBulletBlock") {
        ctx.lineWidth = 2 * c.combatFxScale;
        ctx.beginPath();
        ctx.moveTo(-radius, -radius * 0.65);
        ctx.lineTo(radius, radius * 0.65);
        ctx.moveTo(-radius * 0.65, radius);
        ctx.lineTo(radius * 0.65, -radius);
        ctx.stroke();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(0, 0, 2.2 * c.combatFxScale * (1 - t), 0, Math.PI * 2);
        ctx.fill();
      } else if (["slash", "pin", "launch"].includes(m.kind)) {
        ctx.lineWidth = (m.kind === "pin" ? 3.5 : 2.5) * c.combatFxScale;
        ctx.beginPath();
        ctx.moveTo(-radius * (m.kind === "launch" ? 0.25 : 1), 0);
        ctx.lineTo(radius, 0);
        ctx.stroke();
        ctx.strokeStyle = "#ffffff";
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        ctx.stroke();
        if (m.kind === "pin") {
          ctx.beginPath();
          ctx.moveTo(-4, -7);
          ctx.lineTo(3, 0);
          ctx.lineTo(-4, 7);
          ctx.stroke();
        }
      } else if (m.kind === "perfectGuard" || m.kind === "guardBlock") {
        ctx.lineWidth = (m.kind === "perfectGuard" ? 3 : 2) * c.combatFxScale;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();
        if (m.kind === "perfectGuard") {
          ctx.strokeStyle = "#59bfff";
          ctx.lineWidth = 1.5 * c.combatFxScale;
          ctx.beginPath();
          ctx.arc(0, 0, radius * 0.7, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4,
              r = i % 2 ? radius * 0.12 : radius * (1.2 - t);
            if (!i) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
            else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
          ctx.closePath();
          ctx.fill();
        }
      } else if (m.kind === "star") {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4,
            r = i % 2 ? radius * 0.16 : radius;
          if (!i) ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
          else ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
        ctx.fill();
      } else {
        const r = m.kind === "converge" ? m.radius * (1 - t * 0.8) : radius;
        ctx.lineWidth = (m.kind === "combo" ? 3 : 2) * c.combatFxScale;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          const a = (i * Math.PI * 2) / 3 + t * 0.8;
          ctx.arc(0, 0, r, a, a + Math.PI * 0.53);
          ctx.stroke();
        }
        ctx.globalAlpha *= 0.35;
        ctx.shadowBlur = 0;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const p of this.particles) {
      if (barrageEvents.has(p.eventType) && !barrageEnabled(c)) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.globalAlpha = (1 - p.age / p.duration) * strength;
      ctx.fillStyle = p.color;
      if (p.crystal) {
        ctx.beginPath();
        ctx.moveTo(0, -p.size);
        ctx.lineTo(p.size * 0.55, 0);
        ctx.lineTo(0, p.size * 1.6);
        ctx.lineTo(-p.size * 0.55, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(-0.4, -p.size * 0.6, 0.8, p.size);
      } else {
        ctx.fillRect(-p.size * 1.5, -0.65, p.size * 3, 1.3);
      }
      ctx.restore();
    }
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of this.texts) {
      if (barrageEvents.has(p.kind) && !barrageEnabled(c)) continue;
      const progress = p.age / p.duration,
        pop = 1 + Math.sin(Math.min(1, progress * 5) * Math.PI) * 0.16,
        scale = pop * (p.scale || 1),
        label = t(p.sourceText || p.text, p.vars),
        header = p.header ? t(p.header) : "",
        maxWidth = Math.max(1, (game.width - 16) / scale);
      ctx.save();
      const headerWidth = header
          ? fitEffectFont(ctx, header, 22, maxWidth, "900")
          : 0,
        headerFont = ctx.font,
        labelWidth = fitEffectFont(
          ctx,
          label,
          p.kind === "combo" ? 19 + p.progress * 5 : p.strong ? 18 : 15,
          maxWidth,
          p.strong ? "900" : "700",
        ),
        halfWidth = (Math.max(labelWidth, headerWidth) * scale) / 2;
      ctx.translate(
        clamp(p.x, halfWidth + 8, game.width - halfWidth - 8),
        p.y - p.age * (c.floatSpeed || 35),
      );
      ctx.scale(scale, scale);
      ctx.globalAlpha = Math.min(1, (1 - progress) * 2) * strength;
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#173e57d9";
      ctx.strokeText(label, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(label, 0, 0);
      if (p.header) {
        ctx.font = headerFont;
        ctx.strokeText(header, 0, -25);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(header, 0, -25);
      }
      ctx.restore();
    }
    this.drawRecallTitle(ctx, game, c, strength);
    ctx.restore();
  }
  drawRecallTitle(ctx, game, config, strength) {
    const title = this.recallTitle;
    if (!title) return;
    const progress = clamp(title.age / title.duration, 0, 1),
      entrance = 1 - (1 - clamp(progress / 0.18, 0, 1)) ** 3,
      exit = clamp((1 - progress) / 0.3, 0, 1),
      alpha = Math.min(0.22 + entrance * 1.3, exit, 1) * strength,
      size = clamp(config.combatFxScale || 1, 0.65, 1.45),
      zoom = size * (1.22 - 0.22 * entrance),
      width = Math.min(game.width - 20, 320 * size),
      label = t(title.sourceText);
    if (alpha <= 0) return;

    // A quick ink-dark cut and chromatic speed lines give the skill its own
    // anime-style beat before the wall knives actually begin to move.
    ctx.save();
    ctx.globalAlpha = alpha * 0.13;
    ctx.fillStyle = "#081731";
    ctx.fillRect(0, 0, game.width, game.height);
    ctx.translate(title.x, title.y);
    ctx.rotate(-0.035);
    ctx.globalAlpha = alpha * 0.85;
    ctx.fillStyle = "#081b3de8";
    ctx.beginPath();
    ctx.moveTo(-width / 2, -24 * size);
    ctx.lineTo(width / 2 - 15 * size, -34 * size);
    ctx.lineTo(width / 2, 20 * size);
    ctx.lineTo(-width / 2 + 18 * size, 34 * size);
    ctx.closePath();
    ctx.fill();

    const sweep = width * (0.2 + 0.8 * entrance);
    ctx.globalAlpha = alpha;
    ctx.shadowColor = title.color;
    ctx.shadowBlur = 16 * config.combatFxGlow;
    ctx.lineCap = "round";
    ctx.lineWidth = 2.4 * size;
    ctx.strokeStyle = title.color;
    ctx.beginPath();
    ctx.moveTo(-sweep / 2 - 14 * size, -32 * size);
    ctx.lineTo(sweep / 2 + 10 * size, -37 * size);
    ctx.moveTo(-sweep / 2 + 8 * size, 31 * size);
    ctx.lineTo(sweep / 2 + 20 * size, 25 * size);
    ctx.stroke();
    ctx.strokeStyle = "#fff0b4";
    ctx.lineWidth = 1.5 * size;
    ctx.beginPath();
    ctx.moveTo(-sweep / 2 - 8 * size, -24 * size);
    ctx.lineTo(-sweep / 2 + 24 * size, -35 * size);
    ctx.moveTo(sweep / 2 - 20 * size, 34 * size);
    ctx.lineTo(sweep / 2 + 15 * size, 18 * size);
    ctx.stroke();

    ctx.scale(zoom, zoom);
    const maxTextWidth = Math.max(1, (game.width - 38) / zoom);
    fitEffectFont(ctx, label, 39, maxTextWidth, "900");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#081227";
    ctx.shadowBlur = 0;
    ctx.strokeText(label, 0, 0);
    ctx.lineWidth = 4;
    ctx.strokeStyle = "#2475dc";
    ctx.strokeText(label, 0, 0);
    const gradient = ctx.createLinearGradient?.(0, -24, 0, 24);
    if (gradient) {
      gradient.addColorStop(0, "#ffffff");
      gradient.addColorStop(0.45, "#ddfbff");
      gradient.addColorStop(1, title.color);
    }
    ctx.fillStyle = gradient || "#e9faff";
    ctx.shadowColor = title.color;
    ctx.shadowBlur = 15 * config.combatFxGlow;
    ctx.fillText(label, 0, 0);
    ctx.restore();
  }
  get stats() {
    return {
      particles: this.particles.length,
      marks: this.marks.length,
      texts: this.texts.length,
    };
  }
}
export function previewCombatEvents(kind, game) {
  const x = game.width / 2,
    y = game.height * 0.45;
  const event = {
    type: kind,
    x,
    y,
    direction: { x: 0.7, y: -0.7 },
    angle: -Math.PI / 4,
    damage: 24,
    scoreGain: 50,
    shotKills: 6,
    kills: 6,
    multiplier: 1.65,
    bonusXp: 3.2,
    pickupType: "power",
    radius: 65,
    duration: 0.45,
  };
  return kind === "recall"
    ? [
        {
          ...event,
          type: "recallIntro",
          duration: game.config.recallIntroDuration ?? 0.35,
        },
        event,
      ]
    : [event];
}
