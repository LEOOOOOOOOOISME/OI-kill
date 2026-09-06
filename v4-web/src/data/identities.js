/* ============================================================================
 * OI杀 v4.0 · src/data/identities.js — 身份表 / 人数表 / 事件表 / 花色(P1a 拆分)
 * 拆分自 game.js(P1a 模块拆分, 原身份/事件/花色定义区)。纯数据模块。
 * 挂载: 共享命名空间 OIKill.data.identities
 * 导出: IDENTITIES / ID_TABLE / EVENTS / SUITS / suitZh / isBlack / isRed
 *       其中前 3 + suitZh/isBlack/isRed 属 54 键聚合; SUITS 为牌堆构建所需内部数据(不进聚合, 与旧 game.js api 一致——旧 api 亦不导出 SUITS)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};
  const nsData = NS.data = NS.data || {};
  const me = nsData.identities = nsData.identities || {};

  const IDENTITIES = {
    lord: { name: 'Au选手', plain: '主公' },
    loyal: { name: 'Ag选手', plain: '忠臣' },
    rebel: { name: '反贼', plain: '红客' },
    traitor: { name: '摸鱼怪', plain: '内奸' },
  };
  // 人数 -> [主公,忠臣,反贼,内奸]
  const ID_TABLE = { 3: [1, 0, 1, 1], 4: [1, 1, 1, 1], 5: [1, 1, 2, 1], 6: [1, 1, 3, 1] };
  const EVENTS = {
    spade: { name: '毒瘤评测机', desc: '攻击伤害-1但无视WA' },
    club: { name: '暴力评测机', desc: '攻击伤害+1,命中后使用者受1伤' },
    heart: { name: '慈善评测机', desc: '当轮所有牌费用-1' },
    diamond: { name: '随机评测机', desc: '被攻击时判定:红桃=自动WA,黑桃=伤害+1' },
  };

  const SUITS = ['spade', 'club', 'heart', 'diamond'];
  const suitZh = { spade: '♠', club: '♣', heart: '♥', diamond: '♦' };
  const isBlack = (s) => s === 'spade' || s === 'club';
  const isRed = (s) => s === 'heart' || s === 'diamond';

  const api = { IDENTITIES, ID_TABLE, EVENTS, SUITS, suitZh, isBlack, isRed };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  Object.assign(me, api);
})(typeof window !== 'undefined' ? window : globalThis);
