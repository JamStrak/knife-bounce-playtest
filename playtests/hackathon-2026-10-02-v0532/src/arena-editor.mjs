const full = () => ({ left: 0, top: 0, right: 1, bottom: 1 });
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const minSpan = 0.100001; // Keep the theme's >=10% constraint safe from floating-point subtraction.
export function adjustArena(a, operation, dx, dy) {
  const next = { ...a };
  if (operation === "move") {
    const x = clamp(dx, -a.left, 1 - a.right),
      y = clamp(dy, -a.top, 1 - a.bottom);
    next.left += x;
    next.right += x;
    next.top += y;
    next.bottom += y;
  } else {
    if (operation.includes("w"))
      next.left = clamp(a.left + dx, 0, a.right - minSpan);
    if (operation.includes("e"))
      next.right = clamp(a.right + dx, a.left + minSpan, 1);
    if (operation.includes("n"))
      next.top = clamp(a.top + dy, 0, a.bottom - minSpan);
    if (operation.includes("s"))
      next.bottom = clamp(a.bottom + dy, a.top + minSpan, 1);
  }
  return Object.fromEntries(
    Object.entries(next).map(([k, v]) => [
      k,
      v === a[k] ? v : Number(v.toFixed(6)),
    ]),
  );
}
export function backgroundFrame(width, height, imageWidth, imageHeight) {
  const scale = Math.min(
    Math.max(1, width - 48) / imageWidth,
    Math.max(1, height - 48) / imageHeight,
  );
  const w = imageWidth * scale,
    h = imageHeight * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}
export function setupArenaEditor({
  assets,
  getArena,
  change,
  save,
  exportTheme,
  toast,
}) {
  const dialog = document.createElement("dialog");
  dialog.id = "arenaBoundsEditor";
  dialog.setAttribute("aria-labelledby", "arenaBoundsTitle");
  dialog.innerHTML = `<header class="dialog-head"><div><small>ARENA STUDIO</small><h2 id="arenaBoundsTitle">背景碰撞框可视化调试</h2></div><button id="arenaBoundsClose" aria-label="关闭背景碰撞框编辑器">✕</button></header>
  <p class="small">拖绿色区域移动；拖四边或八个白色手柄缩放。背景图保持固定比例，打开编辑器时游戏暂停。</p>
  <canvas id="arenaBoundsCanvas" aria-label="背景碰撞范围，拖动绿色框或白色手柄调整" tabindex="0"></canvas>
  <label class="arena-bounds-toggle"><input id="arenaBoundsVisible" type="checkbox" checked>显示绿色碰撞范围</label>
  <p id="arenaBoundsValues" role="status"></p>
  <div class="arena-bounds-actions"><button id="arenaBoundsUndo">恢复本次打开时</button><button id="arenaBoundsSave" class="accent">保存主题</button><button id="arenaBoundsExport">导出主题</button><button id="arenaBoundsDone">完成调整</button></div>
  <p id="arenaBoundsSaveState" class="small" role="status">碰撞框随主题保存到当前浏览器；跨浏览器使用请导出主题。</p>`;
  document.body.append(dialog);
  const $ = (id) => dialog.querySelector(`#${id}`),
    canvas = $("arenaBoundsCanvas"),
    ctx = canvas.getContext("2d");
  let original,
    drag = null,
    frame = null,
    image = null;
  const rect = () => getArena() || full();
  const positions = (a) => [
    ["nw", a.left, a.top],
    ["n", (a.left + a.right) / 2, a.top],
    ["ne", a.right, a.top],
    ["e", a.right, (a.top + a.bottom) / 2],
    ["se", a.right, a.bottom],
    ["s", (a.left + a.right) / 2, a.bottom],
    ["sw", a.left, a.bottom],
    ["w", a.left, (a.top + a.bottom) / 2],
  ];
  function paint() {
    if (!dialog.open || !image) return;
    const box = canvas.getBoundingClientRect(),
      dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(box.width * dpr);
    canvas.height = Math.round(box.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#263c45";
    ctx.fillRect(0, 0, box.width, box.height);
    frame = backgroundFrame(
      box.width,
      box.height,
      image.naturalWidth,
      image.naturalHeight,
    );
    ctx.drawImage(image, frame.x, frame.y, frame.w, frame.h);
    const a = rect(),
      x = frame.x + a.left * frame.w,
      y = frame.y + a.top * frame.h,
      w = (a.right - a.left) * frame.w,
      h = (a.bottom - a.top) * frame.h;
    if ($("arenaBoundsVisible").checked) {
      ctx.fillStyle = "#04271955";
      ctx.beginPath();
      ctx.rect(frame.x, frame.y, frame.w, frame.h);
      ctx.rect(x, y, w, h);
      ctx.fill("evenodd");
      ctx.fillStyle = "#26d98235";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "#13a962";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
      for (const [, px, py] of positions(a)) {
        const sx = frame.x + px * frame.w,
          sy = frame.y + py * frame.h;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(sx - 5, sy - 5, 10, 10);
        ctx.strokeRect(sx - 5, sy - 5, 10, 10);
      }
    }
    $("arenaBoundsValues").textContent =
      `左 ${Math.round(a.left * image.naturalWidth)} · 上 ${Math.round(a.top * image.naturalHeight)} · 右 ${Math.round(a.right * image.naturalWidth)} · 下 ${Math.round(a.bottom * image.naturalHeight)} px ｜ ${((a.right - a.left) * 100).toFixed(1)}% × ${((a.bottom - a.top) * 100).toFixed(1)}%`;
    canvas.dataset.bounds = JSON.stringify(a);
  }
  function apply(a) {
    change(a);
    $("arenaBoundsSave").textContent = "保存主题";
    $("arenaBoundsSaveState").textContent =
      "已实时预览，尚未保存主题。关闭编辑器会保留当前预览。";
    paint();
  }
  const local = (e) => {
    const b = canvas.getBoundingClientRect();
    return { x: e.clientX - b.left, y: e.clientY - b.top };
  };
  function hit(p, radius) {
    if (!frame || !$("arenaBoundsVisible").checked) return null;
    const a = rect(),
      x = frame.x + a.left * frame.w,
      y = frame.y + a.top * frame.h,
      right = frame.x + a.right * frame.w,
      bottom = frame.y + a.bottom * frame.h;
    for (const [key, px, py] of positions(a))
      if (
        Math.hypot(
          p.x - frame.x - px * frame.w,
          p.y - frame.y - py * frame.h,
        ) <= radius
      )
        return key;
    if (p.y >= y - radius && p.y <= bottom + radius) {
      if (Math.abs(p.x - x) <= radius) return "w";
      if (Math.abs(p.x - right) <= radius) return "e";
    }
    if (p.x >= x - radius && p.x <= right + radius) {
      if (Math.abs(p.y - y) <= radius) return "n";
      if (Math.abs(p.y - bottom) <= radius) return "s";
    }
    return p.x >= x && p.x <= right && p.y >= y && p.y <= bottom
      ? "move"
      : null;
  }
  function release() {
    const id = drag?.id;
    drag = null;
    if (id !== undefined && canvas.hasPointerCapture(id))
      canvas.releasePointerCapture(id);
  }
  const cursor = (op) =>
    op === "move"
      ? "move"
      : ["n", "s"].includes(op)
        ? "ns-resize"
        : ["e", "w"].includes(op)
          ? "ew-resize"
          : ["ne", "sw"].includes(op)
            ? "nesw-resize"
            : op
              ? "nwse-resize"
              : "default";
  canvas.onpointerdown = (e) => {
    if (!e.isPrimary || e.button !== 0 || drag) return;
    const p = local(e),
      op = hit(p, e.pointerType === "touch" ? 18 : 11);
    if (!op) return;
    e.preventDefault();
    drag = {
      id: e.pointerId,
      start: p,
      arena: { ...rect() },
      previous: getArena() ? { ...getArena() } : undefined,
      op,
      frame: { ...frame },
    };
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = cursor(op);
  };
  canvas.onpointermove = (e) => {
    const p = local(e);
    if (!drag) {
      canvas.style.cursor = cursor(hit(p, e.pointerType === "touch" ? 18 : 11));
      return;
    }
    if (e.pointerId !== drag.id) return;
    e.preventDefault();
    apply(
      adjustArena(
        drag.arena,
        drag.op,
        (p.x - drag.start.x) / drag.frame.w,
        (p.y - drag.start.y) / drag.frame.h,
      ),
    );
  };
  canvas.onpointerup = (e) => {
    if (drag?.id === e.pointerId) {
      e.preventDefault();
      release();
    }
  };
  canvas.onpointercancel = (e) => {
    if (drag?.id === e.pointerId) {
      const before = drag.previous;
      release();
      apply(before);
    }
  };
  canvas.onlostpointercapture = () => {
    drag = null;
  };
  $("arenaBoundsVisible").onchange = () => {
    release();
    paint();
  };
  $("arenaBoundsUndo").onclick = () => {
    release();
    apply(original ? { ...original } : undefined);
  };
  $("arenaBoundsSave").onclick = async () => {
    $("arenaBoundsSave").disabled = true;
    try {
      await save();
      $("arenaBoundsSave").textContent = "已保存主题";
      $("arenaBoundsSaveState").textContent =
        "已保存到当前浏览器。跨浏览器请导出主题，再在目标浏览器导入。";
    } catch (e) {
      $("arenaBoundsSaveState").textContent = `保存失败：${e.message}`;
      toast(e.message);
    } finally {
      $("arenaBoundsSave").disabled = false;
    }
  };
  $("arenaBoundsExport").onclick = () => exportTheme();
  const close = () => {
    release();
    dialog.close();
  };
  $("arenaBoundsClose").onclick = close;
  $("arenaBoundsDone").onclick = close;
  dialog.addEventListener("close", release);
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    close();
  });
  dialog.addEventListener("keydown", (e) => e.stopPropagation());
  new ResizeObserver(() => {
    if (drag) {
      const before = drag.previous;
      release();
      apply(before);
    }
    paint();
  }).observe(canvas);
  return {
    open() {
      if (dialog.open) return;
      image = assets.entries.background?.img;
      if (!image) {
        toast("当前主题没有整幅背景，请先在主题图片与锚点中设置背景。");
        return;
      }
      original = getArena() ? { ...getArena() } : undefined;
      $("arenaBoundsSave").textContent = "保存主题";
      $("arenaBoundsSaveState").textContent =
        "碰撞框随主题保存到当前浏览器；跨浏览器使用请导出主题。";
      dialog.showModal();
      paint();
    },
    get isOpen() {
      return dialog.open;
    },
  };
}
