/* ============================================================================
 * OI杀 v4.0 · game.js — 聚合入口(P1a 模块拆分后; P2 增键)
 * 引擎本体已拆分为 src/data/* 与 src/engine/*, 本文件仅做聚合:
 * - Node(CommonJS): 直接转发 src/engine/index.js 的合并导出
 *   (原 54 键逐键一致, 末尾追加 P2 新增 4 键: drive/timeoutPrompt/duePrompts/promptCount;
 *   test.js / test-extra.js 的 require('./game.js') 零改动)。
 * - 浏览器: 各 src 脚本按 index.html 中的顺序加载并挂载共享命名空间
 *   OIKill.data.* / OIKill.engine.*; 本文件校验命名空间完整后,
 *   将扁平 api 重新暴露为 window.OIKill(与拆分前完全一致,
 *   index.html 的 const O = window.OIKill 零改动)。
 * ==========================================================================*/
(function (root) {
  'use strict';
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = require('./src/engine/index.js');
    return;
  }

  // ---- 浏览器分支 ----
  const NS = root.OIKill;
  // 校验各子模块已按序挂载(缺任一时抛错, 便于排查脚本加载顺序问题)
  const REQUIRED = ['data.cards', 'data.professions', 'data.identities', 'engine.core', 'engine.battle', 'engine.tricks', 'engine.skills', 'engine.index'];
  for (const path of REQUIRED) {
    let o = NS;
    for (const seg of path.split('.')) o = o && o[seg];
    if (!o) throw new Error('OI杀引擎加载不完整: 缺少 ' + path + ' (请检查 index.html 的脚本加载顺序)');
  }
  // 与旧 game.js api 逐键一致的 54 键完整性断言(+ P2 新增 4 键)
  const api = NS.engine.index;
  const KEYS = ['CARDS', 'DECK_COUNT', 'PROFESSIONS', 'DOMAINS', 'IDENTITIES', 'ID_TABLE', 'EVENTS', 'EVO_MAP', 'SKILLS',
    'createGame', 'setup', 'startTurn', 'judgePhase', 'drawPhase', 'discardPhase', 'endTurn',
    'playCard', 'equipCard', 'deployUnit', 'publicView', 'aiTurn', 'respondDodge', 'respondCounter',
    'respondBetray', 'respondCold', 'respondBbst', 'respondChase', 'respondHarvest', 'respondGuard', 'respondAoeResp', 'discardCards', 'respondReport', 'playerLeave',
    'discardFun', 'kspAttack', 'fangAttack', 'evolvePick', 'tryEvolve',
    'unitAttack', 'skillUse', 'lordCanRedraw', 'lordRedraw',
    'nextAlive', 'draw', 'spec', 'effectiveCost', 'attackPlayer', 'loseHp', 'checkVictory',
    'suitZh', 'isBlack', 'isRed', 'isAttackKey', 'isDodgeKey',
    'drive', 'timeoutPrompt', 'duePrompts', 'promptCount'];
  const missing = KEYS.filter(k => api[k] === undefined);
  if (missing.length) throw new Error('OI杀引擎导出缺失: ' + missing.join(','));
  root.OIKill = api; // 与拆分前一致: window.OIKill 为扁平 api(原54键+P2新增4键)
})(typeof window !== 'undefined' ? window : globalThis);
