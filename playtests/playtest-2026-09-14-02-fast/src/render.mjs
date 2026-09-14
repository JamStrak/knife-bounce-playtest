import {
  CombatFeedback,
  combatMixer,
  playCombatCue,
  resetCombatAudio,
  previewCombatEvents,
} from "./combat-feedback.mjs";
import { feedbackConfig } from "./feedback-schema.mjs";
import { defaultRender } from "./themes.mjs";
import { knifeAnchorAt, turnProgress } from "./knife-motion.mjs";
import { SoftDent } from "./soft-dent.mjs";
import { aimPoints, aimOpacity } from "./aim-guide.mjs";
import { arenaViewport } from "./arena-layout.mjs";
import { getKnife3D } from "./knife-3d.mjs";
import { idlePose, deathPose, entityVisualScale } from "./entity-effects.mjs";
import {
  hiddenBladeDepth,
  bladeCut,
  withBladeMask,
  contactKnifePose,
} from "./knife-mask.mjs";
import { AttachmentContacts } from "./attachment-contact.mjs";
import { pickupTypes } from "./field-rules.mjs";
import { remainingTurns } from "./pickup-motion.mjs";
import { bossMove } from "./stage-mode.mjs";
export const visualRadius = (e, g, corpse = false) =>
  e.r *
  g.config.enemyVisualScale *
  entityVisualScale(e, g.config) *
  (corpse ? g.config.corpseVisualScale : 1);
export function healthLayout(
  e,
  g,
  textWidth = 0,
  followRadius = visualRadius(e, g),
) {
  const c = g.config;
  const w = c.hpPlateAutoWidth
    ? Math.max(
        c.hpPlateWidth,
        textWidth + c.hpPlatePadding * 2 + Math.abs(c.hpTextOffsetX) * 2,
      )
    : c.hpPlateWidth;
  return {
    x: e.x + c.hpOffsetX,
    y: e.y + (c.hpFollowSize ? followRadius : 0) + c.hpOffsetY,
    w,
    h: c.hpPlateHeight,
    radius: Math.min(c.hpPlateRadius, w / 2, c.hpPlateHeight / 2),
  };
}
export function drawLayers(items) {
  for (const item of [...items].sort((a, b) => a.layer - b.layer)) item.draw();
}
export function stuckOffset(p, scale) {
  // Collision stores the projectile center. Place the visual tip at contact.
  const distance = Math.hypot(p.dx, p.dy);
  const factor = distance
    ? Math.max(0, distance - (p.radius || 0)) / distance
    : 0;
  return { x: p.dx * factor * scale, y: p.dy * factor * scale };
}
export function pinnedCorpse(p, g) {
  return {
    x: p.x - Math.cos(p.angle) * g.config.carryOffset,
    y: p.y - Math.sin(p.angle) * g.config.carryOffset + g.config.pinSag,
    r: p.corpse.r,
    variant: p.corpse.variant,
    type: p.corpse.type,
    hitAt: -10,
    wallSide: wallSide(p, g),
  };
}
export function wallSide(p, g) {
  if (
    p.nx &&
    (!p.ny || Math.abs(Math.cos(p.angle)) >= Math.abs(Math.sin(p.angle)))
  )
    return p.nx < 0 ? "Left" : "Right";
  if (p.ny) return p.ny < 0 ? "Top" : "Bottom";
  return [
    ["Left", Math.abs(p.x)],
    ["Right", Math.abs(g.width - p.x)],
    ["Top", Math.abs(p.y)],
    ["Bottom", Math.abs(g.height - p.y)],
  ].sort((a, b) => a[1] - b[1])[0][0];
}
export const maskPrefix = (e, corpse) =>
  corpse ? `wall${e.wallSide || "Top"}Mask` : "stuckKnifeMask";
export function maskGeometry(e, g, corpse = false) {
  const prefix = maskPrefix(e, corpse);
  return {
    x: e.x + g.config[`${prefix}OffsetX`],
    y: e.y + g.config[`${prefix}OffsetY`],
    scaleX: g.config[`${prefix}ScaleX`],
    scaleY: g.config[`${prefix}ScaleY`],
  };
}
export function embeddedPose(p, depth, age, duration) {
  const ease = 1 - Math.exp((-Math.max(0, age) / duration) * 5);
  return {
    x: p.x + (p.nx || 0) * (p.radius || 0) + Math.cos(p.angle) * depth * ease,
    y: p.y + (p.ny || 0) * (p.radius || 0) + Math.sin(p.angle) * depth * ease,
  };
}
export function recallPose(item, r, config) {
  const p = item.source,
    start = embeddedPose(
      p,
      config.wallEmbed,
      (p.age || 0) + r.age,
      config.embedDuration,
    ),
    t = r.timing;
  if (r.age < t.shake)
    return {
      ...start,
      angle: p.angle + Math.sin(r.age * t.frequency * Math.PI * 2) * t.amount,
      pull: 0,
      scale: p.scale || 1,
    };
  const pull = Math.min(1, (r.age - t.shake) / t.pull),
    ease = 1 - (1 - pull) ** 3;
  const progress = t.hover
    ? Math.max(0, Math.min(1, (r.age - t.shake - t.pull) / t.hover))
    : 1;
  const turn = turnProgress(progress, t.turnPower);
  const delta = Math.atan2(
    Math.sin(item.aimAngle - p.angle),
    Math.cos(item.aimAngle - p.angle),
  );
  const angle = p.angle + delta * turn;
  if (pull >= 1)
    return {
      ...knifeAnchorAt(
        item.center,
        angle,
        r.knifeArt,
        r.knifeLength,
        r.stats.scale,
      ),
      angle,
      pull,
      scale: r.stats.scale,
    };
  return {
    x: start.x + (item.x - start.x) * ease,
    y: start.y + (item.y - start.y) * ease,
    angle: p.angle,
    pull,
    scale: (p.scale || 1) + (r.stats.scale - (p.scale || 1)) * ease,
  };
}
export class Renderer {
  constructor(canvas, assets) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.assets = assets;
    this.contacts = new AttachmentContacts();
    this.resetEffects();
    this.audio = null;
  }
  resetEffects() {
    this.feedback = new CombatFeedback();
    this.pendingSounds = [];
    this.shakeOffset = { x: 0, y: 0 };
    resetCombatAudio(this.audio);
    this.particles = [];
    this.labels = [];
    this.ghosts = [];
    this.explosions = [];
    this.lightnings = [];
    this.whirlwinds = [];
    this.shakeUntil = 0;
    this.wallMaskReady = false;
    this.dents = new SoftDent();
  }
  color(key) {
    return this.assets.palette?.[key] || defaultRender[key];
  }
  resizeArenaEffects(beforeHeight, afterHeight) {
    const ratio = afterHeight / beforeHeight;
    const move = (p) => {
      if (Number.isFinite(p.y)) p.y *= ratio;
      for (const point of p.points || [])
        if (Number.isFinite(point.y)) point.y *= ratio;
    };
    for (const list of [
      this.ghosts,
      this.particles,
      this.labels,
      this.explosions,
      this.lightnings,
      this.whirlwinds,
      this.feedback.particles,
      this.feedback.marks,
      this.feedback.texts,
    ]) {
      for (const effect of list) move(effect);
    }
    this.wallMaskReady = false;
  }
  unlock() {
    try {
      this.audio ??= new (window.AudioContext || window.webkitAudioContext)();
      this.audio.resume();
    } catch {}
  }
  sound(type, c, detail) {
    return playCombatCue(this.audio, c, type, detail);
  }
  previewFeedback(kind, game, audible = true) {
    this.unlock();
    const events = previewCombatEvents(kind, game);
    this.feedback.consume(events, game, this.assets.palette);
    if (audible) combatMixer(this.audio)?.batch(events, game.config);
    return this.feedback.stats;
  }
  events(game, audible = true) {
    const events = game.events.splice(0),
      c = feedbackConfig(game.config);
    this.feedback.consume(events, game, this.assets.palette);
    this.pendingSounds.push(...events);
    this.pendingSounds = this.pendingSounds.slice(-80);
    combatMixer(this.audio)?.sync(game.config);
    if (audible) {
      combatMixer(this.audio)?.batch(this.pendingSounds, game.config);
      this.pendingSounds = [];
    }
    for (const e of events) {
      if (c.combatFxOn && c.combatFxIntensity) {
        if (e.type === "lightning") this.lightnings.push({ ...e, age: 0 });
        if (e.type === "whirlwind") this.whirlwinds.push({ ...e, age: 0 });
        if (e.type === "explode") this.explosions.push({ ...e, age: 0 });
        if (["hit", "kill", "pin", "leak", "pickup"].includes(e.type))
          this.shakeUntil = game.clock + game.config.shakeTime;
      }
      // Enemy pose and knife attachment remain independent of decorative feedback.
      if (e.type === "kill" && game.config.enemyDeathOn) {
        const pose = idlePose(
          e,
          game.config,
          e.at ?? game.clock,
          game.presentationStatic,
        );
        this.ghosts.push({ ...pose, type: e.enemyType, age: 0, hitAt: -10 });
      }
      if (e.type === "pin" && e.enemyId != null)
        this.ghosts = this.ghosts.filter(
          (ghost) => ghost.enemyId !== e.enemyId,
        );
    }
    const effectCap = Math.max(8, c.combatFxBurstLimit * 2);
    this.lightnings = this.lightnings.slice(-effectCap);
    this.whirlwinds = this.whirlwinds.slice(-effectCap);
    this.explosions = this.explosions.slice(-effectCap);
    if (!c.combatFxOn || !c.combatFxIntensity) {
      this.lightnings = [];
      this.whirlwinds = [];
      this.explosions = [];
      this.shakeUntil = 0;
    }
  }
  knife(
    x,
    y,
    a,
    scale,
    g,
    time = 0,
    appearance = null,
    hiddenDepth = 0,
    contact = null,
  ) {
    const c = this.ctx;
    const length = appearance?.knifeLength ?? g.config.knifeLength;
    const meta = appearance?.knifeArt ?? this.assets.entries.knife?.meta;
    const masked = (mesh, draw) => {
      const pose =
        contact && g.config.knifeLocalMask
          ? contactKnifePose(
              contact,
              a,
              meta,
              length,
              scale,
              g.config.stuckKnifeMask ? hiddenDepth : 0,
              g.config.knifeMinVisible,
              mesh,
            )
          : { x, y, hidden: hiddenDepth };
      if (
        !g.config.knifeLocalMask ||
        !g.config.stuckKnifeMask ||
        pose.hidden <= 0
      )
        return draw(pose.x, pose.y);
      const reach =
        Math.max(
          g.width,
          g.height,
          length * scale * Math.max(meta?.width || 1, meta?.height || 1),
        ) * 4;
      return withBladeMask(
        c,
        pose.x,
        pose.y,
        a,
        bladeCut(meta, length, scale, pose.hidden, mesh),
        reach,
        () => draw(pose.x, pose.y),
      );
    };
    if (
      g.config.knife3D &&
      masked(true, (px, py) =>
        getKnife3D().draw(
          c,
          px,
          py,
          a,
          appearance?.knifeLength ?? g.config.knifeLength,
          scale,
          appearance?.knifeArt ?? this.assets.entries.knife?.meta,
          g.config,
          this.assets.palette,
        ),
      )
    )
      return;
    if (
      masked(false, (px, py) =>
        this.assets.draw(
          c,
          "knife",
          px,
          py,
          (appearance?.knifeLength ?? g.config.knifeLength) * scale,
          a,
          time,
          appearance?.knifeArt,
        ),
      )
    )
      return;
    masked(false, (px, py) => {
      c.save();
      c.translate(px, py);
      c.rotate(a);
      c.fillStyle = "#eef5cc";
      c.fillRect(-24 * scale, -3 * scale, 25 * scale, 6 * scale);
      c.restore();
    });
  }
  launcherDisc(base, g) {
    const c = this.ctx,
      r = g.config.discRadius;
    if (this.assets.draw(c, "launcherDisc", base.x, base.y, r * 2, 0, g.clock))
      return;
    c.save();
    c.fillStyle = this.color("shadow");
    c.beginPath();
    c.arc(base.x, base.y + r * 0.16, r, 0, Math.PI * 2);
    c.fill();
    const rim = c.createLinearGradient(
      base.x - r,
      base.y - r,
      base.x + r,
      base.y + r,
    );
    rim.addColorStop(0, "#ffffff");
    rim.addColorStop(0.45, this.color("discRim"));
    rim.addColorStop(1, this.color("discCore"));
    c.fillStyle = rim;
    c.beginPath();
    c.arc(base.x, base.y, r, 0, Math.PI * 2);
    c.fill();
    const inner = Math.max(2, r - g.config.discRingWidth);
    c.fillStyle = this.color("discFace");
    c.beginPath();
    c.arc(base.x, base.y, inner, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = this.color("discRim");
    c.lineWidth = 1;
    c.stroke();
    c.fillStyle = this.color("discCore");
    c.beginPath();
    c.arc(base.x, base.y, r * 0.24, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#ffffffaa";
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(base.x, base.y, r - 1, Math.PI * 1.12, Math.PI * 1.85);
    c.stroke();
    c.restore();
  }
  launcherAtkBadge(g) {
    if (!g.config.launcherAtkOn) return;
    const c = this.ctx,
      scale = Math.min(g.config.launcherAtkScale, g.width / 110),
      text = `ATK ${Number(g.stats.damage.toFixed(1))}`;
    c.save();
    c.font = 'bold 12px "Microsoft YaHei"';
    const width = c.measureText(text).width + 20,
      x = Math.max(
        (width * scale) / 2,
        Math.min(
          g.width - (width * scale) / 2,
          g.origin.x + g.config.launcherAtkOffsetX,
        ),
      ),
      y = Math.max(
        12 * scale,
        Math.min(
          g.height - 12 * scale,
          g.origin.y + g.config.launcherAtkOffsetY,
        ),
      );
    c.translate(x, y);
    c.scale(scale, scale);
    c.fillStyle = g.attackPower > 1 ? "#fff0c5" : "#f7fcff";
    c.strokeStyle =
      g.attackPower > 1 ? this.color("pickupPower") : this.color("discRim");
    c.lineWidth = 1.5;
    c.beginPath();
    c.roundRect(-width / 2, -11, width, 22, 7);
    c.fill();
    c.stroke();
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillStyle = g.attackPower > 1 ? "#74451a" : "#35556a";
    c.fillText(text, 0, 0);
    c.restore();
  }
  launcherPowerBadge(g) {
    if (!g.config.powerBadgeOn) return;
    const shots = g.powerBuff.shots,
      active = g.phase === "flight" && g.fieldBuffs.power > 1;
    if (!shots && !active) return;
    const c = this.ctx,
      scale = Math.min(g.config.powerBadgeScale, g.width / 180),
      text = `+${Math.round((g.attackPower - 1) * 100)}% · ${shots ? `后续 ${shots} 次` : "本次"}`;
    c.save();
    c.font = 'bold 11px "Microsoft YaHei"';
    const width = c.measureText(text).width + 40,
      height = 30,
      x = Math.max(
        (width * scale) / 2,
        Math.min(
          g.width - (width * scale) / 2,
          g.origin.x + g.config.powerBadgeOffsetX,
        ),
      ),
      y = Math.max(
        (height * scale) / 2,
        Math.min(
          g.height - (height * scale) / 2,
          g.origin.y + g.config.powerBadgeOffsetY,
        ),
      );
    c.translate(x, y);
    c.scale(scale, scale);
    c.fillStyle = "#fff3c6";
    c.strokeStyle = this.color("pickupPower");
    c.lineWidth = 2;
    c.shadowColor = c.strokeStyle;
    c.shadowBlur = 7;
    c.beginPath();
    c.roundRect(-width / 2, -height / 2, width, height, 10);
    c.fill();
    c.stroke();
    c.shadowBlur = 0;
    const iconX = -width / 2 + 16;
    if (!this.assets.draw(c, "pickupPower", iconX, 0, 22, 0, 0)) {
      c.fillStyle = this.color("pickupPower");
      c.font = 'bold 20px "Microsoft YaHei"';
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText("✦", iconX, 0);
    }
    c.font = 'bold 11px "Microsoft YaHei"';
    c.fillStyle = "#74451a";
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(text, -width / 2 + 32, 0);
    c.restore();
  }
  pickup(p, g) {
    const c = this.ctx,
      type = pickupTypes[p.type],
      radius = g.config.cell * g.config.pickupRadius;
    c.save();
    if (!this.assets.draw(c, type.slot, p.x, p.y, radius * 2, 0, 0)) {
      c.shadowColor = this.color(type.color);
      c.shadowBlur = 8;
      const fill = c.createRadialGradient(
        p.x - radius * 0.3,
        p.y - radius * 0.4,
        0,
        p.x,
        p.y,
        radius,
      );
      fill.addColorStop(0, "#ffffff");
      fill.addColorStop(1, this.color(type.color));
      c.fillStyle = fill;
      c.beginPath();
      c.arc(p.x, p.y, radius, 0, Math.PI * 2);
      c.fill();
      c.shadowBlur = 0;
      c.strokeStyle = "#ffffff";
      c.lineWidth = 2;
      c.stroke();
      c.fillStyle = "#254d67";
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.font = `bold ${radius * 1.2}px sans-serif`;
      c.fillText(type.glyph, p.x, p.y);
    }
    c.restore();
    this.healthBadge(
      {
        ...p,
        x: p.x + g.config.pickupTimerOffsetX,
        y: p.y + g.config.pickupTimerOffsetY,
        r: radius,
      },
      g,
      false,
      { text: String(remainingTurns(p, g)), clock: true, radius },
    );
  }
  monsterAppearance(e, g, corpse = false) {
    const hit = g.clock - e.hitAt < g.config.hitFlash;
    const scale = hit ? 1 + g.config.hitScale : 1;
    const fastSlot = corpse ? "corpseFast" : "enemyFast";
    const ultraSlot = corpse ? "corpseUltraFast" : "enemyUltraFast";
    const key =
      (e.type || e.enemyType) === "ultraFast" && this.assets.entries[ultraSlot]
        ? ultraSlot
        : (e.type || e.enemyType) === "fast" && this.assets.entries[fastSlot]
          ? fastSlot
          : e.variant === 2 && this.assets.entries.enemyBomb
            ? "enemyBomb"
            : corpse
              ? e.variant === 1 && this.assets.entries.corpseOrange
                ? "corpseOrange"
                : "corpse"
              : hit && this.assets.entries.enemyHit
                ? "enemyHit"
                : e.variant === 1 && this.assets.entries.enemyOrange
                  ? "enemyOrange"
                  : "enemy";
    return { key, scale, hit };
  }
  attachmentContact(
    e,
    g,
    hint,
    angle,
    token,
    corpse = false,
    time = 0,
    override = null,
  ) {
    const radius = visualRadius(e, g, corpse),
      { key, scale } = this.monsterAppearance(e, g, corpse);
    const point = this.contacts.contact(
      override || this.assets.entries[key],
      time,
      { x: (hint.x - e.x) / radius, y: (hint.y - e.y) / radius },
      angle,
      scale,
      token,
    );
    return {
      x:
        e.x + point.x * radius + Math.cos(angle) * g.config.knifeContactOverlap,
      y:
        e.y + point.y * radius + Math.sin(angle) * g.config.knifeContactOverlap,
    };
  }
  wallContact(p, g) {
    const hint = {
      x: p.x + (p.nx || 0) * (p.radius || 0),
      y: p.y + (p.ny || 0) * (p.radius || 0),
    };
    if (!p.corpse) return hint;
    const e = pinnedCorpse(p, g),
      radius = visualRadius(e, g, true),
      { key } = this.monsterAppearance(e, g, true);
    let surface = null;
    if (g.config.wallDentEnabled && g.config.wallDentDepth > 0) {
      this.dentProbe ??= document.createElement("canvas").getContext("2d");
      const contactY =
        -Math.sin(p.angle) * (p.x - e.x) +
        Math.cos(p.angle) * (p.y - e.y) +
        g.config.wallDentOffset;
      this.dents.draw(
        this.dentProbe,
        p,
        this.assets.entries[key],
        radius * 2,
        p.angle,
        p.age || 0,
        contactY,
        g.config,
        (ctx) => {
          if (!this.assets.draw(ctx, key, 0, 0, radius * 2, 0, p.age || 0)) {
            ctx.fillStyle = "#a2b16f";
            ctx.beginPath();
            ctx.arc(0, 0, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        },
      );
      const cached = this.dents.cache.get(p);
      if (cached)
        surface = cached.contactEntry ??= {
          img: cached.canvas,
          revision: cached.signature,
          meta: {
            width: cached.span / (radius * 2),
            height: cached.span / (radius * 2),
            anchorX: 0.5,
            anchorY: 0.5,
            rotation: (p.angle * 180) / Math.PI,
            frames: 1,
            columns: 1,
            fps: 1,
            loop: false,
          },
        };
    }
    return this.attachmentContact(
      e,
      g,
      hint,
      p.angle,
      p,
      true,
      p.age || 0,
      surface,
    );
  }
  monster(e, g, corpse = false, time = 0, pin = null) {
    const c = this.ctx,
      radius = visualRadius(e, g, corpse),
      { key, scale, hit } = this.monsterAppearance(e, g, corpse);
    c.save();
    if (!corpse) {
      c.fillStyle = this.color("shadow");
      c.beginPath();
      c.ellipse(
        e.x,
        e.y + radius * 0.83,
        radius * 0.8,
        radius * 0.24,
        0,
        0,
        Math.PI * 2,
      );
      c.fill();
    }
    c.translate(e.x, e.y);
    c.scale(scale, 1 / scale);
    if (hit) c.filter = "brightness(1.7)";
    const sprite = (ctx) => {
      if (!this.assets.draw(ctx, key, 0, 0, radius * 2, 0, time)) {
        ctx.fillStyle = corpse ? "#a2b16f" : "#d3e794";
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    if (corpse && pin && g.config.wallDentEnabled) {
      const contactY =
        -Math.sin(pin.angle) * (pin.x - e.x) +
        Math.cos(pin.angle) * (pin.y - e.y) +
        g.config.wallDentOffset;
      this.dents.draw(
        c,
        pin,
        this.assets.entries[key],
        radius * 2,
        pin.angle,
        time,
        contactY,
        g.config,
        sprite,
      );
    } else sprite(c);
    c.restore();
  }
  maskKnife(e, g, corpse = false) {
    if (g.config.knifeLocalMask) return;
    const ratio = g.config[maskPrefix(e, corpse) + "Ratio"];
    if (!g.config.stuckKnifeMask || ratio <= 0) return;
    const c = this.ctx,
      radius = visualRadius(e, g, corpse) * ratio,
      pose = maskGeometry(e, g, corpse);
    c.beginPath();
    c.rect(0, 0, g.width, g.height);
    c.moveTo(pose.x + radius * pose.scaleX, pose.y);
    c.ellipse(
      pose.x,
      pose.y,
      radius * pose.scaleX,
      radius * pose.scaleY,
      0,
      0,
      Math.PI * 2,
    );
    c.clip("evenodd");
  }
  healthBadge(
    e,
    g,
    danger,
    { text = String(Math.ceil(e.hp)), clock = false, radius } = {},
  ) {
    const cfg = g.config;
    if (clock ? !cfg.pickupTimerOn : !cfg.hpEnabled) return;
    const c = this.ctx;
    c.save();
    c.font = `${cfg.hpFontBold ? "bold " : ""}${cfg.hpFontSize}px Club,"Microsoft YaHei"`;
    c.textAlign = "center";
    c.textBaseline = "alphabetic";
    const iconSize = clock ? cfg.hpFontSize * 0.75 : 0,
      iconSpace = clock ? iconSize + cfg.hpFontSize * 0.25 : 0,
      textWidth = c.measureText(text).width,
      p = healthLayout(e, g, textWidth + iconSpace, radius),
      alpha = c.globalAlpha;
    if (cfg.hpPlateEnabled && p.w > 0 && p.h > 0) {
      c.globalAlpha = alpha * cfg.hpPlateOpacity;
      c.fillStyle = this.color(danger ? "healthDanger" : "health");
      c.beginPath();
      c.roundRect(p.x - p.w / 2, p.y - p.h / 2, p.w, p.h, p.radius);
      c.fill();
    }
    c.globalAlpha = alpha * cfg.hpTextOpacity;
    c.fillStyle = this.color("healthText");
    const x = p.x + cfg.hpTextOffsetX,
      y = p.y + cfg.hpTextOffsetY;
    c.fillText(text, x + iconSpace / 2, y);
    if (clock) {
      const cx = x - (textWidth + iconSpace) / 2 + iconSize / 2,
        cy = y - cfg.hpFontSize * 0.36;
      c.strokeStyle = this.color("healthText");
      c.lineWidth = Math.max(1, cfg.hpFontSize * 0.09);
      c.beginPath();
      c.arc(cx, cy, iconSize / 2, 0, Math.PI * 2);
      c.stroke();
      c.beginPath();
      c.moveTo(cx, cy - iconSize * 0.28);
      c.lineTo(cx, cy);
      c.lineTo(cx + iconSize * 0.23, cy + iconSize * 0.1);
      c.stroke();
    }
    c.restore();
  }
  paintKnifeMask(e, g, corpse = false, time = 0) {
    const c = this.ctx,
      pose = maskGeometry(e, g, corpse);
    c.save();
    c.translate(pose.x, pose.y);
    c.scale(pose.scaleX, pose.scaleY);
    {
      c.fillStyle = "#ffffff";
      c.beginPath();
      c.arc(
        0,
        0,
        visualRadius(e, g, corpse) * g.config[maskPrefix(e, corpse) + "Ratio"],
        0,
        Math.PI * 2,
      );
      c.fill();
    }
    c.restore();
  }
  drawCorpseMasked(g, occluders, draw) {
    const target = this.ctx;
    if (
      g.config.knifeLocalMask ||
      !g.config.stuckKnifeMask ||
      !occluders.length
    ) {
      draw(target);
      return;
    }
    this.wallMaskCanvas ??= document.createElement("canvas");
    this.wallKnifeCanvas ??= document.createElement("canvas");
    for (const canvas of [this.wallMaskCanvas, this.wallKnifeCanvas]) {
      if (canvas.width !== this.canvas.width) canvas.width = this.canvas.width;
      if (canvas.height !== this.canvas.height)
        canvas.height = this.canvas.height;
    }
    const mask = this.wallMaskCanvas.getContext("2d"),
      layer = this.wallKnifeCanvas.getContext("2d");
    // Batch attached knives against the union of adjustable circular masks.
    // The buffers are reused; only the mask is built once per rendered frame.
    if (!this.wallMaskReady) {
      mask.resetTransform();
      mask.clearRect(0, 0, this.canvas.width, this.canvas.height);
      mask.setTransform(target.getTransform());
      this.ctx = mask;
      try {
        for (const { p, alpha } of occluders) {
          mask.globalAlpha = alpha;
          this.paintKnifeMask(pinnedCorpse(p, g), g, true, p.age || 0);
        }
      } finally {
        mask.globalAlpha = 1;
        this.ctx = target;
      }
      this.wallMaskReady = true;
    }
    layer.resetTransform();
    layer.clearRect(0, 0, this.canvas.width, this.canvas.height);
    layer.setTransform(target.getTransform());
    this.ctx = layer;
    try {
      draw(layer);
    } finally {
      this.ctx = target;
    }
    layer.save();
    layer.resetTransform();
    layer.globalCompositeOperation = "destination-out";
    layer.drawImage(this.wallMaskCanvas, 0, 0);
    layer.restore();
    target.save();
    target.resetTransform();
    target.drawImage(this.wallKnifeCanvas, 0, 0);
    target.restore();
  }
  aimGuide(g, origin, angle) {
    if (!g.config.aimEnabled) return;
    const c = this.ctx,
      alpha = c.globalAlpha;
    c.save();
    if (g.config.aimStyle === "spike") {
      const cfg = g.config;
      const length =
        cfg.aimMaxLength > 0
          ? Math.min(cfg.aimSpikeLength, cfg.aimMaxLength)
          : cfg.aimSpikeLength;
      // A direction indicator, independent of ballistic trajectory and dot spacing.
      c.beginPath();
      c.rect(0, 0, g.width, g.height);
      c.clip();
      c.translate(origin.x, origin.y);
      c.rotate(angle);
      c.translate(cfg.aimStartOffset, 0);
      c.globalAlpha = alpha * cfg.aimOpacity;
      const shape = (width) => {
        c.beginPath();
        c.moveTo(0, 0);
        c.lineTo(length * 0.06, -width / 2);
        c.quadraticCurveTo(length * 0.55, -width * 0.24, length, 0);
        c.quadraticCurveTo(
          length * 0.55,
          width * 0.24,
          length * 0.06,
          width / 2,
        );
        c.closePath();
      };
      const gradient = (rgb) => {
        const fill = c.createLinearGradient(0, 0, length, 0);
        for (const t of [0, 0.15, 0.4, 0.7, 1]) {
          const opacity = cfg.aimFade ? (1 - t) ** cfg.aimFadePower : 1;
          fill.addColorStop(t, "rgba(" + rgb + "," + opacity + ")");
        }
        return fill;
      };
      c.shadowColor = "#42cfff";
      c.shadowBlur = cfg.aimSpikeGlow;
      c.fillStyle = gradient("66,190,255");
      shape(cfg.aimSpikeWidth);
      c.fill();
      c.shadowBlur = 0;
      c.fillStyle = gradient("235,252,255");
      shape(cfg.aimSpikeWidth * 0.42);
      c.fill();
      c.restore();
      return;
    }
    c.fillStyle = this.color("aim");
    for (const p of aimPoints(g, origin, angle)) {
      c.globalAlpha = alpha * aimOpacity(p.progress, g.config);
      c.beginPath();
      c.arc(p.x, p.y, g.config.aimDotRadius, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
  }
  drawWhirlwind(p, g) {
    const c = this.ctx,
      t = Math.min(1, p.age / p.duration),
      sweep = 1 - (1 - t) ** 2,
      angle = p.angle + sweep * Math.PI * 2,
      radius = Math.max(1, p.radius),
      alpha = g.config.giantWhirlOpacity * (1 - t) ** 0.65;
    c.save();
    // The slash shares the gameplay boundary; wall impacts never cover the outer UI.
    c.beginPath();
    c.rect(0, 0, g.width, g.height);
    c.clip();
    c.translate(p.x, p.y);
    const glow = c.createRadialGradient(0, 0, 0, 0, 0, radius);
    glow.addColorStop(0, this.color("hitParticle"));
    glow.addColorStop(1, `${this.color("hitParticle").slice(0, 7)}00`);
    c.globalAlpha = alpha * 0.18;
    c.fillStyle = glow;
    c.beginPath();
    c.arc(0, 0, radius, 0, Math.PI * 2);
    c.fill();
    // Three tapered trails form one sweep, not repeated damage ticks.
    for (let blade = 0; blade < 3; blade++) {
      const head = angle + (blade * Math.PI * 2) / 3;
      const ribbon = (width) => {
        c.beginPath();
        for (const side of [1, -1])
          for (let i = 0; i <= 24; i++) {
            const u = (side === 1 ? i : 24 - i) / 24,
              a = head - 1.8 + u * 1.8,
              thickness = Math.sin(Math.PI * u) * (0.035 + u * 0.065),
              r = radius * (0.7 + u * 0.23 + side * thickness * width);
            c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
          }
        c.closePath();
        c.fill();
      };
      c.globalAlpha = alpha;
      c.fillStyle = this.color("hitParticle");
      ribbon(1);
      c.globalAlpha = alpha * 0.9;
      c.fillStyle = "#ffffff";
      ribbon(0.35);
    }
    c.restore();
  }
  draw(g, angle, aiming, dt = 0) {
    this.wallMaskReady = false;
    this.events(g, dt > 0);
    const c = this.ctx,
      dpr = Math.min(window.devicePixelRatio || 1, 2),
      viewport = arenaViewport(g, this.assets.arena);
    if (
      this.canvas.width !== Math.round(viewport.width * dpr) ||
      this.canvas.height !== Math.round(viewport.height * dpr)
    ) {
      this.canvas.width = Math.round(viewport.width * dpr);
      this.canvas.height = Math.round(viewport.height * dpr);
      this.canvas.style.aspectRatio = `${viewport.width}/${viewport.height}`;
    }
    // The responsive world height may be fractional; clear every backing pixel
    // so partially covered edge pixels cannot accumulate on paused redraws.
    c.resetTransform();
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.save();
    if (g.clock < this.shakeUntil) {
      const s =
        g.config.shake *
        Math.min(2, feedbackConfig(g.config).combatFxIntensity);
      if (dt > 0)
        this.shakeOffset = {
          x: (Math.random() - 0.5) * s,
          y: (Math.random() - 0.5) * s,
        };
      c.translate(this.shakeOffset.x, this.shakeOffset.y);
    }
    c.fillStyle = this.color("floor");
    c.fillRect(0, 0, viewport.width, viewport.height);
    const bg = this.assets.entries.background;
    if (bg) c.drawImage(bg.img, 0, 0, viewport.width, viewport.height);
    c.translate(viewport.x, viewport.y);
    if (!bg && this.assets.entries.floorTile) {
      const tile = this.assets.entries.floorTile.img;
      for (let row = 0; row < g.config.rows; row++)
        for (let col = 0; col < g.config.cols; col++)
          c.drawImage(
            tile,
            col * g.config.cell,
            row * g.rowHeight,
            g.config.cell,
            g.rowHeight,
          );
    }
    c.strokeStyle = this.color("grid");
    c.lineWidth = 1;
    const cell = g.config.cell;
    for (let x = 0; x <= g.width; x += cell) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, g.height);
      c.stroke();
    }
    for (let y = 0; y <= g.height + 1e-6; y += g.rowHeight) {
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(g.width, y);
      c.stroke();
    }
    c.fillStyle = this.color("dangerZone");
    c.fillRect(0, g.height - g.rowHeight, g.width, g.rowHeight);
    c.strokeStyle = this.color("dangerLine");
    c.setLineDash([5, 6]);
    c.beginPath();
    c.moveTo(0, g.height - 3);
    c.lineTo(g.width, g.height - 3);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = this.color("floorText");
    c.font = '10px "Microsoft YaHei"';
    c.textAlign = "center";
    c.fillText("守住底线", g.width * 0.5, g.height - g.rowHeight * 0.5);
    const layers = [],
      badges = [];
    const add = (layer, draw) => layers.push({ layer, draw });
    if (g.config.fieldItemsOn)
      for (const p of g.pickups) add(25, () => this.pickup(p, g));
    const corpse = (p, alpha) => {
      c.save();
      c.globalAlpha = alpha;
      this.monster(pinnedCorpse(p, g), g, true, p.age || 0, p);
      c.restore();
    };
    const occluders = g.pins
      .filter((p) => p.corpse)
      .map((p) => ({ p, alpha: Math.min(1, (g.config.pinLife - p.age) / 2) }));
    const preparing = (g.recall?.items || [])
      .filter((item) => !item.launched)
      .map((item) => ({
        p: item.source,
        pose: recallPose(item, g.recall, g.config),
      }));
    for (const { p, pose } of preparing)
      if (p.corpse && pose.pull < 1)
        occluders.push({ p, alpha: 1 - pose.pull });
    for (const p of g.pins) {
      const alpha = Math.min(1, (g.config.pinLife - p.age) / 2);
      if (p.corpse) add(g.config.layerCorpse, () => corpse(p, alpha));
    }
    if (g.pins.length)
      add(g.config.layerWallKnife, () =>
        this.drawCorpseMasked(g, occluders, (c) => {
          for (const p of g.pins) {
            const alpha = Math.min(1, (g.config.pinLife - p.age) / 2);
            const embedded = embeddedPose(
              p,
              g.config.wallEmbed,
              p.age,
              g.config.embedDuration,
            );
            c.save();
            c.globalAlpha = alpha;
            this.knife(
              embedded.x,
              embedded.y,
              p.angle +
                Math.sin(p.age * 45) * Math.exp(-p.age * 9) * g.config.wobble,
              p.scale,
              g,
              p.age,
              null,
              hiddenBladeDepth(
                g.config.wallEmbed,
                p.age,
                g.config.embedDuration,
                g.config.knifeMaskDepthScale,
              ),
              g.config.knifeLocalMask ? this.wallContact(p, g) : null,
            );
            c.restore();
          }
        }),
      );
    const pinnedIds = new Set(
      occluders.map(({ p }) => p.corpse?.enemyId).filter((id) => id != null),
    );
    const deaths = [];
    this.ghosts = this.ghosts.slice(-g.config.deathVisualCap).filter((e) => {
      e.age += dt;
      if (pinnedIds.has(e.enemyId)) return false;
      const pose = deathPose(e, g.config, g.width, g.height);
      if (pose) deaths.push(pose);
      return !!pose;
    });
    for (const source of g.enemies) {
      if (source.hp <= 0) continue;
      const e = idlePose(source, g.config, g.clock, g.presentationStatic);
      const squid = this.assets.entries.enemyUltraFast;
      if (squid) squid.meta.fps = g.config.ultraFastAnimationFps ?? 8;
      const advance = e.boss
        ? bossMove(g, e)
        : g.round % g.config.moveEvery === 0
          ? e.summoned
            ? g.config.bossSummonAdvance
            : g.config.advance *
              (e.type === "ultraFast"
                ? g.config.ultraFastAdvance
                : e.type === "fast"
                  ? g.config.fastAdvance
                  : 1)
          : 0;
      const danger = e.row + advance >= g.config.rows,
        radius = visualRadius(e, g);
      add(g.config.layerEnemy, () => {
        if (danger) {
          c.strokeStyle = "#fa8764";
          c.lineWidth = 2;
          c.beginPath();
          c.arc(e.x, e.y, radius + 6, 0, Math.PI * 2);
          c.stroke();
        }
        this.monster(
          e,
          g,
          false,
          e.type !== "ultraFast" && g.clock - e.hitAt < g.config.hitFlash
            ? g.clock - e.hitAt
            : e.idleTime,
        );
      });
      for (const p of e.stuck)
        add(g.config.layerStuckKnife, () => {
          const offset = stuckOffset(
            p,
            g.config.enemyVisualScale *
              entityVisualScale(e, g.config) *
              e.idleScale,
          );
          const embedded = embeddedPose(
            {
              x: e.x + offset.x,
              y: e.y + offset.y,
              angle: p.angle,
            },
            g.config.enemyEmbed,
            g.clock - (p.at ?? g.clock - 1),
            g.config.embedDuration,
          );
          c.save();
          this.maskKnife(e, g);
          this.knife(
            embedded.x,
            embedded.y,
            p.angle,
            p.scale,
            g,
            0,
            null,
            hiddenBladeDepth(
              g.config.enemyEmbed,
              g.clock - (p.at ?? g.clock - 1),
              g.config.embedDuration,
              g.config.knifeMaskDepthScale,
            ),
            g.config.knifeLocalMask
              ? this.attachmentContact(
                  e,
                  g,
                  { x: e.x + offset.x, y: e.y + offset.y },
                  p.angle,
                  p,
                  false,
                  g.clock - e.hitAt < g.config.hitFlash
                    ? g.clock - e.hitAt
                    : e.idleTime,
                )
              : null,
          );
          c.restore();
        });
      badges.push(() => this.healthBadge(e, g, danger));
    }
    add(50, () => {
      for (const base of g.origins) {
        if (g.config.discLauncher) {
          this.launcherDisc(base, g);
          continue;
        }
        if (this.assets.draw(c, "launcher", base.x, base.y, 32, 0, g.clock))
          continue;
        c.fillStyle = "#d3b16c";
        c.beginPath();
        c.roundRect(base.x - 11, base.y + 9, 22, 7, 3);
        c.fill();
        c.fillStyle = "#355238";
        c.beginPath();
        c.arc(base.x, base.y, 8, 0, Math.PI * 2);
        c.fill();
      }
    });
    add(g.config.layerFlyingKnife, () => {
      if (g.phase === "aim") {
        for (const o of g.launchPattern(angle)) {
          if (!g.config.discLauncher) {
            c.strokeStyle = this.color("origin");
            c.lineWidth = 1;
            c.beginPath();
            c.arc(o.x, o.y, 19, 0, Math.PI * 2);
            c.stroke();
          }
          this.knife(o.x, o.y, o.angle, g.stats.scale, g);
          if (aiming || g.config.aimAlwaysShow) this.aimGuide(g, o, o.angle);
          if (g.config.discLauncher && g.config.discShowOrder) {
            c.save();
            c.fillStyle = this.color("floatText");
            c.font = 'bold 10px "Microsoft YaHei"';
            c.textAlign = "center";
            c.fillText(
              String(o.index),
              o.x + Math.cos(o.angle) * 12,
              o.y + Math.sin(o.angle) * 12,
            );
            c.restore();
          }
        }
      }
    });
    for (const k of g.knives)
      add(g.config.layerFlyingKnife, () => {
        c.strokeStyle = this.color("trail");
        c.lineWidth = k.r;
        c.lineCap = "round";
        c.beginPath();
        k.trail.forEach((p, i) =>
          i ? c.lineTo(p.x, p.y) : c.moveTo(p.x, p.y),
        );
        c.stroke();
        const a = Math.atan2(k.vy, k.vx);
        this.knife(k.x, k.y, a, k.scale, g, k.age, k.recallAppearance);
      });
    if (g.recall) {
      const r = g.recall;
      for (const { p, pose } of preparing) {
        if (p.corpse && pose.pull < 1)
          add(g.config.layerCorpse, () => corpse(p, 1 - pose.pull));
      }
      add(g.config.layerFlyingKnife, () =>
        this.drawCorpseMasked(g, occluders, (c) => {
          for (const { p, pose } of preparing) {
            c.save();
            c.strokeStyle = this.color("recall");
            c.lineWidth = 2;
            c.shadowColor = this.color("recall");
            c.shadowBlur = 8;
            const start = embeddedPose(
              p,
              g.config.wallEmbed,
              (p.age || 0) + r.age,
              g.config.embedDuration,
            );
            const withdrawn = Math.max(
              0,
              (start.x - pose.x) * Math.cos(p.angle) +
                (start.y - pose.y) * Math.sin(p.angle),
            );
            let depth =
              pose.pull >= 1
                ? 0
                : Math.max(
                    0,
                    hiddenBladeDepth(
                      g.config.wallEmbed,
                      (p.age || 0) + r.age,
                      g.config.embedDuration,
                      g.config.knifeMaskDepthScale,
                    ) -
                      withdrawn * g.config.knifeMaskDepthScale,
                  );
            let drawPose = pose;
            if (g.config.knifeLocalMask && pose.pull < 1) {
              const contact = this.wallContact(p, g),
                full = hiddenBladeDepth(
                  g.config.wallEmbed,
                  (p.age || 0) + r.age,
                  g.config.embedDuration,
                  g.config.knifeMaskDepthScale,
                );
              const attached = contactKnifePose(
                contact,
                pose.angle,
                r.knifeArt,
                r.knifeLength,
                p.scale || 1,
                g.config.stuckKnifeMask ? full : 0,
                g.config.knifeMinVisible,
                g.config.knife3D,
              );
              const remain = (1 - pose.pull) ** 3;
              drawPose = {
                ...pose,
                x: pose.x + (attached.x - start.x) * remain,
                y: pose.y + (attached.y - start.y) * remain,
              };
              const cut =
                (contact.x - drawPose.x) * Math.cos(pose.angle) +
                (contact.y - drawPose.y) * Math.sin(pose.angle);
              depth = Math.max(
                0,
                bladeCut(
                  r.knifeArt,
                  r.knifeLength,
                  pose.scale,
                  0,
                  g.config.knife3D,
                ) - cut,
              );
            }
            this.knife(
              drawPose.x,
              drawPose.y,
              pose.angle,
              pose.scale,
              g,
              r.age,
              r,
              depth,
            );
            c.restore();
          }
        }),
      );
    }
    drawLayers(layers);
    for (const draw of badges) draw();
    // Paint the static outer wall in front of inserted tips; no extra lighting pass.
    if (bg && this.assets.arena) {
      c.save();
      c.beginPath();
      c.rect(-viewport.x, -viewport.y, viewport.width, viewport.y);
      c.rect(-viewport.x, 0, viewport.x, g.height);
      c.rect(g.width, 0, viewport.width - viewport.x - g.width, g.height);
      c.rect(
        -viewport.x,
        g.height,
        viewport.width,
        viewport.height - viewport.y - g.height,
      );
      c.clip();
      c.drawImage(
        bg.img,
        -viewport.x,
        -viewport.y,
        viewport.width,
        viewport.height,
      );
      c.restore();
    }
    // Corpses collide with the same logical walls as knives, not the art canvas edge.
    for (const e of deaths) {
      c.save();
      c.globalAlpha = e.alpha;
      c.translate(e.x, e.y);
      c.rotate(e.rotation);
      c.translate(-e.x, -e.y);
      this.monster(e, g, true, e.age);
      c.restore();
    }
    this.whirlwinds = this.whirlwinds.filter((p) => (p.age += dt) < p.duration);
    for (const p of this.whirlwinds) this.drawWhirlwind(p, g);
    this.lightnings = this.lightnings.filter((p) => (p.age += dt) < p.duration);
    for (const bolt of this.lightnings) {
      c.save();
      c.globalAlpha = 1 - bolt.age / bolt.duration;
      c.strokeStyle = this.color("pickupLightning");
      c.lineWidth = 4;
      c.shadowBlur = 14;
      c.shadowColor = c.strokeStyle;
      c.beginPath();
      for (let i = 1; i < bolt.points.length; i++) {
        const a = bolt.points[i - 1],
          b = bolt.points[i],
          dx = b.x - a.x,
          dy = b.y - a.y;
        c.moveTo(a.x, a.y);
        for (let j = 1; j < 6; j++) {
          const t = j / 6,
            zig = (j % 2 ? 1 : -1) * 0.07;
          c.lineTo(a.x + dx * t - dy * zig, a.y + dy * t + dx * zig);
        }
        c.lineTo(b.x, b.y);
      }
      c.stroke();
      c.lineWidth = 1;
      c.strokeStyle = "#ffffff";
      c.stroke();
      c.restore();
    }
    for (const seed of g.seeds) {
      c.save();
      const t = Math.max(0, (seed.due - g.clock) / (seed.due - seed.at));
      c.fillStyle = this.color("pickupSeed");
      c.shadowColor = c.fillStyle;
      c.shadowBlur = 12;
      c.beginPath();
      c.arc(seed.x, seed.y, 6, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = "#ffffff";
      c.lineWidth = 2;
      c.beginPath();
      c.arc(seed.x, seed.y, 9, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t);
      c.stroke();
      c.restore();
    }
    const bombSpriteKey = g.config.bombSpriteAsset;
    this.explosions = this.explosions.filter(
      (p) =>
        (p.age += dt) <
        Math.max(
          g.config.bombFxDuration,
          g.config.bombSpriteOn
            ? (this.assets.entries[bombSpriteKey]?.meta.frames || 8) /
                g.config.bombSpriteFps
            : 0,
        ),
    );
    for (const p of this.explosions) {
      const t = Math.min(1, p.age / g.config.bombFxDuration),
        r = Math.max(1, p.radius * Math.min(1, t * 3));
      c.save();
      c.globalAlpha = 1 - t;
      const glow = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      glow.addColorStop(0, this.color("blast"));
      glow.addColorStop(1, `${this.color("blast").slice(0, 7)}00`);
      c.fillStyle = glow;
      c.beginPath();
      c.arc(p.x, p.y, r, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = this.color("hitParticle");
      c.lineWidth = 2;
      c.stroke();
      c.restore();
    }
    if (g.config.bombSpriteOn) {
      const meta = this.assets.entries[bombSpriteKey]?.meta;
      for (const p of this.explosions) {
        if (!meta || p.age >= meta.frames / g.config.bombSpriteFps) continue;
        c.save();
        c.globalAlpha = g.config.bombSpriteOpacity;
        this.assets.draw(
          c,
          bombSpriteKey,
          p.x,
          p.y,
          p.radius * 2 * g.config.bombSpriteScale,
          0,
          p.age,
          { fps: g.config.bombSpriteFps, loop: false },
        );
        c.restore();
      }
    }
    this.launcherPowerBadge(g);
    this.launcherAtkBadge(g);
    if (g.config.arenaBoundsVisible) {
      c.save();
      c.strokeStyle = "#19bc68";
      c.lineWidth = 2;
      c.setLineDash([6, 4]);
      c.strokeRect(0, 0, g.width, g.height);
      c.restore();
    }
    this.feedback.update(dt, g.config);
    this.feedback.draw(c, g);
    // Preserve the renderer's debug-facing queue names.
    this.particles = this.feedback.particles;
    this.labels = this.feedback.texts;
    c.restore();
  }
}
