import { bundledRelease } from "./bundled-release.mjs";
// Browser replacements override the frozen release library, without modifying it.
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
  bundledAssets = new Map(),
  unreadable = new Set(),
  musicPlayers = new WeakMap();
let database,
  loading,
  bundleLoading,
  mutation = Promise.resolve();
function loadBundledAudio() {
  return (bundleLoading ||= (async () => {
    const prepared = new Map();
    const entries = bundledRelease?.audio || [],
      sources = new Map();
    let next = 0;
    const read = (src) => {
      if (!sources.has(src))
        sources.set(
          src,
          (async () => {
            const response = await fetch(src);
            if (!response.ok) throw new Error("发布音频下载失败");
            const blob = await response.blob();
            return { blob, buffer: await decode(blob) };
          })(),
        );
      return sources.get(src);
    };
    // Bound decoding work on phones, while avoiding one network round trip per cue.
    const settled = await Promise.allSettled(
      Array.from({ length: Math.min(4, entries.length) }, async () => {
        while (next < entries.length) {
          const entry = entries[next++];
          let decoded;
          try {
            decoded = await read(entry.src);
          } catch (error) {
            if (!entry.fallbackSrc)
              throw new Error(`${entry.name}：${error.message}`);
            decoded = await read(entry.fallbackSrc);
          }
          prepared.set(entry.key, { ...entry, ...decoded });
        }
      }),
    );
    // Finish this attempt before allowing a retry, including workers which
    // were still downloading when another cue failed.
    const failed = settled.find((row) => row.status === "rejected");
    if (failed) throw failed.reason;
    for (const [key, row] of prepared) bundledAssets.set(key, row);
  })().catch((error) => {
    bundleLoading = null;
    throw error;
  }));
}
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
      await loadBundledAudio();
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
              unreadable.add(row.key);
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
    unreadable.delete(key);
    return audioAssetNames();
  });
}
export function removeAudioAsset(key) {
  return serialize(async () => {
    if (!keys.has(key)) throw new Error("未知音频位置");
    await loadAudioLibrary();
    await write(key, null);
    assets.delete(key);
    unreadable.delete(key);
    return audioAssetNames();
  });
}
export function audioAssetNames() {
  return Object.fromEntries(
    [...new Map([...bundledAssets, ...assets])].map(([key, value]) => [
      key,
      value.name,
    ]),
  );
}
export function audioAssetBuffer(key) {
  return (assets.get(key) || bundledAssets.get(key))?.buffer || null;
}
// Capture the actual active bytes after pending replacements have settled.
// Unlike playback fallback, export must never silently omit a broken file.
export function snapshotAudioAssets() {
  return serialize(async () => {
    await loadAudioLibrary();
    if (unreadable.size)
      throw new Error(
        `这些音频无法读取，请重新替换后导出：${[...unreadable].join("、")}`,
      );
    const rows = [];
    const exportSources = new Map();
    for (const [key, row] of new Map([...bundledAssets, ...assets])) {
      let blob = row.blob;
      // Re-export the original lossless source so the next build can retain
      // its WAV fallback, even when this browser currently plays FLAC.
      // Browser replacements have no fallbackSrc and keep their own bytes.
      if (row.fallbackSrc) {
        if (!exportSources.has(row.fallbackSrc)) {
          const response = await fetch(row.fallbackSrc);
          if (!response.ok)
            throw new Error(`导出原始音频失败：${row.name}，请重试`);
          const source = await response.blob();
          await decode(source);
          exportSources.set(row.fallbackSrc, source);
        }
        blob = exportSources.get(row.fallbackSrc);
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`读取音频失败：${row.name}`));
        reader.readAsDataURL(blob);
      });
      rows.push({ key, name: row.name, dataUrl });
    }
    return rows.sort((a, b) => a.key.localeCompare(b.key));
  });
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
