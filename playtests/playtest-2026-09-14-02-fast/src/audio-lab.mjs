import { schema } from "./config.mjs";
import {
  audioSlots,
  audioAssetNames,
  loadAudioLibrary,
  setAudioAsset,
  removeAudioAsset,
  syncMusic,
  stopMusic,
} from "./audio-assets.mjs";
import { playCombatCue, resetCombatAudio } from "./combat-audio.mjs";
export const audioKeys = new Set([
  "sound",
  "volume",
  "musicOn",
  "musicVolume",
  "combatSoundOn",
  "upgradeSoundOn",
  "upgradeSoundVolume",
  "stageSoundOn",
  "stageSoundVolume",
  ...Object.keys(schema).filter((k) => k.startsWith("sfx")),
]);
export function setupAudioLab({ getConfig, apply, getAudio, onOpen, onClose }) {
  const root = document.createElement("dialog");
  root.id = "audioLab";
  root.className = "audio-lab";
  root.innerHTML = `<header><div><small>AUDIO LAB</small><h2>音乐与音效工作台</h2><p>音量即时生效；替换文件自动保存在本机浏览器。</p></div><button id="closeAudioLab">关闭</button></header><div class="audio-body"><section><h3>音量与播放规则</h3><div id="audioFields"></div></section><section><h3>音频素材</h3><label>选择声音<select id="audioSlot"></select></label><p id="audioAssetName"></p><div class="audio-actions"><button id="audioAudition">试听</button><button id="audioStop">停止试听</button><label class="audio-file">替换文件<input id="audioFile" type="file" accept="audio/*,.wav,.mp3,.ogg,.m4a,.webm" /></label><button id="audioRemove">恢复默认声音</button></div><p>未替换的音效使用发布包内声音或原合成声音；无背景音乐素材时保持静默。音乐随游戏暂停，试听可在本面板单独播放。音频参数 JSON 只含数值；分享已替换的音频请导出完整发布包。</p></section></div><footer><span id="audioStatus" role="status"></span><button id="audioExportFull">完整发布包（含音频）</button><button id="audioExport">导出音频参数</button><label class="audio-file">导入参数<input id="audioImport" type="file" accept=".json" /></label><button id="audioSave">保存音频参数</button></footer>`;
  document.body.append(root);
  const $ = (id) => root.querySelector("#" + id);
  const status = (t) => ($("audioStatus").textContent = t);
  let musicPreview = false;
  const slot = $("audioSlot");
  for (const { key, name: label } of audioSlots) {
    const o = document.createElement("option");
    o.value = key;
    o.textContent =
      typeof label === "string" ? label : label.label || label.name || key;
    slot.append(o);
  }
  const refresh = () => {
    const names = audioAssetNames();
    $("audioAssetName").textContent =
      names[slot.value] ||
      (slot.value === "music" ? "尚未导入背景音乐" : "使用内置合成音效");
    $("audioRemove").textContent =
      slot.value === "music" ? "移除背景音乐" : "恢复默认声音";
  };
  function stop() {
    musicPreview = false;
    stopMusic(getAudio());
    resetCombatAudio(getAudio());
  }
  slot.onchange = () => {
    stop();
    refresh();
  };
  function fields() {
    const list = $("audioFields");
    list.replaceChildren();
    let group = "";
    for (const key of audioKeys) {
      const s = schema[key];
      if (!s) continue;
      if (group !== s.group) {
        group = s.group;
        const h = document.createElement("h4");
        h.textContent = group;
        list.append(h);
      }
      const label = document.createElement("label");
      label.textContent = s.label;
      const input = document.createElement("input");
      input.dataset.audioKey = key;
      input.type = s.type === "boolean" ? "checkbox" : "number";
      if (input.type === "checkbox") input.checked = getConfig()[key];
      else {
        input.min = s.min;
        input.max = s.max;
        input.step = s.step;
        input.value = getConfig()[key];
      }
      input.onchange = () => {
        try {
          const value =
            input.type === "checkbox" ? input.checked : Number(input.value);
          if (
            input.type !== "checkbox" &&
            (!Number.isFinite(value) || value < s.min || value > s.max)
          )
            throw Error("请输入允许范围内的数值");
          apply({ [key]: value }, false);
          status("已临时应用，点击保存音频参数保留");
        } catch (e) {
          status(e.message);
          fields();
        }
      };
      label.append(input);
      list.append(label);
    }
  }
  $("audioAudition").onclick = async () => {
    const ctx = getAudio(true),
      c = getConfig();
    await ctx?.resume();
    if (slot.value === "music") {
      musicPreview = true;
      syncMusic(ctx, c, true);
      status("音乐试听中；总开关、音乐开关与音量仍生效");
    } else {
      if (
        (slot.value === "levelUp" && !c.upgradeSoundOn) ||
        ([
          "stageStart",
          "bossEntry",
          "stageClear",
          "victory",
          "failure",
        ].includes(slot.value) &&
          !c.stageSoundOn)
      ) {
        status("对应提示音开关已关闭");
        return;
      }
      playCombatCue(ctx, c, slot.value, {
        gain:
          slot.value === "levelUp"
            ? c.upgradeSoundVolume
            : [
                  "stageStart",
                  "bossEntry",
                  "stageClear",
                  "victory",
                  "failure",
                ].includes(slot.value)
              ? c.stageSoundVolume
              : 1,
      });
      status("已试听；关闭对应声音开关时保持静音");
    }
  };
  $("audioStop").onclick = stop;
  $("audioFile").onchange = async () => {
    const file = $("audioFile").files[0],
      key = slot.value;
    if (!file) return;
    try {
      await setAudioAsset(key, file);
      status("音频文件已验证并保存");
      refresh();
    } catch (e) {
      status("替换失败：" + e.message);
    } finally {
      $("audioFile").value = "";
    }
  };
  $("audioRemove").onclick = async () => {
    try {
      await removeAudioAsset(slot.value);
      stop();
      refresh();
      status("已恢复默认");
    } catch (e) {
      status(e.message);
    }
  };
  $("audioSave").onclick = () => {
    try {
      apply(
        Object.fromEntries([...audioKeys].map((k) => [k, getConfig()[k]])),
        true,
      );
      status("音频参数已保存；其他参数保留");
    } catch (e) {
      status("保存失败：" + e.message);
    }
  };
  $("audioExportFull").onclick = () => {
    root.close();
    document.getElementById("openReleaseLab").click();
  };
  $("audioExport").onclick = () => {
    const url = URL.createObjectURL(
      new Blob(
        [
          JSON.stringify(
            {
              schemaVersion: 1,
              audio: Object.fromEntries(
                [...audioKeys].map((k) => [k, getConfig()[k]]),
              ),
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "飞刀音频参数.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  $("audioImport").onchange = async () => {
    try {
      const d = JSON.parse(await $("audioImport").files[0].text());
      if (
        d.schemaVersion !== 1 ||
        !d.audio ||
        Object.keys(d.audio).some((k) => !audioKeys.has(k))
      )
        throw Error("不是有效的音频参数文件");
      for (const [k, v] of Object.entries(d.audio)) {
        const s = schema[k];
        if (
          s.type === "boolean"
            ? typeof v !== "boolean"
            : !Number.isFinite(v) || v < s.min || v > s.max
        )
          throw Error("无效参数：" + k);
      }
      apply(d.audio, false);
      fields();
      status("已导入预览，请保存");
    } catch (e) {
      status(e.message);
    } finally {
      $("audioImport").value = "";
    }
  };
  $("closeAudioLab").onclick = () => root.close();
  root.addEventListener("close", () => {
    stop();
    onClose();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
  });
  loadAudioLibrary()
    .then(refresh)
    .catch((e) => status("音频库读取失败：" + e.message));
  return {
    get isOpen() {
      return root.open;
    },
    open() {
      stop();
      onOpen();
      fields();
      refresh();
      root.showModal();
    },
    update() {
      if (root.open && musicPreview)
        syncMusic(getAudio(), getConfig(), !document.hidden);
    },
  };
}
