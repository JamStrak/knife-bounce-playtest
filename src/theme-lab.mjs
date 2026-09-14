import { Assets } from "./assets.mjs";
import { setupArenaEditor } from "./arena-editor.mjs";
import {
  ThemeSwitcher,
  validateTheme,
  paletteFields,
  renderFields,
  slotLabels,
  THEME_STORAGE,
  MAX_THEME_BYTES,
} from "./themes.mjs";
const $ = (id) => document.getElementById(id);
const readJSON = async (url) => {
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(`主题读取失败：${url}`);
  return r.json();
};
const dataURL = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });

export async function setupThemeLab(assets, toast) {
  let busy = 0,
    dirty = false,
    catalog;
  const status = (message) => {
    $("themeState").textContent = message;
  };
  function markDirty() {
    dirty = true;
    status(`预览中：${switcher.current.name} · 尚未保存主题`);
  }
  const switcher = new ThemeSwitcher(
    async (theme) => {
      const next = new Assets();
      await Promise.all(
        Object.entries(theme.slots).map(async ([key, meta]) => {
          if (!meta.src) return;
          try {
            await next.set(key, meta.src, meta);
          } catch (e) {
            throw new Error(`${slotLabels[key]} 加载失败：${e.message}`);
          }
          const { img } = next.entries[key];
          if (img.naturalWidth * img.naturalHeight > 16777216)
            throw new Error(`${slotLabels[key]} 超过1600万像素`);
          if (
            (meta.frames || 1) > 1 &&
            (img.naturalWidth % (meta.columns || 1) ||
              img.naturalHeight % Math.ceil(meta.frames / (meta.columns || 1)))
          )
            throw new Error(`${slotLabels[key]} 精灵表无法按帧均分`);
        }),
      );
      return next;
    },
    (theme, next) => {
      for (const u of assets.temporary) URL.revokeObjectURL(u);
      assets.temporary = [];
      assets.entries = next.entries;
      assets.errors = [];
      assets.palette = theme.render;
      assets.arena = theme.arena;
      applyAppearance(theme);
      $("artState").textContent = `正式素材已加载 · 主题 ${theme.name}`;
    },
  );
  function applyAppearance(theme) {
    document.documentElement.dataset.theme = theme.id;
    document.documentElement.dataset.themeStyle = theme.style;
    document.documentElement.dataset.artArena = String(!!theme.arena);
    document.querySelector(".battle-heading > span").firstChild.textContent =
      `${theme.name} `;
    $("toySkin").disabled = theme.style === "classic";
    for (const [key, color] of Object.entries(theme.palette))
      document.documentElement.style.setProperty(`--theme-${key}`, color);
    for (const key of Object.keys(slotLabels).filter((k) =>
      k.startsWith("ui"),
    )) {
      const src = theme.slots[key]?.src;
      document.documentElement.style.setProperty(
        `--theme-${key}`,
        src ? `url("${src}")` : "none",
      );
    }
    const brand = $("themeBrand");
    brand.src = theme.slots.uiBrand?.src || theme.slots.knife.src;
    document.querySelector('meta[name="theme-color"]').content =
      theme.palette.background;
  }
  async function run(action) {
    busy++;
    $("themeLab").setAttribute("aria-busy", "true");
    for (const el of $("themeLab").querySelectorAll("button,input,select"))
      el.disabled = true;
    try {
      await action();
    } catch (e) {
      if (switcher.current) sync();
      status(`操作失败：${e.message}。当前主题已保留。`);
      toast(e.message);
    } finally {
      busy--;
      if (!busy) {
        $("themeLab").setAttribute("aria-busy", "false");
        for (const el of $("themeLab").querySelectorAll("button,input,select"))
          el.disabled = false;
      }
    }
  }
  function sync() {
    const t = switcher.current;
    $("themeName").value = t.name;
    $("themeId").value = t.id;
    $("themeStyle").value = t.style;
    $("themeSelect").value = catalog.themes.some((x) => x.id === t.id)
      ? t.id
      : "custom";
    for (const group of ["palette", "render"])
      for (const [key, value] of Object.entries(t[group])) {
        $(`theme-${group}-${key}`).value = value;
        $(`theme-picker-${group}-${key}`).value = value.slice(0, 7);
      }
    showSlot();
    syncArenaFields();
  }
  function syncArenaFields() {
    const t = switcher.current;
    const a = t.arena || { left: 0, top: 0, right: 1, bottom: 1 };
    $("themeArenaEnabled").checked = !!t.arena;
    for (const key of Object.keys(a)) $(`theme-arena-${key}`).value = a[key];
  }
  function showSlot() {
    const meta = switcher.current.slots[$("themeSlot").value] || { src: "" };
    $("themeAssetPreview").hidden = !meta.src;
    if (meta.src) $("themeAssetPreview").src = meta.src;
    else $("themeAssetPreview").removeAttribute("src");
    $("themeAssetInfo").textContent = meta.src
      ? meta.src.startsWith("data:")
        ? "内嵌图片 · 随主题包导出"
        : meta.src
      : "未设置 · 使用后备外观";
    for (const [key, def] of Object.entries({
      width: 1,
      height: 1,
      anchorX: 0.5,
      anchorY: 0.5,
      rotation: 0,
      frames: 1,
      columns: 1,
      fps: 8,
    }))
      $(`theme-meta-${key}`).value = meta[key] ?? def;
    $("theme-meta-loop").checked = meta.loop ?? true;
  }
  function buildEditor() {
    for (const [key, label] of Object.entries({
      left: "左边界",
      top: "上边界",
      right: "右边界",
      bottom: "下边界",
    })) {
      const row = document.createElement("label");
      row.className = "theme-color";
      row.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.min = 0;
      input.max = 1;
      input.step = 0.001;
      input.id = `theme-arena-${key}`;
      input.setAttribute("aria-label", `背景碰撞框${label}`);
      row.append(input);
      $("themeArenaGeometry").append(row);
    }
    for (const [key, label] of Object.entries(slotLabels))
      $("themeSlot").add(new Option(label, key));
    for (const [group, fields] of Object.entries({
      palette: paletteFields,
      render: renderFields,
    })) {
      for (const [key, [label]] of Object.entries(fields)) {
        const row = document.createElement("div");
        row.className = "theme-color";
        const span = document.createElement("span");
        span.textContent = label;
        const input = document.createElement("input");
        input.id = `theme-${group}-${key}`;
        input.type = "text";
        input.maxLength = 9;
        input.setAttribute("aria-label", `主题${label}`);
        const picker = document.createElement("input");
        picker.type = "color";
        picker.id = `theme-picker-${group}-${key}`;
        picker.setAttribute("aria-label", `选择${label}颜色`);
        picker.oninput = () => {
          input.value =
            picker.value + (switcher.current[group][key].slice(7) || "");
          input.onchange();
        };
        input.onchange = () => {
          try {
            const t = structuredClone(switcher.current);
            t[group][key] = input.value;
            const valid = validateTheme(t);
            switcher.current = valid;
            assets.palette = valid.render;
            picker.value = valid[group][key].slice(0, 7);
            applyAppearance(valid);
            markDirty();
          } catch (e) {
            input.value = switcher.current[group][key];
            toast(e.message);
          }
        };
        const controls = document.createElement("div");
        controls.className = "theme-color-controls";
        controls.append(picker, input);
        row.append(span, controls);
        $(group === "palette" ? "themePalette" : "themeRender").append(row);
      }
    }
    for (const [key, label] of Object.entries({
      width: "显示宽度倍率",
      height: "显示高度倍率",
      anchorX: "横向锚点",
      anchorY: "纵向锚点",
      rotation: "朝向校正（度）",
      frames: "总帧数",
      columns: "每行帧数",
      fps: "动画帧率",
    })) {
      const row = document.createElement("label");
      row.className = "theme-color";
      row.textContent = label;
      const input = document.createElement("input");
      input.type = "number";
      input.step = ["frames", "columns"].includes(key) ? "1" : "0.01";
      input.id = `theme-meta-${key}`;
      input.setAttribute("aria-label", `主题${label}`);
      row.append(input);
      $("themeGeometry").append(row);
    }
  }
  function metadata() {
    const meta = {};
    for (const key of [
      "width",
      "height",
      "anchorX",
      "anchorY",
      "rotation",
      "frames",
      "columns",
      "fps",
    ])
      meta[key] = Number($(`theme-meta-${key}`).value);
    meta.loop = $("theme-meta-loop").checked;
    return meta;
  }
  async function editSlot(src) {
    const t = structuredClone(switcher.current),
      key = $("themeSlot").value;
    t.slots[key] = {
      ...(t.slots[key] || {}),
      ...metadata(),
      src: src ?? t.slots[key]?.src ?? "",
    };
    if (await switcher.apply(t)) {
      sync();
      markDirty();
    }
  }
  buildEditor();
  catalog = await readJSON("assets/themes/catalog.json");
  if (catalog.version !== 1 || !Array.isArray(catalog.themes))
    throw new Error("主题目录版本不支持");
  for (const t of catalog.themes)
    $("themeSelect").add(new Option(t.name, t.id));
  $("themeSelect").add(new Option("自定义主题", "custom"));
  async function builtin(id) {
    const entry = catalog.themes.find((t) => t.id === id);
    if (!entry) throw new Error("请选择内置主题，或导入主题包");
    return readJSON(entry.src);
  }
  let initial;
  try {
    const stored = localStorage.getItem(THEME_STORAGE);
    if (stored) initial = JSON.parse(stored);
  } catch (e) {
    toast(`主题存档读取失败：${e.message}`);
  }
  try {
    const requested = new URLSearchParams(location.search).get("theme");
    await switcher.apply(
      requested
        ? await builtin(requested)
        : initial || (await builtin(catalog.default)),
    );
  } catch (e) {
    toast(`已回退玩具主题：${e.message}`);
    initial = null;
    await switcher.apply(await builtin(catalog.default));
  }
  sync();
  // Launch overrides are one-shot previews. Refresh must honor subsequently saved edits.
  const launchURL = new URL(location.href);
  if (
    launchURL.searchParams.has("theme") ||
    launchURL.searchParams.has("scene")
  ) {
    launchURL.searchParams.delete("theme");
    launchURL.searchParams.delete("scene");
    history.replaceState(null, "", launchURL);
  }
  $("themeApplyArena").onclick = () =>
    run(async () => {
      const t = structuredClone(switcher.current);
      if ($("themeArenaEnabled").checked)
        t.arena = Object.fromEntries(
          ["left", "top", "right", "bottom"].map((key) => [
            key,
            Number($(`theme-arena-${key}`).value),
          ]),
        );
      else delete t.arena;
      if (await switcher.apply(t)) {
        sync();
        markDirty();
      }
    });
  status(
    `当前：${switcher.current.name} · ${initial ? "已恢复主题存档" : "内置主题"}`,
  );
  $("themeSelect").onchange = () =>
    run(async () => {
      if (await switcher.apply(await builtin($("themeSelect").value))) {
        sync();
        markDirty();
      }
    });
  $("themeStyle").onchange = () => {
    const t = switcher.current;
    t.style = $("themeStyle").value;
    applyAppearance(t);
    markDirty();
  };
  for (const field of ["Name", "Id"])
    $(`theme${field}`).onchange = () => {
      try {
        const t = structuredClone(switcher.current);
        t[field.toLowerCase()] = $(`theme${field}`).value;
        switcher.current = validateTheme(t);
        applyAppearance(switcher.current);
        markDirty();
      } catch (e) {
        toast(e.message);
        sync();
      }
    };
  $("themeSlot").onchange = showSlot;
  $("themeApplyMeta").onclick = () => run(() => editSlot());
  $("themeClearAsset").onclick = () => run(() => editSlot(""));
  $("themeAssetFile").onchange = (e) =>
    run(async () => {
      const file = e.target.files[0];
      try {
        if (!file) return;
        if (file.size > 4 * 1024 * 1024)
          throw new Error("单张图片请控制在4 MiB以内");
        if (!["image/png", "image/webp", "image/jpeg"].includes(file.type))
          throw new Error("主题导入图片使用 PNG、WebP 或 JPEG");
        await editSlot(await dataURL(file));
      } finally {
        e.target.value = "";
      }
    });
  function saveTheme() {
    const value = JSON.stringify(validateTheme(switcher.current));
    try {
      localStorage.setItem(THEME_STORAGE, value);
    } catch {
      throw new Error("浏览器存储空间不足，请导出主题包保留修改");
    }
    dirty = false;
    status(`已保存主题：${switcher.current.name} · 刷新后恢复`);
  }
  $("themeSave").onclick = () => run(async () => saveTheme());
  $("themeRestore").onclick = () =>
    run(async () => {
      const saved = localStorage.getItem(THEME_STORAGE);
      await switcher.apply(
        saved ? JSON.parse(saved) : await builtin(catalog.default),
      );
      sync();
      dirty = false;
      status(`已恢复：${switcher.current.name}`);
    });
  $("themeImport").onchange = (e) =>
    run(async () => {
      try {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > MAX_THEME_BYTES) throw new Error("主题包超过8 MiB");
        if (await switcher.apply(JSON.parse(await file.text()))) {
          sync();
          markDirty();
          toast("主题包已预览，满意后点保存主题");
        }
      } finally {
        e.target.value = "";
      }
    });
  $("themeExport").onclick = () =>
    run(async () => {
      const t = structuredClone(switcher.current);
      // Rasterize decoded local SVG too, so an exported package has no external file dependencies.
      for (const [key, meta] of Object.entries(t.slots)) {
        if (!meta.src || meta.src.startsWith("data:")) continue;
        const exportAsset = new Assets();
        await exportAsset.set(key, meta.src, meta);
        const { img } = exportAsset.entries[key];
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        canvas.getContext("2d").drawImage(img, 0, 0);
        meta.src = canvas.toDataURL("image/png");
      }
      const json = JSON.stringify(validateTheme(t), null, 2);
      if (new Blob([json]).size > MAX_THEME_BYTES)
        throw new Error("导出包超过8 MiB，请缩小原图");
      const url = URL.createObjectURL(
          new Blob([json], { type: "application/json" }),
        ),
        a = document.createElement("a");
      a.href = url;
      a.download = `飞刀主题-${t.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status(
        `已导出：${t.name} · 包含全部图片${dirty ? "，浏览器修改尚未保存" : ""}`,
      );
    });
  const arenaEditor = setupArenaEditor({
    assets,
    getArena: () => switcher.current.arena,
    change: (arena) => {
      const t = structuredClone(switcher.current);
      if (arena) t.arena = arena;
      else delete t.arena;
      switcher.current = validateTheme(t);
      assets.arena = switcher.current.arena;
      applyAppearance(switcher.current);
      syncArenaFields();
      markDirty();
    },
    save: saveTheme,
    exportTheme: () => $("themeExport").click(),
    toast,
  });
  $("themeArenaEdit").onclick = () => arenaEditor.open();
  return {
    openArenaEditor: () => arenaEditor.open(),
    get arenaEditorOpen() {
      return arenaEditor.isOpen;
    },
    select: async (id) => {
      if (await switcher.apply(await builtin(id))) {
        sync();
        markDirty();
      }
    },
    reload: async () => {
      await switcher.apply(switcher.current);
      $("artState").textContent = "正式素材已重新加载";
    },
    get current() {
      return switcher.current;
    },
  };
}
