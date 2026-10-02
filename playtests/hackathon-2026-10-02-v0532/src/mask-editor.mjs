import { Game } from "./core.mjs";
import { schema } from "./config.mjs";
import { arenaViewport } from "./arena-layout.mjs";
import {
  Renderer,
  maskGeometry,
  pinnedCorpse,
  visualRadius,
  maskPrefix,
} from "./render.mjs";

export const maskPositions = {
  center: "原地活怪",
  top: "顶部钉墙",
  right: "右侧钉墙",
  bottom: "底部钉墙",
  left: "左侧钉墙",
};
export function maskScene(config, position) {
  const g = new Game({ ...config, initialRows: 0, spawnCount: 0 });
  const e = g.addEnemy(
    Math.floor(config.cols / 2),
    Math.floor(config.rows / 2),
    100,
  );
  e.variant = 0;
  g.phase = "advance";
  g.presentationStatic = true;
  g.config.knifeLocalMask = false;
  if (position === "center") {
    e.stuck = [
      { angle: -Math.PI / 2, dx: 0, dy: e.r * 0.65, scale: 1, at: -1 },
      { angle: 0, dx: -e.r * 0.65, dy: 0, scale: 1, at: -1 },
    ];
    return { g, e, corpse: false };
  }
  const points = {
    top: [g.width / 2, 5, 0, -1, -Math.PI / 2],
    right: [g.width - 5, g.height / 2, 1, 0, 0],
    bottom: [g.width / 2, g.height - 5, 0, 1, Math.PI / 2],
    left: [5, g.height / 2, -1, 0, Math.PI],
  };
  const [x, y, nx, ny, angle] = points[position];
  const p = {
    x,
    y,
    nx,
    ny,
    angle,
    radius: 5,
    age: 1,
    scale: 1,
    corpse: { r: e.r, variant: e.variant },
  };
  g.enemies = [];
  g.pins = [p];
  return { g, p, e: pinnedCorpse(p, g), corpse: true };
}

// Bounds of the same transformed shape used by the combat renderer.
export function maskBounds(e, g, corpse) {
  const pose = maskGeometry(e, g, corpse);
  const radius =
    visualRadius(e, g, corpse) * g.config[maskPrefix(e, corpse) + "Ratio"];
  return {
    x: pose.x - radius * pose.scaleX,
    y: pose.y - radius * pose.scaleY,
    w: 2 * radius * pose.scaleX,
    h: 2 * radius * pose.scaleY,
  };
}
export function editMask(config, prefix, operation, dx, dy, box) {
  const result = {};
  const put = (suffix, value) => {
    const key = prefix + suffix,
      s = schema[key];
    result[key] = Number(
      (
        Math.round(Math.max(s.min, Math.min(s.max, value)) / s.step) * s.step
      ).toFixed(4),
    );
  };
  if (operation === "move") {
    put("OffsetX", config[prefix + "OffsetX"] + dx);
    put("OffsetY", config[prefix + "OffsetY"] + dy);
  } else {
    if (operation.includes("e") || operation.includes("w"))
      put(
        "ScaleX",
        config[prefix + "ScaleX"] *
          Math.max(
            0.01,
            1 + ((operation.includes("w") ? -2 : 2) * dx) / Math.max(1, box.w),
          ),
      );
    if (operation.includes("n") || operation.includes("s"))
      put(
        "ScaleY",
        config[prefix + "ScaleY"] *
          Math.max(
            0.01,
            1 + ((operation.includes("n") ? -2 : 2) * dy) / Math.max(1, box.h),
          ),
      );
  }
  return result;
}

export function setupMaskEditor({ assets, getConfig, change, save, close }) {
  const dialog = document.createElement("dialog");
  dialog.id = "maskEditor";
  dialog.setAttribute("aria-labelledby", "maskEditorTitle");
  dialog.innerHTML = `<header class="dialog-head"><div><small>旧圆形遮挡 · 仅关闭刀身透明蒙版时生效</small><h2 id="maskEditorTitle">遮挡可视化调试</h2></div><button id="closeMaskEditor" aria-label="关闭遮挡编辑器">✕</button></header>
    <div class="mask-positions" role="group" aria-label="测试位置">${Object.entries(
      maskPositions,
    )
      .map(
        ([id, name]) =>
          `<button data-position="${id}" aria-pressed="false">${name}</button>`,
      )
      .join("")}</div>
    <p class="small">拖动绿色区域移动；拖动白色手柄缩放。原地和四面墙各自保存遮挡大小与位置，切换不会相互覆盖。</p>
    <div class="mask-preview"><canvas id="maskCanvas" aria-label="绿色遮挡编辑画布，可拖动区域或缩放手柄" tabindex="0"></canvas><span id="maskPositionLabel"></span></div>
    <div class="mask-editor-options"><label><input id="maskVisible" type="checkbox" checked>显示绿色遮挡</label><label><input id="maskEnabled" type="checkbox">启用插入遮挡</label></div>
    <p id="maskEditValues" role="status"></p>
    <details id="dentEditor"><summary>钉墙软体凹陷 · 展开调节</summary><p class="small">选择一面墙后调整。关闭绿色辅助可清楚观察边缘压入；凹陷与圆形遮挡独立。</p><div id="dentControls"></div><label class="dent-angle">测试插入角度偏转 <input id="dentTestAngle" type="range" min="-65" max="65" step="1" value="0"><output id="dentAngleValue">0°</output></label><button id="dentReplay">重播压入与回弹</button></details>
    <div class="mask-editor-actions"><button id="maskEditReset">复位当前遮挡</button><button id="maskEditSave" class="accent">保存参数</button><button id="maskEditDone">完成调整</button></div>`;
  document.body.append(dialog);
  const $ = (id) => dialog.querySelector(`#${id}`),
    canvas = $("maskCanvas"),
    ctx = canvas.getContext("2d");
  const board = document.createElement("canvas"),
    renderer = new Renderer(board, assets),
    tint = document.createElement("canvas");
  let dentStart = performance.now();
  let scene,
    position = "center",
    camera,
    drag = null,
    frame = 0,
    currentBox,
    handles = [];
  const width = 560,
    height = 460;
  const prefix = () => maskPrefix(scene.e, scene.corpse);
  const apply = (values) => {
    change(values);
    $("maskEditSave").textContent = "保存参数";
  };
  for (const [key, s] of Object.entries(schema).filter(
    ([, s]) => s.group === "钉墙软体凹陷",
  )) {
    const label = document.createElement("label"),
      input = document.createElement("input"),
      output = document.createElement("output");
    label.className = "dent-control";
    label.append(document.createTextNode(s.label));
    input.type = s.type === "boolean" ? "checkbox" : "range";
    input.dataset.dentKey = key;
    input.setAttribute("aria-label", `编辑器${s.label}`);
    if (input.type === "range") {
      input.min = s.min;
      input.max = s.max;
      input.step = s.step;
    }
    input.oninput = () => {
      apply({
        [key]: input.type === "checkbox" ? input.checked : Number(input.value),
      });
      dentStart = performance.now();
    };
    label.append(input, output);
    $("dentControls").append(label);
  }
  $("dentReplay").onclick = () => {
    dentStart = performance.now();
  };
  $("dentTestAngle").oninput = () => {
    dentStart = performance.now();
  };
  const pointer = (event) => {
    const r = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - r.left) * width) / r.width,
      y: ((event.clientY - r.top) * height) / r.height,
    };
  };
  const screen = (p) => ({
    x: (p.x - camera.x) * camera.scale + width / 2,
    y: (p.y - camera.y) * camera.scale + height / 2,
  });
  function select(next) {
    drag = null;
    position = next;
    scene = maskScene(getConfig(), position);
    scene.baseAngle = scene.p?.angle;
    dentStart = performance.now();
    const span = Math.max(
      260,
      visualRadius(scene.e, scene.g, scene.corpse) * 6,
    );
    camera = { x: scene.e.x, y: scene.e.y, scale: height / span };
    renderer.resetEffects();
    for (const button of dialog.querySelectorAll("[data-position]"))
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.position === next),
      );
    $("maskPositionLabel").textContent = maskPositions[next];
    canvas.dataset.position = next;
    paint();
  }
  function paint() {
    if (!scene) return;
    Object.assign(scene.g.config, getConfig());
    scene.g.config.knifeLocalMask = false;
    scene.g.config.pinLife = Math.max(6, scene.g.config.pinLife);
    if (scene.p) {
      scene.p.angle =
        scene.baseAngle + (Number($("dentTestAngle").value) * Math.PI) / 180;
      scene.p.age = Math.min(2, (performance.now() - dentStart) / 1000);
      scene.e = pinnedCorpse(scene.p, scene.g);
    }
    for (const input of dialog.querySelectorAll("[data-dent-key]")) {
      const value = getConfig()[input.dataset.dentKey];
      if (input.type === "checkbox") input.checked = value;
      else input.value = value;
      input.nextElementSibling.textContent =
        input.type === "checkbox" ? "" : String(value);
    }
    $("dentReplay").disabled = !scene.corpse;
    $("dentTestAngle").disabled = !scene.corpse;
    $("dentAngleValue").textContent = `${$("dentTestAngle").value}°`;
    renderer.draw(scene.g, 0, false, 0);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
      canvas.width = width * dpr;
      canvas.height = height * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#263c45";
    ctx.fillRect(0, 0, width, height);
    const origin = screen({ x: 0, y: 0 });
    const viewport = arenaViewport(scene.g, assets.arena);
    const artOrigin = screen({ x: -viewport.x, y: -viewport.y });
    ctx.drawImage(
      board,
      artOrigin.x,
      artOrigin.y,
      viewport.width * camera.scale,
      viewport.height * camera.scale,
    );
    ctx.strokeStyle = "#d3bb91";
    ctx.lineWidth = 4;
    ctx.strokeRect(
      origin.x,
      origin.y,
      scene.g.width * camera.scale,
      scene.g.height * camera.scale,
    );
    if (tint.width !== canvas.width || tint.height !== canvas.height) {
      tint.width = canvas.width;
      tint.height = canvas.height;
    }
    const tc = tint.getContext("2d");
    tc.resetTransform();
    tc.clearRect(0, 0, tint.width, tint.height);
    tc.setTransform(
      dpr * camera.scale,
      0,
      0,
      dpr * camera.scale,
      dpr * origin.x,
      dpr * origin.y,
    );
    const target = renderer.ctx;
    renderer.ctx = tc;
    try {
      renderer.paintKnifeMask(scene.e, scene.g, scene.corpse, 1);
    } finally {
      renderer.ctx = target;
    }
    tc.save();
    tc.resetTransform();
    tc.globalCompositeOperation = "source-in";
    tc.fillStyle = "#40f28b";
    tc.fillRect(0, 0, tint.width, tint.height);
    tc.restore();
    if ($("maskVisible").checked) {
      ctx.globalAlpha = 0.42;
      ctx.drawImage(tint, 0, 0, width, height);
      ctx.globalAlpha = 1;
    }
    currentBox = maskBounds(scene.e, scene.g, scene.corpse, assets);
    const p = screen(currentBox),
      bw = currentBox.w * camera.scale,
      bh = currentBox.h * camera.scale;
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = "#b4ffcd";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(p.x, p.y, bw, bh);
    ctx.setLineDash([]);
    handles = [
      ["nw", 0, 0],
      ["n", 0.5, 0],
      ["ne", 1, 0],
      ["e", 1, 0.5],
      ["se", 1, 1],
      ["s", 0.5, 1],
      ["sw", 0, 1],
      ["w", 0, 0.5],
    ].map(([id, x, y]) => ({ id, x: p.x + x * bw, y: p.y + y * bh }));
    for (const h of handles) {
      ctx.fillStyle = "#f6fff9";
      ctx.strokeStyle = "#127346";
      ctx.fillRect(h.x - 5, h.y - 5, 10, 10);
      ctx.strokeRect(h.x - 5, h.y - 5, 10, 10);
    }
    const c = getConfig(),
      key = prefix();
    $("maskEnabled").checked = c.stuckKnifeMask;
    $("maskEditValues").textContent =
      `横向 ${c[key + "ScaleX"].toFixed(2)} · 纵向 ${c[key + "ScaleY"].toFixed(2)} · 左右 ${c[key + "OffsetX"]} · 上下 ${c[key + "OffsetY"]}`;
  }
  function loop() {
    if (!dialog.open) return;
    paint();
    frame = requestAnimationFrame(loop);
  }
  canvas.addEventListener("pointerdown", (event) => {
    const p = pointer(event),
      h = handles.find((h) => Math.hypot(h.x - p.x, h.y - p.y) < 14),
      a = screen(currentBox);
    if (
      !h &&
      !(
        p.x >= a.x &&
        p.x <= a.x + currentBox.w * camera.scale &&
        p.y >= a.y &&
        p.y <= a.y + currentBox.h * camera.scale
      )
    )
      return;
    drag = {
      id: event.pointerId,
      start: p,
      config: { ...getConfig() },
      box: { ...currentBox },
      operation: h?.id || "move",
    };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const p = pointer(event);
    apply(
      editMask(
        drag.config,
        prefix(),
        drag.operation,
        (p.x - drag.start.x) / camera.scale,
        (p.y - drag.start.y) / camera.scale,
        drag.box,
      ),
    );
    paint();
  });
  const end = (event) => {
    if (drag?.id === event.pointerId) {
      drag = null;
      if (canvas.hasPointerCapture(event.pointerId))
        canvas.releasePointerCapture(event.pointerId);
    }
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("lostpointercapture", () => {
    drag = null;
  });
  dialog
    .querySelectorAll("[data-position]")
    .forEach(
      (button) => (button.onclick = () => select(button.dataset.position)),
    );
  $("maskEnabled").onchange = () =>
    apply({ stuckKnifeMask: $("maskEnabled").checked });
  $("maskEditReset").onclick = () => {
    const key = prefix();
    apply({
      [key + "ScaleX"]: 1,
      [key + "ScaleY"]: 1,
      [key + "OffsetX"]: 0,
      [key + "OffsetY"]: 0,
      [key + "Ratio"]: scene.corpse ? 1 : 0.85,
    });
    paint();
  };
  $("maskEditSave").onclick = () => {
    $("maskEditSave").textContent = save()
      ? "已保存参数"
      : "保存失败，请导出参数";
  };
  $("closeMaskEditor").onclick = $("maskEditDone").onclick = () =>
    dialog.close();
  dialog.addEventListener("close", () => {
    drag = null;
    cancelAnimationFrame(frame);
    close();
  });
  return {
    open() {
      if (dialog.open) return;
      dialog.showModal();
      select(position);
      loop();
    },
    get isOpen() {
      return dialog.open;
    },
  };
}
