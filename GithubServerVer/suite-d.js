/* ============================================================================
 * OI杀 v4.0 多人化引擎测试 (v4-web/suite-d.js) — 套件 D (P2b)
 * 覆盖 P2a 多人化改造报告(p2a-多人化报告.md)定义的 8 组多人不变量 (D01..D08):
 *   D01 多人类创建: humans数组/humanSet/isHuman/g.human 首人类 + 58键导出契约
 *   D02 提示多槽位: AOE 2人类目标并存/座次序插入/g.pending别名===首条/
 *       乱序先答第二条不clobber第一条/全部解析后 map 空且 promptCount()===0
 *   D03 无泄漏不变量: 2人类+4AI 完整对局, 每阶段后提示层清空、被解析条目无残留、120守恒
 *   D04 超时语义: timeoutPrompt 各类型默认(dodge=否/counter=放弃/aoeResp=否/harvest=弃权),
 *       条目移除、手牌/牌堆守恒
 *   D05 duePrompts: 过期提示召回/未到期为空/恰至deadline计入 + evo 45s + 无效id拒绝
 *   D06 drive 全流程: 1人类+5AI 跑到终局, 状态序列以 {status:'over',winner} 收尾, 无泄漏, 120守恒
 *   D07 AI补齐: 2人类+4AI, AI座次 isHuman=false, aiTurn 执行时不触碰人类提示
 *   D08 respondX promptId 精确性: 同型双提示, 显式id只解析该条目; pid/id错配与无效id被拒且不消费
 * 只读调用 ./game.js 导出 API, 不修改引擎源码(58键导出不变)。
 * 用法: 在 v4-web 目录执行  node suite-d.js
 * ==========================================================================*/
'use strict';

const O = require('./game.js');

const NAMES6 = ['主', '甲', '乙', '丙', '丁', '戊'];
const SPEC_DECK_SIZE = 120;   // 规格牌堆(README/注释)声称 120 张
const NEUTRAL_PROF = { id: 'none', name: '测试', plain: '测试', hp: 4, domain: null, subDomain: null, passive: '', awaken: '' };

/* ================= 工具(与 test.js / test-extra.js 同风格) ================= */
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

function mk(id, key, suit) { return { id: id, key: key, suit: suit || 'heart', num: 7 }; }

function discHas(g, id) { return g.discard.some(c => c && c.id === id); }

// 清空玩家控制面, 便于逐项构造最小局面(与 test-extra.js stripPlayer 同风格)
function stripPlayer(p) {
  p.hand = []; p.weapon = null; p.armor = null; p.units = []; p.delayArea = [];
  p.prof = Object.assign({}, NEUTRAL_PROF);
  p.handLimitBonus = 0; p.awaken = false; p.dmgBonus = 0; p.akioiDmg = 0;
  p.kachangFlag = false; p.baolingBonus = 0; p.teachBonus = false;
  p.usedSeal = false; p.usedMentor = false; p.usedDianji = false; p.usedRetire = false;
  p.depression = 0; p.yaxianUsed = false; p.funShield = false; p.coffeeSaveUsedThisTurn = false;
  p.blockTimes = 0; p.blockedThisTurn = false; p.kills = 0; p.killedLord = false;
  p.coffee = false; p.coffeeDmg = 1; p.canAttack = true; p.skipPlay = false; p.skipDraw = false;
}

// 构造最小受控对局(支持多人类): 建局->setup->清空控制面; 默认全AI(human=99)、第2轮(避开主公首轮免伤)
function fresh(n, opts) {
  opts = opts || {};
  const humans = opts.humans !== undefined ? opts.humans
    : [opts.human !== undefined ? opts.human : 99];
  const g = O.createGame({ seed: opts.seed || 12345, humans });
  O.setup(g, NAMES6.slice(0, n));
  for (const p of g.players) stripPlayer(p);
  for (const p of g.players) p.mp = p.mpMax;
  g.round = opts.round !== undefined ? opts.round : 2;
  return g;
}

// 第一个未决提示(Map 插入序 = 座次/事件序; g.pending 别名同源)
function firstPrompt(g) { for (const e of g.prompts.values()) return e; return null; }

// 全部未决提示(插入序快照)
function promptList(g) { const out = []; for (const e of g.prompts.values()) out.push(e); return out; }

/* ================= 用例运行器 ================= */
const DSTATS = { asserts: 0, failedAsserts: 0, passed: 0, failed: 0 };
function tc(name, fn) {
  const c = {
    name, fails: [], notes: [], crash: null,
    ok(cond, msg) {
      DSTATS.asserts++;
      if (!cond) { this.fails.push(msg); DSTATS.failedAsserts++; }
    },
    note(msg) { this.notes.push(msg); },
  };
  return (async () => {
    try { await fn(c); } catch (e) { c.crash = String((e && e.stack) || e); }
    return c;
  })();
}

/* ================= D01 多人类创建 ================= */
async function D01_creation(c) {
  const g = O.createGame({ seed: 1001, humans: [0, 2, 4] });
  O.setup(g, NAMES6);
  c.ok(g.humanSet instanceof Set, 'humanSet 应为 Set 实例');
  c.ok(g.humanSet.size === 3, `humanSet 应恰含3人 (size=${g.humanSet.size})`);
  for (const h of [0, 2, 4]) c.ok(g.humanSet.has(h) && g.isHuman(h) === true, `isHuman(${h}) 应为 true`);
  for (const a of [1, 3, 5]) c.ok(!g.humanSet.has(a) && g.isHuman(a) === false, `isHuman(${a}) 应为 false`);
  c.ok(g.human === 0, `g.human 应为第一个人类 pid (=${g.human})`);
  c.ok(g.prompts instanceof Map && g.prompts.size === 0 && O.promptCount(g) === 0 && g.pending === null,
    '新局提示层应为空 (prompts=Map, size=0, promptCount=0, pending=null)');
  // 单值 human 兼容(旧签名)
  const g2 = O.createGame({ seed: 1002, human: 3 });
  c.ok(g2.humanSet.size === 1 && g2.humanSet.has(3) && g2.human === 3 && g2.isHuman(3) && !g2.isHuman(0),
    'human:3 → humanSet={3}, g.human=3');
  // 无参默认 0(与旧 human ?? 0 一致)
  const g3 = O.createGame({ seed: 1003 });
  c.ok(g3.humanSet.size === 1 && g3.humanSet.has(0) && g3.human === 0, '无参默认 human=0');
  // humans 数组过滤 null/undefined
  const g4 = O.createGame({ seed: 1004, humans: [null, 2, undefined] });
  c.ok(g4.humanSet.size === 1 && g4.humanSet.has(2) && g4.human === 2, 'humans 数组应过滤 null/undefined');
  // 导出键契约: 58 键 = 原54 + drive/timeoutPrompt/duePrompts/promptCount
  const keys = Object.keys(O).sort();
  c.ok(keys.length === 58, `导出键应为58 (=${keys.length})`);
  for (const k of ['drive', 'timeoutPrompt', 'duePrompts', 'promptCount'])
    c.ok(typeof O[k] === 'function', `新键 ${k} 应为函数`);
}

/* ================= D02 提示多槽位(AOE 2人类目标并存) ================= */
async function D02_multiSlot(c) {
  const g = fresh(6, { humans: [0, 2] });
  const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2], p3 = g.players[3], p4 = g.players[4], p5 = g.players[5];
  p5.hand = [mk(2001, 'aoeAtk', 'club')];
  p5.mp = 10;
  g.turn = 5;
  const baseline = totalCards(g);
  const hp0 = p0.hp, hp1 = p1.hp, hp2 = p2.hp, hp3 = p3.hp, hp4 = p4.hp;
  const r = O.playCard(g, 5, 0); // AOE: 从使用者下家起 aoeOrder=[0,1,2,3,4]
  c.ok(r.ok === true && r.result === 'pending', `AOE 应挂起 (r=${JSON.stringify(r)})`);
  c.ok(O.promptCount(g) === 2, `应并存2条提示 (=${O.promptCount(g)})`);
  const list = promptList(g);
  c.ok(list.length === 2 && list[0].pid === 0 && list[1].pid === 2,
    `座次序插入 [0,2] (实际=${list.map(e => e.pid).join(',')})`);
  for (const e of list) {
    c.ok(e.type === 'aoeResp' && typeof e.id === 'string' && e.deadlineMs === 10000 && typeof e.createdAt === 'number',
      `条目形状完整 id=${e.id} type=${e.type} pid=${e.pid} deadlineMs=${e.deadlineMs}`);
  }
  const e0 = list[0], e2 = list[1];
  c.ok(g.pending && g.pending.id === e0.id, 'g.pending 别名 === 第一条(pid0)');
  // 乱序: 先解析第二条(pid2) → 不 clobber 第一条
  const rr = O.respondAoeResp(g, 2, false, e2.id);
  c.ok(rr.ok === true && rr.result === 'pending-group', `先答pid2→组内仍有未决 (rr=${JSON.stringify(rr)})`);
  c.ok(!g.prompts.has(e2.id) && g.prompts.has(e0.id), '只移除pid2条目, pid0条目仍在');
  c.ok(g.pending && g.pending.id === e0.id, '别名仍指pid0条目(未被clobber)');
  c.ok(p2.hp === hp2 - 1 && p0.hp === hp0, `仅pid2受AOE伤 (hp2=${p2.hp}, hp0=${p0.hp})`);
  // 再解析第一条(pid0) → 全部清空 + AI目标续算
  const rr2 = O.respondAoeResp(g, 0, false, e0.id);
  c.ok(rr2.ok === true, `答pid0成功 (rr2=${JSON.stringify(rr2)})`);
  c.ok(O.promptCount(g) === 0 && g.pending === null, '全部解析后 map 空、别名 null');
  c.ok(p0.hp === hp0 - 1, `pid0 受AOE伤 (hp=${p0.hp})`);
  c.ok(p1.hp === hp1 - 1 && p3.hp === hp3 - 1 && p4.hp === hp4 - 1, 'AI受害者按座次序续算各受1伤');
  c.ok(p5.hand.length === 0 && discHas(g, 2001), 'AOE牌已消耗进弃牌堆');
  c.ok(totalCards(g) === baseline, `牌张守恒 (${totalCards(g)}===${baseline})`);
}

/* ================= D03 无泄漏不变量(2人类+4AI 完整对局) ================= */
async function D03_noLeak(c) {
  const g = O.createGame({ seed: 31337, humans: [0, 3] });
  O.setup(g, NAMES6);
  O.startTurn(g, 0);
  const baseline = totalCards(g);
  c.ok(baseline === SPEC_DECK_SIZE, `开局守恒120 (=${baseline})`);
  let steps = 0, humanTurns = 0, resolved = 0;
  const leaks = [];
  while (!g.over && steps < 3000) {
    const pid = g.turn;
    O.judgePhase(g, pid);
    O.drawPhase(g, pid);
    if (!g.over) {
      if (g.isHuman(pid)) { humanTurns++; O.discardPhase(g, pid); O.endTurn(g, pid); }
      else O.aiTurn(g, pid);
      steps++;
    }
    // 每个阶段后: 解析全部挂起提示(超时默认), 逐条检查无残留
    let guard = 0;
    while (g.pending && guard++ < 200) {
      const pr = g.pending;
      if (!g.isHuman(pr.pid)) leaks.push(`ai-prompt round=${g.round} id=${pr.id} pid=${pr.pid}`);
      O.timeoutPrompt(g, pr.id);
      if (g.prompts.has(pr.id)) leaks.push(`resolved-survives round=${g.round} id=${pr.id}`);
      resolved++;
    }
    if (O.promptCount(g) !== 0 || g.pending !== null)
      leaks.push(`at-rest round=${g.round} size=${O.promptCount(g)} pending=${g.pending && g.pending.id}`);
    // 守恒抽查(每25步)
    if (steps % 25 === 0) {
      const t = totalCards(g);
      if (t !== baseline) leaks.push(`card-drift round=${g.round} steps=${steps} total=${t}`);
    }
  }
  c.ok(g.over === true, `3000回合内终局 (over=${g.over}, round=${g.round})`);
  c.ok(!!g.winner, `winner 非空 (=${g.winner})`);
  c.ok(O.promptCount(g) === 0 && g.pending === null, '终局无提示残留');
  c.ok(totalCards(g) === baseline, `终局守恒120 (=${totalCards(g)})`);
  c.ok(leaks.length === 0, `全程无泄漏违规 (${leaks.length ? leaks.join('; ') : '无'})`);
  c.ok(humanTurns > 0 && resolved > 0, `两人类均有回合且AI产生过人类提示 (humanTurns=${humanTurns}, resolved=${resolved})`);
  c.note(`D03: steps=${steps} round=${g.round} humanTurns=${humanTurns} 超时解析=${resolved} winner=${g.winner}`);
}

/* ================= D04 超时语义(timeoutPrompt 各类型默认) ================= */
async function D04_timeout(c) {
  // dodge → 否(不出WA): 受1伤, WA保留, 不扣灵感
  {
    const g = fresh(3, { humans: [0] });
    const p0 = g.players[0], p1 = g.players[1];
    p1.hand = [mk(2101, 'attack', 'spade')]; p1.mp = 5;
    p0.hand = [mk(2102, 'dodge', 'club')]; p0.mp = 5;
    g.turn = 1;
    const baseline = totalCards(g);
    const hp0 = p0.hp, mp0 = p0.mp;
    const r = O.playCard(g, 1, 0, 0);
    c.ok(r.ok === true && g.pending && g.pending.type === 'dodge', `应挂起dodge (r=${JSON.stringify(r)})`);
    const id = g.pending.id;
    const tr = O.timeoutPrompt(g, id);
    c.ok(tr.ok === true && tr.result === 'hit', `dodge超时默认=否→受击 (tr=${JSON.stringify(tr)})`);
    c.ok(p0.hp === hp0 - 1, `目标受1伤 (hp=${p0.hp})`);
    c.ok(p0.hand.some(x => x.id === 2102), 'WA保留在手(未代出)');
    c.ok(p0.mp === mp0, `不扣灵感 (mp=${p0.mp})`);
    c.ok(!g.prompts.has(id) && O.promptCount(g) === 0 && g.pending === null, '提示条目已移除');
    c.ok(totalCards(g) === baseline, `牌张守恒 (${totalCards(g)}===${baseline})`);
  }
  // counter → 放弃反制(decline): 原锦囊生效, 特判保留, 不扣灵感
  {
    const g = fresh(3, { humans: [0] });
    const p0 = g.players[0], p1 = g.players[1];
    p0.hand = [mk(2103, 'counter', 'spade')]; p0.mp = 5;
    p1.hand = [mk(2104, 'pierce', 'club')]; p1.mp = 5;
    g.turn = 1;
    const baseline = totalCards(g);
    const hp0 = p0.hp, mp0 = p0.mp;
    const r = O.playCard(g, 1, 0, 0);
    c.ok(r.ok === true && g.pending && g.pending.type === 'counter', `应挂起counter (r=${JSON.stringify(r)})`);
    const id = g.pending.id;
    const tr = O.timeoutPrompt(g, id);
    c.ok(tr.ok === true && tr.countered === false, `counter超时默认=放弃反制 (tr=${JSON.stringify(tr)})`);
    c.ok(p0.hp === hp0 - 1, `放弃反制后【卡评测机】生效受1伤 (hp=${p0.hp})`);
    c.ok(p0.hand.some(x => x.id === 2103) && p0.mp === mp0, '特判保留且不扣灵感');
    c.ok(!g.prompts.has(id) && O.promptCount(g) === 0 && g.pending === null, '提示条目已移除');
    c.ok(totalCards(g) === baseline, `牌张守恒 (${totalCards(g)}===${baseline})`);
  }
  // aoeResp → 否: 受1伤
  {
    const g = fresh(6, { humans: [0] });
    const p0 = g.players[0], p5 = g.players[5];
    p5.hand = [mk(2105, 'aoeAtk', 'club')]; p5.mp = 10;
    g.turn = 5;
    const baseline = totalCards(g);
    const hp0 = p0.hp;
    const r = O.playCard(g, 5, 0);
    c.ok(r.ok === true && g.pending && g.pending.type === 'aoeResp' && g.pending.pid === 0,
      `应挂起aoeResp (r=${JSON.stringify(r)})`);
    const id = g.pending.id;
    const tr = O.timeoutPrompt(g, id);
    c.ok(tr.ok === true, `aoeResp超时默认=否 (tr=${JSON.stringify(tr)})`);
    c.ok(p0.hp === hp0 - 1, `受1伤 (hp=${p0.hp})`);
    c.ok(!g.prompts.has(id) && O.promptCount(g) === 0 && g.pending === null, '提示条目已移除');
    c.ok(totalCards(g) === baseline, `牌张守恒 (${totalCards(g)}===${baseline})`);
  }
  // harvest → 弃权(P2a 文档化默认: 不选牌), 其余AI选牌者照常, 牌张守恒
  {
    const g = fresh(6, { humans: [0] });
    const p0 = g.players[0], p5 = g.players[5];
    p5.hand = [mk(2106, 'harvest', 'heart')]; p5.mp = 10;
    g.turn = 5;
    const baseline = totalCards(g);
    const hand0 = p0.hand.length;
    const r = O.playCard(g, 5, 0);
    c.ok(r.ok === true && g.pending && g.pending.type === 'harvest' && g.pending.pid === 0,
      `应挂起harvest (r=${JSON.stringify(r)}, pd=${g.pending && g.pending.type})`);
    const id = g.pending.id;
    const tr = O.timeoutPrompt(g, id);
    c.ok(tr.ok === true, `harvest超时默认=弃权 (tr=${JSON.stringify(tr)})`);
    c.ok(p0.hand.length === hand0, `弃权未取牌 (hand=${p0.hand.length})`);
    c.ok(!g.prompts.has(id) && O.promptCount(g) === 0 && g.pending === null, '提示条目已移除');
    c.ok(totalCards(g) === baseline, `牌张守恒 (${totalCards(g)}===${baseline})`);
  }
}

/* ================= D05 duePrompts 截止时间语义 ================= */
async function D05_due(c) {
  // 响应类提示: deadlineMs=10000; 新鲜→未到期; 拨回createdAt→到期; 恰至deadline→计入
  {
    const g = fresh(3, { humans: [0] });
    const p0 = g.players[0], p1 = g.players[1];
    p1.hand = [mk(2201, 'attack', 'spade')]; p1.mp = 5;
    p0.hand = [mk(2202, 'dodge', 'club')];
    g.turn = 1;
    O.playCard(g, 1, 0, 0);
    const e = g.pending;
    c.ok(e && e.type === 'dodge' && e.deadlineMs === 10000 && typeof e.createdAt === 'number',
      `dodge提示 deadlineMs=10000 (pd=${JSON.stringify(e && { type: e.type, deadlineMs: e.deadlineMs })})`);
    c.ok(O.duePrompts(g, Date.now()).length === 0, '新鲜提示未到期 → duePrompts 为空');
    e.createdAt = Date.now() - 15000; // 模拟过期
    const due = O.duePrompts(g, Date.now());
    c.ok(due.length === 1 && due[0].id === e.id, '过期提示 → duePrompts 返回该条目');
    c.ok(O.duePrompts(g, e.createdAt + 9999).length === 0, 'now-createdAt < deadlineMs 不计入');
    c.ok(O.duePrompts(g, e.createdAt + 10000).length === 1, 'now-createdAt === deadlineMs 计入');
    c.ok(O.duePrompts(g, e.createdAt + 10001).length === 1, 'now-createdAt > deadlineMs 计入');
    // 无效 id: timeoutPrompt 拒绝
    const bad = O.timeoutPrompt(g, 'pd-不存在');
    c.ok(bad.ok === false, `不存在的promptId → ok:false (bad=${JSON.stringify(bad)})`);
    // 清理: 正常解析过期提示(注意: timeoutPrompt 不校验deadline, 超时权威在服务器)
    // 签名 respondDodge(g,pid,yes,helperId,promptId): 显式 promptId 须置于第5参
    const hp0 = p0.hp;
    const rr = O.respondDodge(g, 0, false, undefined, e.id);
    c.ok(rr.ok === true && p0.hp === hp0 - 1 && O.promptCount(g) === 0, '清理: 解析过期dodge提示后无残留');
  }
  // evo 提示: 回合尾选择类 deadlineMs=45000; timeout → declined(放弃进化)
  {
    const g = fresh(3, { humans: [0] });
    const p0 = g.players[0];
    p0.hand = [mk(2203, 'attack', 'spade')];
    g.pendingEvo[0] = ['attack'];
    g.turn = 0;
    O.endTurn(g, 0);
    const e = g.pending;
    c.ok(e && e.type === 'evo' && e.pid === 0 && e.deadlineMs === 45000,
      `evo提示 deadlineMs=45000 (pd=${JSON.stringify(e && { type: e.type, deadlineMs: e.deadlineMs })})`);
    c.ok(g.evoWait && g.evoWait.pid === 0, 'evoWait 兼容字段双写仍在');
    const tr = O.timeoutPrompt(g, e.id);
    c.ok(tr.ok === true && tr.result === 'declined', `evo超时默认=放弃进化 (tr=${JSON.stringify(tr)})`);
    c.ok(g.evoWait === null && p0.hand.some(x => x.id === 2203 && x.key === 'attack'), '放弃进化: evoWait清空且牌未进化');
    c.ok(O.promptCount(g) === 0 && g.pending === null, '提示条目已移除');
  }
}

/* ================= D06 drive 全流程(1人类+5AI) ================= */
async function D06_drive(c) {
  const g = O.createGame({ seed: 707001, humans: [0] });
  O.setup(g, NAMES6);
  O.startTurn(g, 0);
  const baseline = totalCards(g);
  c.ok(baseline === SPEC_DECK_SIZE, `开局守恒120 (=${baseline})`);
  const statuses = [];
  const promptEvents = [];
  let onStateCalls = 0, onPromptCalls = 0, onEventCalls = 0;
  let guard = 0;
  while (!g.over && guard++ < 5000) {
    const r = await O.drive(g, {
      thinkMs: 0,
      onState: () => { onStateCalls++; },
      onPrompt: (gg, pr) => { onPromptCalls++; promptEvents.push({ id: pr.id, pid: pr.pid, type: pr.type }); },
      onEvent: () => { onEventCalls++; },
    });
    statuses.push(r.status);
    if (r.status === 'prompt') {
      const cur = g.pending;
      c.ok(!!r.promptId && cur && cur.id === r.promptId && g.isHuman(r.pid),
        `prompt状态应携带promptId且pid为人类 (r=${JSON.stringify(r)}, cur=${cur && cur.id})`);
      // 超时默认解析该提示 + 同槽其余提示, 逐条检查无残留
      let d = 0;
      while (g.pending && d++ < 100) {
        const pr = g.pending;
        O.timeoutPrompt(g, pr.id);
        if (g.prompts.has(pr.id)) c.ok(false, `解析后提示残留 round=${g.round} id=${pr.id}`);
      }
      c.ok(O.promptCount(g) === 0, `提示解析后槽清空 (round=${g.round})`);
    } else if (r.status === 'human-turn') {
      c.ok(r.pid === 0 && g.isHuman(r.pid), `human-turn 应为pid0 (r=${JSON.stringify(r)})`);
      O.discardPhase(g, r.pid);
      O.endTurn(g, r.pid);
    } else if (r.status === 'over') {
      break;
    } else if (r.status === 'cap') {
      break;
    }
  }
  // g.over 若在外部 endTurn/timeoutPrompt 中置位, 再 drive 一次拿到终局状态
  if (g.over && statuses[statuses.length - 1] !== 'over') {
    const r = await O.drive(g, { thinkMs: 0 });
    statuses.push(r.status);
  }
  c.ok(g.over === true && !!g.winner, `终局 over=true 且 winner 非空 (winner=${g.winner})`);
  c.ok(statuses[statuses.length - 1] === 'over', `状态序列以 over 收尾 (last=${statuses[statuses.length - 1]})`);
  c.ok(!statuses.includes('cap'), '未触达 drive 步进上限(cap)');
  c.ok(statuses[0] === 'human-turn', `首状态应为 human-turn (=${statuses[0]})`);
  c.ok(onStateCalls > 0, `onState 被调用 (${onStateCalls}次)`);
  c.ok(onEventCalls > 0, `onEvent 被调用 (${onEventCalls}次)`);
  c.ok(onPromptCalls > 0 && onPromptCalls === promptEvents.length, `onPrompt 被调用且与提示数一致 (${onPromptCalls})`);
  for (const pe of promptEvents) c.ok(pe.pid === 0, `所有提示均指向人类0 (pe=${JSON.stringify(pe)})`);
  c.ok(O.promptCount(g) === 0 && g.pending === null, '终局无提示泄漏');
  c.ok(totalCards(g) === baseline, `终局守恒120 (=${totalCards(g)})`);
  c.note(`D06: statuses=${statuses.join('→')}; onState=${onStateCalls} onPrompt=${onPromptCalls} onEvent=${onEventCalls} round=${g.round}`);
}

/* ================= D07 AI补齐(2人类+4AI) ================= */
async function D07_aiFill(c) {
  const g = O.createGame({ seed: 606001, humans: [0, 3] });
  O.setup(g, NAMES6);
  c.ok(g.humanSet.size === 2 && g.human === 0, `2人类开局 (human=${g.human})`);
  for (let i = 0; i < 6; i++) c.ok(g.isHuman(i) === (i === 0 || i === 3), `isHuman(${i}) 应为 ${i === 0 || i === 3}`);
  // AI 座次上执行 aiTurn: 不触碰人类提示, 回合照常推进
  const g2 = fresh(6, { humans: [0, 3] });
  const p0 = g2.players[0], p1 = g2.players[1];
  p1.hand = [mk(2301, 'attack', 'spade')]; p1.mp = 5;
  g2.turn = 1;
  const hp0 = p0.hp;
  const r = O.playCard(g2, 1, 0, 0);
  c.ok(r.ok === true && g2.pending && g2.pending.type === 'dodge' && g2.pending.pid === 0,
    `AI攻击人类应挂起dodge (r=${JSON.stringify(r)})`);
  const id0 = g2.pending.id;
  c.ok(O.promptCount(g2) === 1, `挂起1条提示 (=${O.promptCount(g2)})`);
  O.aiTurn(g2, 2);
  c.ok(O.promptCount(g2) === 1 && g2.prompts.has(id0), 'aiTurn(2) 未触碰人类提示');
  c.ok(g2.turn === 3, `AI回合轮转 2→3 (=${g2.turn})`);
  g2.turn = 4;
  O.judgePhase(g2, 4); O.drawPhase(g2, 4); O.aiTurn(g2, 4);
  c.ok(g2.prompts.has(id0), 'aiTurn(4) 亦未触碰人类提示');
  c.ok(p0.hp === hp0, '人类未被代答伤害');
  // 清理: 人类自行作答(显式 promptId 置于第5参)
  const rr = O.respondDodge(g2, 0, false, undefined, id0);
  c.ok(rr.ok === true && p0.hp === hp0 - 1 && O.promptCount(g2) === 0,
    `人类作答后正常结算 (rr=${JSON.stringify(rr)}, hp=${p0.hp}, count=${O.promptCount(g2)})`);
}

/* ================= D08 respondX promptId 精确性 ================= */
async function D08_promptId(c) {
  const g = fresh(6, { humans: [0, 2] });
  const p0 = g.players[0], p2 = g.players[2], p5 = g.players[5];
  p5.hand = [mk(2401, 'aoeAtk', 'club')]; p5.mp = 10;
  g.turn = 5;
  const hp0 = p0.hp, hp2 = p2.hp;
  const r = O.playCard(g, 5, 0);
  c.ok(r.ok === true && r.result === 'pending' && O.promptCount(g) === 2,
    `双人类AOE→2条同型提示 (r=${JSON.stringify(r)}, count=${O.promptCount(g)})`);
  const list = promptList(g);
  const e0 = list.find(e => e.pid === 0), e2 = list.find(e => e.pid === 2);
  c.ok(e0 && e2 && e0.type === 'aoeResp' && e2.type === 'aoeResp', '两条同型提示各属不同pid');
  // 错配/无效: pid0 用 pid2 的 id → 拒绝, 两条都不消费
  const bad1 = O.respondAoeResp(g, 0, false, e2.id);
  c.ok(bad1.ok === false, `pid与promptId错配应被拒 (bad1=${JSON.stringify(bad1)})`);
  const bad2 = O.respondAoeResp(g, 2, false, 'pd-404');
  c.ok(bad2.ok === false, `不存在的promptId应被拒 (bad2=${JSON.stringify(bad2)})`);
  c.ok(O.promptCount(g) === 2 && g.prompts.has(e0.id) && g.prompts.has(e2.id), '被拒应答不消费任何条目');
  // 显式 id 精确解析 pid2 那条
  const rr = O.respondAoeResp(g, 2, false, e2.id);
  c.ok(rr.ok === true, `显式promptId解析pid2成功 (rr=${JSON.stringify(rr)})`);
  c.ok(!g.prompts.has(e2.id) && g.prompts.has(e0.id), '只解析了pid2条目, pid0条目仍在');
  c.ok(g.pending && g.pending.id === e0.id, 'pending别名仍指pid0条目');
  c.ok(p2.hp === hp2 - 1 && p0.hp === hp0, `只有pid2受AOE伤 (hp2=${p2.hp}, hp0=${p0.hp})`);
  // 显式 id 精确解析 pid0 那条 → 全部清空
  const rr2 = O.respondAoeResp(g, 0, false, e0.id);
  c.ok(rr2.ok === true && O.promptCount(g) === 0 && g.pending === null, 'pid0解析后全部清空');
  c.ok(p0.hp === hp0 - 1, `pid0随后受AOE伤 (hp=${p0.hp})`);
}

/* ================= 汇总输出 ================= */
async function main() {
  const t0 = Date.now();
  console.log('====================================================');
  console.log(' OI杀 v4.0 多人化引擎测试 (v4-web/suite-d.js) — 套件 D (P2b)');
  console.log(' 覆盖 P2a 多人化报告: 多人类创建/提示多槽/无泄漏/超时/duePrompts/drive/AI补齐/promptId精度');
  console.log('====================================================');
  console.log('');

  const tests = [
    ['D01-multi-human-creation', D01_creation],
    ['D02-prompt-multislot', D02_multiSlot],
    ['D03-no-leak-full-game', D03_noLeak],
    ['D04-timeout-semantics', D04_timeout],
    ['D05-duePrompts-deadline', D05_due],
    ['D06-drive-full-game', D06_drive],
    ['D07-ai-fill-correctness', D07_aiFill],
    ['D08-respondX-promptId-precision', D08_promptId],
  ];

  const results = [];
  for (const [name, fn] of tests) {
    const r = await tc(name, fn);
    results.push(r);
    const ok = !r.crash && r.fails.length === 0;
    if (ok) DSTATS.passed++; else DSTATS.failed++;
    console.log(`[${name}] ${r.crash ? 'CRASH' : (ok ? 'PASS' : 'FAIL')}`);
    for (const f of r.fails) console.log(`    ✗ ${f}`);
    if (r.crash) console.log('    ' + r.crash);
    for (const n of r.notes) console.log('    ◆ ' + n);
  }

  console.log('');
  console.log(`=== 汇总: D通过=${DSTATS.passed}/${results.length} | 断言=${DSTATS.asserts} | 断言失败=${DSTATS.failedAsserts} | 耗时=${((Date.now() - t0) / 1000).toFixed(1)}s ===`);
  process.exitCode = DSTATS.failed > 0 ? 1 : 0;
}

main().catch(e => { console.error('套件D运行异常: ' + String((e && e.stack) || e)); process.exitCode = 1; });
