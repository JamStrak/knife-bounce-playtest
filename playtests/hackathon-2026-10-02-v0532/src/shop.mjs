import { permanentDamageAt, giantWhirlAt } from "./balance-model.mjs";
import { t } from "./i18n.mjs";
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
export const shopItemName = (game, id) =>
  id === "platforms" && game.isRealtime ? "并锋" : shopItems[id]?.name || "";
export const shopAvailable = (game) =>
  Boolean(
    game.config.shopEnabled &&
    (game.isRealtime ? game.canAim : game.phase === "aim"),
  );
export function shopEffect(game, id, levelUp = false) {
  const c = game.config,
    s = game.stats;
  switch (id) {
    case "damage":
      return t("伤害 {before} → {after}", {
        before: number(s.damage),
        after: number(
          permanentDamageAt(
            c,
            game.buffs.damage + 1,
            game.level + Number(levelUp),
          ) * game.attackPower,
        ),
      });
    case "bounce":
      return t(
        "怪物弹射 {beforeEnemy} → {afterEnemy} · 墙反弹 {beforeWall} → {afterWall}",
        {
          beforeEnemy: s.enemy,
          afterEnemy: s.enemy + c.enemyBounceUpgrade,
          beforeWall: s.wall,
          afterWall: s.wall + c.wallBounceUpgrade,
        },
      );
    case "pierce":
      return t("穿透 {before} → {after} 个目标", {
        before: s.pierce,
        after: s.pierce + c.pierceUpgrade,
      });
    case "size": {
      const before = giantWhirlAt(c, game.buffs.size),
        after = giantWhirlAt(c, game.buffs.size + 1);
      return c.giantWhirlOn
        ? t(
            "旋风半径 {beforeRadius} → {afterRadius} 格 · 斩击 {beforeDamage} → {afterDamage} 倍刀伤",
            {
              beforeRadius: number(before.radius / c.cell),
              afterRadius: number(after.radius / c.cell),
              beforeDamage: number(before.multiplier),
              afterDamage: number(after.multiplier),
            },
          )
        : t("旋风斩已关闭");
    }
    case "split":
      return t("首次命中分裂 {before} → {after} 把", {
        before: s.split,
        after: s.split + c.splitUpgrade,
      });
    case "platforms":
      if (game.isRealtime) {
        const capacity = game.magazine?.capacity ?? game.volleyCount;
        return t("飞刀储备 {before} → {after} 把飞刀", {
          before: capacity,
          after: Math.min(10, capacity + 1),
        });
      }
      return game.config.discLauncher
        ? t("圆盘齐射 {before} → {after} 把飞刀", {
            before: game.volleyCount,
            after: Math.min(10, game.volleyCount + 1),
          })
        : t("同步发射台 {before} → {after} 个", {
            before: game.launcherCount,
            after: Math.min(10, game.launcherCount + 1),
          });
    case "recall": {
      const r = game.recallStats,
        next = game.shopPurchases.recall + 1;
      return t("触发 {before}% → {after}% · 召回伤害 {damage}（{source}）", {
        before: number(r.chance * 100),
        after: number(
          Math.min(1, c.recallChance + next * c.shopRecallChanceGain) * 100,
        ),
        damage: number(r.damage),
        source: c.recallInheritDamage ? "继承当前飞刀" : "基础伤害",
      });
    }
    default:
      return "";
  }
}
