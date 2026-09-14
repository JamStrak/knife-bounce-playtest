import { feedbackConfig } from "./feedback-schema.mjs";
export {
  playCombatCue,
  combatMixer,
  resetCombatAudio,
  cueRecipe,
  CombatMixer,
} from "./combat-audio.mjs";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const f = (n) => Number((n || 0).toFixed(1));
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
          });
        }
      };
      const text = (value, strong = false) => {
        if (!c.combatFxNumbers || !c.combatFxNumberCap) return;
        this.texts.push({
          x: clamp(e.x, 30, game.width - 30),
          y: e.y - 12 * size,
          text: value,
          color: strong ? color : "#ffffff",
          age: 0,
          duration: c.floatLife || 0.65,
          strong,
          progress,
          kind: e.type,
        });
      };
      if (e.type === "naturalLevelUp") {
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
        if (e.type === "recall") text("万刃归心", true);
        if (e.type === "pickup")
          text(
            e.pickupType === "power"
              ? "狂热 · 后续 " + game.powerBuff.shots + " 次"
              : { lightning: "连锁闪电", ring: "环形刀阵", seed: "爆弹种子" }[
                  e.pickupType
                ] || "战场增益",
            true,
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
          text(e.kills + " 连斩 · EXP ×" + f(e.multiplier), true);
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
    this.marks = this.marks.slice(
      -Math.max(8, Math.floor(c.combatFxBurstLimit) * 3),
    );
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
      if (
        ["slash", "pin", "launch"].includes(m.kind)
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
      if (["slash", "pin", "launch"].includes(m.kind)) {
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
      const t = p.age / p.duration,
        pop = 1 + Math.sin(Math.min(1, t * 5) * Math.PI) * 0.16;
      ctx.save();
      ctx.translate(p.x, p.y - p.age * (c.floatSpeed || 35));
      ctx.scale(pop * (p.scale || 1), pop * (p.scale || 1));
      ctx.globalAlpha = Math.min(1, (1 - t) * 2) * strength;
      ctx.font =
        (p.strong ? "900 " : "700 ") +
        (p.kind === "combo" ? 19 + p.progress * 5 : p.strong ? 18 : 15) +
        'px Club,"Microsoft YaHei"';
      ctx.lineWidth = 3;
      ctx.strokeStyle = "#173e57d9";
      ctx.strokeText(p.text, 0, 0);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, 0, 0);
      if (p.header) {
        ctx.font = '900 22px Club,"Microsoft YaHei"';
        ctx.strokeText(p.header, 0, -25);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(p.header, 0, -25);
      }
      ctx.restore();
    }
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
  return [
    {
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
    },
  ];
}
