/* ============================================================================
 * OI杀 v4.0 · src/ai/self-test.js — AI 决策模块自测(P3a 交付验证)
 * 运行: node src/ai/self-test.js (workdir 任意; 路径按模块相对解析)
 * 范围:
 *   S1 难度表形状 + 延迟采样区间
 *   S2 身份信念(主公公开/挡刀=忠臣/颓废=内奸/概率和=1)
 *   S3 打分器有限性 + 构造场景"明显更优目标"排序
 *   S4 四身份策略差异(反贼集火/忠臣护主/内奸囤牌/主公自保)
 *   S5 全身份座位 chooseAction 合法性(描述符经 applyAction 全 ok)
 *   S6 chooseAction 纯性(不修改状态)
 *   S7 响应决策(闪/特判/AOE/题解大会/举报/祖安/冷数据/追刀/转嫁同意)
 *   S8 完整全 AI 对局(heuristics 驱动)跑到终局
 * 只读引擎: createGame/setup/各动作 API 均以现有引擎为准, 不改引擎文件。
 * ==========================================================================*/
'use strict';
const API = require('../../game.js');
const DIFF = require('./difficulty.js');
const SC = require('./scorer.js');
const POL = require('./identity-policy.js');
const HEU = require('./heuristics.js');

const NAMES6 = ['主', '忠', '反1', '反2', '反3', '内'];
let pass = 0, fail = 0;
const fails = [];
function t(name, cond, detail) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; fails.push(name + (detail ? ' | ' + detail : '')); console.log('  ✗ ' + name + (detail ? ' | ' + detail : '')); }
}
function newGame(seed, names) {
  const g = API.createGame({ seed, human: 99 });
  API.setup(g, names || NAMES6);
  return g;
}
function mkCard(key, id) { return { key, suit: 'spade', num: 7, id }; }
function pidOf(g, idn) { return g.players.find(p => p.identity === idn).id; }

console.log('=== P3a AI 决策模块自测 ===\n');

/* ---------- S1 难度表 ---------- */
console.log('S1 难度表');
for (const k of ['easy', 'normal', 'hard']) {
  const d = DIFF.DIFFICULTY[k];
  t('DIFFICULTY.' + k + ' 存在', !!d && !!d.label);
  if (!d) continue;
  t(k + '.thinkMs 区间合法', Array.isArray(d.thinkMs) && d.thinkMs.length === 2 && d.thinkMs[0] > 0 && d.thinkMs[1] >= d.thinkMs[0]);
  t(k + '.errPct∈[0,1]', d.errPct >= 0 && d.errPct <= 1);
  t(k + '.randomPickPct∈[0,1]', d.randomPickPct >= 0 && d.randomPickPct <= 1);
  t(k + '.retentionBias∈[0,1]', d.retentionBias >= 0 && d.retentionBias <= 1);
  t(k + '.dodgeHpThreshold∈[1,6]', d.dodgeHpThreshold >= 1 && d.dodgeHpThreshold <= 6);
  t(k + '.evDepth≥0 整数', Number.isInteger(d.evDepth) && d.evDepth >= 0);
}
{
  const r0 = () => 0, r1 = () => 0.999999;
  const lo = DIFF.thinkDelay('easy', r0), hi = DIFF.thinkDelay('easy', r1);
  t('thinkDelay easy ∈ [800,2500]', lo >= 800 && hi <= 2500);
  const hlo = DIFF.thinkDelay('hard', r0), hhi = DIFF.thinkDelay('hard', r1);
  t('thinkDelay hard ∈ [800,1500]', hlo >= 800 && hhi <= 1500);
  t('thinkDelay 绝不为0(不瞬发)', lo > 0 && hi > 0);
  t('get 未知难度回落 normal', DIFF.get('???') === DIFF.DIFFICULTY.normal);
}

/* ---------- S2 身份信念 ---------- */
console.log('S2 身份信念');
{
  const g = newGame(11);
  const lord = pidOf(g, 'lord');
  const b1 = SC.identityBelief(g, 2, lord);
  t('主公信念=lord 1.0', Math.abs(b1.lord - 1) < 1e-9);
  const aliveIds = g.players.filter(p => !p.dead).map(p => p.id);
  let sumOk = true;
  for (const vid of aliveIds.slice(0, 3)) {
    for (const tid of aliveIds) {
      const b = SC.identityBelief(g, vid, tid);
      const s = b.lord + b.loyal + b.rebel + b.traitor;
      if (Math.abs(s - 1) > 1e-6 || !isFinite(s)) sumOk = false;
    }
  }
  t('存活目标信念和为1且有限', sumOk);
  /* 挡刀=忠臣铁证 */
  const some = g.players.find(p => !p.dead && p.identity !== 'lord' && p.id !== 2);
  some.blockTimes = 1;
  const b2 = SC.identityBelief(g, 2, some.id);
  t('挡刀计数→忠臣信念最高', b2.loyal >= 0.9, JSON.stringify(b2));
  /* 颓废标记=内奸铁证 */
  const other = g.players.find(p => !p.dead && p.identity !== 'lord' && p.id !== 2 && p.id !== some.id);
  other.blockTimes = 0;
  g.log.push({ t: 1, txt: other.name + ' 消耗【颓废标记】回1血(剩0枚)', cls: 'act' });
  const b3 = SC.identityBelief(g, 2, other.id);
  t('颓废日志→内奸信念最高', b3.traitor >= 0.9, JSON.stringify(b3));
}

/* ---------- S3 打分器 ---------- */
console.log('S3 打分器');
{
  const g = newGame(12);
  let finite = true;
  for (const p of g.players) {
    for (let i = 0; i < p.hand.length; i++) {
      if (!isFinite(SC.scoreCard(g, p.id, i))) finite = false;
    }
    if (!isFinite(SC.scoreHand(g, p.id))) finite = false;
  }
  t('scoreCard/scoreHand 全部有限', finite);
  for (const p of g.players) for (const q of g.players) {
    if (q.id !== p.id && !isFinite(SC.scoreTarget(g, p.id, q.id))) finite = false;
  }
  t('scoreTarget 全部有限', finite);
  /* 构造: 反贼视角 —— 残血带武/觉醒/守擂的主公 vs 满血白板内奸 */
  const lord = pidOf(g, 'lord');
  const rebel = pidOf(g, 'rebel');
  const traitor = pidOf(g, 'traitor');
  const L = g.players[lord], R = g.players[rebel], Tr = g.players[traitor];
  L.hp = 2; L.weapon = mkCard('wQgj', 9001); L.awaken = true; L.units = [Object.assign(mkCard('uGuard', 9002), { ready: false })];
  Tr.hp = Tr.maxHp; Tr.weapon = null; Tr.armor = null; Tr.awaken = false; Tr.units = [];
  const sLord = SC.scoreTarget(g, rebel, lord);
  const sTrai = SC.scoreTarget(g, rebel, traitor);
  t('威胁分: 带武觉醒守擂主公 > 白板内奸', sLord > sTrai, 'lord=' + sLord + ' traitor=' + sTrai);
  L.hp = 1;
  const pLord = SC.attackPriority(g, rebel, lord);
  const pTrai = SC.attackPriority(g, rebel, traitor);
  t('攻击优先级: 1血主公 > 满血内奸', pLord > pTrai, 'lord=' + pLord + ' traitor=' + pTrai);
  const tl = SC.threatList(g, rebel);
  t('threatList 降序且含全体他人', tl.length === 5 && tl[0].threat >= tl[4].threat);
}

/* ---------- S4 身份策略 ---------- */
console.log('S4 身份策略');
{
  const g = newGame(13);
  const lord = pidOf(g, 'lord');
  const loyal = pidOf(g, 'loyal');
  const rebel = pidOf(g, 'rebel');
  const traitor = pidOf(g, 'traitor');
  const pl = POL.policyFor(g, lord);
  const po = POL.policyFor(g, loyal);
  const pr = POL.policyFor(g, rebel);
  const pt = POL.policyFor(g, traitor);
  t('反贼集火主公倾向 > 忠臣', pr.focusLord > po.focusLord, JSON.stringify([pr.focusLord, po.focusLord]));
  t('忠臣护主倾向 > 反贼', po.protectLord > pr.protectLord);
  t('内奸囤牌进单挑 > 反贼', pt.hoardForDuel > pr.hoardForDuel);
  t('主公自保 > 反贼', pl.selfPreserve > pr.selfPreserve);
  t('忠臣绝不攻击主公', po.attackPrio(lord) <= -90);
  t('内奸反贼存活时绝不杀主公', pt.attackPrio(lord) <= -90);
  const prLord = pr.attackPrio(lord), prLoy = pr.attackPrio(loyal);
  t('反贼攻击主公加成 > 打忠臣加成', prLord > prLoy, JSON.stringify([prLord, prLoy]));
  const jl = JSON.stringify([pl.weights, pl.aggression, pl.selfPreserve, pl.blindProbe]);
  const jr = JSON.stringify([pr.weights, pr.aggression, pr.selfPreserve, pr.blindProbe]);
  t('四身份策略整体互异', jl !== jr);
}

/* ---------- S5 chooseAction 合法性(全身份) ---------- */
console.log('S5 chooseAction 合法性');
{
  let acts = 0, bad = 0, badDetail = '';
  for (const seed of [101, 102, 103]) {
    const g = newGame(seed);
    for (const p of g.players.slice()) {
      if (p.dead) continue;
      g.turn = p.id;
      let acted = 0;
      for (let iter = 0; iter < 25 && acted < 12; iter++) {
        const desc = HEU.chooseAction(g, p.id, { difficulty: 'hard' });
        if (!desc || desc.kind === 'end') break;
        const r = HEU.applyAction(g, p.id, desc);
        if (!r || r.ok === false) {
          bad++;
          if (!badDetail) badDetail = 'seed=' + seed + ' pid=' + p.id + ' identity=' + p.identity + ' desc=' + JSON.stringify(desc) + ' why=' + (r && r.why);
          break;
        }
        acted++; acts++;
        if (g.pending) break;
      }
    }
  }
  t('全部描述符经引擎执行 ok(无非法动作)', bad === 0, badDetail);
  t('四身份座位均产生过合法动作', acts >= 12, 'acts=' + acts);
}

/* ---------- S6 chooseAction 纯性 ---------- */
console.log('S6 纯性');
{
  const g = newGame(14);
  g.turn = 1;
  const snapBefore = JSON.stringify(g.players.map(p => p.hand));
  HEU.chooseAction(g, 1, { difficulty: 'hard' });
  const snapAfter = JSON.stringify(g.players.map(p => p.hand));
  t('chooseAction 不修改状态', snapBefore === snapAfter);
  const idx = HEU.discardChoice(g, 1);
  t('discardChoice 未超限返回空', Array.isArray(idx) && idx.length === 0);
}

/* ---------- S7 响应决策 ---------- */
console.log('S7 响应决策');
{
  const g = newGame(15);
  const lord = pidOf(g, 'lord');
  const loyal = pidOf(g, 'loyal');
  const rebel = pidOf(g, 'rebel');
  /* 闪避: 低血有WA → 闪 */
  g.players[rebel].hand = [mkCard('dodge', 9101)];
  g.players[rebel].hp = 1;
  g.players[rebel].mp = 3;
  const d1 = HEU.chooseResponse(g, rebel, { type: 'dodge', pid: rebel, attacker: loyal, target: rebel, dmg: 1, ctx: {} }, { difficulty: 'hard' });
  t('低血有WA必闪', d1 && d1.kind === 'respondDodge' && d1.yes === true, JSON.stringify(d1));
  /* 高血无威胁 → 不闪(血量抬高到阈值之外) */
  g.players[rebel].hp = 6;
  const d2 = HEU.chooseResponse(g, rebel, { type: 'dodge', pid: rebel, attacker: loyal, target: rebel, dmg: 1, ctx: {} }, { difficulty: 'hard' });
  t('满血可留闪', d2 && d2.kind === 'respondDodge' && d2.yes === false, JSON.stringify(d2));
  /* 特判: 有害锦囊打我 → 特判 */
  g.players[rebel].hand = [mkCard('counter', 9102)];
  g.players[rebel].mp = 3;
  const c1 = HEU.chooseResponse(g, rebel, { type: 'counter', pid: rebel, victim: rebel, srcId: loyal, trickKey: 'pierce', ctx: { targetId: rebel } }, { difficulty: 'hard' });
  t('有害锦囊→特判', c1 && c1.kind === 'respondCounter' && c1.yes === true, JSON.stringify(c1));
  /* AOE: 低血有攻击 → 响应 */
  g.players[rebel].hand = [mkCard('attack', 9103)];
  g.players[rebel].hp = 1;
  const a1 = HEU.chooseResponse(g, rebel, { type: 'aoeResp', pid: rebel, victim: rebel, srcId: loyal, trickKey: 'aoeAtk', dmg: 1, ctx: {} }, { difficulty: 'hard' });
  t('低血有攻击响应AOE', a1 && a1.kind === 'respondAoeResp' && a1.yes === true, JSON.stringify(a1));
  /* 题解大会: 反贼选攻击 */
  const h1 = HEU.chooseResponse(g, rebel, { type: 'harvest', pid: rebel, victim: rebel, ctx: { cards: [mkCard('attack', 1), mkCard('dodge', 2)] } }, { difficulty: 'hard' });
  t('题解大会反贼选攻击', h1 && h1.kind === 'respondHarvest' && h1.choiceKey === 'attack', JSON.stringify(h1));
  /* 举报: 弃目标最值钱(heal>ub) */
  const rp = HEU.chooseResponse(g, rebel, { type: 'report', pid: rebel, victim: rebel, ctx: { targetId: loyal, cards: [mkCard('heal', 3), mkCard('ub', 4)] } }, { difficulty: 'hard' });
  t('举报弃价值最高(heal)', rp && rp.kind === 'respondReport' && rp.cardKey === 'heal', JSON.stringify(rp));
  /* 祖安对线: 高血有垃圾牌 → 弃1; 1血 → 受1伤 */
  g.players[rebel].hp = 5;
  g.players[rebel].hand = [mkCard('ub', 9104)];
  const ar1 = HEU.chooseResponse(g, rebel, { type: 'argueResp', pid: rebel, victim: rebel, srcId: loyal, trickKey: 'funArgue', dmg: 1, ctx: {} }, { difficulty: 'hard' });
  t('祖安: 高血弃垃圾牌', ar1 && ar1.kind === 'respondAoeResp' && ar1.yes === true, JSON.stringify(ar1));
  g.players[rebel].hp = 1;
  const ar2 = HEU.chooseResponse(g, rebel, { type: 'argueResp', pid: rebel, victim: rebel, srcId: loyal, trickKey: 'funArgue', dmg: 1, ctx: {} }, { difficulty: 'hard' });
  t('祖安: 1血不弃牌(受1伤)', ar2 && ar2.kind === 'respondAoeResp' && ar2.yes === false, JSON.stringify(ar2));
  /* 冷数据: 目标血厚手牌多 → 拆牌 */
  g.players[loyal].hp = 4;
  g.players[loyal].hand = [mkCard('attack', 5), mkCard('heal', 6), mkCard('dodge', 7)];
  const cd1 = HEU.chooseResponse(g, rebel, { type: 'cold', pid: rebel, attacker: rebel, target: loyal, dmg: 1 }, { difficulty: 'hard' });
  t('冷数据: 血厚改拆牌', cd1 && cd1.kind === 'respondCold' && cd1.yes === true, JSON.stringify(cd1));
  /* 追刀: 有攻击 → 追 */
  g.players[rebel].hand = [mkCard('attack', 9105)];
  const ch1 = HEU.chooseResponse(g, rebel, { type: 'chase', pid: rebel, attacker: rebel, target: loyal }, { difficulty: 'hard' });
  t('不死心: 有攻击就追刀', ch1 && ch1.kind === 'respondChase' && ch1.yes === true, JSON.stringify(ch1));
  g.players[rebel].hand = [mkCard('heal', 9106)];
  const ch2 = HEU.chooseResponse(g, rebel, { type: 'chase', pid: rebel, attacker: rebel, target: loyal }, { difficulty: 'hard' });
  t('不死心: 无攻击不追', ch2 && ch2.kind === 'respondChase' && ch2.yes === false, JSON.stringify(ch2));
  /* 转嫁同意: 忠臣(挡刀计数)请求 → 主公高血同意; 1血拒绝 */
  g.players[loyal].blockTimes = 1;
  g.players[lord].hp = g.players[lord].maxHp;
  const bc1 = HEU.chooseResponse(g, lord, { type: 'dodge', pid: lord, attacker: rebel, target: lord, dmg: 2, ctx: { betrayConsent: true, betrayer: loyal } }, { difficulty: 'hard' });
  t('转嫁同意: 忠臣请求且存活 → 同意', bc1 && bc1.kind === 'respondDodge' && bc1.yes === true, JSON.stringify(bc1));
  g.players[lord].hp = 1;
  const bc2 = HEU.chooseResponse(g, lord, { type: 'dodge', pid: lord, attacker: rebel, target: lord, dmg: 2, ctx: { betrayConsent: true, betrayer: loyal } }, { difficulty: 'hard' });
  t('转嫁同意: 会死则拒绝', bc2 && bc2.kind === 'respondDodge' && bc2.yes === false, JSON.stringify(bc2));
}

/* ---------- S8 完整全 AI 对局 ---------- */
console.log('S8 完整对局(heuristics 驱动)');
{
  const g = newGame(20240501);
  let steps = 0, acts = 0, bad = 0, badDetail = '';
  while (!g.over && steps < 3000) {
    const pid = g.turn;
    const p = g.players[pid];
    if (p.dead) { API.endTurn(g, pid); steps++; continue; }
    API.judgePhase(g, pid);
    API.drawPhase(g, pid);
    if (g.over) break;
    if (p.skipPlay) {
      const idx = HEU.discardChoice(g, pid);
      API.discardCards(g, pid, idx);
      API.endTurn(g, pid); steps++; continue;
    }
    let guard = 0;
    while (guard++ < 80 && !g.over && !g.pending) {
      const desc = HEU.chooseAction(g, pid, { difficulty: 'normal' });
      if (!desc || desc.kind === 'end') break;
      const r = HEU.applyAction(g, pid, desc);
      if (!r || r.ok === false) {
        bad++;
        if (!badDetail) badDetail = 'round=' + g.round + ' pid=' + pid + ' identity=' + p.identity + ' desc=' + JSON.stringify(desc) + ' why=' + (r && r.why);
        break;
      }
      acts++;
    }
    if (badDetail) { API.endTurn(g, pid); steps++; continue; }
    const idx = HEU.discardChoice(g, pid);
    API.discardCards(g, pid, idx);
    API.endTurn(g, pid);
    steps++;
  }
  t('整局零非法动作', bad === 0, badDetail);
  t('对局在3000步内结束且 winner 非空', g.over === true && !!g.winner, 'over=' + g.over + ' winner=' + g.winner + ' round=' + g.round);
  t('AI 实际出过动作', acts >= 20 && steps >= 5, 'acts=' + acts + ' steps=' + steps);
}

console.log('\n=== 汇总: 通过 ' + pass + ' / 失败 ' + fail + ' ===');
if (fail > 0) {
  console.log('失败明细:');
  for (const f of fails) console.log('  - ' + f);
  process.exitCode = 1;
} else {
  console.log('P3a AI 模块自测全绿 ✓');
}
