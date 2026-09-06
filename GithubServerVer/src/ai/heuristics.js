/* ============================================================================
 * OI杀 v4.0 · src/ai/heuristics.js — 用牌启发 + 响应决策 (P3-3 / P3-4)
 * chooseAction(g, pid, opts):  出牌阶段决策 → 动作描述符(与引擎调用 1:1 映射)
 * chooseResponse(g, pid, prompt, opts): 响应决策(闪避/特判/护驾/卖队友/冷数据/
 *   平衡树/不死心/AOE/祖安对线/题解大会/举报/濒死相关) → 响应描述符
 * discardChoice(g, pid, opts): 回合末弃牌选择 → 手牌索引数组(降序)
 * applyAction(g, pid, desc):   执行描述符(调用引擎既有 API; 不改引擎)
 * 无上帝视角: 所有判断只读公开信息 + scorer.identityBelief 身份概率。
 * 确定性: rnd 缺省取 g.rnd(种子化), 便于 ai-stats 复现与自测。
 * 挂载: 共享命名空间 OIKill.ai.heuristics
 * ==========================================================================*/
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};
  const nsData = NS.data = NS.data || {};
  const nsEngine = NS.engine = NS.engine || {};
  const me = NS.ai = NS.ai || {};
  if (typeof module !== 'undefined' && module.exports) {
    require('../data/cards.js');
    require('../data/professions.js');
    require('../data/identities.js');
    require('../engine/core.js');
    require('../engine/battle.js');
    require('../engine/tricks.js');
    require('../engine/skills.js');
    if (!me.difficulty) require('./difficulty.js');
    if (!me.scorer) require('./scorer.js');
    if (!me.identityPolicy) require('./identity-policy.js');
  }
  const spec = (key) => nsData.cards.CARDS[key];
  const isAttackKey = (k) => nsData.cards.isAttackKey(k);
  const isDodgeKey = (k) => nsData.cards.isDodgeKey(k);
  const isBlack = (s) => nsData.identities.isBlack(s);
  const isRed = (s) => nsData.identities.isRed(s);
  const DIFF = () => me.difficulty;
  const SC = () => me.scorer;
  const POL = () => me.identityPolicy;
  const core = () => nsEngine.core;

  /* 动作描述符种类(与引擎调用 1:1, 见报告 §设计契约) */
  const DESCRIPTOR_KINDS = [
    'play', 'equip', 'deploy', 'skill', 'unitAttack', 'kspAttack', 'fangAttack',
    'funFallback', 'discard', 'end',
    'respondDodge', 'respondBetray', 'respondCounter', 'respondAoeResp',
    'respondHarvest', 'respondReport', 'respondCold', 'respondBbst', 'respondChase',
  ];

  /* ---------- 公共小工具 ---------- */
  function alive(g) { return g.players.filter(q => !q.dead); }
  function foesOf(g, pid) { return g.players.filter(q => !q.dead && q.id !== pid); }
  function costOf(g, p, key) { return core().effectiveCost(g, p, key); }
  function lordOf(g) { return g.players.find(q => q.identity === 'lord'); }
  /* 神犇碾压: 黑色非响应牌经 playCard 会被引擎强制转化为攻击(需要目标),
   * 因此这类牌不能走无目标的治疗/锦囊 play 描述符 —— 由 1c 碾压候选(带目标)承接 */
  function isCrushCard(p, c) {
    return p.prof.id === 'shenben' && !isAttackKey(c.key) && !isDodgeKey(c.key)
      && c.key !== 'counter' && c.key !== 'counterEvo' && isBlack(c.suit);
  }
  function canDodge(g, p) {
    if (p.armor && p.armor.key === 'aXuan') return true;
    if (p.armor && p.armor.key === 'aDsu' && p.hand.length >= 1) return true;
    return p.hand.some(c => isDodgeKey(c.key));
  }
  /* 濒死自救兜底是否可用(压线过/颓废/备用电源/退役/咖啡) */
  function hasSelfSave(g, p) {
    if (p.armor && p.armor.key === 'aBattery') return true;
    if (p.depression > 0) return true;
    if (p.prof.id === 'juruo' && !p.usedRetire) return true;
    if (p.prof.id === 'yaxian' && !p.yaxianUsed) return true;
    return p.hand.some(c => (c.key === 'coffee' || c.key === 'coffeeEvo')) && !p.coffeeSaveUsedThisTurn;
  }

  /* ---------- 出牌阶段: chooseAction ---------- */
  function chooseAction(g, pid, opts) {
    opts = opts || {};
    const p = g.players[pid];
    if (!p || p.dead || g.over || p.skipPlay) return { kind: 'end' };
    const diff = DIFF().get(opts.difficulty);
    const rnd = typeof opts.rnd === 'function' ? opts.rnd
      : (typeof g.rnd === 'function' ? g.rnd : Math.random);
    const pol = POL().policyFor(g, pid);
    const foes = foesOf(g, pid);
    if (foes.length === 0) return { kind: 'end' };

    const cands = [];
    const add = (score, desc) => { if (typeof score === 'number' && isFinite(score)) cands.push({ score, desc }); };
    const prioList = foes.map(q => ({ id: q.id, pr: SC().attackPriority(g, pid, q.id) }))
      .sort((a, b) => b.pr - a.pr);
    const prioTarget = (pred) => {
      for (const x of prioList) {
        const q = g.players[x.id];
        if (!pred || pred(q)) return q;
      }
      return null;
    };
    const atkIdxes = [];
    p.hand.forEach((c, i) => { if (isAttackKey(c.key)) atkIdxes.push(i); });

    /* 0. 咖啡 + 攻击 combo(濒死咖啡保留) */
    if (atkIdxes.length > 0 && p.canAttack) {
      p.hand.forEach((c, i) => {
        if ((c.key === 'coffee' || c.key === 'coffeeEvo') && p.mp >= costOf(g, p, c.key)) {
          if (isCrushCard(p, c)) return; // 黑色牌会变碾压攻击, 不按咖啡结算
          if (p.hp <= 2 && diff.retentionBias >= 0.5 && p.hand.length <= SC().handLimit(p)) return; // 保留自救
          add(SC().playValue(g, pid, i) + 0.5, { kind: 'play', cardIdx: i });
        }
      });
    }
    /* 1. 攻击(放手一搏三连 / 普通目标) */
    for (const ai of atkIdxes) {
      const c = p.hand[ai];
      if (!p.canAttack || p.mp < costOf(g, p, c.key)) continue;
      if (p.weapon && p.weapon.key === 'wFang' && p.hand.length === 1) {
        const tids = prioList.slice(0, 3).map(x => x.id);
        const sumPrio = prioList.slice(0, 3).reduce((s, x) => s + x.pr, 0);
        add(4 + sumPrio * 0.9, { kind: 'fangAttack', cardIdx: ai, targetIds: tids });
        continue;
      }
      for (const q of foes) {
        let v = SC().attackPriority(g, pid, q.id) + 1.2;
        if (pol.attackPrio) v += pol.attackPrio(q.id) * 0.8;
        if (g.eventSuit === 'club') v -= 0.8; // 暴力评测机自损
        add(v, { kind: 'play', cardIdx: ai, targetId: q.id });
      }
    }
    /* 1b. 手写快排: 无攻击牌时弃2张当攻击 */
    if (p.weapon && p.weapon.key === 'wKsp' && p.canAttack && atkIdxes.length === 0
        && p.hand.length >= 2 && p.mp >= costOf(g, p, 'attack')) {
      for (const q of foes) {
        add(SC().attackPriority(g, pid, q.id) + (pol.attackPrio ? pol.attackPrio(q.id) * 0.8 : 0),
          { kind: 'kspAttack', targetId: q.id });
      }
    }
    /* 1c. 神犇碾压: 黑色非响应牌当攻击 */
    if (p.prof.id === 'shenben' && p.canAttack && p.mp >= costOf(g, p, 'attack')) {
      p.hand.forEach((c, i) => {
        if (isAttackKey(c.key) || isDodgeKey(c.key) || c.key === 'counter' || c.key === 'counterEvo') return;
        if (!isBlack(c.suit)) return;
        if (p.mp < costOf(g, p, c.key)) return;
        for (const q of foes) {
          add(SC().attackPriority(g, pid, q.id) + 0.8 + (pol.attackPrio ? pol.attackPrio(q.id) * 0.8 : 0),
            { kind: 'play', cardIdx: i, targetId: q.id });
        }
      });
    }
    /* 2. 治疗 */
    p.hand.forEach((c, i) => {
      if ((c.key === 'heal' || c.key === 'healEvo' || c.key === 'cheat') && p.hp < p.maxHp
          && p.mp >= costOf(g, p, c.key)) {
        if (isCrushCard(p, c)) return; // 黑色治疗牌经 playCard 会变碾压攻击
        let v = SC().playValue(g, pid, i);
        if (pol.selfPreserve > 0.7) v += 0.6;
        add(v * pol.weights.heal, { kind: 'play', cardIdx: i });
      }
    });
    /* 3. 装备(槽位价值; 主公护盾不轻易换) */
    p.hand.forEach((c, i) => {
      const s = spec(c.key);
      if (s.type !== 'equip' || p.mp < costOf(g, p, c.key)) return;
      let v = SC().playValue(g, pid, i);
      if (pol.selfPreserve > 0.7 && s.slot === 'armor') v += 0.8;
      if (s.slot === 'weapon' && pol.aggression > 0.7) v += 0.4;
      add(v * pol.weights.equip, { kind: 'equip', cardIdx: i });
    });
    /* 4. 单位部署(守擂保核心 / 速攻 / 亡语过牌) */
    p.hand.forEach((c, i) => {
      const s = spec(c.key);
      if (s.type !== 'unit' || p.mp < costOf(g, p, c.key)) return;
      let v = SC().playValue(g, pid, i);
      if (s.guard && pol.selfPreserve > 0.6) v += 0.8;
      add(v * pol.weights.unit, { kind: 'deploy', cardIdx: i });
    });
    /* 5. 锦囊(延时给最大威胁 / 拆给高价值 / AOE 敌多时 / 特判保留) */
    p.hand.forEach((c, i) => {
      const s = spec(c.key), k = c.key;
      if (s.type !== 'trick' || k === 'counter' || k === 'counterEvo' || k === 'funBetray') return;
      if (p.mp < costOf(g, p, k)) return;
      if (isCrushCard(p, c)) return; // 黑色锦囊经 playCard 会变碾压攻击(由 1c 带目标承接)
      let t = null, t2 = null, v = SC().playValue(g, pid, i);
      switch (k) {
        case 'duel': case 'duelEvo': {
          const myAtk = p.hand.filter((x, j) => j !== i && isAttackKey(x.key)).length;
          t = prioTarget(q => q.hand.length <= 2 && SC().hostilityOf(g, pid, q.id) >= 0.4) || prioTarget();
          if (!t) return;
          if (myAtk === 0 && t.hand.length > 0) return; // 对拍必败不送
          break;
        }
        case 'dismantle': {
          t = prioTarget(q => q.hand.length > 0 && SC().hostilityOf(g, pid, q.id) >= 0.4) || prioTarget(q => q.hand.length > 0);
          if (!t) return;
          v += 0.3 * Math.min(6, t.hand.length);
          break;
        }
        case 'steal': {
          t = prioTarget(q => (q.weapon || q.armor) && SC().hostilityOf(g, pid, q.id) >= 0.4)
            || prioTarget(q => q.weapon || q.armor)
            || prioTarget(q => q.hand.length > 0);
          if (!t) return;
          if (t.weapon) v += 1.2; else if (t.armor) v += 0.8;
          break;
        }
        case 'pierce': case 'o2': case 'skipPlay': {
          if (k === 'o2' && !p.hand.some((x, j) => j !== i && isAttackKey(x.key))) return;
          t = prioTarget();
          if (!t) return;
          break;
        }
        case 'delaySkipPlay': case 'delaySkipDraw': {
          t = prioTarget(q => !q.delayArea.some(d => d.key === k));
          if (!t) return;
          break;
        }
        case 'gift': {
          let best = null, bestAw = 0.5;
          for (const q of foes) {
            const aw = POL().allyWeight(g, pid, q.id);
            if (aw > bestAw) { bestAw = aw; best = q; }
          }
          t = best;
          if (!t) return; // 无盟友不馈赠
          break;
        }
        case 'funReport': {
          t = prioTarget(q => q.hand.length > 0);
          if (!t) return;
          break;
        }
        case 'funArgue': {
          if (foes.length < 2) return;
          const list = prioList.slice(0, 2).map(x => x.id);
          t = g.players[list[0]]; t2 = g.players[list[1]];
          if (!t || !t2 || t.id === pid || t2.id === pid) return;
          break;
        }
        case 'killUnit': case 'killUnitEvo': {
          t = prioTarget(q => q.units.length > 0 && SC().hostilityOf(g, pid, q.id) >= 0.3)
            || prioTarget(q => q.units.length > 0);
          if (!t) return;
          if (t.units.some(u => spec(u.key).guard)) v += 2; // 破守擂
          break;
        }
        case 'funClone': {
          if (g.usedClone || p.units.length === 0) return;
          break;
        }
        case 'funPower': {
          if (!g.players.some(q => !q.dead && q.units.length > 0)) return;
          break;
        }
        case 'allHeal': case 'funCcf': {
          if (v < 1.5) return; // 净收益不足(敌方回血多于我方)
          break;
        }
        case 'aoeAtk': case 'aoeAtkEvo': case 'aoeDodge': case 'aoeDodgeEvo': {
          const hostiles = foes.filter(q => SC().hostilityOf(g, pid, q.id) >= 0.5).length;
          if (hostiles < pol.aoeThreshold) return;
          break;
        }
        case 'ub': {
          if (p.delayArea.some(d => d.key === 'ub')) return;
          if (p.hand.length <= SC().handLimit(p)) return; // 手牌不溢出绝不碰
          break;
        }
        case 'cheat': {
          if (p.hp >= p.maxHp) return; // 满血不可用
          break;
        }
        case 'recover': {
          if (g.discard.length === 0) return; // 弃牌堆为空不可用
          break;
        }
        case 'mull': {
          if (p.hand.length < 2) return; // 需另弃1张
          break;
        }
        default: break; // draw2/peek/harvest/funLie/funGiveup
      }
      if (v < 0.4) return; // 低价值兜底(防御非法/空转)
      v *= pol.weights.trick;
      add(v, { kind: 'play', cardIdx: i, targetId: t ? t.id : undefined, targetId2: t2 ? t2.id : undefined });
    });
    /* 5b. 欢乐牌保底轨(弃置触发保底, 不花灵感) */
    p.hand.forEach((c, i) => {
      const s = spec(c.key);
      if (!s.fun) return;
      const frac = p.maxHp > 0 ? 1 - p.hp / p.maxHp : 0;
      let v;
      switch (c.key) {
        case 'funBetray': v = 2 + 2 * frac; break;              // 保底: 本回合首伤-1
        case 'funLie': v = 1.6; break;
        case 'funReport': v = 1.2; break;
        case 'funClone': v = 2.2; break;
        case 'funGiveup': v = 2.0; break;
        case 'funPower': v = 1.4; break;
        case 'funArgue': v = 2.6; break;
        case 'funCcf': v = (p.hp < p.maxHp ? 4.2 : 1.5); break; // 保底: 自己回1
        default: v = 1;
      }
      v *= pol.weights.fun;
      const targetId = (c.key === 'funArgue' && prioList.length) ? prioList[0].id : undefined;
      add(v, { kind: 'funFallback', cardIdx: i, targetId });
    });
    /* 6. 单位攻击: 就绪单位清敌方单位(守擂/速攻优先) */
    p.units.forEach((u, ui) => {
      if (!u.ready) return;
      const victims = foes.filter(q => q.units.length > 0);
      for (const vq of victims) {
        const guardVal = vq.units.some(x => spec(x.key).guard) ? 1.5 : 0;
        const hos = SC().hostilityOf(g, pid, vq.id);
        let v = 1.6 + 2 * hos + guardVal + (pol.attackPrio && pol.attackPrio(vq.id) > 0 ? 0.6 : 0);
        if (pol.breakShieldFirst && lordOf(g) && vq.id === lordOf(g).id) v += 1.2;
        add(v, { kind: 'unitAttack', unitIdx: ui, victimPid: vq.id });
      }
    });
    /* 7. 职业技能(19 职业逐张策略表, 含觉醒差异) */
    const skills = nsData.professions.SKILLS[p.prof.id] || [];
    const has = (n) => skills.indexOf(n) >= 0 && !p.usedSkillsThisTurn[n];
    const sc = [];
    switch (p.prof.id) {
      case 'shenben':
        if (has('akioi') && p.hand.length >= 2 && atkIdxes.length > 0)
          sc.push({ v: 3.2, d: { kind: 'skill', name: 'akioi' } });
        break;
      case 'duliu':
        if (has('kachang') && (p.awaken || p.hand.length >= 1) && atkIdxes.length > 0 && p.mp >= costOf(g, p, 'attack')) {
          const tp = prioTarget();
          if (tp) sc.push({ v: (p.awaken ? 4.6 : 3.2) + (tp.hand.length >= 2 ? 1.2 : 0), d: { kind: 'skill', name: 'kachang' } });
        }
        break;
      case 'nvzhuang':
        if (has('live') && p.hand.some(c => isRed(c.suit))) {
          const tp = prioTarget(q => q.hand.length > 0);
          if (tp) sc.push({ v: 3.4, d: { kind: 'skill', name: 'live', targetId: tp.id } });
        }
        break;
      case 'pingce':
        if (has('rejudge') && p.hand.length >= 1)
          sc.push({ v: 2.6 + (p.hand.some((c, j) => SC().keepValue(g, pid, j) < 2) ? 0.8 : 0), d: { kind: 'skill', name: 'rejudge' } });
        break;
      case 'chuangqi':
        if (has('seal') && !p.usedSeal) {
          const tp = prioTarget();
          if (tp) sc.push({ v: 4.2 + (tp.hp <= 2 ? 1.5 : 0), d: { kind: 'skill', name: 'seal', targetId: tp.id } });
        }
        break;
      case 'xuezhang':
        if (has('teach') && p.hand.length >= 1) {
          let best = null, bestAw = 0.5;
          for (const q of foes) {
            const aw = POL().allyWeight(g, pid, q.id);
            if (aw > bestAw) { bestAw = aw; best = q; }
          }
          if (best) sc.push({ v: 3.0, d: { kind: 'skill', name: 'teach', targetId: best.id } });
        }
        break;
      case 'dabiao':
        if (has('dabiao') && p.hand.length >= 2) {
          const junk = p.hand.filter((c, j) => SC().keepValue(g, pid, j) < 2).length;
          sc.push({ v: 2.5 + junk * 0.5 + (p.hand.length <= 3 ? 0.8 : 0), d: { kind: 'skill', name: 'dabiao' } });
        }
        break;
      case 'jianpan':
        if (has('kouhai') && p.hand.length >= 1) {
          let best = null, bestH = 0;
          for (const q of foes) if (q.hand.length > bestH) { bestH = q.hand.length; best = q; }
          if (best && bestH > 0) {
            const t2 = p.awaken ? prioTarget(q => q.id !== best.id && q.hand.length > 0) : null;
            sc.push({ v: 3.2, d: { kind: 'skill', name: 'kouhai', targetId: best.id, targetId2: t2 ? t2.id : undefined } });
          }
        }
        break;
      case 'chaoti':
        if (has('chao') && p.hand.length >= 1 && g.deck.length >= 1)
          sc.push({ v: 3.2, d: { kind: 'skill', name: 'chao' } });
        break;
      case 'shuiqun':
        if (has('shuiqun') && p.hand.length >= 1)
          sc.push({ v: 2.8, d: { kind: 'skill', name: 'shuiqun' } });
        break;
      case 'baoling':
        if (has('baoling') && p.hand.length >= 1) {
          const tp = prioTarget();
          if (tp) sc.push({ v: (tp.hp <= 1 ? 5.5 : 3.2) + (pol.attackPrio ? pol.attackPrio(tp.id) * 0.4 : 0), d: { kind: 'skill', name: 'baoling', targetId: tp.id } });
        }
        break;
      case 'tuling':
        if (has('dianji') && !p.usedDianji)
          sc.push({ v: 7.5, d: { kind: 'skill', name: 'dianji' } });
        break;
      default: break;
    }
    for (const s2 of sc) add(s2.v * pol.weights.skill, s2.d);

    /* 难度应用与选择 */
    if (!cands.length) return { kind: 'end' };
    for (const cd of cands) cd.score += rnd() * 0.001; // 平局抖动
    cands.sort((a, b) => b.score - a.score);
    let pickIdx = 0;
    if (DIFF().willRandomTarget(diff, rnd) || !diff.useThreatModel) pickIdx = Math.floor(rnd() * cands.length);
    if (DIFF().willErr(diff, rnd)) {
      if (rnd() < 0.5) pickIdx = Math.floor(rnd() * cands.length);
      else if (p.hp > 2) return { kind: 'end' }; // 犯错: 空过
    }
    if (cands[pickIdx].score < 0.4) return { kind: 'end' }; // 余下全是低价值, 不空转
    const out = cands[pickIdx].desc;
    out.score = Math.round(cands[pickIdx].score * 100) / 100; // 调试可见, 无副作用
    return out;
  }

  /* ---------- 响应决策: chooseResponse ---------- */
  /* 锦囊对"我/我方主公"是否有害(特判决策用) */
  function harmfulTrick(g, pid, prompt) {
    const p = g.players[pid];
    const tk = prompt.trickKey;
    const inner = prompt.ctx && prompt.ctx.cont && prompt.ctx.cont.ctx;
    let targetId = (inner && inner.targetId !== undefined) ? inner.targetId
      : (prompt.ctx && prompt.ctx.targetId !== undefined) ? prompt.ctx.targetId
      : prompt.target;
    const harmfulList = ['dismantle', 'steal', 'pierce', 'o2', 'duel', 'duelEvo', 'skipPlay',
      'delaySkipPlay', 'delaySkipDraw', 'funReport', 'funArgue', 'killUnit', 'killUnitEvo', 'ub',
      'aoeAtk', 'aoeAtkEvo', 'aoeDodge', 'aoeDodgeEvo'];
    if (harmfulList.indexOf(tk) < 0) {
      if (tk === 'harvest') { // 抵消敌方选牌
        const pickerId = prompt.ctx && prompt.ctx.order ? prompt.ctx.order[prompt.ctx.pos] : null;
        if (pickerId != null) return SC().hostilityOf(g, pid, pickerId) >= 0.5;
      }
      return false;
    }
    const lord = lordOf(g);
    const targetsMe = targetId === pid;
    const targetsLord = lord && targetId === lord.id;
    return targetsMe || (p.identity === 'loyal' && targetsLord);
  }

  function chooseResponse(g, pid, prompt, opts) {
    opts = opts || {};
    if (!prompt || !prompt.type) return null;
    const p = g.players[pid];
    if (!p || p.dead) return null;
    const diff = DIFF().get(opts.difficulty);
    const rnd = typeof opts.rnd === 'function' ? opts.rnd
      : (typeof g.rnd === 'function' ? g.rnd : Math.random);
    const pol = POL().policyFor(g, pid);
    const pid_ = prompt.id;

    switch (prompt.type) {
      case 'dodge': {
        const ctx = prompt.ctx || {};
        const dmg = prompt.dmg || 1;
        /* 卖队友转嫁同意(betrayConsent): 存活 + (转嫁者是我方 或 内奸平衡) 才接 */
        if (ctx.betrayConsent) {
          const betrayer = ctx.betrayer != null ? g.players[ctx.betrayer] : null;
          const surv = p.hp - dmg > 0;
          const ally = betrayer && (POL().allyWeight(g, pid, betrayer.id) >= 0.6);
          const yes = surv && (ally || (p.identity === 'traitor' && POL().sideBalance(g, pid).rebelStrong && betrayer && SC().identityBelief(g, pid, betrayer.id).rebel > 0.5));
          return { kind: 'respondDodge', yes, promptId: pid_ };
        }
        /* 我是被攻击者且持卖队友: 濒死/低血时转嫁给最大威胁 */
        if (ctx.betrayAvail && !g.usedBetray && p.hand.some(c => c.key === 'funBetray')
            && (p.hp - dmg <= 0 || p.hp <= 2)) {
          const others = g.players.filter(q => !q.dead && q.id !== pid && q.id !== prompt.attacker);
          if (others.length) {
            let best = null, bestPr = -1;
            for (const q of others) {
              const pr = SC().attackPriority(g, pid, q.id);
              if (pr > bestPr && q.hp > dmg) { bestPr = pr; best = q; }
            }
            if (best) return { kind: 'respondBetray', targetId: best.id, promptId: pid_ };
          }
        }
        const target = prompt.target != null ? g.players[prompt.target] : null;
        if (!target) return null;
        /* 护驾: 忠臣替主公出闪(更积极) */
        if (target.id !== pid && target.id === (lordOf(g) || {}).id && p.identity === 'loyal'
            && pol.protectLord >= 0.8 && canDodge(g, p) && p.hp >= 2) {
          return { kind: 'respondDodge', yes: true, helperId: pid, promptId: pid_ };
        }
        /* 主公被攻: 自闪 或 求护驾(选信念上最像忠臣的帮手) */
        const iAmLord = target.id === pid && p.identity === 'lord';
        if (iAmLord) {
          if (canDodge(g, p)) return { kind: 'respondDodge', yes: true, promptId: pid_ };
          const helpers = (prompt.helpers || []).map(h => g.players[h.id]).filter(q => q && !q.dead && canDodge(g, q));
          if (helpers.length && pol.useGuardDodge >= 0.8) {
            helpers.sort((a, b) => SC().identityBelief(g, pid, b.id).loyal - SC().identityBelief(g, pid, a.id).loyal);
            return { kind: 'respondDodge', yes: true, helperId: helpers[0].id, promptId: pid_ };
          }
          return { kind: 'respondDodge', yes: false, promptId: pid_ };
        }
        if (target.id !== pid) return null; // 非本人非主公: 由护驾逻辑另行决策
        /* 普通闪避: 阈值 + 溢出 + EV */
        if (!canDodge(g, p)) return { kind: 'respondDodge', yes: false, promptId: pid_ };
        let yes = false;
        if (p.hp <= diff.dodgeHpThreshold) yes = true;
        else if (diff.overflowDodge && p.hand.length > SC().handLimit(p)) yes = true;
        else if (diff.useThreatModel && p.hp - dmg <= 0 && !hasSelfSave(g, p)) yes = true;
        else if (diff.useThreatModel) {
          const lossVal = Math.min(dmg, p.hp) * 6;
          const dodgeCard = p.hand.find(c => isDodgeKey(c.key));
          const waVal = (dodgeCard && dodgeCard.key === 'dodgeEvo' ? 7 : 5) * diff.retentionBias + 1.5;
          yes = lossVal > waVal;
        }
        return { kind: 'respondDodge', yes, promptId: pid_ };
      }
      case 'counter': {
        const harmful = harmfulTrick(g, pid, prompt);
        const hasCounter = p.hand.some(c => c.key === 'counter' || c.key === 'counterEvo') && p.mp >= 1;
        const chain = prompt.ctx && prompt.ctx.type === 'counterChain';
        const depth = chain ? (prompt.ctx.depth || 0) : 0;
        /* 链语义: 奇数张特判抵消原锦囊; 深度d的询问=我将成为第(d+1)张 → 有害则需总数为奇 */
        const want = chain ? (harmful ? depth % 2 === 0 : depth % 2 === 1) : harmful;
        if (!hasCounter || !want) return { kind: 'respondCounter', yes: false, promptId: pid_ };
        let yes;
        if (!diff.useIdentityPolicy) yes = rnd() < diff.counterValue; // easy: 近似随机(常否)
        else if (pol.saveCounterFor.indexOf(prompt.trickKey) >= 0) yes = true; // 保留清单关键锦囊
        else yes = rnd() < diff.counterValue * 0.7 + (diff.evDepth >= 2 ? 0.25 : 0);
        return { kind: 'respondCounter', yes, promptId: pid_ };
      }
      case 'aoeResp': {
        const tk = prompt.trickKey;
        if (tk === 'aoeAtk' || tk === 'aoeAtkEvo') {
          const cnt = p.hand.filter(c => isAttackKey(c.key)).length;
          const yes = cnt > 0 && (p.hp <= diff.dodgeHpThreshold || cnt >= 2);
          return { kind: 'respondAoeResp', yes, promptId: pid_ };
        }
        /* aoeDodge */
        const cnt = p.hand.filter(c => isDodgeKey(c.key)).length;
        const yes = cnt > 0 && p.mp >= 1 && (p.hp <= diff.dodgeHpThreshold || cnt >= 2 || p.hand.length > SC().handLimit(p));
        return { kind: 'respondAoeResp', yes, promptId: pid_ };
      }
      case 'argueResp': {
        /* yes=弃1张, no=受1伤 */
        const junk = p.hand.some((c, i) => SC().keepValue(g, pid, i) < 2);
        const yes = junk && p.hp > 2;
        return { kind: 'respondAoeResp', yes, promptId: pid_ };
      }
      case 'harvest': {
        const cards = (prompt.ctx && prompt.ctx.cards) || [];
        if (!cards.length) return { kind: 'respondHarvest', choiceKey: null, promptId: pid_ };
        let best = null, bestV = -Infinity;
        for (const c of cards) {
          let v = SC().cardBaseValue(c.key);
          if (isAttackKey(c.key)) v += (p.identity === 'rebel' ? 1.5 : 0.5);
          if (isDodgeKey(c.key)) v += ((p.identity === 'lord' || p.identity === 'loyal') ? 1 : 0.3) + (p.hp <= 2 ? 1.2 : 0);
          if (c.key === 'heal' || c.key === 'cheat') v += (p.hp < p.maxHp ? 2 : -2);
          if (c.key === 'counter' || c.key === 'counterEvo') v += 0.6;
          if (v > bestV) { bestV = v; best = c.key; }
        }
        return { kind: 'respondHarvest', choiceKey: best, promptId: pid_ };
      }
      case 'report': {
        const cards = (prompt.ctx && prompt.ctx.cards) || [];
        let best = null, bestV = -Infinity;
        for (const c of cards) {
          const v = SC().cardBaseValue(c.key);
          if (v > bestV) { bestV = v; best = c.key; }
        }
        return { kind: 'respondReport', cardKey: best, promptId: pid_ };
      }
      case 'cold': {
        const tgt = g.players[prompt.target];
        let yes = false;
        if (tgt && !tgt.dead && tgt.hand.length >= 2) {
          const lordFresh = tgt.id === (lordOf(g) || {}).id && tgt.armor && tgt.armor.key === 'aShield' && !tgt.armorCount.shield;
          yes = tgt.hp >= 2 && (tgt.hp > 2 || lordFresh); // 伤害打不动/被护盾吞时改拆牌
        }
        return { kind: 'respondCold', yes, promptId: pid_ };
      }
      case 'bbst': {
        const junk = p.hand.some((c, i) => SC().keepValue(g, pid, i) < 2.5);
        const tgt = g.players[prompt.target];
        const yes = junk && tgt && !tgt.dead && (diff.useThreatModel || p.hand.length >= 3);
        return { kind: 'respondBbst', yes, promptId: pid_ };
      }
      case 'chase': {
        const tgt = g.players[prompt.target];
        const yes = p.hand.some(c => isAttackKey(c.key)) && tgt && !tgt.dead;
        return { kind: 'respondChase', yes, promptId: pid_ };
      }
      default:
        return null;
    }
  }

  /* ---------- 回合末弃牌: discardChoice ---------- */
  function discardChoice(g, pid, opts) {
    const p = g.players[pid];
    if (!p || p.dead) return [];
    const limit = SC().handLimit(p);
    const over = p.hand.length - limit;
    if (over <= 0) return [];
    const idxs = p.hand.map((c, i) => ({
      i,
      v: SC().keepValue(g, pid, i) + (isAttackKey(c.key) ? 0.2 : 0) + (isDodgeKey(c.key) ? 0.1 : 0),
    })).sort((a, b) => a.v - b.v);
    return idxs.slice(0, over).map(x => x.i).sort((a, b) => b - a); // 降序, discardCards 友好
  }

  /* ---------- 描述符执行: applyAction ---------- */
  function applyAction(g, pid, desc) {
    if (!desc || desc.kind === 'end') return { ok: true, result: 'end' };
    switch (desc.kind) {
      case 'play': return core().playCard(g, pid, desc.cardIdx, desc.targetId, desc.targetId2);
      case 'equip': return core().equipCard(g, pid, desc.cardIdx);
      case 'deploy': return core().deployUnit(g, pid, desc.cardIdx);
      case 'skill': return nsEngine.skills.skillUse(g, pid, desc.name, desc.targetId, desc.targetId2);
      case 'unitAttack': return nsEngine.skills.unitAttack(g, pid, desc.unitIdx, desc.victimPid);
      case 'kspAttack': return nsEngine.tricks.kspAttack(g, pid, desc.targetId);
      case 'fangAttack': return nsEngine.tricks.fangAttack(g, pid, desc.targetIds, desc.cardIdx);
      case 'funFallback': return nsEngine.tricks.discardFun(g, pid, desc.cardIdx, desc.targetId);
      case 'discard': return core().discardCards(g, pid, desc.indices);
      case 'respondDodge': return nsEngine.battle.respondDodge(g, pid, desc.yes, desc.helperId, desc.promptId);
      case 'respondBetray': return nsEngine.battle.respondBetray(g, pid, desc.targetId, desc.promptId);
      case 'respondCounter': return nsEngine.tricks.respondCounter(g, pid, desc.yes, desc.promptId);
      case 'respondAoeResp': return nsEngine.tricks.respondAoeResp(g, pid, desc.yes, desc.promptId);
      case 'respondHarvest': return nsEngine.tricks.respondHarvest(g, pid, desc.choiceKey, desc.promptId);
      case 'respondReport': return nsEngine.tricks.respondReport(g, pid, desc.cardKey, desc.promptId);
      case 'respondCold': return nsEngine.battle.respondCold(g, pid, desc.yes, desc.promptId);
      case 'respondBbst': return nsEngine.battle.respondBbst(g, pid, desc.yes, desc.promptId);
      case 'respondChase': return nsEngine.battle.respondChase(g, pid, desc.yes, desc.promptId);
      default: return { ok: false, why: '未知动作: ' + (desc.kind || '?') };
    }
  }

  const api = {
    chooseAction, chooseResponse, discardChoice, applyAction, DESCRIPTOR_KINDS,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  me.heuristics = api;
})(typeof window !== 'undefined' ? window : globalThis);
