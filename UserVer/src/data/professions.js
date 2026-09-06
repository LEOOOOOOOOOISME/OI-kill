/* ============================================================================
 * OI杀 v4.0 · src/data/professions.js — 职业表 / 技能表 / 领域表(P1a 拆分)
 * 拆分自 game.js(P1a 模块拆分, 原职业定义区 + 文末 SKILLS 表)。纯数据模块。
 * 挂载: 共享命名空间 OIKill.data.professions
 * 导出: PROFESSIONS / SKILLS / DOMAINS(共 3 键, 全部属 54 键聚合)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};
  const nsData = NS.data = NS.data || {};
  const me = nsData.professions = nsData.professions || {};

  /* 职业(19): 主/副领域 + 觉醒效果(体力≤上限一半时立即触发,永久) */
  const PROFESSIONS = [
    { id: 'shenben', name: '神犇', plain: '高手', hp: 4, domain: '算法', subDomain: '数据结构',
      awaken: '攻击伤害永久+1', passive: '碾压:黑色手牌可当做法假了' },
    { id: 'juruo', name: '蒟蒻', plain: '新手', hp: 4, domain: 'DP', subDomain: '算法',
      awaken: '体力上限+1并回1', passive: '抱大腿:回合开始空手牌摸1' },
    { id: 'duliu', name: '毒瘤出题人', plain: '刁钻考官', hp: 3, domain: '数据结构', subDomain: '算法',
      awaken: '祖传卡常不再消耗手牌', passive: '祖传卡常:弃1手牌令本次攻击不可被WA(每回合1次)' },
    { id: 'nvzhuang', name: '女装大佬', plain: '伪装者', hp: 3, domain: '字符串', subDomain: '算法',
      awaken: '直播可看2张拿1张', passive: '直播:弃1红牌看目标手牌并拿1张(每回合1次)' },
    { id: 'pingce', name: '评测姬', plain: '裁判', hp: 3, domain: '网络流', subDomain: '数学',
      awaken: '受伤减伤免判定(每回合1次)', passive: '测评:受伤判定红桃伤害-1' },
    { id: 'huashui', name: '划水怪', plain: '摸鱼者', hp: 4, domain: '网络流', subDomain: '数学',
      awaken: '回合结束未造成伤害→摸2', passive: '摸鱼:回合结束未造成伤害→摸1弃1' },
    { id: 'tuiyi', name: '退役选手', plain: '老将', hp: 5, domain: '计算几何', subDomain: '数据结构',
      awaken: '回2血摸2', passive: '挣扎:回合开始体力>1时-1体力摸2' },
    { id: 'jiaolian', name: '金牌教练', plain: '名师', hp: 4, domain: '计算几何', subDomain: '算法',
      awaken: '被救者与你各得1张攻击', passive: '谈心:有人濒死时自动弃1手牌救回(一局一次)' },
    { id: 'chuangqi', name: '传奇Au选手', plain: '传奇选手', hp: 4, domain: '计算几何', subDomain: '数学',
      awaken: '本局伤害永久+1', passive: '封神:展示手牌,至多2目标各受1伤(一局一次)' },
    { id: 'xuezhang', name: '学长', plain: '讲题人', hp: 4, domain: '图论', subDomain: '算法',
      awaken: '讲题时你同摸1', passive: '讲题:弃1让一名玩家摸1(每回合1次)' },
    { id: 'mengxin', name: '萌新', plain: '萌新', hp: 4, domain: '算法', subDomain: 'DP',
      awaken: '摸牌阶段多摸1', passive: '问问题:成为卡牌唯一目标摸1(每回合1次)' },
    { id: 'dabiao', name: '打表狂魔', plain: '制表师', hp: 4, domain: '数据结构', subDomain: '数学',
      awaken: '手牌上限+1', passive: '打表:弃2摸4(每回合1次)' },
    { id: 'xuanxue', name: '玄学选手', plain: '玄学家', hp: 4, domain: '数学', subDomain: '算法',
      awaken: '每回合首次受伤免伤(免判定)', passive: '玄学:每回合首次受伤判定红桃免伤' },
    { id: 'jianpan', name: '键盘侠', plain: '喷子', hp: 4, domain: '字符串', subDomain: '图论',
      awaken: '口嗨可指定两名玩家', passive: '口嗨:弃1令一名玩家弃1手牌(每回合1次)' },
    { id: 'chaoti', name: '抄题解选手', plain: '抄袭者', hp: 4, domain: '算法', subDomain: '字符串',
      awaken: '抄题解看4取2', passive: '抄题解:弃1看牌堆顶3取1(每回合1次)' },
    { id: 'yaxian', name: '压线选手', plain: '压线者', hp: 4, domain: 'DP', subDomain: '数学',
      awaken: '体力上限+1并回1', passive: '压线过:伤害使体力≤0时改为降到1(每回合1次)' },
    { id: 'shuiqun', name: '水群怪', plain: '龙王', hp: 3, domain: '图论', subDomain: '字符串',
      awaken: '水群摸3弃1', passive: '水群:弃1摸2弃1(每回合1次)' },
    { id: 'baoling', name: '爆零选手', plain: '爆零者', hp: 4, domain: '计算几何', subDomain: 'DP',
      awaken: '爆零伤害+1', passive: '爆零:弃1令一名玩家弃1手牌或受1伤(每回合1次)' },
    { id: 'tuling', name: '图灵奖得主', plain: '大师', hp: 3, domain: '数学', subDomain: '图论',
      awaken: '摸2', passive: '图灵完备:手牌上限+1' },
  ];

  const DOMAINS = ['算法', '数据结构', '图论', '数学', 'DP', '字符串', '网络流', '计算几何'];

  /* 各职业可用主动技 */
  const SKILLS = {
    shenben: ['akioi'], duliu: ['kachang'], nvzhuang: ['live'], pingce: ['rejudge'],
    chuangqi: ['seal'], xuezhang: ['teach'], dabiao: ['dabiao'], jianpan: ['kouhai'],
    chaoti: ['chao'], shuiqun: ['shuiqun'], baoling: ['baoling'], tuling: ['dianji'],
  };

  const api = { PROFESSIONS, SKILLS, DOMAINS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  Object.assign(me, api);
})(typeof window !== 'undefined' ? window : globalThis);
