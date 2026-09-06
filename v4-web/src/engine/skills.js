/* ============================================================================
 * OI杀 v4.0 · src/engine/skills.js — 职业技能 / 单位攻击(P1a 拆分)
 * 拆分自 game.js(P1a 模块拆分)。行为零变更: 函数体与原 game.js 逐字一致,
 * 仅跨模块调用改为共享命名空间运行时引用(NS.engine.core.* / NS.data.*)。
 * 挂载: 共享命名空间 OIKill.engine.skills
 * 导出(54 键中的 2 键): skillUse, unitAttack
 * 另向共享命名空间暴露内部工具(供 core.aiTurn 调用, 不进聚合导出): aiSkill
 * ==========================================================================*/
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};
  const nsData = NS.data = NS.data || {};
  const nsEngine = NS.engine = NS.engine || {};
  const me = nsEngine.skills = nsEngine.skills || {};

  /* AI 职业技能使用 */
  function aiSkill(g, pid) {
    const p = g.players[pid];
    const enemies = g.players.filter(q => !q.dead && q.id !== pid);
    if (!enemies.length) return false;
    const et = () => enemies[Math.floor(g.rnd() * enemies.length)].id;
    const trySkill = (name, targetId) => {
      const r = skillUse(g, pid, name, targetId);
      return r.ok;
    };
    switch (p.prof.id) {
      case 'shenben': if (p.hand.length >= 2 && p.hand.some(c => nsData.cards.isAttackKey(c.key))) return trySkill('akioi'); return false;
      case 'duliu': if ((p.hand.length >= 1 || p.awaken) && p.hand.some(c => nsData.cards.isAttackKey(c.key)) && p.mp >= nsEngine.core.effectiveCost(g, p, 'attack')) return trySkill('kachang'); return false;
      case 'nvzhuang': if (p.hand.some(c => nsData.identities.isRed(c.suit)) && enemies.some(q => q.hand.length > 0)) return trySkill('live', et()); return false;
      case 'pingce': if (p.hand.length >= 1) return trySkill('rejudge'); return false;
      case 'chuangqi': if (!p.usedSeal && enemies.length) return trySkill('seal', et()); return false;
      case 'xuezhang': if (p.hand.length >= 1) return trySkill('teach', et()); return false;
      case 'dabiao': if (p.hand.length >= 2) return trySkill('dabiao'); return false;
      case 'jianpan': if (p.hand.length >= 1 && enemies.some(q => q.hand.length > 0)) return trySkill('kouhai', et()); return false;
      case 'chaoti': if (p.hand.length >= 1) return trySkill('chao'); return false;
      case 'shuiqun': if (p.hand.length >= 1) return trySkill('shuiqun'); return false;
      case 'baoling': if (p.hand.length >= 1) return trySkill('baoling', et()); return false;
      case 'tuling': if (!p.usedDianji) return trySkill('dianji'); return false;
      default: return false;
    }
  }

  /* 单位攻击: 一击必杀制, 消灭敌方一个单位(H6) */
  function unitAttack(g, pid, unitIdx, victimPid) {
    const p = g.players[pid];
    if (g.turn !== pid || p.dead || p.skipPlay) return { ok: false, why: '非行动阶段' };
    if (g.pending) return { ok: false, why: '等待响应中' };
    const u = p.units[unitIdx];
    if (!u || !u.ready) return { ok: false, why: '该单位尚未就绪(速攻除外)' };
    const v = g.players[victimPid];
    if (!v || v.dead || v.id === pid || v.units.length === 0) return { ok: false, why: '目标无单位' };
    const vu = v.units[Math.floor(g.rnd() * v.units.length)];
    v.units.splice(v.units.indexOf(vu), 1);
    g.log.push({ t: g.round, txt: `${p.name} 的【${nsEngine.core.spec(u.key).name}】消灭了${v.name}的【${nsEngine.core.spec(vu.key).name}】`, cls: 'act' });
    nsEngine.core.unitDie(g, v.id, vu, 'unit-attack');
    return { ok: true };
  }

  /* 职业技能(H1; targetId2 供觉醒口嗨第二目标使用) */
  function skillUse(g, pid, name, targetId, targetId2) {
    const p = g.players[pid];
    if (g.turn !== pid || p.dead || p.skipPlay) return { ok: false, why: '非行动阶段' };
    if (g.pending) return { ok: false, why: '等待响应中' };
    if (p.usedSkillsThisTurn[name]) return { ok: false, why: '本回合已使用过该技能' };
    const t = targetId !== undefined ? g.players[targetId] : null;
    const needT = ['live', 'seal', 'teach', 'kouhai', 'baoling'];
    if (needT.includes(name) && (!t || t.dead || t.id === pid)) return { ok: false, why: '需要目标' };
    let ok = true, why = '';
    switch (name) {
      case 'akioi': { // 神犇: 弃2,本回合攻击伤害+1
        if (p.hand.length < 2) { ok = false; why = '需要2张手牌'; break; }
        nsEngine.core.discardFromHand(g, p, 0); nsEngine.core.discardFromHand(g, p, 0);
        p.akioiDmg = 1;
        g.log.push({ t: g.round, txt: `${p.name}【AKIOI】弃2手牌,本回合攻击伤害+1`, cls: 'act' });
        break;
      }
      case 'kachang': { // 毒瘤: 弃1,本次攻击不可被WA; 觉醒: 不再消耗手牌
        if (!p.awaken) {
          if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
          nsEngine.core.discardFromHand(g, p, 0);
        }
        p.kachangFlag = true;
        g.log.push({ t: g.round, txt: `${p.name}【祖传卡常】${p.awaken ? '觉醒:免费发动,' : '弃1,'}下一次攻击不可被WA`, cls: 'act' });
        break;
      }
      case 'live': { // 女装: 弃1红牌,看目标手牌拿1; 觉醒: 可看2张拿1张
        const ri = p.hand.findIndex(c => nsData.identities.isRed(c.suit));
        if (ri < 0) { ok = false; why = '需要1张红色手牌'; break; }
        nsEngine.core.discardFromHand(g, p, ri);
        if (t.hand.length > 0) {
          const want = p.awaken ? 2 : 1; // 觉醒: 直播可看2张拿1张(13章)
          const picks = [];
          for (let k = 0; k < want && t.hand.length > 0; k++) { picks.push(t.hand.splice(Math.floor(g.rnd() * t.hand.length), 1)[0]); }
          const take = picks[Math.floor(g.rnd() * picks.length)];
          for (const pc of picks) if (pc !== take) t.hand.push(pc);
          p.hand.push(take);
          g.log.push({ t: g.round, txt: `${p.name}【直播】观看${t.name}${want}张手牌并拿走【${nsEngine.core.spec(take.key).name}】`, cls: 'act' });
        }
        else g.log.push({ t: g.round, txt: `${p.name}【直播】观看${t.name}手牌:无牌`, cls: '' });
        break;
      }
      case 'rejudge': { // 评测姬: 弃1摸1再弃1
        if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
        nsEngine.core.discardFromHand(g, p, 0); nsEngine.core.draw(g, pid, 1);
        if (p.hand.length) nsEngine.core.discardFromHand(g, p, 0);
        g.log.push({ t: g.round, txt: `${p.name}【重测】弃1摸1再弃1`, cls: 'act' });
        break;
      }
      case 'seal': { // 传奇: 限定,展示手牌,至多2目标各1伤(简化单目标)
        if (p.usedSeal) { ok = false; why = '限定技,一局一次'; break; }
        p.usedSeal = true;
        g.log.push({ t: g.round, txt: `${p.name}【封神】展示手牌: ${p.hand.map(c => nsEngine.core.spec(c.key).name).join('、') || '无'}`, cls: 'act' });
        nsEngine.core.loseHp(g, t.id, 1, p, 'seal');
        break;
      }
      case 'teach': { // 学长: 弃1,让目标摸1
        if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
        nsEngine.core.discardFromHand(g, p, 0);
        nsEngine.core.draw(g, t.id, 1);
        if (p.teachBonus) { nsEngine.core.draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name}【讲题】让${t.name}摸1,觉醒同摸1`, cls: 'act' }); }
        else g.log.push({ t: g.round, txt: `${p.name}【讲题】让${t.name}摸1`, cls: 'act' });
        break;
      }
      case 'dabiao': { // 打表: 弃2摸4
        if (p.hand.length < 2) { ok = false; why = '需要2张手牌'; break; }
        nsEngine.core.discardFromHand(g, p, 0); nsEngine.core.discardFromHand(g, p, 0);
        nsEngine.core.draw(g, pid, 4);
        g.log.push({ t: g.round, txt: `${p.name}【打表】弃2摸4`, cls: 'act' });
        break;
      }
      case 'kouhai': { // 键盘侠: 弃1,目标弃1手牌; 觉醒: 可指定两名玩家
        if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
        nsEngine.core.discardFromHand(g, p, 0);
        const tids = [t.id];
        if (p.awaken) {
          const t2 = (targetId2 !== undefined && targetId2 !== null) ? g.players[targetId2] : g.players.find(q => !q.dead && q.id !== pid && q.id !== t.id);
          if (t2 && !t2.dead && t2.id !== pid && t2.id !== t.id) tids.push(t2.id);
        }
        for (const tid of tids) {
          const q = g.players[tid];
          if (q.hand.length > 0) { const idx = Math.floor(g.rnd() * q.hand.length); const rc = q.hand.splice(idx, 1)[0]; g.discard.push(rc); }
        }
        g.log.push({ t: g.round, txt: `${p.name}【口嗨】${p.awaken ? '觉醒:指定两名玩家,各' : ''}令${tids.map(id => g.players[id].name).join('、')}弃1手牌`, cls: 'act' });
        break;
      }
      case 'chao': { // 抄题解: 弃1,看牌堆顶3取1; 觉醒: 看4取2
        if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
        nsEngine.core.discardFromHand(g, p, 0);
        if (g.deck.length >= 1) {
          const n = Math.min(p.awaken ? 4 : 3, g.deck.length);
          const want = p.awaken ? 2 : 1;
          const top = g.deck.slice(-n).reverse();
          const take = top.slice(0, Math.min(want, top.length));
          g.deck.splice(g.deck.length - n, n);
          for (const c2 of top.slice(Math.min(want, top.length))) g.deck.push(c2);
          for (const c2 of take) p.hand.push(c2);
          g.log.push({ t: g.round, txt: `${p.name}【抄题解】${p.awaken ? '觉醒:看4取2' : '看3取1'}: 获得${take.map(c2 => nsEngine.core.spec(c2.key).name).join('、')}`, cls: 'act' });
        }
        break;
      }
      case 'shuiqun': { // 水群怪: 弃1摸2弃1; 觉醒: 摸3弃1
        if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
        nsEngine.core.discardFromHand(g, p, 0);
        nsEngine.core.draw(g, pid, p.awaken ? 3 : 2);
        if (p.hand.length) nsEngine.core.discardFromHand(g, p, 0);
        g.log.push({ t: g.round, txt: `${p.name}【水群】弃1摸${p.awaken ? 3 : 2}弃1`, cls: 'act' });
        break;
      }
      case 'baoling': { // 爆零: 弃1,目标弃1或受1伤
        if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
        nsEngine.core.discardFromHand(g, p, 0);
        if (t.hand.length > 0 && g.rnd() < 0.5) { const idx = Math.floor(g.rnd() * t.hand.length); const rc = t.hand.splice(idx, 1)[0]; g.discard.push(rc); g.log.push({ t: g.round, txt: `${p.name}【爆零】令${t.name}弃1手牌`, cls: 'act' }); }
        else { const d = 1 + p.baolingBonus; nsEngine.core.loseHp(g, t.id, d, p, 'baoling'); g.log.push({ t: g.round, txt: `${p.name}【爆零】令${t.name}受${d}伤`, cls: 'act' }); }
        break;
      }
      case 'dianji': { // 图灵: 限定,本局手牌上限再+2; M-14: 觉醒(摸2)由体力阈值触发,不在此绑定
        if (p.usedDianji) { ok = false; why = '限定技,一局一次'; break; }
        p.usedDianji = true;
        g.log.push({ t: g.round, txt: `${p.name}【奠基】本局手牌上限再+2`, cls: 'evt' });
        break;
      }
      default: return { ok: false, why: '未知技能: ' + name };
    }
    if (ok) p.usedSkillsThisTurn[name] = true;
    return ok ? { ok: true } : { ok: false, why };
  }

  /* ---------------- 导出 ---------------- */
  const api = {
    skillUse, unitAttack,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  Object.assign(me, api, {
    // 内部工具: 供 core.aiTurn 跨模块调用(不进 54 键聚合导出)
    aiSkill,
  });
})(typeof window !== 'undefined' ? window : globalThis);
