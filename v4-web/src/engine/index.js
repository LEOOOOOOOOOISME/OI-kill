/* ============================================================================
 * OI杀 v4.0 · src/engine/index.js — 引擎聚合入口(P1a 拆分)
 * 按旧 game.js api 对象逐键合并 data/* 与 engine/* 的导出, 共 54 键,
 * 键名/取值与拆分前完全一致(顺序亦与旧 api 一致)。
 * Node: require 全部子模块后合并, module.exports = 合并结果。
 * 浏览器: 子模块已按 index.html 脚本顺序挂载到共享命名空间,
 *         此处从 OIKill.data.* / OIKill.engine.* 合并后挂载到 OIKill.engine.index,
 *         供 game.js 浏览器分支校验并重新暴露为 window.OIKill。
 * ==========================================================================*/
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};
  const nsData = NS.data = NS.data || {};
  const nsEngine = NS.engine = NS.engine || {};

  if (typeof module !== 'undefined' && module.exports) {
    // Node: 保证子模块按序加载并注册到共享命名空间(跨模块调用走运行时 NS 引用, 无加载期循环依赖)
    require('../data/cards.js');
    require('../data/professions.js');
    require('../data/identities.js');
    require('./core.js');
    require('./battle.js');
    require('./tricks.js');
    require('./skills.js');
  }

  const dCards = nsData.cards;
  const dProf = nsData.professions;
  const dId = nsData.identities;
  const c = nsEngine.core;
  const b = nsEngine.battle;
  const t = nsEngine.tricks;
  const s = nsEngine.skills;

  // 与旧 game.js api 对象逐键一致(共 54 键; 不含各模块的内部工具键)
  const api = {
    CARDS: dCards.CARDS, DECK_COUNT: dCards.DECK_COUNT, PROFESSIONS: dProf.PROFESSIONS, DOMAINS: dProf.DOMAINS, IDENTITIES: dId.IDENTITIES, ID_TABLE: dId.ID_TABLE, EVENTS: dId.EVENTS, EVO_MAP: dCards.EVO_MAP, SKILLS: dProf.SKILLS,
    createGame: c.createGame, setup: c.setup, startTurn: c.startTurn, judgePhase: c.judgePhase, drawPhase: c.drawPhase, discardPhase: c.discardPhase, endTurn: c.endTurn,
    playCard: c.playCard, equipCard: c.equipCard, deployUnit: c.deployUnit, publicView: c.publicView, aiTurn: c.aiTurn, respondDodge: b.respondDodge, respondCounter: t.respondCounter,
    respondBetray: b.respondBetray, respondCold: b.respondCold, respondBbst: b.respondBbst, respondChase: b.respondChase, respondHarvest: t.respondHarvest, respondGuard: b.respondGuard, respondAoeResp: t.respondAoeResp, discardCards: c.discardCards, respondReport: t.respondReport, playerLeave: c.playerLeave,
    discardFun: t.discardFun, kspAttack: t.kspAttack, fangAttack: t.fangAttack, evolvePick: c.evolvePick, tryEvolve: c.tryEvolve,
    unitAttack: s.unitAttack, skillUse: s.skillUse, lordCanRedraw: c.lordCanRedraw, lordRedraw: c.lordRedraw,
    nextAlive: c.nextAlive, draw: c.draw, spec: c.spec, effectiveCost: c.effectiveCost, attackPlayer: c.attackPlayer, loseHp: c.loseHp, checkVictory: c.checkVictory,
    suitZh: dId.suitZh, isBlack: dId.isBlack, isRed: dId.isRed, isAttackKey: dCards.isAttackKey, isDodgeKey: dCards.isDodgeKey,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  nsEngine.index = api; // 浏览器与 Node 均挂载(供 game.js 浏览器分支与后续阶段使用)
})(typeof window !== 'undefined' ? window : globalThis);
