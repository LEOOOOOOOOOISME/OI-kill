/* ============================================================================
 * OI杀 v4.0 游戏引擎（重构版）
 * 依据 requirement.txt v4.0 实现。纯逻辑层：不依赖 DOM，浏览器/Node 双端可运行。
 * 命名：每张卡/职业均有 黑话名(name) 与 通俗名(plain)。
 * ==========================================================================*/
(function (root) {
  'use strict';

  /* ---------------- RNG ---------------- */
  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ---------------- 卡牌定义 ---------------- */
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
    funBetray:{ name: '卖队友',   plain: '拉人挡枪', type: 'trick', cost: 1, fun: true, desc: '被攻击时转给另一玩家(一局一次)｜保底:本回合受伤-1' },
    funLie:   { name: '躺赢',     plain: '坐享其成', type: 'trick', cost: 1, fun: true, desc: '摸2,本回合禁攻｜保底:回复1灵感' },
    funReport:{ name: '举报',     plain: '检举',   type: 'trick', cost: 2, fun: true, desc: '目标展示手牌,你弃其中1张｜保底:看1张手牌' },
    funClone: { name: '开小号',   plain: '复制分身', type: 'trick', cost: 2, fun: true, desc: '复制你场上一张单位(一局一次)｜保底:摸1' },
    funGiveup:{ name: '摆烂宣言', plain: '破釜沉舟', type: 'trick', cost: 1, fun: true, desc: '弃光手牌摸3｜保底:摸1' },
    funPower: { name: '机房断电', plain: '全员后撤', type: 'trick', cost: 2, fun: true, desc: '消灭场上至多2个任意单位｜保底:回复1灵感' },
    funArgue: { name: '祖安对线', plain: '公开对质', type: 'trick', cost: 2, fun: true, desc: '2名玩家各弃1张｜保底:令一名玩家弃1张' },
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
    aFw:      { name: '防火墙',   plain: '免疫AOE', type: 'equip', slot: 'armor', cost: 2, desc: '免疫AOE伤害(暴力评测机事件期间失效)' },
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
    aShield:   { name: '评测机护盾', plain: '护盾', type: 'equip', slot: 'armor', cost: 0, desc: '主公专属:每回合免疫首次伤害(不进牌堆)' },
  };
  const isAttackKey = (k) => k === 'attack' || k === 'attackEvo';
  const isDodgeKey = (k) => k === 'dodge' || k === 'dodgeEvo';
  const EVO_MAP = { attack: 'attackEvo', dodge: 'dodgeEvo', heal: 'healEvo', coffee: 'coffeeEvo', duel: 'duelEvo', aoeAtk: 'aoeAtkEvo', aoeDodge: 'aoeDodgeEvo', counter: 'counterEvo' };

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

  /* ---------------- 工具 ---------------- */
  const SUITS = ['spade', 'club', 'heart', 'diamond'];
  const suitZh = { spade: '♠', club: '♣', heart: '♥', diamond: '♦' };
  const isBlack = (s) => s === 'spade' || s === 'club';
  const isRed = (s) => s === 'heart' || s === 'diamond';

  function buildDeck(rnd) {
    const deck = [];
    let id = 1;
    for (const key of Object.keys(DECK_COUNT)) {
      for (let i = 0; i < DECK_COUNT[key]; i++) {
        deck.push({
          id: id++, key, suit: SUITS[Math.floor(rnd() * 4)],
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
    const [nl, nlo, nr, nt] = ID_TABLE[n] || [1, 1, 2, 1];
    const ids = ['lord'];
    for (let i = 0; i < nlo; i++) ids.push('loyal');
    for (let i = 0; i < nr; i++) ids.push('rebel');
    for (let i = 0; i < nt; i++) ids.push('traitor');
    // 洗身份(主公固定给0号)
    const rest = ids.slice(1);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(g.rnd() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    const idOrder = ['lord'].concat(rest);

    // 随机职业
    const profPool = PROFESSIONS.slice();
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
    g.log.push({ t: 0, txt: `牌桌开启: ${names.length} 人局 · 0号(${names[0]})为${IDENTITIES.lord.name}`, cls: 'act' });
    for (const p of g.players) {
      g.log.push({ t: 0, txt: `${p.name} 获得职业【${p.prof.name}】(${p.prof.plain})`, cls: '' });
    }
    return g;
  }

  /* ---------------- 基础操作 ---------------- */
  function spec(key) { return CARDS[key]; }
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
      if (g.deck.length > 0) p.hand.push(g.deck.pop());
    }
  }

  function discardCard(g, c, toDiscard) {
    if (toDiscard) g.discard.push(c);
  }
  function discardFromHand(g, p, idx) {
    const c = p.hand[idx];
    p.hand.splice(idx, 1);
    g.discard.push(c);
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
    if (isAttackKey(key) && p.weapon && p.weapon.key === 'wLiannu' && !p.attackUsed) discount = Math.max(discount, 1);
    // 慈善评测机事件: 当轮所有牌-1
    if (g.eventSuit === 'heart') discount = Math.max(discount, 1);
    // 感谢CCF: 下一轮全体攻击费+1(M13)
    if (isAttackKey(key) && g.round === g.ccfRound + 1) cost += 1;
    // 反贼首轮限制: 第一轮内攻击与单位部署+1费(H3)
    if (g.round === 1 && p.identity === 'rebel' && (isAttackKey(key) || s.type === 'unit')) cost += 1;
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
      g.log.push({ t: g.round, txt: `${p.name} 判定【${spec(d.key).name}】翻出 ${suitZh[card.suit]}`, cls: 'evt' });
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
        else { const next = nextAlive(g, pid); if (next !== -1) { g.players[next].delayArea.push(d); g.log.push({ t: g.round, txt: `UB 传给 ${g.players[next].name}`, cls: 'evt' }); } else g.discard.push(d); }
      }
    }
  }

  function drawPhase(g, pid) {
    const p = g.players[pid];
    if (p.dead) return;
    let n = 2;
    if (p.awaken && p.prof.id === 'mengxin') n += 1;
    if (!p.skipDraw) draw(g, pid, n);
  }

  function discardPhase(g, pid) {
    const p = g.players[pid];
    if (p.dead) return;
    const limit = 5 + p.handLimitBonus + (p.prof.id === 'tuling' && p.usedDianji ? 2 : 0);
    while (p.hand.length > limit) {
      const idx = g.human === pid && g.discardChoice ? g.discardChoice(p) : 0;
      discardFromHand(g, p, Math.min(idx, p.hand.length - 1));
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
      const card = g.deck.length ? g.deck.pop() : (g.discard.length ? (g.deck = g.discard.splice(0, g.discard.length), g.deck.pop()) : { suit: 'heart', key: 'dodge' });
      if (card.id) g.discard.push(card); // 事件牌结算后入弃牌堆(占位牌不入,防牌张虚增)
      g.eventSuit = card.suit;
      g.event = EVENTS[card.suit];
      g.log.push({ t: g.round, txt: `评测机事件: ${suitZh[card.suit]} ${g.event.name} — ${g.event.desc}`, cls: 'evt' });
      if (g.deck.length === 0 && g.discard.length > 0) {
        g.deck = g.discard.slice(); g.discard = [];
        for (let i = g.deck.length - 1; i > 0; i--) { const j = Math.floor(g.rnd() * (i + 1)); [g.deck[i], g.deck[j]] = [g.deck[j], g.deck[i]]; }
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
      g.deck.push(c); // 判定牌结算后置回牌堆底
      return c;
    }
    return { key: 'dodge', suit: 'heart', num: 1, id: -1 }; // 全场无牌: 默认红桃
  }

  /* ---------------- 伤害/濒死 ---------------- */
  function loseHp(g, pid, dmg, src, srcName) {
    const p = g.players[pid];
    if (p.dead || g.over) return;
    let d = dmg;
    const bypass = ['struggle', 'overload', 'ub', 'guard'].includes(srcName);
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
      g.lordDamagedLoyal = true;
      g.log.push({ t: g.round, txt: `(主公对忠臣伤害-1)`, cls: '' });
    }
    // AC保护: 每次受伤至多1
    if (!ignoreArmor && p.armor && p.armor.key === 'aAc' && d > 1) { d = 1; g.log.push({ t: g.round, txt: `${p.name}【AC保护】伤害降至1`, cls: '' }); }
    // 记忆化搜索: 受伤判定红桃-1
    if (!ignoreArmor && p.armor && p.armor.key === 'aMemo' && !bypass) {
      const jc = judgeCard(g);
      if (jc.suit === 'heart') { d = Math.max(0, d - 1); g.log.push({ t: g.round, txt: `${p.name}【记忆化搜索】判定♥,伤害-1`, cls: 'evt' }); }
    }
    // 评测姬测评(觉醒后免判定减伤)
    if (p.awaken && p.prof.id === 'pingce' && !p.armorCount.pingce && !bypass) { d = Math.max(0, d - 1); p.armorCount.pingce = 1; }
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
    // 压线过
    if (p.prof.id === 'yaxian' && !p.yaxianUsed && p.hp - d <= 0) { d = p.hp - 1; p.yaxianUsed = true; g.log.push({ t: g.round, txt: `${p.name}【压线过】体力锁定为1`, cls: 'act' }); }
    if (d <= 0) return;
    p.hp -= d;
    if (src && src.id !== pid) g.players[src.id].damageDealt += d;
    g.log.push({ t: g.round, txt: `${p.name} 受到 ${d} 点伤害(剩${p.hp})`, cls: 'bad' });
    if (p.hp <= 0) nearDeath(g, pid, src);
    if (!p.dead) checkAwaken(g, pid);
    checkVictory(g);
  }

  function nearDeath(g, pid, src) {
    const p = g.players[pid];
    if (p.dead) return;
    g.log.push({ t: g.round, txt: `${p.name} 进入濒死!`, cls: 'bad' });
    // 1. 蒟蒻退役
    if (p.prof.id === 'juruo' && !p.usedRetire) {
      p.usedRetire = true;
      while (p.hand.length) g.discard.push(p.hand.pop());
      if (p.weapon) { g.discard.push(p.weapon); p.weapon = null; }
      unequipArmor(g, p, true);
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
      discardFromHand(g, mentor, 0);
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
        g.log.push({ t: g.round, txt: `${p.name} 喝【${spec(c.key).name}】自救回${c.key === 'coffeeEvo' ? 2 : 1}血`, cls: 'act' });
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
    g.log.push({ t: g.round, txt: `${p.name} 阵亡!${p.identity !== 'traitor' ? '身份: ' + IDENTITIES[p.identity].name : ''}`, cls: 'bad' }); // M23: 内奸身份不公开
    if (src && src.id !== pid) {
      src.kills++;
      g.log.push({ t: g.round, txt: `${src.name} 击杀 ${p.name}`, cls: 'act' });
      if (p.identity === 'rebel') { draw(g, src.id, 3); g.log.push({ t: g.round, txt: `${src.name} 击杀反贼,摸3张!`, cls: 'act' }); }
      if (p.identity === 'lord') { src.killedLord = true; } // 掀翻成就
    }
    // 亡语
    for (const u of p.units) { /* 已被弃置,亡语不触发(阵亡弃置不触发) */ }
    checkVictory(g);
  }

  function giveAttack(g, p) {
    const idx = g.discard.findIndex(c => isAttackKey(c.key));
    if (idx >= 0) { const c = g.discard.splice(idx, 1)[0]; p.hand.push(c); }
    else draw(g, p.id, 1);
  }

  function forceEndByCount(g) {
    const alive = g.players.filter(p => !p.dead);
    const maxCnt = Math.max(...alive.map(p => alive.filter(x => x.identity === p.identity).length));
    const winners = alive.filter(p => alive.filter(x => x.identity === p.identity).length === maxCnt).map(p => p.identity);
    const uniq = [...new Set(winners)];
    if (uniq.length === 1) {
      const side = uniq[0] === 'lord' || uniq[0] === 'loyal' ? 'lord' : uniq[0];
      g.log.push({ t: g.round, txt: `【保底终局】连续洗牌无胜负: 存活人数多者胜`, cls: 'evt' });
      end(g, side === 'rebel' ? 'rebel' : side === 'traitor' ? 'traitor' : 'lord');
    } else if (alive.some(p => p.identity === 'traitor')) {
      g.log.push({ t: g.round, txt: `【保底终局】人数相同,内奸单独获胜!`, cls: 'evt' });
      end(g, 'traitor');
    } else {
      g.log.push({ t: g.round, txt: `【保底终局】平局`, cls: 'evt' });
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
      if (p.identity === 'traitor' && !p.dead && p.kills >= 1) list.push({ name: '搅局者', points: 1, desc: '内奸存活至终局且亲手击杀≥1名敌人(击杀主公视同)' });
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

  function queueEvo(g, pid, key) {
    if (!g.pendingEvo[pid]) g.pendingEvo[pid] = [];
    if (!g.pendingEvo[pid].includes(key)) g.pendingEvo[pid].push(key);
  }
  /* 尝试进化: 手牌中有对应基础牌则升级; 返回是否成功 */
  function tryEvolve(g, pid, key) {
    const p = g.players[pid];
    if (p.dead || p.evoTotal >= 3) return false;
    const idx = p.hand.findIndex(c => c.key === key);
    if (idx < 0) return false;
    const evoKey = EVO_MAP[key];
    if (!evoKey) return false;
    p.hand[idx].key = evoKey;
    p.evoTotal++;
    g.log.push({ t: g.round, txt: `🃏${p.name} 进化!【${spec(key).name}】→【${spec(evoKey).name}】`, cls: 'evt' });
    return true;
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
        case 'xuezhang': case 'baoling': case 'tuling': case 'dabiao': draw(g, pid, 2); break;
        case 'mengxin': break; // 摸牌阶段多摸1
        case 'dabiao': p.handLimitBonus += 1; break;
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

  /* ---------------- 战斗裁决 ---------------- */
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
      if (attacker.weapon && attacker.weapon.key === 'wTree') g.log.push({ t: g.round, txt: `${attacker.name}【树状数组】查看${target.name}手牌: ${target.hand.map(c => spec(c.key).name).join('、')}`, cls: '' });
      return 'guard';
    }
    // 黑名单: 黑色攻击无效
    if (target.armor && target.armor.key === 'aHei' && isBlack(opts.suit || 'spade') && !(attacker.weapon && attacker.weapon.key === 'wQgj')) {
      g.log.push({ t: g.round, txt: `${target.name}【黑名单】黑色攻击无效`, cls: 'act' });
      return 'blocked';
    }
    // 随机评测机事件: 目标判定
    if (evt === 'diamond') {
      const jc = judgeCard(g);
      g.log.push({ t: g.round, txt: `随机评测机判定 ${suitZh[jc.suit]}`, cls: 'evt' });
      if (jc.suit === 'heart') { g.log.push({ t: g.round, txt: `${target.name} 判定红桃,自动闪避`, cls: 'act' }); return 'dodged'; }
      if (jc.suit === 'spade') dmg += 1;
    }
    // 卖队友(响应): 被攻击者可弃置此牌将攻击转给另一名玩家(一局一次)
    if (opts.allowBetray !== false && evt !== 'spade') {
      const hasBetray = target.hand.some(c => c.key === 'funBetray');
      if (hasBetray && !g.usedBetray) {
        const others = g.players.filter(q => !q.dead && q.id !== attacker.id && q.id !== target.id);
        if (others.length) {
          if (g.askDodge) {
            g.pending = { type: 'dodge', attacker: attacker.id, target: target.id, dmg, suit: opts.suit || 'spade', cardId: opts.cardId, isEvo: opts.isEvo, ctx: { betrayAvail: true, betrayOptions: others.map(q => ({ id: q.id, name: q.name })) } };
            return 'pending';
          }
          const nt = others[Math.floor(g.rnd() * others.length)];
          const bi = target.hand.findIndex(c => c.key === 'funBetray');
          const bc = target.hand.splice(bi, 1)[0];
          g.discard.push(bc); g.usedBetray = true;
          g.log.push({ t: g.round, txt: `${target.name}【卖队友】把攻击转给了${nt.name}!`, cls: 'act' });
          return attackPlayer(g, attacker, nt, { suit: opts.suit || 'spade', isEvo: opts.isEvo, allowBetray: false, cardId: opts.cardId, noDodge: opts.noDodge });
        }
      }
    }
    // WA 响应(含主公技护驾: 任意玩家可代主公出WA)
    if (evt !== 'spade' && !opts.noDodge) {
      if (target.identity === 'lord') {
        const helpers = g.players.filter(q => !q.dead && q.id !== target.id && q.id !== attacker.id && canDodge(g, q));
        if (g.askDodge) {
          g.pending = { type: 'dodge', attacker: attacker.id, target: target.id, dmg, suit: opts.suit || 'spade', cardId: opts.cardId, isEvo: opts.isEvo, helpers: helpers.map(q => ({ id: q.id, name: q.name })) };
          return 'pending';
        }
        if (canDodge(g, target)) return resolveDodge(g, target, true, dmg, opts.suit || 'spade', attacker);
        if (helpers.length) { const h = helpers[0]; g.log.push({ t: g.round, txt: `${h.name}【护驾】代${target.name}出WA!`, cls: 'act' }); return helperDodge(g, h, attacker, target); }
        return resolveHit(g, attacker, target, dmg, opts);
      }
      if (canDodge(g, target)) {
        if (g.askDodge) {
          // 人类响应: 挂起 pending
          g.pending = { type: 'dodge', attacker: attacker.id, target: target.id, dmg, suit: opts.suit || 'spade', cardId: opts.cardId, isEvo: opts.isEvo };
          return 'pending';
        } else {
          // AI/自动: 有WA则出
          return resolveDodge(g, target, true, dmg, opts.suit || 'spade', attacker);
        }
      }
    }
    // 命中
    const r = resolveHit(g, attacker, target, dmg, opts);
    return r;
  }

  function canDodge(g, p) {
    if (p.armor && p.armor.key === 'aXuan') return true;
    if (p.armor && p.armor.key === 'aDsu' && p.hand.length >= 1) return true;
    return p.hand.some(c => isDodgeKey(c.key));
  }

  function resolveDodge(g, target, willDodge, dmg, suit, attacker) {
    // 玄学判题(管理员权限无视)
    if (target.armor && target.armor.key === 'aXuan' && !(attacker.weapon && attacker.weapon.key === 'wQgj')) {
      const jc = judgeCard(g);
      g.log.push({ t: g.round, txt: `${target.name}【玄学判题】判定 ${suitZh[jc.suit]}`, cls: 'evt' });
      if (jc.suit === 'heart') {
        g.log.push({ t: g.round, txt: `判定红桃,视为免费打出WA!`, cls: 'act' });
        return afterDodge(g, attacker, target, null, true);
      }
    }
    if (!willDodge) return resolveHit(g, attacker, target, dmg, { suit });
    // 并查集: 弃1手牌当WA(管理员权限无视)
    if (target.armor && target.armor.key === 'aDsu' && !(attacker.weapon && attacker.weapon.key === 'wQgj') && !target.hand.some(c => isDodgeKey(c.key))) {
      discardFromHand(g, target, 0);
      g.log.push({ t: g.round, txt: `${target.name}【并查集】弃1手牌当作WA`, cls: 'act' });
      return afterDodge(g, attacker, target, null, true);
    }
    const idx = target.hand.findIndex(c => isDodgeKey(c.key));
    if (idx < 0 || target.mp < 1) return resolveHit(g, attacker, target, dmg, { suit });
    const c = target.hand.splice(idx, 1)[0];
    g.discard.push(c);
    target.mp -= 1;
    g.log.push({ t: g.round, txt: `${target.name} 打出【${spec(c.key).name}】,抵消攻击`, cls: 'act' });
    // 成功抵消 -> 进化候选【样例全过】(进化牌不再进化)
    if (c.key === 'dodge') queueEvo(g, target.id, 'dodge');
    return afterDodge(g, attacker, target, c, false);
  }

  function afterDodge(g, attacker, target, waCard, free) {
    // 样例全过(进化WA): 抵消后回复1体力
    if (waCard && waCard.key === 'dodgeEvo') {
      target.hp = Math.min(target.maxHp, target.hp + 1);
      g.log.push({ t: g.round, txt: `${target.name}【样例全过】抵消后回复1体力`, cls: 'act' });
    }
    // 线段树: 攻击被抵消摸1
    if (attacker.weapon && attacker.weapon.key === 'wSeg') { draw(g, attacker.id, 1); g.log.push({ t: g.round, txt: `${attacker.name}【线段树】摸1`, cls: '' }); }
    // 不死心: 被抵消后立即再出一张攻击(需求9.3)
    if (attacker.weapon && attacker.weapon.key === 'wChase' && !attacker.chaseUsed && attacker.hand.some(c => isAttackKey(c.key)) && !target.dead) {
      if (attacker.id === g.human) {
        g.pending = { type: 'chase', attacker: attacker.id, target: target.id };
        return 'pending';
      }
      const ai = attacker.hand.findIndex(c => isAttackKey(c.key));
      const ac = attacker.hand.splice(ai, 1)[0];
      g.discard.push(ac);
      attacker.chaseUsed = true;
      g.log.push({ t: g.round, txt: `${attacker.name}【不死心】再出一张${spec(ac.key).name}!`, cls: 'act' });
      g.askDodge = (target.id === g.human);
      attackPlayer(g, attacker, target, { suit: ac.suit, isEvo: ac.key === 'attackEvo' });
      return 'chased';
    }
    // 平衡树: 被抵消时弃1张强制命中(需求9.3)
    if (attacker.weapon && attacker.weapon.key === 'wBbst' && attacker.hand.length >= 1 && !target.dead) {
      if (attacker.id === g.human) {
        g.pending = { type: 'bbst', attacker: attacker.id, target: target.id, dmg: 1 };
        return 'pending';
      }
      discardFromHand(g, attacker, 0);
      g.log.push({ t: g.round, txt: `${attacker.name}【平衡树】弃1强制命中!`, cls: 'act' });
      return resolveHit(g, attacker, target, 1, {}, false);
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
      discardFromHand(g, atk, 0);
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
      const ai = atk.hand.findIndex(c => isAttackKey(c.key));
      if (ai < 0) return { ok: false, why: '没有攻击牌' };
      const ac = atk.hand.splice(ai, 1)[0];
      g.discard.push(ac);
      atk.chaseUsed = true;
      g.log.push({ t: g.round, txt: `${atk.name}【不死心】再出一张${spec(ac.key).name}!`, cls: 'act' });
      g.askDodge = (tgt.id === g.human);
      return { ok: true, result: attackPlayer(g, atk, tgt, { suit: ac.suit, isEvo: ac.key === 'attackEvo' }) };
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
      discardFromHand(g, target, 0); discardFromHand(g, target, 0);
      g.log.push({ t: g.round, txt: `${attacker.name}【冷数据】改为弃置${target.name}2张牌`, cls: 'act' });
      return 'cold';
    }
    // 暴力评测机: 使用者自损
    if (g.eventSuit === 'club') {
      g.log.push({ t: g.round, txt: `${attacker.name} 命中后自己受1伤(暴力评测机)`, cls: 'bad' });
      loseHp(g, attacker.id, 1, null, 'event');
    }
    loseHp(g, target.id, dmg, attacker, 'attack');
    // 拔网线: 命中弃1装备
    if (attacker.weapon && attacker.weapon.key === 'wBa' && (target.weapon || target.armor)) {
      if (target.armor) { const e = target.armor; unequipArmor(g, target, true); g.log.push({ t: g.round, txt: `${attacker.name}【拔网线】弃置${target.name}的${spec(e.key).name}`, cls: 'act' }); }
      else { const e = target.weapon; target.weapon = null; g.discard.push(e); g.log.push({ t: g.round, txt: `${attacker.name}【拔网线】弃置${target.name}的${spec(e.key).name}`, cls: 'act' }); }
    }
    // 双指针
    if (attacker.weapon && attacker.weapon.key === 'wTwoPtr') {
      if (target.hand.length > attacker.hand.length) { draw(g, attacker.id, 1); g.log.push({ t: g.round, txt: `${attacker.name}【双指针】摸1`, cls: '' }); }
      else if (target.hand.length < attacker.hand.length && target.hand.length > 0) { discardFromHand(g, target, 0); g.log.push({ t: g.round, txt: `${attacker.name}【双指针】目标弃1`, cls: '' }); }
    }
    if (attacker.weapon && attacker.weapon.key === 'wTree') g.log.push({ t: g.round, txt: `${attacker.name}【树状数组】查看${target.name}手牌: ${target.hand.map(c => spec(c.key).name).join('、') || '无'}`, cls: '' });
    // 攻击命中 -> 进化候选【实锤】(进化牌不再进化)
    if (!opts.isEvo) queueEvo(g, attacker.id, 'attack');
    return 'hit';
  }

  /* ---------------- 特判(反制) ---------------- */
  // 可被特判抵消的锦囊(延时锦囊不可抵消)
  const COUNTERABLE = ['dismantle', 'steal', 'pierce', 'o2', 'skipPlay', 'gift', 'funReport', 'funArgue', 'duel', 'aoeAtk', 'aoeAtkEvo', 'aoeDodge', 'aoeDodgeEvo', 'allHeal'];
  function tryCounter(g, victimId, trickKey, srcId) {
    const p = g.players[victimId];
    if (p.dead) return false;
    const idx = p.hand.findIndex(c => c.key === 'counter' || c.key === 'counterEvo');
    if (idx < 0 || p.mp < 1) return false;
    if (victimId === g.human) {
      g.pending = { type: 'counter', victim: victimId, srcId, trickKey };
      return 'pending';
    }
    const c = p.hand.splice(idx, 1)[0];
    g.discard.push(c); p.mp -= 1;
    g.log.push({ t: g.round, txt: `${p.name} 使用【${spec(c.key).name}】抵消了${spec(trickKey).name}的效果!`, cls: 'act' });
    if (c.key === 'counterEvo') { draw(g, victimId, 1); g.log.push({ t: g.round, txt: `${p.name}【一票否决】摸1`, cls: '' }); }
    else queueEvo(g, victimId, 'counter');
    return true;
  }
  function respondCounter(g, pid, yes) {
    const pd = g.pending;
    if (!pd || pd.type !== 'counter') return { ok: false, why: '无挂起的特判询问' };
    g.pending = null;
    if (yes) {
      const p = g.players[pid];
      const idx = p.hand.findIndex(c => c.key === 'counter' || c.key === 'counterEvo');
      if (idx < 0 || p.mp < 1) return { ok: false, why: '无特判或灵感不足' };
      const c = p.hand.splice(idx, 1)[0];
      g.discard.push(c); p.mp -= 1;
      g.log.push({ t: g.round, txt: `${p.name} 使用【${spec(c.key).name}】抵消了${spec(pd.trickKey).name}的效果!`, cls: 'act' });
      if (c.key === 'counterEvo') { draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name}【一票否决】摸1`, cls: '' }); }
      else queueEvo(g, pid, 'counter');
      if (pd.ctx && pd.ctx.type === 'aoe') { g.log.push({ t: g.round, txt: `${p.name} 抵消了AOE对自己的一段效果`, cls: 'act' }); resumeAoe(g, pd.ctx); }
      return { ok: true, countered: true };
    }
    if (pd.ctx && pd.ctx.type === 'aoe') { aoeApplyOne(g, pd.ctx.srcId, pd.ctx.trickKey, pd.ctx.dmg, pd.current); resumeAoe(g, pd.ctx); }
    else if (pd.ctx) { doTrickCore(g, pd.srcId, pd.trickKey, pd.ctx.targetId); } // 修复: targetId 在 ctx 中
    return { ok: true, countered: false };
  }
  /* 可反制锦囊的核心效果 */
  function doTrickCore(g, srcId, trickKey, targetId) {
    const p = g.players[srcId];
    const t = g.players[targetId];
    if (t.dead) return { ok: true, result: 'target-dead' };
    onBecomeTarget(g, targetId, true); // 萌新/女装: 成为锦囊目标
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
        else if (t.armor) { const ta = t.armor; unequipArmor(g, t, false); unequipArmor(g, p, true); p.armor = ta; if (ta.key === 'aRam') p.maxHp += 1; g.log.push({ t: g.round, txt: `${p.name}【抄袭代码】缴获${t.name}的防具`, cls: 'act' }); }
        else if (t.hand.length) { const idx = Math.floor(g.rnd() * t.hand.length); const rc = t.hand.splice(idx, 1)[0]; p.hand.push(rc); g.log.push({ t: g.round, txt: `${p.name}【抄袭代码】获得${t.name}一张手牌`, cls: 'act' }); }
        else g.log.push({ t: g.round, txt: `【抄袭代码】${t.name}无可缴获,落空`, cls: '' });
        return { ok: true };
      }
      case 'pierce': {
        loseHp(g, targetId, 1, p, 'pierce');
        g.log.push({ t: g.round, txt: `${p.name}【卡评测机】对${t.name}造成1点不可闪避伤害`, cls: 'act' });
        return { ok: true };
      }
      case 'o2': {
        const atkIdx = p.hand.findIndex(x => isAttackKey(x.key));
        if (atkIdx < 0) { g.log.push({ t: g.round, txt: `【O2优化】没有攻击牌,落空`, cls: '' }); return { ok: true }; }
        const ac = p.hand.splice(atkIdx, 1)[0]; g.discard.push(ac);
        g.log.push({ t: g.round, txt: `${p.name}【O2优化】对${t.name}造成2点伤害`, cls: 'act' });
        loseHp(g, targetId, 2, p, 'o2');
        return { ok: true };
      }
      case 'skipPlay': {
        t.skipPlayNext = true; // H9: 下回合开始才生效
        g.log.push({ t: g.round, txt: `${p.name}【停课集训】${t.name}下回合跳过行动阶段`, cls: 'act' });
        return { ok: true };
      }
      case 'gift': {
        draw(g, targetId, 2);
        g.log.push({ t: g.round, txt: `${p.name}【玄学优化】让${t.name}摸2张`, cls: 'act' });
        return { ok: true };
      }
      case 'funReport': {
        if (t.hand.length === 0) { g.log.push({ t: g.round, txt: `【举报】${t.name}无手牌,落空`, cls: '' }); return { ok: true }; }
        // M12: 人类选择弃哪张
        if (srcId === g.human) {
          g.pending = { type: 'report', victim: srcId, ctx: { targetId, cards: t.hand.map(c => ({ key: c.key, id: c.id, name: spec(c.key).name })) } };
          return { ok: true, result: 'pending' };
        }
        const idx = Math.floor(g.rnd() * t.hand.length);
        const rc = t.hand.splice(idx, 1)[0]; g.discard.push(rc);
        g.log.push({ t: g.round, txt: `${p.name}【举报】弃置${t.name}一张手牌`, cls: 'act' });
        return { ok: true };
      }
      case 'funArgue': {
        if (t.hand.length) { const idx = Math.floor(g.rnd() * t.hand.length); const rc = t.hand.splice(idx, 1)[0]; g.discard.push(rc); }
        g.log.push({ t: g.round, txt: `${p.name}【祖安对线】令${t.name}弃1张手牌`, cls: 'act' });
        return { ok: true };
      }
      case 'duel': {
        // M8: 双方轮流出攻击,先无者受伤
        const dmg = trickKey === 'duelEvo' ? 2 : 1;
        let cur = p, other = t, n = 0;
        while (n++ < 60) {
          const idx = cur.hand.findIndex(x => isAttackKey(x.key));
          if (idx < 0) {
            g.log.push({ t: g.round, txt: `${cur.name}【${spec(trickKey).name}】无攻击,受到${dmg}伤`, cls: 'bad' });
            loseHp(g, cur.id, dmg, p, 'duel');
            if (cur.id === t.id && trickKey === 'duel') queueEvo(g, srcId, 'duel');
            return { ok: true };
          }
          const ac = cur.hand.splice(idx, 1)[0];
          g.discard.push(ac);
          g.log.push({ t: g.round, txt: `${cur.name} 打出${spec(ac.key).name}响应对拍`, cls: '' });
          const tmp = cur; cur = other; other = tmp;
        }
        return { ok: true };
      }
      default: return { ok: false, why: '未实现: ' + trickKey };
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
  function aoeApplyOne(g, srcId, trickKey, dmg, pid) {
    const q = g.players[pid];
    const p = g.players[srcId];
    onBecomeTarget(g, pid, true); // 萌新/女装: AOE目标同样触发
    // M2: 评测机事件同样作用于AOE伤害
    let effDmg = dmg;
    if (g.eventSuit === 'spade') effDmg = Math.max(1, effDmg - 1);
    if (g.eventSuit === 'club') effDmg += 1;
    // 人类受害者: 挂起响应选择(M20)
    if (q.id === g.human && (trickKey === 'aoeAtk' || trickKey === 'aoeAtkEvo' || trickKey === 'aoeDodge' || trickKey === 'aoeDodgeEvo')) {
      g.pending = { type: 'aoeResp', victim: q.id, srcId, trickKey, dmg: effDmg };
      return 'pending';
    }
    if (trickKey === 'allHeal') {
      q.hp = Math.min(q.maxHp, q.hp + 1);
      g.log.push({ t: g.round, txt: `${q.name} 回复1点体力`, cls: 'act' });
      return;
    }
    if (trickKey === 'aoeAtk' || trickKey === 'aoeAtkEvo') {
      const idx = q.hand.findIndex(x => isAttackKey(x.key));
      if (idx >= 0) { const ac = q.hand.splice(idx, 1)[0]; g.discard.push(ac); g.log.push({ t: g.round, txt: `${q.name} 打出攻击响应`, cls: '' }); }
      else { g.log.push({ t: g.round, txt: `${q.name} 无攻击,受到${dmg}伤`, cls: 'bad' }); loseHp(g, pid, dmg, p, 'aoe'); }
    } else {
      let dodged = false;
      if (q.armor && q.armor.key === 'aXuan') { const jc = judgeCard(g); if (jc.suit === 'heart') dodged = true; }
      if (!dodged) {
        const idx = q.hand.findIndex(x => isDodgeKey(x.key));
        if (idx >= 0 && q.mp >= 1) { const dc = q.hand.splice(idx, 1)[0]; g.discard.push(dc); q.mp -= 1; dodged = true; }
      }
      if (!dodged && !(q.armor && q.armor.key === 'aFw' && g.eventSuit !== 'club')) {
        g.log.push({ t: g.round, txt: `${q.name} 未出WA,受到${dmg}伤`, cls: 'bad' });
        loseHp(g, pid, dmg, p, 'aoe');
      } else g.log.push({ t: g.round, txt: `${q.name} 出WA/防火墙,免疫`, cls: '' });
    }
  }
  function resumeAoe(g, ctx) {
    for (const id of ctx.remaining) {
      const q = g.players[id];
      if (q.dead) continue;
      const cr = tryCounter(g, id, ctx.trickKey, ctx.srcId);
      if (cr === 'pending') {
        g.pending.ctx = { type: 'aoe', trickKey: ctx.trickKey, srcId: ctx.srcId, dmg: ctx.dmg, current: id, remaining: ctx.remaining.slice(ctx.remaining.indexOf(id) + 1) };
        return;
      }
      if (cr === true) { g.log.push({ t: g.round, txt: `${q.name} 特判抵消了${spec(ctx.trickKey).name}`, cls: 'act' }); continue; }
      const r = aoeApplyOne(g, ctx.srcId, ctx.trickKey, ctx.dmg, id);
      if (r === 'pending') {
        g.pending.ctx = { type: 'aoe', trickKey: ctx.trickKey, srcId: ctx.srcId, dmg: ctx.dmg, current: id, remaining: ctx.remaining.slice(ctx.remaining.indexOf(id) + 1) };
        return;
      }
    }
  }
  /* AOE人类响应: 出攻击/出WA 或 承受伤害(M20) */
  function respondAoeResp(g, pid, yes) {
    const pd = g.pending;
    if (!pd || pd.type !== 'aoeResp') return { ok: false, why: '无挂起的AOE响应询问' };
    g.pending = null;
    const q = g.players[pid];
    const trick = pd.trickKey;
    if (trick === 'aoeAtk' || trick === 'aoeAtkEvo') {
      if (yes) {
        const idx = q.hand.findIndex(c => isAttackKey(c.key));
        if (idx < 0) return { ok: false, why: '没有攻击牌' };
        const ac = q.hand.splice(idx, 1)[0];
        g.discard.push(ac);
        g.log.push({ t: g.round, txt: `${q.name} 打出攻击响应`, cls: '' });
      } else {
        g.log.push({ t: g.round, txt: `${q.name} 无攻击,受到${pd.dmg}伤`, cls: 'bad' });
        loseHp(g, pid, pd.dmg, g.players[pd.srcId], 'aoe');
      }
    } else {
      if (yes) {
        const idx = q.hand.findIndex(c => isDodgeKey(c.key));
        if (idx < 0 || q.mp < 1) return { ok: false, why: '没有WA或灵感不足' };
        const dc = q.hand.splice(idx, 1)[0];
        g.discard.push(dc); q.mp -= 1;
        g.log.push({ t: g.round, txt: `${q.name} 打出WA响应`, cls: '' });
      } else {
        if (q.armor && q.armor.key === 'aFw' && g.eventSuit !== 'club') { g.log.push({ t: g.round, txt: `${q.name}【防火墙】免疫`, cls: '' }); }
        else { g.log.push({ t: g.round, txt: `${q.name} 未出WA,受到${pd.dmg}伤`, cls: 'bad' }); loseHp(g, pid, pd.dmg, g.players[pd.srcId], 'aoe'); }
      }
    }
    if (pd.ctx) resumeAoe(g, pd.ctx);
    return { ok: true };
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

  function playCard(g, pid, cardIdx, targetId) {
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
    if (p.prof.id === 'shenben' && !isAttackKey(c.key) && !isDodgeKey(c.key) && c.key !== 'counter' && c.key !== 'counterEvo' && isBlack(c.suit)) {
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
    if (isDodgeKey(c.key) || c.key === 'counter' || c.key === 'counterEvo') { p.hand.push(c); return { ok: false, why: '响应牌,非出牌阶段使用' }; }
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
        spend(g, p, cost); g.discard.push(c);
        if (c.key === 'funLie') p.canAttack = false;
        draw(g, pid, 2);
        g.log.push({ t: g.round, txt: `${p.name} 使用【${s.name}】摸2张`, cls: 'act' });
        return { ok: true };
      }
      case 'peek': {
        spend(g, p, cost); g.discard.push(c);
        if (g.deck.length) { const top = g.deck[g.deck.length - 1]; g.log.push({ t: g.round, txt: `${p.name}【小抄】查看牌堆顶: ${spec(top.key).name}`, cls: '' }); }
        return { ok: true };
      }
      case 'mull': {
        if (p.hand.length < 1) { p.hand.push(c); return { ok: false, why: '没有可弃的牌' }; }
        spend(g, p, cost); g.discard.push(c);
        discardFromHand(g, p, 0); draw(g, pid, 1);
        g.log.push({ t: g.round, txt: `${p.name}【复盘】弃1摸1`, cls: '' });
        return { ok: true };
      }
      case 'cheat': {
        if (p.hp >= p.maxHp) { p.hand.push(c); return { ok: false, why: '体力已满' }; }
        spend(g, p, cost); g.discard.push(c);
        p.hp = Math.min(p.maxHp, p.hp + 1);
        g.log.push({ t: g.round, txt: `${p.name}【骗分】回复1点体力`, cls: 'act' });
        return { ok: true };
      }
      case 'recover': {
        if (g.discard.length === 0) { p.hand.push(c); return { ok: false, why: '弃牌堆为空' }; }
        spend(g, p, cost);
        const got = g.discard.splice(Math.floor(g.rnd() * g.discard.length), 1)[0]; // L2: 先取再弃自身
        g.discard.push(c);
        p.hand.push(got);
        g.log.push({ t: g.round, txt: `${p.name}【申诉】从弃牌堆获得【${spec(got.key).name}】`, cls: 'act' });
        return { ok: true };
      }
      case 'gift': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        spend(g, p, cost); g.discard.push(c);
        const cr = tryCounter(g, t.id, c.key, pid);
        if (cr === 'pending') { g.pending.ctx = { srcId: pid, trickKey: c.key, targetId: t.id }; return { ok: true, result: 'pending' }; }
        if (cr === true) return { ok: true, result: 'countered' };
        return doTrickCore(g, pid, c.key, t.id);
      }
      case 'dismantle': case 'steal': case 'pierce': case 'skipPlay': case 'gift': case 'funReport': case 'funArgue': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        if (c.key === 'steal' && !t.weapon && !t.armor && t.hand.length === 0) { p.hand.push(c); return { ok: false, why: '目标无可缴获' }; }
        spend(g, p, cost); g.discard.push(c);
        const cr = tryCounter(g, t.id, c.key, pid);
        if (cr === 'pending') { g.pending.ctx = { srcId: pid, trickKey: c.key, targetId: t.id }; return { ok: true, result: 'pending' }; }
        if (cr === true) return { ok: true, result: 'countered' };
        return doTrickCore(g, pid, c.key, t.id);
      }
      case 'o2': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        if (!p.hand.some(x => isAttackKey(x.key))) { p.hand.push(c); return { ok: false, why: '需要一张做法假了' }; }
        spend(g, p, cost); g.discard.push(c);
        const cr = tryCounter(g, t.id, c.key, pid);
        if (cr === 'pending') { g.pending.ctx = { srcId: pid, trickKey: c.key, targetId: t.id }; return { ok: true, result: 'pending' }; }
        if (cr === true) return { ok: true, result: 'countered' };
        return doTrickCore(g, pid, c.key, t.id);
      }
      case 'duel': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        spend(g, p, cost); g.discard.push(c);
        const cr = tryCounter(g, t.id, c.key, pid);
        if (cr === 'pending') { g.pending.ctx = { srcId: pid, trickKey: c.key, targetId: t.id }; return { ok: true, result: 'pending' }; }
        if (cr === true) return { ok: true, result: 'countered' };
        return doTrickCore(g, pid, c.key, t.id); // duel/duelEvo 均由 doTrickCore 轮流结算
      }
      case 'skipPlay': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        spend(g, p, cost); g.discard.push(c);
        const cr = tryCounter(g, t.id, c.key, pid);
        if (cr === 'pending') { g.pending.ctx = { srcId: pid, trickKey: c.key, targetId: t.id }; return { ok: true, result: 'pending' }; }
        if (cr === true) return { ok: true, result: 'countered' };
        return doTrickCore(g, pid, c.key, t.id);
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
      case 'killUnit': {
        const target = t || g.players.find(q => !q.dead && q.units.length > 0);
        if (!target || target.units.length === 0) { p.hand.push(c); return { ok: false, why: '没有可消灭的单位' }; }
        spend(g, p, cost); g.discard.push(c);
        const u = target.units.pop();
        if (u.id !== -1) g.discard.push(u);
        g.log.push({ t: g.round, txt: `${p.name}【删库】消灭${target.name}的【${spec(u.key).name}】`, cls: 'act' });
        return { ok: true };
      }
      case 'aoeAtk': case 'aoeAtkEvo': case 'aoeDodge': case 'aoeDodgeEvo': {
        spend(g, p, cost); g.discard.push(c);
        if (c.key === 'aoeAtk') p.aoeFlag = 'aoeAtk';
        if (c.key === 'aoeDodge') p.aoeFlag = 'aoeDodge';
        const ad = (c.key === 'aoeAtkEvo' || c.key === 'aoeDodgeEvo') ? 2 : 1;
        g.log.push({ t: g.round, txt: `${p.name} 使用【${s.name}】AOE!`, cls: 'evt' });
        const targets = aoeOrder(g, pid); // L7: 从使用者下家按行动顺序
        if (!targets.length) return { ok: true };
        const cr = tryCounter(g, targets[0], c.key, pid);
        if (cr === 'pending') {
          g.pending.ctx = { type: 'aoe', trickKey: c.key, srcId: pid, dmg: ad, current: targets[0], remaining: targets.slice(1) };
          return { ok: true, result: 'pending' };
        }
        if (cr === true) g.log.push({ t: g.round, txt: `${g.players[targets[0]].name} 特判抵消了${s.name}`, cls: 'act' });
        else {
          const r0 = aoeApplyOne(g, pid, c.key, ad, targets[0]);
          if (r0 === 'pending') {
            g.pending.ctx = { type: 'aoe', trickKey: c.key, srcId: pid, dmg: ad, current: targets[0], remaining: targets.slice(1) };
            return { ok: true, result: 'pending' };
          }
        }
        resumeAoe(g, { type: 'aoe', trickKey: c.key, srcId: pid, dmg: ad, remaining: targets.slice(1) });
        return { ok: true, result: 'done' };
      }
      case 'allHeal': {
        spend(g, p, cost); g.discard.push(c);
        g.log.push({ t: g.round, txt: `${p.name} 使用【CCF放水】全员回复1体力`, cls: 'evt' });
        const targets = aoeOrder(g, pid); // L7: 从使用者下家按行动顺序
        p.hp = Math.min(p.maxHp, p.hp + 1); // 使用者本人先回复
        if (!targets.length) return { ok: true };
        const cr = tryCounter(g, targets[0], c.key, pid);
        if (cr === 'pending') {
          g.pending.ctx = { type: 'aoe', trickKey: c.key, srcId: pid, dmg: 1, current: targets[0], remaining: targets.slice(1) };
          return { ok: true, result: 'pending' };
        }
        if (cr === true) g.log.push({ t: g.round, txt: `${g.players[targets[0]].name} 特判抵消了CCF放水`, cls: 'act' });
        else aoeApplyOne(g, pid, c.key, 1, targets[0]);
        resumeAoe(g, { type: 'aoe', trickKey: c.key, srcId: pid, dmg: 1, remaining: targets.slice(1) });
        return { ok: true, result: 'done' };
      }
      case 'harvest': {
        spend(g, p, cost); g.discard.push(c);
        const alive = g.players.filter(q => !q.dead);
        const n = Math.min(alive.length, g.deck.length);
        if (n === 0) { g.log.push({ t: g.round, txt: `【题解大会】无牌可翻`, cls: '' }); return { ok: true }; }
        const cards = g.deck.splice(g.deck.length - n, n).reverse(); // 亮出n张
        g.log.push({ t: g.round, txt: `【题解大会】翻开${n}张牌: ${cards.map(c => spec(c.key).name).join('、')}`, cls: 'evt' });
        // 行动顺序从使用者下家开始
        const order = [];
        let cur = nextAlive(g, pid);
        for (let i = 0; i < alive.length && cur !== -1; i++) { order.push(cur); cur = nextAlive(g, cur); }
        const ctx = { type: 'harvest', srcId: pid, cards, order, pos: 0 };
        harvestStep(g, ctx);
        return { ok: true, result: g.pending ? 'pending' : 'done' };
      }
      case 'funGiveup': {
        spend(g, p, cost); g.discard.push(c);
        const n = p.hand.length;
        while (p.hand.length) g.discard.push(p.hand.pop());
        draw(g, pid, 3);
        g.log.push({ t: g.round, txt: `${p.name}【摆烂宣言】弃${n}张摸3张!`, cls: 'act' });
        return { ok: true };
      }
      case 'funReport': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        spend(g, p, cost); g.discard.push(c);
        const cr = tryCounter(g, t.id, c.key, pid);
        if (cr === 'pending') { g.pending.ctx = { srcId: pid, trickKey: c.key, targetId: t.id }; return { ok: true, result: 'pending' }; }
        if (cr === true) return { ok: true, result: 'countered' };
        return doTrickCore(g, pid, c.key, t.id);
      }
      case 'funArgue': {
        if (!t || t.dead) { p.hand.push(c); return { ok: false, why: '需要目标' }; }
        spend(g, p, cost); g.discard.push(c);
        const cr = tryCounter(g, t.id, c.key, pid);
        if (cr === 'pending') { g.pending.ctx = { srcId: pid, trickKey: c.key, targetId: t.id }; return { ok: true, result: 'pending' }; }
        if (cr === true) return { ok: true, result: 'countered' };
        return doTrickCore(g, pid, c.key, t.id);
      }
      case 'funCcf': {
        spend(g, p, cost); g.discard.push(c);
        for (const q of g.players) if (!q.dead) q.hp = Math.min(q.maxHp, q.hp + 1);
        g.ccfRound = g.round; // M13: 下一轮全体攻击费+1
        g.log.push({ t: g.round, txt: `${p.name}【感谢CCF】全员回1,下一轮全体攻击费+1`, cls: 'evt' });
        return { ok: true };
      }
      case 'funClone': {
        if (g.usedClone) { p.hand.push(c); return { ok: false, why: '一局一次' }; } // M11
        if (p.units.length === 0) { p.hand.push(c); return { ok: false, why: '场上没有单位' }; }
        spend(g, p, cost); g.discard.push(c);
        const u = p.units[0];
        p.units.push({ key: u.key, id: -1 });
        g.usedClone = true;
        g.log.push({ t: g.round, txt: `${p.name}【开小号】复制了【${spec(u.key).name}】`, cls: 'act' });
        return { ok: true };
      }
      case 'funPower': {
        spend(g, p, cost); g.discard.push(c);
        let n = 0;
        for (const q of g.players) {
          if (n >= 2) break;
          if (q.units.length) { const u = q.units.pop(); if (u.id !== -1) g.discard.push(u); n++; g.log.push({ t: g.round, txt: `【机房断电】${q.name}的【${spec(u.key).name}】被消灭`, cls: 'act' }); }
        }
        if (n === 0) g.log.push({ t: g.round, txt: `【机房断电】场上没有单位`, cls: '' });
        return { ok: true };
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
      unequipArmor(g, p, true); // M18: 换装不触发离场效果; L14: 内存加固回退
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
  function publicView(g, pid) {
    const p = g.players[pid];
    return {
      over: g.over, winner: g.winner, round: g.round, turn: g.turn,
      event: g.event, eventSuit: g.eventSuit,
      deck: g.deck.length, discard: g.discard.length,
      pending: g.pending ? { type: g.pending.type, target: g.pending.target, attacker: g.pending.attacker, victim: g.pending.victim, trickKey: g.pending.trickKey, helpers: g.pending.helpers || null, ctx: g.pending.ctx || null } : null,
      achievements: g.achievements || null,
      lordCanRedraw: lordCanRedraw(g),
      evoWait: g.evoWait ? { pid: g.evoWait.pid, keys: g.evoWait.keys.map(k => ({ base: k, evo: EVO_MAP[k], name: EVO_MAP[k] ? spec(EVO_MAP[k]).name : k })) } : null,
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
        id: q.id, name: q.name, identity: q.dead ? (q.identity === 'traitor' ? null : IDENTITIES[q.identity].name) : null, // M23/H10: 内奸身份永不公开
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
      const atkIdx = p.hand.findIndex(c => isAttackKey(c.key));
      if (atkIdx >= 0 && p.canAttack && p.mp >= effectiveCost(g, p, p.hand[atkIdx].key)) {
        const enemies = g.players.filter(q => !q.dead && q.id !== pid);
        if (enemies.length) {
          if (p.weapon && p.weapon.key === 'wFang' && p.hand.length === 1) {
            const n = Math.min(3, enemies.length);
            const tids = enemies.slice(0, n).map(q => q.id);
            const r = fangAttack(g, pid, tids, atkIdx);
            if (r.ok) { acted = true; if (g.pending) break; continue; }
          } else {
            const t = g.players[pickTarget(g, pid, enemies)];
            const r = playCard(g, pid, atkIdx, t.id);
            if (r.ok) { acted = true; if (g.pending) break; continue; }
          }
        }
      }
      // 2b. 手写快排: 无攻击牌时弃2张手牌当攻击
      if (p.weapon && p.weapon.key === 'wKsp' && p.canAttack && p.hand.length >= 2 && !p.hand.some(c => isAttackKey(c.key)) && p.mp >= effectiveCost(g, p, 'attack')) {
        const enemies = g.players.filter(q => !q.dead && q.id !== pid);
        if (enemies.length) {
          const t = enemies[Math.floor(g.rnd() * enemies.length)];
          const r = kspAttack(g, pid, t.id);
          if (r.ok) { acted = true; if (g.pending) break; continue; }
        }
      }
      // 2c. 神犇碾压: 无攻击牌时用黑色手牌当攻击
      if (p.prof.id === 'shenben' && p.canAttack && p.mp >= effectiveCost(g, p, 'attack')) {
        const blackIdx = p.hand.findIndex(c => !isAttackKey(c.key) && !isDodgeKey(c.key) && c.key !== 'counter' && c.key !== 'counterEvo' && isBlack(c.suit));
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
        let target = null;
        const needs = ['dismantle', 'steal', 'pierce', 'o2', 'duel', 'skipPlay', 'delaySkipPlay', 'delaySkipDraw', 'gift', 'funReport', 'funArgue'];
        if (needs.includes(k)) {
          const enemies = g.players.filter(q => !q.dead && q.id !== pid);
          if (enemies.length) target = enemies[Math.floor(g.rnd() * enemies.length)].id;
          else target = null;
        }
        if (needs.includes(k) && target === null) { acted = false; break; }
        const r = playCard(g, pid, trickIdx, target);
        if (r.ok) { acted = true; if (g.pending) break; continue; }
        if (!r.ok && k === 'o2' && !p.hand.some(x => x.key === 'attack')) { break; }
      }
      // 6. 单位攻击: 就绪单位消灭敌人单位(H6)
      const readyUnit = p.units.findIndex(u => u.ready);
      if (readyUnit >= 0) {
        const victim = g.players.find(q => !q.dead && q.id !== pid && q.units.length > 0);
        if (victim) { const r = unitAttack(g, pid, readyUnit, victim.id); if (r.ok) { acted = true; continue; } }
      }
      // 7. 职业技能(简化AI)(H1)
      if (aiSkill(g, pid)) { acted = true; continue; }
    }
    if (!g.over) { discardPhase(g, pid); endTurn(g, pid); }
  }

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
      case 'shenben': if (p.hand.length >= 2 && p.hand.some(c => isAttackKey(c.key))) return trySkill('akioi'); return false;
      case 'duliu': if (p.hand.length >= 1 && p.hand.some(c => isAttackKey(c.key)) && p.mp >= effectiveCost(g, p, 'attack')) return trySkill('kachang'); return false;
      case 'nvzhuang': if (p.hand.some(c => isRed(c.suit)) && enemies.some(q => q.hand.length > 0)) return trySkill('live', et()); return false;
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

  function respondDodge(g, pid, yes, helperId) {
    if (!g.pending || g.pending.type !== 'dodge') return { ok: false, why: '无挂起的WA询问' };
    const pd = g.pending;
    g.pending = null;
    const atk = g.players[pd.attacker], tgt = g.players[pd.target];
    let r;
    if (helperId !== undefined && helperId !== null) {
      // 主公技护驾: 代出WA
      const h = g.players[helperId];
      if (!h || h.dead || !canDodge(g, h)) return { ok: false, why: '该玩家无法代出WA' };
      r = helperDodge(g, h, atk, tgt);
    } else {
      r = resolveDodge(g, tgt, yes, pd.dmg, pd.suit, atk);
    }
    // 放手一搏: 继续攻击剩余目标
    if (pd.multi && pd.multi.length) resumeMultiAttack(g, { attacker: pd.attacker, suit: pd.suit, isEvo: pd.isEvo }, pd.multi);
    return { ok: true, result: r };
  }

  function helperDodge(g, helper, attacker, lord) {
    const idx = helper.hand.findIndex(c => isDodgeKey(c.key));
    if (idx >= 0 && helper.mp >= 1) {
      const c = helper.hand.splice(idx, 1)[0];
      g.discard.push(c); helper.mp -= 1;
      g.log.push({ t: g.round, txt: `${helper.name} 打出【${spec(c.key).name}】替${lord.name}抵挡(护驾)`, cls: 'act' });
      if (c.key === 'dodge') queueEvo(g, helper.id, 'dodge');
      return afterDodge(g, attacker, lord, c, false);
    }
    if (helper.armor && helper.armor.key === 'aDsu' && helper.hand.length >= 1) {
      discardFromHand(g, helper, 0);
      g.log.push({ t: g.round, txt: `${helper.name}【并查集】弃1手牌替${lord.name}抵挡(护驾)`, cls: 'act' });
      return afterDodge(g, attacker, lord, null, true);
    }
    return 'dodged';
  }

  /* 萌新问问题/女装大佬·女装: 成为目标时摸1(每回合限1次) */
  function onBecomeTarget(g, pid, isTrick) {
    const p = g.players[pid];
    if (p.dead) return;
    if (p.prof.id === 'mengxin' && !p.askedThisTurn) { p.askedThisTurn = true; draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name}【问问题】成为目标摸1`, cls: '' }); }
    if (p.prof.id === 'nvzhuang' && isTrick && !p.skirtThisTurn) { p.skirtThisTurn = true; draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name}【女装】成为锦囊目标摸1`, cls: '' }); }
  }

  function resumeMultiAttack(g, pd, targets) {
    const atk = g.players[pd.attacker];
    for (const tid of targets) {
      const t = g.players[tid];
      if (!t || t.dead) continue;
      g.askDodge = (tid === g.human);
      const r = attackPlayer(g, atk, t, { suit: pd.suit, isEvo: pd.isEvo });
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

  /* 卖队友响应: 被攻击者把攻击转给 targetId */
  function respondBetray(g, pid, targetId) {
    const pd = g.pending;
    if (!pd || pd.type !== 'dodge') return { ok: false, why: '无挂起的攻击询问' };
    g.pending = null;
    const v = g.players[pid];
    const bi = v.hand.findIndex(c => c.key === 'funBetray');
    if (bi < 0 || g.usedBetray) return { ok: false, why: '无卖队友或本局已用过' };
    const bc = v.hand.splice(bi, 1)[0];
    g.discard.push(bc); g.usedBetray = true;
    const nt = g.players[targetId];
    if (!nt || nt.dead) return { ok: false, why: '目标无效' };
    g.log.push({ t: g.round, txt: `${v.name}【卖队友】把攻击转给了${nt.name}!`, cls: 'act' });
    attackPlayer(g, g.players[pd.attacker], nt, { suit: pd.suit, isEvo: pd.isEvo, allowBetray: false, noDodge: false });
    return { ok: true, result: 'redirected' };
  }

  /* 欢乐牌弃置保底轨(18.2): 出牌阶段弃置欢乐牌触发保底, 不花灵感 */
  function discardFun(g, pid, cardIdx, targetId) {
    const p = g.players[pid];
    if (g.turn !== pid || p.dead || p.skipPlay) return { ok: false, why: '非行动阶段' };
    if (g.pending) return { ok: false, why: '等待响应中' };
    const c = p.hand[cardIdx];
    if (!c || !spec(c.key).fun) return { ok: false, why: '非欢乐牌' };
    p.hand.splice(cardIdx, 1);
    g.discard.push(c);
    switch (c.key) {
      case 'funBetray': p.funShield = true; g.log.push({ t: g.round, txt: `${p.name} 弃置【卖队友】:本回合首次受伤-1`, cls: 'act' }); break;
      case 'funLie': p.mp = Math.min(p.mpMax, p.mp + 1); g.log.push({ t: g.round, txt: `${p.name} 弃置【躺赢】:回复1灵感`, cls: 'act' }); break;
      case 'funReport': {
        const enemies = g.players.filter(q => !q.dead && q.id !== pid && q.hand.length > 0);
        if (enemies.length) { const q = enemies[Math.floor(g.rnd() * enemies.length)]; const rc = q.hand[Math.floor(g.rnd() * q.hand.length)]; g.log.push({ t: g.round, txt: `${p.name} 弃置【举报】:偷看${q.name}一张手牌【${spec(rc.key).name}】`, cls: '' }); }
        else g.log.push({ t: g.round, txt: `${p.name} 弃置【举报】:无人可看`, cls: '' });
        break;
      }
      case 'funClone': draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name} 弃置【开小号】:摸1`, cls: 'act' }); break;
      case 'funGiveup': draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name} 弃置【摆烂宣言】:摸1`, cls: 'act' }); break;
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

  /* L14: 卸下防具(含内存加固回退) */
  function unequipArmor(g, p, toDiscard) {
    const a = p.armor;
    if (!a) return;
    if (toDiscard && a.id !== -1) g.discard.push(a);
    if (a.key === 'aRam') {
      p.maxHp = Math.max(p.prof.hp + (p.identity === 'lord' ? 2 : 0), p.maxHp - 1);
      if (p.hp > p.maxHp) p.hp = p.maxHp;
    }
    p.armor = null;
  }

  /* 单位死亡: 亡语结算 */
  function unitDie(g, ownerPid, unitObj, reason) {
    if (unitObj.id !== -1) g.discard.push(unitObj);
    if (spec(unitObj.key).death) {
      draw(g, ownerPid, 1);
      g.log.push({ t: g.round, txt: `${g.players[ownerPid].name} 的【${spec(unitObj.key).name}】亡语:摸1`, cls: 'act' });
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
    g.log.push({ t: g.round, txt: `${p.name} 的【${spec(u.key).name}】消灭了${v.name}的【${spec(vu.key).name}】`, cls: 'act' });
    unitDie(g, v.id, vu, 'unit-attack');
    return { ok: true };
  }

  /* 职业技能(H1) */
  function skillUse(g, pid, name, targetId) {
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
        discardFromHand(g, p, 0); discardFromHand(g, p, 0);
        p.akioiDmg = 1;
        g.log.push({ t: g.round, txt: `${p.name}【AKIOI】弃2手牌,本回合攻击伤害+1`, cls: 'act' });
        break;
      }
      case 'kachang': { // 毒瘤: 弃1,本次攻击不可被WA
        if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
        discardFromHand(g, p, 0);
        p.kachangFlag = true;
        g.log.push({ t: g.round, txt: `${p.name}【祖传卡常】弃1,下一次攻击不可被WA`, cls: 'act' });
        break;
      }
      case 'live': { // 女装: 弃1红牌,看目标手牌拿1
        const ri = p.hand.findIndex(c => isRed(c.suit));
        if (ri < 0) { ok = false; why = '需要1张红色手牌'; break; }
        discardFromHand(g, p, ri);
        if (t.hand.length > 0) { const idx = Math.floor(g.rnd() * t.hand.length); const rc = t.hand.splice(idx, 1)[0]; p.hand.push(rc); g.log.push({ t: g.round, txt: `${p.name}【直播】观看${t.name}手牌并拿走【${spec(rc.key).name}】`, cls: 'act' }); }
        else g.log.push({ t: g.round, txt: `${p.name}【直播】观看${t.name}手牌:无牌`, cls: '' });
        break;
      }
      case 'rejudge': { // 评测姬: 弃1摸1再弃1
        if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
        discardFromHand(g, p, 0); draw(g, pid, 1);
        if (p.hand.length) discardFromHand(g, p, 0);
        g.log.push({ t: g.round, txt: `${p.name}【重测】弃1摸1再弃1`, cls: 'act' });
        break;
      }
      case 'seal': { // 传奇: 限定,展示手牌,至多2目标各1伤(简化单目标)
        if (p.usedSeal) { ok = false; why = '限定技,一局一次'; break; }
        p.usedSeal = true;
        g.log.push({ t: g.round, txt: `${p.name}【封神】展示手牌: ${p.hand.map(c => spec(c.key).name).join('、') || '无'}`, cls: 'act' });
        loseHp(g, t.id, 1, p, 'seal');
        break;
      }
      case 'teach': { // 学长: 弃1,让目标摸1
        if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
        discardFromHand(g, p, 0);
        draw(g, t.id, 1);
        if (p.awaken) { draw(g, pid, 1); g.log.push({ t: g.round, txt: `${p.name}【讲题】让${t.name}摸1,觉醒同摸1`, cls: 'act' }); }
        else g.log.push({ t: g.round, txt: `${p.name}【讲题】让${t.name}摸1`, cls: 'act' });
        break;
      }
      case 'dabiao': { // 打表: 弃2摸4
        if (p.hand.length < 2) { ok = false; why = '需要2张手牌'; break; }
        discardFromHand(g, p, 0); discardFromHand(g, p, 0);
        draw(g, pid, 4);
        g.log.push({ t: g.round, txt: `${p.name}【打表】弃2摸4`, cls: 'act' });
        break;
      }
      case 'kouhai': { // 键盘侠: 弃1,目标弃1手牌
        if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
        discardFromHand(g, p, 0);
        if (t.hand.length > 0) { const idx = Math.floor(g.rnd() * t.hand.length); const rc = t.hand.splice(idx, 1)[0]; g.discard.push(rc); }
        g.log.push({ t: g.round, txt: `${p.name}【口嗨】令${t.name}弃1手牌`, cls: 'act' });
        break;
      }
      case 'chao': { // 抄题解: 弃1,看牌堆顶3取1
        if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
        discardFromHand(g, p, 0);
        if (g.deck.length >= 1) {
          const n = Math.min(3, g.deck.length);
          const top = g.deck.slice(-n).reverse();
          const got = top[0];
          g.deck.splice(g.deck.length - n, n);
          for (const c of top.slice(1)) g.deck.push(c);
          p.hand.push(got);
          g.log.push({ t: g.round, txt: `${p.name}【抄题解】看牌堆顶${n}张取【${spec(got.key).name}】`, cls: 'act' });
        }
        break;
      }
      case 'shuiqun': { // 水群怪: 弃1摸2弃1
        if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
        discardFromHand(g, p, 0); draw(g, pid, 2);
        if (p.hand.length) discardFromHand(g, p, 0);
        g.log.push({ t: g.round, txt: `${p.name}【水群】弃1摸2弃1`, cls: 'act' });
        break;
      }
      case 'baoling': { // 爆零: 弃1,目标弃1或受1伤
        if (p.hand.length < 1) { ok = false; why = '需要1张手牌'; break; }
        discardFromHand(g, p, 0);
        if (t.hand.length > 0 && g.rnd() < 0.5) { const idx = Math.floor(g.rnd() * t.hand.length); const rc = t.hand.splice(idx, 1)[0]; g.discard.push(rc); g.log.push({ t: g.round, txt: `${p.name}【爆零】令${t.name}弃1手牌`, cls: 'act' }); }
        else { const d = 1 + p.baolingBonus; loseHp(g, t.id, d, p, 'baoling'); g.log.push({ t: g.round, txt: `${p.name}【爆零】令${t.name}受${d}伤`, cls: 'act' }); }
        break;
      }
      case 'dianji': { // 图灵: 限定,手牌上限+2并觉醒
        if (p.usedDianji) { ok = false; why = '限定技,一局一次'; break; }
        p.usedDianji = true;
        p.awaken = true;
        draw(g, pid, 2);
        g.log.push({ t: g.round, txt: `${p.name}【奠基】手牌上限+2,觉醒【图灵机】摸2`, cls: 'evt' });
        break;
      }
      default: return { ok: false, why: '未知技能: ' + name };
    }
    if (ok) p.usedSkillsThisTurn[name] = true;
    return ok ? { ok: true } : { ok: false, why };
  }
  function kspAttack(g, pid, targetId) {
    const p = g.players[pid];
    if (g.turn !== pid || p.dead || p.skipPlay) return { ok: false, why: '非行动阶段' };
    if (g.pending) return { ok: false, why: '等待响应中' };
    if (!p.weapon || p.weapon.key !== 'wKsp') return { ok: false, why: '未装备【手写快排】' };
    const t = g.players[targetId];
    if (!t || t.dead || t.id === pid) return { ok: false, why: '目标无效' };
    if (p.hand.length < 2) return { ok: false, why: '需要至少2张手牌' };
    const cost = effectiveCost(g, p, 'attack');
    if (p.mp < cost) return { ok: false, why: '灵感不足' };
    if (!p.canAttack) return { ok: false, why: '本回合不能攻击' };
    p.mp -= cost;
    const c1 = p.hand.splice(0, 1)[0];
    const c2 = p.hand.splice(0, 1)[0];
    g.discard.push(c1); g.discard.push(c2);
    g.log.push({ t: g.round, txt: `${p.name}【手写快排】弃2张手牌当作做法假了攻击${t.name}`, cls: 'act' });
    g.askDodge = (targetId === g.human);
    const r = attackPlayer(g, p, t, { suit: c1.suit, isEvo: false });
    if (r === 'pending') { g.pending.pid = pid; g.pending.suit = c1.suit; g.pending.isEvo = false; }
    return { ok: true, result: r };
  }

  /* 放手一搏: 最后1张手牌时攻击至多3目标 */
  function fangAttack(g, pid, targetIds, cardIdx) {
    const p = g.players[pid];
    if (g.turn !== pid || p.dead || p.skipPlay) return { ok: false, why: '非行动阶段' };
    if (g.pending) return { ok: false, why: '等待响应中' };
    if (!p.weapon || p.weapon.key !== 'wFang') return { ok: false, why: '未装备【放手一搏】' };
    const c = p.hand[cardIdx];
    if (!c || !isAttackKey(c.key)) return { ok: false, why: '非攻击牌' };
    if (p.hand.length !== 1) return { ok: false, why: '必须是最后1张手牌' };
    if (!targetIds || targetIds.length < 1 || targetIds.length > 3) return { ok: false, why: '目标数须为1~3' };
    const cost = effectiveCost(g, p, c.key);
    if (p.mp < cost) return { ok: false, why: '灵感不足' };
    if (!p.canAttack) return { ok: false, why: '本回合不能攻击' };
    p.hand.splice(cardIdx, 1);
    p.mp -= cost;
    g.discard.push(c);
    g.log.push({ t: g.round, txt: `${p.name}【放手一搏】对${targetIds.length}个目标使用攻击!`, cls: 'evt' });
    resumeMultiAttack(g, { attacker: pid, suit: c.suit, isEvo: c.key === 'attackEvo' }, targetIds);
    return { ok: true, result: 'multi' };
  }

  /* 题解大会: 按行动顺序轮流选牌(9.2) */
  function harvestStep(g, ctx) {
    while (ctx.pos < ctx.order.length) {
      const pid = ctx.order[ctx.pos];
      const p = g.players[pid];
      if (p.dead || ctx.cards.length === 0) { ctx.pos++; continue; }
      if (pid === g.human) {
        g.pending = { type: 'harvest', victim: pid, ctx };
        return;
      }
      const got = ctx.cards.shift();
      p.hand.push(got);
      g.log.push({ t: g.round, txt: `${p.name} 选走【${spec(got.key).name}】`, cls: '' });
      ctx.pos++;
    }
    for (const c of ctx.cards) g.discard.push(c);
    ctx.cards.length = 0;
  }
  function respondHarvest(g, pid, choiceKey) {
    const pd = g.pending;
    if (!pd || pd.type !== 'harvest') return { ok: false, why: '无挂起的题解大会选择' };
    g.pending = null;
    const ctx = pd.ctx;
    const p = g.players[pid];
    if (choiceKey != null) {
      const idx = ctx.cards.findIndex(c => c.key === choiceKey);
      if (idx >= 0) { const got = ctx.cards.splice(idx, 1)[0]; p.hand.push(got); g.log.push({ t: g.round, txt: `${p.name} 选走【${spec(got.key).name}】`, cls: '' }); }
    }
    ctx.pos++;
    harvestStep(g, ctx);
    return { ok: true };
  }

  /* 举报选牌(M12) */
  function respondReport(g, pid, cardKey) {
    const pd = g.pending;
    if (!pd || pd.type !== 'report') return { ok: false, why: '无挂起的举报选择' };
    g.pending = null;
    const t = g.players[pd.ctx.targetId];
    const idx = t.hand.findIndex(c => c.key === cardKey);
    if (idx < 0) return { ok: false, why: '无效选择' };
    const rc = t.hand.splice(idx, 1)[0];
    g.discard.push(rc);
    g.log.push({ t: g.round, txt: `${g.players[pid].name}【举报】弃置${t.name}的【${spec(rc.key).name}】`, cls: 'act' });
    return { ok: true };
  }

  /* 离场即投降(M22): 手牌与永久物弃置、视为死亡、身份公开(含内奸) */
  function playerLeave(g, pid) {
    const p = g.players[pid];
    if (p.dead || g.over) return { ok: false, why: '已阵亡或游戏已结束' };
    g.log.push({ t: g.round, txt: `${p.name} 离场投降!身份公开: ${IDENTITIES[p.identity].name}`, cls: 'bad' });
    kill(g, pid, null);
    return { ok: true };
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

  /* 各职业可用主动技 */
  const SKILLS = {
    shenben: ['akioi'], duliu: ['kachang'], nvzhuang: ['live'], pingce: ['rejudge'],
    chuangqi: ['seal'], xuezhang: ['teach'], dabiao: ['dabiao'], jianpan: ['kouhai'],
    chaoti: ['chao'], shuiqun: ['shuiqun'], baoling: ['baoling'], tuling: ['dianji'],
  };

  /* AI 攻击目标选择: 反贼优先集火主公(公开身份) */
  function pickTarget(g, pid, enemies) {
    const p = g.players[pid];
    if (p.identity === 'rebel') {
      const lord = g.players.find(q => q.identity === 'lord' && !q.dead);
      if (lord) return lord.id;
    }
    return enemies[Math.floor(g.rnd() * enemies.length)].id;
  }

  /* ---------------- 导出 ---------------- */
  const api = {
    CARDS, DECK_COUNT, PROFESSIONS, DOMAINS, IDENTITIES, ID_TABLE, EVENTS, EVO_MAP, SKILLS,
    createGame, setup, startTurn, judgePhase, drawPhase, discardPhase, endTurn,
    playCard, equipCard, deployUnit, publicView, aiTurn, respondDodge, respondCounter,
    respondBetray, respondCold, respondBbst, respondChase, respondHarvest, respondGuard, respondAoeResp, discardCards, respondReport, playerLeave,
    discardFun, kspAttack, fangAttack, evolvePick, tryEvolve,
    unitAttack, skillUse, lordCanRedraw, lordRedraw,
    nextAlive, draw, spec, effectiveCost, attackPlayer, loseHp, checkVictory,
    suitZh, isBlack, isRed, isAttackKey, isDodgeKey,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.OIKill = api;
})(typeof window !== 'undefined' ? window : globalThis);
