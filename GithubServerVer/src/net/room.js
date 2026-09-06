/*!
 * room.js — 《OI杀》v4 房间/会话层（P4b：Room/Server 权威层，零依赖，仅 node 内置 + 既有 net 模块）
 *
 * 依据：recon-02 §B（房主=服务器 / 权威模型 / 重连 / AI 补位）、net-protocol.md（消息表）、
 *       p4a-传输层报告 §4（对接要点）、p2a-多人化报告（引擎契约：humanSet/isHuman/prompts/
 *       drive/timeoutPrompt/duePrompts/promptCount）。
 *
 * 职责（引擎对象 g 只存在于本层所在进程）：
 *   1. 大厅生命周期：join（name + crypto.randomUUID sessionToken）、座位 ≤6、房主=首座、
 *      config（humanCount/aiFill/randomIdentity/difficulty，房主专属）、start（房主专属）→
 *      engine.createGame({humans:[...], seed}) + engine.setup(g, names)（AI 补位其余座位）。
 *   2. 权威对局：客户端发 action/response，经 protocol.validateAction + buildApi(engine)
 *      校验后执行引擎调用；每次状态变化统一走广播路径：state（每客户端各自 publicView 视角）
 *      + prompt（目标人类）+ event（log/fx/sfx/judge/damage/heal/death/equip/deploy/unit-die/
 *      awaken/evo/event/achievement/gameover/chat/turn/shutdown）——AI 与真人产生同一事件流。
 *   3. 服务器权威计时：出牌回合 45s（超时→discardPhase+endTurn 并广播）；提示响应 10s
 *      （每个 prompt 条目独立 setTimeout，超时→engine.timeoutPrompt(promptId) 默认"否"结算）。
 *   4. AI 座位：engine.drive(g,{thinkMs 采样自难度,onState/onPrompt/onEvent}) 异步泵驱动；
 *      人类提示挂起时泵暂停，直至响应或超时。
 *   5. 断线重连：join 下发 sessionToken；断线保留座位 60s（携 token 重连→重发全量 state +
 *      该 pid 未决 prompt）；宽限期满→engine.playerLeave + 广播。
 *   6. 观战：{spectate:true} join，只收公开信息（无手牌/身份，prompts 剥离）。
 *   7. 聊天广播；quit 前 broadcast server-shutdown（event kind:'shutdown'）；干净退出路径。
 *
 * 传输对接（p4a 契约）：
 *   - attachWs(ws)：ws.onMessage(connId, text) → protocol.decodeMsg → 本层；
 *     ws.onClose/onPong 驱动断线/心跳。
 *   - attachLongPoll(lp)：lp.onMessage({kind, payload, seq}) 同语义；出站经 lp.emit——
 *     共享流无每连接通道，故出站信封一律附 `to`（clientId 或 '*'），客户端按 to 过滤
 *     （P6b 适配层契约，见报告偏差表）。
 *   - bindEngine 在 createRoom 时调用（引擎缺失动作函数即抛错）。
 */
'use strict';

const crypto = require('node:crypto');
const protocol = require('./protocol.js');
const netApi = require('./net-api.js');

const MAX_SEATS = 6;          // 座位上限（ID_TABLE 支持 3~6 人局）
const MIN_TOTAL = 3;

const DEFAULTS = {
  turnTimeoutMs: 45000,       // 出牌回合权威超时（net-protocol §4）
  promptTimeoutMs: 10000,     // 挂起响应权威超时
  graceMs: 60000,             // 断线宽限期
  heartbeatMs: 15000,         // 心跳周期（2 个周期无动静判定断线）
  chatMaxLen: 500,
  thinkMs: null,              // 测试用：显式 AI think 延迟；null → 按 difficulty 采样
};

const RESPONSE_MAP = {
  // response.kind → { fn, args(按序; 末位追加 promptId), accept(引擎提示 entry.type) }
  dodge:         { fn: 'respondDodge',   args: ['pid', 'yes', 'helperId?'], accept: ['dodge'] },
  betray:        { fn: 'respondBetray',  args: ['pid', 'targetId'],        accept: ['dodge'] },
  betrayConsent: { fn: 'respondDodge',   args: ['pid', 'yes'],             accept: ['dodge'] },
  counter:       { fn: 'respondCounter', args: ['pid', 'yes'],             accept: ['counter'] },
  cold:          { fn: 'respondCold',    args: ['pid', 'yes'],             accept: ['cold'] },
  bbst:          { fn: 'respondBbst',    args: ['pid', 'yes'],             accept: ['bbst'] },
  chase:         { fn: 'respondChase',   args: ['pid', 'yes'],             accept: ['chase'] },
  harvest:       { fn: 'respondHarvest', args: ['pid', 'choiceKey'],       accept: ['harvest'] },
  guard:         { fn: 'respondGuard',   args: ['pid', 'yes'],             accept: ['guard'] },
  aoeResp:       { fn: 'respondAoeResp', args: ['pid', 'yes'],             accept: ['aoeResp'] },
  argueResp:     { fn: 'respondAoeResp', args: ['pid', 'yes'],             accept: ['argueResp'] },
  report:        { fn: 'respondReport',  args: ['pid', 'cardKey'],         accept: ['report'] },
};

/* 必须处于本人行动阶段的动作（引擎未给全 endTurn/discardCards 等加回合守卫，由房间层补权威校验） */
const NEEDS_TURN = new Set([
  'playCard', 'equipCard', 'deployUnit', 'unitAttack', 'skillUse',
  'endTurn', 'discardFun', 'kspAttack', 'fangAttack', 'discardCards',
]);

/* 日志 → 动效/音效启发式映射（P7 动效系统落地前的最小事件化；payload 形状见 net-api EVENTS） */
const FX_RULES = [
  { re: /受到(\d+)点伤害/, make: (m) => ({ fx: { kind: 'damage', payload: { seat: null, amount: Number(m[1]), from: null, kind: 'attack' } }, sfx: 'attack' }) },
  { re: /失去(\d+)点体力/, make: (m) => ({ fx: { kind: 'damage', payload: { seat: null, amount: Number(m[1]), from: null, kind: 'event' } }, sfx: 'attack' }) },
  { re: /回复(\d+)点体力/, make: (m) => ({ fx: { kind: 'heal', payload: { seat: null, amount: Number(m[1]) } }, sfx: 'heal' }) },
  { re: /阵亡|被击败|被淘汰|离场投降/, make: () => ({ fx: { kind: 'death', payload: { seat: null } }, sfx: 'death' }) },
  { re: /判定/, make: () => ({ sfx: 'judge', fx: { kind: 'judge', payload: { seat: null } } }) },
  { re: /装备【/, make: () => ({ sfx: 'equip' }) },
  { re: /部署【/, make: () => ({ sfx: 'deploy' }) },
  { re: /觉醒/, make: () => ({ sfx: 'awake', fx: { kind: 'awaken', payload: { seat: null } } }) },
  { re: /进化!/, make: () => ({ sfx: 'evo' }) },
  { re: /评测机事件/, make: () => ({ sfx: 'judge', fx: { kind: 'event', payload: {} } }) },
  { re: /获得成就/, make: () => ({ sfx: 'achievement' }) },
];

function uuid() { return crypto.randomUUID(); }
function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }

function fisherYates(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createRoom(opts) {
  if (!opts || !opts.engine) throw new Error('[room] createRoom 需要 { engine }');
  const engine = opts.engine;
  protocol.bindEngine(engine); // 经 net-api buildApi 惰性绑定引擎动作映射（缺失即抛错）

  const O = Object.assign({}, DEFAULTS, opts);

  const dlog = O.debug ? (...a) => console.log('[room]', ...a) : () => {};

  const room = {
    mode: opts.mode || 'lan',
    state: 'lobby',                       // lobby | playing | ended
    config: { humanCount: 6, aiFill: null, randomIdentity: false, difficulty: 'normal' },
    g: null,                              // 引擎对局对象（仅服务器持有）
    seats: new Array(MAX_SEATS).fill(null), // seat → client（大厅入座者）
    spectators: new Map(),                // clientId → client
    clients: new Map(),                   // clientId → client（座位 + 观战统一登记）
    tokenIndex: new Map(),                // sessionToken → clientId
    linkClients: new Map(),               // linkId → client（ws/test 连接绑定）
    wsLinks: new Map(),                   // ws connId → link
    ws: null,
    lp: null,
    seatToPid: null,                      // 座位 → 引擎 pid（randomIdentity 时打乱）
    pidToSeat: null,                      // 引擎 pid → 座位
    viewSeq: 0,                           // state 快照版本号（transport seq 之外的房间层游标）
    inHumanTurn: false,
    turnPid: -1,
    turnTimer: null,
    promptTimers: new Map(),              // promptId → setTimeout
    promptDeadlines: new Map(),           // promptId → 房间权威截止时刻
    sentPrompts: new Set(),               // 已下发过消息的 promptId（幂等, 防重复发送）
    lastTurnPid: -1,
    heartbeatTimer: null,
    pumpBusy: false,
    pumpQueued: false,
    shut: false,
  };

  /* ---------------- 出站 ---------------- */
  function encodeSend(client, kind, payload) {
    const link = client && client.link;
    if (!link || !link.send) return;
    try { link.send(protocol.encodeMsg(kind, payload)); } catch (e) { /* 连接已坏, 忽略 */ }
  }

  /** 私信：只发给该客户端（lp 走共享流 + to=clientId 寻址） */
  function sendToClient(client, kind, payload) {
    if (!client) return;
    if (client.transport === 'lp') {
      if (room.lp) room.lp.emit(kind, Object.assign({}, payload, { to: client.clientId }));
      return;
    }
    encodeSend(client, kind, payload);
  }

  /** 全局广播：每个 WS/test 客户端各一份；lp 共享流一份（to:'*'） */
  function broadcast(kind, payload) {
    for (const c of room.clients.values()) {
      if (c.connected && c.transport !== 'lp') encodeSend(c, kind, payload);
    }
    if (room.lp) room.lp.emit(kind, Object.assign({}, payload, { to: '*' }));
  }

  function sendRejectTo(client, why, ref) {
    sendToClient(client, 'reject', ref !== undefined ? { why, ref } : { why });
  }

  /** join 阶段失败（尚无 clientId 寻址）：按 link 直发；lp 共享流按 nonce 关联 */
  function sendJoinReject(link, payload, why) {
    const p = Object.assign({ why }, payload && payload.nonce !== undefined ? { ref: payload.nonce } : null);
    if (link && link.kind === 'lp') {
      if (room.lp) room.lp.emit('reject', Object.assign({}, p, { to: '*' }));
      return;
    }
    if (link && link.send) { try { link.send(protocol.encodeMsg('reject', p)); } catch (e) { /* 忽略 */ } }
  }

  /* ---------------- 客户端模型 ---------------- */
  function makeClient(info) {
    const client = Object.assign({
      clientId: uuid(),
      token: uuid(),
      kind: 'seat',           // seat | spec
      seat: null,
      enginePid: null,
      left: false,
      isHost: false,
      connected: true,
      transport: null,
      link: null,
      lastSeen: Date.now(),
      disconnectedAt: null,
      graceTimer: null,
    }, info);
    room.clients.set(client.clientId, client);
    room.tokenIndex.set(client.token, client.clientId);
    if (client.link && client.link.linkId) room.linkClients.set(client.link.linkId, client);
    return client;
  }

  function seatClient(seat) { return room.seats[seat]; }
  function hostClient() {
    for (const c of room.seats) if (c && c.isHost && !c.left) return c;
    return null;
  }
  function clientByToken(token) {
    const id = room.tokenIndex.get(token);
    return id ? room.clients.get(id) : null;
  }
  function clientByEnginePid(pid) {
    for (const c of room.seats) if (c && c.enginePid === pid) return c;
    return null;
  }
  function hasPromptFor(pid, type) {
    for (const e of room.g.prompts.values()) if (e.pid === pid && (!type || e.type === type)) return true;
    return false;
  }
  function transferHostIfNeeded() {
    for (const c of room.seats) if (c) c.isHost = false;
    for (const c of room.clients.values()) if (c.kind === 'seat' && !c.left) { c.isHost = true; break; }
  }

  /* ---------------- hello / lobby / setup / state ---------------- */
  function helloPayload(client, nonce) {
    const self = client.kind === 'seat'
      ? { pid: client.enginePid != null ? client.enginePid : client.seat, seatId: client.seat, name: client.name, isHost: !!client.isHost, clientId: client.clientId }
      : { pid: null, seatId: null, name: client.name, isHost: false, clientId: client.clientId };
    return {
      proto: protocol.PROTO, mode: room.mode, self,
      sessionToken: client.token,
      nonce: nonce !== undefined ? nonce : null,
    };
  }
  function sendHello(client, nonce) { sendToClient(client, 'hello', helloPayload(client, nonce)); }

  function lobbyInfo() {
    const players = [];
    for (let i = 0; i < MAX_SEATS; i++) {
      const c = room.seats[i];
      if (c) players.push({ seatId: i, name: c.name, isHost: !!c.isHost, connected: c.connected });
    }
    return {
      players,
      config: Object.assign({}, room.config),
      canStart: room.seats.filter(Boolean).length >= 1,
      state: room.state,
    };
  }
  function broadcastLobby() { broadcast('lobby', lobbyInfo()); }
  function sendLobby(client) { sendToClient(client, 'lobby', lobbyInfo()); }

  function sendSetup(client) {
    if (!room.g || client.enginePid == null) return;
    const n = room.seatToPid.length;
    const professions = [];
    for (let s = 0; s < n; s++) {
      const p = room.g.players[room.seatToPid[s]];
      professions.push(p ? { id: p.prof.id, name: p.prof.name, plain: p.prof.plain } : null);
    }
    const me = room.g.players[client.enginePid];
    sendToClient(client, 'setup', {
      professions,
      myIdentity: me ? { id: me.identity, name: engine.IDENTITIES[me.identity] ? engine.IDENTITIES[me.identity].name : null } : null,
      lordPid: room.pidToSeat[0] !== undefined ? room.pidToSeat[0] : 0, // 引擎固定 0 号为主公 → 座位号
      lordEnginePid: 0,
      deckCount: room.g.deck.length,
      pid: client.enginePid,
      seatId: client.seat,
      seatToPid: room.seatToPid.slice(),
      total: n,
    });
  }

  /** 观战视图：以 0 号玩家为底、剥除手牌/身份/未决提示（只留公开信息） */
  function spectatorView() {
    if (!room.g || !room.g.players.length) return null;
    const v = engine.publicView(room.g, 0);
    const p0 = room.g.players[0];
    v.me.hand = [];
    v.me.identity = v.me.dead ? (p0.identity === 'traitor' && !p0.left ? null : engine.IDENTITIES[p0.identity].name) : null;
    v.pending = null;
    v.prompts = [];
    v.evoWait = null;
    return v;
  }

  function sendState(client) {
    if (!room.g) return;
    const view = (client.kind === 'spec' || client.enginePid == null)
      ? spectatorView()
      : engine.publicView(room.g, client.enginePid);
    sendToClient(client, 'state', {
      view,
      viewSeq: room.viewSeq,
      deadline: { turn: O.turnTimeoutMs, resp: O.promptTimeoutMs },
    });
  }
  function broadcastState() {
    room.viewSeq++;
    for (const c of room.clients.values()) if (c.connected) sendState(c);
  }

  /* ---------------- 事件广播（AI 与真人同一管线） ---------------- */
  function seatOfName(txt) {
    if (!txt) return null;
    const names = [];
    for (const c of room.clients.values()) if (c.kind === 'seat') names.push({ name: c.name, seat: c.seat });
    if (room.g) for (const p of room.g.players) names.push({ name: p.name, seat: room.pidToSeat[p.id] });
    names.sort((a, b) => b.name.length - a.name.length);
    for (const x of names) if (txt.indexOf(x.name) >= 0) return x.seat;
    return null;
  }

  function broadcastLogEvent(e) {
    const seat = seatOfName(e.txt);
    broadcast('event', { kind: 'log', payload: { round: e.t, txt: e.txt, cls: e.cls || '', seat } });
    for (const rule of FX_RULES) {
      const m = rule.re.exec(e.txt);
      if (!m) continue;
      const out = rule.make(m);
      if (out.sfx) broadcast('event', { kind: 'sfx', payload: { sound: out.sfx, vol: 1, seat } });
      if (out.fx) {
        if (out.fx.payload && out.fx.payload.seat === null) out.fx.payload.seat = seat;
        broadcast('event', { kind: 'fx', payload: out.fx.payload });
      }
      return; // 每行日志至多一组动效
    }
  }

  /** 把 g.log 中尚未广播的增量行全部事件化（人类动作/超时发生在 drive 之外时使用） */
  function flushLog() {
    if (!room.g) return;
    const start = room.g._evCursor || 0;
    const logs = room.g.log;
    for (let i = start; i < logs.length; i++) {
      room.g._evCursor = i + 1;
      broadcastLogEvent({ kind: 'log', t: logs[i].t, txt: logs[i].txt, cls: logs[i].cls });
    }
  }

  function noteTurn(pid) {
    if (pid === room.lastTurnPid) return;
    room.lastTurnPid = pid;
    broadcast('event', {
      kind: 'turn',
      payload: { pid: room.pidToSeat[pid], enginePid: pid, round: room.g.round },
    });
  }

  /* ---------------- 权威计时 ---------------- */
  function clearTurnTimer() {
    if (room.turnTimer) { clearTimeout(room.turnTimer); room.turnTimer = null; }
    room.turnPid = -1;
  }
  function startTurnTimer(pid) {
    clearTurnTimer();
    room.turnPid = pid;
    if (O.turnTimeoutMs > 0) room.turnTimer = setTimeout(() => onTurnTimeout(pid), O.turnTimeoutMs);
  }
  function onTurnTimeout(pid) {
    room.turnTimer = null;
    dlog('turn-timeout', pid, 'inHumanTurn=' + room.inHumanTurn, 'g.turn=' + (room.g && room.g.turn));
    if (room.shut || !room.g || room.g.over || room.state !== 'playing') return;
    if (room.g.turn !== pid || !room.g.isHuman(pid)) return; // 迟到计时器: 回合已轮转, 不碰当前回合状态
    room.inHumanTurn = false;
    engine.discardPhase(room.g, pid);
    engine.endTurn(room.g, pid);
    flushLog();
    broadcastState();
    if (room.g.over) { handleGameOver(); return; }
    pump();
  }

  function onPromptTimeout(promptId) {
    room.promptTimers.delete(promptId);
    room.promptDeadlines.delete(promptId);
    room.sentPrompts.delete(promptId);
    dlog('prompt-timeout', promptId);
    if (room.shut || !room.g || !room.g.prompts.has(promptId)) return;
    engine.timeoutPrompt(room.g, promptId); // 默认"否/放弃"路径
    flushLog();
    broadcastState();
    if (room.g.over) { handleGameOver(); return; }
    pump();
  }

  function sendPrompt(client, pr) {
    const deadline = room.promptDeadlines.get(pr.id);
    const remaining = Math.max(0, (deadline != null ? deadline : Date.now() + 10000) - Date.now());
    const payload = {};
    // 注意: 信封保留字段 type 由传输层持有, 提示的语义 type 必须放进 payload
    // (net-protocol §3 的 {promptId, type, payload} 顶层 type 与信封冲突 → 偏差, 见报告)
    for (const k of Object.keys(pr)) {
      if (['id', 'pid', 'deadlineMs', 'createdAt'].indexOf(k) >= 0) continue;
      payload[k] = pr[k];
    }
    sendToClient(client, 'prompt', {
      promptId: pr.id, pid: pr.pid, payload, timeoutMs: Math.ceil(remaining),
    });
  }

  /** 提示就绪处理：人类 → 私发 + 计时；AI（防御分支，引擎不应产生）→ 按"否"结算防死锁 */
  function ensurePrompt(pr) {
    if (!room.g.isHuman(pr.pid)) {
      engine.timeoutPrompt(room.g, pr.id);
      flushLog();
      broadcastState();
      return false;
    }
    if (!room.promptTimers.has(pr.id)) {
      const dur = O.promptTimeoutMs != null ? O.promptTimeoutMs : (pr.deadlineMs || 10000);
      room.promptDeadlines.set(pr.id, Date.now() + dur);
      room.promptTimers.set(pr.id, setTimeout(() => onPromptTimeout(pr.id), dur));
    }
    if (!room.sentPrompts.has(pr.id)) {
      room.sentPrompts.add(pr.id);
      const client = clientByEnginePid(pr.pid);
      dlog('prompt send', pr.id, pr.pid, pr.type, 'client=' + (client ? client.name + '/connected=' + client.connected : 'null'));
      if (client && client.connected) sendPrompt(client, pr);
    }
    return true;
  }

  function resendPrompts(client) {
    if (!room.g || client.enginePid == null) return;
    for (const pr of room.g.prompts.values()) {
      if (pr.pid === client.enginePid) sendPrompt(client, pr);
    }
  }

  /* ---------------- AI 泵（engine.drive 异步调度） ---------------- */
  async function pump() {
    if (room.shut || room.state !== 'playing' || !room.g || room.g.over) return;
    if (room.pumpBusy) { dlog('pump reentrant → queued'); room.pumpQueued = true; return; }
    room.pumpBusy = true;
    dlog('pump enter', 'inHumanTurn=' + room.inHumanTurn, 'turn=' + room.g.turn, 'prompts=' + engine.promptCount(room.g));
    try {
      for (let guard = 0; guard < 200000; guard++) {
        if (room.shut || room.g.over) break;
        // 人类行动阶段且无未决提示 → 等待该人类出牌/结束回合（防 drive 重复判定摸牌）
        if (room.inHumanTurn && engine.promptCount(room.g) === 0) break;
        const res = await engine.drive(room.g, {
          thinkMs: O.thinkMs,
          difficulty: O.thinkMs == null ? room.config.difficulty : undefined,
          onEvent: (e) => {
            if (e && e.kind === 'log') {
              room.g._evCursor = room.g.log.length; // 防 drive 内部游标与房间 flushLog 重复投递
              broadcastLogEvent(e);
            }
          },
          onState: (g, pid) => { noteTurn(pid); broadcastState(); },
        });
        if (res.status === 'prompt') {
          dlog('drive→prompt', res.promptId, 'map=' + room.g.prompts.size);
          // 多槽并发提示（AOE 逐人/题解大会逐人/祖安对线逐目标）：为全部未决人类提示补发消息+计时;
          // AI 提示（引擎不应产生）防御性按"否"结算防死锁。
          let anyHuman = false;
          for (const pr of Array.from(room.g.prompts.values())) {
            if (room.g.isHuman(pr.pid)) { ensurePrompt(pr); anyHuman = true; }
            else if (!room.g.prompts.has(pr.id)) { /* 已被并发路径解析 */ }
            else { dlog('AI-prompt-defensive', pr.id, pr.pid, pr.type); engine.timeoutPrompt(room.g, pr.id); flushLog(); broadcastState(); }
          }
          if (anyHuman) break; // 人类提示挂起 → 泵暂停, 等响应/超时
          continue;            // 全部为 AI 防御解析 → 继续
        }
        if (res.status === 'human-turn') {
          // 防陈旧结果竞态: drive 挂起期间状态可能已被并发路径推进(另一客户端 endTurn/响应)
          if (room.g.turn !== res.pid || !room.g.isHuman(res.pid) || room.inHumanTurn) continue;
          dlog('drive→human-turn', res.pid);
          room.inHumanTurn = true;
          startTurnTimer(res.pid);
          broadcastState();
          break;
        }
        dlog('drive→' + res.status, res.winner || '');
        break; // over | cap（cap 表示驱动上限, 正常对局不会发生）
      }
    } finally {
      room.pumpBusy = false;
      dlog('pump exit', 'busy=false turn=' + room.g.turn, 'inHumanTurn=' + room.inHumanTurn, 'prompts=' + engine.promptCount(room.g));
    }
    if (room.g.over) handleGameOver();
    else if (room.pumpQueued) { room.pumpQueued = false; pump(); }
  }

  /* ---------------- 对局开始 / 终局 ---------------- */
  function startGame() {
    if (room.state !== 'lobby') return { ok: false, why: '不在大厅' };
    const humans = room.seats.filter(Boolean);
    if (!humans.length) return { ok: false, why: '至少需要 1 名玩家' };
    const cfg = room.config;
    const aiFill = cfg.aiFill == null ? Math.max(0, MAX_SEATS - cfg.humanCount) : cfg.aiFill;
    let total = Math.max(cfg.humanCount + aiFill, humans.length);
    total = Math.max(MIN_TOTAL, Math.min(MAX_SEATS, total));

    // 座位 → 引擎 pid 映射：引擎固定 0 号=主公；randomIdentity 时打乱全座位
    const map = Array.from({ length: total }, (_, i) => i);
    if (cfg.randomIdentity) fisherYates(map, () => Math.random());
    room.seatToPid = map;
    room.pidToSeat = new Array(total);
    for (let s = 0; s < total; s++) room.pidToSeat[map[s]] = s;

    const names = new Array(total);
    const humanPids = [];
    for (let s = 0; s < total; s++) {
      const c = room.seats[s];
      const ep = map[s];
      if (c && !c.left) { c.enginePid = ep; names[ep] = c.name; humanPids.push(ep); }
      else names[ep] = 'AI-' + (s + 1);
    }

    const g = engine.createGame({ humans: humanPids, seed: O.seed != null ? O.seed : crypto.randomInt(1, 2147483646) });
    engine.setup(g, names);
    g._evCursor = 0;
    room.g = g;
    room.state = 'playing';
    room.viewSeq = 0;
    room.lastTurnPid = -1;
    room.inHumanTurn = false;
    clearTurnTimer();

    // 广播 setup（含本人引擎 pid / 座位映射）+ 初始 state
    for (const c of room.clients.values()) {
      if (!c.connected) continue;
      if (c.kind === 'seat' && c.enginePid != null) sendSetup(c);
      else if (c.kind === 'spec') sendState(c);
    }
    broadcastState();
    pump(); // 主公先手（或 AI 先手, 由 drive 判定）
    return { ok: true, total };
  }

  function handleGameOver() {
    if (room.state === 'ended') return;
    room.state = 'ended';
    room.inHumanTurn = false;
    clearTurnTimer();
    for (const t of room.promptTimers.values()) clearTimeout(t);
    room.promptTimers.clear();
    room.promptDeadlines.clear();
    room.sentPrompts.clear();
    flushLog();
    broadcastState();
    const achBySeat = {};
    if (room.g.achievements) {
      for (const k of Object.keys(room.g.achievements)) {
        const ep = Number(k);
        achBySeat[room.pidToSeat[ep] !== undefined ? room.pidToSeat[ep] : ep] = room.g.achievements[k];
      }
    }
    broadcast('event', {
      kind: 'gameover',
      payload: { winner: room.g.winner, identity: null, achievements: achBySeat },
    });
  }

  /* ---------------- 入站处理 ---------------- */
  function handleJoin(link, payload, now) {
    payload = payload || {};
    const wantName = String(payload.name || '').slice(0, 20).trim();

    // 断线重连（携 sessionToken）
    if (payload.token) {
      const client = clientByToken(payload.token);
      if (!client) { sendJoinReject(link, payload, '无效的 sessionToken'); return; }
      // 换绑连接（旧连接作废, 防双端并存）
      if (client.link && client.link !== link && client.link.close) {
        try { client.link.close(4000, 'reconnected elsewhere'); } catch (e) { /* 忽略 */ }
      }
      if (client.link && client.link.linkId) room.linkClients.delete(client.link.linkId);
      client.link = link;
      client.transport = link ? link.kind : null;
      client.connected = true;
      client.lastSeen = now;
      if (client.graceTimer) { clearTimeout(client.graceTimer); client.graceTimer = null; }
      client.disconnectedAt = null;
      if (link && link.linkId) room.linkClients.set(link.linkId, client);
      // token 轮换：每次成功 join 换发新 token, 旧 token 立即作废
      room.tokenIndex.delete(client.token);
      client.token = uuid();
      room.tokenIndex.set(client.token, client.clientId);
      sendHello(client, payload.nonce);
      dlog('rejoin', client.name, 'state=' + room.state, 'prompts=' + (room.g ? Array.from(room.g.prompts.values()).map((p) => p.id + ':' + p.pid).join(',') : '-'));
      if (room.state === 'playing') {
        if (client.kind === 'seat' && client.enginePid != null && !client.left) {
          sendSetup(client);
          sendState(client);
          resendPrompts(client); // 含剩余超时的未决 prompt
        } else if (client.kind === 'spec') {
          sendState(client);
        }
      } else {
        sendLobby(client);
      }
      broadcastLobby();
      return;
    }

    // 观战加入
    if (payload.spectate) {
      const name = wantName || ('观众' + (room.spectators.size + 1));
      const client = makeClient({ kind: 'spec', seat: null, name, transport: link ? link.kind : null, link, isHost: false });
      room.spectators.set(client.clientId, client);
      sendHello(client, payload.nonce);
      if (room.state === 'playing') sendState(client); else sendLobby(client);
      return;
    }

    // 普通入座
    if (room.state !== 'lobby') {
      sendJoinReject(link, payload, room.state === 'ended' ? '对局已结束' : '对局已开始: 请以 {spectate:true} 观战');
      return;
    }
    const seat = room.seats.indexOf(null);
    if (seat < 0) { sendJoinReject(link, payload, '房间已满(最多' + MAX_SEATS + '人)'); return; }
    const name = wantName || ('玩家' + (seat + 1));
    const client = makeClient({
      kind: 'seat', seat, name, isHost: room.seats.every((c) => !c),
      transport: link ? link.kind : null, link,
    });
    room.seats[seat] = client;
    sendHello(client, payload.nonce);
    broadcastLobby();
    maybeAutoStart();
  }

  function handleConfig(client, payload) {
    if (!client.isHost) { sendRejectTo(client, '只有房主可以修改配置'); return; }
    if (room.state !== 'lobby') { sendRejectTo(client, '对局已开始, 不能修改配置'); return; }
    const cfg = room.config;
    if (payload.humanCount !== undefined) {
      if (!Number.isInteger(payload.humanCount) || payload.humanCount < 1 || payload.humanCount > MAX_SEATS) {
        sendRejectTo(client, 'humanCount 必须是 1~' + MAX_SEATS + ' 的整数'); return;
      }
      cfg.humanCount = payload.humanCount;
    }
    if (payload.aiFill !== undefined) {
      if (payload.aiFill !== null && (!Number.isInteger(payload.aiFill) || payload.aiFill < 0 || payload.aiFill > MAX_SEATS - cfg.humanCount)) {
        sendRejectTo(client, 'aiFill 必须是 0~' + (MAX_SEATS - cfg.humanCount) + ' 的整数或 null'); return;
      }
      cfg.aiFill = payload.aiFill;
    }
    if (payload.randomIdentity !== undefined) cfg.randomIdentity = !!payload.randomIdentity;
    if (payload.difficulty !== undefined) {
      if (['easy', 'normal', 'hard'].indexOf(payload.difficulty) < 0) {
        sendRejectTo(client, 'difficulty 必须是 easy|normal|hard'); return;
      }
      cfg.difficulty = payload.difficulty;
    }
    broadcastLobby();
  }

  function handleStart(client) {
    if (!client.isHost) { sendRejectTo(client, '只有房主可以开局'); return; }
    const r = startGame();
    if (!r.ok) sendRejectTo(client, r.why);
  }

  function handleAction(client, payload) {
    if (room.state !== 'playing' || !room.g) { sendRejectTo(client, '对局未开始'); return; }
    if (client.kind !== 'seat' || client.enginePid == null) { sendRejectTo(client, '观战者不能行动'); return; }
    if (client.left) { sendRejectTo(client, '已离场'); return; }
    const pid = client.enginePid;
    const args = (payload.args && typeof payload.args === 'object') ? payload.args : {};
    const v = protocol.validateAction(payload.kind, args);
    if (!v.ok) { sendRejectTo(client, v.why); return; }
    const kind = payload.kind;

    // 权威守卫 1：必须处于本人行动阶段的动作（引擎未给 endTurn/discardCards 等加回合守卫）
    if (NEEDS_TURN.has(kind) && room.g.turn !== pid) { sendRejectTo(client, '非行动阶段'); return; }
    // 权威守卫 2：主公专属（lordRedraw/lordCanRedraw 引擎无 pid 参数, 由房间校验调用者）
    if (kind === 'lordRedraw' || kind === 'lordCanRedraw') {
      const lord = room.g.players.find((p) => p.identity === 'lord');
      if (!lord || lord.id !== pid) { sendRejectTo(client, '只有主公可以执行该操作'); return; }
    }
    // 权威守卫 3：进化选择需有本人未决 evo 提示（或处于本人行动阶段）
    if (kind === 'evolvePick' && room.g.turn !== pid && !hasPromptFor(pid, 'evo')) {
      sendRejectTo(client, '没有待处理的进化选择'); return;
    }

    const callArgs = [];
    for (const decl of v.action.args) {
      const nm = decl.replace(/\?$/, '');
      callArgs.push(nm === 'pid' ? pid : args[nm]); // pid 一律以会话座位为准（防伪造）
    }
    let result;
    try {
      if (kind === 'endTurn') engine.discardPhase(room.g, pid); // ACTIONS 注记：endTurn 前先弃至手牌上限
      result = v.fn(room.g, ...callArgs);
    } catch (e) {
      result = { ok: false, why: '服务器异常: ' + (e && e.message) };
    }
    // 引擎 void 函数（endTurn 等）与布尔查询（lordCanRedraw）视为成功
    if (result === undefined) result = { ok: true };
    else if (typeof result === 'boolean') result = { ok: true };
    if (!result || result.ok !== true) { sendRejectTo(client, (result && result.why) || '非法动作'); return; }
    sendToClient(client, 'ack', { ref: kind });

    if (kind === 'endTurn') { room.inHumanTurn = false; clearTurnTimer(); }
    if (kind === 'playerLeave') { client.left = true; maybeRotateAfterLeave(pid); }

    flushLog();
    broadcastState();
    if (room.g.over) { handleGameOver(); return; }
    pump();
  }

  function handleResponse(client, payload) {
    if (room.state !== 'playing' || !room.g) { sendRejectTo(client, '对局未开始'); return; }
    if (client.kind !== 'seat' || client.enginePid == null) { sendRejectTo(client, '观战者不能响应'); return; }
    const pid = client.enginePid;
    const promptId = payload.promptId;
    const kind = payload.kind;
    const value = (payload.value && typeof payload.value === 'object') ? payload.value : {};
    const rm = RESPONSE_MAP[kind];
    if (!rm) { sendRejectTo(client, '未知响应类型: ' + String(kind)); return; }
    const entry = room.g.prompts.get(promptId);
    if (!entry || entry.pid !== pid) { sendRejectTo(client, '提示不存在或已解决'); return; }
    if (rm.accept.indexOf(entry.type) < 0) { sendRejectTo(client, '响应类型与提示不匹配'); return; }

    const callArgs = [];
    for (const decl of rm.args) {
      const nm = decl.replace(/\?$/, '');
      callArgs.push(nm === 'pid' ? pid : value[nm]);
    }
    callArgs.push(promptId);
    let result;
    try { result = engine[rm.fn](room.g, ...callArgs); }
    catch (e) { result = { ok: false, why: '服务器异常: ' + (e && e.message) }; }
    dlog('response', kind, promptId, 'by=' + client.name, 'ok=' + !!(result && result.ok));
    if (!result || result.ok !== true) { sendRejectTo(client, (result && result.why) || '非法响应'); return; }
    sendToClient(client, 'ack', { ref: promptId });

    // 该提示已解析 → 撤计时
    if (room.promptTimers.has(promptId)) { clearTimeout(room.promptTimers.get(promptId)); room.promptTimers.delete(promptId); }
    room.promptDeadlines.delete(promptId);
    room.sentPrompts.delete(promptId);

    flushLog();
    broadcastState();
    if (room.g.over) { handleGameOver(); return; }
    pump();
  }

  function handleChat(client, payload) {
    const text = String(payload.text || '').slice(0, O.chatMaxLen);
    if (!text.trim()) { sendRejectTo(client, '空消息'); return; }
    broadcast('event', { kind: 'chat', payload: { from: client.kind === 'seat' ? client.seat : -1, name: client.name, text } });
  }

  function handleLeave(client) {
    if (client.kind === 'spec') {
      room.spectators.delete(client.clientId);
      room.clients.delete(client.clientId);
      room.tokenIndex.delete(client.token);
      if (client.link && client.link.linkId) room.linkClients.delete(client.link.linkId);
      sendToClient(client, 'ack', { ref: 'leave' });
      return;
    }
    if (room.state === 'lobby') {
      sendToClient(client, 'ack', { ref: 'leave' });
      room.seats[client.seat] = null;
      room.clients.delete(client.clientId);
      room.tokenIndex.delete(client.token);
      if (client.link && client.link.linkId) room.linkClients.delete(client.link.linkId);
      transferHostIfNeeded();
      broadcastLobby();
      return;
    }
    // 对局中离场 = 投降（playerLeave 语义）
    if (!client.left && room.g && client.enginePid != null && !room.g.players[client.enginePid].dead) {
      engine.playerLeave(room.g, client.enginePid);
      client.left = true;
      flushLog();
      broadcastState();
      maybeRotateAfterLeave(client.enginePid);
      if (room.g.over) { handleGameOver(); return; }
      pump();
    }
    sendToClient(client, 'ack', { ref: 'leave' });
  }

  /** 离场者若正处于行动回合 → 立即弃牌+轮转, 防卡回合 */
  function maybeRotateAfterLeave(pid) {
    if (room.g && room.g.turn === pid && room.inHumanTurn) {
      room.inHumanTurn = false;
      clearTurnTimer();
      engine.discardPhase(room.g, pid);
      engine.endTurn(room.g, pid);
      flushLog();
      broadcastState();
    }
  }

  /** 统一入站入口（WS / 长轮询 / 进程内测试共用） */
  function handleMessage(link, kind, payload) {
    if (room.shut) return;
    payload = payload || {};
    const now = Date.now();
    if (kind === 'join') { handleJoin(link, payload, now); return; }

    let client = null;
    if (link && link.linkId) client = room.linkClients.get(link.linkId);
    else if (link && link.kind === 'lp' && payload.clientId) client = room.clients.get(payload.clientId);
    if (!client) { sendJoinReject(link, payload, '未入座: 请先 join'); return; }
    client.lastSeen = now;

    switch (kind) {
      case 'config': handleConfig(client, payload); break;
      case 'start': handleStart(client); break;
      case 'action': handleAction(client, payload); break;
      case 'response': handleResponse(client, payload); break;
      case 'chat': handleChat(client, payload); break;
      case 'ping': sendToClient(client, 'pong', {}); break;
      case 'leave': handleLeave(client); break;
      default: sendRejectTo(client, '未知消息类型: ' + kind);
    }
  }

  /* ---------------- 传输挂接（p4a 契约） ---------------- */
  function attachWs(ws) {
    room.ws = ws;
    ws.onMessage = (connId, text) => {
      const dec = protocol.decodeMsg(text);
      if (!dec.ok) {
        try { ws.send(connId, protocol.encodeMsg('reject', { why: dec.why })); } catch (e) { /* 忽略 */ }
        return;
      }
      let link = room.wsLinks.get(connId);
      if (!link) {
        link = {
          linkId: 'ws:' + connId, kind: 'ws',
          send: (t) => ws.send(connId, t),
          close: (code, reason) => ws.close(connId, code, reason),
        };
        room.wsLinks.set(connId, link);
      }
      handleMessage(link, dec.kind, dec.payload);
    };
    ws.onClose = (connId) => {
      room.wsLinks.delete(connId);
      const client = room.linkClients.get('ws:' + connId);
      if (client) markDisconnected(client);
    };
    ws.onPong = (connId) => {
      const client = room.linkClients.get('ws:' + connId);
      if (client) client.lastSeen = Date.now();
    };
  }

  function attachLongPoll(lp) {
    room.lp = lp;
    lp.onMessage = ({ kind, payload }) => {
      handleMessage({ kind: 'lp', linkId: null }, kind, payload);
    };
  }

  /* ---------------- 断线 / 宽限期 / 心跳 ---------------- */
  function clearGrace(client) {
    if (client.graceTimer) { clearTimeout(client.graceTimer); client.graceTimer = null; }
  }

  function markDisconnected(client) {
    if (!client || !client.connected) return;
    client.connected = false;
    client.disconnectedAt = Date.now();
    if (client.link && client.link.linkId) room.linkClients.delete(client.link.linkId);
    client.link = null;
    client.transport = null;
    clearGrace(client);
    client.graceTimer = setTimeout(() => graceExpire(client), O.graceMs);
  }

  function graceExpire(client) {
    client.graceTimer = null;
    if (client.connected || room.shut) return;
    if (client.kind === 'spec') {
      room.spectators.delete(client.clientId);
      room.clients.delete(client.clientId);
      room.tokenIndex.delete(client.token);
      return;
    }
    if (room.state === 'lobby') {
      if (room.seats[client.seat] === client) room.seats[client.seat] = null;
      room.clients.delete(client.clientId);
      room.tokenIndex.delete(client.token);
      transferHostIfNeeded();
      broadcastLobby();
      return;
    }
    if (room.state === 'playing' && !client.left && client.enginePid != null) {
      const p = room.g.players[client.enginePid];
      if (!p.dead) {
        engine.playerLeave(room.g, client.enginePid);
        client.left = true;
        flushLog();
        broadcastState();
        broadcast('event', {
          kind: 'death',
          payload: { seat: client.seat, identity: engine.IDENTITIES[p.identity] ? engine.IDENTITIES[p.identity].name : p.identity, revealed: true },
        });
        maybeRotateAfterLeave(client.enginePid);
        if (room.g.over) handleGameOver(); else pump();
      }
    }
  }

  function heartbeatSweep() {
    const now = Date.now();
    const cutoff = now - O.heartbeatMs * 2 - 1000;
    for (const c of room.clients.values()) {
      if (c.connected && c.lastSeen < cutoff) markDisconnected(c);
    }
  }

  /* ---------------- 自动开局（single 模式） ---------------- */
  function maybeAutoStart() {
    if (!O.autoStart || room.state !== 'lobby') return;
    const cfg = (typeof O.autoStart === 'function' ? O.autoStart() : O.autoStart) || {};
    const need = cfg.humanCount != null ? cfg.humanCount : 1;
    if (room.seats.filter(Boolean).length < need) return;
    if (cfg.humanCount != null) room.config.humanCount = cfg.humanCount;
    if (cfg.aiFill != null) room.config.aiFill = cfg.aiFill;
    if (cfg.randomIdentity != null) room.config.randomIdentity = !!cfg.randomIdentity;
    if (cfg.difficulty) room.config.difficulty = cfg.difficulty;
    startGame();
  }

  /* ---------------- 关停 ---------------- */
  function shutdown(reason) {
    if (room.shut) return;
    room.shut = true;
    clearTurnTimer();
    for (const t of room.promptTimers.values()) clearTimeout(t);
    room.promptTimers.clear();
    room.promptDeadlines.clear();
    room.sentPrompts.clear();
    for (const c of room.clients.values()) clearGrace(c);
    if (room.heartbeatTimer) { clearInterval(room.heartbeatTimer); room.heartbeatTimer = null; }
    try {
      broadcast('event', { kind: 'shutdown', payload: { reason: reason || '服务器关闭' } });
    } catch (e) { /* 传输已坏, 忽略 */ }
    for (const c of room.clients.values()) {
      if (c.link && c.link.close) { try { c.link.close(1001, 'server shutdown'); } catch (e) { /* 忽略 */ } }
    }
    room.clients.clear();
    room.spectators.clear();
    room.tokenIndex.clear();
    room.linkClients.clear();
    room.wsLinks.clear();
    room.ws = null;
    room.lp = null;
  }

  /* ---------------- 组装 ---------------- */
  const api = {
    get state() { return room.state; },
    get config() { return room.config; },
    get g() { return room.g; },
    get game() { return room.g; },
    get seats() { return room.seats; },
    get inHumanTurn() { return room.inHumanTurn; },
    get turnPid() { return room.turnPid; },
    mode: room.mode,
    get viewSeq() { return room.viewSeq; },
    get spectators() { return room.spectators; },
    handleMessage,
    attachWs,
    attachLongPoll,
    markDisconnected,
    shutdown,
    lobbyInfo,
    pump,
    startGame,
    clientByEnginePid,
    hasPromptFor,
  };

  room.heartbeatTimer = setInterval(heartbeatSweep, Math.max(1000, O.heartbeatMs));

  return api;
}

module.exports = { createRoom, MAX_SEATS, RESPONSE_MAP };
