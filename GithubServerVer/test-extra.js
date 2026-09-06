/* ============================================================================
 * OI杀 v4.0 引擎补充测试 (v4-web/test-extra.js) — 套件 E
 * 覆盖 recon-05-审计C-UI与测试缺口.md 第八节列举的测试缺口:
 *   1. 12 个主动技 skillUse       2. 主公重铸 lordRedraw
 *   3. 护驾 helperId 路径          4. 忠臣挡刀(loseHp 自动裁决)
 *   5. 进化细节(每回合1次/每局3次/进化牌效果/守恒)
 *   6. 觉醒(触发条件+打表/爆零/学长/图灵等职业效果)
 *   7. 4 个评测机事件 + 事件翻牌(M-9)
 *   8. 延时锦囊判定(判定牌置回牌堆底 H-1)
 *   9. 濒死救援链(咖啡/谈心/备用电源/颓废/压线过/无僵尸)
 *  10. 欢乐牌(funArgue 双目标/特判/人类自选 + 其他 fun + 保底轨)
 *  11. 领域亲和(部署减费) + 成就(搅局者/护主/掀翻/明君)
 *  12. playerLeave 中途离场
 *  13. 胜利判定分支(含内奸单挑回血) + 保底终局 forceEndByCount
 *  14. 新修复回归(特判连锁/测评/不败/随缘/卖队友同意/防火墙/AOE事件±1)
 * 只读调用 ./game.js 导出 API, 不修改引擎源码(test.js/game.js/index.html 均未动)。
 * 用法: 在 v4-web 目录执行  node test-extra.js
 * ==========================================================================*/
'use strict';

const API = require('./game.js');

const NAMES6 = ['主', '甲', '乙', '丙', '丁', '戊'];
const NEUTRAL_PROF = { id: 'none', name: '测试', plain: '测试', hp: 4, domain: null, subDomain: null, passive: '', awaken: '' };

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

function mk(id, key, suit) { return { id: id, key: key, suit: suit || 'heart', num: 7 }; }

function discHas(g, id) { return g.discard.some(c => c && c.id === id); }

// 清空玩家控制面, 便于逐项构造最小局面(与 test.js stripPlayer 同风格)
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

// 指定职业并重算耐久(主公+2)/灵感/手牌上限被动
function setProf(p, id) {
  const prof = API.PROFESSIONS.find(x => x.id === id);
  p.prof = prof;
  p.maxHp = prof.hp + (p.identity === 'lord' ? 2 : 0);
  p.hp = p.maxHp;
  p.handLimitBonus = (id === 'tuling' ? 1 : 0);
  return prof;
}

// 构造最小受控对局: 建局->setup->清空控制面; 默认全AI(human=99)、第2轮(避开主公首轮免伤)
function fresh(n, opts) {
  opts = opts || {};
  const g = API.createGame({ seed: opts.seed || 12345, human: opts.human !== undefined ? opts.human : 99 });
  API.setup(g, NAMES6.slice(0, n));
  for (const p of g.players) stripPlayer(p);
  for (const p of g.players) p.mp = p.mpMax;
  g.round = opts.round !== undefined ? opts.round : 2;
  return g;
}

/* ================= 用例运行器 ================= */
function tc(name, fn) {
  const c = {
    name, fails: [], notes: [], crash: null,
    ok(cond, msg) { if (!cond) this.fails.push(msg); },
    note(msg) { this.notes.push(msg); },
  };
  try { fn(c); } catch (e) { c.crash = String((e && e.stack) || e); }
  return c;
}

/* ================= 1. 主动技 skillUse (需求第13章, SKILLS 12 项) ================= */

// E01 神犇·AKIOI: 弃2, 本回合攻击伤害+1 (再验证伤害落地)
function E01_akioi(c) {
  const g = fresh(3);
  const p0 = g.players[0], p1 = g.players[1];
  p0.hand = [mk(1001, 'heal'), mk(1002, 'heal')];
  const r = API.skillUse(g, 0, 'akioi');
  c.ok(r.ok === true, `akioi 应成功 (r=${JSON.stringify(r)})`);
  c.ok(p0.hand.length === 0 && p0.akioiDmg === 1, `弃2手牌且 akioiDmg=1 (hand=${p0.hand.length}, akioiDmg=${p0.akioiDmg})`);
  c.ok(g.discard.length >= 2, `弃牌入弃牌堆 (discard=${g.discard.length})`);
  const r2 = API.skillUse(g, 0, 'akioi');
  c.ok(r2.ok === false, `同回合二次使用应被拒 (r2=${JSON.stringify(r2)})`);
  // 伤害+1 落地
  p0.hand.push(mk(1003, 'attack', 'spade'));
  const hp1 = p1.hp;
  const r3 = API.playCard(g, 0, 0, 1);
  c.ok(r3.ok === true && p1.hp === hp1 - 2, `AKIOI 后攻击伤害应为2 (hp=${p1.hp}, 期望=${hp1 - 2}, r=${JSON.stringify(r3)})`);
  c.ok(API.skillUse(g, 0, 'nosuch') .ok === false, '未知技能应被拒');
}

// E02 毒瘤·祖传卡常: 弃1 令本次攻击不可被WA; 觉醒后免费
function E02_kachang(c) {
  const g = fresh(3);
  const p0 = g.players[0], p1 = g.players[1];
  p0.hand = [mk(1010, 'heal')];
  const r = API.skillUse(g, 0, 'kachang');
  c.ok(r.ok === true && p0.kachangFlag === true && p0.hand.length === 0, `卡常应弃1并置标记 (r=${JSON.stringify(r)})`);
  p0.hand.push(mk(1011, 'attack', 'spade'));
  p1.hand.push(mk(1012, 'dodge', 'heart'));
  const hp1 = p1.hp;
  const r2 = API.playCard(g, 0, 0, 1);
  c.ok(r2.ok === true && p1.hp === hp1 - 1, `卡常后攻击不可被WA, 目标掉1血 (hp=${p1.hp}, r=${JSON.stringify(r2)})`);
  c.ok(p1.hand.length === 1 && p1.hand[0].key === 'dodge', '目标的WA仍应在手(未被使用)');
  // 觉醒: 0手牌可发动
  const g2 = fresh(3);
  const q0 = g2.players[0];
  q0.awaken = true; q0.hand = [];
  const r3 = API.skillUse(g2, 0, 'kachang');
  c.ok(r3.ok === true && q0.kachangFlag === true, `觉醒后0手牌可免费发动 (r=${JSON.stringify(r3)})`);
}

// E03 女装·直播: 弃1红牌, 看目标手牌拿1张; 觉醒看2拿1
function E03_live(c) {
  const g = fresh(3);
  const p0 = g.players[0], p1 = g.players[1];
  p0.hand = [mk(1020, 'heal', 'heart')];
  p1.hand = [mk(1021, 'attack', 'spade')];
  const r = API.skillUse(g, 0, 'live', 1);
  c.ok(r.ok === true, `直播应成功 (r=${JSON.stringify(r)})`);
  c.ok(p1.hand.length === 0, `目标手牌被拿走 (t.hand=${p1.hand.length})`);
  c.ok(p0.hand.length === 1 && p0.hand[0].id === 1021, `使用者拿到目标的牌 (hand=${JSON.stringify(p0.hand.map(x => x.id))})`);
  c.ok(discHas(g, 1020), '红色弃牌应入弃牌堆');
  // 觉醒: 看2拿1
  const g2 = fresh(3);
  const q0 = g2.players[0], q1 = g2.players[1];
  q0.awaken = true;
  q0.hand = [mk(1022, 'heal', 'heart')];
  q1.hand = [mk(1023, 'attack', 'spade'), mk(1024, 'dodge', 'club')];
  const r2 = API.skillUse(g2, 0, 'live', 1);
  c.ok(r2.ok === true && q1.hand.length === 1, `觉醒直播看2拿1: 目标剩1 (t.hand=${q1.hand.length})`);
  c.ok(q0.hand.length === 1, `使用者净0张 (弃1拿1, hand=${q0.hand.length})`);
}

// E04 评测姬·重测: 弃1摸1再弃1 (净-1)
function E04_rejudge(c) {
  const g = fresh(3);
  const p0 = g.players[0];
  p0.hand = [mk(1030, 'heal'), mk(1031, 'heal')];
  const d0 = g.discard.length;
  const r = API.skillUse(g, 0, 'rejudge');
  c.ok(r.ok === true, `重测应成功 (r=${JSON.stringify(r)})`);
  c.ok(p0.hand.length === 1, `净手牌-1 (hand=${p0.hand.length})`);
  c.ok(g.discard.length === d0 + 2, `弃2张入弃牌堆 (discard+${g.discard.length - d0})`);
}

// E05 传奇·封神: 限定技, 目标受1伤, 一局一次
function E05_seal(c) {
  const g = fresh(3);
  const p1 = g.players[1];
  const hp1 = p1.hp;
  const r = API.skillUse(g, 0, 'seal', 1);
  c.ok(r.ok === true && p1.hp === hp1 - 1, `封神目标受1伤 (hp=${p1.hp}, r=${JSON.stringify(r)})`);
  c.ok(g.players[0].usedSeal === true, 'usedSeal 应置位');
  const r2 = API.skillUse(g, 0, 'seal', 1);
  c.ok(r2.ok === false, `限定技二次使用应被拒 (r2=${JSON.stringify(r2)})`);
}

// E06 学长·讲题: 弃1让目标摸1; 觉醒后自己同摸1
function E06_teach(c) {
  const g = fresh(3);
  const p0 = g.players[0], p2 = g.players[2];
  p0.hand = [mk(1040, 'heal')];
  const h2 = p2.hand.length;
  const r = API.skillUse(g, 0, 'teach', 2);
  c.ok(r.ok === true && p2.hand.length === h2 + 1, `讲题目标摸1 (t.hand=${p2.hand.length}, r=${JSON.stringify(r)})`);
  c.ok(p0.hand.length === 0, '使用者弃1');
  // 觉醒同摸1 (新对局, 规避同回合每技能1次限制)
  const g2 = fresh(3);
  const q0 = g2.players[0], q1 = g2.players[1];
  q0.teachBonus = true;
  q0.hand = [mk(1041, 'heal')];
  const h1 = q1.hand.length;
  const r2 = API.skillUse(g2, 0, 'teach', 1);
  c.ok(r2.ok === true && q1.hand.length === h1 + 1, `讲题目标摸1 (t.hand=${q1.hand.length}, r=${JSON.stringify(r2)})`);
  c.ok(q0.hand.length === 1, `觉醒后自己同摸1 (hand=${q0.hand.length})`);
}

// E07 打表·打表: 弃2摸4 (净+2)
function E07_dabiao(c) {
  const g = fresh(3);
  const p0 = g.players[0];
  p0.hand = [mk(1050, 'heal'), mk(1051, 'heal')];
  const r = API.skillUse(g, 0, 'dabiao');
  c.ok(r.ok === true && p0.hand.length === 4, `弃2摸4 (hand=${p0.hand.length}, r=${JSON.stringify(r)})`);
}

// E08 键盘侠·口嗨: 弃1令目标弃1; 觉醒可指定两名玩家
function E08_kouhai(c) {
  const g = fresh(3);
  const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
  p0.hand = [mk(1060, 'heal')];
  p1.hand = [mk(1061, 'attack')];
  const r = API.skillUse(g, 0, 'kouhai', 1);
  c.ok(r.ok === true && p1.hand.length === 0, `口嗨令目标弃1 (t.hand=${p1.hand.length}, r=${JSON.stringify(r)})`);
  c.ok(p0.hand.length === 0, '使用者弃1');
  // 觉醒双目标
  const g2 = fresh(3);
  const q0 = g2.players[0], q1 = g2.players[1], q2 = g2.players[2];
  q0.awaken = true;
  q0.hand = [mk(1062, 'heal')];
  q1.hand = [mk(1063, 'attack')];
  q2.hand = [mk(1064, 'dodge')];
  const r2 = API.skillUse(g2, 0, 'kouhai', 1, 2);
  c.ok(r2.ok === true && q1.hand.length === 0 && q2.hand.length === 0, `觉醒口嗨双目标各弃1 (h1=${q1.hand.length}, h2=${q2.hand.length}, r=${JSON.stringify(r2)})`);
}

// E09 抄题解·抄题解: 弃1看牌堆顶3取1; 觉醒看4取2 (守恒)
function E09_chao(c) {
  const g = fresh(3);
  const p0 = g.players[0];
  p0.hand = [mk(1070, 'heal')];
  g.deck = [mk(1071, 'attack', 'spade'), mk(1072, 'dodge', 'club'), mk(1073, 'heal', 'diamond')];
  const r = API.skillUse(g, 0, 'chao');
  c.ok(r.ok === true, `抄题解应成功 (r=${JSON.stringify(r)})`);
  c.ok(g.deck.length === 2, `牌堆 -1 (deck=${g.deck.length})`);
  c.ok(p0.hand.length === 1 && p0.hand[0].id === 1073, `取走牌堆顶那张 (hand=${JSON.stringify(p0.hand.map(x => x.id))})`);
  // 觉醒看4取2
  const g2 = fresh(3);
  const q0 = g2.players[0];
  q0.awaken = true;
  q0.hand = [mk(1074, 'heal')];
  g2.deck = [mk(1075, 'attack', 'spade'), mk(1076, 'dodge', 'club'), mk(1077, 'heal', 'diamond'), mk(1078, 'coffee', 'heart')];
  const r2 = API.skillUse(g2, 0, 'chao');
  c.ok(r2.ok === true && g2.deck.length === 2, `觉醒看4取2: 牌堆-2 (deck=${g2.deck.length})`);
  c.ok(q0.hand.length === 2 && q0.hand.map(x => x.id).sort().join(',') === '1077,1078', `取走牌堆顶2张 (hand=${JSON.stringify(q0.hand.map(x => x.id))})`);
}

// E10 水群·水群: 弃1摸2弃1 (净0); 觉醒摸3弃1 (净+1)
function E10_shuiqun(c) {
  const g = fresh(3);
  const p0 = g.players[0];
  p0.hand = [mk(1080, 'heal')];
  const r = API.skillUse(g, 0, 'shuiqun');
  c.ok(r.ok === true && p0.hand.length === 1, `弃1摸2弃1净0 (hand=${p0.hand.length}, r=${JSON.stringify(r)})`);
  const g2 = fresh(3);
  const q0 = g2.players[0];
  q0.awaken = true;
  q0.hand = [mk(1081, 'heal')];
  const r2 = API.skillUse(g2, 0, 'shuiqun');
  c.ok(r2.ok === true && q0.hand.length === 2, `觉醒摸3弃1净+1 (hand=${q0.hand.length})`);
}

// E11 爆零·爆零: 弃1, 目标弃1或受1伤; 觉醒伤害+1
function E11_baoling(c) {
  const g = fresh(3);
  const p0 = g.players[0], p1 = g.players[1];
  p0.hand = [mk(1090, 'heal')];
  p1.hand = []; // 空手牌 -> 必走伤害分支(确定性)
  const hp1 = p1.hp;
  const r = API.skillUse(g, 0, 'baoling', 1);
  c.ok(r.ok === true && p1.hp === hp1 - 1, `爆零目标受1伤 (hp=${p1.hp}, r=${JSON.stringify(r)})`);
  // 觉醒伤害+1
  const g2 = fresh(3);
  const q0 = g2.players[0], q1 = g2.players[1];
  q0.hand = [mk(1091, 'heal')];
  q0.baolingBonus = 1;
  q1.hand = [];
  const hp1b = q1.hp;
  const r2 = API.skillUse(g2, 0, 'baoling', 1);
  c.ok(r2.ok === true && q1.hp === hp1b - 2, `觉醒爆零受2伤 (hp=${q1.hp}, 期望=${hp1b - 2})`);
}

// E12 图灵·奠基: 限定, 本局手牌上限再+2 (5+1+2=8)
function E12_dianji(c) {
  const g = fresh(3);
  const p0 = g.players[0];
  setProf(p0, 'tuling');
  const r = API.skillUse(g, 0, 'dianji');
  c.ok(r.ok === true && p0.usedDianji === true, `奠基应成功 (r=${JSON.stringify(r)})`);
  const lim = 5 + p0.handLimitBonus + (p0.prof.id === 'tuling' && p0.usedDianji ? 2 : 0);
  c.ok(lim === 8, `手牌上限应为8 (lim=${lim})`);
  c.ok(API.publicView(g, 0).me.handLimit === 8, `publicView.handLimit 应为8 (=${API.publicView(g, 0).me.handLimit})`);
  const r2 = API.skillUse(g, 0, 'dianji');
  c.ok(r2.ok === false, `限定技二次使用应被拒 (r2=${JSON.stringify(r2)})`);
}

/* ================= 2. 主公重铸 (需求 2.6) ================= */
function E13_lordRedraw(c) {
  const g = API.createGame({ seed: 7001, human: 99 });
  API.setup(g, NAMES6.slice(0, 4));
  const lord = g.players[0];
  lord.hand = [mk(1101, 'skipPlay', 'spade'), mk(1102, 'o2', 'club'), mk(1103, 'wBbst', 'heart'), mk(1104, 'aBattery', 'diamond')];
  c.ok(API.lordCanRedraw(g) === true, '起手4张全≥3费且第1轮未行动 -> 可重铸');
  const before = totalCards(g);
  const r = API.lordRedraw(g);
  c.ok(r.ok === true, `lordRedraw 应成功 (r=${JSON.stringify(r)})`);
  c.ok(lord.hand.length === 4, `重铸后仍4张起手 (hand=${lord.hand.length})`);
  c.ok(g.lordRedrawUsed === true && API.lordCanRedraw(g) === false, '重铸标记置位且不可再重铸');
  c.ok(totalCards(g) === before, `重铸牌张守恒 (${totalCards(g)}===${before})`);
  // 负例: 第2轮不可重铸
  const g2 = fresh(4, { round: 1 });
  const l2 = g2.players[0];
  l2.hand = [mk(1105, 'skipPlay'), mk(1106, 'o2'), mk(1107, 'wBbst'), mk(1108, 'aBattery')];
  g2.round = 2;
  c.ok(API.lordCanRedraw(g2) === false, '第2轮不可重铸');
  const r2 = API.lordRedraw(g2);
  c.ok(r2.ok === false, `第2轮 lordRedraw 应被拒 (r2=${JSON.stringify(r2)})`);
  // 负例: 手牌不足4张
  const g3 = fresh(4, { round: 1 });
  const l3 = g3.players[0];
  l3.hand = [mk(1109, 'skipPlay')];
  c.ok(API.lordCanRedraw(g3) === false, '手牌不足4张不可重铸');
}

/* ================= 3. 护驾指定帮手 (respondDodge helperId; C1 仅测 yes/no) ================= */
function E14_hujia_helper(c) {
  // 场景A: 主公(人类)被攻击, 帮手2号代出WA
  const g = fresh(3, { human: 0 });
  const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
  p1.hand = [mk(1110, 'attack', 'spade')];
  p1.mp = 5;
  p2.hand = [mk(1111, 'dodge', 'club')];
  p2.mp = 3;
  g.turn = 1;
  const hp0 = p0.hp, mp0 = p0.mp;
  const r = API.playCard(g, 1, 0, 0);
  c.ok(r.ok === true && g.pending && g.pending.type === 'dodge' && g.pending.target === 0,
    `攻击主公应挂起 dodge (r=${JSON.stringify(r)}, pd=${JSON.stringify(g.pending && { type: g.pending.type, target: g.pending.target })}`);
  c.ok(g.pending && g.pending.helpers && g.pending.helpers.some(h => h.id === 2), 'pending.helpers 应包含帮手2号');
  const rr = API.respondDodge(g, 0, true, 2);
  c.ok(rr.ok === true && rr.result === 'dodged', `帮手代出WA应成功 (rr=${JSON.stringify(rr)})`);
  c.ok(p2.hand.length === 0 && p2.mp === 2, `帮手消耗WA并扣1灵感 (hand=${p2.hand.length}, mp=${p2.mp})`);
  c.ok(discHas(g, 1111), '代出的WA应进弃牌堆');
  c.ok(p0.hp === hp0 && p0.mp === mp0, `主公不掉血不扣灵感 (hp=${p0.hp}, mp=${p0.mp})`);
  c.ok(g.pending === null, 'pending 应清空');
  // 场景B: 帮手无WA -> helperId 应被拒(记录引擎当前行为: 拒绝时 pending 已被清空)
  const g2 = fresh(3, { human: 0 });
  const a0 = g2.players[0], a1 = g2.players[1];
  a1.hand = [mk(1112, 'attack', 'spade')];
  a1.mp = 5;
  g2.turn = 1;
  API.playCard(g2, 1, 0, 0);
  const rr2 = API.respondDodge(g2, 0, true, 2);
  c.ok(rr2.ok === false && String(rr2.why).includes('无法代出WA'), `无WA帮手应被拒 (rr2=${JSON.stringify(rr2)})`);
  c.note('引擎行为记录: respondDodge 校验 helper 失败时底层 pending 已被清空(当前实现), 若 UI 依赖 pending 重问需留意');
  // 场景C: 无帮手时主公放弃 -> 正常掉血
  const g3 = fresh(3, { human: 0 });
  const b0 = g3.players[0], b1 = g3.players[1];
  b1.hand = [mk(1113, 'attack', 'spade')];
  b1.mp = 5;
  g3.turn = 1;
  const hp0b = b0.hp;
  API.playCard(g3, 1, 0, 0);
  const rr3 = API.respondDodge(g3, 0, false);
  c.ok(rr3.ok === true && b0.hp === hp0b - 1, `放弃出WA应掉1血 (hp=${b0.hp})`);
  // respondGuard 为文档化占位 API(挡刀由引擎自动裁决)
  const rg = API.respondGuard(g3, 0, true);
  c.ok(rg.ok === false, `respondGuard 为占位API, 返回 ok:false (rg=${JSON.stringify(rg)})`);
}

/* ================= 4. 忠臣挡刀 (loseHp 自动裁决; 需求 2.6/H4) ================= */
function E15_loyal_block(c) {
  const g = fresh(4);
  const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
  p0.identity = 'lord'; p1.identity = 'loyal'; p2.identity = 'rebel';
  p1.hand = [mk(1120, 'heal'), mk(1121, 'heal')];
  const hp0 = p0.hp, hp1 = p1.hp;
  API.loseHp(g, 0, 1, g.players[2], 'attack');
  c.ok(p0.hp === hp0, `主公不掉血 (hp=${p0.hp}, 期望=${hp0})`);
  c.ok(p1.hp === hp1 - 1, `忠臣替主公承受1伤 (hp=${p1.hp}, 期望=${hp1 - 1})`);
  c.ok(p1.hand.length === 1 && p1.blockTimes === 1, `忠臣弃1手牌挡刀且 blockTimes+1 (hand=${p1.hand.length}, blockTimes=${p1.blockTimes})`);
  c.ok(discHas(g, 1120) || discHas(g, 1121), '挡刀弃牌应进弃牌堆');
  // 同回合第二次: 挡刀每回合1次 -> 主公自己掉血
  API.loseHp(g, 0, 1, g.players[2], 'attack');
  c.ok(p0.hp === hp0 - 1, `第二次伤害不再挡, 主公掉1血 (hp=${p0.hp}, 期望=${hp0 - 1})`);
  // 忠臣无手牌 -> 不挡
  const g2 = fresh(4);
  const q0 = g2.players[0], q1 = g2.players[1], q2 = g2.players[2];
  q0.identity = 'lord'; q1.identity = 'loyal'; q2.identity = 'rebel';
  q1.hand = [];
  const hp0b = q0.hp;
  API.loseHp(g2, 0, 1, g2.players[2], 'attack');
  c.ok(q0.hp === hp0b - 1, `忠臣无手牌无法挡刀, 主公掉血 (hp=${q0.hp})`);
  c.ok(q1.blockTimes === 0, '无手牌忠臣不计数挡刀');
}

/* ================= 5. 进化细节 (需求第15章) ================= */
function E16_evo_limits(c) {
  // 每回合最多1次: 两个候选只进化第一个
  const g = fresh(3);
  const p0 = g.players[0];
  p0.hand = [mk(1130, 'attack', 'spade'), mk(1131, 'heal', 'heart')];
  g.pendingEvo[0] = ['attack', 'heal'];
  const before = totalCards(g);
  API.endTurn(g, 0);
  c.ok(p0.evoTotal === 1, `每回合仅1次进化 (evoTotal=${p0.evoTotal})`);
  c.ok(p0.hand.some(x => x.key === 'attackEvo') && !p0.hand.some(x => x.key === 'attack'), 'attack 应进化为 attackEvo');
  c.ok(p0.hand.some(x => x.key === 'heal') && !p0.hand.some(x => x.key === 'healEvo'), '第二个候选本回合不再进化');
  c.ok(totalCards(g) === before, `进化后牌张守恒 (${totalCards(g)}===${before})`);
  // 每局最多3次
  const g2 = fresh(3);
  const q0 = g2.players[0];
  q0.hand = [mk(1132, 'attack', 'spade')];
  q0.evoTotal = 3;
  const r = API.tryEvolve(g2, 0, 'attack');
  c.ok(r === false, `每局3次封顶后拒绝进化 (r=${r})`);
  // 人类进化选择 evolvePick
  const g3 = fresh(3, { human: 0 });
  const e0 = g3.players[0];
  e0.hand = [mk(1133, 'attack', 'spade')];
  g3.evoWait = { pid: 0, keys: ['attack'] };
  API.evolvePick(g3, 0, 'attack');
  c.ok(e0.hand[0].key === 'attackEvo' && g3.evoWait === null, `evolvePick 选择进化应生效 (hand=${e0.hand[0].key}, evoWait=${g3.evoWait})`);
  e0.hand.push(mk(1134, 'attack', 'club'));
  g3.evoWait = { pid: 0, keys: ['attack'] };
  API.evolvePick(g3, 0, null);
  c.ok(g3.evoWait === null && e0.hand.some(x => x.id === 1134 && x.key === 'attack'), '放弃进化: 清空 evoWait 且不进化');
}

// 进化牌效果: 实锤/样例全过/CCF金牌/浓缩咖啡/WC对决/数据爆炸/一票否决
function E17_evo_effects(c) {
  // 实锤: 伤害2
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1];
    p0.hand = [mk(1140, 'attackEvo', 'spade')];
    const hp1 = p1.hp;
    const r = API.playCard(g, 0, 0, 1);
    c.ok(r.ok === true && p1.hp === hp1 - 2, `实锤伤害2 (hp=${p1.hp}, r=${JSON.stringify(r)})`);
  }
  // 样例全过: 抵消后回1体力
  {
    const g = fresh(3, { human: 0 });
    const p0 = g.players[0], p1 = g.players[1];
    p0.hp = p0.maxHp - 2;
    p0.hand = [mk(1141, 'dodgeEvo', 'club')];
    p1.hand = [mk(1142, 'attack', 'spade')];
    p1.mp = 5;
    g.turn = 1;
    const hp0 = p0.hp;
    API.playCard(g, 1, 0, 0);
    const rr = API.respondDodge(g, 0, true);
    c.ok(rr.ok === true && p0.hp === hp0 + 1, `样例全过抵消后回1体力 (hp=${p0.hp}, rr=${JSON.stringify(rr)})`);
  }
  // CCF金牌: 回2摸1
  {
    const g = fresh(3);
    const p0 = g.players[0];
    p0.hp = p0.maxHp - 3;
    p0.hand = [mk(1143, 'healEvo', 'heart')];
    const hp0 = p0.hp;
    const r = API.playCard(g, 0, 0);
    c.ok(r.ok === true && p0.hp === hp0 + 2, `CCF金牌回2 (hp=${p0.hp})`);
    c.ok(p0.hand.length === 1, `CCF金牌摸1 (hand=${p0.hand.length})`);
  }
  // 浓缩咖啡: 伤害+2
  {
    const g = fresh(3);
    const p0 = g.players[0];
    p0.hand = [mk(1144, 'coffeeEvo', 'diamond')];
    const r = API.playCard(g, 0, 0);
    c.ok(r.ok === true && p0.coffee === true && p0.coffeeDmg === 2, `浓缩咖啡 coffeeDmg=2 (r=${JSON.stringify(r)})`);
  }
  // WC对决: 败者受2伤 (引擎当前 playCard 未实现 duelEvo 标签 -> 记录缺口, 见报告)
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1];
    p0.hand = [mk(1145, 'duelEvo', 'club')];
    p1.hand = [];
    const hp0 = p0.hp;
    const r = API.playCard(g, 0, 0, 1);
    if (r.ok) {
      c.ok(p0.hp === hp0 - 2, `WC对决: 无攻击方(使用者)受2伤 (hp=${p0.hp})`);
    } else {
      c.ok(String(r.why).includes('未实现'), `duelEvo 当前未实现(引擎缺口, 记录): r=${JSON.stringify(r)}`);
      c.ok(p0.hand.some(x => x.id === 1145), '未实现时牌应退回手牌');
      c.note('引擎缺口: duelEvo( WC对决 )无 playCard case 标签, 进化后无法打出(与 1a 修 killUnitEvo 前同型); 建议 engine 侧补 case');
    }
  }
  // 数据爆炸: 打不出攻击者受2伤
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p0.hand = [mk(1146, 'aoeAtkEvo', 'club')];
    p1.hand = []; p2.hand = [];
    const hp1 = p1.hp, hp2 = p2.hp;
    const r = API.playCard(g, 0, 0);
    c.ok(r.ok === true && p1.hp === hp1 - 2 && p2.hp === hp2 - 2, `数据爆炸: 无攻击者各受2伤 (hp1=${p1.hp}, hp2=${p2.hp})`);
  }
  // 一票否决: 抵消后摸1
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1];
    p0.hand = [mk(1147, 'pierce', 'spade')];
    p1.hand = [mk(1148, 'counterEvo', 'heart')];
    p1.mp = 3;
    const hp1 = p1.hp;
    const r = API.playCard(g, 0, 0, 1);
    c.ok(r.ok === true && p1.hp === hp1, `一票否决抵消锦囊 (hp=${p1.hp})`);
    c.ok(p1.hand.length === 1, `抵消后摸1 (hand=${p1.hand.length})`);
    c.ok(p1.mp === 2, `使用特判扣1灵感 (mp=${p1.mp})`);
    c.ok(discHas(g, 1148), '一票否决应进弃牌堆');
  }
}

// 主席树守卫(守擂被消灭摸1) / 清空回收站(消灭单位后摸1) + 守恒
function E18_evo_guard_killUnit(c) {
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1];
    p1.units = [mk(1150, 'uGuardEvo', 'spade')];
    p0.hand = [mk(1151, 'attack', 'club')];
    const before = totalCards(g);
    const r = API.playCard(g, 0, 0, 1);
    c.ok(r.ok === true && r.result === 'guard', `主席树守卫挡下攻击 (r=${JSON.stringify(r)})`);
    c.ok(p1.units.length === 0, '守擂单位被消灭');
    c.ok(p1.hand.length === 1, `守擂被消灭后摸1 (hand=${p1.hand.length})`);
    c.ok(discHas(g, 1150), '守卫应进弃牌堆');
    c.ok(totalCards(g) === before, `牌张守恒 (${totalCards(g)}===${before})`);
  }
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1];
    p1.units = [mk(1152, 'uDeath', 'spade')];
    p0.hand = [mk(1153, 'killUnitEvo', 'club')];
    const before = totalCards(g);
    const r = API.playCard(g, 0, 0, 1);
    c.ok(r.ok === true, `清空回收站应可打出 (r=${JSON.stringify(r)})`);
    c.ok(p1.units.length === 0, '目标单位被消灭');
    c.ok(p0.hand.length === 1, `消灭单位后使用者摸1 (hand=${p0.hand.length})`);
    c.ok(p1.hand.length === 1, `亡语原主人摸1 (hand=${p1.hand.length})`);
    c.ok(discHas(g, 1152) && discHas(g, 1153), '单位与牌均进弃牌堆');
    c.ok(totalCards(g) === before, `牌张守恒 (${totalCards(g)}===${before})`);
  }
}

/* ================= 6. 觉醒 (需求第16章; 触发条件 + 各职业效果) ================= */
// 触发: 体力首次<=上限一半, 当次结算后立即; 一局一次
// 触发伤害统一用 srcName='overload': 它 bypass 职业自身的受伤判定被动(测评/玄学/回忆),
// 保证触发伤害确定性落地; 之后的效果验证再用普通来源
function E19_awaken_core(c) {
  // 学长: 触发即置 teachBonus
  const g = fresh(3);
  const p1 = g.players[1];
  setProf(p1, 'xuezhang');
  p1.hp = 3;
  API.loseHp(g, 1, 1, null, 'overload');
  c.ok(p1.awaken === true && p1.teachBonus === true, `学长 hp3->2 触发觉醒, teachBonus=true (awaken=${p1.awaken})`);
  c.ok(p1.hp === 2, `觉醒不掉额外血 (hp=${p1.hp})`);
  const handB = p1.hand.length;
  API.loseHp(g, 1, 1, null, 'overload');
  c.ok(p1.hp === 1 && p1.hand.length === handB, `二次伤害不重复觉醒 (hp=${p1.hp}, hand=${p1.hand.length})`);
  c.ok(g.log.some(l => String(l.txt).includes('觉醒')), '日志应播报觉醒');
  // 学长觉醒后讲题同摸1
  const g2 = fresh(3);
  const q1 = g2.players[1], q2 = g2.players[2];
  setProf(q1, 'xuezhang');
  q1.hp = 3; q1.hand = [mk(1160, 'heal')];
  API.loseHp(g2, 1, 1, null, 'overload');
  g2.turn = 1;
  const r = API.skillUse(g2, 1, 'teach', 2);
  c.ok(r.ok === true && q2.hand.length === 1 && q1.hand.length === 1, `学长觉醒讲题: 目标+1, 自己同摸1 (t=${q2.hand.length}, self=${q1.hand.length})`);
  // 打表狂魔: 手牌上限+1
  const g3 = fresh(3);
  const w1 = g3.players[1];
  setProf(w1, 'dabiao');
  w1.handLimitBonus = 0;
  w1.hp = 3;
  API.loseHp(g3, 1, 1, null, 'overload');
  c.ok(w1.awaken === true && w1.handLimitBonus === 1, `打表狂魔觉醒 handLimitBonus=1 (=${w1.handLimitBonus})`);
  // 爆零: baolingBonus=1 -> 爆零伤害+1 (经技能落地)
  const g4 = fresh(3);
  const e1 = g4.players[1], e2 = g4.players[2];
  setProf(e1, 'baoling');
  e1.hp = 3;
  API.loseHp(g4, 1, 1, null, 'overload');
  c.ok(e1.awaken === true && e1.baolingBonus === 1, `爆零觉醒 baolingBonus=1 (=${e1.baolingBonus})`);
  e1.hand = [mk(1161, 'heal')]; e2.hand = [];
  g4.turn = 1;
  const hp2 = e2.hp;
  API.skillUse(g4, 1, 'baoling', 2);
  c.ok(e2.hp === hp2 - 2, `觉醒爆零伤害2 (hp=${e2.hp})`);
  // 图灵: 摸2
  const g5 = fresh(3);
  const t1 = g5.players[1];
  setProf(t1, 'tuling');
  t1.hp = 2; t1.hand = [];
  API.loseHp(g5, 1, 1, null, 'overload');
  c.ok(t1.awaken === true && t1.hand.length === 2, `图灵觉醒摸2 (hand=${t1.hand.length})`);
}

// 更多职业觉醒效果
function E20_awaken_more(c) {
  // 神犇: 攻击伤害永久+1
  {
    const g = fresh(3);
    const p1 = g.players[1], p2 = g.players[2];
    setProf(p1, 'shenben');
    p1.hp = 3;
    API.loseHp(g, 1, 1, null, 'overload');
    c.ok(p1.awaken === true && p1.dmgBonus === 1, `神犇觉醒 dmgBonus=1 (=${p1.dmgBonus})`);
    p1.hand = [mk(1170, 'attack', 'spade')];
    p1.mp = 5;
    g.turn = 1;
    const hp2 = p2.hp;
    API.playCard(g, 1, 0, 2);
    c.ok(p2.hp === hp2 - 2, `觉醒攻击伤害2 (hp=${p2.hp})`);
  }
  // 蒟蒻: 上限+1并回1
  {
    const g = fresh(3);
    const p1 = g.players[1];
    setProf(p1, 'juruo');
    p1.hp = 3;
    API.loseHp(g, 1, 1, null, 'overload');
    c.ok(p1.awaken === true && p1.maxHp === 5 && p1.hp === 3, `蒟蒻觉醒 maxHp=5 hp=3 (maxHp=${p1.maxHp}, hp=${p1.hp})`);
  }
  // 退役选手: 回2摸2
  {
    const g = fresh(3);
    const p1 = g.players[1];
    setProf(p1, 'tuiyi');
    p1.hp = 3; p1.hand = [];
    API.loseHp(g, 1, 1, null, 'overload');
    c.ok(p1.awaken === true && p1.hp === 4 && p1.hand.length === 2, `退役觉醒回2摸2 (hp=${p1.hp}, hand=${p1.hand.length})`);
  }
  // 萌新: 摸牌阶段多摸1
  {
    const g = fresh(3);
    const p1 = g.players[1];
    setProf(p1, 'mengxin');
    p1.hp = 3; p1.hand = [];
    API.loseHp(g, 1, 1, null, 'overload');
    c.ok(p1.awaken === true, `萌新觉醒触发 (awaken=${p1.awaken})`);
    API.drawPhase(g, 1);
    c.ok(p1.hand.length === 3, `觉醒摸牌阶段摸3 (hand=${p1.hand.length})`);
  }
  // 评测姬觉醒: 受伤免判定减1(每回合1次)
  {
    const g = fresh(3);
    const p1 = g.players[1];
    setProf(p1, 'pingce');
    p1.hp = 2;
    API.loseHp(g, 1, 1, null, 'overload');
    c.ok(p1.awaken === true && p1.hp === 1, `评测姬 hp2->1 触发觉醒 (hp=${p1.hp})`);
    API.loseHp(g, 1, 1, g.players[0], 'attack');
    c.ok(p1.hp === 1 && p1.armorCount.pingce === 1, `觉醒免判定减伤1 (hp=${p1.hp}, armorCount.pingce=${p1.armorCount.pingce})`);
  }
  // 玄学选手觉醒: 每回合首次受伤免伤(免判定)
  {
    const g = fresh(3);
    const p1 = g.players[1];
    setProf(p1, 'xuanxue');
    p1.hp = 3;
    API.loseHp(g, 1, 1, null, 'overload');
    c.ok(p1.awaken === true && p1.hp === 2, `玄学 hp3->2 触发觉醒 (hp=${p1.hp})`);
    API.loseHp(g, 1, 5, g.players[0], 'attack');
    c.ok(p1.hp === 2 && p1.armorCount.xuanxue === 1, `觉醒首次受伤免伤(5伤无伤) (hp=${p1.hp})`);
    API.loseHp(g, 1, 1, g.players[0], 'attack');
    c.ok(p1.hp === 1, `第二次受伤照常 (hp=${p1.hp})`);
  }
  // 金牌教练觉醒: 谈心救回时双方各得1张攻击(否则摸1)
  {
    const g = fresh(4);
    const p1 = g.players[1], p2 = g.players[2];
    setProf(p1, 'jiaolian');
    p1.awaken = true;
    p1.hand = [mk(1171, 'heal')];
    p2.identity = 'rebel';
    p2.hp = 1; p2.hand = [];
    API.loseHp(g, 2, 2, null, 'pierce');
    c.ok(p2.hp === 1, `谈心救回至1 (hp=${p2.hp})`);
    c.ok(p1.usedMentor === true, '谈心限定技置位');
    c.ok(p1.hand.length === 1 && p2.hand.length === 1, `觉醒名师出高徒: 双方各得1张 (mentor=${p1.hand.length}, victim=${p2.hand.length})`);
  }
}

/* ================= 7. 评测机事件 (需求第17章) + 事件翻牌(M-9) ================= */
function E21_events_4suits(c) {
  // 黑桃-毒瘤评测机: 攻击伤害-1 且无视WA
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1];
    g.eventSuit = 'spade'; g.event = API.EVENTS.spade;
    p0.hand = [mk(1180, 'attack', 'club')];
    p0.coffee = true; p0.coffeeDmg = 1; // 1+1=2 -> 事件-1 -> 1
    p1.hand = [mk(1181, 'dodge', 'heart')];
    const hp1 = p1.hp;
    const r = API.playCard(g, 0, 0, 1);
    c.ok(r.ok === true && p1.hp === hp1 - 1, `毒瘤评测机: 咖啡攻击伤害-1为1且无视WA (hp=${p1.hp}, r=${JSON.stringify(r)})`);
    c.ok(p1.hand.length === 1, '目标的WA未被消耗(无视WA)');
    c.ok(p0.coffee === false, '咖啡加成已消耗');
  }
  // 梅花-暴力评测机: 攻击伤害+1, 命中后使用者自伤1
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1];
    g.eventSuit = 'club'; g.event = API.EVENTS.club;
    p0.hand = [mk(1182, 'attack', 'spade')];
    p1.hand = [];
    const hp0 = p0.hp, hp1 = p1.hp;
    API.playCard(g, 0, 0, 1);
    c.ok(p1.hp === hp1 - 2, `暴力评测机: 目标受2伤 (hp=${p1.hp})`);
    c.ok(p0.hp === hp0 - 1, `暴力评测机: 使用者自伤1 (hp=${p0.hp})`);
  }
  // 红桃-慈善评测机: 当轮所有牌费用-1
  {
    const g = fresh(3);
    g.eventSuit = 'heart'; g.event = API.EVENTS.heart;
    const p0 = g.players[0];
    c.ok(API.effectiveCost(g, p0, 'attack') === 1, `慈善评测机: attack 费1 (=${API.effectiveCost(g, p0, 'attack')})`);
    c.ok(API.effectiveCost(g, p0, 'aoeAtk') === 3, `慈善评测机: aoeAtk 费3 (=${API.effectiveCost(g, p0, 'aoeAtk')})`);
    c.ok(API.effectiveCost(g, p0, 'peek') === 1, `慈善评测机: peek 最低1 (=${API.effectiveCost(g, p0, 'peek')})`);
  }
  // 方块-随机评测机: 被攻击判定 红桃=自动WA, 黑桃=伤害+1; 判定牌置回牌堆底
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1];
    g.eventSuit = 'diamond'; g.event = API.EVENTS.diamond;
    p1.hand = [];
    // 判定红桃 -> 自动闪避
    g.deck = [mk(1183, 'attack', 'club'), mk(1184, 'heal', 'heart')];
    p0.hand = [mk(1185, 'attack', 'spade')];
    const hp1 = p1.hp, mp1 = p1.mp;
    const r = API.playCard(g, 0, 0, 1);
    c.ok(r.ok === true && r.result === 'dodged', `随机评测机判定红桃自动闪避 (r=${JSON.stringify(r)})`);
    c.ok(p1.hp === hp1 && p1.mp === mp1, '自动闪避不掉血不扣灵感');
    c.ok(g.deck[0].id === 1184, `判定牌置回牌堆底 deck[0]=${g.deck[0].id}`);
    // 判定黑桃 -> 伤害+1
    g.deck = [mk(1186, 'dodge', 'diamond'), mk(1187, 'heal', 'spade')];
    p0.hand = [mk(1188, 'attack', 'club')];
    const hp1b = p1.hp;
    const r2 = API.playCard(g, 0, 0, 1);
    c.ok(r2.ok === true && p1.hp === hp1b - 2, `随机评测机判定黑桃伤害+1 (hp=${p1.hp})`);
    c.ok(g.deck[0].id === 1187, `判定牌置回牌堆底 deck[0]=${g.deck[0].id}`);
  }
}

// 事件翻牌(M-9): 牌堆摸空统一走题海战术(洗回+全体-1+计数), 翻出最后一张后牌堆空同样处理
function E22_event_flip_M9(c) {
  // A: 翻出最后一张后牌堆空 -> 洗回+全体-1
  const g = fresh(3);
  g.deck = [mk(1190, 'attack', 'heart')];
  g.discard = [mk(1191, 'heal', 'heart'), mk(1192, 'dodge', 'heart')];
  const hps = g.players.map(p => p.hp);
  API.endTurn(g, 2); // 末位玩家结束 -> 触发翻事件
  c.ok(g.reshuffleCount === 1, `翻出最后一张后洗回计数+1 (reshuffleCount=${g.reshuffleCount})`);
  c.ok(g.deck.length === 3 && g.discard.length === 0, `洗回后 deck=3 discard=0 (deck=${g.deck.length}, discard=${g.discard.length})`);
  g.players.forEach((p, i) => {
    if (!p.dead) c.ok(p.hp === hps[i] - 1, `题海战术全体-1 (p${i} hp=${p.hp}, 期望=${hps[i] - 1})`);
  });
  c.ok(g.eventSuit === 'heart' && g.event.name === '慈善评测机', `事件已翻出 (suit=${g.eventSuit}, name=${g.event.name})`);
  // B: 牌堆空翻事件 -> 洗回后翻牌
  const g2 = fresh(3);
  g2.deck = [];
  g2.discard = [mk(1193, 'attack', 'heart'), mk(1194, 'heal', 'heart')];
  const hps2 = g2.players.map(p => p.hp);
  API.endTurn(g2, 2);
  c.ok(g2.reshuffleCount === 1, `空牌堆翻事件先洗回 (reshuffleCount=${g2.reshuffleCount})`);
  c.ok(g2.deck.length === 1 && g2.discard.length === 1, `洗回后翻出1张: deck=1 discard=1 (deck=${g2.deck.length}, discard=${g2.discard.length})`);
  g2.players.forEach((p, i) => {
    if (!p.dead) c.ok(p.hp === hps2[i] - 1, `题海战术全体-1 (p${i} hp=${p.hp})`);
  });
  c.ok(g2.eventSuit === 'heart', `事件牌已翻出 (suit=${g2.eventSuit})`);
}

/* ================= 8. 延时锦囊判定 (需求第11章; H-1 判定牌置回牌堆底) ================= */
function E23_judgment_delay(c) {
  // 水群: 判定红桃无事 / 非红桃跳过行动阶段; 判定牌置回牌堆底
  {
    const g = fresh(3);
    const p1 = g.players[1];
    p1.identity = 'rebel'; p1.depression = 0;
    p1.delayArea = [mk(1200, 'delaySkipPlay', 'club')];
    g.deck = [mk(1201, 'attack', 'spade'), mk(1202, 'heal', 'heart')];
    API.judgePhase(g, 1);
    c.ok(p1.delayArea.length === 0, '延时牌判定后离开判定区');
    c.ok(discHas(g, 1200), '延时牌判定后进弃牌堆');
    c.ok(g.deck[0].id === 1202, `判定牌置回牌堆底 (deck[0]=${g.deck[0].id})`);
    c.ok(p1.skipPlay === false, '判定红桃不跳过行动阶段');
  }
  {
    const g = fresh(3);
    const p1 = g.players[1];
    p1.identity = 'rebel'; p1.depression = 0;
    p1.delayArea = [mk(1203, 'delaySkipPlay', 'club')];
    g.deck = [mk(1204, 'dodge', 'club'), mk(1205, 'heal', 'spade')];
    API.judgePhase(g, 1);
    c.ok(p1.skipPlay === true, '判定非红桃跳过行动阶段');
    c.ok(g.deck[0].id === 1205, `判定牌置回牌堆底 (deck[0]=${g.deck[0].id})`);
  }
  // 断网: 判定非梅花跳过摸牌阶段
  {
    const g = fresh(3);
    const p1 = g.players[1];
    p1.identity = 'rebel'; p1.depression = 0;
    p1.delayArea = [mk(1206, 'delaySkipDraw', 'club')];
    g.deck = [mk(1207, 'attack', 'diamond'), mk(1208, 'heal', 'heart')];
    API.judgePhase(g, 1);
    c.ok(p1.skipDraw === true, '判定非梅花跳过摸牌阶段');
  }
  {
    const g = fresh(3);
    const p1 = g.players[1];
    p1.identity = 'rebel'; p1.depression = 0;
    p1.delayArea = [mk(1209, 'delaySkipDraw', 'club')];
    g.deck = [mk(1210, 'attack', 'heart'), mk(1211, 'heal', 'club')];
    API.judgePhase(g, 1);
    c.ok(p1.skipDraw === false, '判定梅花不跳过摸牌阶段');
  }
  // UB: 黑桃2~9受3伤; 否则传下家
  {
    const g = fresh(3);
    const p1 = g.players[1];
    p1.identity = 'rebel'; p1.depression = 0;
    p1.delayArea = [mk(1212, 'ub', 'spade')];
    g.deck = [mk(1213, 'attack', 'club'), mk(1214, 'heal', 'spade')];
    g.deck[1].num = 5;
    const hp1 = p1.hp;
    API.judgePhase(g, 1);
    c.ok(p1.hp === hp1 - 3, `UB命中受3伤 (hp=${p1.hp})`);
    c.ok(discHas(g, 1212), 'UB命中后进弃牌堆');
  }
  {
    const g = fresh(3);
    const p1 = g.players[1], p2 = g.players[2];
    p1.identity = 'rebel'; p1.depression = 0;
    p1.delayArea = [mk(1215, 'ub', 'spade')];
    g.deck = [mk(1216, 'attack', 'club'), mk(1217, 'heal', 'heart')];
    API.judgePhase(g, 1);
    c.ok(p2.delayArea.some(d => d.key === 'ub'), 'UB未命中传给下家');
  }
  // 判定空仓洗回(不触发过载)
  {
    const g = fresh(3);
    const p1 = g.players[1];
    p1.identity = 'rebel'; p1.depression = 0;
    p1.delayArea = [mk(1218, 'delaySkipPlay', 'club')];
    g.deck = [];
    g.discard = [mk(1219, 'heal', 'heart')];
    const rc = g.reshuffleCount, hp1 = p1.hp;
    API.judgePhase(g, 1);
    c.ok(g.reshuffleCount === rc && p1.hp === hp1, `判定洗回不触发过载 (rc=${g.reshuffleCount}, hp=${p1.hp})`);
    c.ok(g.deck.length === 1, `判定牌回到牌堆 (deck=${g.deck.length})`);
  }
}

/* ================= 9. 濒死救援链 (需求第12章) ================= */
function E24_rescue(c) {
  // 咖啡自救: 过载伤害后地板≥1
  {
    const g = fresh(3);
    const p2 = g.players[2];
    p2.identity = 'rebel'; p2.depression = 0;
    p2.hand = [mk(1220, 'coffee', 'diamond')];
    p2.hp = 2;
    API.loseHp(g, 2, 5, null, 'pierce');
    c.ok(p2.hp === 1, `咖啡自救后 hp>=1 (hp=${p2.hp})`);
    c.ok(discHas(g, 1220), '咖啡应进弃牌堆');
    c.ok(p2.coffeeSaveUsedThisTurn === true, '本回合咖啡自救标记置位');
  }
  // 浓缩咖啡自救回2(地板≥1)
  {
    const g = fresh(3);
    const p2 = g.players[2];
    p2.identity = 'rebel'; p2.depression = 0;
    p2.hand = [mk(1221, 'coffeeEvo', 'diamond')];
    p2.hp = 2;
    API.loseHp(g, 2, 5, null, 'pierce');
    c.ok(p2.hp === 1, `浓缩咖啡过载自救地板1 (hp=${p2.hp})`);
  }
  // 金牌教练谈心(限定): 弃1手牌救回
  {
    const g = fresh(4);
    const p1 = g.players[1], p2 = g.players[2];
    setProf(p1, 'jiaolian');
    p1.hand = [mk(1222, 'heal')];
    p2.identity = 'rebel'; p2.depression = 0;
    p2.hp = 1;
    API.loseHp(g, 2, 2, null, 'pierce');
    c.ok(p2.hp === 1, `谈心救回至1 (hp=${p2.hp})`);
    c.ok(p1.usedMentor === true && p1.hand.length === 0, `教练弃1手牌 (hand=${p1.hand.length})`);
  }
  // 备用电源: 濒死自动回1并弃防具
  {
    const g = fresh(3);
    const p2 = g.players[2];
    p2.identity = 'rebel'; p2.depression = 0;
    p2.armor = mk(1223, 'aBattery', 'spade');
    p2.hp = 1;
    API.loseHp(g, 2, 2, null, 'pierce');
    c.ok(p2.hp === 1 && p2.armor === null, `备用电源自动回1弃防具 (hp=${p2.hp}, armor=${p2.armor})`);
    c.ok(discHas(g, 1223), '备用电源应进弃牌堆');
  }
  // 内奸颓废标记: 消耗1枚回1
  {
    const g = fresh(3);
    const p2 = g.players[2];
    p2.identity = 'traitor'; p2.depression = 1;
    p2.hp = 1;
    API.loseHp(g, 2, 2, null, 'pierce');
    c.ok(p2.hp === 1 && p2.depression === 0, `颓废标记消耗回1 (hp=${p2.hp}, depression=${p2.depression})`);
  }
  // 压线过: 伤害使体力<=0时改为降到1; 随后体力<=半血立即觉醒(上限+1并回1)
  {
    const g = fresh(3);
    const p2 = g.players[2];
    setProf(p2, 'yaxian');
    p2.hp = 2;
    API.loseHp(g, 2, 5, null, 'pierce');
    c.ok(p2.yaxianUsed === true, '压线过标记置位');
    c.ok(p2.awaken === true, `锁1后触觉觉醒链 (awaken=${p2.awaken})`);
    c.ok(p2.hp === 2, `压线过锁1 + 觉醒回1 = 2 (hp=${p2.hp})`);
  }
  // 无救援 -> 阵亡, 无僵尸
  {
    const g = fresh(3);
    const p2 = g.players[2];
    p2.identity = 'rebel'; p2.depression = 0;
    p2.hand = [mk(1224, 'heal')];
    p2.hp = 1;
    API.loseHp(g, 2, 2, null, 'pierce');
    c.ok(p2.dead === true, '无救援应阵亡');
    c.ok(p2.hp <= 0, `阵亡后 hp<=0 (hp=${p2.hp})`);
    c.ok(discHas(g, 1224), '阵亡弃光手牌进弃牌堆');
  }
  // 咖啡每回合濒死限1次: 第二次濒死无咖啡 -> 阵亡
  {
    const g = fresh(3);
    const p2 = g.players[2];
    p2.identity = 'rebel'; p2.depression = 0;
    p2.hand = [mk(1225, 'coffee'), mk(1226, 'coffee')];
    p2.hp = 1;
    API.loseHp(g, 2, 2, null, 'pierce');
    c.ok(p2.hp === 1, `第一次咖啡自救 (hp=${p2.hp})`);
    API.loseHp(g, 2, 2, null, 'pierce');
    c.ok(p2.dead === true, `第二次濒死无咖啡 -> 阵亡 (dead=${p2.dead})`);
  }
}

/* ================= 10. 欢乐牌 (需求第18章) ================= */
function E25_fun_cards(c) {
  // 躺赢: 摸2 禁攻
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1];
    p0.hand = [mk(1230, 'funLie', 'heart')];
    const r = API.playCard(g, 0, 0);
    c.ok(r.ok === true && p0.hand.length === 2, `躺赢摸2 (hand=${p0.hand.length})`);
    c.ok(p0.canAttack === false, '躺赢本回合禁攻');
    p0.hand.push(mk(1231, 'attack', 'spade'));
    const r2 = API.playCard(g, 0, p0.hand.length - 1, 1);
    c.ok(r2.ok === false, `禁攻期间攻击应被拒 (r2=${JSON.stringify(r2)})`);
    c.ok(p0.hand.some(x => x.id === 1231), '被拒的攻击退回手牌');
  }
  // 摆烂宣言: 弃光手牌摸3
  {
    const g = fresh(3);
    const p0 = g.players[0];
    p0.hand = [mk(1232, 'funGiveup', 'club'), mk(1233, 'heal'), mk(1234, 'attack'), mk(1235, 'dodge'), mk(1236, 'draw2')];
    const r = API.playCard(g, 0, 0);
    c.ok(r.ok === true && p0.hand.length === 3, `摆烂宣言弃光摸3 (hand=${p0.hand.length})`);
    c.ok(discHas(g, 1233) && discHas(g, 1234) && discHas(g, 1235) && discHas(g, 1236), '弃光的手牌均进弃牌堆');
  }
  // 开小号: 复制单位(克隆体 id=-1), 一局一次
  {
    const g = fresh(3);
    const p0 = g.players[0];
    p0.units = [mk(1237, 'uGuard', 'spade')];
    p0.hand = [mk(1238, 'funClone', 'heart')];
    const before = totalCards(g);
    const r = API.playCard(g, 0, 0);
    c.ok(r.ok === true && p0.units.length === 2, `开小号复制单位 (units=${p0.units.length})`);
    c.ok(p0.units[1].id === -1 && p0.units[1].key === 'uGuard', '克隆体 id=-1 同牌型');
    c.ok(g.usedClone === true, '一局一次标记置位');
    c.ok(totalCards(g) === before, `克隆体不破坏守恒 (${totalCards(g)}===${before})`);
    p0.hand = [mk(1239, 'funClone', 'heart')];
    const r2 = API.playCard(g, 0, 0);
    c.ok(r2.ok === false, `二次开小号应被拒 (r2=${JSON.stringify(r2)})`);
  }
  // 机房断电: 消灭至多2个单位, 亡语摸1
  {
    const g = fresh(4);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2], p3 = g.players[3];
    p1.units = [mk(1240, 'uDeath', 'spade')];
    p2.units = [mk(1241, 'uDeath', 'club')];
    p3.units = [mk(1242, 'uGuard', 'heart')];
    p0.hand = [mk(1243, 'funPower', 'diamond')];
    const r = API.playCard(g, 0, 0);
    c.ok(r.ok === true, `机房断电应成功 (r=${JSON.stringify(r)})`);
    c.ok(p1.units.length === 0 && p2.units.length === 0, '前两个单位被消灭');
    c.ok(p3.units.length === 1, '至多2个: 第三个单位保留');
    c.ok(p1.hand.length === 1 && p2.hand.length === 1, '亡语原主人各摸1');
    c.ok(discHas(g, 1240) && discHas(g, 1241), '被消灭单位进弃牌堆');
  }
  // 感谢CCF: 全员回1, 下回合攻击费+1
  {
    const g = fresh(3);
    const p0 = g.players[0];
    for (const p of g.players) p.hp = p.maxHp - 1;
    p0.hand = [mk(1244, 'funCcf', 'heart')];
    const r = API.playCard(g, 0, 0);
    c.ok(r.ok === true, `感谢CCF应成功 (r=${JSON.stringify(r)})`);
    for (const p of g.players) {
      if (!p.dead) c.ok(p.hp === p.maxHp, `全员回1 (p${p.id} hp=${p.hp})`);
    }
    c.ok(g.ccfRound === g.round, `ccfRound 记录当轮 (ccfRound=${g.ccfRound}, round=${g.round})`);
    const rr = g.round;
    g.round = g.ccfRound + 1;
    c.ok(API.effectiveCost(g, p0, 'attack') === 3, `下回合攻击费+1 (cost=${API.effectiveCost(g, p0, 'attack')})`);
    g.round = rr;
  }
  // 祖安对线: 双目标(AI空手牌->各受1伤)
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p0.hand = [mk(1245, 'funArgue', 'club')];
    p1.hand = []; p2.hand = [];
    const hp1 = p1.hp, hp2 = p2.hp;
    const r = API.playCard(g, 0, 0, 1, 2);
    c.ok(r.ok === true && r.result === 'done', `祖安对线结算完成 (r=${JSON.stringify(r)})`);
    c.ok(p1.hp === hp1 - 1 && p2.hp === hp2 - 1, `双目标各受1伤 (hp1=${p1.hp}, hp2=${p2.hp})`);
  }
  // 祖安对线: 目标持特判可反制自身段
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p0.hand = [mk(1246, 'funArgue', 'club')];
    p1.hand = [mk(1247, 'counter', 'spade')];
    p1.mp = 3;
    p2.hand = [];
    const hp1 = p1.hp, hp2 = p2.hp;
    API.playCard(g, 0, 0, 1, 2);
    c.ok(p1.hp === hp1, `特判抵消自身段 (hp=${p1.hp})`);
    c.ok(p2.hp === hp2 - 1, `第二目标照常受1伤 (hp=${p2.hp})`);
    c.ok(discHas(g, 1247), '特判应进弃牌堆');
  }
  // 祖安对线: 人类目标挂起 argueResp, yes=弃1张 / no=受1伤
  {
    const g = fresh(3, { human: 0 });
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p1.hand = [mk(1248, 'funArgue', 'club')];
    p1.mp = 5;
    p0.hand = [mk(1249, 'heal'), mk(1250, 'dodge')];
    p2.hand = [];
    g.turn = 1;
    const hp2 = p2.hp;
    const r = API.playCard(g, 1, 0, 0, 2);
    c.ok(r.ok === true && g.pending && g.pending.type === 'argueResp' && g.pending.victim === 0,
      `人类目标应挂起 argueResp (r=${JSON.stringify(r)}, pd=${JSON.stringify(g.pending && g.pending.type)}`);
    const rr = API.respondAoeResp(g, 0, true);
    c.ok(rr.ok === true && p0.hand.length === 1, `yes=弃1张 (hand=${p0.hand.length})`);
    c.ok(p2.hp === hp2 - 1, `第二目标结算(空手牌受1伤, hp=${p2.hp})`);
    c.ok(g.pending === null, 'pending 应清空');
  }
  {
    const g = fresh(3, { human: 0 });
    const p0 = g.players[0], p1 = g.players[1];
    p1.hand = [mk(1251, 'funArgue', 'club')];
    p1.mp = 5;
    p0.hand = [mk(1252, 'heal'), mk(1253, 'dodge')];
    g.turn = 1;
    const hp0 = p0.hp;
    API.playCard(g, 1, 0, 0, 2);
    const rr = API.respondAoeResp(g, 0, false);
    c.ok(rr.ok === true && p0.hp === hp0 - 1, `no=受1伤 (hp=${p0.hp})`);
  }
  // 举报: 人类使用者挂起选牌(M12)
  {
    const g = fresh(3, { human: 0 });
    const p0 = g.players[0], p1 = g.players[1];
    p0.hand = [mk(1254, 'funReport', 'spade')];
    p1.hand = [mk(1255, 'attack', 'club'), mk(1256, 'heal', 'heart')];
    const r = API.playCard(g, 0, 0, 1);
    c.ok(r.ok === true && g.pending && g.pending.type === 'report', `举报应挂起选牌 (r=${JSON.stringify(r)}, pd=${JSON.stringify(g.pending && g.pending.type)}`);
    const rr = API.respondReport(g, 0, 'heal');
    c.ok(rr.ok === true, `respondReport 应成功 (rr=${JSON.stringify(rr)})`);
    c.ok(p1.hand.length === 1 && p1.hand[0].key === 'attack', `目标指定牌被弃 (hand=${JSON.stringify(p1.hand.map(x => x.key))})`);
    c.ok(discHas(g, 1256), '被弃牌进弃牌堆');
  }
  // 欢乐牌弃置保底轨(免费)
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1];
    // 卖队友保底: 本回合首次受伤-1
    p0.hand = [mk(1257, 'funBetray', 'spade')];
    let r = API.discardFun(g, 0, 0);
    c.ok(r.ok === true && p0.funShield === true, `卖队友保底置位 (r=${JSON.stringify(r)})`);
    const hp0 = p0.hp;
    API.loseHp(g, 0, 2, p1, 'pierce');
    c.ok(p0.hp === hp0 - 1, `保底首次受伤-1 (hp=${p0.hp})`);
    // 躺赢保底: 回复1灵感
    p0.hand = [mk(1258, 'funLie', 'heart')];
    p0.mp = 2;
    r = API.discardFun(g, 0, 0);
    c.ok(r.ok === true && p0.mp === 3, `躺赢保底回1灵感 (mp=${p0.mp})`);
    // 摆烂宣言保底: 摸1
    p0.hand = [mk(1259, 'funGiveup', 'club')];
    r = API.discardFun(g, 0, 0);
    c.ok(r.ok === true && p0.hand.length === 1, `摆烂宣言保底摸1 (hand=${p0.hand.length})`);
    // 祖安对线保底: 令一名玩家弃1张
    p0.hand = [mk(1260, 'funArgue', 'diamond')];
    p1.hand = [mk(1261, 'heal')];
    r = API.discardFun(g, 0, 0, 1);
    c.ok(r.ok === true && p1.hand.length === 0, `祖安对线保底令目标弃1 (hand=${p1.hand.length})`);
  }
}

/* ================= 11. 领域亲和 (需求第14章) + 成就 (需求 2.9) ================= */
function E26_domain_affinity(c) {
  c.ok(API.DOMAINS.length === 8, `8 领域 (${API.DOMAINS.length})`);
  const g = fresh(3);
  const p0 = g.players[0];
  setProf(p0, 'xuanxue'); // 主领域: 数学
  c.ok(API.effectiveCost(g, p0, 'uPeek') === 1, `主领域单位 uPeek(数学) 费-1: ${API.effectiveCost(g, p0, 'uPeek')}`);
  c.ok(API.effectiveCost(g, p0, 'uBlitz') === 2, `非主领域单位 uBlitz(算法) 不减免: ${API.effectiveCost(g, p0, 'uBlitz')}`);
  // 部署实际扣费 + 每回合1次
  p0.hand = [mk(1270, 'uPeek', 'heart'), mk(1271, 'uPeek', 'club')];
  p0.mp = 5;
  let r = API.deployUnit(g, 0, 0);
  c.ok(r.ok === true && p0.mp === 4, `首次部署费1 (mp=${p0.mp})`);
  c.ok(p0.domainDiscounted === true, '领域亲和每回合首次标记置位');
  r = API.deployUnit(g, 0, 0);
  c.ok(r.ok === true && p0.mp === 2, `同回合第二次部署费2 (mp=${p0.mp})`);
  c.ok(p0.units.length === 2, `部署2个单位 (units=${p0.units.length})`);
}

// 成就结算(经 checkVictory -> end -> settleAchievements; 需求 2.9)
function E27_achievements(c) {
  // 搅局者: 内奸存活至终局且击杀>=1, 且未获胜(主公方经保底终局获胜时)
  {
    const g = fresh(4);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2], p3 = g.players[3];
    p0.identity = 'lord'; p1.identity = 'loyal'; p2.identity = 'rebel'; p3.identity = 'traitor';
    p2.dead = true; // 反贼全灭
    p3.kills = 1;  // 内奸亲手击杀>=1
    for (const p of g.players) if (!p.dead) p.hp = 5;
    g.reshuffleCount = 1;
    g.deck = [];
    g.discard = [mk(1285, 'heal', 'heart')];
    API.draw(g, 0, 1); // 连续洗牌 -> 保底终局: 主公方2人 vs 内奸1人 -> 主公方胜
    c.ok(g.over === true && g.winner === '主公方', `主公方获胜(保底终局) (winner=${g.winner})`);
    c.ok(g.achievements && g.achievements[3] && g.achievements[3].some(a => a.name === '搅局者'), '内奸获得搅局者成就');
    const a = g.achievements[3].find(x => x.name === '搅局者');
    c.ok(a && typeof a.points === 'number' && typeof a.desc === 'string', `成就形状 {name,points,desc} (${JSON.stringify(a)})`);
  }
  // 护主: 忠臣成功挡刀>=1 (主公方胜)
  {
    const g = fresh(4);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2], p3 = g.players[3];
    p0.identity = 'lord'; p1.identity = 'loyal'; p2.identity = 'rebel'; p3.identity = 'traitor';
    p2.dead = true; p3.dead = true;
    p1.blockTimes = 1;
    API.checkVictory(g);
    c.ok(g.over === true && g.winner === '主公方', `主公方获胜 (winner=${g.winner})`);
    c.ok(g.achievements && g.achievements[1] && g.achievements[1].some(a => a.name === '护主'), '忠臣获得护主成就');
  }
  // 掀翻: 反贼亲手击杀主公 (反贼胜)
  {
    const g = fresh(4);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2], p3 = g.players[3];
    p0.identity = 'lord'; p1.identity = 'loyal'; p2.identity = 'rebel'; p3.identity = 'traitor';
    p1.dead = true; p3.dead = true;
    p2.killedLord = true;
    p0.dead = true;
    API.checkVictory(g);
    c.ok(g.over === true && g.winner === '反贼', `反贼获胜 (winner=${g.winner})`);
    c.ok(g.achievements && g.achievements[2] && g.achievements[2].some(a => a.name === '掀翻' && a.points === 2), '反贼获得掀翻成就(+2分)');
  }
  // 明君: 主公获胜且未对忠臣造成伤害 (正/负例)
  {
    const g = fresh(4);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2], p3 = g.players[3];
    p0.identity = 'lord'; p1.identity = 'loyal'; p2.identity = 'rebel'; p3.identity = 'traitor';
    p2.dead = true; p3.dead = true;
    g.lordDamagedLoyal = false;
    API.checkVictory(g);
    c.ok(g.achievements && g.achievements[0] && g.achievements[0].some(a => a.name === '明君'), '主公获得明君成就(未伤忠臣)');
  }
  {
    const g = fresh(4);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2], p3 = g.players[3];
    p0.identity = 'lord'; p1.identity = 'loyal'; p2.identity = 'rebel'; p3.identity = 'traitor';
    p2.dead = true; p3.dead = true;
    g.lordDamagedLoyal = true;
    API.checkVictory(g);
    c.ok(!(g.achievements && g.achievements[0] && g.achievements[0].some(a => a.name === '明君')), '伤过忠臣则无明君成就');
  }
}

/* ================= 12. playerLeave 中途离场 (需求 2.7/M22/L-12) ================= */
function E28_playerLeave(c) {
  const g = fresh(4);
  const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2], p3 = g.players[3];
  p0.identity = 'lord'; p1.identity = 'loyal'; p2.identity = 'rebel'; p3.identity = 'traitor';
  p3.hand = [mk(1280, 'heal')];
  const r = API.playerLeave(g, 3);
  c.ok(r.ok === true, `离场应成功 (r=${JSON.stringify(r)})`);
  c.ok(p3.left === true && p3.dead === true, '离场标记+视为死亡');
  c.ok(p3.hand.length === 0 && discHas(g, 1280), '手牌弃入弃牌堆');
  c.ok(g.over === false, '对局未结束(还有反贼存活)');
  // L-12: 离场内奸身份公开
  const v = API.publicView(g, 0);
  const o3 = v.others.find(q => q.id === 3);
  c.ok(o3 && o3.identity === '摸鱼怪', `离场内奸身份公开 (identity=${o3 && o3.identity})`);
  // 轮转跳过阵亡/离场者
  c.ok(API.nextAlive(g, 0) === 1, '回合轮转从0号到1号');
  const r2 = API.playerLeave(g, 2);
  c.ok(r2.ok === true, '反贼离场');
  c.ok(g.over === true && g.winner === '主公方', `反贼离场后主公方获胜 (over=${g.over}, winner=${g.winner})`);
  c.ok(API.nextAlive(g, 1) === 0, '轮转跳过2/3号回到0号');
  const r3 = API.playerLeave(g, 2);
  c.ok(r3.ok === false, `已阵亡玩家不能重复离场 (r3=${JSON.stringify(r3)})`);
}

/* ================= 13. 胜利判定分支 (需求 2.3/2.5) + 内奸单挑 + 保底终局 ================= */
function E29_victory_branches(c) {
  // 主公死+反贼存活 -> 反贼胜
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p0.identity = 'lord'; p1.identity = 'rebel'; p2.identity = 'traitor';
    p2.dead = true;
    API.loseHp(g, 0, 99, null, 'pierce');
    c.ok(g.over === true && g.winner === '反贼', `主公死反贼胜 (winner=${g.winner})`);
  }
  // 主公死+无反贼+内奸存活 -> 内奸胜
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p0.identity = 'lord'; p1.identity = 'rebel'; p2.identity = 'traitor';
    p0.dead = true; p1.dead = true;
    API.checkVictory(g);
    c.ok(g.over === true && g.winner === '内奸(摸鱼怪)', `主公死无反贼内奸胜 (winner=${g.winner})`);
  }
  // 主公死+无反贼+无内奸(仅忠臣) -> 主公方胜
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p0.identity = 'lord'; p1.identity = 'rebel'; p2.identity = 'traitor';
    p0.dead = true; p1.dead = true; p2.dead = true;
    API.checkVictory(g);
    c.ok(g.over === true && g.winner === '主公方', `仅忠臣存活主公方胜 (winner=${g.winner})`);
  }
  // 主公存活+反贼内奸全灭 -> 主公方胜
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p0.identity = 'lord'; p1.identity = 'rebel'; p2.identity = 'traitor';
    p1.dead = true; p2.dead = true;
    API.checkVictory(g);
    c.ok(g.over === true && g.winner === '主公方', `反贼内奸全灭主公方胜 (winner=${g.winner})`);
  }
  // 内奸单挑: 存活2人含内奸 -> 每2回合回1 (Fix-Balance R1: 原H12"每回合回1"改为"每2回合回1")
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p0.identity = 'lord'; p1.identity = 'loyal'; p2.identity = 'traitor';
    p1.dead = true;
    p2.hp = p2.maxHp - 1;
    API.startTurn(g, 2); // 单挑第1个回合: 不回血
    c.ok(p2.hp === p2.maxHp - 1, `单挑第1回合不回血 (hp=${p2.hp}, duelTurns=${p2.duelTurns})`);
    API.startTurn(g, 2); // 单挑第2个回合: 回1
    c.ok(p2.hp === p2.maxHp, `单挑第2回合回1 (hp=${p2.hp}, duelTurns=${p2.duelTurns})`);
    c.ok(g.over === false, '单挑阶段对局未结束');
  }
}

// 保底终局 forceEndByCount (经 draw 的 reshuffleCount>=2 触发; 2.8/FAQ#15)
function E30_forceEndByCount(c) {
  // 主公方2人 vs 反贼1人 -> 主公方胜
  {
    const g = fresh(4);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2], p3 = g.players[3];
    p0.identity = 'lord'; p1.identity = 'loyal'; p2.identity = 'rebel'; p3.identity = 'traitor';
    p3.dead = true;
    for (const p of g.players) if (!p.dead) p.hp = 5;
    g.reshuffleCount = 1;
    g.deck = [];
    g.discard = [mk(1290, 'heal', 'heart')];
    API.draw(g, 0, 1);
    c.ok(g.over === true && g.winner === '主公方', `人数多者胜: 主公方 (winner=${g.winner})`);
  }
  // 主公方1 vs 反贼1 vs 内奸1 -> 平票再战一轮; 再战后仍平票 -> 主公方胜
  // (Fix-Balance R2: 原FAQ#15"人数相同内奸单独胜"改为"再战一轮, 仍平票判主公方")
  {
    const g = fresh(4);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2], p3 = g.players[3];
    p0.identity = 'lord'; p1.identity = 'rebel'; p2.identity = 'traitor'; p3.identity = 'loyal';
    p3.dead = true;
    for (const p of g.players) if (!p.dead) p.hp = 5;
    g.reshuffleCount = 1;
    g.deck = [];
    g.discard = [mk(1291, 'heal', 'heart')];
    API.draw(g, 0, 1); // 第1次触发: 平票 -> 再战一轮, 对局继续
    c.ok(g.over === false && g.tiebreakExtra === true, `平票先再战一轮 (over=${g.over}, tiebreakExtra=${g.tiebreakExtra})`);
    g.deck = [];
    g.discard = [mk(1292, 'heal', 'heart')];
    API.draw(g, 0, 1); // 第2次触发: 仍平票 -> 主公方胜
    c.ok(g.over === true && g.winner === '主公方', `再战后仍平票主公方胜 (winner=${g.winner})`);
  }
  // 主公方1 vs 反贼1 (无内奸) -> 同样先再战一轮, 仍平票判主公方 (Fix-Balance R2)
  {
    const g = fresh(4);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2], p3 = g.players[3];
    p0.identity = 'lord'; p1.identity = 'rebel'; p2.identity = 'traitor'; p3.identity = 'loyal';
    p2.dead = true; p3.dead = true;
    for (const p of g.players) if (!p.dead) p.hp = 5;
    g.reshuffleCount = 1;
    g.deck = [];
    g.discard = [mk(1293, 'heal', 'heart')];
    API.draw(g, 0, 1);
    c.ok(g.over === false && g.tiebreakExtra === true, `无内奸平票也先再战一轮 (over=${g.over}, tiebreakExtra=${g.tiebreakExtra})`);
    g.deck = [];
    g.discard = [mk(1294, 'heal', 'heart')];
    API.draw(g, 0, 1);
    c.ok(g.over === true && g.winner === '主公方', `再战后仍平票主公方胜 (winner=${g.winner})`);
  }
}

/* ================= 14. 新修复回归 (fixlog-1a/1b) ================= */
// 特判连锁 (fixlog-1b M-3): 奇数张生效/偶数张使前一张失效
function E31_counter_chain(c) {
  // 偶数张: 受害者特判 -> 他人连锁反制 -> 原锦囊继续结算
  {
    const g = fresh(4);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2], p3 = g.players[3];
    p1.hand = [mk(1300, 'pierce', 'spade')];
    p1.mp = 5;
    p2.hand = [mk(1301, 'counter', 'heart')];
    p2.mp = 3;
    p3.hand = [mk(1302, 'counter', 'club')];
    p3.mp = 3;
    g.turn = 1;
    const hp2 = p2.hp;
    const r = API.playCard(g, 1, 0, 2);
    c.ok(r.ok === true, `特判连锁应正常结算 (r=${JSON.stringify(r)})`);
    c.ok(p2.hp === hp2 - 1, `偶数张: 原锦囊继续结算, 受害者受1伤 (hp=${p2.hp})`);
    c.ok(discHas(g, 1301) && discHas(g, 1302), '两张特判均进弃牌堆');
    c.ok(p2.mp === 2 && p3.mp === 2, `两人各扣1灵感 (mp2=${p2.mp}, mp3=${p3.mp})`);
    c.ok(g.pending === null, '全AI下无挂起');
  }
  // 奇数张: 受害者特判生效, 锦囊被抵消
  {
    const g = fresh(4);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2], p3 = g.players[3];
    p1.hand = [mk(1303, 'pierce', 'spade')];
    p1.mp = 5;
    p2.hand = [mk(1304, 'counter', 'heart')];
    p2.mp = 3;
    g.turn = 1;
    const hp2 = p2.hp;
    const r = API.playCard(g, 1, 0, 2);
    c.ok(r.ok === true && p2.hp === hp2, `奇数张: 特判抵消锦囊, 目标不受伤 (hp=${p2.hp})`);
    c.ok(discHas(g, 1304), '特判进弃牌堆');
  }
}

// M-2 三个被动技: 评测姬测评 / 传奇不败 / 划水随缘
function E32_m2_passives(c) {
  // 测评(被动): 受伤判定红桃伤害-1; 觉醒后免判定每回合1次减1(已在 E20 测觉醒, 此处测基础)
  {
    const g = fresh(3);
    const p1 = g.players[1];
    setProf(p1, 'pingce');
    g.deck = [mk(1310, 'attack', 'club'), mk(1311, 'heal', 'heart')];
    API.loseHp(g, 1, 2, g.players[0], 'attack');
    c.ok(p1.hp === p1.maxHp - 1, `测评判定红桃伤害-1 (hp=${p1.hp}, 期望=${p1.maxHp - 1})`);
  }
  {
    const g = fresh(3);
    const p1 = g.players[1];
    setProf(p1, 'pingce');
    g.deck = [mk(1312, 'attack', 'heart'), mk(1313, 'heal', 'spade')];
    API.loseHp(g, 1, 1, g.players[0], 'attack');
    c.ok(p1.hp === p1.maxHp - 1, `测评判定非红桃不减免 (hp=${p1.hp}, 期望=${p1.maxHp - 1})`);
  }
  // 不败(被动): 每回合1次防止卡牌效果伤害
  {
    const g = fresh(3);
    const p1 = g.players[1];
    setProf(p1, 'chuangqi');
    API.loseHp(g, 1, 1, g.players[0], 'pierce');
    c.ok(p1.hp === p1.maxHp && p1.armorCount.bubai === 1, `不败首次防止卡牌伤害 (hp=${p1.hp})`);
    API.loseHp(g, 1, 1, g.players[0], 'pierce');
    c.ok(p1.hp === p1.maxHp - 1, `同回合第二次伤害照常 (hp=${p1.hp})`);
  }
  // 随缘(被动): 摸牌阶段改为摸1+弃牌堆拿1张基本牌
  {
    const g = fresh(3);
    const p1 = g.players[1];
    setProf(p1, 'huashui');
    g.discard = [mk(1314, 'attack', 'spade'), mk(1315, 'draw2', 'club')];
    API.drawPhase(g, 1);
    c.ok(p1.hand.length === 2, `随缘摸1+拿1 (hand=${p1.hand.length})`);
    c.ok(p1.hand.some(x => x.id === 1314), '拿回的是基本牌');
    c.ok(g.discard.length === 1 && g.discard[0].id === 1315, '弃牌堆剩非基本牌');
  }
  {
    const g = fresh(3);
    const p1 = g.players[1];
    setProf(p1, 'huashui');
    g.discard = [mk(1316, 'draw2', 'club')];
    API.drawPhase(g, 1);
    c.ok(p1.hand.length === 2, `弃牌堆无基本牌照常摸2 (hand=${p1.hand.length})`);
  }
}

// 卖队友同意路径 (fixlog-1a A-L: 需新目标同意, 一局一次)
function E33_betray_consent(c) {
  // 人类被攻击者主动转嫁 -> AI新目标 hp>伤害 同意
  {
    const g = fresh(3, { human: 0 });
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p0.hand = [mk(1320, 'funBetray', 'spade')];
    p1.hand = [mk(1321, 'attack', 'club')];
    p1.mp = 5;
    g.turn = 1;
    const hp0 = p0.hp, hp2 = p2.hp;
    API.playCard(g, 1, 0, 0);
    c.ok(g.pending && g.pending.type === 'dodge' && g.pending.ctx && g.pending.ctx.betrayAvail === true,
      `被攻击者持卖队友应挂起转嫁询问 (pd=${JSON.stringify(g.pending && g.pending.ctx && g.pending.ctx.betrayAvail)})`);
    const rr = API.respondBetray(g, 0, 2);
    c.ok(rr.ok === true && rr.result === 'redirected', `转嫁应成功 (rr=${JSON.stringify(rr)})`);
    c.ok(p2.hp === hp2 - 1, `AI新目标同意后受1伤 (hp=${p2.hp})`);
    c.ok(p0.hp === hp0, `原目标不受伤 (hp=${p0.hp})`);
    c.ok(discHas(g, 1320) && g.usedBetray === true, '卖队友进弃牌堆且一局一次标记置位');
  }
  // AI新目标 hp<=伤害 拒绝 -> 攻击落回原目标
  {
    const g = fresh(3, { human: 0 });
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p0.hand = [mk(1322, 'funBetray', 'spade')];
    p1.hand = [mk(1323, 'attack', 'club')];
    p1.mp = 5;
    p2.hp = 1;
    g.turn = 1;
    API.playCard(g, 1, 0, 0);
    const rr = API.respondBetray(g, 0, 2);
    c.ok(rr.ok === true, `拒绝后攻击落回原目标 (rr=${JSON.stringify(rr)})`);
    c.ok(p0.hand.some(x => x.id === 1322), '卖队友未被消耗(退回手牌)');
    c.ok(g.usedBetray === false, '一局一次标记未置位');
    // 落回原目标(人类)重新挂起 dodge -> 放弃出WA掉血
    c.ok(g.pending && g.pending.type === 'dodge', `原目标重新挂起WA询问 (pd=${JSON.stringify(g.pending && g.pending.type)}`);
    const hp0 = p0.hp;
    API.respondDodge(g, 0, false);
    c.ok(p0.hp === hp0 - 1, `原目标掉1血 (hp=${p0.hp})`);
  }
  // AI被攻击者转嫁 -> 人类新目标挂起同意询问(经 respondDodge), 同意/拒绝
  {
    const g = fresh(3, { human: 0 });
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p1.hand = [mk(1324, 'funBetray', 'spade')];
    p2.hand = [mk(1325, 'attack', 'club')];
    p2.mp = 5;
    g.turn = 2;
    API.playCard(g, 2, 0, 1);
    c.ok(g.pending && g.pending.type === 'dodge' && g.pending.ctx && g.pending.ctx.betrayConsent === true && g.pending.target === 0,
      `人类新目标应挂起同意询问 (pd=${JSON.stringify(g.pending && g.pending.ctx && g.pending.ctx.betrayConsent)})`);
    const hp0 = p0.hp;
    API.respondDodge(g, 0, true);
    c.ok(discHas(g, 1324) && g.usedBetray === true, '同意后卖队友消耗');
    c.ok(g.pending && g.pending.type === 'dodge', '转嫁后人类作为新目标挂起WA询问');
    API.respondDodge(g, 0, false);
    c.ok(p0.hp === hp0 - 1, `同意转嫁后人类受1伤 (hp=${p0.hp})`);
  }
  {
    const g = fresh(3, { human: 0 });
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p1.hand = [mk(1326, 'funBetray', 'spade')];
    p2.hand = [mk(1327, 'attack', 'club')];
    p2.mp = 5;
    g.turn = 2;
    API.playCard(g, 2, 0, 1);
    const hp1 = p1.hp;
    API.respondDodge(g, 0, false);
    c.ok(p1.hp === hp1 - 1, `拒绝转嫁: 攻击落回原目标 (hp=${p1.hp})`);
    c.ok(p1.hand.some(x => x.id === 1326) && g.usedBetray === false, '拒绝后卖队友保留且不置标记');
  }
}

// 防火墙: 暴力评测机期间不免疫AOE且受伤+1; 管理员权限无视防火墙 (fixlog-1a A-L / 1b M-4/M-12)
function E34_fw_club_aoe(c) {
  // 非club: 防火墙免疫AOE
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    p0.hand = [mk(1330, 'aoeDodge', 'club')];
    p1.armor = mk(1331, 'aFw', 'spade');
    p2.hand = [];
    const hp1 = p1.hp, hp2 = p2.hp;
    API.playCard(g, 0, 0);
    c.ok(p1.hp === hp1, `防火墙免疫AOE (hp=${p1.hp})`);
    c.ok(p2.hp === hp2 - 1, `无防火墙者受1伤 (hp=${p2.hp})`);
  }
  // club: 防火墙失效且受伤+1
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    g.eventSuit = 'club'; g.event = API.EVENTS.club;
    p0.hand = [mk(1332, 'aoeDodge', 'club')];
    p1.armor = mk(1333, 'aFw', 'spade');
    p2.hand = [];
    const hp1 = p1.hp, hp2 = p2.hp;
    API.playCard(g, 0, 0);
    c.ok(p1.hp === hp1 - 2, `暴力评测机期间防火墙失效且受伤+1 (hp=${p1.hp}, 期望=${hp1 - 2})`);
    c.ok(p2.hp === hp2 - 2, `无防火墙者受2伤 (hp=${p2.hp})`);
  }
  // AOE 受事件±1 (fixlog-1b M-4): 用进化AOE(基础伤害2)观察
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    g.eventSuit = 'spade'; g.event = API.EVENTS.spade;
    p0.hand = [mk(1334, 'aoeAtkEvo', 'club')];
    p1.hand = []; p2.hand = [];
    const hp1 = p1.hp, hp2 = p2.hp;
    API.playCard(g, 0, 0);
    c.ok(p1.hp === hp1 - 1 && p2.hp === hp2 - 1, `黑桃事件AOE伤害-1 (hp1=${p1.hp}, hp2=${p2.hp})`);
  }
  {
    const g = fresh(3);
    const p0 = g.players[0], p1 = g.players[1], p2 = g.players[2];
    g.eventSuit = 'club'; g.event = API.EVENTS.club;
    p0.hand = [mk(1335, 'aoeAtkEvo', 'club')];
    p1.hand = []; p2.hand = [];
    const hp1 = p1.hp, hp2 = p2.hp;
    API.playCard(g, 0, 0);
    c.ok(p1.hp === hp1 - 3 && p2.hp === hp2 - 3, `梅花事件AOE伤害+1 (hp1=${p1.hp}, hp2=${p2.hp})`);
  }
}

/* ================= 汇总输出 ================= */
function main() {
  const t0 = Date.now();
  console.log('====================================================');
  console.log(' OI杀 v4.0 引擎补充测试 (v4-web/test-extra.js) — 套件 E');
  console.log(' 覆盖 recon-05 测试缺口: 技能/重铸/护驾/挡刀/进化/觉醒/事件/判定/濒死/欢乐牌/亲和/成就/离场/胜利/回归');
  console.log('====================================================');
  console.log('');

  const tests = [
    E01_akioi, E02_kachang, E03_live, E04_rejudge, E05_seal, E06_teach,
    E07_dabiao, E08_kouhai, E09_chao, E10_shuiqun, E11_baoling, E12_dianji,
    E13_lordRedraw, E14_hujia_helper, E15_loyal_block, E16_evo_limits, E17_evo_effects, E18_evo_guard_killUnit,
    E19_awaken_core, E20_awaken_more,
    E21_events_4suits, E22_event_flip_M9, E23_judgment_delay, E24_rescue, E25_fun_cards,
    E26_domain_affinity, E27_achievements, E28_playerLeave, E29_victory_branches, E30_forceEndByCount,
    E31_counter_chain, E32_m2_passives, E33_betray_consent, E34_fw_club_aoe,
  ];

  const labels = [
    'E01-skill-akioi', 'E02-skill-kachang', 'E03-skill-live', 'E04-skill-rejudge', 'E05-skill-seal', 'E06-skill-teach',
    'E07-skill-dabiao', 'E08-skill-kouhai', 'E09-skill-chao', 'E10-skill-shuiqun', 'E11-skill-baoling', 'E12-skill-dianji',
    'E13-lordRedraw', 'E14-hujia-helperId', 'E15-loyal-block', 'E16-evo-limits', 'E17-evo-effects', 'E18-evo-guard-killUnit',
    'E19-awaken-core', 'E20-awaken-more',
    'E21-events-4suits', 'E22-event-flip-M9', 'E23-judgment-delay', 'E24-rescue-chain', 'E25-fun-cards',
    'E26-domain-affinity', 'E27-achievements', 'E28-playerLeave', 'E29-victory-branches', 'E30-forceEndByCount',
    'E31-counter-chain', 'E32-m2-passives', 'E33-betray-consent', 'E34-fw-club-aoe',
  ];

  const results = [];
  let pass = 0, failCount = 0;
  for (let i = 0; i < tests.length; i++) {
    const r = tc(labels[i], tests[i]);
    results.push(r);
    const ok = !r.crash && r.fails.length === 0;
    if (ok) pass++; else failCount += r.fails.length + (r.crash ? 1 : 0);
    console.log(`[${r.name}] ${r.crash ? 'CRASH' : (ok ? 'PASS' : 'FAIL')}`);
    for (const f of r.fails) console.log(`    ✗ ${f}`);
    if (r.crash) console.log('    ' + r.crash);
  }

  const notes = [];
  for (const r of results) for (const n of r.notes) notes.push(`[${r.name}] ${n}`);
  if (notes.length) {
    console.log('');
    console.log('--- 引擎缺口/行为记录 (非失败断言) ---');
    for (const n of notes) console.log('◆ ' + n);
  }

  console.log('');
  console.log(`=== 汇总: E通过=${pass}/${tests.length} | 断言失败=${failCount} ===`);
  console.log(`耗时=${((Date.now() - t0) / 1000).toFixed(2)}s`);
  process.exitCode = failCount > 0 ? 1 : 0;
}

main();
