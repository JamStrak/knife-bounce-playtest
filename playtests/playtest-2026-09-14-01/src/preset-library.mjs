import { presets, validate } from "./config.mjs";
export const PRESET_STORAGE = "knife-club.presets.v1";
export function readLibrary(raw) {
  if (!raw) return { version: 1, custom: [], hidden: [], collapsed: false };
  const data = JSON.parse(raw);
  if (
    data?.version !== 1 ||
    !Array.isArray(data.custom) ||
    data.custom.length > 50 ||
    !Array.isArray(data.hidden)
  )
    throw new Error("手感预设库格式无效");
  const ids = new Set();
  const custom = data.custom.map((p) => {
    if (
      typeof p.id !== "string" ||
      !/^user-[\w-]{1,80}$/.test(p.id) ||
      ids.has(p.id) ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 40
    )
      throw new Error("预设名称或编号无效");
    ids.add(p.id);
    return {
      id: p.id,
      name: p.name,
      values: validate({ schemaVersion: 1, config: p.values }).config,
    };
  });
  return {
    version: 1,
    custom,
    hidden: [
      ...new Set(data.hidden.filter((id) => Object.hasOwn(presets, id))),
    ],
    collapsed: !!data.collapsed,
  };
}
export const libraryEntries = (data) => [
  ...Object.entries(presets)
    .filter(([id]) => !data.hidden.includes(id))
    .map(([id, p]) => ({ id, ...p, builtin: true })),
  ...data.custom.map((p) => ({ ...p, builtin: false })),
];
export function setupPresetLibrary({ getConfig, apply, toast, onDelete }) {
  const $ = (id) => document.getElementById(id),
    panel = $("feelPresets");
  let data,
    undo = null;
  try {
    data = readLibrary(localStorage.getItem(PRESET_STORAGE));
  } catch (e) {
    data = readLibrary(null);
    toast(`${e.message}，当前显示内置预设。`);
  }
  panel.open = !data.collapsed;
  const commit = (next) => {
    try {
      localStorage.setItem(PRESET_STORAGE, JSON.stringify(next));
      data = next;
      return true;
    } catch {
      toast("预设保存失败：浏览器空间不足或存储不可用，原预设保留。");
      return false;
    }
  };
  function render() {
    $("presetButtons").replaceChildren();
    for (const p of libraryEntries(data)) {
      const row = document.createElement("div");
      row.className = "preset-entry";
      const button = document.createElement("button");
      button.textContent = p.name;
      button.dataset.preset = p.id;
      button.onclick = () => apply(p);
      const remove = document.createElement("button");
      remove.className = "preset-delete";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `删除预设 ${p.name}`);
      remove.onclick = () => {
        const next = {
          ...data,
          hidden: p.builtin ? [...data.hidden, p.id] : data.hidden,
          custom: data.custom.filter((item) => item.id !== p.id),
        };
        if (commit(next)) {
          undo = p;
          onDelete(p.id);
          render();
          toast(`已删除预设“${p.name}”，当前游戏参数未改变，可撤销。`);
        }
      };
      row.append(button, remove);
      $("presetButtons").append(row);
    }
    $("undoPresetDelete").hidden = !undo;
  }
  panel.addEventListener("toggle", () => {
    const collapsed = !panel.open;
    if (collapsed === data.collapsed) return;
    if (!commit({ ...data, collapsed })) panel.open = !data.collapsed;
  });
  panel.querySelector("summary").addEventListener("click", (event) => {
    // Native details.toggle is queued: save before an immediate refresh/navigation.
    event.preventDefault();
    const collapsed = panel.open;
    commit({ ...data, collapsed });
    data = { ...data, collapsed };
    panel.open = !collapsed;
  });
  $("saveFeelPreset").onclick = () => {
    const name = $("feelPresetName").value.trim();
    if (!name || name.length > 40) return toast("请填写1至40字的预设名称。");
    if (data.custom.length >= 50)
      return toast("最多保留50份自定义预设，请先删除不需要的预设。");
    if (libraryEntries(data).some((p) => p.name === name))
      return toast("已有同名预设，请使用不同名称。");
    const p = {
      id: `user-${crypto.randomUUID()}`,
      name,
      values: validate({ schemaVersion: 1, config: getConfig() }).config,
    };
    if (commit({ ...data, custom: [...data.custom, p] })) {
      $("feelPresetName").value = "";
      render();
      toast(`已保存“${name}”，包含当前全部调参。`);
    }
  };
  $("undoPresetDelete").onclick = () => {
    if (!undo) return;
    const next = undo.builtin
      ? { ...data, hidden: data.hidden.filter((id) => id !== undo.id) }
      : {
          ...data,
          custom: [
            ...data.custom,
            { id: undo.id, name: undo.name, values: undo.values },
          ],
        };
    if (commit(next)) {
      undo = null;
      render();
      toast("已恢复删除的预设。");
    }
  };
  $("restoreBuiltinPresets").onclick = () => {
    if (commit({ ...data, hidden: [] })) {
      render();
      toast("已恢复全部内置预设，自定义预设不变。");
    }
  };
  render();
  return {
    name: (id) =>
      data.custom.find((p) => p.id === id)?.name || presets[id]?.name,
    markActive: (id) => {
      for (const button of $("presetButtons").querySelectorAll("[data-preset]"))
        button.classList.toggle("active", button.dataset.preset === id);
    },
  };
}
