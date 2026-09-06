/* ============================================================================
 * OI杀 v4.0 · src/data/cards.js — 卡牌定义 / 进化映射 / 牌堆构成(P1a 拆分)
 * 拆分自 game.js(P1a 模块拆分, 原卡牌定义区)。纯数据模块, 无跨模块调用。
 * 挂载: 共享命名空间 OIKill.data.cards
 * 导出: CARDS / DECK_COUNT / EVO_MAP / isAttackKey / isDodgeKey(共 5 键, 全部属 54 键聚合)
 * ==========================================================================*/
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};
  const nsData = NS.data = NS.data || {};
  const me = nsData.cards = nsData.cards || {};

  // type: basic(基本) trick(锦囊) equip(装备) unit(单位)
  const CARDS = {
    // 基本牌
    attack:   { name: '做法假了', plain: '攻击',   type: 'basic', cost: 2, sub: 'attack', desc: '对一名其他玩家造成1点伤害' },
    dodge:    { name: 'WA',       plain: '闪避',   type: 'basic', cost: 1, sub: 'dodge',  desc: '响应攻击时抵消(1灵感)' },
    heal:     { name: 'CCF捐款',  plain: '治疗',   type: 'basic', cost: 2, sub: 'heal',   desc: '回复1点体力(仅自己,满血不可用)' },
    coffee:   { name: '咖啡',     plain: '提神',   type: 'basic', cost: 1, sub: 'coffee', desc: '本回合下一张攻击伤害+1；濒死自救回1' },
    // 锦囊
    duel:     { name: '对拍',     plain: '决斗',   type: 'trick', cost: 2, desc: '双方轮流出攻击，先无者受1伤' },
    dismantle:{ name: '爆零',     plain: '拆除',   type: 'trick', cost: 1, desc: '弃置目标1张随机手牌' },
    draw2:    { name: '摸鱼',     plain: '补给',   type: 'trick', cost: 2, desc: '摸2张牌' },
    steal:    { name: '抄袭代码', plain: '缴获',   type: 'trick', cost: 2, desc: '获得目标1件装备(否则随机1张手牌)' },
    skipPlay: { name: '停课集训', plain: '禁足',   type: 'trick', cost: 3, desc: '目标下回合跳过行动阶段' },
    o2:       { name: 'O2优化',   plain: '强攻',   type: 'trick', cost: 3, desc: '弃1张攻击牌,对目标造成2点伤害' },
    pierce:   { name: '卡评测机', plain: '点杀',   type: 'trick', cost: 2, desc: '目标受1点不可闪避伤害' },
    cheat:    { name: '骗分',     plain: '急救',   type: 'trick', cost: 2, desc: '自己回复1点体力' },
    recover:  { name: '申诉',     plain: '回收',   type: 'trick', cost: 2, desc: '从弃牌堆随机获得1张' },
    gift:     { name: '玄学优化', plain: '馈赠',   type: 'trick', cost: 2, desc: '目标摸2张' },
    aoeAtk:   { name: '数据加强', plain: '全场进攻', type: 'trick', cost: 4, aoe: true, desc: 'AOE:全员出攻击否则受1伤' },
    aoeDodge: { name: '评测机抽风', plain: '全场闪避', type: 'trick', cost: 4, aoe: true, desc: 'AOE:全员出WA否则受1伤' },
    allHeal:  { name: 'CCF放水',  plain: '集体治疗', type: 'trick', cost: 4, aoe: true, desc: '全员回复1点体力' },
    harvest:  { name: '题解大会', plain: '公开选牌', type: 'trick', cost: 3, aoe: true, desc: '翻N张牌轮流选(简化:各摸1张)' },
    delaySkipPlay: { name: '水群', plain: '拖延', type: 'trick', cost: 2, delay: true, desc: '延时:判定非红桃→跳过行动阶段' },
    delaySkipDraw: { name: '断网', plain: '断粮', type: 'trick', cost: 2, delay: true, desc: '延时:判定非梅花→跳过摸牌阶段' },
    ub:       { name: 'UB',       plain: '天罚',   type: 'trick', cost: 3, delay: true, desc: '延时:判定黑桃2~9受3伤,否则传下家' },
    counter:  { name: '特判',     plain: '反制',   type: 'trick', cost: 1, sub: 'counter', desc: '抵消一张锦囊对一名角色的效果' },
    killUnit: { name: '删库',     plain: '格式化', type: 'trick', cost: 1, desc: '消灭一个敌方单位' },
    peek:     { name: '小抄',     plain: '偷看',   type: 'trick', cost: 1, desc: '查看牌堆顶1张' },
    mull:     { name: '复盘',     plain: '整理',   type: 'trick', cost: 1, desc: '弃1张手牌摸1张' },
    // 欢乐牌(双轨: 条件效果 + 弃置保底)
    funBetray:{ name: '卖队友',   plain: '拉人挡枪', type: 'trick', cost: 1, fun: true, desc: '被攻击时转给另一玩家(需其同意,一局一次)｜保底:本回合首次受伤-1' },
    funLie:   { name: '躺赢',     plain: '坐享其成', type: 'trick', cost: 1, fun: true, desc: '摸2,本回合禁攻｜保底:回复1灵感' },
    funReport:{ name: '举报',     plain: '检举',   type: 'trick', cost: 2, fun: true, desc: '目标展示手牌,你弃其中1张｜保底:看1张手牌' },
    funClone: { name: '开小号',   plain: '复制分身', type: 'trick', cost: 2, fun: true, desc: '复制你场上一张单位(一局一次)｜保底:摸1' },
    funGiveup:{ name: '摆烂宣言', plain: '破釜沉舟', type: 'trick', cost: 1, fun: true, desc: '弃光手牌摸3｜保底:摸1' },
    funPower: { name: '机房断电', plain: '全员后撤', type: 'trick', cost: 2, fun: true, desc: '消灭场上至多2个任意单位｜保底:回复1灵感' },
    funArgue: { name: '祖安对线', plain: '公开对质', type: 'trick', cost: 2, fun: true, desc: '指定2名玩家:各弃1张或互受1伤(各自选)｜保底:令一名玩家弃1张' },
    funCcf:   { name: '感谢CCF',  plain: '集体发糖', type: 'trick', cost: 2, fun: true, desc: '全员回1,下回合全体攻击费+1｜保底:你回1' },
    // 武器
    wLiannu:  { name: '评测机连发', plain: '连击',   type: 'equip', slot: 'weapon', cost: 2, desc: '每回合首次做法假了费用-1' },
    wQgj:     { name: '管理员权限', plain: '穿透',   type: 'equip', slot: 'weapon', cost: 2, desc: '无视防具' },
    wTree:    { name: '树状数组', plain: '窥牌',   type: 'equip', slot: 'weapon', cost: 1, desc: '攻击命中后可查看目标手牌' },
    wSeg:     { name: '线段树',   plain: '补牌',   type: 'equip', slot: 'weapon', cost: 2, desc: '攻击被WA抵消时摸1' },
    wTwoPtr:  { name: '双指针',   plain: '压迫',   type: 'equip', slot: 'weapon', cost: 2, desc: '目标手牌多于你→你摸1;少于你→目标弃1' },
    wCold:    { name: '冷数据',   plain: '缴械',   type: 'equip', slot: 'weapon', cost: 2, desc: '造成伤害时可改为弃目标2张牌' },
    wBbst:    { name: '平衡树',   plain: '强命',   type: 'equip', slot: 'weapon', cost: 3, desc: '攻击被WA抵消时弃1张强制命中' },
    wKsp:     { name: '手写快排', plain: '转化',   type: 'equip', slot: 'weapon', cost: 2, desc: '2张手牌当做法假了使用' },
    wFang:    { name: '放手一搏', plain: '三连',   type: 'equip', slot: 'weapon', cost: 3, desc: '最后1张手牌时攻击可指定至多3名玩家' },
    wBa:      { name: '拔网线',   plain: '缴械',   type: 'equip', slot: 'weapon', cost: 2, desc: '攻击命中后弃置目标1件装备' },
    wChase:   { name: '不死心',   plain: '追击',   type: 'equip', slot: 'weapon', cost: 2, desc: '攻击被WA抵消后可立即再攻击(每回合1次)' },
    // 防具
    aXuan:    { name: '玄学判题', plain: '护符',   type: 'equip', slot: 'armor', cost: 2, desc: '需出WA时判定红桃视为免费WA' },
    aHei:     { name: '黑名单',   plain: '免疫',   type: 'equip', slot: 'armor', cost: 2, desc: '黑色做法假了对你无效' },
    aAc:      { name: 'AC保护',   plain: '减伤甲', type: 'equip', slot: 'armor', cost: 2, desc: '每次受伤至多1;失去时回1' },
    aDsu:     { name: '并查集',   plain: '格挡',   type: 'equip', slot: 'armor', cost: 2, desc: '被攻击时弃1张手牌视为打出WA(免费)' },
    aMemo:    { name: '记忆化搜索', plain: '减伤',  type: 'equip', slot: 'armor', cost: 2, desc: '受伤时判定红桃伤害-1' },
    aFw:      { name: '防火墙',   plain: '免疫AOE', type: 'equip', slot: 'armor', cost: 2, desc: '免疫AOE伤害(暴力评测机事件期间失效且受伤+1)' },
    aRam:     { name: '内存加固', plain: '加厚',   type: 'equip', slot: 'armor', cost: 2, desc: '体力上限+1' },
    aDual:    { name: '双核',     plain: '节能',   type: 'equip', slot: 'armor', cost: 2, desc: '回合开始回复灵感+1' },
    aBattery: { name: '备用电源', plain: '续命',   type: 'equip', slot: 'armor', cost: 3, desc: '濒死时自动回1并弃置此防具(一局一次)' },
    // 单位(一击必杀制: 无攻防数值)
    uGuard:   { name: '线段树守卫', plain: '防线卫士', type: 'unit', domain: '数据结构', cost: 1, guard: true, desc: '守擂:挡下一次指向主人的攻击' },
    uBlitz:   { name: '学长助教', plain: '突击助教', type: 'unit', domain: '算法', cost: 2, blitz: true, desc: '速攻:部署当回合即可攻击' },
    uDeath:   { name: '机器人队友', plain: '勤务兵', type: 'unit', domain: '图论', cost: 1, death: true, desc: '亡语:被消灭时你摸1' },
    uPeek:    { name: '打表狂魔的表格', plain: '运算台', type: 'unit', domain: '数学', cost: 2, desc: '部署时查看牌堆顶1张' },
    uDeath2:  { name: '记忆化缓存', plain: '缓存塔', type: 'unit', domain: 'DP', cost: 1, death: true, desc: '亡语:被消灭时你摸1' },
    uStr:     { name: '字符串匹配器', plain: '校对员', type: 'unit', domain: '字符串', cost: 2, desc: '部署时摸1弃1' },
    uGuard2:  { name: '网络流管道', plain: '运兵线', type: 'unit', domain: '网络流', cost: 2, guard: true, desc: '守擂:挡下一次指向主人的攻击' },
    uBlitz2:  { name: '几何画板', plain: '测绘员', type: 'unit', domain: '计算几何', cost: 1, blitz: true, desc: '速攻:部署当回合即可攻击' },
    // ===== 进化牌(不进牌堆, 由进化系统生成) =====
    attackEvo:  { name: '实锤',     plain: '实锤',     type: 'basic', cost: 2, sub: 'attack', desc: '攻击伤害+1(进化)' },
    dodgeEvo:   { name: '样例全过', plain: '样例全过', type: 'basic', cost: 1, sub: 'dodge',  desc: '抵消后回复1体力(进化)' },
    healEvo:    { name: 'CCF金牌',  plain: 'CCF金牌',  type: 'basic', cost: 2, sub: 'heal',   desc: '回复2点并摸1(进化)' },
    coffeeEvo:  { name: '浓缩咖啡', plain: '浓缩咖啡', type: 'basic', cost: 1, sub: 'coffee', desc: '伤害+2;濒死回2(进化)' },
    duelEvo:    { name: 'WC对决',   plain: 'WC对决',   type: 'trick', cost: 2, desc: '对拍进化:败者受2伤' },
    aoeAtkEvo:  { name: '数据爆炸', plain: '数据爆炸', type: 'trick', cost: 4, aoe: true, desc: 'AOE进化:打不出攻击者受2伤' },
    aoeDodgeEvo:{ name: '评测机暴走', plain: '评测机暴走', type: 'trick', cost: 4, aoe: true, desc: 'AOE进化:打不出WA者受2伤' },
    counterEvo: { name: '一票否决', plain: '一票否决', type: 'trick', cost: 1, sub: 'counter', desc: '特判进化:抵消后摸1' },
    uGuardEvo:  { name: '主席树守卫', plain: '主席树守卫', type: 'unit', domain: '数据结构', cost: 1, guard: true, desc: '守擂进化:挡下攻击被消灭时你摸1(进化)' },
    killUnitEvo:{ name: '清空回收站', plain: '清空回收站', type: 'trick', cost: 1, desc: '消灭一个敌方单位后摸1(进化)' },
    aShield:   { name: '评测机护盾', plain: '护盾', type: 'equip', slot: 'armor', cost: 0, desc: '主公专属:每回合免疫首次伤害(不进牌堆)' },
  };
  const isAttackKey = (k) => k === 'attack' || k === 'attackEvo';
  const isDodgeKey = (k) => k === 'dodge' || k === 'dodgeEvo';
  const EVO_MAP = { attack: 'attackEvo', dodge: 'dodgeEvo', heal: 'healEvo', coffee: 'coffeeEvo', duel: 'duelEvo', aoeAtk: 'aoeAtkEvo', aoeDodge: 'aoeDodgeEvo', counter: 'counterEvo', uGuard: 'uGuardEvo', killUnit: 'killUnitEvo' };

  /* 牌堆构成(120张): spec名 -> 张数 */
  const DECK_COUNT = {
    attack: 18, dodge: 12, heal: 6, coffee: 4,
    duel: 3, dismantle: 3, draw2: 3, steal: 3, skipPlay: 2, o2: 2, pierce: 2,
    cheat: 2, recover: 2, gift: 2, aoeAtk: 2, aoeDodge: 2, allHeal: 1, harvest: 1,
    delaySkipPlay: 1, delaySkipDraw: 1, ub: 1, counter: 4, killUnit: 3, peek: 2, mull: 2,
    funBetray: 1, funLie: 1, funReport: 1, funClone: 1, funGiveup: 1, funPower: 1, funArgue: 1, funCcf: 1,
    wLiannu: 1, wQgj: 1, wTree: 1, wSeg: 1, wTwoPtr: 1, wCold: 1, wBbst: 1, wKsp: 1, wFang: 1, wBa: 1, wChase: 1,
    aXuan: 1, aHei: 1, aAc: 1, aDsu: 1, aMemo: 1, aFw: 1, aRam: 1, aDual: 1, aBattery: 1,
    uGuard: 1, uBlitz: 1, uDeath: 1, uPeek: 1, uDeath2: 1, uStr: 1, uGuard2: 1, uBlitz2: 1,
  };

  const api = { CARDS, DECK_COUNT, EVO_MAP, isAttackKey, isDodgeKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  Object.assign(me, api);
})(typeof window !== 'undefined' ? window : globalThis);
