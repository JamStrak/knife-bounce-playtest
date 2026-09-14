import { shopItems } from "./shop.mjs";
export function setupShop(getGame, toast, beforeOpen) {
  const $ = (id) => document.getElementById(id),
    dialog = $("shop");
  let last = "";
  const rows = new Map();
  for (const id of Object.keys(shopItems)) {
    const card = document.createElement("article");
    card.className = "shop-card";
    card.dataset.item = id;
    const icon = document.createElement("div");
    icon.className = "shop-icon";
    icon.textContent = shopItems[id].icon;
    const content = document.createElement("div");
    content.className = "shop-content";
    const name = document.createElement("h3");
    name.textContent = shopItems[id].name;
    const effect = document.createElement("p");
    effect.className = "shop-effect";
    const count = document.createElement("small");
    count.className = "shop-count";
    const button = document.createElement("button");
    button.dataset.buy = id;
    button.setAttribute("aria-label", `购买${shopItems[id].name}`);
    const reason = document.createElement("small");
    reason.className = "shop-reason";
    button.onclick = () => {
      const g = getGame(),
        result = g.buy(id);
      if (result.ok) {
        $("shopMessage").textContent =
          `已强化 ${result.name} · 花费 ${result.price} 金币，下一刀生效`;
        toast(`${result.name} 已强化`);
      } else $("shopMessage").textContent = result.reason;
      update();
    };
    content.append(name, effect, count, button, reason);
    card.append(icon, content);
    $("shopItems").append(card);
    rows.set(id, { card, effect, count, button, reason });
  }
  function close() {
    if (dialog.open) dialog.close();
  }
  function update() {
    const g = getGame();
    $("openShop").disabled = !g.config.shopEnabled || g.phase !== "aim";
    $("openShop").title = !g.config.shopEnabled
      ? "金币商店已关闭"
      : g.phase !== "aim"
        ? "出刀与三选一结束后可强化"
        : "花金币强化当前构筑";
    if (!dialog.open) return;
    if (!g.config.shopEnabled || g.phase !== "aim") {
      close();
      return;
    }
    const offers = Object.keys(shopItems).map((id) => g.shopOffer(id)),
      key = JSON.stringify([g.coins, offers]);
    if (key === last) return;
    last = key;
    $("shopCoins").textContent = String(g.coins);
    for (const offer of offers) {
      const row = rows.get(offer.id);
      row.effect.textContent = offer.effect;
      row.count.textContent = `本局已购买 ${offer.count} / ${offer.cap} 次`;
      row.button.disabled = !offer.ok;
      row.button.textContent = offer.capped
        ? "已满级"
        : `${offer.price} 金币 · 强化`;
      row.reason.textContent = offer.reason || "购买不消耗回合";
      row.card.classList.toggle("locked", !offer.owned);
    }
  }
  $("openShop").onclick = () => {
    if (getGame().phase !== "aim" || !getGame().config.shopEnabled) return;
    beforeOpen();
    last = "";
    $("shopMessage").textContent =
      "基础锋芒与齐射数量可直接强化；其他能力先解锁，再定向加强。";
    dialog.showModal();
    update();
  };
  $("closeShop").onclick = close;
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  return { update, close };
}
