import {
  createReleasePackage,
  validateReleasePackage,
} from "./release-package.mjs";
import {
  snapshotAudioAssets,
  audioAssetNames,
  loadAudioLibrary,
} from "./audio-assets.mjs";
import { bundledRelease } from "./bundled-release.mjs";

export const APP_VERSION = "0.53.2";
function download(name, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export function setupReleaseLab({ getConfig, getGame, snapshotTheme, onOpen }) {
  const root = document.createElement("dialog");
  root.id = "releaseLab";
  root.setAttribute("aria-labelledby", "releaseTitle");
  root.innerHTML = `<div class="dialog-head"><div><small>PLAYTEST RELEASE</small><h2 id="releaseTitle">内测发布包</h2></div><button id="closeReleaseLab">关闭</button></div>
    <p>完整收集当前已应用的参数、主题图片、替换音效与背景音乐。未替换的声音继续使用游戏内置效果。</p>
    <label>内测批次<input id="releaseId" maxlength="48" aria-label="内测批次" /></label>
    <p id="releaseSummary" role="status"></p>
    <button id="exportRelease" class="accent">导出完整发布包</button>
    <p>包含尚未点击保存、但已应用到游戏的调整；不包含对局进度、个人预设列表。导出不覆盖本地存档，也不会自动上传。</p>
    <details><summary>检查已有发布包</summary><label class="file-button">选择发布包<input id="verifyRelease" type="file" accept=".json,application/json" hidden /></label><p>验证版本、资源清单与 SHA-256 完整性；不会改变当前游戏。</p></details>
    <button id="exportFeedback">下载反馈模板</button><p id="releaseStatus" role="status">发布时把完整包交给开发者，同一批内测固定同一个包。</p>`;
  document.body.append(root);
  const style = document.createElement("link");
  style.rel = "stylesheet";
  style.href = "release-lab.css";
  document.head.append(style);
  const entry = document.createElement("button");
  entry.id = "openReleaseLab";
  entry.className = "balance-entry";
  entry.textContent = "内测发布与反馈 ↗ · 完整素材打包";
  document.getElementById("openAudioLab").after(entry);
  const $ = (id) => root.querySelector(`#${id}`);
  $("releaseId").value = `playtest-${new Date().toISOString().slice(0, 10)}-01`;
  let busy = false;
  async function run(action) {
    if (busy) return;
    busy = true;
    for (const e of root.querySelectorAll("button,input")) e.disabled = true;
    try {
      await action();
    } catch (error) {
      $("releaseStatus").textContent = `未完成：${error.message}`;
    } finally {
      busy = false;
      for (const e of root.querySelectorAll("button,input")) e.disabled = false;
    }
  }
  entry.onclick = () => {
    onOpen();
    root.showModal();
    run(async () => {
      await loadAudioLibrary();
      const names = audioAssetNames();
      $("releaseSummary").textContent =
        `v${APP_VERSION} · 飞刀射速 ${getConfig().speed} · 替换音效 ${Object.keys(names).filter((k) => k !== "music").length} 项 · 背景音乐：${names.music || "未设置"}`;
    });
  };
  $("closeReleaseLab").onclick = () => root.close();
  root.addEventListener("cancel", (event) => {
    if (busy) event.preventDefault();
  });
  $("exportRelease").onclick = () =>
    run(async () => {
      $("releaseStatus").textContent =
        "正在收集图片与真实音频文件，生成完整性校验…";
      const config = structuredClone(getConfig());
      const [theme, audio] = await Promise.all([
        snapshotTheme(),
        snapshotAudioAssets(),
      ]);
      const bundle = await createReleasePackage({
        id: $("releaseId").value.trim(),
        version: APP_VERSION,
        config,
        theme,
        audio,
      });
      const json = JSON.stringify(bundle);
      download(`飞刀弹弹乐-完整发布包-${bundle.release.id}.json`, json);
      $("releaseStatus").textContent =
        `已导出 ${bundle.release.id} · 射速 ${config.speed} · ${Object.values(theme.slots).filter((s) => s.src).length} 张图片 · ${audio.filter((s) => s.key !== "music").length} 项替换音效 · 背景音乐${audio.some((s) => s.key === "music") ? "已包含" : "未设置"} · ${(new Blob([json]).size / 1024 / 1024).toFixed(1)} MB。`;
    });
  $("verifyRelease").onchange = () =>
    run(async () => {
      const file = $("verifyRelease").files[0];
      $("verifyRelease").value = "";
      if (!file) return;
      if (file.size > 200 * 1024 * 1024) throw new Error("发布包超过 200 MB");
      const b = await validateReleasePackage(JSON.parse(await file.text()));
      $("releaseStatus").textContent =
        `校验通过：${b.release.id} · v${b.release.version} · 射速 ${b.config.speed} · 主题 ${b.theme.name} · 音频 ${b.audio.length} 项 · SHA-256 ${b.integrity.sha256.slice(0, 12)}`;
    });
  $("exportFeedback").onclick = () => {
    const g = getGame();
    const report = `飞刀弹弹乐内测反馈\n版本：${bundledRelease?.release.version || APP_VERSION}\n发布批次：${bundledRelease?.release.id || "本地开发预览"}\n设备与浏览器：${navigator.userAgent}\n关卡/回合：${g.stage?.index ?? "-"} / ${g.round}\n射速：${getConfig().speed}\n\n问题类型：错误 / 手感 / 平衡 / 建议\n现象：\n复现步骤：\n预期表现：\n截图或录像：\n最爽的时刻：\n卡住或想退出的时刻：\n`;
    download(
      `飞刀反馈-${bundledRelease?.release.id || APP_VERSION}.txt`,
      report,
      "text/plain;charset=utf-8",
    );
  };
  return {
    get isOpen() {
      return root.open;
    },
  };
}
