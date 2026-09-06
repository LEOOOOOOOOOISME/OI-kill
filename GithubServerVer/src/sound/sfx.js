'use strict';

/**
 * sfx.js — OI杀 v4 音效系统（P8a）
 * CommonJS、零依赖、Node 安全。全部音效由 Web Audio 实时合成，无音频文件。
 *
 * 集成约定：
 *  - play(kind, opts): opts.reducedMotion 为真时仅播放 essential 音效（error/turn/countdown）；
 *    opts.intensity (0..1) 用于 countdown 等（音高随强度升高）。
 *  - unlock(): 必须在首次用户手势（click/touch/keydown）里调用，用于创建/恢复 AudioContext。
 *  - Node / 无 AudioContext 环境：所有方法安全 no-op，不抛异常。
 */

// ---------------------------------------------------------------------------
// 纯数据：事件 -> 音效配方
// type: 'tone'(正弦振荡) | 'noise'(白噪声+低通) | 'seq'(音符序列)
// freqs: tone 的振荡频率 / noise 的滤波中心频率（可选）
// notes: seq 的音符频率序列；glideTo: tone 的滑音目标频率（可选）
// 约束: freqs/notes/glideTo ∈ [20,20000]Hz, dur ∈ [0.02,2]s, gain ∈ [0.01,1]
// ---------------------------------------------------------------------------
const sfxMap = {
  click:       { type: 'tone',  freqs: [1200],                    dur: 0.04, gain: 0.15 },
  select:      { type: 'tone',  freqs: [880],                     dur: 0.06, gain: 0.18 },
  attack:      { type: 'tone',  freqs: [220],  glideTo: 110,      dur: 0.15, gain: 0.35 },
  block:       { type: 'noise', freqs: [180],                     dur: 0.08, gain: 0.25 },
  heal:        { type: 'seq',   freqs: [],     notes: [523, 659, 784],            dur: 0.3,  gain: 0.22 },
  draw:        { type: 'tone',  freqs: [400],  glideTo: 900,      dur: 0.2,  gain: 0.15 },
  drop:        { type: 'tone',  freqs: [300],  glideTo: 150,      dur: 0.12, gain: 0.25 },
  fun:         { type: 'seq',   freqs: [],     notes: [392, 523, 659, 784],      dur: 0.4,  gain: 0.25 },
  dice:        { type: 'seq',   freqs: [],     notes: [700, 850, 950],           dur: 0.25, gain: 0.25 },
  death:       { type: 'tone',  freqs: [200],  glideTo: 60,       dur: 0.6,  gain: 0.35 },
  awake:       { type: 'seq',   freqs: [],     notes: [440, 660],                dur: 0.35, gain: 0.25 },
  judge:       { type: 'tone',  freqs: [980, 1244],               dur: 0.3,  gain: 0.25 },
  aoe:         { type: 'noise', freqs: [400],                     dur: 0.35, gain: 0.3 },
  counter:     { type: 'tone',  freqs: [600],  glideTo: 1200,     dur: 0.15, gain: 0.3 },
  victory:     { type: 'seq',   freqs: [],     notes: [523, 659, 784, 1046],     dur: 0.6,  gain: 0.3 },
  defeat:      { type: 'seq',   freqs: [],     notes: [392, 330, 262],           dur: 0.6,  gain: 0.3 },
  achievement: { type: 'seq',   freqs: [],     notes: [880, 1108, 1318],         dur: 0.45, gain: 0.25 },
  countdown:   { type: 'tone',  freqs: [520],                     dur: 0.15, gain: 0.3 },
  chat:        { type: 'tone',  freqs: [1000, 1250],              dur: 0.09, gain: 0.1 },
  turn:        { type: 'tone',  freqs: [700],  glideTo: 500,      dur: 0.12, gain: 0.25 },
  error:       { type: 'tone',  freqs: [220, 180],                dur: 0.18, gain: 0.3 },
  shield:      { type: 'tone',  freqs: [350],  glideTo: 700,      dur: 0.2,  gain: 0.25 },
  evo:         { type: 'seq',   freqs: [],     notes: [440, 660, 880, 1320],     dur: 0.5,  gain: 0.3 }
};

// reduced-motion 下仍然播放的 essential 音效（仅系统提示类）
const ESSENTIAL_KINDS = ['error', 'turn', 'countdown'];

/**
 * 纯函数：判定某事件在当前 reducedMotion 设置下是否应发声。
 * 便于在 Node 环境直接测试 reduced-motion 过滤逻辑。
 */
function shouldPlay(kind, reducedMotion) {
  if (!Object.prototype.hasOwnProperty.call(sfxMap, kind)) return false;
  if (reducedMotion && ESSENTIAL_KINDS.indexOf(kind) === -1) return false;
  return true;
}

/**
 * 创建音效实例。
 * AudioContext 惰性创建（仅在 play/unlock 内、try/catch 包裹）；
 * 无 window / 无 AudioContext 时所有方法安全 no-op。
 */
function createSfx() {
  let ctx = null;
  let master = null;
  let volume = 0.8;
  let muted = false;
  let unlocked = false;

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function hasAudioEnv() {
    return typeof window !== 'undefined' &&
      !!(window.AudioContext || window.webkitAudioContext);
  }

  function ensureCtx() {
    if (ctx) return true;
    if (!hasAudioEnv()) return false;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      return true;
    } catch (e) {
      ctx = null;
      master = null;
      return false;
    }
  }

  // tone: 每个频率一个正弦振荡器；glideTo 存在时滑音（当前配方均为单频）
  function playTone(recipe, freqScale, gainScale) {
    const t0 = ctx.currentTime;
    const dur = clamp(recipe.dur, 0.02, 2);
    const gain = clamp(recipe.gain, 0.01, 1) * gainScale;
    const freqs = (recipe.freqs || [])
      .map((f) => clamp(f, 20, 20000) * freqScale)
      .map((f) => clamp(f, 20, 20000));
    freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t0);
      const glide = typeof recipe.glideTo === 'number';
      if (glide && (freqs.length === 1 || i === freqs.length - 1)) {
        osc.frequency.exponentialRampToValueAtTime(
          clamp(recipe.glideTo * freqScale, 20, 20000), t0 + dur);
      }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(clamp(gain, 0.01, 1), t0 + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    });
  }

  // noise: 白噪声经低通滤波（freqs[0] 为截止频率，默认 2000Hz）
  function playNoise(recipe, gainScale) {
    const t0 = ctx.currentTime;
    const dur = clamp(recipe.dur, 0.02, 2);
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = clamp((recipe.freqs && recipe.freqs[0]) || 2000, 20, 20000);
    const g = ctx.createGain();
    const gain = clamp(recipe.gain, 0.01, 1) * gainScale;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(clamp(gain, 0.01, 1), t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t0);
  }

  // seq: 按 dur 均分依次播放 notes，每个音符带指数包络防爆音
  function playSeq(recipe, freqScale, gainScale) {
    const notes = recipe.notes || [];
    if (!notes.length) return;
    const total = clamp(recipe.dur, 0.02, 2);
    const per = total / notes.length;
    const t0 = ctx.currentTime;
    notes.forEach((n, i) => {
      const f = clamp(clamp(n, 20, 20000) * freqScale, 20, 20000);
      const t = t0 + i * per;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, t);
      const peak = clamp(recipe.gain, 0.01, 1) * gainScale;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(clamp(peak, 0.01, 1), t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + per);
      osc.connect(g);
      g.connect(master);
      osc.start(t);
      osc.stop(t + per + 0.02);
    });
  }

  /**
   * 播放音效。
   * @param {string} kind 事件名（sfxMap 键）
   * @param {{intensity?:number, reducedMotion?:boolean}} [opts]
   * @returns {boolean} 是否实际发声（Node/无 AudioContext/被过滤时返回 false）
   */
  function play(kind, opts) {
    const o = opts || {};
    if (muted) return false;
    if (!shouldPlay(kind, !!o.reducedMotion)) return false;
    if (!ensureCtx()) return false;
    const recipe = sfxMap[kind];
    try {
      const intensity = clamp(typeof o.intensity === 'number' ? o.intensity : 0, 0, 1);
      const freqScale = 1 + intensity * 0.75; // countdown: 强度越高音调越高
      const gainScale = 1 + intensity * 0.3;
      if (recipe.type === 'tone') playTone(recipe, freqScale, gainScale);
      else if (recipe.type === 'noise') playNoise(recipe, gainScale);
      else if (recipe.type === 'seq') playSeq(recipe, freqScale, gainScale);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 设置主音量 0..1（返回钳制后的值） */
  function setVolume(v) {
    volume = clamp(typeof v === 'number' ? v : volume, 0, 1);
    if (ctx && master) {
      try { master.gain.value = volume; } catch (e) { /* no-op */ }
    }
    return volume;
  }

  /** 静音开关 */
  function setMuted(b) {
    muted = !!b;
    return muted;
  }

  /**
   * 解锁音频：必须在首次用户手势（click/touch/keydown）中调用。
   * 创建（如未创建）并 resume AudioContext。
   * @returns {boolean} 是否解锁成功（Node 环境返回 false）
   */
  function unlock() {
    if (!hasAudioEnv()) return false;
    try {
      if (!ensureCtx()) return false;
      if (ctx.state === 'suspended') ctx.resume();
      unlocked = true;
      return true;
    } catch (e) {
      return false;
    }
  }

  /** 当前状态快照 */
  function getState() {
    return {
      volume,
      muted,
      unlocked,
      audioContextReady: !!ctx,
      nodeEnvironment: !hasAudioEnv()
    };
  }

  return { play, setVolume, setMuted, unlock, getState };
}

module.exports = { sfxMap, ESSENTIAL_KINDS, shouldPlay, createSfx };
