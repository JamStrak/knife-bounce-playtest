import { validate } from "./config.mjs";
import { audioSlots } from "./audio-assets.mjs";
import { readEmbeddedReleaseData } from "./release-package.mjs";

// Portable settings are deliberately separate from publishing a themed build.
// Every audio entry contains real bytes; omitted slots keep the destination's
// existing sounds, just as importing a numeric preset leaves sounds alone.
export const SETTINGS_KIND = "knife-portable-settings";
export const MAX_SETTINGS_BYTES = 200 * 1024 * 1024;
const audioKeys = new Set(audioSlots.map(({ key }) => key));
const encoder = new TextEncoder();
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function fields(value, expected, label) {
  if (
    !object(value) ||
    Object.keys(value).length !== expected.length ||
    expected.some((key) => !Object.hasOwn(value, key))
  )
    throw new Error(`${label}字段不完整或包含未知字段`);
}

export function validateSettingsPackage(data) {
  fields(
    data,
    ["kind", "schemaVersion", "createdAt", "config", "audio"],
    "便携设置包",
  );
  if (data.kind !== SETTINGS_KIND || data.schemaVersion !== 1)
    throw new Error("不是本游戏支持的便携设置与音效包");
  if (
    typeof data.createdAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(data.createdAt) ||
    !Number.isFinite(Date.parse(data.createdAt)) ||
    new Date(data.createdAt).toISOString() !== data.createdAt
  )
    throw new Error("便携设置包创建时间无效");
  const serialized = JSON.stringify(data);
  if (
    serialized.length > MAX_SETTINGS_BYTES ||
    encoder.encode(serialized).byteLength > MAX_SETTINGS_BYTES
  )
    throw new Error("便携设置包超过200 MiB，请减少音频大小");
  const { config } = validate({ schemaVersion: 1, config: data.config });
  if (!Array.isArray(data.audio) || data.audio.length > audioKeys.size)
    throw new Error("便携设置包音频列表无效");
  const seen = new Set();
  for (const row of data.audio) {
    fields(row, ["key", "name", "dataUrl"], "音频素材");
    if (!audioKeys.has(row.key) || seen.has(row.key))
      throw new Error(`无效或重复的音频槽位：${row.key}`);
    seen.add(row.key);
    if (
      typeof row.name !== "string" ||
      !row.name.trim() ||
      row.name.length > 200 ||
      /[\u0000-\u001f\u007f]/.test(row.name)
    )
      throw new Error(`音频 ${row.key} 文件名称无效`);
    readEmbeddedReleaseData(row.dataUrl, "audio");
  }
  return {
    kind: SETTINGS_KIND,
    schemaVersion: 1,
    createdAt: data.createdAt,
    config,
    audio: data.audio.map((row) => ({ ...row })),
  };
}

export function createSettingsPackage({ config, audio = [] }) {
  return validateSettingsPackage({
    kind: SETTINGS_KIND,
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    config,
    audio,
  });
}

// Structural validation never substitutes for Web Audio decoding. The caller
// must await importAudioAssets before applying the returned numeric config.
export function prepareSettingsAudio(bundle) {
  const checked = validateSettingsPackage(bundle);
  return checked.audio.map(({ key, name, dataUrl }) => {
    const { bytes, mime } = readEmbeddedReleaseData(dataUrl, "audio");
    return { key, name, blob: new Blob([bytes], { type: mime }) };
  });
}
