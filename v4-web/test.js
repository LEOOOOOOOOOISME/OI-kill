/* ============================================================================
 * OI杀 v4.0 引擎自动化测试 (v4-web/test.js)
 * 用法: 在 v4-web 目录执行  node test.js
 * 只读调用 ./game.js 导出 API，不修改引擎源码。
 *
 * A. 不变量全AI回归: seeds 1..40, 6人全AI, 每局 <=3000 回合
 * B. 人类流程模拟:   human=0, seeds 101..105
 * C. 定向单测: WA响应 / 卖队友转嫁 / 守擂挡刀 / 题海战术
 * ==========================================================================*/
'use strict';

const API = require('./game.js');

const NAMES6 = ['主', '甲', '乙', '丙', '丁', '戊'];
const SPEC_DECK_SIZE = 120;   // 规格(README/注释)声称 120 张牌堆
const TURN_CAP = 3000;        // 每局最大回合数
const DECK_SUM = Object.values(API.DECK_COUNT).reduce((a, b) => a + b, 0);
const NEUTRAL_PROF = { id: 'none', name: '测试', plain: '测试', hp: 4, domain: null, subDomain: null, passive: '', awaken: '' };

/* ================= 失败记录器 ================= */
function makeRec() {
  return {
    counts: {}, samples: {}, crash: null, crashTail: '',
    add(name, exp, act, ctx) {
      this.counts[name] = (this.counts[name] || 0) + 1;
      const arr = (this.samples[name] = this.samples[name] || []);
      if (arr.length < 3) arr.push({ exp, act, ctx });
    },
    names() { return Object.keys(this.counts); },
    summary() {
      if (this.crash) return 'CRASH: ' + this.crash.split('\n')[0];
      const n = this.names();
      return n.length ? n.map(k => k + 'x' + this.counts[k]).join(' ') : '(全部通过)';
    },
  };
}

/* ================= 工具 ================= */
// id===-1 为虚拟衍生物(funClone 克隆体/主公护盾等, 不进牌堆), 不参与守恒计数
function isRealCard(c) { return !!c && c.id !== -1; }

// 卡牌守恒: 牌堆+弃牌堆+所有玩家(手牌+武器+防具+单位+延时区), 仅计真实牌
function totalCards(g) {
  let t = 0;
  for (const c of g.deck) if (isRealCard(c)) t += 1;
  for (const c of g.discard) if (isRealCard(c)) t += 1;
  for (const p of g.players) {
    for (const c of p.hand) if (isRealCard(c)) t += 1;
    if (isRealCard(p.weapon)) t += 1;
    if (isRealCard(p.armor)) t += 1;
    for (const c of p.units) if (isRealCard(c)) t += 1;
    for (const c of p.delayArea) if (isRealCard(c)) t += 1;
  }
  return t;
}

function handLimitOf(p) {
  return 5 + (p.handLimitBonus || 0) + (p.prof && p.prof.id === 'tuling' && p.usedDianji ? 2 : 0);
}

function checkBounds(g, rec, tag) {
  for (const p of g.players) {
    const c = `${tag} pid=${p.id} round=${g.round}`;
    if (p.hp > p.maxHp) rec.add('hp-over-max', `hp<=${p.maxHp}`, p.hp, c);
    if (!p.dead && p.hp < 1) {
      const tail = g.log.slice(-6).map(l => `[${l.t}] ${l.txt}`).join(' | ');
      rec.add('alive-hp-below-1', '存活者 hp>=1', p.hp, c + ' prof=' + p.prof.id + ' 日志尾: ' + tail);
    }
    if (p.dead && p.hp > 0) rec.add('dead-hp-positive', '死亡者 hp<=0', p.hp, c);
    if (p.mp < 0 || p.mp > 12) rec.add('mp-out-of-range', '0<=mp<=12', p.mp, c);
    if (p.mp > p.mpMax) rec.add('mp-over-max', `mp<=${p.mpMax}`, p.mp, c);
    if (p.mpMax < 3 || p.mpMax > 12) rec.add('mpMax-out-of-range', '3<=mpMax<=12', p.mpMax, c);
  }
}

function checkView(g, rec, pid) {
  try {
    const v = API.publicView(g, pid);
    const p = g.players[pid];
    if (!Array.isArray(v.me.hand) || v.me.hand.length !== p.hand.length)
      rec.add('view-hand-mismatch', p.hand.length, v.me.hand && v.me.hand.length, `pid=${pid} round=${g.round}`);
    if (!Array.isArray(v.others) || v.others.length !== g.players.length - 1)
      rec.add('view-others-mismatch', g.players.length - 1, v.others && v.others.length, `pid=${pid} round=${g.round}`);
    if (Array.isArray(v.me.hand)) {
      for (const h of v.me.hand) {
        const keys = ['key', 'suit', 'num', 'name', 'plain', 'type', 'cost'];
        const miss = keys.filter(k => !(k in h));
        if (miss.length) { rec.add('view-hand-fields', keys.join('/'), '缺失:' + miss.join(','), `pid=${pid} round=${g.round}`); break; }
      }
    }
  } catch (e) {
    rec.add('view-crash', '不抛异常', String(e && e.message), `pid=${pid} round=${g.round}`);
  }
}

// 终局牌种审计: 各 key 现存数 - 牌堆配置数 (正=增生 负=流失; 进化改写会产生噪声; 排除虚拟牌)
function keyAudit(g) {
  const cnt = {};
  const inc = (k, n) => { cnt[k] = (cnt[k] || 0) + n; };
  const incIfReal = (c) => { if (isRealCard(c)) inc(c.key, 1); };
  for (const c of g.deck) incIfReal(c);
  for (const c of g.discard) incIfReal(c);
  for (const p of g.players) {
    for (const c of p.hand) incIfReal(c);
    if (p.weapon) incIfReal(p.weapon);
    if (p.armor) incIfReal(p.armor);
    for (const c of p.units) incIfReal(c);
    for (const c of p.delayArea) incIfReal(c);
  }
  const diff = {};
  for (const k of Object.keys(API.DECK_COUNT)) {
    const d = (cnt[k] || 0) - API.DECK_COUNT[k];
    if (d !== 0) diff[k] = d;
  }
  return diff;
}

/* ================= A. 全AI不变量回归 ================= */
function runAI(seed) {
  const rec = makeRec();
  let g = null, over = false, winner = null, turns = 0, round = 0, steps = 0, audit = null;
  try {
    g = API.createGame({ seed, human: 99 });
    API.setup(g, NAMES6);
    API.startTurn(g, 0);
    const baseline = totalCards(g);
    if (baseline !== SPEC_DECK_SIZE)
      rec.add('card-total-120', SPEC_DECK_SIZE, baseline, 'setup后初始总数(deck=' + g.deck.length + ')');

    while (!g.over && steps < TURN_CAP) {
      const pid = g.turn;
      // 断言5: 全AI模式下 pending 应始终为 null
      if (g.pending)
        rec.add('pending-leak', 'null', JSON.stringify({ type: g.pending.type, target: g.pending.target, attacker: g.pending.attacker }), `round=${g.round} turn=${pid}`);
      // 断言2: 卡牌守恒
      const t = totalCards(g);
      if (t !== SPEC_DECK_SIZE) rec.add('card-total-120', SPEC_DECK_SIZE, t, `round=${g.round} turn=${pid} deck=${g.deck.length} disc=${g.discard.length}`);
      if (t !== baseline) rec.add('card-drift', baseline, t, `round=${g.round} turn=${pid} deck=${g.deck.length} disc=${g.discard.length}`);
      // 断言4: 数值边界
      checkBounds(g, rec, 'pre');
      // 断言3: 回合开始时手牌上限 (回合间摸牌合法: 挣扎+2/觉醒+1/玄学优化+2等, 容忍+5)
      const cur = g.players[pid];
      if (cur && !cur.dead) {
        const lim = handLimitOf(cur);
        if (cur.hand.length > lim + 5) rec.add('hand-limit', `<=${lim}+5`, cur.hand.length, `pid=${pid} round=${g.round} prof=${cur.prof.id} skipPlay=${cur.skipPlay} 回合开始`);
      }
      // 视图健全性(额外)
      checkView(g, rec, pid);

      const prevTurn = g.turn;
      API.judgePhase(g, pid);
      API.drawPhase(g, pid);
      API.aiTurn(g, pid);
      steps++;

      if (!g.over) {
        // 断言6: 连续两次 endTurn 之间 turn 必须变化
        if (g.turn === prevTurn) rec.add('turn-stuck', `turn!=${prevTurn}`, g.turn, `round=${g.round} 玩家${prevTurn}结束后`);
        checkBounds(g, rec, 'post');
        // 弃牌阶段后手牌应≤上限(容忍回合结束技能+2: 集训+1等)
        const ended = g.players[pid];
        if (ended && !ended.dead && ended.hand.length > handLimitOf(ended) + 2)
          rec.add('hand-limit-post', `<=${handLimitOf(ended)}+2`, ended.hand.length, `pid=${pid} round=${g.round} 弃牌后`);
      }
    }
    turns = steps; over = g.over; winner = g.winner; round = g.round;
    // 断言1: 3000 回合内结束且 winner 非空
    if (!over) rec.add('game-too-long', '3000回合内 over=true', `over=false round=${g.round}`, '');
    else if (!winner) rec.add('winner-null', 'winner 非空', String(winner), `round=${g.round}`);
    if (!g.over && g.pending) rec.add('pending-leak-end', 'null', JSON.stringify(g.pending && { type: g.pending.type, target: g.pending.target }), `对局结束 round=${g.round}`);
    checkBounds(g, rec, 'final');
    audit = keyAudit(g);
  } catch (e) {
    rec.crash = String((e && e.stack) || e);
    try {
      rec.crashTail = (g && g.log || []).slice(-8).map(l => `[${l.t}] ${l.txt}`).join(' | ');
      over = g.over; winner = g.winner; round = g.round; turns = steps;
    } catch (_) { /* 忽略 */ }
  }
  return { seed, over, winner, turns, round, rec, audit };
}

/* ================= B. 人类流程模拟 (human=0) ================= */
function shapeCheck(rec, r, what) {
  const okShape = !!r && (r.ok === true || (r.ok === false && typeof r.why === 'string'));
  if (!okShape) rec.add('result-shape', 'ok:true 或 {ok:false, why:string}', JSON.stringify(r), what);
}

// 解析人类相关挂起: WA出WA; 特判反制; 题解大会选第一张; 冷数据/平衡树/不死心选是
function resolvePendingForHuman(g, rec) {
  if (!g.pending) return;
  switch (g.pending.type) {
    case 'dodge': {
      const rr = API.respondDodge(g, 0, true);
      if (!rr.ok) rec.add('pending-resolve-fail', 'ok:true', JSON.stringify(rr), `round=${g.round} type=dodge`);
      break;
    }
    case 'counter': {
      const rr = API.respondCounter(g, 0, true);
      if (!rr.ok) rec.add('counter-resolve-fail', 'ok:true', JSON.stringify(rr), `round=${g.round} type=counter`);
      break;
    }
    case 'harvest': {
      const cards = (g.pending.ctx && g.pending.ctx.cards) || [];
      const rr = API.respondHarvest(g, 0, cards.length ? cards[0].key : null);
      if (!rr.ok) rec.add('pending-resolve-fail', 'ok:true', JSON.stringify(rr), `round=${g.round} type=harvest`);
      break;
    }
    case 'cold': API.respondCold(g, 0, true); break;
    case 'bbst': API.respondBbst(g, 0, true); break;
    case 'chase': API.respondChase(g, 0, true); break;
    case 'aoeResp': API.respondAoeResp(g, 0, true); break;
    case 'report': {
      const cards = (g.pending.ctx && g.pending.ctx.cards) || [];
      if (API.respondReport) API.respondReport(g, 0, cards.length ? cards[0].key : null);
      break;
    }
    default:
      rec.add('pending-unknown-type', 'dodge|counter|harvest|cold|bbst|chase|aoeResp|report', JSON.stringify(g.pending), `round=${g.round}`);
  }
}

// 人类回合收尾: 弃牌+endTurn+进化候选选择
function finishHumanTurn(g) {
  API.discardPhase(g, 0);
  API.endTurn(g, 0);
  if (g.evoWait && g.evoWait.pid === 0) {
    const keys = g.evoWait.keys || [];
    API.evolvePick(g, 0, keys.length ? keys[0] : null);
  }
}

function humanTurn(g, rec) {
  const me = g.players[0];
  if (me.dead || g.over || me.skipPlay) { finishHumanTurn(g); return; }
  resolvePendingForHuman(g, rec); // 防御性清理
  let guard = 0;
  while (guard++ < 12 && !g.over) {
    let did = false;
    // 1. 优先治疗
    const hIdx = me.hand.findIndex(c => c.key === 'heal' || c.key === 'healEvo');
    if (hIdx >= 0 && me.hp < me.maxHp) {
      const r = API.playCard(g, 0, hIdx);
      shapeCheck(rec, r, 'playCard(heal)');
      if (r.ok) { rec.hActs++; did = true; continue; }
    }
    // 2. 攻击随机敌人
    const aIdx = me.hand.findIndex(c => c.key === 'attack' || c.key === 'attackEvo');
    if (aIdx >= 0 && me.canAttack) {
      const enemies = g.players.filter(q => !q.dead && q.id !== 0);
      if (enemies.length) {
        const t = enemies[Math.floor(Math.random() * enemies.length)];
        const r = API.playCard(g, 0, aIdx, t.id);
        shapeCheck(rec, r, 'playCard(attack)');
        if (r.ok) {
          rec.hActs++; did = true;
          resolvePendingForHuman(g, rec);
          continue;
        }
      }
    }
    // 3. 装备
    const eIdx = me.hand.findIndex(c => API.spec(c.key).type === 'equip');
    if (eIdx >= 0) {
      const r = API.equipCard(g, 0, eIdx);
      shapeCheck(rec, r, 'equipCard');
      if (r.ok) { rec.hActs++; did = true; continue; }
    }
    // 4. 部署单位
    const uIdx = me.hand.findIndex(c => API.spec(c.key).type === 'unit');
    if (uIdx >= 0) {
      const r = API.deployUnit(g, 0, uIdx);
      if (r.ok) { rec.hActs++; did = true; continue; }
    }
    // 5. 过牌/锦囊
    const trIdx = me.hand.findIndex(c => API.spec(c.key).type === 'trick' && c.key !== 'counter' && c.key !== 'counterEvo');
    if (trIdx >= 0) {
      const k = me.hand[trIdx].key;
      const needsT = ['dismantle', 'steal', 'pierce', 'o2', 'duel', 'skipPlay', 'delaySkipPlay', 'delaySkipDraw', 'gift', 'funReport', 'funArgue', 'funBetray'];
      let tgt;
      if (needsT.includes(k)) {
        const enemies = g.players.filter(q => !q.dead && q.id !== 0);
        if (!enemies.length) break;
        tgt = enemies[Math.floor(Math.random() * enemies.length)].id;
      }
      const r = API.playCard(g, 0, trIdx, tgt);
      shapeCheck(rec, r, 'playCard(trick ' + k + ')');
      if (r.ok) {
        rec.hActs++; did = true;
        resolvePendingForHuman(g, rec);
        continue;
      }
    }
    if (!did) break;
  }
  if (!g.over) finishHumanTurn(g);
}

function runHuman(seed) {
  const rec = makeRec();
  rec.hActs = 0;
  let g = null, over = false, winner = null, turns = 0, round = 0, steps = 0;
  try {
    g = API.createGame({ seed, human: 0 });
    API.setup(g, NAMES6);
    API.startTurn(g, 0);
    while (!g.over && steps < TURN_CAP) {
      // AI 攻击/特判人类留下的挂起: 出WA/放弃反制
      resolvePendingForHuman(g, rec);
      if (g.over) break;
      const pid = g.turn;
      API.judgePhase(g, pid);
      API.drawPhase(g, pid);
      if (pid === 0) humanTurn(g, rec);
      else API.aiTurn(g, pid);
      steps++;
    }
    turns = steps; over = g.over; winner = g.winner; round = g.round;
    if (!over) rec.add('game-too-long', '3000回合内 over=true', `over=false round=${g.round}`, '');
    else if (!winner) rec.add('winner-null', 'winner 非空', String(winner), `round=${g.round}`);
    if (!g.over && g.pending) rec.add('pending-leak-end', 'null', JSON.stringify(g.pending && { type: g.pending.type, target: g.pending.target }), `对局结束 round=${g.round}`);
  } catch (e) {
    rec.crash = String((e && e.stack) || e);
    try {
      rec.crashTail = (g && g.log || []).slice(-8).map(l => `[${l.t}] ${l.txt}`).join(' | ');
      over = g.over; winner = g.winner; round = g.round; turns = steps;
    } catch (_) { /* 忽略 */ }
  }
  return { seed, over, winner, turns, round, rec, hActs: rec.hActs };
}

/* ================= C. 定向单测 ================= */
function runCTest(name, fn) {
  const c = {
    name, fails: [], crash: null,
    ok(cond, msg) { if (!cond) this.fails.push(msg); },
  };
  try { fn(c); } catch (e) { c.crash = String((e && e.stack) || e); }
  return c;
}

function stripPlayer(p) {
  p.hand = []; p.weapon = null; p.armor = null; p.units = []; p.delayArea = [];
  p.prof = Object.assign({}, NEUTRAL_PROF);
}

// C1: WA 响应 — 攻击挂起 -> respondDodge(true) 抵消不掉血扣1灵感; (false) 掉1血不扣灵感
function testC1() {
  return runCTest('C1 WA响应', (c) => {
    const g = API.createGame({ seed: 42, human: 0 });
    API.setup(g, ['主', '甲', '乙']);
    for (const p of g.players) stripPlayer(p);
    const p0 = g.players[0], p1 = g.players[1];
    p0.hp = p0.maxHp; p1.hp = p1.maxHp;
    p0.mp = 5; p1.mp = 5;
    p0.hand.push({ id: 900, key: 'dodge', suit: 'heart', num: 3 });
    p1.hand.push({ id: 901, key: 'attack', suit: 'spade', num: 7 });
    g.turn = 1;
    g.round = 2; // 避开主公首轮免伤(H2-1), 聚焦WA响应本身

    const hp0 = p0.hp, mp0 = p0.mp;
    const r = API.playCard(g, 1, 0, 0);
    c.ok(r.ok === true && r.result === 'pending', `攻击人类应挂起 pending (r=${JSON.stringify(r)})`);
    c.ok(g.pending && g.pending.type === 'dodge' && g.pending.target === 0 && g.pending.attacker === 1,
      `pending 应为 {type:dodge,target:0,attacker:1} 实际=${JSON.stringify(g.pending && { type: g.pending.type, target: g.pending.target, attacker: g.pending.attacker })}`);

    const r2 = API.respondDodge(g, 0, true);
    c.ok(r2.ok === true && r2.result === 'dodged', `respondDodge(true) 应返回 dodged 实际=${JSON.stringify(r2)}`);
    c.ok(g.pending === null, 'respondDodge 后 pending 应清空');
    c.ok(p0.hp === hp0, `出WA后 hp 不变 (期望${hp0} 实际${p0.hp})`);
    c.ok(p0.mp === mp0 - 1, `出WA扣1灵感 (期望${mp0 - 1} 实际${p0.mp})`);
    c.ok(g.discard.some(x => x.id === 900), 'WA牌应进弃牌堆');

    // 第二击: 有WA但选择不出
    p0.hand.push({ id: 902, key: 'dodge', suit: 'club', num: 5 });
    p1.hand.push({ id: 903, key: 'attack', suit: 'club', num: 9 });
    const r3 = API.playCard(g, 1, 0, 0);
    c.ok(r3.ok === true && g.pending !== null, `第二次攻击应再次挂起 (r=${JSON.stringify(r3)})`);
    const mpB = p0.mp;
    API.respondDodge(g, 0, false);
    c.ok(p0.hp === hp0 - 1, `不出WA应掉1血 (期望${hp0 - 1} 实际${p0.hp})`);
    c.ok(p0.mp === mpB, `不出WA不应扣灵感 (期望${mpB} 实际${p0.mp})`);
    c.ok(g.pending === null, '第二次 respondDodge 后 pending 应清空');
  });
}

// C2: 卖队友转嫁(响应) — 被攻击者持【卖队友】, 攻击挂起询问 -> respondBetray 转给指定玩家
function testC2() {
  return runCTest('C2 卖队友转嫁(响应)', (c) => {
    const g = API.createGame({ seed: 43, human: 0 });
    API.setup(g, ['主', '甲', '乙']);
    for (const p of g.players) stripPlayer(p);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p0.hp = p0.maxHp; p1.hp = p1.maxHp; p2.hp = p2.maxHp;
    p0.mp = 5; p1.mp = 5;
    p0.hand.push({ id: 910, key: 'funBetray', suit: 'spade', num: 4 });
    p1.hand.push({ id: 911, key: 'attack', suit: 'spade', num: 7 });
    g.turn = 1;
    const hp0 = p0.hp, hp2 = p2.hp;
    const r = API.playCard(g, 1, 0, 0);
    c.ok(r.ok === true && g.pending && g.pending.type === 'dodge' && g.pending.ctx && g.pending.ctx.betrayAvail === true,
      `被攻击者持【卖队友】应挂起可转嫁询问 (r=${JSON.stringify(r)}, pending=${JSON.stringify(g.pending)})`);
    const rr = API.respondBetray(g, 0, 2);
    c.ok(rr.ok === true && rr.result === 'redirected', `respondBetray 应转嫁成功 (rr=${JSON.stringify(rr)})`);
    c.ok(p0.hp === hp0, `原目标 hp 不变 (期望${hp0} 实际${p0.hp})`);
    c.ok(p2.hp === hp2 - 1, `转嫁目标掉1血 (期望${hp2 - 1} 实际${p2.hp})`);
    c.ok(g.discard.some(x => x.id === 910), '【卖队友】应进弃牌堆');
    c.ok(g.pending === null, '转嫁后 pending 应清空');
  });
}

// C3: 守擂挡刀
function testC3() {
  return runCTest('C3 守擂挡刀', (c) => {
    const g = API.createGame({ seed: 44, human: 99 });
    API.setup(g, ['主', '甲', '乙']);
    for (const p of g.players) stripPlayer(p);
    const p0 = g.players[0], p1 = g.players[1];
    p1.units.push({ id: 920, key: 'uGuard', suit: 'spade', num: 2 });
    p0.hand.push({ id: 921, key: 'attack', suit: 'club', num: 9 });
    p0.mp = 5; p0.hp = p0.maxHp; p1.hp = p1.maxHp;
    g.turn = 0;
    const hp1 = p1.hp;
    const r = API.playCard(g, 0, 0, 1);
    c.ok(r.ok === true && r.result === 'guard', `应被守擂挡下 (r=${JSON.stringify(r)})`);
    c.ok(p1.hp === hp1, `守擂挡刀后 hp 不变 (期望${hp1} 实际${p1.hp})`);
    c.ok(p1.units.length === 0, `守擂单位应被消灭 实际剩${p1.units.length}`);
    c.ok(g.discard.some(x => x.id === 920), '守擂单位应进弃牌堆');
  });
}

// C4: 题海战术 — 牌堆摸空且弃牌堆有牌 -> 洗回 + 全体-1体力
function testC4() {
  return runCTest('C4 题海战术', (c) => {
    const g = API.createGame({ seed: 45, human: 99 });
    API.setup(g, ['主', '甲', '乙']);
    for (const p of g.players) { stripPlayer(p); p.hp = p.maxHp; }
    g.deck = [{ id: 930, key: 'heal', suit: 'heart', num: 3 }];
    g.discard = [
      { id: 931, key: 'attack', suit: 'spade', num: 4 },
      { id: 932, key: 'dodge', suit: 'club', num: 5 },
      { id: 933, key: 'draw2', suit: 'diamond', num: 6 },
    ];
    const rc = g.reshuffleCount;
    const hps = g.players.map(p => p.hp);
    const handBefore = g.players[0].hand.length;
    API.draw(g, 0, 3);
    c.ok(g.reshuffleCount === rc + 1, `洗回应计数+1 (期望${rc + 1} 实际${g.reshuffleCount})`);
    c.ok(g.discard.length === 0, `洗回后弃牌堆应为空 实际=${g.discard.length}`);
    c.ok(g.deck.length === 1, `洗回3张摸走2张应剩1 实际=${g.deck.length}`);
    c.ok(g.players[0].hand.length === handBefore + 3, `摸3后手牌+3 (期望${handBefore + 3} 实际${g.players[0].hand.length})`);
    g.players.forEach((p, i) => {
      if (!p.dead) c.ok(p.hp === hps[i] - 1, `存活玩家${i} 全体-1体力 (期望${hps[i] - 1} 实际${p.hp})`);
    });
  });
}

// C5: 特判挂起(反制) — AI 对持特判的人类使用可反制锦囊 -> 挂起; 选择反制则效果抵消
function testC5() {
  return runCTest('C5 特判挂起(反制)', (c) => {
    const g = API.createGame({ seed: 46, human: 0 });
    API.setup(g, ['主', '甲', '乙']);
    for (const p of g.players) stripPlayer(p);
    const p0 = g.players[0], p1 = g.players[1];
    p0.hp = p0.maxHp; p1.hp = p1.maxHp;
    p0.mp = 5; p1.mp = 5;
    p0.hand.push({ id: 940, key: 'counter', suit: 'spade', num: 4 });
    p1.hand.push({ id: 941, key: 'pierce', suit: 'club', num: 6 });
    g.turn = 1;
    g.round = 2; // 避开主公首轮免伤
    const hp0 = p0.hp, mp0 = p0.mp;
    const r = API.playCard(g, 1, 0, 0);
    c.ok(r.ok === true && g.pending && g.pending.type === 'counter',
      `对持特判的人类使用可反制锦囊应挂起特判询问 (r=${JSON.stringify(r)})`);
    const rr = API.respondCounter(g, 0, true); // 反制
    c.ok(rr.ok === true && rr.countered === true, `respondCounter(true) 应反制成功 (rr=${JSON.stringify(rr)})`);
    c.ok(p0.hp === hp0, `反制后 hp 不变 (期望${hp0} 实际${p0.hp})`);
    c.ok(p0.mp === mp0 - 1, `反制扣1灵感 (期望${mp0 - 1} 实际${p0.mp})`);
    c.ok(g.discard.some(x => x.id === 940), '特判牌应进弃牌堆');
    c.ok(g.pending === null, 'pending 应清空');
  });
}

// C6: 特判挂起(放弃反制) — 放弃后锦囊效果应生效(引擎该路径疑似崩溃, 用于暴露缺陷)
function testC6() {
  return runCTest('C6 特判挂起(放弃反制)', (c) => {
    const g = API.createGame({ seed: 47, human: 0 });
    API.setup(g, ['主', '甲', '乙']);
    for (const p of g.players) stripPlayer(p);
    const p0 = g.players[0], p1 = g.players[1];
    p0.hp = p0.maxHp; p1.hp = p1.maxHp;
    p0.mp = 5; p1.mp = 5;
    p0.hand.push({ id: 942, key: 'counter', suit: 'spade', num: 4 });
    p1.hand.push({ id: 943, key: 'pierce', suit: 'club', num: 6 });
    g.turn = 1;
    g.round = 2; // 避开主公首轮免伤
    const hp0 = p0.hp;
    const r = API.playCard(g, 1, 0, 0);
    c.ok(r.ok === true && g.pending && g.pending.type === 'counter', `应挂起特判询问 (r=${JSON.stringify(r)})`);
    const rr = API.respondCounter(g, 0, false); // 放弃反制 -> 卡评测机效果应生效
    c.ok(rr.ok === true, `respondCounter(false) 应返回 ok (rr=${JSON.stringify(rr)})`);
    c.ok(p0.hp === hp0 - 1, `放弃反制后【卡评测机】应造成1点伤害 (期望${hp0 - 1} 实际${p0.hp})`);
    c.ok(g.pending === null, 'pending 应清空');
  });
}

/* ================= 汇总输出 ================= */
const G = { counts: {}, samples: {}, keyAudit: {} };

function merge(rec, seed) {
  for (const k of rec.names()) {
    G.counts[k] = (G.counts[k] || 0) + rec.counts[k];
    G.samples[k] = G.samples[k] || [];
    for (const s of rec.samples[k]) {
      if (G.samples[k].length < 5) G.samples[k].push(`seed=${seed} ${s.ctx} 期望=${s.exp} 实际=${s.act}`);
    }
  }
  if (rec.crash) {
    G.counts.crash = (G.counts.crash || 0) + 1;
    G.samples.crash = G.samples.crash || [];
    if (G.samples.crash.length < 5) G.samples.crash.push(`seed=${seed} ${rec.crash}${rec.crashTail ? ' || 日志尾: ' + rec.crashTail : ''}`);
  }
}

function main() {
  const t0 = Date.now();
  console.log('====================================================');
  console.log(' OI杀 v4.0 引擎自动化测试 (v4-web/test.js)');
  console.log('====================================================');
  console.log(` 规格牌堆=${SPEC_DECK_SIZE}张; DECK_COUNT 实际求和=${DECK_SUM}张; 回合上限=${TURN_CAP}`);
  console.log('');

  /* ---------- A ---------- */
  console.log('--- A. 全AI不变量回归 (seeds 1..40, 6人局) ---');
  let aPass = 0, aPassNo120 = 0;
  const aFailedSeeds = [];
  for (let seed = 1; seed <= 40; seed++) {
    const r = runAI(seed);
    merge(r.rec, seed);
    if (r.audit) for (const k of Object.keys(r.audit)) G.keyAudit[k] = (G.keyAudit[k] || 0) + r.audit[k];
    const clean = !r.rec.crash && r.over && !!r.winner && r.rec.names().length === 0;
    const cleanNo120 = !r.rec.crash && r.over && !!r.winner && r.rec.names().filter(k => k !== 'card-total-120').length === 0;
    if (clean) aPass++;
    if (cleanNo120) aPassNo120++;
    if (!cleanNo120) aFailedSeeds.push(seed);
    console.log(`[A seed=${String(seed).padStart(2, '0')}] over=${r.over} winner=${r.winner} turns=${r.turns} round=${r.round} | ${r.rec.summary()}`);
  }
  console.log(`A 通过(含120守恒): ${aPass}/40; A 通过(除 card-total-120): ${aPassNo120}/40; 未通过种子: ${aFailedSeeds.join(',') || '无'}`);

  /* ---------- B ---------- */
  console.log('');
  console.log('--- B. 人类流程模拟 (human=0, seeds 101..105) ---');
  let bPass = 0;
  for (const seed of [101, 102, 103, 104, 105]) {
    const r = runHuman(seed);
    merge(r.rec, seed);
    const clean = !r.rec.crash && r.over && !!r.winner && r.rec.names().length === 0;
    if (clean) bPass++;
    console.log(`[B seed=${seed}] over=${r.over} winner=${r.winner} turns=${r.turns} round=${r.round} 人类行动=${r.hActs} | ${r.rec.summary()}`);
  }
  console.log(`B 通过: ${bPass}/5`);

  /* ---------- C ---------- */
  console.log('');
  console.log('--- C. 定向单测 ---');
  const cTests = [testC1(), testC2(), testC3(), testC4(), testC5(), testC6()];
  let cPass = 0;
  for (const c of cTests) {
    const ok = !c.crash && c.fails.length === 0;
    if (ok) cPass++;
    console.log(`[${c.name}] ${c.crash ? 'CRASH' : (ok ? 'PASS' : 'FAIL')}`);
    for (const f of c.fails) console.log(`    ✗ ${f}`);
    if (c.crash) console.log('    ' + c.crash);
  }
  console.log(`C 通过: ${cPass}/${cTests.length}`);

  /* ---------- 失败详情汇总 ---------- */
  console.log('');
  console.log('--- 断言失败详情汇总 (每类至多5条现场) ---');
  const gk = Object.keys(G.counts);
  if (!gk.length) console.log('(无任何断言失败)');
  else {
    for (const k of gk) {
      console.log(`◆ ${k}  总次数=${G.counts[k]}`);
      for (const s of G.samples[k]) console.log(`    ${s}`);
    }
  }

  /* ---------- 牌种审计 ---------- */
  const ka = Object.keys(G.keyAudit).filter(k => G.keyAudit[k] !== 0).sort((a, b) => G.keyAudit[b] - G.keyAudit[a]);
  if (ka.length) {
    console.log('');
    console.log('--- 牌种审计 (A 40局结束态合计: 现存数-配置数; 正=增生 负=流失; 进化改写有噪声) ---');
    console.log(ka.map(k => `${k}:${G.keyAudit[k] > 0 ? '+' : ''}${G.keyAudit[k]}`).join('  '));
  }

  console.log('');
  console.log(`=== 汇总: A通过=${aPass}/40 (不含120守恒=${aPassNo120}/40) | B通过=${bPass}/5 | C通过=${cPass}/${cTests.length} | 耗时=${((Date.now() - t0) / 1000).toFixed(1)}s ===`);
}

main();
