export const effectMessages = {
  "可用飞刀 {available}/{capacity}": "Knives {available}/{capacity}",
  "后续 {count} 次": "Next {count} throws",
  本次: "This throw",
  守住底线: "HOLD THE LINE",
  击破: "DEFEATED",
  万刃归心: "Blade Recall",
  旋风斩: "Whirlwind",
  狂热: "Power Surge",
  "狂热 · 后续 {count} 次": "Power Surge · Next {count} throws",
  连锁闪电: "Chain Lightning",
  环形刀阵: "Blade Ring",
  爆弹种子: "Bomb Seeds",
  战场增益: "Power-up",
  格挡: "BLOCK",
  击落: "SHOT DOWN",
  完美防御: "PERFECT",
  "{count} 连斩 · EXP ×{multiplier}": "{count} KILLS · EXP ×{multiplier}",
};

// Canvas does not reflow like DOM text. Fit translated labels before drawing,
// so long English skill names stay inside the same battlefield and badges.
export function fitEffectFont(ctx, text, size, maxWidth, weight = "700") {
  const font = (value) =>
    `${weight} ${value}px Club,"Microsoft YaHei",sans-serif`;
  ctx.font = font(size);
  const width = ctx.measureText?.(text)?.width || 0;
  if (width > maxWidth && maxWidth > 0) {
    ctx.font = font((size * maxWidth) / width);
    return maxWidth;
  }
  return width;
}
