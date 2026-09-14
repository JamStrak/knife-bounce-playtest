export const THEME_STORAGE = "knife-club.theme.v1";
export const MAX_THEME_BYTES = 8 * 1024 * 1024;
export const paletteFields = {
  background: ["页面底色", "#6dbcea"],
  shellTop: ["顶部背景", "#80ceff"],
  shellBottom: ["底部背景", "#cce9fc"],
  surface: ["面板底色", "#edf7ff"],
  surfaceAlt: ["面板渐变", "#f8eada"],
  text: ["主要文字", "#304f72"],
  muted: ["次要文字", "#69849a"],
  border: ["分隔边线", "#bdd4e7"],
  primary: ["主色 / 蓝边", "#258ae6"],
  secondary: ["副色 / 橙边", "#ff9332"],
  accent: ["强调色", "#ffbf35"],
  onPrimary: ["主按钮文字", "#ffffff"],
};
export const renderFields = {
  pickupPower: ["狂热晶石颜色", "#ff6b60"],
  pickupLightning: ["雷链晶核", "#65cfff"],
  pickupRing: ["环刃符", "#e9b646"],
  pickupSeed: ["爆弹种子", "#bb71ef"],
  discRim: ["中央圆盘边环", "#88cfda"],
  discFace: ["中央圆盘盘面", "#edf4df"],
  discCore: ["中央圆盘中心", "#ecaa81"],
  knifeBlade: ["3D刀刃颜色", "#c4d0e0"],
  knifeGuard: ["3D护手与尾帽颜色", "#e2aa48"],
  knifeGrip: ["3D握柄颜色", "#3c414b"],
  knifeLight: ["3D灯光颜色", "#fff3df"],
  floor: ["地面底色", "#d7bd91"],
  grid: ["格子线", "#b28f5d30"],
  dangerZone: ["防线区域", "#ffaa2520"],
  dangerLine: ["防线虚线", "#e79129"],
  floorText: ["地面文字", "#997344"],
  shadow: ["怪物阴影", "#75533735"],
  health: ["血量底色", "#315572"],
  healthDanger: ["危险血量", "#e65540"],
  healthText: ["血量文字", "#ffffff"],
  aim: ["瞄准点", "#0d9ff5"],
  trail: ["飞刀拖尾", "#44bfff88"],
  origin: ["发射台光圈", "#309bd688"],
  recall: ["墙刀唤醒光", "#2eaeff"],
  recallTrail: ["墙刀瞄准光", "#30a5ff88"],
  blast: ["爆炸怪光圈填充", "#66cfff55"],
  floatText: ["飘字", "#263e64"],
  leakParticle: ["漏怪粒子", "#ff7669"],
  killParticle: ["击杀粒子", "#dbed9b"],
  hitParticle: ["命中粒子", "#ffa05e"],
};
export const defaultCreatureSlots = {
  bombExplosion02: {
    src: "assets/effects/bomb02.png",
    width: 1,
    height: 447 / 446,
    anchorX: 0.5,
    anchorY: 0.5,
    frames: 8,
    columns: 2,
    fps: 16,
    loop: false,
  },
  bombExplosion: {
    src: "assets/effects/bomb-burst.png",
    width: 1,
    height: 1,
    anchorX: 0.5,
    anchorY: 0.5,
    frames: 8,
    columns: 2,
    fps: 16,
    loop: false,
  },
  enemyUltraFast: {
    src: "assets/space/squid-idle.png",
    width: 0.815,
    height: 2,
    anchorX: 0.5,
    anchorY: 0.5,
    frames: 30,
    columns: 6,
    fps: 8,
    loop: true,
  },
  corpseUltraFast: {
    src: "assets/space/squid-corpse.png",
    width: 0.815,
    height: 2,
    anchorX: 0.5,
    anchorY: 0.5,
    frames: 1,
    columns: 1,
    fps: 8,
    loop: false,
  },
};
export const slotLabels = {
  bombExplosion02: "炸弹爆炸 · bomb02（新增）",
  bombExplosion: "炸弹爆炸 · bomb-burst（原版）",
  enemyUltraFast: "鱿鱼超快速怪（序列帧）",
  corpseUltraFast: "鱿鱼超快速怪战败",
  pickupPower: "狂热晶石道具（可选替图）",
  pickupLightning: "雷链晶核道具（可选替图）",
  pickupRing: "环刃符道具（可选替图）",
  pickupSeed: "爆弹种子道具（可选替图）",
  enemy: "怪物 A",
  enemyOrange: "怪物 B",
  enemyBomb: "爆炸怪",
  enemyFast: "快速怪",
  corpseFast: "快速怪战败",
  enemyHit: "受击替图",
  corpse: "战败 A",
  corpseOrange: "战败 B",
  knife: "飞刀",
  launcher: "发射台",
  launcherDisc: "中央圆盘发射台（可选替图）",
  floorTile: "单格地砖",
  background: "整幅背景",
  uiCrown: "皇冠",
  uiHeart: "爱心",
  uiCoin: "金币",
  uiXp: "经验图标",
  uiTrack: "经验条底图",
  uiButton: "按钮底图",
  uiPause: "暂停图标",
  uiBrand: "标题图标",
};
const defaultsOf = (fields) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v[1]]));
export const defaultRender = defaultsOf(renderFields);
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value);
function colors(input, fields) {
  if (input !== undefined && !object(input)) throw new Error("配色必须是对象");
  const result = defaultsOf(fields);
  for (const [key, value] of Object.entries(input || {})) {
    if (
      !Object.hasOwn(fields, key) ||
      typeof value !== "string" ||
      !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)
    )
      throw new Error(`无效配色：${key}（使用 #RRGGBB 或 #RRGGBBAA）`);
    result[key] = value;
  }
  return result;
}
export function validImageSource(src) {
  return (
    typeof src === "string" &&
    (src === "" ||
      /^assets\/(?:[\w\u4e00-\u9fff -]+\/)*[\w\u4e00-\u9fff -]+\.(png|webp|jpe?g|svg)$/i.test(
        src,
      ) ||
      /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/]+=*$/i.test(src))
  );
}
export function validateTheme(input, { maxBytes = MAX_THEME_BYTES } = {}) {
  if (!object(input) || input.schemaVersion !== 1)
    throw new Error("主题包版本不支持，需要 schemaVersion: 1");
  if (JSON.stringify(input).length > maxBytes)
    throw new Error(`主题包超过 ${maxBytes / 1024 / 1024} MiB，请先压缩图片`);
  for (const key of Object.keys(input))
    if (
      ![
        "schemaVersion",
        "id",
        "name",
        "style",
        "palette",
        "render",
        "slots",
        "arena",
      ].includes(key)
    )
      throw new Error(`主题不支持字段：${key}`);
  if (
    typeof input.id !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.id)
  )
    throw new Error("主题 ID 仅允许小写字母、数字和短横线，最多64字符");
  if (
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 60
  )
    throw new Error("主题名称需为1至60个字符");
  if (!["toy", "classic", "crystal"].includes(input.style))
    throw new Error("皮肤样式必须是 toy、classic 或 crystal");
  if (!object(input.slots)) throw new Error("主题缺少素材槽位");
  const slots = structuredClone(defaultCreatureSlots);
  for (const [key, meta] of Object.entries(input.slots)) {
    if (
      !Object.hasOwn(slotLabels, key) ||
      !object(meta) ||
      !validImageSource(meta.src)
    )
      throw new Error(
        `无效素材：${key}（仅项目 assets 路径或内嵌 PNG/WebP/JPEG）`,
      );
    for (const field of Object.keys(meta))
      if (
        ![
          "src",
          "width",
          "height",
          "anchorX",
          "anchorY",
          "rotation",
          "frames",
          "columns",
          "fps",
          "loop",
        ].includes(field)
      )
        throw new Error(`未知素材参数：${field}`);
    for (const field of ["width", "height", "fps", "frames", "columns"])
      if (
        meta[field] !== undefined &&
        (!Number.isFinite(meta[field]) ||
          meta[field] <= 0 ||
          meta[field] > 4096)
      )
        throw new Error(`素材 ${key}.${field} 须大于0且不超过4096`);
    for (const field of ["frames", "columns"])
      if (meta[field] !== undefined && !Number.isInteger(meta[field]))
        throw new Error(`素材 ${field} 必须为整数`);
    for (const field of ["anchorX", "anchorY", "rotation"])
      if (
        meta[field] !== undefined &&
        (!Number.isFinite(meta[field]) || Math.abs(meta[field]) > 4096)
      )
        throw new Error(`素材 ${field} 必须为有限数字`);
    if (meta.loop !== undefined && typeof meta.loop !== "boolean")
      throw new Error("loop 必须为布尔值");
    slots[key] = { ...meta };
  }
  for (const key of ["enemy", "corpse", "knife"])
    if (!slots[key]?.src) throw new Error(`必需素材缺失：${key}`);
  let arena;
  if (input.arena !== undefined) {
    const a = input.arena;
    if (
      !object(a) ||
      Object.keys(a).length !== 4 ||
      !["left", "top", "right", "bottom"].every(
        (key) => Number.isFinite(a[key]) && a[key] >= 0 && a[key] <= 1,
      ) ||
      a.right - a.left < 0.1 ||
      a.bottom - a.top < 0.1
    )
      throw new Error("背景碰撞框需为0～1的左上右下比例，宽高至少10%");
    arena = { ...a };
  }
  return {
    schemaVersion: 1,
    id: input.id,
    name: input.name.trim(),
    style: input.style,
    palette: colors(input.palette, paletteFields),
    render: colors(input.render, renderFields),
    slots,
    ...(arena ? { arena } : {}),
  };
}
// Preparation is isolated. Only a completely decoded, newest request may commit.
export class ThemeSwitcher {
  constructor(prepare, commit) {
    this.prepare = prepare;
    this.commit = commit;
    this.current = null;
    this.sequence = 0;
  }
  async apply(input) {
    const seq = ++this.sequence;
    const theme = validateTheme(input);
    const resources = await this.prepare(theme);
    if (seq !== this.sequence) return false;
    this.commit(theme, resources);
    this.current = theme;
    return true;
  }
}
