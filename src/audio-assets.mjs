// Browser-local replacements are independent from saved gameplay parameters.
export const audioSlots = Object.entries({
  music: "背景音乐",
  launch: "飞刀发射",
  recallLaunch: "召回飞刀发射",
  bounce: "飞刀反弹",
  hit: "击中怪物",
  pin: "飞刀插入",
  kill: "击杀怪物",
  combo: "连击奖励",
  explode: "爆炸",
  pickup: "拾取道具",
  recall: "万刃归心拔刀",
  whirlwind: "旋风斩",
  lightning: "连锁闪电",
  ring: "环形刀阵",
  plant: "植入爆弹",
  leak: "防线受损",
  levelUp: "升级",
  stageStart: "关卡开始",
  bossEntry: "首领登场",
  stageClear: "关卡完成",
  victory: "战役胜利",
  failure: "失败",
}).map(([key, name]) => ({ key, name }));
const keys = new Set(audioSlots.map((s) => s.key));
const assets = new Map(),
  musicPlayers = new WeakMap();
let database,
  loading,
  mutation = Promise.resolve();
function openDatabase() {
  if (!database)
    database = new Promise((resolve, reject) => {
      if (!globalThis.indexedDB)
        return reject(new Error("当前浏览器不支持本地音频存储"));
      const request = indexedDB.open("knife-audio-assets", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("assets", { keyPath: "key" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error("无法打开本地音频存储"));
    }).catch((error) => {
      database = null;
      throw error;
    });
  return database;
}
async function decode(blob) {
  const Offline =
    globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;
  const Live = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Offline && !Live) throw new Error("当前浏览器不支持音频解码");
  const context = Offline ? new Offline(2, 1, 44100) : new Live();
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    if (!buffer.duration || !Number.isFinite(buffer.duration))
      throw new Error("空音频");
    return buffer;
  } catch {
    throw new Error("音频无法解码，请使用有效的 WAV、MP3 或 OGG 文件");
  } finally {
    if (!Offline) await context.close();
  }
}
async function write(key, value) {
  const db = await openDatabase();
  await new Promise((resolve, reject) => {
    const tx = db.transaction("assets", "readwrite"),
      store = tx.objectStore("assets");
    if (value) store.put(value);
    else store.delete(key);
    tx.oncomplete = resolve;
    tx.onerror = tx.onabort = () =>
      reject(new Error("保存音频失败，请检查浏览器存储空间；原资源已保留"));
  });
}
export function loadAudioLibrary() {
  if (!loading)
    loading = (async () => {
      const db = await openDatabase();
      const rows = await new Promise((resolve, reject) => {
        const request = db.transaction("assets").objectStore("assets").getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error("读取音频资源失败"));
      });
      await Promise.all(
        rows
          .filter((row) => keys.has(row.key))
          .map(async (row) => {
            try {
              assets.set(row.key, { ...row, buffer: await decode(row.blob) });
            } catch {
              /* An unreadable legacy file falls back to the built-in cue. */
            }
          }),
      );
      return audioAssetNames();
    })().catch((error) => {
      loading = null;
      throw error;
    });
  return loading;
}
function serialize(operation) {
  const result = mutation.then(operation);
  mutation = result.catch(() => {});
  return result;
}
export function setAudioAsset(key, file) {
  return serialize(async () => {
    if (!keys.has(key)) throw new Error("未知音频位置");
    if (!file?.size || file.size > 50 * 1024 * 1024)
      throw new Error("请选择小于 50 MB 的非空音频文件");
    await loadAudioLibrary();
    const buffer = await decode(file);
    const row = { key, name: file.name || "自定义音频", blob: file };
    await write(key, row);
    assets.set(key, { ...row, buffer });
    return audioAssetNames();
  });
}
export function removeAudioAsset(key) {
  return serialize(async () => {
    if (!keys.has(key)) throw new Error("未知音频位置");
    await loadAudioLibrary();
    await write(key, null);
    assets.delete(key);
    return audioAssetNames();
  });
}
export function audioAssetNames() {
  return Object.fromEntries(
    [...assets].map(([key, value]) => [key, value.name]),
  );
}
export function audioAssetBuffer(key) {
  return assets.get(key)?.buffer || null;
}
export function stopMusic(context) {
  const player = context && musicPlayers.get(context);
  if (!player?.source) return;
  player.offset =
    (player.offset + Math.max(0, context.currentTime - player.started)) %
    player.buffer.duration;
  try {
    player.source.stop();
    player.source.disconnect();
    player.gain.disconnect();
  } catch {}
  player.source = null;
}
export function syncMusic(context, config, running) {
  if (!context) return false;
  const buffer = audioAssetBuffer("music");
  let player = musicPlayers.get(context);
  if (player && player.buffer !== buffer) {
    stopMusic(context);
    musicPlayers.delete(context);
    player = null;
  }
  const volume =
    Math.max(0, Math.min(1, config.volume ?? 0.5)) *
    Math.max(0, Math.min(1, config.musicVolume ?? 0.5));
  if (
    !buffer ||
    !running ||
    !config.sound ||
    config.musicOn === false ||
    !volume ||
    context.state !== "running"
  ) {
    stopMusic(context);
    return false;
  }
  if (!player) {
    player = { buffer, offset: 0, source: null };
    musicPlayers.set(context, player);
  }
  if (!player.source) {
    player.source = context.createBufferSource();
    player.gain = context.createGain();
    player.source.buffer = buffer;
    player.source.loop = true;
    player.source.connect(player.gain);
    player.gain.connect(context.destination);
    player.gain.gain.setValueAtTime(volume, context.currentTime);
    player.started = context.currentTime;
    player.source.start(0, player.offset);
  }
  player.gain.gain.setValueAtTime(volume, context.currentTime);
  return true;
}
