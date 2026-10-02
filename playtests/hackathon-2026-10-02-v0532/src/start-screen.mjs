import { onLocaleChange, t } from "./i18n.mjs";

// The HTML cover is present before the game module or theme assets are loaded.
// Keep its gate separate from pause and stage transitions: it is dismissed once
// by an explicit user gesture, which also unlocks browser audio.
export function setupStartScreen({ onStart = () => {} } = {}) {
  const screen = document.getElementById("startScreen"),
    button = document.getElementById("startGame"),
    status = document.getElementById("startStatus"),
    retry = document.getElementById("retryStartup"),
    workspace = document.querySelector(".workspace");
  let ready = false,
    started = false,
    starting = false,
    message = "正在准备战场…";
  const setMessage = (source) => {
    message = source;
    // The static language pass and the startup state share the same source key.
    status.dataset.i18n = source;
    status.textContent = t(source);
  };
  onLocaleChange(() => setMessage(message));
  const fail = () => {
    if (started) return;
    clearTimeout(window.knifeStartupTimer);
    ready = false;
    starting = false;
    button.disabled = true;
    screen.setAttribute("aria-busy", "false");
    setMessage("加载未完成，请检查网络后重新加载。");
    retry.hidden = false;
  };
  button.addEventListener("click", async () => {
    if (!ready || started || starting) return;
    starting = true;
    button.disabled = true;
    try {
      // Invoke synchronously in the click handler so audio unlock has activation.
      await onStart();
      started = true;
      workspace.inert = false;
      document.documentElement.dataset.gameStarted = "true";
      screen.hidden = true;
      document.getElementById("arena").focus({ preventScroll: true });
    } catch (error) {
      console.error("进入游戏失败", error);
      fail();
    }
  });
  return {
    get isBlocking() {
      return !started;
    },
    setReady() {
      if (started || starting) return;
      clearTimeout(window.knifeStartupTimer);
      ready = true;
      screen.setAttribute("aria-busy", "false");
      setMessage("准备就绪");
      retry.hidden = true;
      button.disabled = false;
    },
    fail,
  };
}
