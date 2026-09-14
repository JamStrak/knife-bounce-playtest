import { playCombatCue } from "./combat-feedback.mjs";

export class UpgradeFeedback {
  constructor(root, sound) {
    this.root = root;
    this.sound = sound;
    this.reset();
  }
  reset() {
    this.active = false;
    this.ready = false;
    this.age = 0;
    this.soundPending = false;
  }
  start(config) {
    this.active = true;
    this.age = 0;
    this.soundPending = true;
    this.duration = config.upgradeFxOn ? config.upgradeIntroDuration : 0;
    this.update(0, config);
  }
  update(dt, config) {
    if (!this.active) return;
    if (dt > 0 && this.soundPending) {
      this.soundPending = false;
      this.sound(config);
    }
    this.age += dt;
    if (!config.upgradeFxOn) this.duration = 0;
    this.ready = this.age >= this.duration;
    const progress = this.duration ? Math.min(1, this.age / this.duration) : 1;
    this.root.dataset.upgradeStage = this.ready ? "choices" : "intro";
    this.root.style.setProperty("--upgrade-dim", String(config.upgradeDim));
    this.root.style.setProperty("--upgrade-progress", String(progress));
    this.root.style.setProperty(
      "--upgrade-scale",
      String(config.upgradeFxScale),
    );
    this.root.querySelector(".level-up-intro").hidden = this.ready;
    this.root.querySelector(".upgrade-options").hidden = !this.ready;
    for (const button of this.root.querySelectorAll(".choice"))
      button.disabled = !this.ready;
  }
}

export function playLevelUp(audio, config) {
  if (
    !audio ||
    audio.state !== "running" ||
    !config.sound ||
    !config.upgradeSoundOn ||
    !config.volume ||
    !config.upgradeSoundVolume
  )
    return false;
  return playCombatCue(audio, config, "levelUp", {
    gain: config.upgradeSoundVolume,
  });
}
