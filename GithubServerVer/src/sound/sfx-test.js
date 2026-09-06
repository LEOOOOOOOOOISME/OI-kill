'use strict';

/**
 * sfx-test.js — OI杀 v4 音效系统自检（P8a）
 * 运行: node src\sound\sfx-test.js
 * 通过则退出码 0；任一断言失败退出码 1 并列出失败项。
 */

const S = require('./sfx.js');

let passed = 0;
let failed = 0;
const fails = [];

function check(name, cond) {
  if (cond) passed++;
  else {
    failed++;
    fails.push(name);
  }
}

function inBounds(v, lo, hi) {
  return typeof v === 'number' && isFinite(v) && v >= lo && v <= hi;
}

function allInBounds(arr, lo, hi) {
  return Array.isArray(arr) && arr.every((v) => inBounds(v, lo, hi));
}

const REQUIRED = [
  'click', 'select', 'attack', 'block', 'heal', 'draw', 'drop', 'fun', 'dice',
  'death', 'awake', 'judge', 'aoe', 'counter', 'victory', 'defeat',
  'achievement', 'countdown', 'chat', 'turn', 'error', 'shield', 'evo'
];
const TYPES = ['tone', 'noise', 'seq'];

// ---- 1. sfxMap 覆盖 ----
check('sfxMap 是对象', typeof S.sfxMap === 'object' && S.sfxMap !== null);
REQUIRED.forEach((k) => {
  check(`sfxMap 覆盖事件 "${k}"`, Object.prototype.hasOwnProperty.call(S.sfxMap, k));
});

// ---- 2. 配方参数边界 ----
REQUIRED.forEach((k) => {
  const r = S.sfxMap[k];
  check(`${k}: type 合法`, TYPES.indexOf(r.type) !== -1);
  check(`${k}: dur ∈ [0.02,2]`, inBounds(r.dur, 0.02, 2));
  check(`${k}: gain ∈ [0.01,1]`, inBounds(r.gain, 0.01, 1));
  check(`${k}: freqs 是数组`, Array.isArray(r.freqs));
  check(`${k}: freqs ∈ [20,20000]`, allInBounds(r.freqs, 20, 20000));
  check(`${k}: glideTo 合法或缺失`,
    r.glideTo === undefined || inBounds(r.glideTo, 20, 20000));
  if (r.type === 'tone') {
    check(`${k}(tone): freqs 非空`, r.freqs.length > 0);
  }
  if (r.type === 'seq') {
    check(`${k}(seq): notes 非空数组`, Array.isArray(r.notes) && r.notes.length > 0);
    check(`${k}(seq): notes ∈ [20,20000]`, allInBounds(r.notes, 20, 20000));
  }
});

// ---- 3. API 形状 ----
check('createSfx 是函数', typeof S.createSfx === 'function');
const inst = S.createSfx();
check('实例是对象', typeof inst === 'object' && inst !== null);
['play', 'setVolume', 'setMuted', 'unlock', 'getState'].forEach((m) => {
  check(`实例方法 ${m} 存在`, typeof inst[m] === 'function');
});
check('ESSENTIAL_KINDS 为 error/turn/countdown',
  Array.isArray(S.ESSENTIAL_KINDS) &&
  JSON.stringify(S.ESSENTIAL_KINDS) === JSON.stringify(['error', 'turn', 'countdown']));

// ---- 4. Node 环境安全 no-op ----
REQUIRED.forEach((k) => {
  let ret = null;
  let threw = false;
  try { ret = inst.play(k); } catch (e) { threw = true; }
  check(`node 下 play("${k}") 无异常且返回 false`, !threw && ret === false);
});
check('play(未知事件) 返回 false', inst.play('nope') === false);
check('play("countdown", {intensity:0.9}) 无异常',
  (() => { try { inst.play('countdown', { intensity: 0.9 }); return true; } catch (e) { return false; } })());
check('play("error", {reducedMotion:true}) 无异常',
  (() => { try { inst.play('error', { reducedMotion: true }); return true; } catch (e) { return false; } })());

// ---- 5. reduced-motion 过滤逻辑（纯函数 shouldPlay） ----
REQUIRED.forEach((k) => {
  check(`shouldPlay("${k}", false) === true`, S.shouldPlay(k, false) === true);
});
REQUIRED.forEach((k) => {
  const isEssential = S.ESSENTIAL_KINDS.indexOf(k) !== -1;
  check(`shouldPlay("${k}", true) === ${isEssential}`, S.shouldPlay(k, true) === isEssential);
});
check('shouldPlay(未知事件, false) === false', S.shouldPlay('nope', false) === false);

// ---- 6. setVolume / setMuted / getState / unlock ----
check('setVolume(0.5) 返回 0.5', inst.setVolume(0.5) === 0.5);
check('setVolume(1.7) 钳制为 1', inst.setVolume(1.7) === 1);
check('setVolume(-3) 钳制为 0', inst.setVolume(-3) === 0);
inst.setVolume(0.5);
check('setMuted(true) 返回 true', inst.setMuted(true) === true);
check('静音后 play("error") 返回 false', inst.play('error') === false);
check('setMuted(false) 返回 false', inst.setMuted(false) === false);

const st = inst.getState();
check('getState 返回对象', typeof st === 'object' && st !== null);
check('state.volume === 0.5', st.volume === 0.5);
check('state.muted === false', st.muted === false);
check('state.unlocked === false', st.unlocked === false);
check('state.audioContextReady === false (node)', st.audioContextReady === false);
check('state.nodeEnvironment === true', st.nodeEnvironment === true);

let unlockThrew = false;
let unlockRet = null;
try { unlockRet = inst.unlock(); } catch (e) { unlockThrew = true; }
check('node 下 unlock() 无异常且返回 false', !unlockThrew && unlockRet === false);

// ---- 汇总 ----
const total = passed + failed;
console.log(`=== 汇总: S通过=${passed}/${total} | 断言失败=${failed} ===`);
if (failed > 0) {
  console.log('失败断言:');
  fails.forEach((f) => console.log('  - ' + f));
} else {
  console.log('全部通过 ✓ (node 安全 no-op 模式)');
}
process.exitCode = failed > 0 ? 1 : 0;
