/* ============================================================================
 * OI杀 v4.0 · src/engine/tricks.js — 锦囊/特判/AOE/欢乐牌结算(P1a 拆分)
 * 拆分自 game.js(P1a 模块拆分)。行为零变更: 函数体与原 game.js 逐字一致,
 * 仅跨模块调用改为共享命名空间运行时引用(NS.engine.core.* / NS.engine.battle.* / NS.data.*)。
 * 挂载: 共享命名空间 OIKill.engine.tricks
 * 导出(54 键中的 7 键): respondCounter, respondAoeResp, respondHarvest,
 *   respondReport, discardFun, kspAttack, fangAttack
 * P2: respondCounter/respondAoeResp/respondHarvest/respondReport 追加可选末位 promptId。
 * 另向共享命名空间暴露内部工具(供 core 调用, 不进聚合导出):
 *   counterChain, tryCounter, tryCounterOther, counterAsk, contFromCtx,
 *   runCounterCont, doTrickSelf, doKillUnit, powerStep, doTrickCore,
 *   aoeApplyOne, resumeAoe, argueStep, argueApplyOne, harvestStep 及 COUNTERABLE;
 *   P2 提示组工具: precreateAoe, precreateArgue, precreateHarvest, effAoeDmg
 * ==========================================================================*/
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};
  const nsData = NS.data = NS.data || {};
  const nsEngine = NS.engine = NS.engine || {};
  const me = nsEngine.tricks = nsEngine.tricks || {};

  /* ---------------- P3b: AI 决策模块引用 ---------------- */
  /* 延迟加载避免模块加载环(heuristics→tricks→heuristics); 浏览器无 ai 脚本时回落
   * 命名空间, 皆无则返回 null(调用点回落旧引擎行为)。 */
  let _heu = null;
  function aiHeu() {
    if (_heu) return _heu;
    if (typeof module !== 'undefined' && module.exports) {
      try { _heu = require('../ai/heuristics.js'); } catch (e) { _heu = null; }
    }
    if (!_heu) _heu = (NS.ai && NS.ai.heuristics) || null;
    return _heu;
  }

  /* ---------------- 特判(反制) ---------------- */
  // 可被特判抵消的锦囊(9.2: 抵消一张正在结算的锦囊对一名角色的效果; 延时锦囊/装备/技能不可抵消)
  const COUNTERABLE = ['duel', 'duelEvo', 'dismantle', 'draw2', 'steal', 'skipPlay', 'o2', 'pierce', 'cheat', 'recover', 'gift',
    'aoeAtk', 'aoeAtkEvo', 'aoeDodge', 'aoeDodgeEvo', 'allHeal', 'harvest', 'killUnit', 'killUnitEvo', 'peek', 'mull',
    'funLie', 'funReport', 'funClone', 'funGiveup', 'funPower', 'funArgue', 'funCcf', 'counter', 'counterEvo'];
  /* 特判连锁反制(9.2/FAQ#2): 从上一张特判使用者下家起按座位序询问, 其他玩家可再出特判反制该特判;
   * 链上第奇数张特判生效(原锦囊被抵消), 第偶数张使前一张失效(原锦囊继续结算)。
   * 返回 'pending'(人类挂起) / true(原锦囊被抵消) / false(原锦囊继续结算) */
  function counterChain(g, trickKey, srcId, lastCounterer, depth, cont) {
    const n = g.players.length;
    for (let i = 1; i <= n; i++) {
      const q = g.players[(lastCounterer + i) % n];
      if (!q || q.dead || q.id === lastCounterer) continue;
      const idx = q.hand.findIndex(c => c.key === 'counter' || c.key === 'counterEvo');
      if (idx < 0 || q.mp < 1) continue;
      if (g.isHuman(q.id)) {
        nsEngine.core.setPrompt(g, { type: 'counter', pid: q.id, victim: q.id, srcId, trickKey, ctx: { type: 'counterChain', trickKey, srcId, depth, cont } });
        return 'pending';
      }
      // P3b 接线#7: AI 连锁反制决策走 heuristics(有害锦囊+保留清单+链层奇偶语义);
      // 放弃则按座次序询问下家(与人类连锁语义一致); 无 ai 模块回落旧行为(无条件反制)
      const heu = aiHeu();
      if (heu) {
        const d = heu.chooseResponse(g, q.id, { type: 'counter', pid: q.id, victim: q.id, srcId, trickKey, ctx: { type: 'counterChain', trickKey, srcId, depth, cont } }, { difficulty: g.difficulty });
        if (!d || d.kind !== 'respondCounter' || d.yes !== true) continue; // 放弃连锁
      }
      const c = q.hand.splice(idx, 1)[0];
      g.discard.push(c); q.mp -= 1;
      g.log.push({ t: g.round, txt: `${q.name} 使用【${nsEngine.core.spec(c.key).name}】连锁反制${g.players[lastCounterer].name}的特判!`, cls: 'act' });
      if (c.key === 'counterEvo') { nsEngine.core.draw(g, q.id, 1); g.log.push({ t: g.round, txt: `${q.name}【一票否决】摸1`, cls: '' }); }
      else nsEngine.core.queueEvo(g, q.id, 'counter');
      const r = counterChain(g, trickKey, srcId, q.id, depth + 1, cont);
      if (r === 'pending') return 'pending';
      return r;
    }
    return depth % 2 === 1; // 链冻结: 奇数张特判生效
  }
  /* 受害者特判询问/结算; cont 为反制链冻结后的继续信息 */
  function tryCounter(g, victimId, trickKey, srcId, cont) {
    const p = g.players[victimId];
    if (p.dead) return false;
    const idx = p.hand.findIndex(c => c.key === 'counter' || c.key === 'counterEvo');
    if (idx < 0 || p.mp < 1) return false;
    if (g.isHuman(victimId)) {
      nsEngine.core.setPrompt(g, { type: 'counter', pid: victimId, victim: victimId, srcId, trickKey });
      return 'pending';
    }
    /* P3b 接线#7 冲突记录: 受害者特判决策保留旧引擎行为(持特判必反制)。
     * p3a chooseResponse('counter') 对"有害但不在 saveCounterFor 清单"的锦囊走概率分支
     * (normal 档约 63.5%), 会使 AI 受害者随机放弃反制 —— test-extra E25(祖安对线特判段)
     * 断言 AI 受害者必反制自身段, 与该概率语义冲突。为保 E 套件全绿, 此单点保留旧判定;
     * 连锁反制(counterChain)与第三方反制(tryCounterOther)仍走 heuristics 的链层奇偶语义。 */
    const c = p.hand.splice(idx, 1)[0];
    g.discard.push(c); p.mp -= 1;
    g.log.push({ t: g.round, txt: `${p.name} 使用【${nsEngine.core.spec(c.key).name}】抵消了${nsEngine.core.spec(trickKey).name}的效果!`, cls: 'act' });
    if (c.key === 'counterEvo') { nsEngine.core.draw(g, victimId, 1); g.log.push({ t: g.round, txt: `${p.name}【一票否决】摸1`, cls: '' }); }
    else nsEngine.core.queueEvo(g, victimId, 'counter');
    // 连锁反制: 其他玩家可反制这张特判
    const ch = counterChain(g, trickKey, srcId, victimId, 1, cont);
    if (ch === 'pending') return 'pending';
    return ch; // true=原锦囊被抵消; false=特判被连锁反制,原锦囊继续结算
  }
  /* 其他玩家(按座位序, 跳过 caster/excludeId)对自益锦囊的抵消; 返回 'pending'/'countered'/'proceed' */
  function tryCounterOther(g, casterId, trickKey, cont, excludeId) {
    const n = g.players.length;
    for (let i = 1; i <= n; i++) {
      const q = g.players[(casterId + i) % n];
      if (!q || q.dead || q.id === casterId || q.id === excludeId) continue;
      const idx = q.hand.findIndex(c => c.key === 'counter' || c.key === 'counterEvo');
      if (idx < 0 || q.mp < 1) continue;
      if (g.isHuman(q.id)) {
        nsEngine.core.setPrompt(g, { type: 'counter', pid: q.id, victim: q.id, srcId: casterId, trickKey, ctx: { type: 'counterChain', trickKey, srcId: casterId, depth: 0, cont } });
        return 'pending';
      }
      // P3b 接线#7: AI 其他玩家反制决策走 heuristics(链层奇偶语义: 自益锦囊默认不反制,
      // 题解大会只反制敌意选牌者); 放弃则按座次序询问下家; 无 ai 模块回落旧行为(无条件反制)
      const heu = aiHeu();
      if (heu) {
        const d = heu.chooseResponse(g, q.id, { type: 'counter', pid: q.id, victim: q.id, srcId: casterId, trickKey, ctx: { type: 'counterChain', trickKey, srcId: casterId, depth: 0, cont } }, { difficulty: g.difficulty });
        if (!d || d.kind !== 'respondCounter' || d.yes !== true) continue; // 放弃反制
      }
      const c = q.hand.splice(idx, 1)[0];
      g.discard.push(c); q.mp -= 1;
      g.log.push({ t: g.round, txt: `${q.name} 使用【${nsEngine.core.spec(c.key).name}】抵消了${nsEngine.core.spec(trickKey).name}对一名角色的效果!`, cls: 'act' });
      if (c.key === 'counterEvo') { nsEngine.core.draw(g, q.id, 1); g.log.push({ t: g.round, txt: `${q.name}【一票否决】摸1`, cls: '' }); }
      else nsEngine.core.queueEvo(g, q.id, 'counter');
      const ch = counterChain(g, trickKey, casterId, q.id, 1, cont);
      if (ch === 'pending') return 'pending';
      return ch === true ? 'countered' : 'proceed';
    }
    return 'proceed';
  }
  /* 统一的特判询问入口: 'pending' | 'countered' | 'proceed' */
  function counterAsk(g, victimId, trickKey, srcId, cont) {
    const cr = tryCounter(g, victimId, trickKey, srcId, cont);
    if (cr !== 'pending') return cr === true ? 'countered' : 'proceed';
    const pe = nsEngine.core.lastPrompt(g);
    if (pe.ctx && pe.ctx.type === 'counterChain') return 'pending'; // 连锁询问已自带 cont
    if (cont && cont.ctx) pe.ctx = cont.ctx;
    return 'pending';
  }
  /* 由挂起特判的 ctx 重建继续信息(用于 respondCounter) */
  function contFromCtx(pd) {
    if (pd.ctx && pd.ctx.type === 'aoe') return { kind: 'aoe', ctx: pd.ctx };
    if (pd.ctx && pd.ctx.type === 'argue') return { kind: 'argue', ctx: { srcId: pd.ctx.srcId, targetId: pd.ctx.targetId, remaining: pd.ctx.remaining, groupId: pd.ctx.groupId } };
    if (pd.ctx && pd.ctx.type === 'killUnit') return { kind: 'killUnit', ctx: pd.ctx };
    if (pd.ctx && pd.ctx.type === 'power') return { kind: 'power', ctx: pd.ctx };
    if (pd.ctx && pd.ctx.type === 'harvest') return { kind: 'harvest', ctx: pd.ctx };
    if (pd.ctx && pd.ctx.targetId !== undefined) return { kind: 'trick', ctx: { srcId: pd.srcId, trickKey: pd.trickKey, targetId: pd.ctx.targetId } };
    return { kind: 'none', ctx: {} };
  }
  /* 反制链冻结后的收尾: countered=true 表示原锦囊被抵消, false 表示继续结算原锦囊 */
  function runCounterCont(g, cont, countered) {
    if (!cont) return;
    if (cont.kind === 'aoe') {
      const a = cont.ctx;
      if (countered) { resumeAoe(g, a); return; }
      const r = aoeApplyOne(g, a.srcId, a.trickKey, a.dmg, a.current, a);
      if (r === 'pending') { precreateAoe(g, nsEngine.core.lastPrompt(g).ctx); return; }
      resumeAoe(g, a);
    } else if (cont.kind === 'argue') {
      const ar = cont.ctx;
      if (countered) { argueStep(g, ar.srcId, ar.remaining, ar.groupId); return; }
      const r = argueApplyOne(g, ar.srcId, ar.targetId, ar.groupId, ar.remaining);
      if (r !== 'pending') argueStep(g, ar.srcId, ar.remaining, ar.groupId);
    } else if (cont.kind === 'trick') {
      if (!countered) doTrickCore(g, cont.ctx.srcId, cont.ctx.trickKey, cont.ctx.targetId);
    } else if (cont.kind === 'self') {
      if (!countered) doTrickSelf(g, cont.ctx.srcId, cont.ctx.trickKey, cont.ctx.card);
    } else if (cont.kind === 'killUnit') {
      if (!countered) doKillUnit(g, cont.ctx.srcId, cont.ctx.targetId, cont.ctx.cardKey, cont.ctx.cardId);
    } else if (cont.kind === 'power') {
      const pc = cont.ctx;
      const q = g.players[pc.ownerId];
      if (countered) g.log.push({ t: g.round, txt: `${q.name} 特判抵消了机房断电对自己的效果`, cls: 'act' });
      else if (q && !q.dead && q.units.length) {
        const u = q.units.pop();
        nsEngine.core.unitDie(g, q.id, u, 'funPower'); // 亡语(10.1)
        g.log.push({ t: g.round, txt: `【机房断电】${q.name}的【${nsEngine.core.spec(u.key).name}】被消灭`, cls: 'act' });
      }
      powerStep(g, pc.srcId, pc.owners, pc.idx + 1);
    } else if (cont.kind === 'harvest') {
      const hc = cont.ctx;
      const picker = g.players[hc.order[hc.pos]];
      if (countered) {
        g.log.push({ t: g.round, txt: `${picker.name} 的选牌被特判抵消`, cls: 'act' });
        hc.pos++;
      } else {
        if (g.isHuman(picker.id)) {
          nsEngine.core.setPrompt(g, { type: 'harvest', pid: picker.id, victim: picker.id, ctx: hc, pickerPos: hc.pos });
          precreateHarvest(g, hc);
          return;
        }
        const got = hc.cards.shift();
        picker.hand.push(got);
        g.log.push({ t: g.round, txt: `${picker.name} 选走【${nsEngine.core.spec(got.key).name}】`, cls: '' });
        hc.pos++;
      }
      harvestStep(g, hc);
    }
  }
  function respondCounter(g, pid, yes, promptId) {
    const pd = nsEngine.core.takePrompt(g, ['counter'], pid, promptId);
    if (!pd) return { ok: false, why: '无挂起的特判询问' };
    // 连锁反制询问: 对上一张特判进行反制
    if (pd.ctx && pd.ctx.type === 'counterChain') {
      const chain = pd.ctx;
      if (yes) {
        const p = g.players[pid];
        const idx = p.hand.findIndex(c => c.key === 'counter' || c.key === 'counterEvo');
        if (idx < 0 || p.mp < 1) return { ok: false, why: '无特判或灵感不足' };
        const c = p.hand.splice(idx, 1)[0];
        g.discard.push(c); p.mp -= 1;
        g.log.push({ t: g.round, txt: `${p.name} 使用【${nsEngine.core.spec(c.key).name}】连锁反制特判!`, cls: 'act' });
        if (c.key === 'counterEvo') { nsEngine.core.draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name}【一票否决】摸1`, cls: '' }); }
        else nsEngine.core.queueEvo(g, pid, 'counter');
        const ch = counterChain(g, chain.trickKey, chain.srcId, pid, chain.depth + 1, chain.cont);
        if (ch === 'pending') return { ok: true, countered: true, chained: true };
        runCounterCont(g, chain.cont, ch === true);
        return { ok: true, countered: ch === true, chained: true };
      }
      // 放弃连锁: 链冻结, 奇数张则原锦囊仍被抵消
      runCounterCont(g, chain.cont, chain.depth % 2 === 1);
      return { ok: true, countered: chain.depth % 2 === 1 };
    }
    if (yes) {
      const p = g.players[pid];
      const idx = p.hand.findIndex(c => c.key === 'counter' || c.key === 'counterEvo');
      if (idx < 0 || p.mp < 1) return { ok: false, why: '无特判或灵感不足' };
      const c = p.hand.splice(idx, 1)[0];
      g.discard.push(c); p.mp -= 1;
      g.log.push({ t: g.round, txt: `${p.name} 使用【${nsEngine.core.spec(c.key).name}】抵消了${nsEngine.core.spec(pd.trickKey).name}的效果!`, cls: 'act' });
      if (c.key === 'counterEvo') { nsEngine.core.draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name}【一票否决】摸1`, cls: '' }); }
      else nsEngine.core.queueEvo(g, pid, 'counter');
      const cont = contFromCtx(pd);
      const ch = counterChain(g, pd.trickKey, pd.srcId, pid, 1, cont);
      if (ch === 'pending') return { ok: true, countered: true, chained: true };
      runCounterCont(g, cont, ch === true);
      return ch === true ? { ok: true, countered: true } : { ok: true, countered: false, chained: true };
    }
    // 放弃反制 -> 原锦囊效果结算
    runCounterCont(g, contFromCtx(pd), false);
    return { ok: true, countered: false };
  }
  /* 自益锦囊核心效果(特判可反制; 牌已离手, 结算时入弃牌堆) */
  function doTrickSelf(g, srcId, trickKey, card) {
    const p = g.players[srcId];
    switch (trickKey) {
      case 'draw2': case 'funLie': {
        g.discard.push(card);
        if (trickKey === 'funLie') p.canAttack = false;
        nsEngine.core.draw(g, srcId, 2);
        g.log.push({ t: g.round, txt: `${p.name} 使用【${nsEngine.core.spec(trickKey).name}】摸2张`, cls: 'act' });
        return { ok: true };
      }
      case 'peek': {
        g.discard.push(card);
        if (g.deck.length) { const top = g.deck[g.deck.length - 1]; g.log.push({ t: g.round, txt: `${p.name}【小抄】查看牌堆顶: ${nsEngine.core.spec(top.key).name}`, cls: '' }); }
        return { ok: true };
      }
      case 'mull': {
        g.discard.push(card);
        nsEngine.core.discardFromHand(g, p, 0); nsEngine.core.draw(g, srcId, 1);
        g.log.push({ t: g.round, txt: `${p.name}【复盘】弃1摸1`, cls: '' });
        return { ok: true };
      }
      case 'cheat': {
        g.discard.push(card);
        p.hp = Math.min(p.maxHp, p.hp + 1);
        g.log.push({ t: g.round, txt: `${p.name}【骗分】回复1点体力`, cls: 'act' });
        return { ok: true };
      }
      case 'recover': {
        const got = g.discard.splice(Math.floor(g.rnd() * g.discard.length), 1)[0]; // L2: 先取再弃自身
        g.discard.push(card);
        p.hand.push(got);
        g.log.push({ t: g.round, txt: `${p.name}【申诉】从弃牌堆获得【${nsEngine.core.spec(got.key).name}】`, cls: 'act' });
        return { ok: true };
      }
      case 'funGiveup': {
        g.discard.push(card);
        const n = p.hand.length;
        while (p.hand.length) g.discard.push(p.hand.pop());
        nsEngine.core.draw(g, srcId, 3);
        g.log.push({ t: g.round, txt: `${p.name}【摆烂宣言】弃${n}张摸3张!`, cls: 'act' });
        return { ok: true };
      }
      case 'funClone': {
        g.discard.push(card);
        const u = p.units[0];
        p.units.push({ key: u.key, id: -1 });
        g.usedClone = true;
        g.log.push({ t: g.round, txt: `${p.name}【开小号】复制了【${nsEngine.core.spec(u.key).name}】`, cls: 'act' });
        return { ok: true };
      }
      default: return { ok: false, why: '未实现: ' + trickKey };
    }
  }
  /* 删库核心效果(特判可反制; 亡语+进化) */
  function doKillUnit(g, srcId, targetId, cardKey, cardId) {
    const target = g.players[targetId];
    if (!target || target.dead || target.units.length === 0) return { ok: true };
    const u = target.units.pop();
    g.log.push({ t: g.round, txt: `${g.players[srcId].name}【${nsEngine.core.spec(cardKey).name}】消灭${target.name}的【${nsEngine.core.spec(u.key).name}】`, cls: 'act' });
    nsEngine.core.unitDie(g, targetId, u, 'killUnit'); // 亡语: 被消灭时原主人摸1(10.1)
    if (cardKey === 'killUnit') nsEngine.core.queueEvo(g, srcId, 'killUnit', cardId); // 15.2: 进化候选【清空回收站】
    if (cardKey === 'killUnitEvo') { nsEngine.core.draw(g, srcId, 1); g.log.push({ t: g.round, txt: `${g.players[srcId].name}【清空回收站】消灭单位后摸1`, cls: 'act' }); }
    return { ok: true };
  }
  /* 机房断电分段结算(特判可反制; 至多2个单位) */
  function powerStep(g, srcId, owners, idx) {
    let destroyed = 0;
    for (let i = idx; i < owners.length && destroyed < 2; i++) {
      const q = owners[i];
      if (q.dead || !q.units.length) continue;
      const cont = { kind: 'power', ctx: { type: 'power', srcId, owners, idx: i, ownerId: q.id } };
      const cr = tryCounter(g, q.id, 'funPower', srcId, cont);
      if (cr === 'pending') {
        const pe = nsEngine.core.lastPrompt(g);
        if (!(pe.ctx && pe.ctx.type === 'counterChain')) pe.ctx = cont.ctx;
        return { ok: true, result: 'pending' };
      }
      if (cr === true) { g.log.push({ t: g.round, txt: `${q.name} 特判抵消了机房断电对自己的效果`, cls: 'act' }); continue; }
      const u = q.units.pop();
      nsEngine.core.unitDie(g, q.id, u, 'funPower'); // 亡语(10.1)
      g.log.push({ t: g.round, txt: `【机房断电】${q.name}的【${nsEngine.core.spec(u.key).name}】被消灭`, cls: 'act' });
      destroyed++;
    }
    if (destroyed === 0) g.log.push({ t: g.round, txt: `【机房断电】未消灭任何单位`, cls: '' });
    return { ok: true, result: 'done' };
  }
  /* 可反制锦囊的核心效果 */
  function doTrickCore(g, srcId, trickKey, targetId) {
    const p = g.players[srcId];
    const t = g.players[targetId];
    if (t.dead) return { ok: true, result: 'target-dead' };
    nsEngine.core.onBecomeTarget(g, targetId, true); // 萌新: 成为锦囊唯一目标
    switch (trickKey) {
      case 'dismantle': {
        if (t.hand.length === 0) { g.log.push({ t: g.round, txt: `【爆零】${t.name}无手牌,落空`, cls: '' }); return { ok: true }; }
        const idx = Math.floor(g.rnd() * t.hand.length);
        const rc = t.hand.splice(idx, 1)[0];
        g.discard.push(rc);
        g.log.push({ t: g.round, txt: `${p.name}【爆零】弃置${t.name}一张手牌`, cls: 'act' });
        return { ok: true };
      }
      case 'steal': {
        if (t.weapon) { if (p.weapon) g.discard.push(p.weapon); p.weapon = t.weapon; t.weapon = null; g.log.push({ t: g.round, txt: `${p.name}【抄袭代码】缴获${t.name}的武器`, cls: 'act' }); }
        else if (t.armor) { const ta = t.armor; nsEngine.core.unequipArmor(g, t, false, false); nsEngine.core.unequipArmor(g, p, true, true); p.armor = ta; if (ta.key === 'aRam') p.maxHp += 1; g.log.push({ t: g.round, txt: `${p.name}【抄袭代码】缴获${t.name}的防具`, cls: 'act' }); }
        else if (t.hand.length) { const idx = Math.floor(g.rnd() * t.hand.length); const rc = t.hand.splice(idx, 1)[0]; p.hand.push(rc); g.log.push({ t: g.round, txt: `${p.name}【抄袭代码】获得${t.name}一张手牌`, cls: 'act' }); }
        else g.log.push({ t: g.round, txt: `【抄袭代码】${t.name}无可缴获,落空`, cls: '' });
        return { ok: true };
      }
      case 'pierce': {
        nsEngine.core.loseHp(g, targetId, 1, p, 'pierce');
        g.log.push({ t: g.round, txt: `${p.name}【卡评测机】对${t.name}造成1点不可闪避伤害`, cls: 'act' });
        return { ok: true };
      }
      case 'o2': {
        const atkIdx = p.hand.findIndex(x => nsData.cards.isAttackKey(x.key));
        if (atkIdx < 0) { g.log.push({ t: g.round, txt: `【O2优化】没有攻击牌,落空`, cls: '' }); return { ok: true }; }
        const ac = p.hand.splice(atkIdx, 1)[0]; g.discard.push(ac);
        g.log.push({ t: g.round, txt: `${p.name}【O2优化】对${t.name}造成2点伤害`, cls: 'act' });
        nsEngine.core.loseHp(g, targetId, 2, p, 'o2');
        return { ok: true };
      }
      case 'skipPlay': {
        t.skipPlayNext = true; // H9: 下回合开始才生效
        g.log.push({ t: g.round, txt: `${p.name}【停课集训】${t.name}下回合跳过行动阶段`, cls: 'act' });
        return { ok: true };
      }
      case 'gift': {
        nsEngine.core.draw(g, targetId, 2);
        g.log.push({ t: g.round, txt: `${p.name}【玄学优化】让${t.name}摸2张`, cls: 'act' });
        return { ok: true };
      }
      case 'funReport': {
        if (t.hand.length === 0) { g.log.push({ t: g.round, txt: `【举报】${t.name}无手牌,落空`, cls: '' }); return { ok: true }; }
        // M12: 人类选择弃哪张
        if (g.isHuman(srcId)) {
          nsEngine.core.setPrompt(g, { type: 'report', pid: srcId, victim: srcId, ctx: { targetId, cards: t.hand.map(c => ({ key: c.key, id: c.id, name: nsEngine.core.spec(c.key).name })) } });
          return { ok: true, result: 'pending' };
        }
        // P3b 接线#11: AI 举报弃牌决策走 heuristics(弃目标价值最高的牌); 无 ai 模块回落随机
        let idx = -1;
        const heu = aiHeu();
        if (heu) {
          const d = heu.chooseResponse(g, srcId, { type: 'report', pid: srcId, victim: srcId, ctx: { targetId, cards: t.hand.map(c => ({ key: c.key, id: c.id, name: nsEngine.core.spec(c.key).name })) } }, { difficulty: g.difficulty });
          if (d && d.kind === 'respondReport' && d.cardKey != null) idx = t.hand.findIndex(c => c.key === d.cardKey);
        }
        if (idx < 0) idx = Math.floor(g.rnd() * t.hand.length);
        const rc = t.hand.splice(idx, 1)[0]; g.discard.push(rc);
        g.log.push({ t: g.round, txt: `${p.name}【举报】弃置${t.name}一张手牌`, cls: 'act' });
        return { ok: true };
      }
      case 'funArgue': {
        // 祖安对线(req 18.3): 单段结算(特判放弃后) — 目标自选弃1张或受1伤
        argueApplyOne(g, srcId, targetId);
        return { ok: true };
      }
      case 'duel': case 'duelEvo': {
        // M8: 双方轮流出攻击,先无者受伤(duelEvo=WC对决: 败者受2伤)
        const dmg = trickKey === 'duelEvo' ? 2 : 1;
        let cur = p, other = t, n = 0;
        while (n++ < 60) {
          const idx = cur.hand.findIndex(x => nsData.cards.isAttackKey(x.key));
          if (idx < 0) {
            g.log.push({ t: g.round, txt: `${cur.name}【${nsEngine.core.spec(trickKey).name}】无攻击,受到${dmg}伤`, cls: 'bad' });
            nsEngine.core.loseHp(g, cur.id, dmg, p, 'duel');
            if (cur.id === t.id && trickKey === 'duel') nsEngine.core.queueEvo(g, srcId, 'duel');
            return { ok: true };
          }
          const ac = cur.hand.splice(idx, 1)[0];
          g.discard.push(ac);
          g.log.push({ t: g.round, txt: `${cur.name} 打出${nsEngine.core.spec(ac.key).name}响应对拍`, cls: '' });
          const tmp = cur; cur = other; other = tmp;
        }
        return { ok: true };
      }
      default: return { ok: false, why: '未实现: ' + trickKey };
    }
  }
  /* AOE 实际伤害(事件±1, M-4) */
  function effAoeDmg(g, dmg) {
    let effDmg = dmg;
    if (g.eventSuit === 'spade') effDmg = Math.max(1, effDmg - 1);
    if (g.eventSuit === 'club') effDmg += 1;
    return effDmg;
  }
  function aoeApplyOne(g, srcId, trickKey, dmg, pid, aoeCtx) {
    const q = g.players[pid];
    const p = g.players[srcId];
    // L-4: AOE 多目标不触发萌新「问问题」(需唯一目标)
    // M-4: 评测机事件同样作用于AOE伤害(17章相互作用)
    const effDmg = effAoeDmg(g, dmg);
    // 人类受害者: 挂起响应选择(M20); P2: 携带 aoeId/groupId 的 ctx(供组内批量预建与恢复)
    if (g.isHuman(q.id) && (trickKey === 'aoeAtk' || trickKey === 'aoeAtkEvo' || trickKey === 'aoeDodge' || trickKey === 'aoeDodgeEvo')) {
      const base = aoeCtx || { type: 'aoe', trickKey, srcId, dmg, current: pid, remaining: [] };
      const aoeId = base.aoeId || ('aoe-' + (++g.promptSeq));
      if (nsEngine.core.findPrompt(g, { type: 'aoeResp', pid: q.id, ctxKey: 'aoeId', ctxVal: aoeId })) return 'pending'; // 该目标已挂起(复用, 不重复建)
      const rest = (base.remaining || []).slice();
      nsEngine.core.setPrompt(g, {
        type: 'aoeResp', pid: q.id, victim: q.id, srcId, trickKey, dmg: effDmg,
        ctx: { type: 'aoe', trickKey, srcId, dmg, current: pid, remaining: rest, aoeId, groupId: aoeId },
      });
      return 'pending';
    }
    if (trickKey === 'allHeal' || trickKey === 'funCcf') {
      q.hp = Math.min(q.maxHp, q.hp + 1);
      g.log.push({ t: g.round, txt: `${q.name} 回复1点体力`, cls: 'act' });
      return;
    }
    if (trickKey === 'aoeAtk' || trickKey === 'aoeAtkEvo') {
      // P3b 接线#8: AI 受害者 AOE 响应决策走 heuristics(低血或攻击充足才交牌, 否则受击);
      // 无 ai 模块回落旧行为(有攻击必响应)
      let want = true;
      const heu = aiHeu();
      if (heu) {
        const d = heu.chooseResponse(g, q.id, { type: 'aoeResp', pid: q.id, victim: q.id, srcId, trickKey, dmg: effDmg, ctx: aoeCtx }, { difficulty: g.difficulty });
        if (d && d.kind === 'respondAoeResp') want = d.yes === true;
      }
      const idx = q.hand.findIndex(x => nsData.cards.isAttackKey(x.key));
      if (idx >= 0 && want) { const ac = q.hand.splice(idx, 1)[0]; g.discard.push(ac); g.log.push({ t: g.round, txt: `${q.name} 打出攻击响应`, cls: '' }); }
      else { g.log.push({ t: g.round, txt: `${q.name} 无攻击,受到${effDmg}伤`, cls: 'bad' }); nsEngine.core.loseHp(g, pid, effDmg, p, 'aoe'); }
    } else {
      let dodged = false;
      // P3b 接线#8: AI 受害者 AOE 出闪决策走 heuristics(低血/多WA/手牌溢出才出闪)
      let want = true;
      const heu = aiHeu();
      if (heu) {
        const d = heu.chooseResponse(g, q.id, { type: 'aoeResp', pid: q.id, victim: q.id, srcId, trickKey, dmg: effDmg, ctx: aoeCtx }, { difficulty: g.difficulty });
        if (d && d.kind === 'respondAoeResp') want = d.yes === true;
      }
      if (q.armor && q.armor.key === 'aXuan') { const jc = nsEngine.core.judgeCard(g); if (jc.suit === 'heart') dodged = true; }
      if (!dodged && want) {
        const idx = q.hand.findIndex(x => nsData.cards.isDodgeKey(x.key));
        if (idx >= 0 && q.mp >= 1) { const dc = q.hand.splice(idx, 1)[0]; g.discard.push(dc); q.mp -= 1; dodged = true; }
      }
      // M-12: 管理员权限无视防火墙(AOE)
      const fwPierced = !!p.weapon && p.weapon.key === 'wQgj';
      if (!dodged && !(q.armor && q.armor.key === 'aFw' && g.eventSuit !== 'club' && !fwPierced)) {
        g.log.push({ t: g.round, txt: `${q.name} 未出WA,受到${effDmg}伤`, cls: 'bad' });
        nsEngine.core.loseHp(g, pid, effDmg, p, 'aoe');
      } else g.log.push({ t: g.round, txt: `${q.name} 出WA/防火墙,免疫`, cls: '' });
    }
  }
  /* P2: 为 remaining 中其余人类受害者批量预建提示(座次序, 即 requirement 19.2 的"从当前行动者下家起依次询问"序),
   * 使多个并行人提示共存; 组恢复点=首个挂起目标处, 单人类时 remaining 无其他人类, 行为与旧单槽完全一致 */
  function precreateAoe(g, firstCtx) {
    const gid = firstCtx.aoeId || firstCtx.groupId;
    if (!gid) return;
    nsEngine.core.groupOpen(g, gid, firstCtx);
    const rest = firstCtx.remaining || [];
    for (const id of rest) {
      const q = g.players[id];
      if (!q || q.dead || !g.isHuman(q.id)) continue;
      if (nsEngine.core.findPrompt(g, { type: 'aoeResp', pid: q.id, ctxKey: 'aoeId', ctxVal: gid })) continue;
      const sub = rest.slice(rest.indexOf(id) + 1);
      nsEngine.core.setPrompt(g, {
        type: 'aoeResp', pid: q.id, victim: id, srcId: firstCtx.srcId, trickKey: firstCtx.trickKey, dmg: effAoeDmg(g, firstCtx.dmg),
        ctx: { type: 'aoe', trickKey: firstCtx.trickKey, srcId: firstCtx.srcId, dmg: firstCtx.dmg, current: id, remaining: sub, aoeId: gid, groupId: gid },
      });
    }
  }
  function resumeAoe(g, ctx) {
    const gr = ctx.aoeId ? nsEngine.core.groupGet(g, ctx.aoeId) : null;
    const resolved = gr ? gr.resolved : null; // 组内已答人类跳过(不再重复询问)
    for (const id of ctx.remaining) {
      const q = g.players[id];
      if (q.dead || (resolved && resolved.has(id))) continue;
      const rest = ctx.remaining.slice(ctx.remaining.indexOf(id) + 1);
      const subCtx = { type: 'aoe', trickKey: ctx.trickKey, srcId: ctx.srcId, dmg: ctx.dmg, current: id, remaining: rest, aoeId: ctx.aoeId, groupId: ctx.aoeId };
      const cr = counterAsk(g, id, ctx.trickKey, ctx.srcId, { kind: 'aoe', ctx: subCtx });
      if (cr === 'pending') return;
      if (cr === 'countered') { g.log.push({ t: g.round, txt: `${q.name} 特判抵消了${nsEngine.core.spec(ctx.trickKey).name}`, cls: 'act' }); continue; }
      const r = aoeApplyOne(g, ctx.srcId, ctx.trickKey, ctx.dmg, id, subCtx);
      if (r === 'pending') { precreateAoe(g, nsEngine.core.lastPrompt(g).ctx); return; }
    }
  }
  /* 祖安对线(req 18.3): 依次结算两名目标(特判可反制 -> 各自选择弃1或受1伤) */
  function argueStep(g, srcId, remaining, groupId, resolved) {
    while (remaining.length) {
      const tid = remaining[0];
      const q = g.players[tid];
      if (q.dead || (resolved && resolved.has(tid))) { remaining.shift(); continue; }
      const rest = remaining.slice(1);
      const cr = counterAsk(g, tid, 'funArgue', srcId, { kind: 'argue', ctx: { type: 'argue', srcId, targetId: tid, remaining: rest, groupId } });
      if (cr === 'pending') return { ok: true, result: 'pending' };
      if (cr === 'countered') {
        g.log.push({ t: g.round, txt: `${q.name} 特判抵消了祖安对线对自己的效果`, cls: 'act' });
        remaining.shift();
        continue;
      }
      const r = argueApplyOne(g, srcId, tid, groupId, rest);
      if (r === 'pending') { precreateArgue(g, nsEngine.core.lastPrompt(g).ctx); return { ok: true, result: 'pending' }; }
      remaining.shift();
    }
    return { ok: true, result: 'done' };
  }
  /* P2: 为 remaining 中其余人类目标批量预建 argueResp 提示(座次序), 多人类并行人提示共存 */
  function precreateArgue(g, firstCtx) {
    const gid = firstCtx.groupId;
    if (!gid) return;
    nsEngine.core.groupOpen(g, gid, firstCtx);
    const rest = firstCtx.remaining || [];
    for (const tid of rest) {
      const q = g.players[tid];
      if (!q || q.dead || !g.isHuman(q.id)) continue;
      if (nsEngine.core.findPrompt(g, { type: 'argueResp', pid: q.id, ctxKey: 'groupId', ctxVal: gid })) continue;
      const sub = rest.slice(rest.indexOf(tid) + 1);
      nsEngine.core.setPrompt(g, { type: 'argueResp', pid: tid, victim: tid, srcId: firstCtx.srcId, trickKey: 'funArgue', dmg: 1, ctx: { type: 'argue', srcId: firstCtx.srcId, trickKey: 'funArgue', targetId: tid, remaining: sub, groupId: gid } });
    }
  }
  /* 祖安对线单目标: 人类目标挂起选择(argueResp, 经 respondAoeResp 作答); AI 自选 */
  function argueApplyOne(g, srcId, tid, groupId, rest) {
    const q = g.players[tid];
    if (q.dead) return 'done';
    const p = g.players[srcId];
    // L-4: 祖安对线2目标, 不触发萌新「问问题」(需唯一目标)
    if (g.isHuman(q.id)) {
      if (groupId && nsEngine.core.findPrompt(g, { type: 'argueResp', pid: q.id, ctxKey: 'groupId', ctxVal: groupId })) return 'pending'; // 已挂起, 复用
      nsEngine.core.setPrompt(g, { type: 'argueResp', pid: tid, victim: tid, srcId, trickKey: 'funArgue', dmg: 1, ctx: { type: 'argue', srcId, trickKey: 'funArgue', targetId: tid, remaining: (rest || []).slice(), groupId } });
      return 'pending';
    }
    // P3b 接线#9: AI 目标祖安对线决策走 heuristics(有垃圾牌且血厚才弃1, 否则受1伤);
    // 弃牌取保留价值最低的那张; 无 ai 模块回落旧行为(50% 随机弃1)
    const heu = aiHeu();
    let decided = false, yes = false;
    if (heu) {
      const d = heu.chooseResponse(g, q.id, {
        type: 'argueResp', pid: tid, victim: tid, srcId, trickKey: 'funArgue', dmg: 1,
        ctx: { type: 'argue', srcId, trickKey: 'funArgue', targetId: tid, remaining: (rest || []).slice(), groupId },
      }, { difficulty: g.difficulty });
      if (d && d.kind === 'respondAoeResp') { decided = true; yes = d.yes === true; }
    }
    if (decided ? yes : (q.hand.length && g.rnd() < 0.5)) {
      let idx;
      if (decided) {
        // 弃保留价值最低的牌(heuristics 已保证存在垃圾牌)
        idx = 0; let bestV = Infinity;
        q.hand.forEach((c, i) => { const v = NS.ai.scorer.keepValue(g, tid, i); if (v < bestV) { bestV = v; idx = i; } });
      } else {
        idx = Math.floor(g.rnd() * q.hand.length);
      }
      const rc = q.hand.splice(idx, 1)[0];
      if (rc) g.discard.push(rc); // 防御: 幻影空洞不入弃牌堆
      g.log.push({ t: g.round, txt: `${q.name}【祖安对线】选择弃1张【${rc ? nsEngine.core.spec(rc.key).name : '?'}】`, cls: 'act' });
    } else {
      g.log.push({ t: g.round, txt: `${q.name}【祖安对线】选择受1伤`, cls: 'bad' });
      nsEngine.core.loseHp(g, tid, 1, p, 'argue');
    }
    return 'done';
  }

  /* AOE人类响应: 出攻击/出WA 或 承受伤害(M20); 亦承载祖安对线(argueResp): yes=弃1张, no=受1伤 */
  function respondAoeResp(g, pid, yes, promptId) {
    const pd = nsEngine.core.takePrompt(g, ['aoeResp', 'argueResp'], pid, promptId);
    if (!pd) return { ok: false, why: '无挂起的AOE/祖安对线响应询问' };
    const q = g.players[pid];
    const trick = pd.trickKey;
    if (pd.type === 'argueResp') {
      if (q.dead) { if (pd.ctx) argueStep(g, pd.ctx.srcId, pd.ctx.remaining, pd.ctx.groupId); return { ok: true }; }
      if (yes && q.hand.length > 0) {
        const idx = Math.floor(g.rnd() * q.hand.length);
        const rc = q.hand.splice(idx, 1)[0];
        if (rc) g.discard.push(rc); // 防御: 幻影空洞不入弃牌堆
        g.log.push({ t: g.round, txt: `${q.name}【祖安对线】选择弃1张【${rc ? nsEngine.core.spec(rc.key).name : '?'}】`, cls: 'act' });
      } else {
        g.log.push({ t: g.round, txt: `${q.name}【祖安对线】选择受1伤`, cls: 'bad' });
        nsEngine.core.loseHp(g, pid, pd.dmg, g.players[pd.srcId], 'argue');
      }
      // P2: 祖安对线组: 其余人类目标未答则挂起; 全部答完从首个挂起点继续(跳过已答人类)
      const gid = pd.ctx && pd.ctx.groupId;
      if (gid) {
        nsEngine.core.groupAdd(g, gid, pid);
        nsEngine.core.purgeDeadGroupPrompts(g, gid);
        if (nsEngine.core.groupHasOpen(g, gid)) return { ok: true, result: 'pending-group' };
        const gr = nsEngine.core.groupGet(g, gid);
        argueStep(g, pd.ctx.srcId, (gr && gr.resume ? gr.resume.remaining : pd.ctx.remaining), gid, gr && gr.resolved);
        return { ok: true };
      }
      if (pd.ctx) argueStep(g, pd.ctx.srcId, pd.ctx.remaining);
      return { ok: true };
    }
    if (trick === 'aoeAtk' || trick === 'aoeAtkEvo') {
      if (yes) {
        const idx = q.hand.findIndex(c => nsData.cards.isAttackKey(c.key));
        if (idx < 0) return { ok: false, why: '没有攻击牌' };
        const ac = q.hand.splice(idx, 1)[0];
        g.discard.push(ac);
        g.log.push({ t: g.round, txt: `${q.name} 打出攻击响应`, cls: '' });
      } else {
        g.log.push({ t: g.round, txt: `${q.name} 无攻击,受到${pd.dmg}伤`, cls: 'bad' });
        nsEngine.core.loseHp(g, pid, pd.dmg, g.players[pd.srcId], 'aoe');
      }
    } else {
      if (yes) {
        const idx = q.hand.findIndex(c => nsData.cards.isDodgeKey(c.key));
        if (idx < 0 || q.mp < 1) return { ok: false, why: '没有WA或灵感不足' };
        const dc = q.hand.splice(idx, 1)[0];
        g.discard.push(dc); q.mp -= 1;
        g.log.push({ t: g.round, txt: `${q.name} 打出WA响应`, cls: '' });
      } else {
        // M-12: 管理员权限无视防火墙(AOE)
        const srcP = g.players[pd.srcId];
        const fwPierced = !!srcP && !!srcP.weapon && srcP.weapon.key === 'wQgj';
        if (q.armor && q.armor.key === 'aFw' && g.eventSuit !== 'club' && !fwPierced) { g.log.push({ t: g.round, txt: `${q.name}【防火墙】免疫`, cls: '' }); }
        else { g.log.push({ t: g.round, txt: `${q.name} 未出WA,受到${pd.dmg}伤`, cls: 'bad' }); nsEngine.core.loseHp(g, pid, pd.dmg, g.players[pd.srcId], 'aoe'); }
      }
    }
    // P2: AOE 组: 全部人类受害者答复后, 从首个未决位置继续结算(跳过已答人类); 单人类行为与旧单槽一致
    const gid2 = pd.ctx && (pd.ctx.groupId || pd.ctx.aoeId);
    if (gid2) {
      nsEngine.core.groupAdd(g, gid2, pid);
      nsEngine.core.purgeDeadGroupPrompts(g, gid2);
      if (nsEngine.core.groupHasOpen(g, gid2)) return { ok: true, result: 'pending-group' };
      const gr = nsEngine.core.groupGet(g, gid2);
      resumeAoe(g, gr && gr.resume ? gr.resume : pd.ctx);
      return { ok: true };
    }
    if (pd.ctx) resumeAoe(g, pd.ctx);
    return { ok: true };
  }

  /* 题解大会: 按行动顺序轮流选牌(9.2; 特判可抵消任一角色的选牌效果) */
  function harvestStep(g, ctx) {
    while (ctx.pos < ctx.order.length) {
      const pid = ctx.order[ctx.pos];
      const p = g.players[pid];
      if (p.dead || ctx.cards.length === 0) { ctx.pos++; continue; }
      // 特判(9.2): 其他玩家可抵消该名角色的选牌效果(可连锁; 选牌者本人不询问)
      const cr = tryCounterOther(g, ctx.srcId, 'harvest', { kind: 'harvest', ctx }, pid);
      if (cr === 'pending') return;
      if (cr === 'countered') { g.log.push({ t: g.round, txt: `${p.name} 的选牌被特判抵消`, cls: 'act' }); ctx.pos++; continue; }
      if (g.isHuman(pid)) {
        nsEngine.core.setPrompt(g, { type: 'harvest', pid, victim: pid, ctx, pickerPos: ctx.pos });
        precreateHarvest(g, ctx); // P2: 批量预建其余人类选牌者的提示(座次序)
        return;
      }
      // P3b 接线#10: AI 选牌决策走 heuristics(按身份需求选; 反贼偏好攻击、主公方偏好WA等);
      // 无 ai 模块或选牌失败回落取第一张
      const heu = aiHeu();
      let got = null;
      if (heu) {
        const d = heu.chooseResponse(g, pid, { type: 'harvest', pid, victim: pid, ctx }, { difficulty: g.difficulty });
        if (d && d.kind === 'respondHarvest' && d.choiceKey != null) {
          const i = ctx.cards.findIndex(c => c && c.key === d.choiceKey);
          if (i >= 0) got = ctx.cards.splice(i, 1)[0];
        }
      }
      if (!got) got = ctx.cards.shift();
      p.hand.push(got);
      g.log.push({ t: g.round, txt: `${p.name} 选走【${nsEngine.core.spec(got.key).name}】`, cls: '' });
      ctx.pos++;
    }
    for (const c of ctx.cards) g.discard.push(c);
    ctx.cards.length = 0;
  }
  /* P2: 为后续人类选牌者批量预建 harvest 提示(共享同一 ctx, 各带 pickerPos); 组恢复点=首个挂起选牌者+1 */
  function precreateHarvest(g, ctx) {
    const gid = ctx.harvestId;
    if (!gid) return;
    nsEngine.core.groupOpen(g, gid, { ctx, fromPos: ctx.pos + 1 });
    for (let i = ctx.pos + 1; i < ctx.order.length; i++) {
      const pid = ctx.order[i];
      const q = g.players[pid];
      if (!q || q.dead || !g.isHuman(pid)) continue;
      if (nsEngine.core.findPrompt(g, { type: 'harvest', pid, ctxKey: 'harvestId', ctxVal: gid })) continue;
      nsEngine.core.setPrompt(g, { type: 'harvest', pid, victim: pid, ctx, pickerPos: i });
    }
  }
  function respondHarvest(g, pid, choiceKey, promptId) {
    const pd = nsEngine.core.takePrompt(g, ['harvest'], pid, promptId);
    if (!pd) return { ok: false, why: '无挂起的题解大会选择' };
    const ctx = pd.ctx;
    const p = g.players[pid];
    if (choiceKey != null) {
      const idx = ctx.cards.findIndex(c => c.key === choiceKey);
      if (idx >= 0) { const got = ctx.cards.splice(idx, 1)[0]; p.hand.push(got); g.log.push({ t: g.round, txt: `${p.name} 选走【${nsEngine.core.spec(got.key).name}】`, cls: '' }); }
    }
    // P2: 题解大会组: 其余人类选牌者未答则挂起; 全部答完从首个挂起选牌者之后继续(跳过已答人类)
    const gid = ctx.harvestId;
    if (gid) {
      nsEngine.core.groupAdd(g, gid, pid);
      nsEngine.core.purgeDeadGroupPrompts(g, gid);
      if (nsEngine.core.groupHasOpen(g, gid)) return { ok: true, result: 'pending-group' };
      const gr = nsEngine.core.groupGet(g, gid);
      if (gr && gr.resume) {
        ctx.pos = gr.resume.fromPos;
        while (ctx.pos < ctx.order.length && gr.resolved.has(ctx.order[ctx.pos])) ctx.pos++;
        harvestStep(g, ctx);
      }
      return { ok: true };
    }
    ctx.pos = (pd.pickerPos !== undefined) ? pd.pickerPos + 1 : ctx.pos + 1;
    harvestStep(g, ctx);
    return { ok: true };
  }

  /* 举报选牌(M12) */
  function respondReport(g, pid, cardKey, promptId) {
    const pd = nsEngine.core.takePrompt(g, ['report'], pid, promptId);
    if (!pd) return { ok: false, why: '无挂起的举报选择' };
    const t = g.players[pd.ctx.targetId];
    const idx = t.hand.findIndex(c => c.key === cardKey);
    if (idx < 0) return { ok: false, why: '无效选择' };
    const rc = t.hand.splice(idx, 1)[0];
    g.discard.push(rc);
    g.log.push({ t: g.round, txt: `${g.players[pid].name}【举报】弃置${t.name}的【${nsEngine.core.spec(rc.key).name}】`, cls: 'act' });
    return { ok: true };
  }

  /* 欢乐牌弃置保底轨(18.2): 出牌阶段弃置欢乐牌触发保底, 不花灵感 */
  function discardFun(g, pid, cardIdx, targetId) {
    const p = g.players[pid];
    if (g.turn !== pid || p.dead || p.skipPlay) return { ok: false, why: '非行动阶段' };
    if (nsEngine.core.hasBlockingPrompt(g)) return { ok: false, why: '等待响应中' };
    const c = p.hand[cardIdx];
    if (!c || !nsEngine.core.spec(c.key).fun) return { ok: false, why: '非欢乐牌' };
    p.hand.splice(cardIdx, 1);
    g.discard.push(c);
    switch (c.key) {
      case 'funBetray': p.funShield = true; g.log.push({ t: g.round, txt: `${p.name} 弃置【卖队友】:本回合首次受伤-1`, cls: 'act' }); break;
      case 'funLie': p.mp = Math.min(p.mpMax, p.mp + 1); g.log.push({ t: g.round, txt: `${p.name} 弃置【躺赢】:回复1灵感`, cls: 'act' }); break;
      case 'funReport': {
        const enemies = g.players.filter(q => !q.dead && q.id !== pid && q.hand.length > 0);
        if (enemies.length) { const q = enemies[Math.floor(g.rnd() * enemies.length)]; const rc = q.hand[Math.floor(g.rnd() * q.hand.length)]; g.log.push({ t: g.round, txt: `${p.name} 弃置【举报】:偷看${q.name}一张手牌【${nsEngine.core.spec(rc.key).name}】`, cls: '' }); }
        else g.log.push({ t: g.round, txt: `${p.name} 弃置【举报】:无人可看`, cls: '' });
        break;
      }
      case 'funClone': nsEngine.core.draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name} 弃置【开小号】:摸1`, cls: 'act' }); break;
      case 'funGiveup': nsEngine.core.draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name} 弃置【摆烂宣言】:摸1`, cls: 'act' }); break;
      case 'funPower': p.mp = Math.min(p.mpMax, p.mp + 1); g.log.push({ t: g.round, txt: `${p.name} 弃置【机房断电】:回复1灵感`, cls: 'act' }); break;
      case 'funArgue': {
        const t = targetId !== undefined ? g.players[targetId] : null;
        if (t && !t.dead && t.hand.length > 0) { const idx = Math.floor(g.rnd() * t.hand.length); const rc = t.hand.splice(idx, 1)[0]; g.discard.push(rc); g.log.push({ t: g.round, txt: `${p.name} 弃置【祖安对线】:令${t.name}弃1张`, cls: 'act' }); }
        else g.log.push({ t: g.round, txt: `${p.name} 弃置【祖安对线】`, cls: '' });
        break;
      }
      case 'funCcf': p.hp = Math.min(p.maxHp, p.hp + 1); g.log.push({ t: g.round, txt: `${p.name} 弃置【感谢CCF】:回复1体力`, cls: 'act' }); break;
      default: return { ok: false, why: '未知欢乐牌' };
    }
    return { ok: true };
  }

  function kspAttack(g, pid, targetId) {
    const p = g.players[pid];
    if (g.turn !== pid || p.dead || p.skipPlay) return { ok: false, why: '非行动阶段' };
    if (nsEngine.core.hasBlockingPrompt(g)) return { ok: false, why: '等待响应中' };
    if (!p.weapon || p.weapon.key !== 'wKsp') return { ok: false, why: '未装备【手写快排】' };
    const t = g.players[targetId];
    if (!t || t.dead || t.id === pid) return { ok: false, why: '目标无效' };
    if (p.hand.length < 2) return { ok: false, why: '需要至少2张手牌' };
    const cost = nsEngine.core.effectiveCost(g, p, 'attack');
    if (p.mp < cost) return { ok: false, why: '灵感不足' };
    if (!p.canAttack) return { ok: false, why: '本回合不能攻击' };
    p.mp -= cost;
    const c1 = p.hand.splice(0, 1)[0];
    const c2 = p.hand.splice(0, 1)[0];
    g.discard.push(c1); g.discard.push(c2);
    g.log.push({ t: g.round, txt: `${p.name}【手写快排】弃2张手牌当作做法假了攻击${t.name}`, cls: 'act' });
    const r = nsEngine.core.attackPlayer(g, p, t, { suit: c1.suit, isEvo: false });
    return { ok: true, result: r };
  }

  /* 放手一搏: 最后1张手牌时攻击至多3目标 */
  function fangAttack(g, pid, targetIds, cardIdx) {
    const p = g.players[pid];
    if (g.turn !== pid || p.dead || p.skipPlay) return { ok: false, why: '非行动阶段' };
    if (nsEngine.core.hasBlockingPrompt(g)) return { ok: false, why: '等待响应中' };
    if (!p.weapon || p.weapon.key !== 'wFang') return { ok: false, why: '未装备【放手一搏】' };
    const c = p.hand[cardIdx];
    if (!c || !nsData.cards.isAttackKey(c.key)) return { ok: false, why: '非攻击牌' };
    if (p.hand.length !== 1) return { ok: false, why: '必须是最后1张手牌' };
    if (!targetIds || targetIds.length < 1 || targetIds.length > 3) return { ok: false, why: '目标数须为1~3' };
    const cost = nsEngine.core.effectiveCost(g, p, c.key);
    if (p.mp < cost) return { ok: false, why: '灵感不足' };
    if (!p.canAttack) return { ok: false, why: '本回合不能攻击' };
    p.hand.splice(cardIdx, 1);
    p.mp -= cost;
    g.discard.push(c);
    g.log.push({ t: g.round, txt: `${p.name}【放手一搏】对${targetIds.length}个目标使用攻击!`, cls: 'evt' });
    nsEngine.battle.resumeMultiAttack(g, { attacker: pid, suit: c.suit, isEvo: c.key === 'attackEvo' }, targetIds);
    return { ok: true, result: 'multi' };
  }

  /* ---------------- 导出 ---------------- */
  const api = {
    respondCounter, respondAoeResp, respondHarvest, respondReport,
    discardFun, kspAttack, fangAttack,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  Object.assign(me, api, {
    // 内部工具: 供 core 跨模块调用(不进 54 键聚合导出)
    COUNTERABLE, counterChain, tryCounter, tryCounterOther, counterAsk, contFromCtx,
    runCounterCont, doTrickSelf, doKillUnit, powerStep, doTrickCore,
    aoeApplyOne, resumeAoe, argueStep, argueApplyOne, harvestStep,
    precreateAoe, precreateArgue, precreateHarvest, effAoeDmg, // P2 提示组工具
  });
})(typeof window !== 'undefined' ? window : globalThis);
