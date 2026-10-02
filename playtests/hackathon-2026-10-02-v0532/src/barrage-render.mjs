import { guardY, guardOpacity, shooterHasClearance } from "./barrage.mjs";

const TAU = Math.PI * 2;
const isShooter = (e) => (e.type || e.enemyType) === "shooter";

// Apply this only around the monster sprite. Canvas save/restore keeps knives,
// health plates and alpha-based attachment sampling in their original colors.
export function monsterSpriteFilter(e, config, hit = false) {
  const parts = [];
  if (isShooter(e)) parts.push(`hue-rotate(${config.shooterHue ?? 145}deg)`);
  if (hit) parts.push("brightness(1.7)");
  return parts.join(" ") || "none";
}

export function shooterCharge(e, g) {
  if (
    !g.isRealtime ||
    !g.config.barrageOn ||
    !isShooter(e) ||
    e.hp <= 0 ||
    e.entry ||
    !(g.config.shooterTelegraph > 0) ||
    !(e.shootCooldown >= 0) ||
    !shooterHasClearance(g, e)
  )
    return null;
  const duration = Math.min(
    g.config.shooterTelegraph,
    e.shootInterval || g.config.shooterTelegraph,
  );
  if (e.shootCooldown > duration) return null;
  return Math.max(0, Math.min(1, 1 - e.shootCooldown / duration));
}

export function drawShooterCharge(c, e, g, radius) {
  const charge = shooterCharge(e, g);
  if (charge == null) return;
  c.save();
  c.strokeStyle = "#bd416f";
  c.lineWidth = 2;
  c.beginPath();
  c.arc(e.x, e.y, radius + 4, 0, TAU);
  c.stroke();
  c.strokeStyle = "#ffdeb3";
  c.lineWidth = 3;
  c.beginPath();
  c.arc(e.x, e.y, radius + 4, -Math.PI / 2, -Math.PI / 2 + TAU * charge);
  c.stroke();
  // This arrow is the attack telegraph, not a targeting ray through the board.
  const x = e.x,
    y = e.y + radius + 8;
  c.fillStyle = "#ffe6bd";
  c.strokeStyle = "#993253";
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(x - 5, y);
  c.lineTo(x, y + 7);
  c.lineTo(x + 5, y);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
}

export function drawBarrage(c, g) {
  if (!g.isRealtime || !g.config.barrageOn || !g.barrage) return;
  const state = g.barrage,
    embellish = g.config.barrageFxOn !== false && g.config.combatFxOn !== false;
  c.save();
  c.beginPath();
  c.rect(0, 0, g.width, g.height);
  c.clip();
  c.lineCap = "round";
  for (const p of state.projectiles || []) {
    const speed = Math.hypot(p.vx, p.vy),
      dx = speed ? p.vx / speed : 0,
      dy = speed ? p.vy / speed : 1,
      r = p.r,
      color = p.reflected ? "#80eaff" : "#ffac56";
    if (embellish) {
      c.strokeStyle = p.reflected ? "#3ccdfc70" : "#f2584470";
      c.lineWidth = r * 1.3;
      c.beginPath();
      c.moveTo(p.x - dx * r * 3.2, p.y - dy * r * 3.2);
      c.lineTo(p.x, p.y);
      c.stroke();
    }
    // Opaque outlined cores remain legible with all decorative FX disabled.
    c.fillStyle = color;
    c.strokeStyle = p.reflected ? "#16608e" : "#8c294c";
    c.lineWidth = Math.max(1, r * 0.2);
    c.beginPath();
    c.arc(p.x, p.y, r, 0, TAU);
    c.fill();
    c.stroke();
    c.fillStyle = "#ffffff";
    c.beginPath();
    c.arc(p.x - dx * r * 0.15, p.y - dy * r * 0.15, r * 0.43, 0, TAU);
    c.fill();
  }
  if (state.guardRemaining > 0) {
    const y = guardY(g),
      wave = state.guardMode === "wave",
      width = wave ? state.guardWaveWidth : 26,
      perfect =
        state.perfectWindow > 0 && state.guardAge <= state.perfectWindow,
      color = perfect ? "#d9ffff" : "#72dfff";
    c.save();
    c.globalAlpha *= guardOpacity(g);
    // The horizontal center line is exactly the collision plane. Never use
    // the background image or viewport edge as a second visual bottom wall.
    if (embellish) {
      // The bright leading edge is the collision plane. A trailing glow stays
      // behind it; width only changes light, never hidden collision geometry.
      const top = wave ? y : y - width / 2,
        fill = c.createLinearGradient(0, top, 0, top + width);
      fill.addColorStop(0, wave ? color : "#46cfff00");
      fill.addColorStop(wave ? 0.2 : 0.5, perfect ? "#b0ffffc0" : "#46cfff80");
      fill.addColorStop(1, "#46cfff00");
      c.fillStyle = fill;
      c.fillRect(0, top, g.width, width);
    }
    c.strokeStyle = "#166c9b";
    c.lineWidth = perfect ? 7 : 5;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(g.width, y);
    c.stroke();
    c.strokeStyle = color;
    c.lineWidth = perfect ? 4 : 2.5;
    c.stroke();
    for (const x of wave ? [] : [2, g.width - 2]) {
      c.strokeStyle = color;
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(x, y - 8);
      c.lineTo(x, y + 8);
      c.stroke();
    }
    c.restore();
  }
  c.restore();
}
