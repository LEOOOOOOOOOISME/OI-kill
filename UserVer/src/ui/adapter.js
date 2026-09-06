/*!
 * adapter.js — 《OI杀》v4 客户端适配层（P6b-v2a）
 *
 * 职责：把「房间层协议」(room.js/ws-server/longpoll/protocol) 与「引擎」统一成 UI 可用的
 * 传输无关门面。零依赖（仅 globalThis.WebSocket / fetch / setTimeout，Node 24 与浏览器通用）。
 *
 * 两个工厂：
 *   1. createLocalClient(O, opts)  — 引擎同页直驱（单机模式）：
 *      门面方法直接调用引擎函数并同步派发事件；getView() === O.publicView(g, pid)。
 *      AI 回合由 O.drive 异步泵驱动（mirror room.js pump：人类回合/挂起提示即暂停）。
 *   2. createNetClient(opts)       — 网络客户端（WebSocket 主、长轮询兜底）：
 *      join(name,{spectate}) 带 nonce 关联 hello；WS 掉线自动切长轮询
 *      (GET /poll?since&to=clientId 过滤 + POST /act, 会话经 sessionToken 重连)；
 *      收到 event kind:'shutdown' 停止一切重连。start(config) = config + start 两连发。
 *
 * 门面统一形状：{ join, start, config, chat, leave, ping, sendAction, sendResponse,
 *                  subscribe, getState, getView, getSelf, stop, ... }
 *  subscribe(cb) 收到 {type:'state'|'prompt'|'event'|'setup'|'lobby'|'hello'|'reject'|'ack'|'pong', ...}。
 *
 * 提示语义 type 在 payload 内（信封 type 为传输保留字段）；sendResponse(promptId, value) 由本层
 * 依 payload.type 推导响应 kind（dodge/counter/…），evo/discard 两类自动转成
 * evolvePick / discardCards 动作（与房间层 RESPONSE_MAP 同口径，见 p6b 报告）。
 */
(function (root) {
  'use strict';

  const VERSION = 'p6b-1';

  /* ---------------- 共享小工具 ---------------- */
  const TYPE_TO_KIND = {
    dodge: 'dodge', counter: 'counter', cold: 'cold', bbst: 'bbst', chase: 'chase',
    harvest: 'harvest', guard: 'guard', aoeResp: 'aoeResp', argueResp: 'argueResp', report: 'report',
  };
  const NO_PID_ACTIONS = new Set(['lordRedraw', 'lordCanRedraw']);

  function nowMs() { return Date.now(); }

  /** 引擎提示条目 → prompt 信封 payload（与 room.js sendPrompt 同口径：剥 id/pid/deadlineMs/createdAt） */
  function promptPayload(entry) {
    const payload = {};
    for (const k of Object.keys(entry)) {
      if (k === 'id' || k === 'pid' || k === 'deadlineMs' || k === 'createdAt') continue;
      payload[k] = entry[k];
    }
    return payload;
  }

  function promptTimeoutMs(entry, fallback) {
    const dl = entry && typeof entry.deadlineMs === 'number' ? entry.deadlineMs : (fallback || 10000);
    const age = entry && typeof entry.createdAt === 'number' ? Math.max(0, nowMs() - entry.createdAt) : 0;
    return Math.max(0, Math.ceil(dl - age));
  }

  /** 由提示消息 + 应答值推导响应 kind（卖队友转嫁同意复用 dodge 全参路径, 与 room-test 同口径） */
  function deriveResponseKind(promptMsg, value) {
    const payload = (promptMsg && promptMsg.payload) || {};
    if (value && typeof value === 'object' && value.kind) return value.kind;
    if (value && typeof value === 'object' && value.targetId !== undefined && value.targetId !== null) return 'betray';
    if (payload.ctx && payload.ctx.betrayConsent) return 'dodge'; // 同意询问: respondDodge(g,pid,yes,helperId,promptId) 全参路径
    return TYPE_TO_KIND[payload.type] || payload.type || 'dodge';
  }

  /** 缺省应答值（"否/放弃"合法路径, 与 room-test defaultValueFor 同口径） */
  function defaultResponseValue(type, value) {
    if (value !== undefined && value !== null) return value;
    switch (type) {
      case 'harvest': return { choiceKey: null };
      case 'report': return { cardKey: null };
      default: return { yes: false };
    }
  }

  /* ============================================================
   * 一、本地客户端（引擎同页直驱, 单机模式）
   * ============================================================ */
  function createLocalClient(O, opts) {
    if (!O || typeof O.publicView !== 'function' || typeof O.createGame !== 'function' ||
        typeof O.drive !== 'function' || typeof O.timeoutPrompt !== 'function') {
      throw new Error('[adapter] createLocalClient 需要引擎导出对象(OIKill, 含 publicView/createGame/drive/timeoutPrompt)');
    }
    opts = opts || {};
    const HUMAN_PID = (opts.pid !== undefined && opts.pid !== null) ? opts.pid : 0;

    const st = {
      name: opts.name || '你',
      spectate: false,
      config: {
        humanCount: opts.humanCount !== undefined ? opts.humanCount : 6,
        aiFill: opts.aiFill !== undefined ? opts.aiFill : null,
        randomIdentity: !!opts.randomIdentity,
        difficulty: opts.difficulty || 'normal',
      },
      g: null, viewSeq: 0, stopped: false, gameOverSent: false,
      subs: [],
      promptTimers: new Map(),
      promptDeadlines: new Map(),
      sentPrompts: new Set(),
      promptsById: new Map(),
      pumpBusy: false, pumpQueued: false, inHumanTurn: false,
      lastLobby: null, lastSetup: null, lastState: null, lastHello: null,
    };

    function emit(msg) { for (const cb of st.subs.slice()) { try { cb(msg); } catch (e) { /* 回调异常不扩散 */ } } }

    function lobbyInfo() {
      const players = st.spectate ? [] : [{ seatId: 0, name: st.name, isHost: true, connected: true }];
      return {
        players, config: Object.assign({}, st.config),
        canStart: !st.spectate,
        state: st.g ? (st.g.over ? 'ended' : 'playing') : 'lobby',
      };
    }

    function sendState() {
      if (!st.g) return;
      st.viewSeq++;
      st.lastState = {
        type: 'state', viewSeq: st.viewSeq,
        view: O.publicView(st.g, HUMAN_PID),
        deadline: { turn: 45000, resp: 10000 },
      };
      emit(st.lastState);
    }

    /* 把 g.log 增量行事件化（人类动作发生在 drive 之外时使用; 与 room.js flushLog 同口径） */
    function flushLog() {
      if (!st.g) return;
      const start = st.g._evCursor || 0;
      for (let i = start; i < st.g.log.length; i++) {
        st.g._evCursor = i + 1;
        const l = st.g.log[i];
        emit({ type: 'event', kind: 'log', payload: { round: l.t, txt: l.txt, cls: l.cls || '' } });
      }
    }

    function handleGameOver() {
      if (st.gameOverSent || !st.g) return;
      st.gameOverSent = true;
      emit({
        type: 'event', kind: 'gameover',
        payload: { winner: st.g.winner, identity: null, achievements: st.g.achievements ? Object.assign({}, st.g.achievements) : null },
      });
    }

    /** 为未决的人类提示补发消息 + 本地权威计时（mirror room.js ensurePrompt） */
    function ensurePrompts() {
      if (!st.g) return false;
      let any = false;
      for (const pr of Array.from(st.g.prompts.values())) {
        if (pr.pid !== HUMAN_PID || st.spectate) continue;
        any = true;
        if (st.sentPrompts.has(pr.id)) continue;
        st.sentPrompts.add(pr.id);
        const deadline = st.promptDeadlines.has(pr.id)
          ? st.promptDeadlines.get(pr.id)
          : nowMs() + Math.max(1, (typeof pr.deadlineMs === 'number' ? pr.deadlineMs : 10000));
        st.promptDeadlines.set(pr.id, deadline);
        const dur = Math.max(1, deadline - nowMs());
        st.promptTimers.set(pr.id, setTimeout(() => { onPromptTimeout(pr.id); }, dur));
        const msg = {
          type: 'prompt', promptId: pr.id, pid: pr.pid,
          payload: promptPayload(pr),
          timeoutMs: Math.max(0, Math.ceil(deadline - nowMs())),
        };
        st.promptsById.set(pr.id, msg);
        emit(msg);
      }
      return any;
    }

    function onPromptTimeout(promptId) {
      st.promptTimers.delete(promptId);
      st.promptDeadlines.delete(promptId);
      st.sentPrompts.delete(promptId);
      st.promptsById.delete(promptId);
      if (!st.g || !st.g.prompts.has(promptId)) return;
      O.timeoutPrompt(st.g, promptId); // 默认"否/放弃"
      flushLog();
      sendState();
      if (st.g.over) { handleGameOver(); return; }
      pump();
    }

    /* AI 泵（mirror room.js pump 的守卫: 人类回合且无未决提示 → 等待人类动作） */
    async function pump() {
      if (st.stopped || !st.g || st.g.over || st.spectate) return;
      if (st.pumpBusy) { st.pumpQueued = true; return; }
      st.pumpBusy = true;
      try {
        for (let guard = 0; guard < 200000; guard++) {
          if (st.stopped || st.g.over) break;
          if (st.inHumanTurn && O.promptCount(st.g) === 0) break;
          const res = await O.drive(st.g, {
            thinkMs: opts.thinkMs !== undefined ? opts.thinkMs : null,
            difficulty: opts.thinkMs === undefined ? st.config.difficulty : undefined,
            onEvent: (e) => {
              if (e && e.kind === 'log') {
                st.g._evCursor = st.g.log.length; // 防 drive 内部游标与 flushLog 重复投递
                emit({ type: 'event', kind: 'log', payload: { round: e.t, txt: e.txt, cls: e.cls || '' } });
              }
            },
            onState: () => { sendState(); },
          });
          if (res.status === 'prompt') {
            let anyHuman = false;
            for (const pr of Array.from(st.g.prompts.values())) {
              if (st.g.isHuman(pr.pid)) anyHuman = true;
              else if (st.g.prompts.has(pr.id)) { O.timeoutPrompt(st.g, pr.id); flushLog(); sendState(); } // AI 提示防御结算
            }
            if (anyHuman) { ensurePrompts(); break; }
            continue;
          }
          if (res.status === 'human-turn') {
            if (st.g.turn !== res.pid || !st.g.isHuman(res.pid) || st.inHumanTurn) continue;
            st.inHumanTurn = true;
            sendState();
            break;
          }
          break; // over | cap
        }
      } finally { st.pumpBusy = false; }
      if (st.g && st.g.over) handleGameOver();
      else if (st.pumpQueued) { st.pumpQueued = false; pump(); }
    }

    function join(payload) {
      payload = payload || {};
      if (payload.name) st.name = String(payload.name).slice(0, 20).trim() || st.name;
      st.spectate = !!payload.spectate;
      const self = st.spectate
        ? { pid: null, seatId: null, name: st.name, isHost: false, clientId: 'local:spec' }
        : { pid: HUMAN_PID, seatId: 0, name: st.name, isHost: true, clientId: 'local:' + HUMAN_PID };
      st.self = self;
      const hello = {
        type: 'hello', proto: 1, mode: 'local', self,
        sessionToken: 'local-token', nonce: payload.nonce !== undefined ? payload.nonce : null,
      };
      st.lastHello = hello;
      emit(hello);                                    // 同步派发
      st.lastLobby = Object.assign({ type: 'lobby' }, lobbyInfo());
      emit(st.lastLobby);                             // 同步派发
      return Promise.resolve(hello);
    }

    function config(cfg) {
      if (!cfg || typeof cfg !== 'object') return;
      if (cfg.humanCount !== undefined) st.config.humanCount = cfg.humanCount;
      if (cfg.aiFill !== undefined) st.config.aiFill = cfg.aiFill;
      if (cfg.randomIdentity !== undefined) st.config.randomIdentity = !!cfg.randomIdentity;
      if (cfg.difficulty !== undefined) st.config.difficulty = cfg.difficulty;
      st.lastLobby = Object.assign({ type: 'lobby' }, lobbyInfo());
      emit(st.lastLobby);
    }

    function start(cfg) {
      if (st.spectate) {
        const why = '本地模式不支持观战';
        emit({ type: 'reject', why });
        return Promise.resolve({ ok: false, why });
      }
      if (st.g && !st.g.over) return Promise.resolve({ ok: false, why: '对局已开始' });
      config(cfg);
      const c = st.config;
      const aiFill = c.aiFill == null ? Math.max(0, 6 - c.humanCount) : c.aiFill;
      const total = Math.max(3, Math.min(6, c.humanCount + aiFill));
      // 单机模式: 仅 1 个真人(HUMAN_PID, 默认 0 号主公), 其余座位全部 AI 顶替
      const names = new Array(total);
      names[HUMAN_PID] = st.name;
      for (let i = 0; i < total; i++) if (i !== HUMAN_PID) names[i] = 'AI-' + (i + 1);

      for (const t of st.promptTimers.values()) clearTimeout(t);
      st.promptTimers.clear();
      st.promptDeadlines.clear();
      st.sentPrompts.clear();
      st.promptsById.clear();
      st.gameOverSent = false;
      st.g = O.createGame({ humans: [HUMAN_PID], seed: opts.seed });
      O.setup(st.g, names);
      st.g._evCursor = 0;
      st.inHumanTurn = false;
      st.viewSeq = 0;

      const me = st.g.players[HUMAN_PID];
      st.lastSetup = {
        type: 'setup',
        professions: st.g.players.map(p => (p ? { id: p.prof.id, name: p.prof.name, plain: p.prof.plain } : null)),
        myIdentity: me ? { id: me.identity, name: (O.IDENTITIES && O.IDENTITIES[me.identity]) ? O.IDENTITIES[me.identity].name : null } : null,
        lordPid: 0, lordEnginePid: 0,
        deckCount: st.g.deck.length,
        pid: HUMAN_PID, seatId: 0,
        seatToPid: Array.from({ length: total }, (_, i) => i),
        total,
      };
      emit(st.lastSetup);
      sendState();
      pump();
      return Promise.resolve({ ok: true, total });
    }

    function sendAction(kind, args) {
      if (!st.g) return Promise.resolve({ ok: false, why: '对局未开始' });
      args = (args && typeof args === 'object') ? args : {};
      const pid = HUMAN_PID;
      let result;
      try {
        switch (kind) {
          case 'endTurn':
            if (st.g.turn !== pid) { result = { ok: false, why: '非行动阶段' }; break; }
            O.discardPhase(st.g, pid);
            O.endTurn(st.g, pid);
            st.inHumanTurn = false;
            result = { ok: true };
            break;
          case 'lordRedraw': case 'lordCanRedraw':
            result = { ok: true, value: O[kind](st.g) };
            break;
          case 'evolvePick': result = O.evolvePick(st.g, pid, args.key); break;
          case 'discardCards': result = O.discardCards(st.g, pid, args.indices); break;
          case 'playCard': result = O.playCard(st.g, pid, args.cardIdx, args.targetId, args.targetId2); break;
          case 'equipCard': result = O.equipCard(st.g, pid, args.cardIdx); break;
          case 'deployUnit': result = O.deployUnit(st.g, pid, args.cardIdx); break;
          case 'unitAttack': result = O.unitAttack(st.g, pid, args.unitIdx, args.victimPid); break;
          case 'skillUse': result = O.skillUse(st.g, pid, args.name, args.targetId, args.targetId2); break;
          case 'discardFun': result = O.discardFun(st.g, pid, args.cardIdx, args.targetId); break;
          case 'kspAttack': result = O.kspAttack(st.g, pid, args.targetId); break;
          case 'fangAttack': result = O.fangAttack(st.g, pid, args.targetIds, args.cardIdx); break;
          case 'playerLeave': result = O.playerLeave(st.g, pid); break;
          default: result = { ok: false, why: '未知动作: ' + kind };
        }
      } catch (e) { result = { ok: false, why: '本地异常: ' + (e && e.message) }; }
      if (result === undefined) result = { ok: true };
      else if (typeof result === 'boolean') result = { ok: true };
      if (!result || result.ok !== true) {
        emit({ type: 'reject', why: (result && result.why) || '非法动作', ref: kind });
        return Promise.resolve(result);
      }
      emit({ type: 'ack', ref: kind });
      flushLog();
      sendState();
      if (st.g.over) { handleGameOver(); return Promise.resolve(result); }
      pump();
      return Promise.resolve(result);
    }

    function sendResponse(promptId, value) {
      if (!st.g) return Promise.resolve({ ok: false, why: '对局未开始' });
      const entry = st.g.prompts.get(promptId);
      if (!entry) return Promise.resolve({ ok: false, why: '提示不存在或已解决' });
      if (entry.pid !== HUMAN_PID) return Promise.resolve({ ok: false, why: '不是你的提示' });
      const t = entry.type;
      let result;
      try {
        if (t === 'evo') {
          result = O.evolvePick(st.g, HUMAN_PID, (value && value.key !== undefined) ? value.key : null);
        } else if (t === 'discard') {
          result = O.discardCards(st.g, HUMAN_PID, (value && Array.isArray(value.indices)) ? value.indices : []);
        } else {
          const pmMsg = { payload: promptPayload(entry) };
          const kind = deriveResponseKind(pmMsg, value);
          const v = defaultResponseValue(t, value);
          switch (kind) {
            case 'dodge': result = O.respondDodge(st.g, HUMAN_PID, !!v.yes, v.helperId, promptId); break;
            case 'betray': result = O.respondBetray(st.g, HUMAN_PID, v.targetId, promptId); break;
            case 'counter': result = O.respondCounter(st.g, HUMAN_PID, !!v.yes, promptId); break;
            case 'cold': result = O.respondCold(st.g, HUMAN_PID, !!v.yes, promptId); break;
            case 'bbst': result = O.respondBbst(st.g, HUMAN_PID, !!v.yes, promptId); break;
            case 'chase': result = O.respondChase(st.g, HUMAN_PID, !!v.yes, promptId); break;
            case 'harvest': result = O.respondHarvest(st.g, HUMAN_PID, v.choiceKey, promptId); break;
            case 'guard': result = O.respondGuard(st.g, HUMAN_PID, !!v.yes, promptId); break;
            case 'aoeResp': case 'argueResp': result = O.respondAoeResp(st.g, HUMAN_PID, !!v.yes, promptId); break;
            case 'report': result = O.respondReport(st.g, HUMAN_PID, v.cardKey, promptId); break;
            default: result = { ok: false, why: '未知响应类型: ' + kind };
          }
        }
      } catch (e) { result = { ok: false, why: '本地异常: ' + (e && e.message) }; }
      if (!result || result.ok !== true) {
        emit({ type: 'reject', why: (result && result.why) || '非法响应', ref: promptId });
        return Promise.resolve(result);
      }
      if (st.promptTimers.has(promptId)) { clearTimeout(st.promptTimers.get(promptId)); st.promptTimers.delete(promptId); }
      st.promptDeadlines.delete(promptId);
      st.sentPrompts.delete(promptId);
      st.promptsById.delete(promptId);
      emit({ type: 'ack', ref: promptId });
      flushLog();
      sendState();
      if (st.g.over) { handleGameOver(); return Promise.resolve(result); }
      pump();
      return Promise.resolve(result);
    }

    function chat(text) {
      emit({ type: 'event', kind: 'chat', payload: { from: st.spectate ? -1 : 0, name: st.name, text: String(text || '').slice(0, 500) } });
    }

    function stop() {
      st.stopped = true;
      for (const t of st.promptTimers.values()) clearTimeout(t);
      st.promptTimers.clear();
      st.promptDeadlines.clear();
    }

    return {
      kind: 'local',
      join, start, config, chat, leave: stop, ping: () => {},
      sendAction, sendResponse,
      subscribe(cb) {
        if (typeof cb !== 'function') return () => {};
        st.subs.push(cb);
        return () => { const i = st.subs.indexOf(cb); if (i >= 0) st.subs.splice(i, 1); };
      },
      getState: () => st.lastState,
      getView: () => (st.g ? O.publicView(st.g, HUMAN_PID) : null),
      getLobby: () => st.lastLobby,
      getSetup: () => st.lastSetup,
      getSelf: () => st.self,
      getGame: () => st.g,
      stop,
    };
  }

  /* ============================================================
   * 二、网络客户端（WebSocket 主, 长轮询自动兜底）
   * ============================================================ */
  function createNetClient(opts) {
    opts = opts || {};
    const base = String(opts.url || (typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1')).replace(/\/+$/, '');
    const wsUrl = opts.wsUrl || base.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
    const pollUrl = opts.pollUrl || (base + '/poll');
    const actUrl = opts.actUrl || (base + '/act');
    const fetchFn = opts.fetch || (typeof fetch === 'function' ? fetch : globalThis.fetch);
    const WS = opts.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : globalThis.WebSocket);

    const S = {
      mode: opts.transport === 'lp' ? 'lp' : 'ws',
      ws: null, wsReady: false,
      self: null, token: null, clientId: null,
      nonceSeq: 0,
      pendingJoin: null,        // {nonce, resolve, reject, timer}
      joinSeq: null,            // lp: 本次 join 握手 hello 的 seq（此前事件一律抑制）
      lastSeq: 0,               // lp: /poll?since 游标
      stopped: false, shut: false,
      everJoined: false,
      outbox: [],
      subs: [],
      lastLobby: null, lastSetup: null, lastState: null, lastHello: null, lastGameOver: null,
      promptsById: new Map(),
      ackWaiters: [],
      pollTimer: null, keepaliveTimer: null, pollBusy: false,
    };

    function currentPid() {
      if (S.lastSetup && S.lastSetup.pid !== undefined && S.lastSetup.pid !== null) return S.lastSetup.pid;
      if (S.self && S.self.pid !== undefined && S.self.pid !== null) return S.self.pid;
      return 0;
    }

    function deliver(m) {
      switch (m.type) {
        case 'state': S.lastState = m; break;
        case 'lobby': S.lastLobby = m; break;
        case 'setup': S.lastSetup = m; break;
        case 'hello': S.lastHello = m; break;
        case 'prompt': S.promptsById.set(m.promptId, m); break;
        case 'event': if (m.kind === 'gameover') S.lastGameOver = m; break;
        default: break;
      }
      for (const cb of S.subs.slice()) { try { cb(m); } catch (e) { /* 回调异常不扩散 */ } }
    }

    function emitLocal(m) { deliver(m); }

    function settleAck(m) {
      const i = S.ackWaiters.findIndex(w => w.ref === m.ref);
      if (i >= 0) {
        const w = S.ackWaiters.splice(i, 1)[0];
        if (w.timer) clearTimeout(w.timer);
        w.resolve(m);
      }
    }

    function teardown() {
      S.stopped = true;
      if (S.pollTimer) { clearTimeout(S.pollTimer); S.pollTimer = null; }
      if (S.keepaliveTimer) { clearInterval(S.keepaliveTimer); S.keepaliveTimer = null; }
      S.outbox.length = 0;
      for (const w of S.ackWaiters) { if (w.timer) clearTimeout(w.timer); w.resolve(null); }
      S.ackWaiters.length = 0;
      if (S.ws) {
        try { S.ws.close(1000, 'client stop'); } catch (e) { /* 忽略 */ }
        S.ws = null; S.wsReady = false;
      }
    }

    function onServerMsg(m) {
      if (!m || typeof m !== 'object') return;
      if (m.type === 'hello') {
        const pj = S.pendingJoin;
        const match = pj && (m.nonce === undefined || m.nonce === null || m.nonce === pj.nonce);
        if (pj && !match) return;                          // lp 共享流里别人的 hello
        S.self = m.self || S.self;
        if (m.sessionToken) S.token = m.sessionToken;
        if (m.self && m.self.clientId !== undefined) S.clientId = m.self.clientId;
        S.everJoined = true;
        if (S.mode === 'lp' && typeof m.seq === 'number') S.joinSeq = m.seq;
        if (pj) { S.pendingJoin = null; if (pj.timer) clearTimeout(pj.timer); pj.resolve(m); }
        deliver(m);
        return;
      }
      if (m.type === 'reject' && S.pendingJoin && m.ref !== undefined && m.ref === S.pendingJoin.nonce) {
        const pj = S.pendingJoin;
        S.pendingJoin = null;
        if (pj.timer) clearTimeout(pj.timer);
        pj.reject(new Error(m.why || 'join 被拒绝'));
        deliver(m);
        return;
      }
      if (m.type === 'event' && m.kind === 'shutdown') {
        S.shut = true;                                    // 关停广播: 停止一切重连/轮询
        teardown();
      }
      if (m.type === 'ack' && m.ref !== undefined) settleAck(m);
      deliver(m);
    }

    /* ---------------- 长轮询 ---------------- */
    function lpForMe(ev) {
      if (S.mode !== 'lp') return false;
      if (ev.type === 'hello') {
        return !!S.pendingJoin && (ev.nonce === undefined || ev.nonce === null || ev.nonce === S.pendingJoin.nonce);
      }
      if (ev.type === 'reject' && S.pendingJoin && ev.ref !== undefined && ev.ref === S.pendingJoin.nonce) return true;
      if (S.joinSeq === null) return false;               // 本次 join 握手未完成: 一律抑制
      if (typeof ev.seq === 'number' && ev.seq <= S.joinSeq) return false; // 握手前的历史事件
      if (ev.to === '*') return true;
      if (ev.to === S.clientId) return true;
      return false;
    }

    function ensurePoll() {
      if (S.mode !== 'lp' || S.stopped || S.pollBusy) return;
      if (!(S.pendingJoin || S.everJoined)) return;
      if (S.pollTimer) { clearTimeout(S.pollTimer); S.pollTimer = null; } // 防遗留定时器并发拉取
      pollOnce();
    }

    async function pollOnce() {
      if (S.mode !== 'lp' || S.stopped) { S.pollBusy = false; return; }
      if (S.pollBusy) return; // 单飞轮询: 同一时刻只允许一个 /poll 在途
      S.pollBusy = true;
      try {
        const res = await fetchFn(pollUrl + '?since=' + S.lastSeq, { method: 'GET', headers: { 'Cache-Control': 'no-cache' } });
        const j = await res.json();
        const evs = Array.isArray(j && j.events) ? j.events : [];
        for (const ev of evs) {
          if (typeof ev.seq === 'number' && ev.seq > S.lastSeq) S.lastSeq = ev.seq;
          if (lpForMe(ev)) onServerMsg(ev);
        }
      } catch (e) { /* 网络抖动: 稍后重试 */ }
      S.pollBusy = false;
      if (S.mode === 'lp' && !S.stopped) {
        S.pollTimer = setTimeout(() => { S.pollTimer = null; pollOnce(); }, (opts.pollGapMs !== undefined ? opts.pollGapMs : 120));
      }
    }

    async function lpPost(payload) {
      const body = Object.assign({}, payload);
      if (body.type !== 'join' && S.clientId) body.clientId = S.clientId; // lp 入站需 clientId 定位会话
      try {
        const res = await fetchFn(actUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await res.json().catch(() => ({}));
        if (j && j.ok === false) emitLocal({ type: 'reject', why: j.why || 'HTTP 提交失败' });
      } catch (e) {
        emitLocal({ type: 'reject', why: '长轮询提交失败: ' + (e && e.message) });
      }
      ensurePoll();
    }

    /* ---------------- WebSocket ---------------- */
    function flushOutbox() {
      while (S.outbox.length) {
        const item = S.outbox[0];
        if (S.mode === 'ws' && S.ws && S.wsReady) {
          S.outbox.shift();
          item.sent = true;
          try { S.ws.send(JSON.stringify(item.payload)); } catch (e) { /* onclose 接管 */ }
        } else if (S.mode === 'lp') {
          S.outbox.shift();
          item.sent = true;
          lpPost(item.payload);
        } else {
          break; // ws 未就绪: 等 onopen
        }
      }
    }

    function wsConnect() {
      if (typeof WS !== 'function') { onWsGone(); return; }
      let W = null;
      try { W = new WS(wsUrl); }
      catch (e) { S.ws = null; S.wsReady = false; onWsGone(); return; }
      S.ws = W;
      S.wsReady = false;
      W.onopen = () => { S.wsReady = true; flushOutbox(); };
      W.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev && ev.data); } catch (e) { return; }
        onServerMsg(m);
      };
      W.onerror = () => { /* 等 onclose 统一处理 */ };
      W.onclose = () => {
        if (S.ws === W) { S.ws = null; S.wsReady = false; }
        onWsGone();
      };
    }

    /** WS 掉线 → 自动切长轮询; 已入座则携 sessionToken 续接会话 */
    function onWsGone() {
      if (S.stopped || S.shut) return;
      S.mode = 'lp';
      S.joinSeq = null;
      if (S.token && !S.pendingJoin) {
        const nonce = 'n-' + (++S.nonceSeq) + '-f' + Date.now().toString(36);
        S.pendingJoin = {
          nonce, resolve: () => {}, reject: () => {},
          timer: setTimeout(() => { S.pendingJoin = null; }, (opts.joinTimeoutMs || 20000)),
        };
        lpPost({ type: 'join', token: S.token, nonce });
      }
      flushOutbox(); // 未发出的排队消息改走 /act
      ensurePoll();
    }

    /* ---------------- 门面方法 ---------------- */
    function join(payload) {
      payload = payload || {};
      const nonce = 'n-' + (++S.nonceSeq) + '-' + Date.now().toString(36);
      if (S.pendingJoin) {
        const old = S.pendingJoin;
        S.pendingJoin = null;
        if (old.timer) clearTimeout(old.timer);
        old.reject(new Error('join 被新的 join 覆盖'));
      }
      const p = new Promise((resolve, reject) => {
        S.pendingJoin = {
          nonce, resolve, reject,
          timer: setTimeout(() => {
            if (S.pendingJoin && S.pendingJoin.nonce === nonce) {
              S.pendingJoin = null;
              reject(new Error('join 超时(未收到 hello)'));
            }
          }, (opts.joinTimeoutMs || 20000)),
        };
      });
      const msg = { type: 'join', name: payload.name, nonce };
      if (payload.spectate) msg.spectate = true;
      if (payload.token) msg.token = payload.token;
      S.outbox.push({ payload: msg, nonce, sent: false });
      if (S.mode === 'ws' && !S.ws) wsConnect();
      flushOutbox();
      ensurePoll();
      return p;
    }

    function sendEnvelope(msg) {
      S.outbox.push({ payload: msg, sent: false });
      flushOutbox();
    }

    function registerAck(ref, timeoutMs) {
      return new Promise((resolve) => {
        const w = { ref, resolve, timer: null };
        w.timer = setTimeout(() => {
          const i = S.ackWaiters.indexOf(w);
          if (i >= 0) S.ackWaiters.splice(i, 1);
          resolve(null); // 超时: 以 null 表示未收到 ack
        }, timeoutMs);
        S.ackWaiters.push(w);
      });
    }

    function sendAction(kind, args) {
      args = (args && typeof args === 'object') ? Object.assign({}, args) : {};
      if (!NO_PID_ACTIONS.has(kind) && args.pid === undefined) args.pid = currentPid();
      const ackP = registerAck(kind, (opts.ackTimeoutMs || 10000));
      sendEnvelope({ type: 'action', kind, args });
      return ackP;
    }

    function sendResponse(promptId, value) {
      const pm = S.promptsById.get(promptId);
      if (!pm) return Promise.reject(new Error('未知提示: ' + promptId));
      const t = pm.payload && pm.payload.type;
      if (t === 'evo') {
        const v = (value && typeof value === 'object') ? value : {};
        return sendAction('evolvePick', { pid: currentPid(), key: (v.key !== undefined ? v.key : null) });
      }
      if (t === 'discard') {
        const v = (value && typeof value === 'object') ? value : {};
        return sendAction('discardCards', { pid: currentPid(), indices: (Array.isArray(v.indices) ? v.indices : []) });
      }
      const kind = deriveResponseKind(pm, value);
      const v = defaultResponseValue(t, value);
      const ackP = registerAck(promptId, (opts.ackTimeoutMs || 10000));
      sendEnvelope({ type: 'response', promptId, kind, value: v });
      return ackP;
    }

    function start(config) {
      if (config && typeof config === 'object') {
        const cfg = {};
        if (config.humanCount !== undefined) cfg.humanCount = config.humanCount;
        if (config.aiFill !== undefined) cfg.aiFill = config.aiFill;
        if (config.randomIdentity !== undefined) cfg.randomIdentity = config.randomIdentity;
        if (config.difficulty !== undefined) cfg.difficulty = config.difficulty;
        sendEnvelope(Object.assign({ type: 'config' }, cfg));
      }
      sendEnvelope({ type: 'start' });
      return Promise.resolve(true);
    }

    function config(cfg) {
      if (!cfg || typeof cfg !== 'object') return Promise.resolve(false);
      sendEnvelope(Object.assign({ type: 'config' }, cfg));
      return Promise.resolve(true);
    }

    function chat(text) { sendEnvelope({ type: 'chat', text: String(text || '').slice(0, 500) }); }
    function leave() { sendEnvelope({ type: 'leave' }); }
    function ping() { sendEnvelope({ type: 'ping' }); }

    function stop() {
      if (S.pendingJoin) {
        const pj = S.pendingJoin;
        S.pendingJoin = null;
        if (pj.timer) clearTimeout(pj.timer);
        pj.reject(new Error('client stopped'));
      }
      teardown();
    }

    /* ---------------- 保活 ---------------- */
    S.keepaliveTimer = setInterval(() => {
      if (S.stopped || S.shut || !S.everJoined) return;
      if (S.mode === 'ws' && S.ws && S.wsReady) {
        try { S.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) { /* 忽略 */ }
      } else if (S.mode === 'lp') {
        lpPost({ type: 'ping' });
      }
    }, (opts.keepaliveMs || 8000));

    if (S.mode === 'ws') wsConnect();

    return {
      kind: 'net',
      url: base, wsUrl, pollUrl, actUrl,
      join, start, config, chat, leave, ping,
      sendAction, sendResponse,
      subscribe(cb) {
        if (typeof cb !== 'function') return () => {};
        S.subs.push(cb);
        return () => { const i = S.subs.indexOf(cb); if (i >= 0) S.subs.splice(i, 1); };
      },
      getState: () => S.lastState,
      getView: () => (S.lastState ? S.lastState.view : null),
      getLobby: () => S.lastLobby,
      getSetup: () => S.lastSetup,
      getSelf: () => S.self,
      getTransport: () => S.mode,
      getStatus: () => ({
        transport: S.mode, stopped: S.stopped, shut: S.shut,
        joined: S.everJoined, clientId: S.clientId, self: S.self, token: S.token,
      }),
      reconnect() {
        if (!S.token || S.stopped) return Promise.reject(new Error('无会话或已停止'));
        const nonce = 'n-' + (++S.nonceSeq) + '-r' + Date.now().toString(36);
        if (S.pendingJoin) {
          const old = S.pendingJoin;
          S.pendingJoin = null;
          if (old.timer) clearTimeout(old.timer);
          old.reject(new Error('reconnect 覆盖旧 join'));
        }
        const p = new Promise((resolve, reject) => {
          S.pendingJoin = {
            nonce, resolve, reject,
            timer: setTimeout(() => {
              if (S.pendingJoin && S.pendingJoin.nonce === nonce) {
                S.pendingJoin = null;
                reject(new Error('reconnect 超时'));
              }
            }, (opts.joinTimeoutMs || 20000)),
          };
        });
        if (S.mode === 'ws' && S.ws && S.wsReady) {
          try { S.ws.send(JSON.stringify({ type: 'join', token: S.token, nonce })); }
          catch (e) { S.pendingJoin = null; reject(e); }
        } else {
          S.mode = 'lp';
          S.joinSeq = null;
          lpPost({ type: 'join', token: S.token, nonce });
          ensurePoll();
        }
        return p;
      },
      stop,
    };
  }

  /* ---------------- 导出 ---------------- */
  const api = { VERSION, createLocalClient, createNetClient };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else {
    const NS = root.OIKill = root.OIKill || {};
    const UI = NS.ui = NS.ui || {};
    UI.adapter = api; // 浏览器命名空间: OIKill.ui.adapter
  }
})(typeof window !== 'undefined' ? window : globalThis);
