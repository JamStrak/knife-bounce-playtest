const n = (group, label, value, min, max, step = 0.05) => ({
  group,
  label,
  value,
  min,
  max,
  step,
  when: "立即",
});
const b = (group, label, value = true) => ({
  group,
  label,
  value,
  type: "boolean",
  when: "立即",
});
export const feedbackSchema = {
  combatFxOn: b("战斗反馈", "启用晶刃战斗特效"),
  combatFxIntensity: n("战斗反馈", "战斗反馈整体强度", 1, 0, 2),
  combatFxScale: n("战斗反馈", "火花与斩痕视觉大小", 1, 0.25, 2.5),
  combatFxGlow: n("战斗反馈", "晶光辉光强度", 0.7, 0, 2),
  combatFxParticles: b("战斗反馈", "启用碎晶与火花粒子"),
  combatFxBudget: n("战斗反馈", "同时存活粒子上限", 220, 0, 800, 10),
  combatFxBurstLimit: n("战斗反馈", "每帧粒子爆发事件上限", 16, 1, 80, 1),
  combatFxSlashes: b("战斗反馈", "启用刀向斩痕"),
  combatFxRings: b("战斗反馈", "启用冲击光环"),
  combatFxNumbers: b("战斗反馈", "启用伤害与得分飘字"),
  combatFxCombo: b("战斗反馈", "启用连续击杀递进反馈"),
  combatFxNumberCap: n("战斗反馈", "同时飘字上限", 18, 0, 60, 1),
  combatSoundOn: b("战斗音效", "启用晶刃战斗音效"),
  sfxAttackVolume: n("战斗音效", "发射与归心拔刀音量比例", 0.8, 0, 2),
  sfxImpactVolume: n("战斗音效", "碰撞反弹扎入音量比例", 0.75, 0, 2),
  sfxKillVolume: n("战斗音效", "击杀与连击音量比例", 1, 0, 2),
  sfxSkillVolume: n("战斗音效", "技能与道具音量比例", 0.9, 0, 2),
  sfxRewardVolume: n("战斗音效", "升级与关卡提示音量比例", 0.9, 0, 2),
  sfxVoiceLimit: n("战斗音效", "音效同时播放上限", 8, 1, 24, 1),
  sfxMinInterval: n("战斗音效", "同类音效最小间隔秒", 0.045, 0.01, 0.3, 0.005),
  sfxPitchVariation: n("战斗音效", "音高轻微变化幅度", 0.035, 0, 0.2, 0.005),
};
export const feedbackDefaults = Object.fromEntries(
  Object.entries(feedbackSchema).map(([key, s]) => [key, s.value]),
);
export const feedbackConfig = (config) => ({ ...feedbackDefaults, ...config });
