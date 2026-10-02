import { THEME_STORAGE } from "./themes.mjs";

const LARGE_THEME = "knife-club.large-theme.v1";
const INLINE_LIMIT = 2 * 1024 * 1024;

// Small, path-based themes retain the original localStorage format. Embedded
// art packages use immutable IndexedDB records, committed before their pointer.
function databaseStore() {
  let opening;
  const open = () =>
    (opening ||= new Promise((resolve, reject) => {
      if (!globalThis.indexedDB) return reject(new Error("图片存储不可用"));
      const request = indexedDB.open("knife-club.theme-assets.v1", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("themes");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("请关闭其他游戏页面后重试"));
    }).catch((error) => {
      opening = null;
      throw error;
    }));
  const request = async (mode, action) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("themes", mode);
      const operation = action(tx.objectStore("themes"));
      tx.oncomplete = () => resolve(operation.result);
      tx.onabort = () => reject(tx.error || new Error("图片存档写入失败"));
      tx.onerror = () => {};
    });
  };
  return {
    get: (key) => request("readonly", (s) => s.get(key)),
    put: (key, value) => request("readwrite", (s) => s.put(value, key)),
    delete: (key) => request("readwrite", (s) => s.delete(key)),
  };
}

export function createThemeStorage({
  storage = {
    getItem: (key) => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
  },
  images = databaseStore(),
  makeKey = () =>
    Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
      n.toString(16),
    ).join("-"),
} = {}) {
  let queue = Promise.resolve();
  const pointer = (value) =>
    value?.storage === LARGE_THEME && typeof value.key === "string";
  const read = async () => {
    const raw = storage.getItem(THEME_STORAGE);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!pointer(value)) return value;
    const theme = await images.get(value.key);
    if (!theme) throw new Error("主题图片存档缺失，请重新导入主题包");
    return theme;
  };
  const write = async (theme) => {
    const json = JSON.stringify(theme);
    let previous;
    try {
      previous = JSON.parse(storage.getItem(THEME_STORAGE));
    } catch {}
    let key;
    try {
      if (json.length > INLINE_LIMIT) {
        key = makeKey();
        await images.put(key, JSON.parse(json));
        storage.setItem(
          THEME_STORAGE,
          JSON.stringify({ storage: LARGE_THEME, key }),
        );
      } else storage.setItem(THEME_STORAGE, json);
    } catch (error) {
      if (key) await images.delete(key).catch(() => {});
      const reason =
        error.name === "QuotaExceededError"
          ? "浏览器存储空间不足"
          : error.message;
      throw new Error(`主题保存失败：${reason}。请导出主题包保留修改`);
    }
    if (pointer(previous)) await images.delete(previous.key).catch(() => {});
  };
  return {
    read,
    save(theme) {
      const snapshot = structuredClone(theme);
      const task = queue.then(() => write(snapshot));
      queue = task.catch(() => {});
      return task;
    },
  };
}
