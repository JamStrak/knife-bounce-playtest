import { feedbackConfig } from "./feedback-schema.mjs";
import { audioAssetBuffer } from "./audio-assets.mjs";
const mixers = new WeakMap();
const rewardKinds = new Set([
  "levelUp",
  "stageStart",
  "bossEntry",
  "stageClear",
  "victory",
  "failure",
]);
// Dense volleys should remain readable; a successful parry is the accent.
const cueIntervals = {
  enemyShot: 0.1,
  guard: 0.08,
  guardBlock: 0.09,
  knifeBulletBlock: 0.09,
  perfectGuard: 0.18,
  bulletImpact: 0.12,
  reflectedHit: 0.08,
};
const tone = (
  frequency,
  end = frequency,
  duration = 0.14,
  delay = 0,
  gain = 1,
  wave = "sine",
) => ({ frequency, end, duration, delay, gain, wave });
export function cueRecipe(kind, detail = {}) {
  const rise =
    1 +
    Math.min(12, Math.max(0, (detail.shotKills || detail.kills || 1) - 1)) *
      0.035;
  const recipes = {
    launch: [
      "Attack",
      1,
      [
        tone(740, 210, 0.095, 0, 0.7, "triangle"),
        tone(1700, 700, 0.07, 0.012, 0.24),
      ],
    ],
    recallLaunch: ["Attack", 1, [tone(1250, 450, 0.075, 0, 0.5, "triangle")]],
    bounce: [
      "Impact",
      1,
      [
        tone(detail.surface === "enemy" ? 620 : 1480, 740, 0.09, 0, 0.65),
        tone(2280, 1300, 0.045, 0, 0.18),
      ],
    ],
    hit: [
      "Impact",
      1,
      [
        tone(900, 240, 0.065, 0, 0.6, "triangle"),
        tone(1950, 1200, 0.07, 0, 0.2),
      ],
    ],
    pin: [
      "Impact",
      1,
      [
        tone(230, 75, 0.12, 0, 0.75, "triangle"),
        tone(2300, 760, 0.075, 0.014, 0.2),
      ],
    ],
    kill: [
      "Kill",
      2,
      [
        tone(880 * rise, 760 * rise, 0.18, 0, 0.65),
        tone(1320 * rise, 1320 * rise, 0.16, 0.035, 0.35),
      ],
    ],
    combo: [
      "Kill",
      2,
      [
        tone(1046 * rise, 1046 * rise, 0.2, 0, 0.45),
        tone(1568 * rise, 1568 * rise, 0.24, 0.04, 0.25),
      ],
    ],
    explode: [
      "Skill",
      2,
      [
        tone(165, 42, 0.25, 0, 0.75, "triangle"),
        tone(1900, 460, 0.18, 0.015, 0.3),
      ],
    ],
    pickup: [
      "Skill",
      2,
      [tone(880, 880, 0.17, 0, 0.5), tone(1318, 1318, 0.2, 0.045, 0.38)],
    ],
    recall: [
      "Attack",
      2,
      [
        tone(280, 940, 0.26, 0, 0.55, "triangle"),
        tone(1568, 2093, 0.22, 0.1, 0.25),
      ],
    ],
    whirlwind: [
      "Skill",
      2,
      [
        tone(880, 180, 0.22, 0, 0.55, "triangle"),
        tone(2300, 600, 0.15, 0.01, 0.2),
      ],
    ],
    lightning: [
      "Skill",
      2,
      [
        tone(2800, 480, 0.12, 0, 0.3, "sawtooth"),
        tone(1320, 320, 0.16, 0.02, 0.45, "triangle"),
      ],
    ],
    ring: [
      "Skill",
      2,
      [tone(659, 1318, 0.19, 0, 0.4), tone(988, 1976, 0.17, 0.015, 0.3)],
    ],
    plant: ["Skill", 1, [tone(520, 1040, 0.1, 0, 0.35)]],
    leak: ["Impact", 2, [tone(196, 98, 0.25, 0, 0.55, "triangle")]],
    enemyShot: [
      "Attack",
      1,
      [
        tone(360, 140, 0.09, 0, 0.4, "triangle"),
        tone(920, 500, 0.045, 0, 0.14),
      ],
    ],
    guard: [
      "Skill",
      1,
      [tone(420, 840, 0.09, 0, 0.3), tone(1260, 1680, 0.07, 0.01, 0.15)],
    ],
    guardBlock: [
      "Impact",
      2,
      [tone(1280, 720, 0.08, 0, 0.4), tone(1920, 1440, 0.06, 0, 0.2)],
    ],
    knifeBulletBlock: [
      "Impact",
      2,
      [
        tone(1680, 900, 0.065, 0, 0.32, "triangle"),
        tone(2400, 1600, 0.04, 0, 0.16),
      ],
    ],
    perfectGuard: [
      "Skill",
      3,
      [
        tone(1174.66, 1174.66, 0.16, 0, 0.48),
        tone(1760, 1760, 0.18, 0.025, 0.3),
        tone(2349.32, 2349.32, 0.16, 0.05, 0.18),
      ],
    ],
    bulletImpact: [
      "Impact",
      2,
      [tone(140, 55, 0.15, 0, 0.5, "triangle"), tone(330, 95, 0.08, 0, 0.15)],
    ],
    reflectedHit: [
      "Impact",
      2,
      [tone(1568, 1046, 0.1, 0, 0.38), tone(2093, 1568, 0.085, 0.015, 0.17)],
    ],
    levelUp: [
      "Reward",
      3,
      [523.25, 659.25, 783.99, 1046.5].map((hz, i) =>
        tone(hz, hz, 0.3, i * 0.075, 0.6),
      ),
    ],
    stageStart: [
      "Reward",
      3,
      [392, 587.33, 783.99].map((hz, i) => tone(hz, hz, 0.28, i * 0.09, 0.55)),
    ],
    bossEntry: [
      "Reward",
      3,
      [196, 196, 146.83].map((hz, i) =>
        tone(hz, hz / 1.12, 0.32, i * 0.12, 0.6, "triangle"),
      ),
    ],
    stageClear: [
      "Reward",
      3,
      [523.25, 659.25, 783.99, 1046.5].map((hz, i) =>
        tone(hz, hz, 0.3, i * 0.09, 0.55),
      ),
    ],
    victory: [
      "Reward",
      3,
      [523.25, 659.25, 783.99, 1046.5, 1318.51].map((hz, i) =>
        tone(hz, hz, 0.36, i * 0.09, 0.55),
      ),
    ],
    failure: [
      "Reward",
      3,
      [392, 293.66, 196].map((hz, i) =>
        tone(hz, hz, 0.28, i * 0.1, 0.5, "triangle"),
      ),
    ],
  };
  const r = recipes[kind];
  return r
    ? {
        category: r[0],
        priority: r[1],
        notes: r[2],
        assetKey: kind === "knifeBulletBlock" ? "guardBlock" : kind,
      }
    : null;
}
export class CombatMixer {
  constructor(audio) {
    this.audio = audio;
    this.active = [];
    this.last = new Map();
    this.played = 0;
    this.suppressed = 0;
    this.peakVoices = 0;
    this.sequence = 0;
    this.bus = audio.createGain();
    this.bus.gain.setValueAtTime(0.85, audio.currentTime);
    if (audio.createDynamicsCompressor) {
      this.compressor = audio.createDynamicsCompressor();
      for (const [key, value] of Object.entries({
        threshold: -12,
        knee: 10,
        ratio: 5,
        attack: 0.003,
        release: 0.09,
      }))
        this.compressor[key].setValueAtTime(value, audio.currentTime);
      this.bus.connect(this.compressor);
      this.compressor.connect(audio.destination);
    } else this.bus.connect(audio.destination);
  }
  prune() {
    this.active = this.active.filter(
      (v) => v.end > this.audio.currentTime && !v.stopped,
    );
  }
  stop(voice) {
    voice.stopped = true;
    for (const { oscillator, gain } of voice.nodes) {
      try {
        oscillator.stop(this.audio.currentTime);
      } catch {}
      try {
        oscillator.disconnect();
        gain.disconnect();
      } catch {}
    }
  }
  reset() {
    for (const voice of this.active) this.stop(voice);
    this.active = [];
    this.last.clear();
  }
  sync(config) {
    const c = feedbackConfig(config);
    this.prune();
    if (!c.sound || !c.volume) {
      this.reset();
      return;
    }
    this.bus.gain.setValueAtTime(
      0.85 * Math.max(0, Math.min(1, c.volume)),
      this.audio.currentTime,
    );
    for (const voice of this.active)
      if (!c.combatSoundOn && !voice.reward) this.stop(voice);
    this.prune();
    const limit = Math.max(1, Math.floor(c.sfxVoiceLimit));
    while (this.active.length > limit) {
      const victim = this.active.reduce((a, b) =>
        a.priority <= b.priority ? a : b,
      );
      this.stop(victim);
      this.prune();
    }
  }
  play(kind, config, detail = {}) {
    const c = feedbackConfig(config),
      recipe = cueRecipe(kind, detail),
      reward = rewardKinds.has(kind);
    this.sync(c);
    if (
      !recipe ||
      !c.sound ||
      !c.volume ||
      (!reward && !c.combatSoundOn) ||
      this.audio.state !== "running"
    )
      return false;
    const volume =
      c["sfx" + recipe.category + "Volume"] *
      Math.max(0, Math.min(2, detail.gain ?? 1));
    if (!volume) return false;
    const at = this.audio.currentTime,
      interval = reward
        ? 0.15
        : Math.max(
            c.sfxMinInterval,
            kind === "combo" ? 0.15 : cueIntervals[kind] || 0,
          );
    if (at - (this.last.get(kind) ?? -Infinity) < interval) {
      this.suppressed++;
      return false;
    }
    this.prune();
    const limit = Math.max(1, Math.floor(c.sfxVoiceLimit));
    while (this.active.length >= limit) {
      const victim = this.active.find((v) => v.priority < recipe.priority);
      if (!victim) {
        this.suppressed++;
        return false;
      }
      this.stop(victim);
      this.prune();
    }
    const voice = {
      end: at,
      nodes: [],
      priority: recipe.priority,
      reward,
      stopped: false,
    };
    // Every cue uses the same capped bus. Batches become quieter as voices overlap.
    const level =
      Math.min(0.22, volume * 0.2) /
      Math.sqrt(Math.max(1, this.active.length + 1));
    const variation = reward
      ? 1
      : 1 + Math.sin(++this.sequence * 2.39996) * c.sfxPitchVariation;
    const replacement = audioAssetBuffer(recipe.assetKey);
    if (replacement) {
      const oscillator = this.audio.createBufferSource(),
        gain = this.audio.createGain();
      oscillator.buffer = replacement;
      oscillator.playbackRate.setValueAtTime(variation, at);
      gain.gain.setValueAtTime(level, at);
      oscillator.connect(gain);
      gain.connect(this.bus);
      voice.end = at + replacement.duration / variation;
      oscillator.onended = () => {
        voice.stopped = true;
        oscillator.disconnect();
        gain.disconnect();
      };
      voice.nodes.push({ oscillator, gain });
      oscillator.start(at);
    }
    for (const note of replacement ? [] : recipe.notes) {
      const oscillator = this.audio.createOscillator(),
        gain = this.audio.createGain(),
        start = at + note.delay,
        end = start + note.duration;
      oscillator.type = note.wave;
      oscillator.frequency.setValueAtTime(note.frequency * variation, start);
      oscillator.frequency.exponentialRampToValueAtTime?.(
        Math.max(30, note.end * variation),
        end,
      );
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(
        level * note.gain,
        start + Math.min(0.012, note.duration / 4),
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, end);
      oscillator.connect(gain);
      gain.connect(this.bus);
      oscillator.start(start);
      oscillator.stop(end + 0.012);
      oscillator.onended = () => {
        try {
          oscillator.disconnect();
          gain.disconnect();
        } catch {}
      };
      voice.nodes.push({ oscillator, gain });
      voice.end = Math.max(voice.end, end + 0.012);
    }
    this.active.push(voice);
    this.last.set(kind, at);
    this.played++;
    this.peakVoices = Math.max(this.peakVoices, this.active.length);
    return true;
  }
  batch(events, config) {
    this.sync(config);
    const latest = new Map();
    for (const event of events) {
      if (event.type === "naturalLevelUp") {
        if (config.upgradeSoundOn && config.upgradeSoundVolume > 0)
          latest.set("levelUp", {
            ...event,
            type: "levelUp",
            gain: config.upgradeSoundVolume,
          });
        continue;
      }
      // Stage presentation owns its own audio timing. Lethal hits use one kill cue.
      if (
        rewardKinds.has(event.type) ||
        (event.type === "hit" && event.lethal) ||
        (event.type === "combo" && event.kills < 3)
      )
        continue;
      latest.set(event.type, event);
    }
    if (latest.has("perfectGuard")) latest.delete("guardBlock");
    for (const e of [...latest.values()].sort(
      (a, b) =>
        (cueRecipe(b.type)?.priority || 0) - (cueRecipe(a.type)?.priority || 0),
    ))
      this.play(e.type, config, e);
  }
  get stats() {
    this.prune();
    return {
      active: this.active.length,
      peak: this.peakVoices,
      played: this.played,
      suppressed: this.suppressed,
    };
  }
}
export function combatMixer(audio) {
  if (!audio) return null;
  if (!mixers.has(audio)) mixers.set(audio, new CombatMixer(audio));
  return mixers.get(audio);
}
export function playCombatCue(audio, config, kind, detail) {
  if (!audio || audio.state !== "running") return false;
  return combatMixer(audio).play(kind, config, detail);
}
export function resetCombatAudio(audio) {
  if (audio && mixers.has(audio)) mixers.get(audio).reset();
}
