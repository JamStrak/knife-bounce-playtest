import { permanentDamageAt, giantWhirlAt } from "./balance-model.mjs";
export const shopItems = {
  damage: { name: "锋芒打磨", priceKey: "shopDamagePrice", icon: "✦" },
  bounce: { name: "回响强化", priceKey: "shopBouncePrice", icon: "↗" },
  pierce: { name: "破阵强化", priceKey: "shopPiercePrice", icon: "➶" },
  size: { name: "旋风斩强化", priceKey: "shopSizePrice", icon: "◆" },
  split: { name: "分影强化", priceKey: "shopSplitPrice", icon: "⋔" },
  platforms: { name: "扩充齐射", priceKey: "shopPlatformsPrice", icon: "⋮" },
  recall: { name: "归心锻造", priceKey: "shopRecallPrice", icon: "✺" },
};
const number = (value) => Number(value.toFixed(2));
export function shopEffect(game, id, levelUp = false) {
  const c = game.config,
    s = game.stats;
  switch (id) {
    case "damage":
      return `伤害 ${number(s.damage)} → ${number(permanentDamageAt(c, game.buffs.damage + 1, game.level + Number(levelUp)) * game.attackPower)}`;
    case "bounce":
      return `怪物弹射 ${s.enemy} → ${s.enemy + c.enemyBounceUpgrade} · 墙反弹 ${s.wall} → ${s.wall + c.wallBounceUpgrade}`;
    case "pierce":
      return `穿透 ${s.pierce} → ${s.pierce + c.pierceUpgrade} 个目标`;
    case "size": {
      const before = giantWhirlAt(c, game.buffs.size),
        after = giantWhirlAt(c, game.buffs.size + 1);
      return c.giantWhirlOn
        ? `旋风半径 ${number(before.radius / c.cell)} → ${number(after.radius / c.cell)} 格 · 斩击 ${number(before.multiplier)} → ${number(after.multiplier)} 倍刀伤`
        : "旋风斩已关闭";
    }
    case "split":
      return `首次命中分裂 ${s.split} → ${s.split + c.splitUpgrade} 把`;
    case "platforms":
      return game.config.discLauncher
        ? `圆盘齐射 ${game.volleyCount} → ${Math.min(10, game.volleyCount + 1)} 把飞刀`
        : `同步发射台 ${game.launcherCount} → ${Math.min(10, game.launcherCount + 1)} 个`;
    case "recall": {
      const r = game.recallStats,
        next = game.shopPurchases.recall + 1;
      return `触发 ${number(r.chance * 100)}% → ${number(Math.min(1, c.recallChance + next * c.shopRecallChanceGain) * 100)}% · 召回伤害 ${number(r.damage)}（${c.recallInheritDamage ? "继承当前飞刀" : "基础伤害"}）`;
    }
    default:
      return "";
  }
}
