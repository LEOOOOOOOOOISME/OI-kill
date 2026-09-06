/* ============================================================================
 * OI杀 v4.0 · src/engine/battle.js — 战斗裁决 / 濒死救援 / 响应提示(P1a 拆分)
 * 拆分自 game.js(P1a 模块拆分)。行为零变更: 函数体与原 game.js 逐字一致,
 * 仅跨模块调用改为共享命名空间运行时引用(NS.engine.core.* / NS.data.*)。
 * 挂载: 共享命名空间 OIKill.engine.battle
 * 导出(54 键中的 6 键): respondDodge, respondBetray, respondCold, respondBbst,
 *   respondChase, respondGuard
 * 另向共享命名空间暴露内部工具(供 core/tricks 调用, 不进聚合导出):
 *   canDodge, resolveDodge, afterDodge, resolveHit, nearDeath, kill, giveAttack,
 *   helperDodge, resumeMultiAttack, aiBetrayConsent
 * ==========================================================================*/
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};
  const nsData = NS.data = NS.data || {};
  const nsEngine = NS.engine = NS.engine || {};
  const me = nsEngine.battle = nsEngine.battle || {};

  /* ---------------- 伤害/濒死 ---------------- */
  function nearDeath(g, pid, src) {
    const p = g.players[pid];
    if (p.dead) return;
    g.log.push({ t: g.round, txt: `${p.name} 进入濒死!`, cls: 'bad' });
    // 1. 蒟蒻退役
    if (p.prof.id === 'juruo' && !p.usedRetire) {
      p.usedRetire = true;
      while (p.hand.length) g.discard.push(p.hand.pop());
      if (p.weapon) { g.discard.push(p.weapon); p.weapon = null; }
      nsEngine.core.unequipArmor(g, p, true, true); // 退役弃光装备: 救援链统一回1, 不触发AC保护回血
      p.hp = 1;
      g.log.push({ t: g.round, txt: `${p.name}【退役】弃光所有回1血!`, cls: 'act' });
      return;
    }
    // 2. 内奸颓废标记
    if (p.depression > 0) {
      p.depression--; p.hp = 1;
      g.log.push({ t: g.round, txt: `${p.name} 消耗【颓废标记】回1血(剩${p.depression}枚)`, cls: 'act' });
      return;
    }
    // 3. 金牌教练谈心(自动)
    const mentor = g.players.find(q => !q.dead && q.prof.id === 'jiaolian' && !q.usedMentor && q.hand.length > 0);
    if (mentor && mentor.id !== pid) {
      mentor.usedMentor = true;
      nsEngine.core.discardFromHand(g, mentor, 0);
      p.hp = 1;
      g.log.push({ t: g.round, txt: `${mentor.name}【谈心】弃1手牌救回${p.name}!`, cls: 'act' });
      // 觉醒【名师出高徒】: 被救者与你各从弃牌堆获得1张做法假了(否则摸1)
      if (mentor.awaken) {
        giveAttack(g, mentor); giveAttack(g, p);
        g.log.push({ t: g.round, txt: `${mentor.name}【名师出高徒】双方各得1张攻击`, cls: 'evt' });
      }
      return;
    }
    // 4. 备用电源防具
    if (p.armor && p.armor.key === 'aBattery') {
      g.discard.push(p.armor); p.armor = null; p.hp = 1;
      g.log.push({ t: g.round, txt: `${p.name}【备用电源】自动回1,防具弃置`, cls: 'act' });
      return;
    }
    // 5. 咖啡自救(免费,每回合濒死限1次; 浓缩咖啡回2)
    if (!p.coffeeSaveUsedThisTurn) {
      const coffeeIdx = p.hand.findIndex(c => c.key === 'coffee' || c.key === 'coffeeEvo');
      if (coffeeIdx >= 0) {
        const c = p.hand.splice(coffeeIdx, 1)[0];
        g.discard.push(c);
        p.coffeeSaveUsedThisTurn = true;
        p.hp = Math.min(p.maxHp, Math.max(1, p.hp + (c.key === 'coffeeEvo' ? 2 : 1))); // 修复: 自救后至少1血
        g.log.push({ t: g.round, txt: `${p.name} 喝【${nsEngine.core.spec(c.key).name}】自救回${c.key === 'coffeeEvo' ? 2 : 1}血`, cls: 'act' });
        return;
      }
    }
    // 无人救援 -> 阵亡
    kill(g, pid, src);
  }

  function kill(g, pid, src) {
    const p = g.players[pid];
    p.dead = true;
    while (p.hand.length) g.discard.push(p.hand.pop());
    while (p.units.length) { const u = p.units.pop(); if (u.id !== -1) g.discard.push(u); }
    while (p.delayArea.length) g.discard.push(p.delayArea.pop()); // 判定区牌也入弃牌堆(防牌张丢失)
    if (p.weapon) { g.discard.push(p.weapon); p.weapon = null; }
    if (p.armor) { if (p.armor.id !== -1) g.discard.push(p.armor); p.armor = null; }
    g.log.push({ t: g.round, txt: `${p.name} 阵亡!${p.identity !== 'traitor' ? '身份: ' + nsData.identities.IDENTITIES[p.identity].name : ''}`, cls: 'bad' }); // M23: 内奸身份不公开
    if (src && src.id !== pid) {
      src.kills++;
      g.log.push({ t: g.round, txt: `${src.name} 击杀 ${p.name}`, cls: 'act' });
      if (p.identity === 'rebel') { nsEngine.core.draw(g, src.id, 3); g.log.push({ t: g.round, txt: `${src.name} 击杀反贼,摸3张!`, cls: 'act' }); }
      if (p.identity === 'lord') { src.killedLord = true; } // 掀翻成就
    }
    // 亡语
    for (const u of p.units) { /* 已被弃置,亡语不触发(阵亡弃置不触发) */ }
    nsEngine.core.checkVictory(g);
  }

  function giveAttack(g, p) {
    const idx = g.discard.findIndex(c => nsData.cards.isAttackKey(c.key));
    if (idx >= 0) { const c = g.discard.splice(idx, 1)[0]; p.hand.push(c); }
    else nsEngine.core.draw(g, p.id, 1);
  }

  /* ---------------- 战斗裁决 ---------------- */
  function canDodge(g, p) {
    if (p.armor && p.armor.key === 'aXuan') return true;
    if (p.armor && p.armor.key === 'aDsu' && p.hand.length >= 1) return true;
    return p.hand.some(c => nsData.cards.isDodgeKey(c.key));
  }

  function resolveDodge(g, target, willDodge, dmg, suit, attacker) {
    // 玄学判题(管理员权限无视)
    if (target.armor && target.armor.key === 'aXuan' && !(attacker.weapon && attacker.weapon.key === 'wQgj')) {
      const jc = nsEngine.core.judgeCard(g);
      g.log.push({ t: g.round, txt: `${target.name}【玄学判题】判定 ${nsData.identities.suitZh[jc.suit]}`, cls: 'evt' });
      if (jc.suit === 'heart') {
        g.log.push({ t: g.round, txt: `判定红桃,视为免费打出WA!`, cls: 'act' });
        return afterDodge(g, attacker, target, null, true, dmg);
      }
    }
    if (!willDodge) return resolveHit(g, attacker, target, dmg, { suit });
    // 并查集: 弃1手牌当WA(免灵感; 无WA或灵感不足时兜底)(管理员权限无视)
    if (target.armor && target.armor.key === 'aDsu' && !(attacker.weapon && attacker.weapon.key === 'wQgj') && target.hand.length >= 1 && (!target.hand.some(c => nsData.cards.isDodgeKey(c.key)) || target.mp < 1)) {
      nsEngine.core.discardFromHand(g, target, 0);
      g.log.push({ t: g.round, txt: `${target.name}【并查集】弃1手牌当作WA`, cls: 'act' });
      return afterDodge(g, attacker, target, null, true, dmg);
    }
    const idx = target.hand.findIndex(c => nsData.cards.isDodgeKey(c.key));
    if (idx < 0 || target.mp < 1) return resolveHit(g, attacker, target, dmg, { suit });
    const c = target.hand.splice(idx, 1)[0];
    g.discard.push(c);
    target.mp -= 1;
    g.log.push({ t: g.round, txt: `${target.name} 打出【${nsEngine.core.spec(c.key).name}】,抵消攻击`, cls: 'act' });
    // 成功抵消 -> 进化候选【样例全过】(进化牌不再进化)
    if (c.key === 'dodge') nsEngine.core.queueEvo(g, target.id, 'dodge');
    return afterDodge(g, attacker, target, c, false, dmg);
  }

  function afterDodge(g, attacker, target, waCard, free, dmg) {
    // 样例全过(进化WA): 抵消后回复1体力
    if (waCard && waCard.key === 'dodgeEvo') {
      target.hp = Math.min(target.maxHp, target.hp + 1);
      g.log.push({ t: g.round, txt: `${target.name}【样例全过】抵消后回复1体力`, cls: 'act' });
    }
    // 线段树: 攻击被抵消摸1
    if (attacker.weapon && attacker.weapon.key === 'wSeg') { nsEngine.core.draw(g, attacker.id, 1); g.log.push({ t: g.round, txt: `${attacker.name}【线段树】摸1`, cls: '' }); }
    // 不死心: 被抵消后立即再出一张攻击(需求9.3)
    if (attacker.weapon && attacker.weapon.key === 'wChase' && !attacker.chaseUsed && attacker.hand.some(c => nsData.cards.isAttackKey(c.key)) && !target.dead) {
      if (attacker.id === g.human) {
        g.pending = { type: 'chase', attacker: attacker.id, target: target.id };
        return 'pending';
      }
      const ai = attacker.hand.findIndex(c => nsData.cards.isAttackKey(c.key));
      const ac = attacker.hand.splice(ai, 1)[0];
      g.discard.push(ac);
      attacker.chaseUsed = true;
      g.log.push({ t: g.round, txt: `${attacker.name}【不死心】再出一张${nsEngine.core.spec(ac.key).name}!`, cls: 'act' });
      g.askDodge = (target.id === g.human);
      nsEngine.core.attackPlayer(g, attacker, target, { suit: ac.suit, isEvo: ac.key === 'attackEvo' });
      return 'chased';
    }
    // 平衡树: 被抵消时弃1张强制命中(需求9.3; M-15: 沿用原攻击最终伤害,不固定为1)
    if (attacker.weapon && attacker.weapon.key === 'wBbst' && attacker.hand.length >= 1 && !target.dead) {
      if (attacker.id === g.human) {
        g.pending = { type: 'bbst', attacker: attacker.id, target: target.id, dmg: dmg };
        return 'pending';
      }
      nsEngine.core.discardFromHand(g, attacker, 0);
      g.log.push({ t: g.round, txt: `${attacker.name}【平衡树】弃1强制命中!`, cls: 'act' });
      return resolveHit(g, attacker, target, dmg, {}, false);
    }
    return 'dodged';
  }

  function respondCold(g, pid, yes) {
    const pd = g.pending;
    if (!pd || pd.type !== 'cold') return { ok: false, why: '无挂起的冷数据询问' };
    g.pending = null;
    const atk = g.players[pd.attacker], tgt = g.players[pd.target];
    const r = resolveHit(g, atk, tgt, pd.dmg, pd.opts || {}, !!yes);
    return { ok: true, result: r };
  }
  function respondBbst(g, pid, yes) {
    const pd = g.pending;
    if (!pd || pd.type !== 'bbst') return { ok: false, why: '无挂起的平衡树询问' };
    g.pending = null;
    const atk = g.players[pd.attacker], tgt = g.players[pd.target];
    if (yes) {
      if (atk.hand.length < 1) return { ok: false, why: '手牌不足' };
      nsEngine.core.discardFromHand(g, atk, 0);
      g.log.push({ t: g.round, txt: `${atk.name}【平衡树】弃1强制命中!`, cls: 'act' });
      return { ok: true, result: resolveHit(g, atk, tgt, pd.dmg, {}, false) };
    }
    return { ok: true, result: 'dodged' };
  }
  function respondChase(g, pid, yes) {
    const pd = g.pending;
    if (!pd || pd.type !== 'chase') return { ok: false, why: '无挂起的不死心询问' };
    g.pending = null;
    const atk = g.players[pd.attacker], tgt = g.players[pd.target];
    if (yes) {
      const ai = atk.hand.findIndex(c => nsData.cards.isAttackKey(c.key));
      if (ai < 0) return { ok: false, why: '没有攻击牌' };
      const ac = atk.hand.splice(ai, 1)[0];
      g.discard.push(ac);
      atk.chaseUsed = true;
      g.log.push({ t: g.round, txt: `${atk.name}【不死心】再出一张${nsEngine.core.spec(ac.key).name}!`, cls: 'act' });
      g.askDodge = (tgt.id === g.human);
      return { ok: true, result: nsEngine.core.attackPlayer(g, atk, tgt, { suit: ac.suit, isEvo: ac.key === 'attackEvo' }) };
    }
    return { ok: true, result: 'declined' };
  }

  function resolveHit(g, attacker, target, dmg, opts, cold) {
    // 冷数据: 可选择改为弃置目标2张牌
    if (cold === undefined) {
      if (attacker.weapon && attacker.weapon.key === 'wCold' && target.hand.length >= 2) {
        if (attacker.id === g.human) {
          g.pending = { type: 'cold', attacker: attacker.id, target: target.id, dmg, opts: JSON.parse(JSON.stringify(opts)) };
          return 'pending';
        }
        return resolveHit(g, attacker, target, dmg, opts, true); // AI 自动改为弃牌
      }
      cold = false;
    }
    if (cold) {
      nsEngine.core.discardFromHand(g, target, 0); nsEngine.core.discardFromHand(g, target, 0);
      g.log.push({ t: g.round, txt: `${attacker.name}【冷数据】改为弃置${target.name}2张牌`, cls: 'act' });
      return 'cold';
    }
    // 暴力评测机: 使用者自损
    if (g.eventSuit === 'club') {
      g.log.push({ t: g.round, txt: `${attacker.name} 命中后自己受1伤(暴力评测机)`, cls: 'bad' });
      nsEngine.core.loseHp(g, attacker.id, 1, null, 'event');
    }
    nsEngine.core.loseHp(g, target.id, dmg, attacker, 'attack');
    // 拔网线: 命中弃1装备
    if (attacker.weapon && attacker.weapon.key === 'wBa' && (target.weapon || target.armor)) {
      if (target.armor) { const e = target.armor; nsEngine.core.unequipArmor(g, target, true, false); g.log.push({ t: g.round, txt: `${attacker.name}【拔网线】弃置${target.name}的${nsEngine.core.spec(e.key).name}`, cls: 'act' }); }
      else { const e = target.weapon; target.weapon = null; g.discard.push(e); g.log.push({ t: g.round, txt: `${attacker.name}【拔网线】弃置${target.name}的${nsEngine.core.spec(e.key).name}`, cls: 'act' }); }
    }
    // 双指针
    if (attacker.weapon && attacker.weapon.key === 'wTwoPtr') {
      if (target.hand.length > attacker.hand.length) { nsEngine.core.draw(g, attacker.id, 1); g.log.push({ t: g.round, txt: `${attacker.name}【双指针】摸1`, cls: '' }); }
      else if (target.hand.length < attacker.hand.length && target.hand.length > 0) { nsEngine.core.discardFromHand(g, target, 0); g.log.push({ t: g.round, txt: `${attacker.name}【双指针】目标弃1`, cls: '' }); }
    }
    if (attacker.weapon && attacker.weapon.key === 'wTree') g.log.push({ t: g.round, txt: `${attacker.name}【树状数组】查看${target.name}手牌: ${target.hand.map(c => nsEngine.core.spec(c.key).name).join('、') || '无'}`, cls: '' });
    // 攻击命中 -> 进化候选【实锤】(进化牌不再进化)
    if (!opts.isEvo) nsEngine.core.queueEvo(g, attacker.id, 'attack');
    return 'hit';
  }

  function respondDodge(g, pid, yes, helperId) {
    if (!g.pending || g.pending.type !== 'dodge') return { ok: false, why: '无挂起的WA询问' };
    const pd = g.pending;
    const isBetray = pd.ctx && pd.ctx.betrayConsent;
    // 护驾代出WA: 先校验帮手合法性(校验不消耗询问, pending 保留供UI重新作答)
    let h = null;
    if (!isBetray && helperId !== undefined && helperId !== null) {
      h = g.players[helperId];
      if (!h || h.dead || !canDodge(g, h)) return { ok: false, why: '该玩家无法代出WA' };
    }
    g.pending = null;
    // 卖队友转嫁同意(req 18.3): 被转嫁目标作答 yes=同意转嫁 / no=拒绝(攻击落回原目标)
    if (isBetray) {
      const atk = g.players[pd.attacker];
      const v = g.players[pd.ctx.betrayer];
      if (yes) {
        const nt = g.players[pd.target];
        const bi = v.hand.findIndex(c => c.key === 'funBetray');
        if (bi >= 0 && !g.usedBetray) { const bc = v.hand.splice(bi, 1)[0]; g.discard.push(bc); g.usedBetray = true; }
        if (!nt || nt.dead) return { ok: true, result: 'target-dead' };
        g.log.push({ t: g.round, txt: `${nt.name} 同意被转嫁攻击!`, cls: 'act' });
        g.askDodge = (nt.id === g.human);
        const r = nsEngine.core.attackPlayer(g, atk, nt, { suit: pd.suit, isEvo: pd.isEvo, allowBetray: false, noDodge: false, cardId: pd.cardId });
        return { ok: true, result: r === 'pending' ? r : 'redirected' };
      }
      g.log.push({ t: g.round, txt: `${v.name} 的转嫁被拒绝,攻击继续结算`, cls: 'act' });
      g.askDodge = (v.id === g.human);
      const r = nsEngine.core.attackPlayer(g, atk, v, { suit: pd.suit, isEvo: pd.isEvo, allowBetray: false, noDodge: false, cardId: pd.cardId });
      return { ok: true, result: r };
    }
    const atk = g.players[pd.attacker], tgt = g.players[pd.target];
    let r;
    if (h) {
      // 主公技护驾: 代出WA
      r = helperDodge(g, h, atk, tgt, pd.dmg, { suit: pd.suit, isEvo: pd.isEvo });
    } else {
      r = resolveDodge(g, tgt, yes, pd.dmg, pd.suit, atk);
    }
    // 放手一搏: 继续攻击剩余目标
    if (pd.multi && pd.multi.length) resumeMultiAttack(g, { attacker: pd.attacker, suit: pd.suit, isEvo: pd.isEvo }, pd.multi);
    return { ok: true, result: r };
  }

  function helperDodge(g, helper, attacker, lord, dmg, opts) {
    // M-11: 玄学判题「需出WA时可判定: 红桃视为免费WA」也适用于护驾代出(管理员权限无视)
    if (helper.armor && helper.armor.key === 'aXuan' && !(attacker.weapon && attacker.weapon.key === 'wQgj')) {
      const jc = nsEngine.core.judgeCard(g);
      g.log.push({ t: g.round, txt: `${helper.name}【玄学判题】替${lord.name}判定 ${nsData.identities.suitZh[jc.suit]}`, cls: 'evt' });
      if (jc.suit === 'heart') {
        g.log.push({ t: g.round, txt: `判定红桃,视为免费打出WA!`, cls: 'act' });
        return afterDodge(g, attacker, lord, null, true, dmg);
      }
    }
    const idx = helper.hand.findIndex(c => nsData.cards.isDodgeKey(c.key));
    if (idx >= 0 && helper.mp >= 1) {
      const c = helper.hand.splice(idx, 1)[0];
      g.discard.push(c); helper.mp -= 1;
      g.log.push({ t: g.round, txt: `${helper.name} 打出【${nsEngine.core.spec(c.key).name}】替${lord.name}抵挡(护驾)`, cls: 'act' });
      if (c.key === 'dodge') nsEngine.core.queueEvo(g, helper.id, 'dodge');
      return afterDodge(g, attacker, lord, c, false, dmg);
    }
    if (helper.armor && helper.armor.key === 'aDsu' && helper.hand.length >= 1) {
      nsEngine.core.discardFromHand(g, helper, 0);
      g.log.push({ t: g.round, txt: `${helper.name}【并查集】弃1手牌替${lord.name}抵挡(护驾)`, cls: 'act' });
      return afterDodge(g, attacker, lord, null, true, dmg);
    }
    // M-11: 无法代出WA -> 攻击继续命中主公(修复"免费且无判定地抵消")
    return resolveHit(g, attacker, lord, dmg, opts || { suit: 'spade' }, false);
  }

  function resumeMultiAttack(g, pd, targets) {
    const atk = g.players[pd.attacker];
    for (const tid of targets) {
      const t = g.players[tid];
      if (!t || t.dead) continue;
      g.askDodge = (tid === g.human);
      const r = nsEngine.core.attackPlayer(g, atk, t, { suit: pd.suit, isEvo: pd.isEvo });
      if (r === 'pending') {
        g.pending.multi = targets.slice(targets.indexOf(tid) + 1);
        g.pending.isEvo = pd.isEvo;
        g.pending.pid = pd.attacker;
        return;
      }
    }
  }

  /* 忠臣挡刀由引擎自动裁决(AI忠臣), 无挂起询问; 此API为UI兼容占位 */
  function respondGuard(g, pid, yes) {
    return { ok: false, why: '挡刀由引擎自动裁决,无挂起询问' };
  }

  /* 卖队友转嫁同意(引擎侧AI决策): 新目标受到该伤害后仍存活则同意,否则拒绝 */
  function aiBetrayConsent(g, nt, dmg) {
    if (nt.dead) return false;
    return nt.hp > dmg;
  }

  /* 卖队友响应: 被攻击者把攻击转给 targetId(req 18.3: 需新目标同意) */
  function respondBetray(g, pid, targetId) {
    const pd = g.pending;
    if (!pd || pd.type !== 'dodge') return { ok: false, why: '无挂起的攻击询问' };
    g.pending = null;
    const v = g.players[pid];
    const bi = v.hand.findIndex(c => c.key === 'funBetray');
    if (bi < 0 || g.usedBetray) return { ok: false, why: '无卖队友或本局已用过' };
    const nt = g.players[targetId];
    if (!nt || nt.dead || nt.id === pid || nt.id === pd.attacker) return { ok: false, why: '目标无效' };
    const atk = g.players[pd.attacker];
    if (nt.id !== g.human) {
      // AI新目标: 引擎侧同意判定; 拒绝则不消耗牌,攻击继续对原目标结算
      if (!aiBetrayConsent(g, nt, pd.dmg)) {
        g.log.push({ t: g.round, txt: `${nt.name} 拒绝被转嫁,攻击继续结算`, cls: 'act' });
        g.askDodge = (v.id === g.human);
        const r = nsEngine.core.attackPlayer(g, atk, v, { suit: pd.suit, isEvo: pd.isEvo, allowBetray: false, noDodge: pd.noDodge, cardId: pd.cardId });
        return { ok: true, result: r };
      }
      const bc = v.hand.splice(bi, 1)[0];
      g.discard.push(bc); g.usedBetray = true;
      g.log.push({ t: g.round, txt: `${v.name}【卖队友】把攻击转给了${nt.name}(对方同意)!`, cls: 'act' });
      g.askDodge = false;
      const r = nsEngine.core.attackPlayer(g, atk, nt, { suit: pd.suit, isEvo: pd.isEvo, allowBetray: false, noDodge: pd.noDodge, cardId: pd.cardId });
      return { ok: true, result: r === 'pending' ? r : 'redirected' };
    }
    // 人类新目标: 挂起同意询问(dodge + ctx.betrayConsent), 经 respondDodge 作答(yes=同意); 牌暂不消耗,拒绝则退回
    g.pending = { type: 'dodge', attacker: pd.attacker, target: nt.id, dmg: pd.dmg, suit: pd.suit, cardId: pd.cardId, isEvo: pd.isEvo, srcId: pd.attacker, ctx: { betrayConsent: true, betrayer: pid } };
    return { ok: true, result: 'pending-consent' };
  }

  /* ---------------- 导出 ---------------- */
  const api = {
    respondDodge, respondBetray, respondCold, respondBbst, respondChase, respondGuard,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  Object.assign(me, api, {
    // 内部工具: 供 core/tricks 跨模块调用(不进 54 键聚合导出)
    canDodge, resolveDodge, afterDodge, resolveHit,
    nearDeath, kill, giveAttack,
    helperDodge, resumeMultiAttack, aiBetrayConsent,
  });
})(typeof window !== 'undefined' ? window : globalThis);
