/* ============================================================================
 * OI杀 v4.0 · src/ai/scorer.js — 场景评分器 (P3-1 / P3-4)
 * 设计约束(recon-02 P3-4): AI 之间不"上帝视角" —— 只用公开信息 + 身份概率估计。
 *   - identityBelief: 主公身份公开 / 阵亡身份公开(内奸例外, 由规则反推) /
 *     挡刀(blockTimes)与【护驾】日志=忠臣铁证 / 【颓废标记】日志=内奸铁证 /
 *     缴获主公装备、对主公丢延时牌等行为证据 → 对数权重 softmax。
 *   - scoreCard: 每张手牌场景效用(攻击价值/WA保留/桃时机/装备槽位收益/欢乐牌双轨)。
 *   - scoreTarget: 目标威胁分(血量、身份概率、防具、守擂单位、觉醒状态)。
 * 纯函数族: 只读 g, 不修改任何状态(身份估计不读存活暗置身份字段, 主公除外)。
 * 依赖: 只读引擎的 effectiveCost/spec(合法性与费用以引擎为准, 不自行复制规则)。
 * 挂载: 共享命名空间 OIKill.ai.scorer
 * ==========================================================================*/
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};
  const nsData = NS.data = NS.data || {};
  const nsEngine = NS.engine = NS.engine || {};
  const me = NS.ai = NS.ai || {};
  if (typeof module !== 'undefined' && module.exports) {
    /* Node: 填充共享命名空间(只读依赖, 不修改引擎) */
    require('../data/cards.js');
    require('../data/professions.js');
    require('../data/identities.js');
    if (!nsEngine.core) require('../engine/core.js');
  }

  const spec = (key) => nsData.cards.CARDS[key];
  const isAttackKey = (k) => nsData.cards.isAttackKey(k);
  const isDodgeKey = (k) => nsData.cards.isDodgeKey(k);
  const core = () => nsEngine.core;

  /* ---------- 价值常量(调参入口, P3-6 经 ai-stats 收敛) ---------- */
  const HP_W = 6;      // 1 点体力价值
  const CARD_W = 3;    // 1 张牌价值
  const MP_W = 0.8;    // 1 点灵感价值

  /* 卡牌静态基础价值(双轨/兜底/换装比较用) */
  const BASE = {
    attack: 6, attackEvo: 9, dodge: 5, dodgeEvo: 7, heal: 6, healEvo: 9, coffee: 3.5, coffeeEvo: 5.5,
    duel: 5, duelEvo: 7, dismantle: 4, draw2: 5, steal: 5, skipPlay: 5, o2: 7, pierce: 5,
    cheat: 5, recover: 4, gift: 1, aoeAtk: 8, aoeAtkEvo: 10, aoeDodge: 8, aoeDodgeEvo: 10,
    allHeal: 6, harvest: 5, delaySkipPlay: 4, delaySkipDraw: 4, ub: 1, counter: 6, counterEvo: 8,
    killUnit: 4, killUnitEvo: 5, peek: 2.5, mull: 3,
    funBetray: 6, funLie: 5, funReport: 5, funClone: 5, funGiveup: 4, funPower: 5, funArgue: 5, funCcf: 6,
    wLiannu: 8, wQgj: 9, wTree: 5, wSeg: 6, wTwoPtr: 6.5, wCold: 7, wBbst: 8.5, wKsp: 7, wFang: 8, wBa: 7, wChase: 7,
    aXuan: 6, aHei: 6, aAc: 8, aDsu: 6, aMemo: 6.5, aFw: 6.5, aRam: 8, aDual: 7, aBattery: 9.5, aShield: 10,
    uGuard: 7, uBlitz: 5.5, uDeath: 4.5, uPeek: 3.5, uDeath2: 4.5, uStr: 4, uGuard2: 8, uBlitz2: 5, uGuardEvo: 9,
  };
  function cardBaseValue(key) { return BASE[key] !== undefined ? BASE[key] : 2.5; }

  /* ---------- 公共信息工具 ---------- */
  function alive(g) { return g.players.filter(q => !q.dead); }
  function others(g, pid) { return g.players.filter(q => !q.dead && q.id !== pid); }
  function costOf(g, p, key) { return core().effectiveCost(g, p, key); }
  function handLimit(p) { return 5 + (p.handLimitBonus || 0) + (p.prof.id === 'tuling' && p.usedDianji ? 2 : 0); }
  /* 主公: 全场唯一公开身份(requirement 2.2), 允许读身份字段定位 */
  function lordOf(g) { return g.players.find(q => q.identity === 'lord'); }

  /* ---------- 身份概率估计(P3-4: 无上帝视角) ---------- */
  const IDS = ['lord', 'loyal', 'rebel', 'traitor'];
  /* 敌对矩阵: 行=观察者身份(自己知道), 列=被观察者身份 */
  const HOSTILITY = {
    lord:    { lord: 0,   loyal: 0,   rebel: 1.0, traitor: 1.0 },
    loyal:   { lord: 0,   loyal: 0,   rebel: 1.0, traitor: 0.8 },
    rebel:   { lord: 1.0, loyal: 0.9, rebel: 0,   traitor: 0.4 },
    traitor: { lord: 0.5, loyal: 0.5, rebel: 0.5, traitor: 0 },
  };
  function zeroB() { return { lord: 0, loyal: 0, rebel: 0, traitor: 0 }; }
  function softmaxW(w) {
    let mx = -Infinity;
    for (const k of IDS) mx = Math.max(mx, w[k]);
    let s = 0; const out = zeroB();
    for (const k of IDS) { out[k] = Math.exp(w[k] - mx); s += out[k]; }
    for (const k of IDS) out[k] = s > 0 ? out[k] / s : 0.25;
    return out;
  }
  /* 由公开信息 + 规则知识推断身份概率(和为1)。
   * 证据来源(全部公开): 挡刀计数 / 护驾·挡刀·颓废标记·缴获主公装备·对主公延时牌等日志;
   * 阵亡身份公开(内奸例外 → 按规则反推=内奸); 存活暗置身份字段一律不读(主公除外)。 */
  function identityBelief(g, viewerId, targetId) {
    const v = g.players[viewerId];
    const t = g.players[targetId];
    if (!t) return { lord: 0.25, loyal: 0.25, rebel: 0.25, traitor: 0.25 };
    if (t.identity === 'lord') return { lord: 1, loyal: 0, rebel: 0, traitor: 0 }; // 主公公开
    if (targetId === viewerId) { const b = zeroB(); b[v.identity] = 1; return b; } // 自己身份自知
    if (t.dead) {
      /* 阵亡公开身份(2.4): 反贼/忠臣/主公公开; 内奸例外(离场投降除外) → 未见公开=按规则反推为内奸 */
      const deathLine = (g.log || []).find(l => l.txt.indexOf(t.name + ' 阵亡') >= 0);
      if (deathLine && deathLine.txt.indexOf('身份:') >= 0) {
        const name = deathLine.txt.slice(deathLine.txt.indexOf('身份:') + 3).trim();
        const map = { 'Au选手': 'lord', 'Ag选手': 'loyal', '反贼': 'rebel', '摸鱼怪': 'traitor' };
        const k = map[name];
        if (k) { const b = zeroB(); b[k] = 1; return b; }
      }
      if (t.left) { const b = zeroB(); b.traitor = 1; return b; } // 离场公开(含内奸)
      return { lord: 0, loyal: 0, rebel: 0, traitor: 1 }; // 规则反推: 不公开⇒内奸
    }
    /* 存活暗置身份: 先验 = ID_TABLE 人数表扣除(主公/自己/已公开阵亡者) */
    const n = g.players.length;
    const tbl = nsData.identities.ID_TABLE[n] || [1, 1, 2, 1];
    const remaining = { lord: Math.max(0, tbl[0] - 1), loyal: tbl[1], rebel: tbl[2], traitor: tbl[3] }; // 主公已知
    remaining[v.identity] = Math.max(0, remaining[v.identity] - 1); // 观察者自己
    for (const q of g.players) {
      if (q.dead && q.id !== targetId) {
        const b = identityBelief(g, viewerId, q.id);
        if (b.lord === 1) remaining.lord = Math.max(0, remaining.lord - 1);
        else if (b.loyal === 1) remaining.loyal = Math.max(0, remaining.loyal - 1);
        else if (b.rebel === 1) remaining.rebel = Math.max(0, remaining.rebel - 1);
        else if (b.traitor === 1) remaining.traitor = Math.max(0, remaining.traitor - 1);
      }
    }
    const total = remaining.lord + remaining.loyal + remaining.rebel + remaining.traitor;
    const w = {};
    for (const k of IDS) w[k] = Math.log(total > 0 ? Math.max(remaining[k], 0.05) / total : 0.25);

    /* 行为证据(日志与计数器, 全部公开; 权重对数域, 封顶防过饱和) */
    const ln = g.log || [];
    const lordName = (lordOf(g) || {}).name || '';
    const bump = (k2, d) => { w[k2] = Math.min(10, Math.max(-10, w[k2] + d)); };
    if (t.blockTimes > 0) { bump('loyal', 8); bump('rebel', -4); } // 挡刀为忠臣专属
    if (t.kills > 0) { bump('loyal', 0.25); bump('traitor', 0.3); }
    for (const l of ln) {
      const txt = l.txt || '';
      if (txt.indexOf(t.name) < 0) continue;
      if (txt.indexOf('消耗【颓废标记】') >= 0) { bump('traitor', 8); continue; } // 内奸铁证
      if (txt.indexOf('【护驾】') >= 0 || (txt.indexOf('替') >= 0 && txt.indexOf('抵挡') >= 0)) bump('loyal', 2);
      if (txt.indexOf('【挡刀】') >= 0) bump('loyal', 8);
      if (lordName && txt.indexOf('缴获' + lordName + '的') >= 0) { bump('rebel', 2); bump('loyal', -1.5); }
      if (lordName && txt.indexOf('对' + lordName + '使用【') >= 0) {
        if (txt.indexOf('玄学优化') >= 0) bump('loyal', 1.5); // 馈赠主公=示忠
        else { bump('rebel', 1.5); bump('loyal', -1); }
      }
      if (txt.indexOf(' 击杀 ') >= 0) {
        const vn = txt.slice(txt.indexOf(' 击杀 ') + 4).trim();
        const victim = g.players.find(q => q.name === vn);
        if (victim) {
          if (victim.identity === 'lord' || victim.identity === 'loyal') { bump('rebel', 1.5); bump('loyal', -1.2); }
          else if (victim.identity === 'rebel') { bump('loyal', 1.5); bump('rebel', -1); }
          /* 被杀者为暗置身份(未翻牌前)不构成证据 */
        }
      }
    }
    return softmaxW(w);
  }

  /* 观察者视角: 目标对"我"的敌意(0=友, 1=敌; 信念加权) */
  function hostilityOf(g, pid, targetId) {
    const p = g.players[pid];
    const b = identityBelief(g, pid, targetId);
    const row = HOSTILITY[p.identity] || HOSTILITY.lord;
    let h = 0;
    for (const k of IDS) h += b[k] * row[k];
    return Math.max(0, Math.min(1, h));
  }

  /* ---------- 目标威胁分(P3-1) ---------- */
  /* 威胁分: 血量/身份概率估计/防具/守擂单位/觉醒状态; 只读公开信息 */
  function scoreTarget(g, pid, targetId) {
    const q = g.players[targetId];
    if (!q || q.dead || targetId === pid) return 0;
    const h = hostilityOf(g, pid, targetId);
    if (h <= 0.001) return 0.001; // 友方近乎无威胁
    let danger = 1;
    if (q.weapon) danger += 0.25;                        // 持械
    if (q.awaken) danger += 0.3;                         // 觉醒增益
    if (q.armor) danger += q.armor.key === 'aShield' ? 0.55 : 0.4; // 防具(护盾最硬)
    if (q.units && q.units.length) danger += 0.15 * Math.min(2, q.units.length); // 守擂等
    if (q.dmgBonus > 0) danger += 0.12;
    if (q.hp <= Math.floor(q.maxHp / 2)) danger -= 0.2;  // 残血威胁下降(终结价值由 attackPriority 另计)
    danger += 0.12 * Math.min(6, q.hand.length) / 6;
    return h * danger;
  }
  /* 攻击优先级 = 威胁分 + 终结价值(残血收割) */
  function attackPriority(g, pid, targetId) {
    const q = g.players[targetId];
    if (!q || q.dead || targetId === pid) return 0;
    const finish = q.hp <= 1 ? 3 : ((q.maxHp - q.hp) / q.maxHp) * 1.8;
    return scoreTarget(g, pid, targetId) + finish;
  }
  /* 按威胁分降序的敌方清单(供 heuristics/自测) */
  function threatList(g, pid) {
    return others(g, pid).map(q => ({
      id: q.id, hp: q.hp, maxHp: q.maxHp,
      threat: scoreTarget(g, pid, q.id),
      priority: attackPriority(g, pid, q.id),
      hostility: hostilityOf(g, pid, q.id),
      belief: identityBelief(g, pid, q.id),
    })).sort((a, b) => b.threat - a.threat);
  }

  /* ---------- 手牌场景效用(P3-1) ---------- */
  function maxHostility(g, pid) {
    let m = 0;
    for (const q of others(g, pid)) m = Math.max(m, hostilityOf(g, pid, q.id));
    return m;
  }
  /* 打出价值: 现在用掉这张牌的收益 */
  function playValue(g, pid, cardIdx) {
    const p = g.players[pid];
    const c = p.hand[cardIdx];
    if (!c) return 0;
    const key = c.key, s = spec(key);
    const cost = costOf(g, p, key);
    const noMp = p.mp < cost;
    const foes = others(g, pid);
    const hos = maxHostility(g, pid);
    if (s.type === 'equip') {
      if (noMp) return 0.3;
      const cur = s.slot === 'weapon' ? p.weapon : p.armor;
      let v = cardBaseValue(key) - (cur ? cardBaseValue(cur.key) * 0.85 : 0) + 0.6;
      if (p.identity === 'lord' && s.slot === 'armor' && cur && cur.key === 'aShield') v -= 2.5; // 主公护盾宝贵
      return Math.max(0.2, v);
    }
    if (s.type === 'unit') {
      if (noMp) return 0.3;
      let v = cardBaseValue(key) * 0.9;
      if (s.guard) v *= 0.7 + 0.25 * (p.hp <= 3 ? 1 : 0) + 0.3 * hos; // 守擂保核心
      if (s.blitz) v *= 0.8 + 0.4 * (foes.some(q => q.units.length > 0) ? 1 : 0);
      if (s.death) v *= 0.8; // 亡语过牌
      return v;
    }
    switch (key) {
      case 'attack': case 'attackEvo': {
        if (!p.canAttack || noMp || foes.length === 0) return 0.3;
        const dmg = key === 'attackEvo' ? 2 : 1;
        const hit = 0.55 + 0.4 * hos;
        let v = dmg * HP_W * hit + 0.8;
        if (p.weapon) {
          if (p.weapon.key === 'wQgj') v += 0.6;
          if (p.weapon.key === 'wBa') v += 1.2;
          if (p.weapon.key === 'wTwoPtr') v += 0.8;
          if (p.weapon.key === 'wTree') v += 0.4;
        }
        return v;
      }
      case 'dodge': case 'dodgeEvo': case 'counter': case 'counterEvo': case 'funBetray':
        return 0; // 响应牌, 出牌阶段不可用(保底轨另走 discardFun)
      case 'heal': case 'healEvo': {
        if (noMp || p.hp >= p.maxHp) return 0;
        const amt = key === 'healEvo' ? 2 : 1;
        let v = Math.min(amt, p.maxHp - p.hp) * HP_W * 0.9 - cost * MP_W * 0.15;
        if (key === 'healEvo') v += CARD_W; // 摸1
        return Math.max(0, v);
      }
      case 'coffee': case 'coffeeEvo': {
        if (noMp) return 0;
        const hasAtk = p.hand.some((x, i) => i !== cardIdx && isAttackKey(x.key));
        if (!hasAtk || !p.canAttack) return 0.4; // 无攻击可 buff
        const hit = 0.55 + 0.4 * hos;
        const bonus = key === 'coffeeEvo' ? 2 : 1;
        return bonus * HP_W * hit * 0.85 - cost * MP_W * 0.2;
      }
      case 'duel': case 'duelEvo': {
        const myAtk = p.hand.filter((x, i) => i !== cardIdx && isAttackKey(x.key)).length;
        const prio = threatList(g, pid).filter(x => x.hostility >= 0.4);
        const t = prio.length ? g.players[prio[0].id] : null;
        if (noMp) return 0.3;
        if (!t) return 0.6;
        let v = 1.2 + (key === 'duelEvo' ? 2 : 1) * HP_W * 0.45 * (myAtk >= 1 ? 0.85 : 0.25);
        if (t.hand.length === 0) v += 3;      // 必中
        if (t.hand.length >= 3) v -= 1.5;
        return v;
      }
      case 'dismantle': {
        const lst = threatList(g, pid).filter(x => g.players[x.id].hand.length > 0);
        const t = lst[0];
        if (noMp) return 0.3;
        if (!t) return 0.5;
        return 3 + 0.35 * Math.min(6, g.players[t.id].hand.length);
      }
      case 'steal': {
        const lst = threatList(g, pid).filter(x => (g.players[x.id].weapon || g.players[x.id].armor || g.players[x.id].hand.length > 0));
        const t = lst[0];
        if (noMp) return 0.3;
        if (!t) return 0.5;
        const q = g.players[t.id];
        if (q.weapon) return 4.5;
        if (q.armor) return 4;
        return 1.8;
      }
      case 'draw2': return noMp ? 0.3 : 4.5 + Math.max(0, 4 - p.hand.length) * 0.4;
      case 'peek': return noMp ? 0.3 : 2.2;
      case 'mull': {
        if (p.hand.length < 2) return 0; // 需另弃1张
        const junk = p.hand.some((x, i) => i !== cardIdx && keepValue(g, pid, i) < 2);
        return noMp ? 0.3 : 2.6 + (junk ? 1.2 : 0);
      }
      case 'cheat': {
        if (noMp || p.hp >= p.maxHp) return 0;
        return Math.min(1, p.maxHp - p.hp) * HP_W * 0.9 - cost * MP_W * 0.2;
      }
      case 'recover': return (noMp || g.discard.length === 0) ? 0.3 : 3.4;
      case 'gift': {
        const allies = others(g, pid).map(q => ({ id: q.id, aw: 1 - hostilityOf(g, pid, q.id) })).sort((a, b) => b.aw - a.aw);
        const best = allies[0];
        if (noMp) return 0.3;
        if (!best || best.aw < 0.55) return 1.2;
        return 4.2;
      }
      case 'skipPlay': {
        const lst = threatList(g, pid);
        const t = lst[0];
        if (noMp) return 0.3;
        if (!t) return 1.5;
        return 3 + Math.min(2.5, t.threat * 1.5);
      }
      case 'o2': {
        if (!p.hand.some((x, i) => i !== cardIdx && isAttackKey(x.key))) return 0.2; // 需弃1攻击
        const lst = threatList(g, pid);
        const t = lst[0];
        if (noMp) return 0.3;
        if (!t) return 0.6;
        return 2 * HP_W * 0.7 + Math.min(2.5, t.priority * 0.6);
      }
      case 'pierce': {
        const lst = threatList(g, pid);
        const t = lst[0];
        if (noMp) return 0.3;
        if (!t) return 0.5;
        return HP_W * 0.85 + (g.players[t.id].hp <= 1 ? 2.5 : 0);
      }
      case 'aoeAtk': case 'aoeAtkEvo': case 'aoeDodge': case 'aoeDodgeEvo': {
        let hostiles = 0, net = 0;
        for (const q of foes) {
          const h = hostilityOf(g, pid, q.id);
          if (h >= 0.5) hostiles++;
          net += h - (1 - h) * 0.6;
        }
        if (hostiles < 2 || net < 0.4 || noMp) return noMp ? 0.3 : 1.2;
        const dmg = (key === 'aoeAtkEvo' || key === 'aoeDodgeEvo') ? 2 : 1;
        return 5 + dmg * HP_W * 0.5 * hostiles * 0.7 - 1;
      }
      case 'allHeal': case 'funCcf': {
        let net = 0;
        for (const q of foes) {
          const h = hostilityOf(g, pid, q.id);
          net += (1 - h) * HP_W * 0.9 - h * HP_W * 0.9;
        }
        if (p.hp < p.maxHp) net += HP_W * 0.9;
        return noMp ? 0.3 : Math.max(1.2, net + 2);
      }
      case 'harvest': return noMp ? 0.3 : 4.2;
      case 'delaySkipPlay': case 'delaySkipDraw': {
        const lst = threatList(g, pid).filter(x => !g.players[x.id].delayArea.some(d => d.key === key));
        const t = lst[0];
        if (noMp) return 0.3;
        if (!t) return 0.6;
        return 2.2 + Math.min(2, t.threat * 1.2);
      }
      case 'ub': return 0.5; // 自爆牌, 除非山穷水尽
      case 'killUnit': case 'killUnitEvo': {
        const vic = foes.filter(q => q.units.length > 0 && hostilityOf(g, pid, q.id) >= 0.3);
        if (noMp) return 0.3;
        if (!vic.length) return 0.6;
        let v = 2.5;
        if (vic.some(q => q.units.some(u => spec(u.key).guard))) v += 2.2; // 破守擂
        if (key === 'killUnitEvo') v += CARD_W * 0.8;
        return v;
      }
      /* ---- 欢乐牌双轨: 效果价值 vs 弃置保底 ---- */
      case 'funLie': {
        const atkUseful = foes.some(q => attackPriority(g, pid, q.id) > 3);
        return noMp ? 0.4 : 2 * CARD_W + (atkUseful ? -1.5 : 0.5);
      }
      case 'funReport': {
        const lst = threatList(g, pid).filter(x => g.players[x.id].hand.length > 0);
        const t = lst[0];
        if (noMp) return 0.4;
        if (!t) return 1.5;
        return 3 + 0.5 * Math.min(6, g.players[t.id].hand.length);
      }
      case 'funClone': {
        if (g.usedClone || p.units.length === 0 || noMp) return 1.6; // 保底: 摸1
        let best = 0;
        for (const u of p.units) best = Math.max(best, cardBaseValue(u.key));
        return 2.5 + best * 0.9;
      }
      case 'funGiveup': {
        const junkCount = p.hand.filter((x, i) => i !== cardIdx && cardBaseValue(x.key) < 3.2).length;
        return noMp ? 0.4 : 2.5 + (p.hand.length >= 3 && junkCount >= 2 ? 3 : 0);
      }
      case 'funPower': {
        const owners = g.players.filter(q => !q.dead && q.units.length > 0);
        return noMp ? 0.4 : 2 + 1.6 * Math.min(2, owners.length);
      }
      case 'funArgue': {
        if (noMp) return 0.4;
        if (foes.length < 2) return 1.2;
        const pr = threatList(g, pid).slice(0, 2);
        const handSum = pr.reduce((s, x) => s + Math.min(6, g.players[x.id].hand.length), 0);
        return 2.5 + 0.3 * handSum;
      }
      default: return cardBaseValue(key) * 0.6;
    }
  }

  /* 保留价值: 留在手里的防御/时机价值 */
  function keepValue(g, pid, cardIdx) {
    const p = g.players[pid];
    const c = p.hand[cardIdx];
    if (!c) return 0;
    const key = c.key;
    const foes = others(g, pid);
    const hos = maxHostility(g, pid);
    const frac = p.maxHp > 0 ? 1 - p.hp / p.maxHp : 0;
    const maxHand = foes.length ? Math.max.apply(null, foes.map(q => q.hand.length)) : 0;
    switch (key) {
      case 'dodge': case 'dodgeEvo': {
        let v = 2.2 + 3.2 * frac + 1.1 * hos + 0.15 * Math.min(6, maxHand);
        if (key === 'dodgeEvo') v += 1.6; // 抵消后回1
        return v;
      }
      case 'counter': case 'counterEvo':
        return 2.4 + 0.35 * maxHand + (key === 'counterEvo' ? 1.4 : 0);
      case 'heal': case 'healEvo':
        return p.hp < p.maxHp ? 2 + frac * 2 : 1.6;
      case 'coffee': case 'coffeeEvo': {
        let v = p.hp <= 2 ? 9 : p.hp <= 3 ? 5 : 1.6; // 濒死自救
        if (p.identity === 'traitor') v *= 1.5;      // 内奸留进单挑
        if (key === 'coffeeEvo') v += 1.2;
        return v;
      }
      case 'attack': case 'attackEvo': return 1.4; // 对拍/AOE响应备用
      case 'funBetray': return 4.5 + 2.5 * frac;   // 一局一次转嫁
      default: return 0.8;
    }
  }

  /* 场景效用分 = max(打出价值, 保留价值×0.55): WA 在手同样计入手牌总实力 */
  function scoreCard(g, pid, cardIdx) {
    return Math.max(playValue(g, pid, cardIdx), keepValue(g, pid, cardIdx) * 0.55);
  }
  /* 手牌总实力 */
  function scoreHand(g, pid) {
    const p = g.players[pid];
    let s = 0;
    for (let i = 0; i < p.hand.length; i++) s += scoreCard(g, pid, i);
    return s;
  }

  const api = {
    cardBaseValue, identityBelief, hostilityOf,
    scoreTarget, attackPriority, threatList,
    scoreCard, playValue, keepValue, scoreHand,
    handLimit, lordOf, costOf,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  me.scorer = api;
})(typeof window !== 'undefined' ? window : globalThis);
