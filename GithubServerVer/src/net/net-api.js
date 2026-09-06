/*!
 * net-api.js — 《OI杀》v4 网络协议「动作面 / 事件面 / 挂起提示面」接口规格
 *
 * 本文件是未来多人协议的接口规格（对应 recon-01 3.3 / recon-02 B.3）。
 * 它【不依赖】任何引擎模块：可以在引擎拆分落地之前被 node --check 单独解析。
 * 运行时由服务器调用 buildApi(engine)，把 ACTIONS 逐项映射到引擎真实函数并校验缺失。
 *
 * 内容：
 *   ACTIONS        — 客户端/AI → 服务器可调用的全部公开玩家动作（24 项）
 *   EVENTS         — 服务器 → 客户端广播通道的语义事件种类（22 项）
 *   PENDING_TYPES  — 服务器 → 客户端挂起提示类型（12 项，含 fixlog-1a/1b 新增变体）
 *   buildApi       — 惰性构建 { fnByName } 动作函数映射（缺失即抛错）
 *
 * 引擎函数名与参数顺序均以 game.js（拆分基线）实际代码为准，行号引用为当前基线行号。
 */
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};

  /* ============================================================
   * 一、动作面：客户端/AI → 服务器可调用动作
   * 每项: { kind, fn, args, desc, line, note? }
   *   kind : 协议消息里的动作名（= 引擎函数名）
   *   fn   : game.js 中的引擎函数名（导出键之一）
   *   args : 客户端提交的参数顺序（不含 g；g 由服务器持有并注入）
   *   line : game.js 基线中的函数定义行号
   * ============================================================ */
  const ACTIONS = [
    {
      kind: 'playCard', fn: 'playCard',
      args: ['pid', 'cardIdx', 'targetId', 'targetId2?'],
      desc: '出牌：基本牌 / 常规锦囊 / 欢乐牌统一入口（攻击、治疗、延时、AOE、题解大会等）',
      line: 1652,
      note: 'recon-01 记作 4 参；实际为 5 参——第 5 参 targetId2 仅【祖安对线 funArgue】需要第二名目标（L1898），其余牌忽略',
    },
    {
      kind: 'equipCard', fn: 'equipCard',
      args: ['pid', 'cardIdx'],
      desc: '装备牌入槽：武器 / 防具（换装走 unequipArmor，含内存加固回退、AC保护等铁律）',
      line: 1946,
    },
    {
      kind: 'deployUnit', fn: 'deployUnit',
      args: ['pid', 'cardIdx'],
      desc: '部署单位牌（速攻 blitz 部署当回合可用，其余下回合就绪；领域亲和消耗）',
      line: 1968,
    },
    {
      kind: 'unitAttack', fn: 'unitAttack',
      args: ['pid', 'unitIdx', 'victimPid'],
      desc: '单位攻击：一击必杀制，随机消灭目标一个单位并触发亡语',
      line: 2374,
    },
    {
      kind: 'skillUse', fn: 'skillUse',
      args: ['pid', 'name', 'targetId', 'targetId2?'],
      desc: '职业技能（12 职业主动技；name ∈ SKILLS 表）',
      line: 2390,
      note: 'recon-01 记作 4 参；实际为 5 参——第 5 参 targetId2 供觉醒【口嗨 kouhai】第二目标使用（L2389/L2466），其余技能忽略',
    },
    {
      kind: 'endTurn', fn: 'endTurn',
      args: ['pid'],
      desc: '结束回合：回合结束技能 → 进化收集 → 轮转/事件牌',
      line: 457,
      note: '服务器在调用前应先内部跑 discardPhase（弃至手牌上限），recon-01 3.3 同',
    },
    {
      kind: 'discardFun', fn: 'discardFun',
      args: ['pid', 'cardIdx', 'targetId?'],
      desc: '欢乐牌「弃置保底」轨：不花灵感，按牌触发保底（卖队友护盾/回灵感/摸1等）',
      line: 2313,
      note: 'targetId 仅弃置【祖安对线 funArgue】保底时使用（L2334），其余牌忽略',
    },
    {
      kind: 'kspAttack', fn: 'kspAttack',
      args: ['pid', 'targetId'],
      desc: '手写快排：弃 2 张手牌当作【做法假了】攻击目标',
      line: 2517,
    },
    {
      kind: 'fangAttack', fn: 'fangAttack',
      args: ['pid', 'targetIds', 'cardIdx'],
      desc: '放手一搏：最后 1 张手牌时用攻击牌攻击至多 3 个目标',
      line: 2540,
    },
    {
      kind: 'lordRedraw', fn: 'lordRedraw',
      args: [],
      desc: '主公手牌事故重洗：首轮起手 4 张全 ≥3 费时重洗一次',
      line: 2627,
      note: '无 pid 参数（引擎自行定位主公）；多人化后服务器必须校验调用者是主公，可先用 lordCanRedraw(g) 判定',
    },
    {
      kind: 'discardCards', fn: 'discardCards',
      args: ['pid', 'indices'],
      desc: '弃牌阶段自选弃牌（indices 为手牌下标数组，引擎倒序剔除）',
      line: 1627,
    },
    {
      kind: 'playerLeave', fn: 'playerLeave',
      args: ['pid'],
      desc: '离场即投降：永久物弃置、视为死亡、身份公开（含内奸；断线超时也走此函数）',
      line: 2612,
    },
    {
      kind: 'evolvePick', fn: 'evolvePick',
      args: ['pid', 'key'],
      desc: '进化选择：清除 evoWait 后按 key 执行 tryEvolve',
      line: 836,
    },
    {
      kind: 'lordCanRedraw', fn: 'lordCanRedraw',
      args: [],
      desc: '查询：主公当前是否满足重洗条件（返回布尔，非动作）',
      line: 2622,
    },
    {
      kind: 'respondDodge', fn: 'respondDodge',
      args: ['pid', 'yes', 'helperId?'],
      desc: 'WA 响应：出闪/不出闪；helperId 供主公技【护驾】指定帮手；亦作答卖队友同意询问（betrayConsent）',
      line: 2177,
    },
    {
      kind: 'respondCounter', fn: 'respondCounter',
      args: ['pid', 'yes'],
      desc: '特判响应：出特判抵消锦囊 / 放弃；亦处理连锁反制 counterChain',
      line: 1254,
    },
    {
      kind: 'respondBetray', fn: 'respondBetray',
      args: ['pid', 'targetId'],
      desc: '卖队友响应：被攻击者把攻击转嫁给 targetId（需新目标同意，人类新目标会再挂 betrayConsent 询问）',
      line: 2282,
      note: '引擎无独立 pending.type==="betray"：作用于 type==="dodge" 且 ctx.betrayAvail 的询问',
    },
    {
      kind: 'respondCold', fn: 'respondCold',
      args: ['pid', 'yes'],
      desc: '冷数据响应：yes=改为弃置目标 2 张牌，no=照常命中',
      line: 1039,
    },
    {
      kind: 'respondBbst', fn: 'respondBbst',
      args: ['pid', 'yes'],
      desc: '平衡树响应：yes=弃 1 张强制命中，no=闪避',
      line: 1047,
    },
    {
      kind: 'respondChase', fn: 'respondChase',
      args: ['pid', 'yes'],
      desc: '不死心响应：yes=再出一张攻击牌追击，no=放弃',
      line: 1060,
    },
    {
      kind: 'respondHarvest', fn: 'respondHarvest',
      args: ['pid', 'choiceKey'],
      desc: '题解大会选牌：从亮出的牌中选走 1 张（choiceKey 为卡牌 key）',
      line: 2582,
    },
    {
      kind: 'respondGuard', fn: 'respondGuard',
      args: ['pid', 'yes'],
      desc: '守擂挡刀响应【占位】：挡刀由引擎自动裁决、无挂起询问，函数恒返回 {ok:false}',
      line: 2271,
      note: 'recon-01 标注“现为占位”与基线一致；协议保留该 kind 以便未来挡刀需要人工确认时启用',
    },
    {
      kind: 'respondAoeResp', fn: 'respondAoeResp',
      args: ['pid', 'yes'],
      desc: 'AOE 响应：出攻击/出WA 或承受伤害；亦承载祖安对线 argueResp（yes=弃1张随机手牌，no=受1伤）',
      line: 1576,
    },
    {
      kind: 'respondReport', fn: 'respondReport',
      args: ['pid', 'cardKey'],
      desc: '举报选牌：从目标手牌中选 1 张弃置（cardKey 为卡牌 key）',
      line: 2598,
    },
  ];

  /* ============================================================
   * 二、事件面：服务器 → 客户端广播通道语义事件
   * 每项: { kind, payload, desc }
   *   payload 为「形状示例」（字段名 + 类型说明），真实值由服务器填充
   * ============================================================ */
  const EVENTS = [
    {
      kind: 'state',
      payload: { view: 'publicView(pid) 按视角过滤后的完整快照', seq: 0, deadline: { turn: 45000, resp: 10000 } },
      desc: '权威状态快照：每个动作/响应结算后按玩家广播（v1 全量，可后加增量）；手牌/身份过滤必须严格只发 own view',
    },
    {
      kind: 'log',
      payload: { round: 0, txt: '日志文本', cls: "''|'act'|'evt'|'bad'", seat: 0 },
      desc: '日志文本广播；内奸脱敏必须在此通道也生效（与 UI logToHtml 同口径）',
    },
    {
      kind: 'fx',
      payload: { op: "'floatText'|'cardFly'|'shake'|'flash'|'particles'|'seatGlow'|'judgeFlip'", text: '', from: 0, to: 0, seat: 0 },
      desc: '动效指令（recon-02 D 节逐操作反馈映射）：浮字/卡牌飞行/震屏/闪红/粒子/光环/判定旋转',
    },
    {
      kind: 'sfx',
      payload: { sound: "'attack'|'block'|'heal'|'draw'|'death'|'awake'|'judge'|'aoe'|'counter'|'victory'|'defeat'|'achievement'|'countdown'|'chat'|'error'|'click'", vol: 1 },
      desc: '音效指令（recon-02 P8-1 事件→音色映射表）',
    },
    {
      kind: 'judge',
      payload: { seat: 0, card: { key: '', suit: 'spade', name: '' }, result: "'heart'|'not-heart'" },
      desc: '判定展示：翻牌亮花色 + 回牌堆底动画（玄学判题等）',
    },
    {
      kind: 'damage',
      payload: { seat: 0, amount: 1, from: 0, kind: "'attack'|'argue'|'event'|'trick'|'aoe'" },
      desc: '伤害浮字 + 血条流失动画',
    },
    {
      kind: 'heal',
      payload: { seat: 0, amount: 1 },
      desc: '治疗浮字 + 绿脉冲',
    },
    {
      kind: 'death',
      payload: { seat: 0, identity: "'lord'|'loyal'|'rebel'|'traitor'", revealed: true },
      desc: '玩家死亡：座位坍塌 + 身份翻牌（内奸仅离场投降才翻，2.4 例外二）',
    },
    {
      kind: 'guard-block',
      payload: { seat: 0, unit: { key: '', name: '' } },
      desc: '守擂挡刀：护盾碎裂 + 单位飞灰',
    },
    {
      kind: 'equip',
      payload: { seat: 0, slot: "'weapon'|'armor'", card: { key: '', name: '' } },
      desc: '装备入槽：栏位发光 + 卡入槽',
    },
    {
      kind: 'deploy',
      payload: { seat: 0, card: { key: '', name: '' } },
      desc: '单位部署落桌：阴影弹跳',
    },
    {
      kind: 'unit-die',
      payload: { seat: 0, card: { key: '', name: '' }, by: 0 },
      desc: '单位死亡：消灭碎屑 + 亡语结算提示',
    },
    {
      kind: 'awaken',
      payload: { seat: 0, prof: '职业id', text: '觉醒效果文本' },
      desc: '觉醒：全屏爆闪 + 职业横幅',
    },
    {
      kind: 'evo',
      payload: { seat: 0, key: '进化后卡牌key', card: { key: '', name: '' } },
      desc: '进化：卡面金边变形 + 粒子（对应引擎 evoWait/queueEvo）',
    },
    {
      kind: 'event',
      payload: { round: 0, card: { key: '', suit: 'spade', name: '' }, effect: '评测机事件描述' },
      desc: '评测机事件牌翻牌：每轮翻开 1 张（该牌进弃牌堆，g.event/g.eventSuit 生效）',
    },
    {
      kind: 'gameover',
      payload: { winner: '获胜身份', identity: "'lord'|'loyal'|'rebel'|'traitor'", achievements: ['成就列表'] },
      desc: '终局结算：遮罩 + 阵营横幅（对应 checkVictory/end）',
    },
    {
      kind: 'achievement',
      payload: { seat: 0, name: '成就名', desc: '成就描述' },
      desc: '成就徽章逐个弹出（settleAchievements）',
    },
    {
      kind: 'chat',
      payload: { from: 0, name: '发送者', text: '内容' },
      desc: '聊天气泡',
    },
    {
      kind: 'turn',
      payload: { pid: 0, round: 0 },
      desc: '换回合：回合光环流转 + 环状计时条（45s 倒计时起算）',
    },
    {
      kind: 'prompt',
      payload: { promptId: 'uuid', type: '见 PENDING_TYPES', payload: '{}', timeoutMs: 10000 },
      desc: '挂起提示：要求该玩家响应（10s 超时 = 按“否”）',
    },
    {
      kind: 'reject',
      payload: { why: '拒绝原因', ref: '被拒消息引用(可选)' },
      desc: '非法动作/响应拒绝：抖动 + 错误音',
    },
    {
      kind: 'shutdown',
      payload: { reason: '服务器关停原因' },
      desc: '服务器关停广播（房主 q 退出前广播）',
    },
  ];

  /* ============================================================
   * 三、挂起提示面：服务器 → 客户端 prompt 类型与应答形状
   * 每项: { type, respond, respondArgs, value, payload, desc, cite }
   *   type       : prompt.type（= 引擎 g.pending.type，另有复用型见 note）
   *   respond    : 引擎应答函数
   *   respondArgs: 应答函数参数（不含 g）
   *   value      : response 消息的 value 形状
   *   payload    : prompt 载荷形状（引擎 g.pending 经 pendingView 序列化）
   *   cite       : 出处（fixlog 行号 / game.js 基线行号）
   * ============================================================ */
  const PENDING_TYPES = [
    {
      type: 'dodge',
      respond: 'respondDodge', respondArgs: ['pid', 'yes', 'helperId?'],
      value: { yes: true, helperId: 0 },
      payload: {
        type: 'dodge', attacker: 0, target: 0, dmg: 1, suit: 'spade', cardId: -1, isEvo: false,
        srcId: 0, helpers: [{ id: 0, name: '' }],
        ctx: { betrayAvail: true, betrayOptions: [{ id: 0, name: '' }] },
      },
      desc: 'WA 询问：出闪或掉血；主公被攻时附 helpers（护驾代出）；附 betrayAvail/betrayOptions（卖队友转嫁入口）',
      cite: 'game.js L920/L946/L956（type:"dodge"）',
    },
    {
      type: 'counter',
      respond: 'respondCounter', respondArgs: ['pid', 'yes'],
      value: { yes: true },
      payload: {
        type: 'counter', victim: 0, srcId: 0, trickKey: '',
        ctx: { type: 'counterChain', trickKey: '', srcId: 0, depth: 0, cont: '{}' },
      },
      desc: '特判询问：出特判抵消锦囊；ctx.type==="counterChain" 为连锁反制（fixlog-1b：从上一张特判使用者下家按座位序询问）',
      cite: 'game.js L1133/L1154/L1176；fixlog-1b L27（counterChain 复用同 type）',
    },
    {
      type: 'betray',
      respond: 'respondBetray', respondArgs: ['pid', 'targetId'],
      value: { targetId: 0 },
      payload: { type: 'dodge', attacker: 0, target: 0, dmg: 1, suit: 'spade', ctx: { betrayAvail: true, betrayOptions: [{ id: 0, name: '' }] } },
      desc: '卖队友转嫁【语义类型】：引擎无独立 pending.type，复用 type:"dodge" + ctx.betrayAvail；应答为选择转嫁目标',
      cite: 'game.js L920（ctx.betrayAvail）/ L2282（respondBetray 校验 pd.type!=="dodge" 即拒）',
    },
    {
      type: 'cold',
      respond: 'respondCold', respondArgs: ['pid', 'yes'],
      value: { yes: true },
      payload: { type: 'cold', attacker: 0, target: 0, dmg: 1, opts: '{}' },
      desc: '冷数据：武器命中时可改为弃置目标 2 张牌',
      cite: 'game.js L1083',
    },
    {
      type: 'bbst',
      respond: 'respondBbst', respondArgs: ['pid', 'yes'],
      value: { yes: true },
      payload: { type: 'bbst', attacker: 0, target: 0, dmg: 1 },
      desc: '平衡树：弃 1 张强制命中或闪避（dmg 为原攻击最终伤害，fixlog-1b M-15）',
      cite: 'game.js L1029；fixlog-1b L83',
    },
    {
      type: 'chase',
      respond: 'respondChase', respondArgs: ['pid', 'yes'],
      value: { yes: true },
      payload: { type: 'chase', attacker: 0, target: 0 },
      desc: '不死心：再出一张攻击牌追击或放弃',
      cite: 'game.js L1014',
    },
    {
      type: 'harvest',
      respond: 'respondHarvest', respondArgs: ['pid', 'choiceKey'],
      value: { choiceKey: '' },
      payload: { type: 'harvest', victim: 0, ctx: { type: 'harvest', srcId: 0, cards: [{ key: '', id: -1, name: '' }], order: [0], pos: 0 } },
      desc: '题解大会：从亮出的 n 张牌中选 1 张（顺序自使用者起，choiceKey 为卡牌 key）',
      cite: 'game.js L1245/L2571/L1877',
    },
    {
      type: 'guard',
      respond: 'respondGuard', respondArgs: ['pid', 'yes'],
      value: { yes: true },
      payload: { type: 'guard', victim: 0 },
      desc: '守擂挡刀【占位】：引擎无此 pending（respondGuard 恒返回 {ok:false,"挡刀由引擎自动裁决,无挂起询问"}）；协议保留该 kind 供未来启用',
      cite: 'game.js L2271（占位实现）',
    },
    {
      type: 'aoeResp',
      respond: 'respondAoeResp', respondArgs: ['pid', 'yes'],
      value: { yes: true },
      payload: { type: 'aoeResp', victim: 0, srcId: 0, trickKey: "'aoeAtk'|'aoeAtkEvo'|'funCcf'", dmg: 1 },
      desc: 'AOE 响应：出攻击/出WA 或承受伤害（逐人询问）',
      cite: 'game.js L1488',
    },
    {
      type: 'report',
      respond: 'respondReport', respondArgs: ['pid', 'cardKey'],
      value: { cardKey: '' },
      payload: { type: 'report', victim: 0, ctx: { targetId: 0, cards: [{ key: '', id: -1, name: '' }] } },
      desc: '举报：从目标手牌中选 1 张弃置（cardKey 为卡牌 key）',
      cite: 'game.js L1433',
    },
    {
      type: 'argueResp',
      respond: 'respondAoeResp', respondArgs: ['pid', 'yes'],
      value: { yes: true },
      payload: { type: 'argueResp', victim: 0, srcId: 0, trickKey: 'funArgue', dmg: 1, ctx: { type: 'argue', srcId: 0, targetId: 0, remaining: [0] } },
      desc: '祖安对线自选（fixlog-1a 新增）：yes=弃 1 张随机手牌，no=受 1 伤；答完自动继续下一目标；特判可先于自选挂起（counter）',
      cite: 'fixlog-1a L42-45；game.js L1560（挂起）/ L1576-1594（respondAoeResp 扩展接受 argueResp）',
    },
    {
      type: 'betrayConsent',
      respond: 'respondDodge', respondArgs: ['pid', 'yes'],
      value: { yes: true },
      payload: { type: 'dodge', attacker: 0, target: 0, dmg: 1, suit: 'spade', cardId: -1, isEvo: false, srcId: 0, ctx: { betrayConsent: true, betrayer: 0 } },
      desc: '卖队友转嫁同意询问（fixlog-1a 新增）：被转嫁的新目标作答——yes=同意转嫁（消耗卖队友牌、攻击结算给新目标），no=拒绝（攻击落回原目标、牌保留）；复用 type:"dodge"，经 respondDodge 作答',
      cite: 'fixlog-1a L76-79；game.js L926/L2308（挂起）/ L2177-2205（respondDodge 识别 ctx.betrayConsent）',
    },
  ];

  /* ============================================================
   * 四、动作函数映射（惰性构建）
   * 本模块不 require 引擎，因此引擎拆分落地前后都能被 node --check 解析；
   * 服务器启动时调用 buildApi(engine) 得到 { fnByName }，缺失即抛描述性错误。
   * ============================================================ */
  function buildApi(engine) {
    if (!engine || typeof engine !== 'object') {
      throw new Error('[net-api] buildApi(engine): 需要传入引擎导出对象（如 require("../engine/index.js")）');
    }
    const missing = [];
    for (const a of ACTIONS) {
      if (typeof engine[a.fn] !== 'function') missing.push(a.fn + '(game.js L' + a.line + ')');
    }
    if (missing.length) {
      throw new Error(
        '[net-api] 引擎缺少动作函数: ' + missing.join(', ') +
        '。请确认引擎拆分已落地且导出键与 game.js 基线一致（54 键契约）。'
      );
    }
    const fnByName = {};
    for (const a of ACTIONS) fnByName[a.fn] = engine[a.fn].bind(engine);
    return { fnByName };
  }

  /* ============================================================
   * 五、多人化必须补的引擎缺口（recon-01 3.3 要求写入本文件注释；不属本文件实现范围）
   *  1. g.askDodge 单布尔 → 询问目标集合（护驾/多目标攻击需按座位询问）
   *  2. g.pending 单槽 → g.prompts 多槽：AOE 逐人、题解大会逐人、护驾同时问目标+帮手、特判连锁需服务器按座位顺序串行生成
   *  3. 响应顺序按 requirement FAQ-2：从当前行动者下家起逆时针依次询问
   *  4. discardPhase 中死引用 g.discardChoice 需清理或实现（基线 L420 引用未定义）
   *  5. publicView 之外 UI 直接读 g.players 的字段（如回合名）多人版应封进 view
   * ============================================================ */

  const api = { ACTIONS, EVENTS, PENDING_TYPES, buildApi };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    // P6b 子槽挂载: 不扁平 Object.assign 到根(根命名空间会在 game.js 浏览器分支被重新赋值
    // 为扁平引擎 api, 扁平键会被覆盖); 改挂 OIKill.net 子槽, 与 OIKill.data.* / OIKill.ui.* 并列。
    // 接线注意: 本文件需在 game.js 之后加载(此时根已是定型 api 对象), 子槽才不会被覆盖。
    const NET = NS.net = NS.net || {};
    Object.assign(NET, api);
  }
})(typeof window !== 'undefined' ? window : globalThis);
