/* ============================================================================
 * OI杀 v4.0 · src/engine/core.js — 引擎核心: 状态/回合流程/胜负/进化/入口(P1a 拆分)
 * 拆分自 game.js(P1a 模块拆分)。行为零变更: 所有函数体与原 game.js 逐字一致,
 * 仅跨模块调用改为共享命名空间运行时引用(NS.engine.* / NS.data.*)。
 * 挂载: 共享命名空间 OIKill.engine.core
 * 导出(54 键中的 25 键): createGame, setup, startTurn, judgePhase, drawPhase,
 *   discardPhase, endTurn, playCard, equipCard, deployUnit, publicView, aiTurn,
 *   discardCards, playerLeave, nextAlive, draw, spec, effectiveCost, attackPlayer,
 *   loseHp, checkVictory, evolvePick, tryEvolve, lordCanRedraw, lordRedraw
 * 另向共享命名空间暴露内部工具(供 battle/tricks/skills 调用, 不进聚合导出):
 *   judgeCard, discardFromHand, queueEvo, onBecomeTarget, unequipArmor, unitDie,
 *   aoeOrder 及 makeRng/buildDeck 等。
 * ==========================================================================*/
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};
  const nsData = NS.data = NS.data || {};
  const nsEngine = NS.engine = NS.engine || {};
  const me = nsEngine.core = nsEngine.core || {};

  /* ---------------- RNG ---------------- */
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function buildDeck(rnd) {
    const deck = [];
    let id = 1;
    for (const key of Object.keys(nsData.cards.DECK_COUNT)) {
      for (let i = 0; i < nsData.cards.DECK_COUNT[key]; i++) {
        deck.push({
          id: id++, key, suit: nsData.identities.SUITS[Math.floor(rnd() * 4)],
          num: 1 + Math.floor(rnd() * 13),
        });
      }
    }
    // 洗牌
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
  }

  /* ---------------- 游戏状态 ---------------- */
  function createGame(opts) {
    const rnd = makeRng(opts.seed || Date.now());
    const g = {
      rnd, log: [], over: false, winner: null, round: 1, turn: 0,
      players: [], deck: [], discard: [], event: null, eventSuit: null,
      reshuffleCount: 0, pending: null, // {type, target, attacker, ctx}
      human: opts.human ?? 0, // 人类玩家下标(用于AI托管判定)
      achievements: {}, kills: {}, // 成就与击杀记录
      turnAttacked: {}, // 每回合是否已使用做法假了(评测机连发/次数)
      nextRoundAttackCost: 0, // 感谢CCF 下回合攻击费+1
      usedBetray: false, usedClone: false, // 欢乐牌一局一次标记(全局简化)
      pendingEvo: {}, // pid -> [候选进化牌型key]
      evoWait: null, // 人类待选择进化 {pid, keys}
    };
    g.log.push({ t: 0, txt: '=== OI杀 v4.0 开局 ===', cls: 'evt' });
    return g;
  }

  function setup(g, names) {
    const n = names.length;
    const [nl, nlo, nr, nt] = nsData.identities.ID_TABLE[n] || [1, 1, 2, 1];
    const ids = ['lord'];
    for (let i = 0; i < nlo; i++) ids.push('loyal');
    for (let i = 0; i < nr; i++) ids.push('rebel');
    for (let i = 0; i < nt; i++) ids.push('traitor');
    // 洗身份(主公固定给0号)
    const rest = ids.slice(1);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(g.rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    const idOrder = ['lord'].concat(rest);

    // 随机职业
    const profPool = nsData.professions.PROFESSIONS.slice();
    for (let i = profPool.length - 1; i > 0; i--) { const j = Math.floor(g.rnd() * (i + 1)); [profPool[i], profPool[j]] = [profPool[j], profPool[i]]; }

    g.deck = buildDeck(g.rnd);
    g.discard = [];
    g.event = { name: '暂无事件', desc: '首轮结束翻事件牌触发' };
    g.eventSuit = null;
    g.lordRedrawUsed = false;
    g.ccfRound = -99; // 感谢CCF生效轮
    g.lordDamagedLoyal = false; // 明君成就
    g.players = names.map((name, i) => {
      const prof = profPool[i % profPool.length];
      const isLord = idOrder[i] === 'lord';
      const maxHp = prof.hp + (isLord ? 2 : 0);
      return {
        id: i, name, identity: idOrder[i],
        prof, maxHp, hp: maxHp,
        mp: isLord ? 5 : 3, mpMax: isLord ? 5 : 3, // 主公首回合5,他人3(M15:首回合不加成)
        hand: [], weapon: null, armor: null, units: [],
        awaken: false, dead: false, skipPlay: false, skipDraw: false,
        delayArea: [], coffee: false, coffeeDmg: 1, attackUsed: false, attackTimes: 0,
        canAttack: true, // 躺赢禁攻
        handLimitBonus: prof.id === 'tuling' ? 1 : 0,
        depression: idOrder[i] === 'traitor' ? 1 : 0,
        damageDealt: 0, kills: 0, blockTimes: 0, noDamageRounds: 0,
        usedMentor: false, usedSeal: false, usedDianji: false, usedRetire: false,
        yaxianUsed: false, dodgeUsedThisTurn: false, chaseUsed: false,
        armorCount: {}, // 每回合首次类计数
        domainDiscounted: false, // 领域亲和每回合首次
        dmgBonus: 0,
        healUses: 0, coffeeTurn: false, aoeFlag: null, evoTotal: 0, // 进化相关
        betrayTo: null, // 卖队友转嫁目标(旧机制占位,已弃用)
        askedThisTurn: false, skirtThisTurn: false, // 萌新问问题/女装大佬·女装(每回合限1次)
        blockedThisTurn: false, blockTimes: 0, // 忠臣挡刀
        killedLord: false, // 掀翻成就
        turnsPlayed: 0, skipPlayNext: false, // 停课集训延迟标记
        usedSkillsThisTurn: {}, // 主动技每回合1次
        akioiDmg: 0, kachangFlag: false, // 神犇AKIOI/毒瘤卡常
        funShield: false, baolingBonus: 0, // 卖队友保底/爆零觉醒
        coffeeSaveUsedThisTurn: false, // 咖啡濒死自救每回合1次
        usedSeal: false, teachBonus: false, // 封神限定/学长觉醒
      };
    });
    for (let i = 0; i < g.players.length; i++) draw(g, i, 4);
    // 主公开局赠【评测机护盾】(占防具栏,可被拆;假牌不入守恒)
    g.players[0].armor = { key: 'aShield', id: -1, suit: 'heart', num: 1 };
    g.turn = 0;
    g.log.push({ t: 0, txt: `牌桌开启: ${names.length} 人局 · 0号(${names[0]})为${nsData.identities.IDENTITIES.lord.name}`, cls: 'act' });
    for (const p of g.players) {
      g.log.push({ t: 0, txt: `${p.name} 获得职业【${p.prof.name}】(${p.prof.plain})`, cls: '' });
    }
    return g;
  }

  /* ---------------- 基础操作 ---------------- */
  function spec(key) { return nsData.cards.CARDS[key]; }
  function cardName(c) { return spec(c.key); }
  function draw(g, pid, n) {
    const p = g.players[pid];
    for (let i = 0; i < n; i++) {
      if (g.deck.length === 0) {
        // 题海战术: 弃牌堆洗回, 全体-1体力(评测机过载)
        if (g.discard.length === 0) break;
        g.deck = g.discard.slice();
        g.discard = [];
        for (let i2 = g.deck.length - 1; i2 > 0; i2--) { const j = Math.floor(g.rnd() * (i2 + 1)); [g.deck[i2], g.deck[j]] = [g.deck[j], g.deck[i2]]; }
        g.reshuffleCount++;
        g.log.push({ t: g.round, txt: `题海战术!牌堆洗回,全体失去1点体力(评测机过载)` , cls: 'evt' });
        for (const q of g.players) if (!q.dead) { loseHp(g, q.id, 1, null, 'overload'); }
        if (g.over) return;
        // H11: 连续两次洗牌仍无胜负 -> 保底终局
        if (g.reshuffleCount >= 2) { forceEndByCount(g); return; }
      }
      if (g.deck.length > 0) { const c = g.deck.pop(); if (c) p.hand.push(c); }
    }
  }

  function discardCard(g, c, toDiscard) {
    if (toDiscard) g.discard.push(c);
  }
  function discardFromHand(g, p, idx) {
    const c = p.hand[idx];
    p.hand.splice(idx, 1);
    if (c) g.discard.push(c); // 防御: 幻影空洞不入弃牌堆
    return c;
  }

  function effectiveCost(g, p, key) {
    const s = spec(key);
    let cost = s.cost;
    let discount = 0;
    // 领域亲和: 主领域牌每回合首次-1
    const dom = s.domain || domOf(p, key);
    if (!p.domainDiscounted && dom === p.prof.domain) { discount = Math.max(discount, 1); }
    // 评测机连发: 每回合首次做法假了-1
    if (nsData.cards.isAttackKey(key) && p.weapon && p.weapon.key === 'wLiannu' && !p.attackUsed) discount = Math.max(discount, 1);
    // 慈善评测机事件: 当轮所有牌-1
    if (g.eventSuit === 'heart') discount = Math.max(discount, 1);
    // 感谢CCF: 下一轮全体攻击费+1(M13)
    if (nsData.cards.isAttackKey(key) && g.round === g.ccfRound + 1) cost += 1;
    // 反贼首轮限制: 第一轮内攻击与单位部署+1费(H3)
    if (g.round === 1 && p.identity === 'rebel' && (nsData.cards.isAttackKey(key) || s.type === 'unit')) cost += 1;
    return Math.max(1, cost - discount);
  }
  function domOf(p, key) {
    // 单位卡带领域; 其余牌不触发领域亲和
    const s = spec(key);
    if (s.type === 'unit') return s.domain;
    return null;
  }

  function spend(g, p, cost) { p.mp -= cost; }
  function gainMp(p, n) { p.mp = Math.min(p.mpMax, p.mp + n); }

  /* ---------------- 回合流程 ---------------- */
  function startTurn(g, pid) {
    const p = g.players[pid];
    if (p.dead) return;
    if (p.turnsPlayed > 0) p.mpMax = Math.min(12, p.mpMax + 1); // M15: 首回合不加成
    p.turnsPlayed++;
    const gain = (p.armor && p.armor.key === 'aDual') ? 5 : 4;
    p.mp = Math.min(p.mpMax, p.mp + gain);
    p.domainDiscounted = false;
    p.attackUsed = false; p.attackTimes = 0;
    p.canAttack = true; p.coffee = false; p.yaxianUsed = false;
    p.chaseUsed = false; p.skipDraw = false;
    p.dodgeUsedThisTurn = false;
    p.akioiDmg = 0; p.kachangFlag = false; p.funShield = false;
    p.coffeeSaveUsedThisTurn = false;
    p.usedSkillsThisTurn = {};
    p.askedThisTurn = false; p.skirtThisTurn = false; p.blockedThisTurn = false;
    for (const k of Object.keys(p.armorCount)) p.armorCount[k] = 0;
    // 停课集训: 延迟到本回合生效(H9)
    if (p.skipPlayNext) { p.skipPlay = true; p.skipPlayNext = false; }
    else p.skipPlay = false;
    // 单位就绪(速攻部署当回合可用,其余下回合可用)
    for (const u of p.units) u.ready = true;
    // 内奸单挑: 存活2人且含内奸 -> 每回合回1(H12)
    if (p.identity === 'traitor') {
      const alive = g.players.filter(q => !q.dead);
      if (alive.length === 2) {
        p.hp = Math.min(p.maxHp, p.hp + 1);
        g.log.push({ t: g.round, txt: `${p.name}【单挑】每回合开始回复1体力`, cls: 'act' });
      }
    }

    // 觉醒判定: 体力≤上限一半 -> 立即(回合开始结算)
    checkAwaken(g, pid);

    // 锁定技
    if (p.prof.id === 'juruo' && p.hand.length === 0) { draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name}【抱大腿】空手牌摸1`, cls: '' }); }
    if (p.prof.id === 'tuiyi' && p.hp > 1) { loseHp(g, pid, 1, null, 'struggle'); draw(g, pid, 2); g.log.push({ t: g.round, txt: `${p.name}【挣扎】失去1体力摸2`, cls: '' }); }
  }

  function judgePhase(g, pid) {
    const p = g.players[pid];
    if (p.dead) return;
    const delays = p.delayArea.slice();
    p.delayArea = [];
    for (const d of delays) {
      const card = judgeCard(g); // 判定牌(置回牌堆底)
      g.log.push({ t: g.round, txt: `${p.name} 判定【${spec(d.key).name}】翻出 ${nsData.identities.suitZh[card.suit]}`, cls: 'evt' });
      if (d.key === 'delaySkipPlay') {
        g.discard.push(d); // 延时牌判定结算后进入弃牌堆
        if (card.suit !== 'heart') { p.skipPlay = true; g.log.push({ t: g.round, txt: `${p.name} 判定失败,本回合跳过行动阶段`, cls: 'bad' }); }
        else g.log.push({ t: g.round, txt: `判定红桃,无事发生`, cls: '' });
      } else if (d.key === 'delaySkipDraw') {
        g.discard.push(d);
        if (card.suit !== 'club') { p.skipDraw = true; g.log.push({ t: g.round, txt: `${p.name} 判定失败,本回合跳过摸牌阶段`, cls: 'bad' }); }
        else g.log.push({ t: g.round, txt: `判定梅花,无事发生`, cls: '' });
      } else if (d.key === 'ub') {
        if (card.suit === 'spade' && card.num >= 2 && card.num <= 9) { g.discard.push(d); g.log.push({ t: g.round, txt: `UB 命中!${p.name} 受到3点伤害`, cls: 'bad' }); loseHp(g, pid, 3, null, 'ub'); }
        else {
          // L-8: 下家已有UB则继续传(9.2)
          let cur = nextAlive(g, pid), hops = 0;
          while (cur !== -1 && cur !== pid && g.players[cur].delayArea.some(x => x.key === 'ub') && hops++ < g.players.length) cur = nextAlive(g, cur);
          if (cur !== -1 && cur !== pid) { g.players[cur].delayArea.push(d); g.log.push({ t: g.round, txt: `UB 传给 ${g.players[cur].name}`, cls: 'evt' }); }
          else g.discard.push(d);
        }
      }
    }
  }

  function drawPhase(g, pid) {
    const p = g.players[pid];
    if (p.dead) return;
    if (!p.skipDraw) {
      // 划水怪·随缘(被动): 摸牌阶段可改为摸1+弃牌堆拿1张基本牌(13章; 引擎自动择优)
      if (p.prof.id === 'huashui') {
        const bi = g.discard.findIndex(c => c && spec(c.key).type === 'basic');
        if (bi >= 0) {
          draw(g, pid, 1);
          if (g.over) return;
          // 摸1可能触发题海战术(牌堆空->弃牌堆洗回牌堆并清空): 必须重查弃牌堆,
          // 否则 splice(bi) 取回 undefined, spec(got.key) 崩溃(seed=103 间歇复现)
          const bi2 = g.discard.findIndex(c => c && spec(c.key).type === 'basic');
          const got = bi2 >= 0 ? g.discard.splice(bi2, 1)[0] : null;
          if (got) {
            p.hand.push(got);
            g.log.push({ t: g.round, txt: `${p.name}【随缘】摸1并从弃牌堆拿回【${spec(got.key).name}】`, cls: 'act' });
          } else {
            // 弃牌堆已被洗回且无基本牌: 随缘无法完成, 退化为照常摸牌(再摸1,合计摸2; 牌张守恒)
            draw(g, pid, 1);
            g.log.push({ t: g.round, txt: `${p.name}【随缘】弃牌堆被洗回无基本牌,改为照常摸牌`, cls: 'act' });
          }
          return;
        }
      }
      let n = 2;
      if (p.awaken && p.prof.id === 'mengxin') n += 1;
      draw(g, pid, n);
    }
  }

  function discardPhase(g, pid) {
    const p = g.players[pid];
    if (p.dead) return;
    const limit = 5 + p.handLimitBonus + (p.prof.id === 'tuling' && p.usedDianji ? 2 : 0);
    while (p.hand.length > limit) {
      // 弃牌自选由 UI 通过 discardCards API 预弃置; 引擎兜底自动弃第1张(移除未定义的 g.discardChoice 死引用)
      discardFromHand(g, p, 0);
      g.log.push({ t: g.round, txt: `${p.name} 弃牌(超出手牌上限)`, cls: '' });
    }
  }

  function endTurn(g, pid) {
    const p = g.players[pid];
    // 阵亡玩家同样执行轮转(修复: 死亡玩家卡死回合的bug)
    if (!p.dead) {
      // 回合结束技能
      if (p.prof.id === 'huashui') {
        if (p.damageDealt === 0) {
          if (p.awaken) { draw(g, pid, 2); g.log.push({ t: g.round, txt: `${p.name}【终极摸鱼】摸2`, cls: '' }); }
          else { draw(g, pid, 1); if (p.hand.length) discardFromHand(g, p, 0); g.log.push({ t: g.round, txt: `${p.name}【摸鱼】摸1弃1`, cls: '' }); }
        }
      }
      if (p.prof.id === 'jiaolian') {
        const others = g.players.filter(q => !q.dead && q.id !== pid);
        if (others.length) { const q = others[Math.floor(g.rnd() * others.length)]; draw(g, pid, 1); draw(g, q.id, 1); g.log.push({ t: g.round, txt: `${p.name}【集训】与${q.name}各摸1`, cls: '' }); }
      }
      if (p.damageDealt === 0) p.noDamageRounds++; else p.noDamageRounds = 0;
      if (p.prof.id === 'huashui' && p.noDamageRounds >= 2 && !p.awaken) checkAwaken(g, pid);
      // 进化条件收集(回合结束)
      if (p.coffeeTurn && p.damageDealt > 0) queueEvo(g, pid, 'coffee');
      if (p.aoeFlag && p.damageDealt > 0) queueEvo(g, pid, p.aoeFlag);
      p.coffeeTurn = false; p.aoeFlag = null;
      // 进化结算(每回合最多1次,每局最多3次)
      const evoKeys = (g.pendingEvo[pid] || []).slice();
      g.pendingEvo[pid] = [];
      if (evoKeys.length) {
        if (pid === g.human) g.evoWait = { pid, keys: evoKeys };
        else { for (const k of evoKeys) { if (tryEvolve(g, pid, k)) break; } }
      }
      p.damageDealt = 0;
    }

    // 轮转(始终执行)
    let next = nextAlive(g, pid);
    if (next === -1) return;
    if (next <= pid) {
      // 一轮结束: 翻事件牌(该牌进入弃牌堆)
      g.round++;
      // M-9: 牌堆摸空时统一走题海战术(洗回弃牌堆+全体-1+计数, 2.8/4.3), 不再静默洗回
      let card;
      if (g.deck.length) {
        card = g.deck.pop();
      } else if (g.discard.length) {
        g.deck = g.discard.slice(); g.discard = [];
        for (let i = g.deck.length - 1; i > 0; i--) { const j = Math.floor(g.rnd() * (i + 1)); [g.deck[i], g.deck[j]] = [g.deck[j], g.deck[i]]; }
        g.reshuffleCount++;
        g.log.push({ t: g.round, txt: `题海战术!牌堆洗回,全体失去1点体力(评测机过载)`, cls: 'evt' });
        for (const q of g.players) if (!q.dead) { loseHp(g, q.id, 1, null, 'overload'); }
        if (g.over) return;
        if (g.reshuffleCount >= 2) { forceEndByCount(g); return; }
        card = g.deck.pop();
      } else {
        card = { suit: 'heart', key: 'dodge' };
      }
      if (card.id) g.discard.push(card); // 事件牌结算后入弃牌堆(占位牌不入,防牌张虚增)
      g.eventSuit = card.suit;
      g.event = nsData.identities.EVENTS[card.suit];
      g.log.push({ t: g.round, txt: `评测机事件: ${nsData.identities.suitZh[card.suit]} ${g.event.name} — ${g.event.desc}`, cls: 'evt' });
      // M-9: 翻出最后一张后牌堆空 -> 同样触发题海战术(计数+过载), 不再静默洗回
      if (g.deck.length === 0 && g.discard.length > 0) {
        g.deck = g.discard.slice(); g.discard = [];
        for (let i = g.deck.length - 1; i > 0; i--) { const j = Math.floor(g.rnd() * (i + 1)); [g.deck[i], g.deck[j]] = [g.deck[j], g.deck[i]]; }
        g.reshuffleCount++;
        g.log.push({ t: g.round, txt: `题海战术!牌堆洗回,全体失去1点体力(评测机过载)`, cls: 'evt' });
        for (const q of g.players) if (!q.dead) { loseHp(g, q.id, 1, null, 'overload'); }
        if (g.over) return;
        if (g.reshuffleCount >= 2) { forceEndByCount(g); return; }
      }
      if (g.nextRoundAttackCost > 0) g.nextRoundAttackCost = 0;
    }
    g.turn = next;
    startTurn(g, next);
  }

  function nextAlive(g, pid) {
    const n = g.players.length;
    for (let i = 1; i <= n; i++) {
      const q = g.players[(pid + i) % n];
      if (!q.dead) return q.id;
    }
    return -1;
  }

  /* 判定取牌: 空仓时先把弃牌堆洗回(不触发过载), 取真牌并置回牌堆底 */
  function judgeCard(g) {
    if (g.deck.length === 0 && g.discard.length > 0) {
      g.deck = g.discard.slice();
      g.discard = [];
      for (let i = g.deck.length - 1; i > 0; i--) { const j = Math.floor(g.rnd() * (i + 1)); [g.deck[i], g.deck[j]] = [g.deck[j], g.deck[i]]; }
      g.log.push({ t: g.round, txt: '牌堆耗尽,弃牌堆洗回(判定用)', cls: 'evt' });
    }
    if (g.deck.length > 0) {
      const c = g.deck.pop();
      g.deck.unshift(c); // 判定牌结算后置回牌堆底(draw 用 pop 取牌堆顶=数组尾,故插入数组头=牌堆底)
      return c;
    }
    return { key: 'dodge', suit: 'heart', num: 1, id: -1 }; // 全场无牌: 默认红桃
  }

  /* ---------------- 伤害/濒死 ---------------- */
  function loseHp(g, pid, dmg, src, srcName) {
    const p = g.players[pid];
    if (p.dead || g.over) return;
    let d = dmg;
    // M-7: ub(锦囊)/struggle(技能)须尊重主公首轮免伤/护盾/挡刀(2.6①: 覆盖所有来源);
    // overload/guard 保留: 过载为全局规则惩罚(需求裁定), guard 为挡刀递归防环
    const bypass = ['overload', 'guard'].includes(srcName);
    // M4: 管理员权限无视所有防具
    const ignoreArmor = !!src && src.id !== pid && !!src.weapon && src.weapon.key === 'wQgj';
    // 主公首轮全源免伤(H2-1)
    if (!bypass && p.identity === 'lord' && g.round === 1 && !p.lordShield1) {
      p.lordShield1 = true;
      g.log.push({ t: g.round, txt: `${p.name}【首轮免伤】免疫本次伤害`, cls: 'act' });
      return;
    }
    // 评测机护盾: 每回合免疫首次伤害(H2-2)
    if (!bypass && !ignoreArmor && p.armor && p.armor.key === 'aShield' && !p.armorCount.shield) {
      p.armorCount.shield = 1;
      g.log.push({ t: g.round, txt: `${p.name}【评测机护盾】免疫本次伤害`, cls: 'act' });
      return;
    }
    // 忠臣挡刀: 弃1手牌替主公承受伤害(每回合1次)(H4)
    if (!bypass && p.identity === 'lord' && d > 0) {
      const loyal = g.players.filter(q => !q.dead && q.identity === 'loyal' && q.hand.length > 0 && !q.blockedThisTurn);
      if (loyal.length) {
        const b = loyal[0];
        discardFromHand(g, b, 0);
        b.blockedThisTurn = true; b.blockTimes++;
        g.log.push({ t: g.round, txt: `${b.name}【挡刀】弃1手牌替${p.name}承受${d}点伤害!`, cls: 'act' });
        loseHp(g, b.id, d, src, 'guard');
        return;
      }
    }
    // 卖队友保底: 本回合首次受伤-1
    if (!bypass && p.funShield) { p.funShield = false; d = Math.max(0, d - 1); if (d === 0) { g.log.push({ t: g.round, txt: `${p.name}【卖队友保底】伤害-1,无伤`, cls: 'act' }); return; } }
    // 主公对忠臣伤害-1(最低0),无惩罚(H5)
    if (src && src.identity === 'lord' && p.identity === 'loyal' && !bypass) {
      d = Math.max(0, d - 1);
      if (d === 0) { g.log.push({ t: g.round, txt: `${p.name} 是忠臣,主公对其伤害-1,未造成伤害`, cls: '' }); return; }
      g.log.push({ t: g.round, txt: `(主公对忠臣伤害-1)`, cls: '' });
    }
    // AC保护: 每次受伤至多1
    if (!ignoreArmor && p.armor && p.armor.key === 'aAc' && d > 1) { d = 1; g.log.push({ t: g.round, txt: `${p.name}【AC保护】伤害降至1`, cls: '' }); }
    // 记忆化搜索: 受伤判定红桃-1
    if (!ignoreArmor && p.armor && p.armor.key === 'aMemo' && !bypass) {
      const jc = judgeCard(g);
      if (jc.suit === 'heart') { d = Math.max(0, d - 1); g.log.push({ t: g.round, txt: `${p.name}【记忆化搜索】判定♥,伤害-1`, cls: 'evt' }); }
    }
    // 评测姬·测评(被动): 受伤判定红桃伤害-1(13章); 觉醒: 免判定减伤(每回合1次)
    if (p.prof.id === 'pingce' && !bypass) {
      if (p.awaken) {
        if (!p.armorCount.pingce) {
          p.armorCount.pingce = 1;
          d = Math.max(0, d - 1);
          g.log.push({ t: g.round, txt: `${p.name}【测评·觉醒】免判定减伤1(本回合首次)`, cls: 'evt' });
        }
      } else {
        const jc = judgeCard(g);
        g.log.push({ t: g.round, txt: `${p.name}【测评】判定 ${nsData.identities.suitZh[jc.suit]}`, cls: 'evt' });
        if (jc.suit === 'heart') { d = Math.max(0, d - 1); g.log.push({ t: g.round, txt: `${p.name}【测评】判定♥,伤害-1`, cls: 'evt' }); }
      }
    }
    // 玄学选手·玄学(每回合首次受伤判定红桃免伤; 觉醒后免判定)
    if (p.prof.id === 'xuanxue' && !p.armorCount.xuanxue && !bypass) {
      if (p.awaken) { g.log.push({ t: g.round, txt: `${p.name}【玄学优化】免伤`, cls: 'evt' }); p.armorCount.xuanxue = 1; return; }
      const jc = judgeCard(g);
      if (jc.suit === 'heart') { g.log.push({ t: g.round, txt: `${p.name}【玄学】判定♥免伤`, cls: 'evt' }); p.armorCount.xuanxue = 1; return; }
      p.armorCount.xuanxue = 1; // L1: 判定失败也消耗次数
    }
    // 退役选手·回忆: 受伤判定黑桃-1
    if (p.prof.id === 'tuiyi' && !bypass && d > 0) {
      const jc = judgeCard(g);
      if (jc.suit === 'spade') { d = Math.max(0, d - 1); g.log.push({ t: g.round, txt: `${p.name}【回忆】判定♠,伤害-1`, cls: 'evt' }); }
    }
    // 传奇Au选手·不败(被动): 每回合1次可防止卡牌效果伤害(做法假了/锦囊, 13章)
    if (p.prof.id === 'chuangqi' && !p.armorCount.bubai && !bypass && d > 0 &&
        ['attack', 'pierce', 'o2', 'duel', 'aoe', 'argue', 'ub'].includes(srcName)) {
      p.armorCount.bubai = 1;
      g.log.push({ t: g.round, txt: `${p.name}【不败】防止本次卡牌效果伤害(本回合首次)`, cls: 'act' });
      return;
    }
    // 压线过
    if (p.prof.id === 'yaxian' && !p.yaxianUsed && p.hp - d <= 0) { d = p.hp - 1; p.yaxianUsed = true; g.log.push({ t: g.round, txt: `${p.name}【压线过】体力锁定为1`, cls: 'act' }); }
    if (d <= 0) return;
    p.hp -= d;
    // L-3: 明君标记在实际扣血后置位(防具减免至0时不算"造成过伤害")
    if (src && src.identity === 'lord' && p.identity === 'loyal') g.lordDamagedLoyal = true;
    if (src && src.id !== pid) g.players[src.id].damageDealt += d;
    g.log.push({ t: g.round, txt: `${p.name} 受到 ${d} 点伤害(剩${p.hp})`, cls: 'bad' });
    if (p.hp <= 0) nsEngine.battle.nearDeath(g, pid, src);
    if (!p.dead) checkAwaken(g, pid);
    checkVictory(g);
  }

  function forceEndByCount(g) {
    const alive = g.players.filter(p => !p.dead);
    // 2.8/FAQ#15: 存活人数多者胜; 主公方=主公+忠臣合并计数; 人数相同则内奸(若存活)单独获胜
    const lordSide = alive.filter(p => p.identity === 'lord' || p.identity === 'loyal').length;
    const rebelCnt = alive.filter(p => p.identity === 'rebel').length;
    const traitorCnt = alive.filter(p => p.identity === 'traitor').length;
    const maxCnt = Math.max(lordSide, rebelCnt, traitorCnt);
    const winners = [];
    if (lordSide === maxCnt) winners.push('lord');
    if (rebelCnt === maxCnt) winners.push('rebel');
    if (traitorCnt === maxCnt) winners.push('traitor');
    if (winners.length === 1) {
      const sideZh = winners[0] === 'lord' ? '主公方' : (winners[0] === 'rebel' ? '反贼' : '内奸');
      g.log.push({ t: g.round, txt: `【保底终局】连续洗牌无胜负: 存活人数多者胜(${sideZh} ${maxCnt}人)`, cls: 'evt' });
      end(g, winners[0]);
    } else if (traitorCnt > 0) {
      // 人数相同且内奸存活 -> 内奸单独获胜(FAQ#15)
      g.log.push({ t: g.round, txt: `【保底终局】人数相同,内奸单独获胜!`, cls: 'evt' });
      end(g, 'traitor');
    } else {
      // 主公方与反贼同人数且无内奸: 需求未定义, 记平局并按主公方结算(现状兜底)
      g.log.push({ t: g.round, txt: `【保底终局】人数相同且无内奸: 规则未定义,记平局,按主公方结算`, cls: 'evt' });
      end(g, 'lord');
    }
  }

  function checkVictory(g) {
    if (g.over) return;
    const alive = g.players.filter(p => !p.dead);
    const lord = g.players.find(p => p.identity === 'lord');
    const rebelsAlive = alive.some(p => p.identity === 'rebel');
    const traitorAlive = alive.some(p => p.identity === 'traitor');
    if (lord.dead) {
      if (rebelsAlive) { end(g, 'rebel'); }
      else if (traitorAlive) { end(g, 'traitor'); }
      else { end(g, 'lord'); }
    } else if (!rebelsAlive && !traitorAlive) {
      end(g, 'lord');
    }
  }

  function end(g, winnerSide) {
    g.over = true;
    const names = { rebel: '反贼', traitor: '内奸(摸鱼怪)', lord: '主公方' };
    g.winner = names[winnerSide];
    g.log.push({ t: g.round, txt: `=== 游戏结束: ${g.winner} 获胜 ===`, cls: 'evt' });
    settleAchievements(g);
  }
  /* 成就结算(2.9): 搅局者/护主/掀翻/明君 */
  function settleAchievements(g) {
    const ach = {};
    for (const p of g.players) {
      const list = [];
      if (p.identity === 'traitor' && !p.dead && p.kills >= 1 && g.winner !== '内奸(摸鱼怪)') list.push({ name: '搅局者', points: 1, desc: '内奸存活至终局且亲手击杀≥1名敌人(击杀主公视同)' });
      if (p.identity === 'loyal' && p.blockTimes >= 1) list.push({ name: '护主', points: 1, desc: '忠臣成功挡刀≥1次' });
      if (p.identity === 'rebel' && p.killedLord) list.push({ name: '掀翻', points: 2, desc: '反贼亲手击杀主公' });
      if (p.identity === 'lord' && g.winner === '主公方' && !g.lordDamagedLoyal) list.push({ name: '明君', points: 1, desc: '主公获胜且未对忠臣造成伤害' });
      if (list.length) ach[p.id] = list;
    }
    g.achievements = ach;
    for (const pid of Object.keys(ach)) {
      for (const a of ach[pid]) g.log.push({ t: g.round, txt: `🏅${g.players[pid].name} 获得成就【${a.name}】+${a.points}`, cls: 'evt' });
    }
  }

  function queueEvo(g, pid, key, cardId) {
    if (!g.pendingEvo[pid]) g.pendingEvo[pid] = [];
    if (!g.pendingEvo[pid].includes(key)) g.pendingEvo[pid].push(key);
    // 15.2: 单位/删库进化——触发卡当时在弃牌堆(守擂被消灭的守卫/已使用的删库),
    // 记录其真实牌 id, 进化结算时从弃牌堆取回改名加入手牌
    if (cardId != null) {
      if (!g.evoSrcCards) g.evoSrcCards = {};
      if (g.evoSrcCards[key] == null) g.evoSrcCards[key] = cardId;
    }
  }
  /* 尝试进化: 手牌中有对应基础牌则升级; 返回是否成功 */
  function tryEvolve(g, pid, key) {
    const p = g.players[pid];
    if (p.dead || p.evoTotal >= 3) return false;
    const evoKey = nsData.cards.EVO_MAP[key];
    if (!evoKey) return false;
    const idx = p.hand.findIndex(c => c.key === key);
    if (idx >= 0) {
      p.hand[idx].key = evoKey;
      p.evoTotal++;
      g.log.push({ t: g.round, txt: `🃏${p.name} 进化!【${spec(key).name}】→【${spec(evoKey).name}】`, cls: 'evt' });
      return true;
    }
    // 触发卡不在手牌: 从弃牌堆按记录 id 取回(仅守卫/删库两条路径)
    const srcId = g.evoSrcCards && g.evoSrcCards[key];
    if (srcId != null && (key === 'uGuard' || key === 'killUnit')) {
      const di = g.discard.findIndex(c => c && c.id === srcId);
      if (di >= 0) {
        const c = g.discard.splice(di, 1)[0];
        c.key = evoKey;
        p.hand.push(c);
        p.evoTotal++;
        g.log.push({ t: g.round, txt: `🃏${p.name} 进化!【${spec(key).name}】→【${spec(evoKey).name}】(从弃牌堆取回加入手牌)`, cls: 'evt' });
        return true;
      }
    }
    return false;
  }
  /* 人类进化选择: key 为 null 表示放弃 */
  function evolvePick(g, pid, key) {
    if (g.evoWait && g.evoWait.pid === pid) g.evoWait = null;
    if (key) tryEvolve(g, pid, key);
  }

  function checkAwaken(g, pid) {
    const p = g.players[pid];
    if (p.dead || p.awaken) return;
    if (p.hp <= Math.floor(p.maxHp / 2)) {
      p.awaken = true;
      const a = p.prof.awaken;
      g.log.push({ t: g.round, txt: `✨${p.name} 觉醒!【${p.prof.name}】${a}`, cls: 'evt' });
      switch (p.prof.id) {
        case 'shenben': case 'chuangqi': p.dmgBonus += 1; break;
        case 'juruo': case 'yaxian': p.maxHp += 1; p.hp += 1; break;
        case 'tuiyi': p.hp = Math.min(p.maxHp, p.hp + 2); draw(g, pid, 2); break;
        case 'xuezhang': p.teachBonus = true; break; // 学长: 讲题时你同摸1
        case 'baoling': p.baolingBonus = 1; break;   // 爆零选手: 爆零伤害+1
        case 'tuling': draw(g, pid, 2); break;       // 图灵奖得主: 摸2
        case 'dabiao': p.handLimitBonus += 1; break; // 打表狂魔: 手牌上限+1
        case 'mengxin': break; // 摸牌阶段多摸1
        case 'duliu': break; // 卡常免费
        case 'nvzhuang': break;
        case 'pingce': case 'xuanxue': break;
        case 'huashui': break;
        case 'jiaolian': break;
        case 'jianpan': break;
        case 'chaoti': break;
        case 'shuiqun': break;
        default: break;
      }
    }
  }

  /* ---------------- 战斗裁决(入口) ---------------- */
  // 返回 {done, log} 使用异步 pending 处理响应
  function attackPlayer(g, attacker, target, opts) {
    opts = opts || {};
    let dmg = 1 + (opts.isEvo ? 1 : 0); // 实锤(进化): 伤害+1
    if (attacker.coffee) { dmg += attacker.coffeeDmg; attacker.coffee = false; }
    dmg += attacker.dmgBonus + attacker.akioiDmg; // 觉醒/AKIOI加成(M1: 神犇不再双计)
    // 毒瘤卡常: 本次攻击不可被WA响应
    if (attacker.kachangFlag) { attacker.kachangFlag = false; opts.noDodge = true; }
    const evt = g.eventSuit;
    if (evt === 'spade') { dmg = Math.max(1, dmg - 1); }
    if (evt === 'club') { dmg += 1; }
    // 萌新问问题/女装大佬: 成为攻击目标
    onBecomeTarget(g, target.id, false);

    // 守擂单位挡刀
    const guard = target.units.find(u => spec(u.key).guard);
    if (guard && !opts.pierceGuard) {
      target.units.splice(target.units.indexOf(guard), 1);
      if (guard.id !== -1) g.discard.push(guard); // 克隆体(假牌)直接消失
      g.log.push({ t: g.round, txt: `${target.name} 的【${spec(guard.key).name}】(守擂)挡下攻击并阵亡`, cls: 'act' });
      // 15.2: 线段树守卫挡下攻击 -> 进化候选【主席树守卫】
      if (guard.key === 'uGuard' && guard.id !== -1) {
        queueEvo(g, target.id, 'uGuard', guard.id);
        g.log.push({ t: g.round, txt: `${target.name} 的线段树守卫达成进化条件(挡下攻击)`, cls: 'evt' });
      }
      // 主席树守卫(进化): 守擂且被消灭时你摸1
      if (guard.key === 'uGuardEvo') { draw(g, target.id, 1); g.log.push({ t: g.round, txt: `${target.name}【主席树守卫】守擂被消灭,摸1`, cls: 'act' }); }
      if (attacker.weapon && attacker.weapon.key === 'wTree') g.log.push({ t: g.round, txt: `${attacker.name}【树状数组】查看${target.name}手牌: ${target.hand.map(c => spec(c.key).name).join('、')}`, cls: '' });
      return 'guard';
    }
    // 黑名单: 黑色攻击无效
    if (target.armor && target.armor.key === 'aHei' && nsData.identities.isBlack(opts.suit || 'spade') && !(attacker.weapon && attacker.weapon.key === 'wQgj')) {
      g.log.push({ t: g.round, txt: `${target.name}【黑名单】黑色攻击无效`, cls: 'act' });
      return 'blocked';
    }
    // 随机评测机事件: 目标判定
    if (evt === 'diamond') {
      const jc = judgeCard(g);
      g.log.push({ t: g.round, txt: `随机评测机判定 ${nsData.identities.suitZh[jc.suit]}`, cls: 'evt' });
      if (jc.suit === 'heart') { g.log.push({ t: g.round, txt: `${target.name} 判定红桃,自动闪避`, cls: 'act' }); return 'dodged'; }
      if (jc.suit === 'spade') dmg += 1;
    }
    // 卖队友(响应): 被攻击者可弃置此牌将攻击转给一名其他玩家(需其同意;一局一次)
    if (opts.allowBetray !== false && evt !== 'spade') {
      const hasBetray = target.hand.some(c => c.key === 'funBetray');
      if (hasBetray && !g.usedBetray) {
        const others = g.players.filter(q => !q.dead && q.id !== attacker.id && q.id !== target.id);
        if (others.length) {
          if (g.askDodge) {
            g.pending = { type: 'dodge', attacker: attacker.id, target: target.id, dmg, suit: opts.suit || 'spade', cardId: opts.cardId, isEvo: opts.isEvo, ctx: { betrayAvail: true, betrayOptions: others.map(q => ({ id: q.id, name: q.name })) } };
            return 'pending';
          }
          // 引擎侧AI转嫁: 新目标为人类则挂起同意询问(经 respondDodge 作答), 为AI则按引擎判定
          const nt = others[Math.floor(g.rnd() * others.length)];
          if (nt.id === g.human) {
            g.pending = { type: 'dodge', attacker: attacker.id, target: nt.id, dmg, suit: opts.suit || 'spade', cardId: opts.cardId, isEvo: opts.isEvo, srcId: attacker.id, ctx: { betrayConsent: true, betrayer: target.id } };
            return 'pending';
          }
          if (nsEngine.battle.aiBetrayConsent(g, nt, dmg)) {
            const bi = target.hand.findIndex(c => c.key === 'funBetray');
            const bc = target.hand.splice(bi, 1)[0];
            g.discard.push(bc); g.usedBetray = true;
            g.log.push({ t: g.round, txt: `${target.name}【卖队友】把攻击转给了${nt.name}(对方同意)!`, cls: 'act' });
            g.askDodge = (nt.id === g.human);
            return attackPlayer(g, attacker, nt, { suit: opts.suit || 'spade', isEvo: opts.isEvo, allowBetray: false, cardId: opts.cardId, noDodge: opts.noDodge });
          }
          g.log.push({ t: g.round, txt: `${nt.name} 拒绝被转嫁,攻击继续结算`, cls: 'act' });
        }
      }
    }
    // WA 响应(含主公技护驾: 任意玩家可代主公出WA)
    if (evt !== 'spade' && !opts.noDodge) {
      if (target.identity === 'lord') {
        const helpers = g.players.filter(q => !q.dead && q.id !== target.id && q.id !== attacker.id && nsEngine.battle.canDodge(g, q));
        if (g.askDodge) {
          g.pending = { type: 'dodge', attacker: attacker.id, target: target.id, dmg, suit: opts.suit || 'spade', cardId: opts.cardId, isEvo: opts.isEvo, helpers: helpers.map(q => ({ id: q.id, name: q.name })) };
          return 'pending';
        }
        if (nsEngine.battle.canDodge(g, target)) return nsEngine.battle.resolveDodge(g, target, true, dmg, opts.suit || 'spade', attacker);
        if (helpers.length) { const h = helpers[0]; g.log.push({ t: g.round, txt: `${h.name}【护驾】代${target.name}出WA!`, cls: 'act' }); return nsEngine.battle.helperDodge(g, h, attacker, target, dmg, opts); }
        return nsEngine.battle.resolveHit(g, attacker, target, dmg, opts);
      }
      if (nsEngine.battle.canDodge(g, target)) {
        if (g.askDodge) {
          // 人类响应: 挂起 pending
          g.pending = { type: 'dodge', attacker: attacker.id, target: target.id, dmg, suit: opts.suit || 'spade', cardId: opts.cardId, isEvo: opts.isEvo };
          return 'pending';
        } else {
          // AI/自动: 有WA则出
          return nsEngine.battle.resolveDodge(g, target, true, dmg, opts.suit || 'spade', attacker);
        }
      }
    }
    // 命中
    const r = nsEngine.battle.resolveHit(g, attacker, target, dmg, opts);
    return r;
  }

  // 动作: {type:'play', cardIdx, target?} {type:'equip', cardIdx} {type:'deploy', cardIdx} {type:'end'}
  function canPlay(g, pid, cardIdx) {
    const p = g.players[pid];
    if (g.turn !== pid || p.dead || p.skipPlay) return { ok: false, why: '非行动阶段' };
    if (g.pending) return { ok: false, why: '等待响应中' };
    const c = p.hand[cardIdx];
    if (!c) return { ok: false, why: '无此牌' };
    const s = spec(c.key);
    const cost = effectiveCost(g, p, c.key);
    if (p.mp < cost) return { ok: false, why: `灵感不足(${cost})` };
    return { ok: true, cost, card: c, spec: s };
  }

  function playCard(g, pid, cardIdx, targetId, targetId2) {
    const p = g.players[pid];
    const chk = canPlay(g, pid, cardIdx);
    if (!chk.ok) return { ok: false, why: chk.why };
    const c = chk.card, s = chk.spec;
    const cost = chk.cost;
    const t = targetId !== undefined ? g.players[targetId] : null;

    // 领域亲和标记
    if (domOf(p, c.key) === p.prof.domain && !p.domainDiscounted) p.domainDiscounted = true;
    // 评测机连发标记
    if (c.key === 'attack' && p.weapon && p.weapon.key === 'wLiannu') p.attackUsed = true;

    // 移出手牌
    p.hand.splice(cardIdx, 1);
    const isAttack = c.key === 'attack';
    const suits = { attack: c.suit };

    // 神犇·碾压: 黑色非响应牌当作做法假了(H1)
    if (p.prof.id === 'shenben' && !nsData.cards.isAttackKey(c.key) && !nsData.cards.isDodgeKey(c.key) && c.key !== 'counter' && c.key !== 'counterEvo' && nsData.identities.isBlack(c.suit)) {
      if (!t || t.dead || t.id === pid) { p.hand.push(c); return { ok: false, why: '碾压需要选择目标' }; }
      const atkCost = effectiveCost(g, p, 'attack');
      const extra = atkCost - cost;
      if (extra > 0 && p.mp < extra) { p.hand.push(c); return { ok: false, why: '灵感不足(按攻击费用' + atkCost + ')' }; }
      if (extra > 0) p.mp -= extra;
      if (!p.canAttack) { p.hand.push(c); return { ok: false, why: '本回合不能攻击' }; }
      g.log.push({ t: g.round, txt: `${p.name}【碾压】将黑色【${s.name}】当作做法假了`, cls: 'act' });
      g.askDodge = (t.id === g.human);
      const r2 = attackPlayer(g, p, t, { suit: c.suit, isEvo: false });
      if (r2 === 'pending') { g.discard.push(c); g.pending.pid = pid; g.pending.suit = c.suit; g.pending.isEvo = false; }
      else g.discard.push(c);
      return { ok: true, result: r2 };
    }

    // ---- 基本牌 ----
    if (c.key === 'attack' || c.key === 'attackEvo') {
      spend(g, p, cost);
      if (p.canAttack === false) { p.hand.push(c); return { ok: false, why: '本回合不能攻击(躺赢)' }; }
      if (t && t.id === pid) { p.hand.push(c); return { ok: false, why: '不能攻击自己' }; }
      g.askDodge = (t.id === g.human); // 人类目标 -> 挂起WA响应
      const r = attackPlayer(g, p, t, { suit: c.suit, cardId: c.id, dmg: 1, isEvo: c.key === 'attackEvo' });
      if (r === 'pending') { g.discard.push(c); g.pending.card = c; g.pending.pid = pid; g.pending.cardIdx = -1; }
      else if (r === 'guard' || r === 'dodged' || r === 'blocked') { g.discard.push(c); }
      else { g.discard.push(c); }
      return { ok: true, result: r };
    }
    if (nsData.cards.isDodgeKey(c.key) || c.key === 'counter' || c.key === 'counterEvo') { p.hand.push(c); return { ok: false, why: '响应牌,非出牌阶段使用' }; }
    if (c.key === 'heal' || c.key === 'healEvo') {
      if (p.hp >= p.maxHp) { p.hand.push(c); return { ok: false, why: '体力已满' }; }
      spend(g, p, cost); g.discard.push(c);
      if (c.key === 'healEvo') { p.hp = Math.min(p.maxHp, p.hp + 2); draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name} 使用【CCF金牌】回复2点体力并摸1`, cls: 'act' }); }
      else {
        p.hp = Math.min(p.maxHp, p.hp + 1);
        p.healUses++;
        if (p.healUses >= 3) queueEvo(g, pid, 'heal');
        g.log.push({ t: g.round, txt: `${p.name} 使用【CCF捐款】回复1点体力`, cls: 'act' });
      }
      return { ok: true };
    }
    if (c.key === 'coffee' || c.key === 'coffeeEvo') {
      spend(g, p, cost); g.discard.push(c);
      p.coffee = true; p.coffeeDmg = c.key === 'coffeeEvo' ? 2 : 1; p.coffeeTurn = true;
      g.log.push({ t: g.round, txt: `${p.name} 喝【${s.name}】,下一张攻击伤害+${p.coffeeDmg}`, cls: 'act' });
      return { ok: true };
    }

    // ---- 锦囊 ----
    switch (c.key) {
      case 'draw2': case 'funLie': {
        spend(g, p, cost);
        const cr = nsEngine.tricks.tryCounterOther(g, pid, c.key, { kind: 'self', ctx: { srcId: pid, trickKey: c.key, card: c } });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') { g.discard.push(c); g.log.push({ t: g.round, txt: `${p.name} 的【${s.name}】被特判抵消`, cls: 'act' }); return { ok: true, result: 'countered' }; }
        return nsEngine.tricks.doTrickSelf(g, pid, c.key, c);
      }
      case 'peek': {
        spend(g, p, cost);
        const cr = nsEngine.tricks.tryCounterOther(g, pid, c.key, { kind: 'self', ctx: { srcId: pid, trickKey: c.key, card: c } });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') { g.discard.push(c); g.log.push({ t: g.round, txt: `${p.name} 的【${s.name}】被特判抵消`, cls: 'act' }); return { ok: true, result: 'countered' }; }
        return nsEngine.tricks.doTrickSelf(g, pid, c.key, c);
      }
      case 'mull': {
        if (p.hand.length < 1) { p.hand.push(c); return { ok: false, why: '没有可弃的牌' }; }
        spend(g, p, cost);
        const cr = nsEngine.tricks.tryCounterOther(g, pid, c.key, { kind: 'self', ctx: { srcId: pid, trickKey: c.key, card: c } });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') { g.discard.push(c); g.log.push({ t: g.round, txt: `${p.name} 的【${s.name}】被特判抵消`, cls: 'act' }); return { ok: true, result: 'countered' }; }
        return nsEngine.tricks.doTrickSelf(g, pid, c.key, c);
      }
      case 'cheat': {
        if (p.hp >= p.maxHp) { p.hand.push(c); return { ok: false, why: '体力已满' }; }
        spend(g, p, cost);
        const cr = nsEngine.tricks.tryCounterOther(g, pid, c.key, { kind: 'self', ctx: { srcId: pid, trickKey: c.key, card: c } });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') { g.discard.push(c); g.log.push({ t: g.round, txt: `${p.name} 的【${s.name}】被特判抵消`, cls: 'act' }); return { ok: true, result: 'countered' }; }
        return nsEngine.tricks.doTrickSelf(g, pid, c.key, c);
      }
      case 'recover': {
        if (g.discard.length === 0) { p.hand.push(c); return { ok: false, why: '弃牌堆为空' }; }
        spend(g, p, cost);
        const cr = nsEngine.tricks.tryCounterOther(g, pid, c.key, { kind: 'self', ctx: { srcId: pid, trickKey: c.key, card: c } });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') { g.discard.push(c); g.log.push({ t: g.round, txt: `${p.name} 的【${s.name}】被特判抵消`, cls: 'act' }); return { ok: true, result: 'countered' }; }
        return nsEngine.tricks.doTrickSelf(g, pid, c.key, c);
      }
      case 'gift': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        spend(g, p, cost); g.discard.push(c);
        const cr = nsEngine.tricks.counterAsk(g, t.id, c.key, pid, { kind: 'trick', ctx: { srcId: pid, trickKey: c.key, targetId: t.id } });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') return { ok: true, result: 'countered' };
        return nsEngine.tricks.doTrickCore(g, pid, c.key, t.id);
      }
      case 'dismantle': case 'steal': case 'pierce': case 'skipPlay': case 'gift': case 'funReport': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        if (c.key === 'steal' && !t.weapon && !t.armor && t.hand.length === 0) { p.hand.push(c); return { ok: false, why: '目标无可缴获' }; }
        spend(g, p, cost); g.discard.push(c);
        const cr = nsEngine.tricks.counterAsk(g, t.id, c.key, pid, { kind: 'trick', ctx: { srcId: pid, trickKey: c.key, targetId: t.id } });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') return { ok: true, result: 'countered' };
        return nsEngine.tricks.doTrickCore(g, pid, c.key, t.id);
      }
      case 'o2': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        if (!p.hand.some(x => nsData.cards.isAttackKey(x.key))) { p.hand.push(c); return { ok: false, why: '需要一张做法假了' }; }
        spend(g, p, cost); g.discard.push(c);
        const cr = nsEngine.tricks.counterAsk(g, t.id, c.key, pid, { kind: 'trick', ctx: { srcId: pid, trickKey: c.key, targetId: t.id } });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') return { ok: true, result: 'countered' };
        return nsEngine.tricks.doTrickCore(g, pid, c.key, t.id);
      }
      case 'duel': case 'duelEvo': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        spend(g, p, cost); g.discard.push(c);
        const cr = nsEngine.tricks.counterAsk(g, t.id, c.key, pid, { kind: 'trick', ctx: { srcId: pid, trickKey: c.key, targetId: t.id } });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') return { ok: true, result: 'countered' };
        return nsEngine.tricks.doTrickCore(g, pid, c.key, t.id); // duel/duelEvo 均由 doTrickCore 轮流结算
      }
      case 'skipPlay': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        spend(g, p, cost); g.discard.push(c);
        const cr = nsEngine.tricks.counterAsk(g, t.id, c.key, pid, { kind: 'trick', ctx: { srcId: pid, trickKey: c.key, targetId: t.id } });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') return { ok: true, result: 'countered' };
        return nsEngine.tricks.doTrickCore(g, pid, c.key, t.id);
      }
      case 'delaySkipPlay': case 'delaySkipDraw': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        if (t.delayArea.some(d => d.key === c.key)) { p.hand.push(c); return { ok: false, why: '目标判定区已有该延时锦囊' }; } // L3
        spend(g, p, cost);
        // 延时锦囊只进入判定区(不弃置), 判定结算后才进弃牌堆
        t.delayArea.push(c);
        onBecomeTarget(g, t.id, true);
        g.log.push({ t: g.round, txt: `${p.name} 对${t.name}使用【${s.name}】(延时)`, cls: 'act' });
        return { ok: true };
      }
      case 'ub': {
        if (p.delayArea.some(d => d.key === 'ub')) { p.hand.push(c); return { ok: false, why: '你的判定区已有UB' }; } // L3
        spend(g, p, cost);
        p.delayArea.push(c);
        g.log.push({ t: g.round, txt: `${p.name} 放置【UB】(延时)`, cls: 'act' });
        return { ok: true };
      }
      case 'killUnit': case 'killUnitEvo': {
        const target = t || g.players.find(q => !q.dead && q.units.length > 0);
        if (!target || target.units.length === 0) { p.hand.push(c); return { ok: false, why: '没有可消灭的单位' }; }
        spend(g, p, cost); g.discard.push(c);
        const cont = { kind: 'killUnit', ctx: { type: 'killUnit', srcId: pid, trickKey: c.key, targetId: target.id, cardKey: c.key, cardId: c.id } };
        const cr = nsEngine.tricks.tryCounter(g, target.id, c.key, pid, cont);
        if (cr === 'pending') {
          if (!(g.pending.ctx && g.pending.ctx.type === 'counterChain')) g.pending.ctx = cont.ctx;
          return { ok: true, result: 'pending' };
        }
        if (cr === true) { g.log.push({ t: g.round, txt: `${target.name} 特判抵消了${spec(c.key).name}`, cls: 'act' }); return { ok: true, result: 'countered' }; }
        return nsEngine.tricks.doKillUnit(g, pid, target.id, c.key, c.id);
      }
      case 'aoeAtk': case 'aoeAtkEvo': case 'aoeDodge': case 'aoeDodgeEvo': {
        spend(g, p, cost); g.discard.push(c);
        if (c.key === 'aoeAtk') p.aoeFlag = 'aoeAtk';
        if (c.key === 'aoeDodge') p.aoeFlag = 'aoeDodge';
        const ad = (c.key === 'aoeAtkEvo' || c.key === 'aoeDodgeEvo') ? 2 : 1;
        g.log.push({ t: g.round, txt: `${p.name} 使用【${s.name}】AOE!`, cls: 'evt' });
        const targets = aoeOrder(g, pid); // L7: 从使用者下家按行动顺序
        if (!targets.length) return { ok: true };
        const aoeCtx = { type: 'aoe', trickKey: c.key, srcId: pid, dmg: ad, current: targets[0], remaining: targets.slice(1) };
        const cr = nsEngine.tricks.counterAsk(g, targets[0], c.key, pid, { kind: 'aoe', ctx: aoeCtx });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') g.log.push({ t: g.round, txt: `${g.players[targets[0]].name} 特判抵消了${s.name}`, cls: 'act' });
        else {
          const r0 = nsEngine.tricks.aoeApplyOne(g, pid, c.key, ad, targets[0]);
          if (r0 === 'pending') {
            g.pending.ctx = aoeCtx;
            return { ok: true, result: 'pending' };
          }
        }
        nsEngine.tricks.resumeAoe(g, aoeCtx);
        return { ok: true, result: 'done' };
      }
      case 'allHeal': {
        spend(g, p, cost); g.discard.push(c);
        g.log.push({ t: g.round, txt: `${p.name} 使用【CCF放水】全员回复1体力`, cls: 'evt' });
        const targets = aoeOrder(g, pid); // L7: 从使用者下家按行动顺序
        p.hp = Math.min(p.maxHp, p.hp + 1); // 使用者本人先回复
        if (!targets.length) return { ok: true };
        const aoeCtx = { type: 'aoe', trickKey: c.key, srcId: pid, dmg: 1, current: targets[0], remaining: targets.slice(1) };
        const cr = nsEngine.tricks.counterAsk(g, targets[0], c.key, pid, { kind: 'aoe', ctx: aoeCtx });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') g.log.push({ t: g.round, txt: `${g.players[targets[0]].name} 特判抵消了CCF放水`, cls: 'act' });
        else nsEngine.tricks.aoeApplyOne(g, pid, c.key, 1, targets[0]);
        nsEngine.tricks.resumeAoe(g, aoeCtx);
        return { ok: true, result: 'done' };
      }
      case 'harvest': {
        spend(g, p, cost); g.discard.push(c);
        const alive = g.players.filter(q => !q.dead);
        const n = Math.min(alive.length, g.deck.length);
        if (n === 0) { g.log.push({ t: g.round, txt: `【题解大会】无牌可翻`, cls: '' }); return { ok: true }; }
        const cards = g.deck.splice(g.deck.length - n, n).reverse(); // 亮出n张
        g.log.push({ t: g.round, txt: `【题解大会】翻开${n}张牌: ${cards.map(c => spec(c.key).name).join('、')}`, cls: 'evt' });
        // L-7: 9.2「从你起按行动顺序各选1张」— 顺序从使用者本人开始
        const order = [];
        let cur = pid;
        for (let i = 0; i < alive.length; i++) { order.push(cur); cur = nextAlive(g, cur); }
        const ctx = { type: 'harvest', srcId: pid, cards, order, pos: 0 };
        nsEngine.tricks.harvestStep(g, ctx);
        return { ok: true, result: g.pending ? 'pending' : 'done' };
      }
      case 'funGiveup': {
        spend(g, p, cost);
        const cr = nsEngine.tricks.tryCounterOther(g, pid, c.key, { kind: 'self', ctx: { srcId: pid, trickKey: c.key, card: c } });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') { g.discard.push(c); g.log.push({ t: g.round, txt: `${p.name} 的【${s.name}】被特判抵消`, cls: 'act' }); return { ok: true, result: 'countered' }; }
        return nsEngine.tricks.doTrickSelf(g, pid, c.key, c);
      }
      case 'funReport': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        spend(g, p, cost); g.discard.push(c);
        const cr = nsEngine.tricks.counterAsk(g, t.id, c.key, pid, { kind: 'trick', ctx: { srcId: pid, trickKey: c.key, targetId: t.id } });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') return { ok: true, result: 'countered' };
        return nsEngine.tricks.doTrickCore(g, pid, c.key, t.id);
      }
      case 'funArgue': {
        // 祖安对线(req 18.3): 指定2名玩家, 各自选择弃1张或受1伤(各自选)
        const t2 = (targetId2 !== undefined && targetId2 !== null) ? g.players[targetId2] : null;
        if (!t || t.dead || t.id === pid) { p.hand.push(c); return { ok: false, why: '需要第1名目标' }; }
        if (!t2 || t2.dead || t2.id === pid || t2.id === t.id) { p.hand.push(c); return { ok: false, why: '需要第2名(不同)目标' }; }
        spend(g, p, cost); g.discard.push(c);
        g.log.push({ t: g.round, txt: `${p.name}【祖安对线】与${t.name}、${t2.name}公开对质:各弃1张或受1伤(各自选)`, cls: 'act' });
        return nsEngine.tricks.argueStep(g, pid, [t.id, t2.id]);
      }
      case 'funCcf': {
        spend(g, p, cost); g.discard.push(c);
        g.ccfRound = g.round; // M13: 下一轮全体攻击费+1
        g.log.push({ t: g.round, txt: `${p.name}【感谢CCF】全员回1,下一轮全体攻击费+1`, cls: 'evt' });
        const targets = aoeOrder(g, pid);
        p.hp = Math.min(p.maxHp, p.hp + 1); // 使用者本人先回复
        if (!targets.length) return { ok: true };
        const aoeCtx = { type: 'aoe', trickKey: c.key, srcId: pid, dmg: 0, current: targets[0], remaining: targets.slice(1) };
        const cr = nsEngine.tricks.counterAsk(g, targets[0], c.key, pid, { kind: 'aoe', ctx: aoeCtx });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') g.log.push({ t: g.round, txt: `${g.players[targets[0]].name} 特判抵消了感谢CCF`, cls: 'act' });
        else nsEngine.tricks.aoeApplyOne(g, pid, c.key, 0, targets[0]);
        nsEngine.tricks.resumeAoe(g, aoeCtx);
        return { ok: true, result: 'done' };
      }
      case 'funClone': {
        if (g.usedClone) { p.hand.push(c); return { ok: false, why: '一局一次' }; } // M11
        if (p.units.length === 0) { p.hand.push(c); return { ok: false, why: '场上没有单位' }; }
        spend(g, p, cost);
        const cr = nsEngine.tricks.tryCounterOther(g, pid, c.key, { kind: 'self', ctx: { srcId: pid, trickKey: c.key, card: c } });
        if (cr === 'pending') return { ok: true, result: 'pending' };
        if (cr === 'countered') { g.discard.push(c); g.log.push({ t: g.round, txt: `${p.name} 的【${s.name}】被特判抵消`, cls: 'act' }); return { ok: true, result: 'countered' }; }
        return nsEngine.tricks.doTrickSelf(g, pid, c.key, c);
      }
      case 'funPower': {
        spend(g, p, cost); g.discard.push(c);
        const owners = g.players.filter(q => !q.dead && q.units.length > 0);
        if (!owners.length) { g.log.push({ t: g.round, txt: `【机房断电】场上没有单位`, cls: '' }); return { ok: true }; }
        return nsEngine.tricks.powerStep(g, pid, owners, 0);
      }
      case 'funBetray': {
        p.hand.push(c);
        return { ok: false, why: '【卖队友】是响应牌:被攻击时使用(转嫁攻击,一局一次)' };
      }
      default:
        p.hand.push(c);
        return { ok: false, why: '未实现的卡牌: ' + s.name };
    }
  }

  /* ---------------- 装备/单位 ---------------- */
  function equipCard(g, pid, cardIdx) {
    const p = g.players[pid];
    if (g.turn !== pid || p.dead || p.skipPlay) return { ok: false, why: '非行动阶段' };
    const c = p.hand[cardIdx];
    if (!c || spec(c.key).type !== 'equip') return { ok: false, why: '非装备牌' };
    const cost = effectiveCost(g, p, c.key);
    if (p.mp < cost) return { ok: false, why: '灵感不足' };
    p.hand.splice(cardIdx, 1);
    spend(g, p, cost);
    const s = spec(c.key);
    if (s.slot === 'weapon') {
      if (p.weapon) g.discard.push(p.weapon);
      p.weapon = c;
    } else {
      unequipArmor(g, p, true, true); // M18: 换装不触发离场效果; L14: 内存加固回退; M-13: 换装不回血
      p.armor = c;
      if (c.key === 'aRam') p.maxHp += 1;
    }
    g.log.push({ t: g.round, txt: `${p.name} 装备【${s.name}】`, cls: 'act' });
    return { ok: true };
  }

  function deployUnit(g, pid, cardIdx) {
    const p = g.players[pid];
    if (g.turn !== pid || p.dead || p.skipPlay) return { ok: false, why: '非行动阶段' };
    const c = p.hand[cardIdx];
    if (!c || spec(c.key).type !== 'unit') return { ok: false, why: '非单位牌' };
    const cost = effectiveCost(g, p, c.key);
    if (p.mp < cost) return { ok: false, why: '灵感不足' };
    p.hand.splice(cardIdx, 1);
    spend(g, p, cost);
    const s = spec(c.key);
    c.ready = !!s.blitz; // 速攻部署当回合可用,其余下回合就绪
    if (domOf(p, c.key) === p.prof.domain && !p.domainDiscounted) p.domainDiscounted = true; // M14: 领域亲和消耗
    p.units.push(c);
    g.log.push({ t: g.round, txt: `${p.name} 部署【${s.name}】(费${cost})`, cls: 'act' });
    if (c.key === 'uPeek' && g.deck.length) g.log.push({ t: g.round, txt: `【运算台】查看牌堆顶: ${spec(g.deck[g.deck.length - 1].key).name}`, cls: '' });
    if (c.key === 'uStr') { draw(g, pid, 1); if (p.hand.length) discardFromHand(g, p, 0); }
    return { ok: true };
  }

  /* ---------------- 状态视图 ---------------- */
  /* pending 视图(H-3): 在基础字段之上, 当底层 pending 存在 srcId/dmg 时额外暴露,
   * 供 UI 展示"谁发起的询问"与"伤害值"(attack/counter/aoe/argue/betray 等) */
  function pendingView(pd) {
    if (!pd) return null;
    const v = {
      type: pd.type, target: pd.target, attacker: pd.attacker, victim: pd.victim,
      trickKey: pd.trickKey, helpers: pd.helpers || null, ctx: pd.ctx || null,
    };
    if (pd.srcId !== undefined) v.srcId = pd.srcId;
    if (pd.dmg !== undefined) v.dmg = pd.dmg;
    return v;
  }
  function publicView(g, pid) {
    const p = g.players[pid];
    return {
      over: g.over, winner: g.winner, round: g.round, turn: g.turn,
      event: g.event, eventSuit: g.eventSuit,
      deck: g.deck.length, discard: g.discard.length,
      pending: pendingView(g.pending),
      achievements: g.achievements || null,
      lordCanRedraw: lordCanRedraw(g),
      evoWait: g.evoWait ? { pid: g.evoWait.pid, keys: g.evoWait.keys.map(k => ({ base: k, evo: nsData.cards.EVO_MAP[k], name: nsData.cards.EVO_MAP[k] ? spec(nsData.cards.EVO_MAP[k]).name : k })) } : null,
      me: {
        id: p.id, name: p.name, identity: p.identity,
        prof: { name: p.prof.name, plain: p.prof.plain, hp: p.prof.hp, domain: p.prof.domain, subDomain: p.prof.subDomain, passive: p.prof.passive, awakenDesc: p.prof.awaken },
        hp: p.hp, maxHp: p.maxHp, mp: p.mp, mpMax: p.mpMax,
        awaken: p.awaken, dead: p.dead, coffee: p.coffee,
        depression: p.depression, canAttack: p.canAttack, skipPlay: p.skipPlay, skipDraw: p.skipDraw,
        evoTotal: p.evoTotal,
        hand: p.hand.map(c => ({ key: c.key, suit: c.suit, num: c.num, name: spec(c.key).name, plain: spec(c.key).plain, type: spec(c.key).type, cost: effectiveCost(g, p, c.key) })),
        weapon: p.weapon ? spec(p.weapon.key).name : null,
        weaponKey: p.weapon ? p.weapon.key : null,
        armor: p.armor ? spec(p.armor.key).name : null,
        units: p.units.map(u => spec(u.key).name),
        delayArea: p.delayArea.map(d => spec(d.key).name),
        handLimit: 5 + p.handLimitBonus + (p.prof.id === 'tuling' && p.usedDianji ? 2 : 0),
      },
      others: g.players.filter(q => q.id !== pid).map(q => ({
        // M23/H10: 内奸身份不公开; L-12: 离场投降的内奸身份公开(2.4例外二)
        id: q.id, name: q.name, identity: q.dead ? (q.identity === 'traitor' && !q.left ? null : nsData.identities.IDENTITIES[q.identity].name) : null,
        dead: q.dead, hp: q.hp, maxHp: q.maxHp, mp: q.mp, mpMax: q.mpMax,
        handCount: q.hand.length, awaken: q.awaken,
        profName: q.prof.name, profPlain: q.prof.plain,
        weapon: q.weapon ? spec(q.weapon.key).name : null,
        armor: q.armor ? spec(q.armor.key).name : null,
        units: q.units.map(u => spec(u.key).name),
        delayArea: q.delayArea.map(d => spec(d.key).name),
      })),
      log: g.log.slice(-30),
      isMyTurn: g.turn === pid && !g.over,
    };
  }

  /* 玩家自选弃牌(L5): 按索引弃置手牌 */
  function discardCards(g, pid, indices) {
    const p = g.players[pid];
    if (!indices || !indices.length) return { ok: true };
    const sorted = indices.slice().sort((a, b) => b - a);
    for (const i of sorted) {
      if (i < 0 || i >= p.hand.length) return { ok: false, why: '无效索引' };
      const c = p.hand.splice(i, 1)[0];
      g.discard.push(c);
    }
    g.log.push({ t: g.round, txt: `${p.name} 弃置${sorted.length}张手牌`, cls: '' });
    return { ok: true };
  }

  /* ---------------- AI ---------------- */
  function aiTurn(g, pid) {
    const p = g.players[pid];
    if (p.dead || g.over) { endTurn(g, pid); return; }
    if (p.skipPlay) { // 停课集训: 只跳过行动阶段, 弃牌阶段照常(需求Q5)
      if (!g.over) { discardPhase(g, pid); endTurn(g, pid); }
      return;
    }
    let acted = true, guard = 0;
    while (acted && guard++ < 60 && !g.over && !g.pending) {
      acted = false;
      // 1. 濒死自救/治疗
      const healIdx = p.hand.findIndex(c => c.key === 'heal');
      if (healIdx >= 0 && p.hp < p.maxHp && p.mp >= effectiveCost(g, p, 'heal')) {
        const r = playCard(g, pid, healIdx); if (r.ok) { acted = true; continue; }
      }
      // 2. 攻击: 有攻击牌则打随机敌人(放手一搏可多目标)
      const atkIdx = p.hand.findIndex(c => nsData.cards.isAttackKey(c.key));
      if (atkIdx >= 0 && p.canAttack && p.mp >= effectiveCost(g, p, p.hand[atkIdx].key)) {
        const enemies = g.players.filter(q => !q.dead && q.id !== pid);
        if (enemies.length) {
          if (p.weapon && p.weapon.key === 'wFang' && p.hand.length === 1) {
            const n = Math.min(3, enemies.length);
            const tids = enemies.slice(0, n).map(q => q.id);
            const r = nsEngine.tricks.fangAttack(g, pid, tids, atkIdx);
            if (r.ok) { acted = true; if (g.pending) break; continue; }
          } else {
            const t = g.players[pickTarget(g, pid, enemies)];
            const r = playCard(g, pid, atkIdx, t.id);
            if (r.ok) { acted = true; if (g.pending) break; continue; }
          }
        }
      }
      // 2b. 手写快排: 无攻击牌时弃2张手牌当攻击
      if (p.weapon && p.weapon.key === 'wKsp' && p.canAttack && p.hand.length >= 2 && !p.hand.some(c => nsData.cards.isAttackKey(c.key)) && p.mp >= effectiveCost(g, p, 'attack')) {
        const enemies = g.players.filter(q => !q.dead && q.id !== pid);
        if (enemies.length) {
          const t = enemies[Math.floor(g.rnd() * enemies.length)];
          const r = nsEngine.tricks.kspAttack(g, pid, t.id);
          if (r.ok) { acted = true; if (g.pending) break; continue; }
        }
      }
      // 2c. 神犇碾压: 无攻击牌时用黑色手牌当攻击
      if (p.prof.id === 'shenben' && p.canAttack && p.mp >= effectiveCost(g, p, 'attack')) {
        const blackIdx = p.hand.findIndex(c => !nsData.cards.isAttackKey(c.key) && !nsData.cards.isDodgeKey(c.key) && c.key !== 'counter' && c.key !== 'counterEvo' && nsData.identities.isBlack(c.suit));
        if (blackIdx >= 0) {
          const enemies = g.players.filter(q => !q.dead && q.id !== pid);
          if (enemies.length) {
            const t = enemies[Math.floor(g.rnd() * enemies.length)];
            const r = playCard(g, pid, blackIdx, t.id);
            if (r.ok) { acted = true; if (g.pending) break; continue; }
          }
        }
      }
      // 3. 部署单位
      const unitIdx = p.hand.findIndex(c => spec(c.key).type === 'unit');
      if (unitIdx >= 0 && p.mp >= effectiveCost(g, p, p.hand[unitIdx].key)) {
        const r = deployUnit(g, pid, unitIdx); if (r.ok) { acted = true; continue; }
      }
      // 4. 装备
      const equipIdx = p.hand.findIndex(c => spec(c.key).type === 'equip');
      if (equipIdx >= 0 && p.mp >= effectiveCost(g, p, p.hand[equipIdx].key)) {
        const r = equipCard(g, pid, equipIdx); if (r.ok) { acted = true; continue; }
      }
      // 5. 过牌/锦囊
      const trickIdx = p.hand.findIndex(c => {
        const s = spec(c.key);
        if (s.type !== 'trick') return false;
        if (c.key === 'counter') return false;
        if (c.key === 'ub' && p.delayArea.length > 0) return false;
        return p.mp >= effectiveCost(g, p, c.key);
      });
      if (trickIdx >= 0) {
        const k = p.hand[trickIdx].key;
        let target = null, target2 = undefined;
        const needs = ['dismantle', 'steal', 'pierce', 'o2', 'duel', 'duelEvo', 'skipPlay', 'delaySkipPlay', 'delaySkipDraw', 'gift', 'funReport', 'funArgue'];
        if (needs.includes(k)) {
          const enemies = g.players.filter(q => !q.dead && q.id !== pid);
          if (k === 'funArgue') {
            // 祖安对线需2名目标; AI仅指向AI(人类目标的选择需UI挂起)
            const aiEnemies = enemies.filter(q => q.id !== g.human);
            if (aiEnemies.length >= 2) {
              const t1 = aiEnemies[Math.floor(g.rnd() * aiEnemies.length)];
              let t2 = aiEnemies[Math.floor(g.rnd() * aiEnemies.length)];
              let guard2 = 0;
              while (t2.id === t1.id && guard2++ < 10) t2 = aiEnemies[Math.floor(g.rnd() * aiEnemies.length)];
              target = t1.id; target2 = t2.id;
            }
          } else {
            target = enemies.length ? enemies[Math.floor(g.rnd() * enemies.length)].id : null;
          }
        }
        if (needs.includes(k) && target === null) { acted = false; break; }
        const r = playCard(g, pid, trickIdx, target, target2);
        if (r.ok) { acted = true; if (g.pending) break; continue; }
        if (!r.ok && k === 'o2' && !p.hand.some(x => x.key === 'attack')) { break; }
      }
      // 6. 单位攻击: 就绪单位消灭敌人单位(H6)
      const readyUnit = p.units.findIndex(u => u.ready);
      if (readyUnit >= 0) {
        const victim = g.players.find(q => !q.dead && q.id !== pid && q.units.length > 0);
        if (victim) { const r = nsEngine.skills.unitAttack(g, pid, readyUnit, victim.id); if (r.ok) { acted = true; continue; } }
      }
      // 7. 职业技能(简化AI)(H1)
      if (nsEngine.skills.aiSkill(g, pid)) { acted = true; continue; }
    }
    if (!g.over) { discardPhase(g, pid); endTurn(g, pid); }
  }

  /* AI 攻击目标选择: 反贼优先集火主公(公开身份) */
  function pickTarget(g, pid, enemies) {
    const p = g.players[pid];
    if (p.identity === 'rebel') {
      const lord = g.players.find(q => q.identity === 'lord' && !q.dead);
      if (lord) return lord.id;
    }
    return enemies[Math.floor(g.rnd() * enemies.length)].id;
  }

  /* 萌新问问题: 成为卡牌唯一目标摸1(每回合限1次); L-5: 移除需求外「女装成为锦囊目标摸1」被动 */
  function onBecomeTarget(g, pid, isTrick) {
    const p = g.players[pid];
    if (p.dead) return;
    if (p.prof.id === 'mengxin' && !p.askedThisTurn) { p.askedThisTurn = true; draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name}【问问题】成为目标摸1`, cls: '' }); }
  }

  /* L14: 卸下防具(含内存加固回退; M-13: AC保护离场回血, 换装静默不触发[装备铁律2]) */
  function unequipArmor(g, p, toDiscard, silent) {
    const a = p.armor;
    if (!a) return;
    if (toDiscard && a.id !== -1) g.discard.push(a);
    if (a.key === 'aRam') {
      p.maxHp = Math.max(p.prof.hp + (p.identity === 'lord' ? 2 : 0), p.maxHp - 1);
      if (p.hp > p.maxHp) p.hp = p.maxHp;
    }
    p.armor = null;
    // AC保护: 失去此防具时回复1点体力(缴获/拔网线等非换装离场; 濒死/阵亡不回)
    if (!silent && a.key === 'aAc' && !p.dead && p.hp > 0) {
      p.hp = Math.min(p.maxHp, p.hp + 1);
      g.log.push({ t: g.round, txt: `${p.name}【AC保护】失去防具,回复1点体力`, cls: 'act' });
    }
  }

  /* 单位死亡: 亡语结算(假牌克隆体 id=-1 不触发亡语, 防牌张虚增) */
  function unitDie(g, ownerPid, unitObj, reason) {
    if (unitObj.id !== -1) {
      g.discard.push(unitObj);
      if (spec(unitObj.key).death) {
        draw(g, ownerPid, 1);
        g.log.push({ t: g.round, txt: `${g.players[ownerPid].name} 的【${spec(unitObj.key).name}】亡语:摸1`, cls: 'act' });
      }
    }
  }

  /* L7: AOE 结算顺序: 从使用者下家起按行动顺序 */
  function aoeOrder(g, pid) {
    const order = [];
    let cur = nextAlive(g, pid);
    for (let i = 0; i < g.players.length - 1 && cur !== -1; i++) {
      order.push(cur);
      cur = nextAlive(g, cur);
    }
    return order;
  }

  /* 主公手牌事故重洗(H2-4): 首轮起手4张全≥3费可重洗一次 */
  function lordCanRedraw(g) {
    const l = g.players.find(p => p.identity === 'lord');
    if (!l || l.dead || g.lordRedrawUsed || g.round !== 1 || l.turnsPlayed > 0) return false;
    return l.hand.length === 4 && l.hand.every(c => spec(c.key).cost >= 3);
  }
  function lordRedraw(g) {
    const l = g.players.find(p => p.identity === 'lord');
    if (!lordCanRedraw(g)) return { ok: false, why: '不满足重洗条件' };
    g.lordRedrawUsed = true;
    while (l.hand.length) g.deck.push(l.hand.pop());
    for (let i = g.deck.length - 1; i > 0; i--) { const j = Math.floor(g.rnd() * (i + 1)); [g.deck[i], g.deck[j]] = [g.deck[j], g.deck[i]]; }
    draw(g, l.id, 4);
    g.log.push({ t: g.round, txt: `${l.name} 声明【手牌事故】,重洗起手牌`, cls: 'evt' });
    return { ok: true };
  }

  /* 离场即投降(M22): 手牌与永久物弃置、视为死亡、身份公开(含内奸, 2.4例外二) */
  function playerLeave(g, pid) {
    const p = g.players[pid];
    if (p.dead || g.over) return { ok: false, why: '已阵亡或游戏已结束' };
    p.left = true; // L-12: 离场标记, publicView 据此公开内奸身份
    g.log.push({ t: g.round, txt: `${p.name} 离场投降!身份公开: ${nsData.identities.IDENTITIES[p.identity].name}`, cls: 'bad' });
    nsEngine.battle.kill(g, pid, null);
    return { ok: true };
  }

  /* ---------------- 导出 ---------------- */
  const api = {
    createGame, setup, startTurn, judgePhase, drawPhase, discardPhase, endTurn,
    playCard, equipCard, deployUnit, publicView, aiTurn,
    discardCards, playerLeave,
    nextAlive, draw, spec, effectiveCost, attackPlayer, loseHp, checkVictory,
    evolvePick, tryEvolve, lordCanRedraw, lordRedraw,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  Object.assign(me, api, {
    // 内部工具: 供 battle/tricks/skills 与后续阶段跨模块调用(不进 54 键聚合导出)
    makeRng, buildDeck, cardName, discardCard, discardFromHand, domOf, spend, gainMp,
    judgeCard, end, settleAchievements, queueEvo, checkAwaken, forceEndByCount,
    canPlay, pendingView, pickTarget,
    onBecomeTarget, unequipArmor, unitDie, aoeOrder,
  });
})(typeof window !== 'undefined' ? window : globalThis);
