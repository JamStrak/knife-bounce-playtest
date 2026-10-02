import { shopItems, shopAvailable } from "./shop.mjs";
import { t, getLocale, onLocaleChange } from "./i18n.mjs";
export function setupShop(getGame, toast, beforeOpen) {
  const $ = (id) => document.getElementById(id),
    dialog = $("shop");
  let last = "";
  let message = "";
  const setMessage = (source) => {
    message = source;
    $("shopMessage").textContent = t(source);
  };
  const rows = new Map();
  for (const id of Object.keys(shopItems)) {
    const card = document.createElement("article");
    card.className = "shop-card";
    card.dataset.item = id;
    const icon = document.createElement("div");
    icon.className = "shop-icon skill-icon";
    icon.dataset.skill = id === "recallForge" ? "recall" : id;
    icon.textContent = shopItems[id].icon;
    const content = document.createElement("div");
    content.className = "shop-content";
    const name = document.createElement("h3");
    name.textContent = t(shopItems[id].name);
    const effect = document.createElement("p");
    effect.className = "shop-effect";
    const count = document.createElement("small");
    count.className = "shop-count";
    const button = document.createElement("button");
    button.dataset.buy = id;
    button.setAttribute(
      "aria-label",
      t("购买{name}", { name: shopItems[id].name }),
    );
    const reason = document.createElement("small");
    reason.className = "shop-reason";
    button.onclick = () => {
      const g = getGame(),
        result = g.buy(id);
      if (result.ok) {
        setMessage(
          `已强化 ${result.name} · 花费 ${result.price} 金币，下一刀生效`,
        );
        toast(`${result.name} 已强化`);
      } else setMessage(result.reason);
      update();
    };
    content.append(name, effect, count, button, reason);
    card.append(icon, content);
    $("shopItems").append(card);
    rows.set(id, { card, name, effect, count, button, reason });
  }
  function close() {
    if (dialog.open) dialog.close();
  }
  function update() {
    const g = getGame();
    $("openShop").disabled = !shopAvailable(g);
    $("openShop").title = t(
      !g.config.shopEnabled
        ? "金币商店已关闭"
        : !shopAvailable(g)
          ? "出刀与三选一结束后可强化"
          : "花金币强化当前构筑",
    );
    if (!dialog.open) return;
    if (!shopAvailable(g)) {
      close();
      return;
    }
    const offers = Object.keys(shopItems).map((id) => g.shopOffer(id)),
      key = JSON.stringify([getLocale(), g.coins, offers]);
    if (key === last) return;
    last = key;
    $("shopCoins").textContent = String(g.coins);
    for (const offer of offers) {
      const row = rows.get(offer.id);
      row.name.textContent = t(offer.name);
      row.button.setAttribute(
        "aria-label",
        t("购买{name}", { name: offer.name }),
      );
      row.effect.textContent = t(offer.effect);
      row.count.textContent = t("本局已购买 {count} / {cap} 次", {
        count: offer.count,
        cap: offer.cap,
      });
      row.button.disabled = !offer.ok;
      row.button.textContent = t(
        offer.capped ? "已满级" : `${offer.price} 金币 · 强化`,
      );
      row.reason.textContent = t(
        offer.reason ||
          (g.isRealtime ? "强化后续发射的飞刀" : "购买不消耗回合"),
      );
      row.card.classList.toggle("locked", !offer.owned);
    }
  }
  $("openShop").onclick = () => {
    if (!shopAvailable(getGame())) return;
    beforeOpen();
    last = "";
    setMessage(
      getGame().isRealtime
        ? "商店打开时战场暂停。可直接强化锋芒与飞刀储备；新属性作用于后续发射。"
        : "基础锋芒与齐射数量可直接强化；其他能力先解锁，再定向加强。",
    );
    dialog.showModal();
    update();
  };
  $("closeShop").onclick = close;
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  onLocaleChange(() => {
    $("shopMessage").textContent = t(message);
    update();
  });
  return { update, close };
}
