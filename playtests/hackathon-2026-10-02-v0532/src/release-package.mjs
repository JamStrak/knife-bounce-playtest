import { schema, validate } from "./config.mjs";
import { validateTheme } from "./themes.mjs";
import { audioSlots } from "./audio-assets.mjs";
import { realtimeKeys, realtimeAdaptiveKeys } from "./realtime-schema.mjs";
import { barrageKeys, guardWaveKeys } from "./barrage-schema.mjs";

export const RELEASE_KIND = "knife-playtest-release";
export const MAX_RELEASE_BYTES = 200 * 1024 * 1024;
export const MAX_RELEASE_THEME_BYTES = 100 * 1024 * 1024;
export const MAX_RELEASE_AUDIO_BYTES = 50 * 1024 * 1024;
export const MAX_RELEASE_IMAGE_BYTES = 4 * 1024 * 1024;
const audioKeys = new Set(audioSlots.map(({ key }) => key));
const audioMimes = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/vnd.wave",
  "audio/ogg",
  "audio/webm",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/flac",
  "audio/x-flac",
  "application/ogg",
  "application/octet-stream",
]);
const imageMimes = new Set(["image/png", "image/jpeg", "image/webp"]);
const launchPositionKeys = ["launchKnifeOffsetX", "launchKnifeOffsetY"];
const knifeBulletExtensionKeys = ["knifeBlocksBullets"];
export const barrageExtensionKeys = [
  ...barrageKeys,
  ...Object.keys(schema).filter((key) => schema[key].entityType === "shooter"),
];
export const wavePressureExtensionKeys = ["realtimeDensity", ...guardWaveKeys];
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

// Sorted object keys make the fingerprint independent of JSON indentation/order.
export function canonicalReleaseJSON(value) {
  if (value === null || typeof value !== "object") {
    const json = JSON.stringify(value);
    if (
      json === undefined ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      throw new Error("完整发布包包含无法保存的值");
    return json;
  }
  if (Array.isArray(value))
    return `[${value.map(canonicalReleaseJSON).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalReleaseJSON(value[key])}`)
    .join(",")}}`;
}

export async function releaseSHA256(value) {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  if (!globalThis.crypto?.subtle)
    throw new Error("当前环境不支持完整包校验，请使用 localhost 或 HTTPS 页面");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
}

// File decoding is intentionally separate: the browser must decode all media
// before restoring a package. This layer checks transport, limits and integrity.
export function readEmbeddedReleaseData(dataUrl, kind) {
  const allowed = kind === "image" ? imageMimes : audioMimes;
  const max =
    kind === "image" ? MAX_RELEASE_IMAGE_BYTES : MAX_RELEASE_AUDIO_BYTES;
  if (typeof dataUrl !== "string") throw new Error("素材必须是内嵌 data URL");
  if (dataUrl.length > Math.ceil(max / 3) * 4 + 100)
    throw new Error(
      kind === "image" ? "完整包单张图片超过4 MiB" : "完整包单条音频超过50 MiB",
    );
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(dataUrl);
  if (
    !match ||
    !allowed.has(match[1].toLowerCase()) ||
    match[2].length % 4 !== 0
  )
    throw new Error(
      `无效的内嵌${kind === "image" ? "图片" : "音频"}，不支持外链或临时地址`,
    );
  let binary;
  try {
    binary = atob(match[2]);
  } catch {
    throw new Error("素材的 Base64 内容损坏");
  }
  if (!binary.length || binary.length > max || btoa(binary) !== match[2])
    throw new Error("素材为空、超过大小限制或 Base64 内容不完整");
  return {
    mime: match[1].toLowerCase(),
    bytes: Uint8Array.from(binary, (c) => c.charCodeAt(0)),
  };
}

function validatedPayload(payload, { allowLegacyConfig = false } = {}) {
  fields(
    payload,
    ["kind", "schemaVersion", "release", "config", "theme", "audio"],
    "完整发布包",
  );
  // Fail before decoding every asset when a library exceeds the total limit.
  const serialized = JSON.stringify(payload);
  if (
    serialized.length > MAX_RELEASE_BYTES - 256 ||
    encoder.encode(serialized).byteLength > MAX_RELEASE_BYTES - 256
  )
    throw new Error("完整发布包超过200 MiB，请先压缩素材");
  if (payload.kind !== RELEASE_KIND || payload.schemaVersion !== 1)
    throw new Error("不是本游戏支持的完整发布包（需要版本1）");
  fields(payload.release, ["id", "version", "createdAt"], "发布信息");
  const { id, version, createdAt } = payload.release;
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(id))
    throw new Error("发布编号仅允许字母、数字、短横线、下划线和点，最多80字符");
  if (
    typeof version !== "string" ||
    version.length > 60 ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(version)
  )
    throw new Error("发布版本请使用 0.42.0 形式");
  if (
    typeof createdAt !== "string" ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt)) ||
    new Date(createdAt).toISOString() !== createdAt
  )
    throw new Error("发布时间无效");
  // Frozen package versions select one exact historical field set. Never infer
  // arbitrary omissions from the supplied keys, mutate them, or re-sign them.
  // Current complete exports stay strict regardless of their version label.
  const currentFields = Object.keys(schema);
  let configFields = currentFields;
  if (
    allowLegacyConfig &&
    object(payload.config) &&
    Object.keys(payload.config).length !== currentFields.length
  ) {
    const oldUpgradeTiming = /^0\.(?:4[2-9]|50|51)\.\d+$/.test(version)
      ? ["upgradeSettleDelay"]
      : [];
    const oldRecallIntro = /^0\.(?:4[2-9]|5[0-2])\.\d+$/.test(version)
      ? ["recallIntroDuration"]
      : [];
    const omitted = /^0\.(42|43)\.\d+$/.test(version)
      ? [...realtimeKeys, ...launchPositionKeys, ...barrageExtensionKeys]
      : ["0.44.0", "0.44.1"].includes(version)
        ? [
            ...launchPositionKeys,
            ...realtimeAdaptiveKeys,
            ...barrageExtensionKeys,
            "realtimeDensity",
          ]
        : ["0.45.0", "0.45.1"].includes(version)
          ? [
              ...realtimeAdaptiveKeys,
              ...barrageExtensionKeys,
              "realtimeDensity",
            ]
          : ["0.46.0", "0.47.0"].includes(version)
            ? [...barrageExtensionKeys, "realtimeDensity"]
            : version === "0.48.0"
              ? [...wavePressureExtensionKeys, ...knifeBulletExtensionKeys]
              : version === "0.49.0"
                ? knifeBulletExtensionKeys
                : [];
    configFields = currentFields.filter(
      (key) =>
        !omitted.includes(key) &&
        !oldUpgradeTiming.includes(key) &&
        !oldRecallIntro.includes(key),
    );
  }
  fields(payload.config, configFields, "完整配置");
  const config = validate({ schemaVersion: 1, config: payload.config }).config;
  for (const key of configFields)
    if (config[key] !== payload.config[key])
      throw new Error(`配置 ${key} 不能在发布时自动改写`);
  const theme = validateTheme(payload.theme, {
    maxBytes: MAX_RELEASE_THEME_BYTES,
  });
  for (const [key, meta] of Object.entries(theme.slots)) {
    if (meta.src === "") continue;
    try {
      readEmbeddedReleaseData(meta.src, "image");
    } catch (error) {
      throw new Error(`主题 ${key}：${error.message}`);
    }
  }
  if (!Array.isArray(payload.audio) || payload.audio.length > audioKeys.size)
    throw new Error("音频列表无效或数量超过支持的槽位");
  const seen = new Set();
  for (const row of payload.audio) {
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
  const json = canonicalReleaseJSON(payload);
  if (encoder.encode(json).byteLength > MAX_RELEASE_BYTES - 256)
    throw new Error("完整发布包超过200 MiB，请先压缩素材");
  return json;
}

export async function createReleasePackage({
  id,
  version,
  config,
  theme,
  audio = [],
}) {
  // Reject missing config fields before validation has a chance to fill defaults.
  const payload = JSON.parse(
    JSON.stringify({
      kind: RELEASE_KIND,
      schemaVersion: 1,
      release: { id, version, createdAt: new Date().toISOString() },
      config,
      theme: validateTheme(theme, { maxBytes: MAX_RELEASE_THEME_BYTES }),
      audio,
    }),
  );
  const json = validatedPayload(payload);
  return {
    ...payload,
    integrity: { algorithm: "SHA-256", sha256: await releaseSHA256(json) },
  };
}

export async function validateReleasePackage(bundle) {
  fields(
    bundle,
    [
      "kind",
      "schemaVersion",
      "release",
      "config",
      "theme",
      "audio",
      "integrity",
    ],
    "完整发布包",
  );
  fields(bundle.integrity, ["algorithm", "sha256"], "完整包校验信息");
  if (
    bundle.integrity.algorithm !== "SHA-256" ||
    !/^[a-f0-9]{64}$/.test(bundle.integrity.sha256)
  )
    throw new Error("完整包缺少有效的 SHA-256 校验值");
  const { integrity, ...payload } = bundle;
  const json = validatedPayload(payload, { allowLegacyConfig: true });
  if ((await releaseSHA256(json)) !== integrity.sha256)
    throw new Error(
      "完整发布包校验失败，内容可能被修改或导出不完整，请重新导出",
    );
  return structuredClone(bundle);
}
