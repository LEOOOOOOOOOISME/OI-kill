'use strict';
// fx-test.js — fx.js 的 node 环境自测（零依赖、确定性、桩 DOM）。
const F = require('./fx.js');

// SPEC 正文写“21 个事件”，但其列举实际为 22 个；以列举为准全部覆盖。
const KINDS = [
  'playCard', 'attack', 'damage', 'heal', 'equip', 'deploy', 'unitAttack',
  'guardBlock', 'evolve', 'awaken', 'judge', 'aoe', 'wa', 'counter', 'death',
  'victory', 'defeat', 'achievement', 'countdown', 'turn', 'chat', 'reject',
];

let passed = 0;
let failed = 0;
const failures = [];

function ok(cond, name) {
  if (cond) { passed += 1; } else { failed += 1; failures.push(name); }
}

function noThrow(fn, name) {
  try { fn(); ok(true, name); } catch (err) { ok(false, name + ' [异常: ' + err.message + ']'); }
}

// 极简桩 DOM：纯内存、无定时器、无随机数，保证测试确定性。
function makeStubDom() {
  function makeEl(tag) {
    const el = {
      tagName: tag || 'div',
      _classes: Object.create(null),
      style: {},
      children: [],
      textContent: '',
      classList: {
        add: function () {
          for (let i = 0; i < arguments.length; i += 1) el._classes[arguments[i]] = true;
        },
        remove: function () {
          for (let i = 0; i < arguments.length; i += 1) delete el._classes[arguments[i]];
        },
        contains: function (c) { return !!el._classes[c]; },
      },
      appendChild: function (child) { el.children.push(child); return child; },
    };
    // 与真实 DOM 对齐：className 与 classList 双向同步
    Object.defineProperty(el, 'className', {
      get: function () { return Object.keys(el._classes).join(' '); },
      set: function (v) {
        el._classes = Object.create(null);
        String(v).split(/\s+/).forEach(function (c) { if (c) el._classes[c] = true; });
      },
    });
    return el;
  }
  const doc = { createElement: makeEl, body: makeEl('body') };
  return doc;
}

function classesOf(el) { return Object.keys(el._classes).sort().join(','); }

function snapshot(doc, seat) {
  return {
    bodyClasses: classesOf(doc.body),
    bodyChildren: doc.body.children.length,
    childClasses: doc.body.children.map(classesOf).join('|'),
    seatClasses: classesOf(seat),
    seatChildren: seat.children.length,
  };
}

// ---- 1. fxMap 覆盖 ----
ok(!!(F && typeof F.fxMap === 'object' && F.fxMap), 'fxMap 存在且非空');
KINDS.forEach(function (k) {
  const e = F.fxMap[k];
  ok(!!(e && typeof e.cssClass === 'string' && e.cssClass.length > 0
    && typeof e.floatText === 'string' && e.floatText.length > 0
    && typeof e.durationMs === 'number' && isFinite(e.durationMs) && e.durationMs > 0
    && typeof e.desc === 'string' && e.desc.length > 0), 'fxMap[' + k + '] 条目完整');
});
ok(Object.keys(F.fxMap).sort().join(',') === KINDS.slice().sort().join(','),
  'fxMap 键集合与列举严格一致');

// ---- 2. needsCss ----
ok(Array.isArray(F.needsCss) && F.needsCss.length > 0, 'needsCss 为非空数组');
noThrow(function () {
  if (new Set(F.needsCss).size !== F.needsCss.length) throw new Error('needsCss 存在重复');
  F.needsCss.forEach(function (c) { if (typeof c !== 'string' || !c) throw new Error('needsCss 含非法类名'); });
  Object.keys(F.fxMap).forEach(function (k) {
    if (F.needsCss.indexOf(F.fxMap[k].cssClass) < 0) {
      throw new Error('needsCss 缺少 ' + k + ' -> ' + F.fxMap[k].cssClass);
    }
  });
}, 'needsCss 去重合法且覆盖全部事件主类');

// ---- 3. createFx({}) 无 DOM 安全 no-op ----
const bare = F.createFx({});
ok(!!(bare && ['spawnParticle', 'floatText', 'shake', 'flashSeat', 'flyCard', 'judgeFlip', 'wave', 'banner', 'play']
  .every(function (m) { return typeof bare[m] === 'function'; })), 'createFx({}) 返回全部 9 个方法');
noThrow(function () {
  KINDS.forEach(function (k) { bare.play(k, {}); });
  bare.spawnParticle(1, 2);
  bare.floatText(null, 'x', 'dmg');
  bare.shake(null, 5);
  bare.flashSeat(null, 'red');
  bare.flyCard({ x: 0, y: 0 }, { x: 1, y: 1 }, 300);
  bare.judgeFlip(null, function () {});
  bare.wave(null);
  bare.banner('x');
}, '无 DOM 时全部方法调用不抛异常');
ok(bare.spawnParticle(1, 2) === null && bare.floatText(null, 'x') === null
  && bare.flyCard({ x: 0, y: 0 }, { x: 1, y: 1 }) === null
  && bare.shake(null, 3) === false && bare.banner('x') === null, '无 DOM 时返回 null/false 占位');

// ---- 4. 桩 DOM 下 play 覆盖全部事件 ----
const doc = makeStubDom();
const fx = F.createFx(doc);
const seat = doc.createElement('seat');
const card = doc.createElement('card');
const hpBar = doc.createElement('bar');
noThrow(function () {
  KINDS.forEach(function (k) {
    const ret = fx.play(k, {
      el: seat, target: seat, seat: seat, card: card, hpBar: hpBar, slot: seat,
      from: { x: 0, y: 0 }, to: { x: 120, y: 80 }, x: 10, y: 20,
      dmg: 3, amount: 1, power: 6, text: '测试', onDone: function () {},
    });
    if (!ret) throw new Error('play(' + k + ') 未返回真值');
  });
}, '桩 DOM 下 play 覆盖 22 个事件均不抛异常');

// ---- 5. 桩 DOM 下基础方法行为 ----
noThrow(function () {
  const f1 = fx.floatText(seat, '+1', 'heal');
  if (!f1 || f1._classes['fx-dmg-float'] !== true) throw new Error('floatText 元素类名缺失');
  const f2 = fx.flyCard({ x: 1, y: 2 }, { x: 3, y: 4 }, 500);
  if (!f2 || f2._classes['fx-flying'] !== true) throw new Error('flyCard 元素类名缺失');
  if (f2.style.transitionDuration !== '500ms') throw new Error('flyCard 未写入过渡时长');
  if (fx.shake(seat, 7) !== true || !seat.classList.contains('fx-shake')) throw new Error('shake 未生效');
  let flipped = false;
  if (fx.judgeFlip(card, function () { flipped = true; }) !== true || !flipped) throw new Error('judgeFlip 未执行/未回调');
  if (!card.classList.contains('fx-judge-flip')) throw new Error('judgeFlip 类未添加');
  if (fx.wave(null) !== true || !doc.body.classList.contains('fx-wave')) throw new Error('wave 未落到 body');
  const p = fx.spawnParticle(5, 6, { className: 'x', durationMs: 300 });
  if (!p || p._classes['fx-particle'] !== true || p.style.animationDuration !== '300ms') throw new Error('spawnParticle 行为不符');
  const b = fx.banner('觉醒');
  if (!b || b._classes['fx-banner'] !== true || b.textContent !== '觉醒') throw new Error('banner 行为不符');
  if (fx.flashSeat(seat, 'green') !== true || !seat.classList.contains('fx-seat-flash-green')) throw new Error('flashSeat 未生效');
}, '桩 DOM 下基础方法行为正确');

// ---- 6. 确定性：相同输入两次运行快照一致 ----
noThrow(function () {
  const run = function () {
    const d2 = makeStubDom();
    const f2 = F.createFx(d2);
    const s2 = d2.createElement('seat');
    KINDS.forEach(function (k) {
      f2.play(k, {
        el: s2, target: s2, seat: s2, slot: s2,
        card: d2.createElement('card'), hpBar: d2.createElement('bar'),
        from: { x: 0, y: 0 }, to: { x: 9, y: 9 }, x: 1, y: 2,
        dmg: 2, amount: 3, power: 4, text: 'T', onDone: function () {},
      });
    });
    f2.floatText(s2, 'x', 'dmg');
    f2.flyCard({ x: 0, y: 0 }, { x: 5, y: 5 }, 400);
    f2.shake(s2, 2);
    f2.banner('B');
    return snapshot(d2, s2);
  };
  const a = run();
  const b = run();
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new Error('两次快照不一致: ' + JSON.stringify(a) + ' / ' + JSON.stringify(b));
  }
}, '确定性: 相同输入两次运行快照一致');

// ---- 7. bindFxBus ----
noThrow(function () {
  const handlers = Object.create(null);
  const bus = {
    on: function (kind, fn) {
      handlers[kind] = fn;
      return function () { delete handlers[kind]; };
    },
  };
  const docB = makeStubDom();
  const fxB = F.createFx(docB);
  const seatB = docB.createElement('seat');
  const unbind = F.bindFxBus(fxB, bus.on.bind(bus));
  if (Object.keys(handlers).length !== KINDS.length) {
    throw new Error('订阅数 ' + Object.keys(handlers).length + ' != ' + KINDS.length);
  }
  handlers.attack({ dmg: 9, el: seatB });
  if (seatB.children.length === 0) throw new Error('attack 事件未驱动 fx.play');
  unbind();
  if (Object.keys(handlers).length !== 0) throw new Error('unbind 未清理订阅');
}, 'bindFxBus 订阅全部事件、转发 play 并可解绑');
ok(typeof F.bindFxBus(F.createFx({}), null) === 'function', 'bindFxBus 缺少 on 时安全返回空函数');

// ---- 汇总 ----
const total = passed + failed;
console.log('fx-test: 事件种类 = ' + KINDS.length + ' (SPEC 写 21 个, 实际列举 22 个, 以列举为准)');
if (failures.length) failures.forEach(function (f) { console.log('  [失败] ' + f); });
console.log('=== 汇总: F通过=' + passed + '/' + total + ' | 断言失败=' + failed + ' ===');
process.exitCode = failed > 0 ? 1 : 0;
