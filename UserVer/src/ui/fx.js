'use strict';
// fx.js — OI杀 v4 动效系统 (P7a)
// CommonJS、零依赖；DOM-free 逻辑 + 可选 DOM 钩子。
// 设计约定：不使用定时器（保证 node 测试确定性），所有类同步添加；
// 移除/清理交由集成阶段（animationend / CSS 动画自身结束）。
// 所有 DOM 方法在缺少 dom/el 时安全 no-op（返回 null/false），可在 node 环境直接调用。

// ---------- 1. 事件 -> 动效数据表 ----------
const fxMap = {
  playCard:    { cssClass: 'fx-flying',            floatText: '出牌',     durationMs: 600,  desc: '卡牌飞入 + 落地' },
  attack:      { cssClass: 'fx-seat-flash-red',    floatText: '攻击!',    durationMs: 400,  desc: '目标红光闪烁 + 伤害飘字' },
  damage:      { cssClass: 'fx-dmg-float',         floatText: '伤害',     durationMs: 500,  desc: '血条损失 + 红色脉冲' },
  heal:        { cssClass: 'fx-seat-flash-green',  floatText: '+1',       durationMs: 500,  desc: '绿色脉冲 + 治疗飘字' },
  equip:       { cssClass: 'fx-evolve-glow',       floatText: '装备',     durationMs: 400,  desc: '装备槽发光' },
  deploy:      { cssClass: 'fx-deploy-bounce',     floatText: '部署',     durationMs: 500,  desc: '单位弹跳入场' },
  unitAttack:  { cssClass: 'fx-unit-shards',       floatText: '交火',     durationMs: 450,  desc: '交火碰撞 + 碎片' },
  guardBlock:  { cssClass: 'fx-shield-break',      floatText: '格挡',     durationMs: 500,  desc: '护盾破碎' },
  evolve:      { cssClass: 'fx-evolve-glow',       floatText: '进化',     durationMs: 900,  desc: '金色变形 + 粒子' },
  awaken:      { cssClass: 'fx-banner',            floatText: '觉醒',     durationMs: 1200, desc: '全屏闪光 + 横幅' },
  judge:       { cssClass: 'fx-judge-flip',        floatText: '判定',     durationMs: 800,  desc: '卡牌翻转 + 花色揭晓' },
  aoe:         { cssClass: 'fx-wave',              floatText: 'AOE',      durationMs: 600,  desc: '环形冲击波' },
  wa:          { cssClass: 'fx-wave',              floatText: '波纹',     durationMs: 600,  desc: '蓝色波纹' },
  counter:     { cssClass: 'fx-seat-flash-purple', floatText: '反击',     durationMs: 400,  desc: '紫色闪光' },
  death:       { cssClass: 'fx-seat-collapse',     floatText: '阵亡',     durationMs: 900,  desc: '座位坍塌 + 身份翻面' },
  victory:     { cssClass: 'fx-victory-in',        floatText: '胜利',     durationMs: 1500, desc: '胜利结算特效' },
  defeat:      { cssClass: 'fx-victory-in',        floatText: '败北',     durationMs: 1500, desc: '失败结算特效' },
  achievement: { cssClass: 'fx-ach-pop',           floatText: '成就达成', durationMs: 1000, desc: '成就弹窗' },
  countdown:   { cssClass: 'fx-seat-flash-red',    floatText: '倒计时',   durationMs: 500,  desc: '红色脉冲' },
  turn:        { cssClass: 'fx-turn-halo',         floatText: '回合开始', durationMs: 800,  desc: '光环旋转' },
  chat:        { cssClass: 'fx-chat-pop',          floatText: '消息',     durationMs: 300,  desc: '气泡弹出' },
  reject:      { cssClass: 'fx-shake',             floatText: '无效操作', durationMs: 400,  desc: '抖动拒绝' },
};

// 事件主类之外系统还要用到的类（变体类、全屏类、粒子类等）。
const EXTRA_CSS = [
  'fx-particle',
  'fx-flying',
  'fx-dmg-float',
  'fx-judge-flip',
  'fx-shake',
  'fx-banner',
  'fx-ach-pop',
  'fx-victory-in',
  'fx-seat-flash-blue',
  'fx-wave-blue',
  'fx-identity-flip',
  'fx-dmg-float-dmg',
  'fx-dmg-float-heal',
  'fx-dmg-float-guard',
  'fx-dmg-float-count',
];

// ---------- 3. needsCss：系统期望页面具备的 CSS 类（集成阶段补齐） ----------
const needsCss = Array.from(new Set(
  EXTRA_CSS.concat(Object.keys(fxMap).map(function (k) { return fxMap[k].cssClass; }))
)).sort();

// ---------- 内部工具 ----------
function isElLike(v) {
  return !!(v && typeof v === 'object' && v.classList && typeof v.classList.add === 'function');
}

function pointOf(ref, fallback) {
  const fb = fallback || { x: 0, y: 0 };
  if (!ref || typeof ref !== 'object') return fb;
  const x = (typeof ref.x === 'number') ? ref.x
    : (typeof ref.offsetLeft === 'number') ? ref.offsetLeft : fb.x;
  const y = (typeof ref.y === 'number') ? ref.y
    : (typeof ref.offsetTop === 'number') ? ref.offsetTop : fb.y;
  return { x: x, y: y };
}

// ---------- 2. createFx(dom) ----------
function createFx(dom) {
  const root = (dom && typeof dom === 'object') ? dom : null;
  const doc = (root && typeof root.createElement === 'function') ? root
    : (root && root.document && typeof root.document.createElement === 'function') ? root.document
    : null;
  const body = (doc && doc.body) ? doc.body : null;

  function mk(className, text) {
    if (!doc || typeof doc.createElement !== 'function') return null;
    const el = doc.createElement('div');
    el.className = className;
    if (text != null) el.textContent = String(text);
    return el;
  }

  function append(target, el) {
    if (target && el && typeof target.appendChild === 'function') {
      target.appendChild(el);
      return el;
    }
    return null;
  }

  function spawnParticle(x, y, opts) {
    const o = opts || {};
    const p = mk('fx-particle' + (o.className ? ' ' + o.className : ''));
    if (!p) return null;
    p.style.left = String(x == null ? 0 : x) + 'px';
    p.style.top = String(y == null ? 0 : y) + 'px';
    if (o.durationMs) p.style.animationDuration = String(o.durationMs) + 'ms';
    return append(body, p);
  }

  function floatText(el, text, kind) {
    const target = isElLike(el) ? el : body;
    const f = mk('fx-dmg-float' + (kind ? ' fx-dmg-float-' + kind : ''));
    if (!f) return null;
    f.textContent = (text == null ? '' : String(text));
    return append(target, f);
  }

  function shake(el, power) {
    const target = isElLike(el) ? el : null;
    if (!target) return false;
    target.classList.add('fx-shake');
    if (power != null && target.style && typeof target.style.setProperty === 'function') {
      target.style.setProperty('--fx-shake-power', String(power));
    }
    return true;
  }

  function flashSeat(el, kind) {
    const target = isElLike(el) ? el : null;
    if (!target) return false;
    const map = {
      red: 'fx-seat-flash-red',
      green: 'fx-seat-flash-green',
      blue: 'fx-seat-flash-blue',
      purple: 'fx-seat-flash-purple',
    };
    target.classList.add(map[kind] || 'fx-seat-flash-red');
    return true;
  }

  function flyCard(from, to, dur) {
    const f = mk('fx-flying');
    if (!f) return null;
    const a = pointOf(from, { x: 0, y: 0 });
    const b = pointOf(to, { x: 0, y: 0 });
    f.style.left = String(a.x) + 'px';
    f.style.top = String(a.y) + 'px';
    f.style.transitionDuration = String(dur == null ? 600 : dur) + 'ms';
    if (append(body, f)) {
      // 真实 DOM 下强制一次回流，确保 transition 生效；桩 DOM 无 offsetWidth 则跳过。
      if (typeof f.offsetWidth === 'number') { void f.offsetWidth; }
      f.style.left = String(b.x) + 'px';
      f.style.top = String(b.y) + 'px';
    }
    return f;
  }

  function judgeFlip(el, cb) {
    const target = isElLike(el) ? el : null;
    if (target) target.classList.add('fx-judge-flip');
    // 无计时器：翻转后同步回调（花色揭晓由回调实现）
    if (typeof cb === 'function') cb();
    return !!target;
  }

  function wave(el) {
    const target = isElLike(el) ? el : body;
    if (!target) return false;
    target.classList.add('fx-wave');
    return true;
  }

  function banner(text) {
    const b = mk('fx-banner');
    if (!b) return null;
    if (text != null) b.textContent = String(text);
    return append(body, b);
  }

  function play(kind, payload) {
    const entry = fxMap[kind];
    if (!entry) return false;
    const p = (payload && typeof payload === 'object') ? payload : {};
    const elRef = p.el || p.target || p.seat;
    const el = isElLike(elRef) ? elRef : null;

    switch (kind) {
      case 'playCard':
        flyCard(p.from || p.card, p.to, entry.durationMs);
        if (el) el.classList.add(entry.cssClass);
        return true;

      case 'attack': {
        if (el) flashSeat(el, 'red');
        const t = el || body;
        if (t) floatText(t, (p.dmg != null ? '-' + p.dmg : (p.text || entry.floatText)), 'dmg');
        return true;
      }

      case 'damage': {
        const bar = isElLike(p.hpBar) ? p.hpBar : null;
        if (bar) bar.classList.add('fx-dmg-float');
        if (el) flashSeat(el, 'red');
        const t = bar || el || body;
        if (t) floatText(t, (p.dmg != null ? '-' + p.dmg : (p.text || entry.floatText)), 'dmg');
        return true;
      }

      case 'heal': {
        if (el) flashSeat(el, 'green');
        const t = el || body;
        if (t) floatText(t, (p.amount != null ? '+' + p.amount : (p.text || entry.floatText)), 'heal');
        return true;
      }

      case 'equip': {
        const slot = isElLike(p.slot) ? p.slot : el;
        if (slot) slot.classList.add(entry.cssClass);
        return true;
      }

      case 'deploy':
        if (el) el.classList.add(entry.cssClass);
        if (p.x != null && p.y != null) spawnParticle(p.x, p.y, { className: 'fx-deploy-bounce' });
        return true;

      case 'unitAttack':
        if (el) el.classList.add(entry.cssClass);
        if (p.x != null && p.y != null) spawnParticle(p.x, p.y, { className: 'fx-unit-shards', durationMs: entry.durationMs });
        return true;

      case 'guardBlock': {
        if (el) el.classList.add(entry.cssClass);
        const t = el || body;
        if (t) floatText(t, (p.text || entry.floatText), 'guard');
        return true;
      }

      case 'evolve':
        if (el) el.classList.add(entry.cssClass);
        if (p.x != null && p.y != null) spawnParticle(p.x, p.y, { className: 'fx-evolve-glow', durationMs: entry.durationMs });
        return true;

      case 'awaken':
        if (el) el.classList.add(entry.cssClass);
        if (body && body.classList) body.classList.add('fx-banner'); // 全屏闪光
        banner(p.text || entry.floatText);
        return true;

      case 'judge':
        judgeFlip(el, p.onDone || p.cb);
        return true;

      case 'aoe': {
        const t = el || body;
        if (t) wave(t);
        return true;
      }

      case 'wa': {
        const t = el || body;
        if (t) { t.classList.add('fx-wave'); t.classList.add('fx-wave-blue'); }
        return true;
      }

      case 'counter':
        if (el) flashSeat(el, 'purple');
        return true;

      case 'death':
        if (el) { el.classList.add(entry.cssClass); el.classList.add('fx-identity-flip'); }
        return true;

      case 'victory':
      case 'defeat': {
        const t = el || body;
        if (t && t.classList) t.classList.add(entry.cssClass);
        if (p.text) banner(p.text);
        return true;
      }

      case 'achievement': {
        const t = el || body;
        if (t && t.classList) t.classList.add(entry.cssClass);
        append(t, mk('fx-ach-pop', p.text || entry.floatText));
        return true;
      }

      case 'countdown': {
        if (el) flashSeat(el, 'red');
        const t = el || body;
        if (t) floatText(t, (p.text || entry.floatText), 'count');
        return true;
      }

      case 'turn': {
        const t = el || body;
        if (t && t.classList) t.classList.add(entry.cssClass);
        return true;
      }

      case 'chat': {
        const t = el || body;
        append(t, mk('fx-chat-pop', p.text || entry.floatText));
        return true;
      }

      case 'reject':
        if (el) shake(el, (p.power != null ? p.power : 8));
        return true;

      default:
        if (el) el.classList.add(entry.cssClass);
        return true;
    }
  }

  return {
    spawnParticle: spawnParticle,
    floatText: floatText,
    shake: shake,
    flashSeat: flashSeat,
    flyCard: flyCard,
    judgeFlip: judgeFlip,
    wave: wave,
    banner: banner,
    play: play,
  };
}

// ---------- 4. bindFxBus(fx, on[, kinds]) ----------
// 订阅事件总线并转发到 fx.play；默认订阅全部 fxMap 事件，可用 kinds 过滤。
function bindFxBus(fx, on, kinds) {
  const list = (Array.isArray(kinds) && kinds.length ? kinds : Object.keys(fxMap))
    .filter(function (k) { return !!fxMap[k]; });
  if (typeof on !== 'function' || !fx || typeof fx.play !== 'function') {
    return function noopUnbind() {};
  }
  const offs = [];
  for (let i = 0; i < list.length; i += 1) {
    const k = list[i];
    try {
      const off = on(k, function (payload) { fx.play(k, payload); });
      if (typeof off === 'function') offs.push(off);
    } catch (err) { /* 单个订阅失败不阻断其余事件 */ }
  }
  return function unbind() {
    offs.forEach(function (fn) {
      try { fn(); } catch (err) { /* 忽略解绑异常 */ }
    });
  };
}

module.exports = {
  fxMap: fxMap,
  needsCss: needsCss,
  createFx: createFx,
  bindFxBus: bindFxBus,
};
