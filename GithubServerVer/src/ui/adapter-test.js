/*!
 * adapter-test.js — 《OI杀》v4 适配层运行时自检（P6b-v2a）
 *
 * 运行：node src/ui/adapter-test.js（workdir = v4-web 根; 内部按 __dirname 定位模块）
 * 零依赖：仅 node 内置（http）+ 引擎 + 既有 net 模块 + 本目录 adapter/lobby。
 *
 * 覆盖：
 *   A. 本地客户端冒烟（createLocalClient: join/start/endTurn/getView/日志事件/同步 state）
 *   B. 网络主流程（进程内 room + 真实 http/ws/longpoll, 两 NetClient 走 ws 传输）:
 *      join 房主+客机(nonce 关联 hello) → 非房主 config 被拒 → start(2人类+4AI) → setup/state
 *      (各自 own view) → 房主 endTurn(ack) → 客机 endTurn(ack) → 提示定向(pid 匹配, 无串发) → 手动
 *      响应解析(ack) → 房主 WS 强制断线 → 自动切长轮询 token 续接 → 经 /poll+/act 继续收广播并
 *      行动(ack) → 自动托管至 gameover(identity=null) → room.shutdown 广播 → 双方停止重连 → 干净关停。
 *
 * 自动托管注意（thinkMs=0 时一整轮仅 ~150ms）：
 *   回合事件由房间层 noteTurn 去重(同 pid 连续不重发), 客户端每收到一次即代表新回合,
 *   不设时间窗去重（否则相邻两轮同一座位的回合事件会被吞掉 → 回合卡到权威超时）。
 *   手动场景用 manualNext 单回合让出, 不整体关闭自动托管（避免人为制造 60s 回合停滞窗口）。
 */
'use strict';

const http = require('node:http');

const engine = require('../../game.js');                    // v4-web 根聚合入口
const adapter = require('./adapter.js');
const lobby = require('./lobby.js');
const { createRoom } = require('../net/room.js');
const { createWsServer } = require('../net/ws-server.js');
const { createLongPoll } = require('../net/longpoll.js');

/* ---------------- 微型断言器 ---------------- */
const T = {
  pass: 0, fail: 0, fails: [],
  assert(cond, name, extra) {
    if (cond) { T.pass++; return true; }
    T.fail++;
    T.fails.push('✗ ' + name + (extra !== undefined ? ' — ' + extra : ''));
    return false;
  },
  summary() {
    const total = T.pass + T.fail;
    console.log('');
    console.log('==============================================');
    console.log('  adapter-test 汇总: 通过 ' + T.pass + '/' + total + '  失败 ' + T.fail);
    if (T.fail) console.log(T.fails.join('\n'));
    console.log('==============================================');
  },
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function waitFor(pred, timeoutMs) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(25);
  }
  return true;
}

function makeBox() {
  return {
    states: [], events: [], prompts: [], hellos: [], lobbies: [], setups: [], rejects: [],
    gameOver: null, autoEndCount: 0, autoRespCount: 0,
  };
}

function collect(c, box) {
  c.subscribe((m) => {
    if (!m || !m.type) return;
    if (m.type === 'state') box.states.push(m);
    else if (m.type === 'event') { box.events.push(m); if (m.kind === 'gameover') box.gameOver = m; }
    else if (m.type === 'prompt') box.prompts.push(m);
    else if (m.type === 'hello') box.hellos.push(m);
    else if (m.type === 'lobby') box.lobbies.push(m);
    else if (m.type === 'setup') box.setups.push(m);
    else if (m.type === 'reject') box.rejects.push(m);
  });
}

/**
 * 自动托管: 本人回合秒结束 + 提示默认"否"(可开关)。
 * cfg: { autoEnd, autoResponse, manualNext, onManualTurn }
 *   manualNext=true 时把下一个本人回合事件让给 onManualTurn(m)（一次性），不自动 endTurn。
 */
function armAuto(c, box, pid, cfg) {
  c.subscribe((m) => {
    if (!m || !m.type) return;
    if (m.type === 'event' && m.kind === 'turn' && m.payload && m.payload.pid === pid) {
      if (cfg.manualNext) {
        cfg.manualNext = false;
        if (cfg.onManualTurn) { const cb = cfg.onManualTurn; cfg.onManualTurn = null; cb(m); }
        return;
      }
      if (cfg.autoEnd) {
        box.autoEndCount++;
        c.sendAction('endTurn', { pid });
      }
    } else if (m.type === 'prompt' && cfg.autoResponse) {
      const t = m.payload && m.payload.type;
      box.autoRespCount++;
      if (t === 'evo') c.sendAction('evolvePick', { pid, key: null });
      else if (t === 'discard') c.sendAction('discardCards', { pid, indices: [] });
      else c.sendResponse(m.promptId, null).catch(() => { /* 竞态下的重复响应, 忽略 */ });
    }
  });
}

/** state 广播不变量: own view / others 无手牌 / viewSeq 不倒退 */
function checkInvariants(states, pid, label) {
  const bad = [];
  let prev = 0;
  for (const s of states) {
    if (!s.view || !s.view.me || s.view.me.id !== pid) { bad.push('own-view@' + s.viewSeq); continue; }
    for (const o of (s.view.others || [])) if (o && Object.prototype.hasOwnProperty.call(o, 'hand')) bad.push('others-hand@' + s.viewSeq);
    if (typeof s.viewSeq !== 'number' || s.viewSeq < prev) bad.push('viewSeq@' + prev + '->' + s.viewSeq);
    prev = s.viewSeq;
  }
  return {
    ok: bad.length === 0,
    name: '广播: ' + label + ' state 全程 own view/无手牌泄露/viewSeq 不倒退' + (bad.length ? ' (' + bad.join(';') + ')' : ''),
  };
}

/* ============================================================
 * A. 本地客户端冒烟
 * ============================================================ */
async function localSmoke() {
  const L = adapter.createLocalClient(engine, { name: '本地侠', seed: 7, thinkMs: 0 });
  const box = makeBox();
  collect(L, box);

  const h = await L.join({ name: '本地侠' });
  T.assert(!!h && h.self && h.self.pid === 0 && h.self.isHost === true, 'local: hello 同步派发(pid 0, 房主)');
  T.assert(box.hellos.length === 1, 'local: join 事件同步到达订阅者');

  const r = await L.start({ humanCount: 1, aiFill: 5, difficulty: 'normal' });
  T.assert(!!r && r.ok === true && box.setups.length === 1, 'local: start 后 setup 同步派发');
  T.assert(!!L.getState() && !!L.getState().view, 'local: getState() 可取全量快照');
  const v = L.getView();
  T.assert(!!v && v.me && v.me.id === 0 && Array.isArray(v.me.hand), 'local: getView() === publicView(g,0)');
  T.assert(box.states.length >= 1 && box.states[0].view.me.id === 0, 'local: state own view');

  const myTurn = await waitFor(() => box.states.some(s => s.view && s.view.isMyTurn), 10000);
  T.assert(myTurn, 'local: 进入本地行动回合');
  const er = await L.sendAction('endTurn', { pid: 0 });
  T.assert(!!er && er.ok === true, 'local: endTurn 引擎直驱 ok');
  const logs = await waitFor(() => box.events.some(e => e.kind === 'log'), 8000);
  T.assert(logs, 'local: 日志事件经 drive/flush 派发(' + box.events.filter(e => e.kind === 'log').length + ' 条)');

  L.stop();
  await sleep(50);
  T.assert(true, 'local: 干净停泵');
}

/* ============================================================
 * B. 网络主流程（进程内 room + ws 传输 + 长轮询兜底）
 * ============================================================ */
async function netFlow() {
  /* ---- 服务器组装（mirror room-test transportSmoke） ---- */
  const server = http.createServer();
  const lp = createLongPoll({ server, logInbound: false });
  const ws = createWsServer({ server });
  const room = createRoom({
    engine, mode: 'lan', thinkMs: 0, seed: 424242, debug: false,
    promptTimeoutMs: 5000, turnTimeoutMs: 30000, graceMs: 8000, heartbeatMs: 60000,
  });
  room.attachWs(ws);
  room.attachLongPoll(lp);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  T.assert(port > 0, 'net: 临时端口已绑定(127.0.0.1:' + port + ')');

  const url = 'http://127.0.0.1:' + port;
  const wsUrl = 'ws://127.0.0.1:' + port;
  const mk = () => adapter.createNetClient({ url, wsUrl, transport: 'ws', keepaliveMs: 5000, ackTimeoutMs: 4000, pollGapMs: 80 });

  const c1 = mk(), c2 = mk();
  const box1 = makeBox(), box2 = makeBox();
  collect(c1, box1); collect(c2, box2);
  const auto1 = { autoEnd: false, autoResponse: false };
  const auto2 = { autoEnd: false, autoResponse: false };
  armAuto(c1, box1, 0, auto1);
  armAuto(c2, box2, 1, auto2);

  let dbgIv = null;
  if (process.env.ADAPTER_DEBUG) {
    const dbgT0 = Date.now();
    const dbgT = () => ((Date.now() - dbgT0) / 1000).toFixed(1);
    dbgIv = setInterval(() => {
      const g = room.g;
      console.log('[dbg] t=' + dbgT() + 's round=' + (g && g.round) + ' turn=' + (g && g.turn) +
        ' over=' + (g && g.over) + ' prompts=' + (g ? g.prompts.size : '?') + ' inHuman=' + room.inHumanTurn +
        ' viewSeq=' + room.viewSeq + ' state=' + room.state +
        ' c1[' + c1.getTransport() + '] n=' + box1.states.length + ' seq=' + JSON.stringify(box1.states.slice(-4).map(s => s.viewSeq)) +
        ' c2[' + c2.getTransport() + '] n=' + box2.states.length + ' seq=' + JSON.stringify(box2.states.slice(-4).map(s => s.viewSeq)));
    }, 1200);
    c1.subscribe((m) => {
      if (m.type === 'event' && m.kind === 'turn') console.log('[dbg] t=' + dbgT() + ' C1 turn-ev pid=' + m.payload.pid + ' r=' + m.payload.round);
      if (m.type === 'ack') console.log('[dbg] t=' + dbgT() + ' C1 ack ref=' + m.ref);
      if (m.type === 'reject') console.log('[dbg] t=' + dbgT() + ' C1 reject why=' + m.why);
    });
    c2.subscribe((m) => {
      if (m.type === 'event' && m.kind === 'turn') console.log('[dbg] t=' + dbgT() + ' C2 turn-ev pid=' + m.payload.pid + ' r=' + m.payload.round);
      if (m.type === 'ack') console.log('[dbg] t=' + dbgT() + ' C2 ack ref=' + m.ref);
      if (m.type === 'reject') console.log('[dbg] t=' + dbgT() + ' C2 reject why=' + m.why);
    });
  }

  try {
    /* ---- 1. join + 大厅 ---- */
    const h1 = await c1.join({ name: '主机A' });
    T.assert(!!h1 && h1.self && h1.self.isHost === true && h1.self.seatId === 0, 'net: join 首座=房主(seat 0)');
    T.assert(typeof h1.sessionToken === 'string' && h1.sessionToken.length >= 32, 'net: join 下发 sessionToken');
    T.assert(c1.getTransport() === 'ws', 'net: 房主走 ws 传输');
    const hostConnId = ws.connIds()[0];
    T.assert(Number.isInteger(hostConnId) && hostConnId > 0, 'net: 已捕获房主 ws connId(' + hostConnId + ')');

    const h2 = await c2.join({ name: '玩家B' });
    T.assert(!!h2 && h2.self.seatId === 1 && h2.self.isHost === false, 'net: join 次座 seat 1 非房主');
    const lbOk = await waitFor(() =>
      box1.lobbies.some(l => Array.isArray(l.players) && l.players.length === 2) &&
      box2.lobbies.some(l => Array.isArray(l.players) && l.players.length === 2), 5000);
    T.assert(lbOk, 'net: lobby 广播(2 名玩家)');
    const lb1 = box1.lobbies[box1.lobbies.length - 1];
    T.assert(!!lb1 && lb1.canStart === true, 'net: lobby canStart=true');

    /* ---- 2. config(房主专属) + start ---- */
    c2.config({ humanCount: 3 });
    const rjCfg = await waitFor(() => box2.rejects.some(r => /房主/.test(String(r.why))), 5000);
    T.assert(rjCfg, 'net: 非房主 config 被拒');

    c1.start({ humanCount: 2, aiFill: 4, randomIdentity: false, difficulty: 'normal' });
    const stOk = await waitFor(() => box1.setups.length > 0 && box2.setups.length > 0, 8000);
    T.assert(stOk, 'net: start 后双方收到 setup');
    const st1 = box1.setups[0], st2 = box2.setups[0];
    T.assert(st1.pid === 0 && st1.myIdentity && st1.myIdentity.id === 'lord', 'net: setup 房主=0号主公');
    T.assert(st1.deckCount === 96, 'net: setup 起手牌堆 96(120-6×4)');
    T.assert(st2.pid === 1, 'net: setup 第二人类 pid=1');
    T.assert(!!room.g && room.g.players.length === 6, 'net: 6 人局(2 人类 + aiFill 4)');

    const s0Ok = await waitFor(() => box1.states.length > 0 && box2.states.length > 0, 8000);
    T.assert(s0Ok, 'net: 初始 state 快照');
    T.assert(box1.states[0].view.me.id === 0 && box2.states[0].view.me.id === 1, 'net: state 各客户端 own view');

    /* ---- 3. 房主回合: 若有攻击牌先打客机(触发 dodge 提示), 再 endTurn ---- */
    const t1Ok = await waitFor(() => box1.states.some(s => s.view && s.view.isMyTurn), 10000);
    T.assert(t1Ok, 'net: 房主进入行动回合');
    const myView = c1.getView();
    const atkIdx = myView && myView.me && myView.me.hand
      ? myView.me.hand.findIndex(card => engine.isAttackKey(card.key))
      : -1;
    if (atkIdx >= 0 && myView.others.some(o => o.id === 1 && !o.dead)) {
      c1.sendAction('playCard', { pid: 0, cardIdx: atkIdx, targetId: 1 }).catch(() => {});
    }
    // 计数快照在发送前取(ack 与随后广播的 state 可能同批到达, 发送后取会被新 state 抢先计数)
    const n1a = box1.states.length, n2a = box2.states.length;
    const ack1 = await c1.sendAction('endTurn', { pid: 0 });
    T.assert(!!ack1 && ack1.ref === 'endTurn', 'net: 房主 endTurn 受理(ack)');
    const stOk2 = await waitFor(() => box1.states.length > n1a && box2.states.length > n2a, 8000);
    T.assert(stOk2, 'net: endTurn 后双方收到新 state 广播');

    /* ---- 4. 客机回合 endTurn ---- */
    const t2Ok = await waitFor(() => box2.states.some(s => s.view && s.view.isMyTurn), 15000);
    T.assert(t2Ok, 'net: 客机进入行动回合');
    const ack2 = await c2.sendAction('endTurn', { pid: 1 });
    T.assert(!!ack2 && ack2.ref === 'endTurn', 'net: 客机 endTurn 受理(ack)');
    auto1.autoEnd = true; auto2.autoEnd = true; // 此后自动托管回合, 保持对局推进

    /* ---- 5. 提示定向 + 手动响应解析（先响应后查串发, 防 5s 权威超时竞态） ---- */
    const pOk = await waitFor(() => box1.prompts.length > 0 || box2.prompts.length > 0, 60000);
    T.assert(pOk, 'net: 对局中出现挂起提示(房主' + box1.prompts.length + ' 条 / 客机' + box2.prompts.length + ' 条)');
    if (pOk) {
      const mine1 = box1.prompts.length > 0;
      const sideBox = mine1 ? box1 : box2;
      const sidePid = mine1 ? 0 : 1;
      const otherBox = mine1 ? box2 : box1;
      const pm = sideBox.prompts[0];
      T.assert(pm.pid === sidePid, 'net: 提示定向到正确人类(pid=' + pm.pid + ')');
      T.assert(typeof pm.promptId === 'string' && pm.timeoutMs > 0, 'net: 提示带 promptId 与剩余超时');
      const prType = pm.payload && pm.payload.type;
      const ackP = await (mine1 ? c1 : c2).sendResponse(pm.promptId, null);
      T.assert(!!ackP && ackP.ref === pm.promptId, 'net: 提示响应受理(ack, type=' + prType + ')');
      await sleep(700);
      T.assert(!otherBox.prompts.some(p => p.promptId === pm.promptId), 'net: 提示未串发给另一客户端');
    }

    /* ---- 6. 房主 WS 断线 → 长轮询兜底(token 续接), 手动场景用单回合让出 ---- */
    const tokenBefore = c1.getStatus().token;
    ws.close(hostConnId, 4000, 'fallback-test');
    const fbOk = await waitFor(() => c1.getTransport() === 'lp' && c1.getStatus().joined, 10000);
    T.assert(fbOk, 'net: 房主 WS 掉线后自动切长轮询并完成会话续接');
    T.assert(c2.getTransport() === 'ws', 'net: 客机仍走 ws 不受影响');
    const n1b = box1.states.length;
    const rcvOk = await waitFor(() => box1.states.length > n1b, 15000);
    T.assert(rcvOk, 'net: 长轮询继续收到 state 广播(own view 不变)');

    const manualTurnP = new Promise((res) => { auto1.onManualTurn = res; });
    auto1.manualNext = true; // 下一个房主回合让给手动(自动托管保持开启, 无停滞窗口)
    const turnEv = await Promise.race([manualTurnP, sleep(30000).then(() => null)]);
    T.assert(!!turnEv, 'net: 长轮询收到房主回合事件');
    if (turnEv) {
      const a = await c1.sendAction('endTurn', { pid: 0 });
      T.assert(!!a && a.ref === 'endTurn' && c1.getTransport() === 'lp', 'net: 房主经长轮询 /act 行动并收到 ack');
    }

    /* ---- 7. 自动托管直至终局 ---- */
    auto1.autoResponse = true; auto2.autoResponse = true;
    const goOk = await waitFor(() => box1.gameOver && box2.gameOver, 60000);
    T.assert(goOk, 'net: 双方收到 gameover(' + (box1.gameOver ? box1.gameOver.payload.winner : '?') + ')');
    if (box1.gameOver) {
      T.assert(box1.gameOver.payload.identity === null, 'net: gameover identity=null(按契约)');
      T.assert(['主公方', '反贼', '内奸(摸鱼怪)'].indexOf(box1.gameOver.payload.winner) >= 0, 'net: winner 合法');
    }
    T.assert(room.state === 'ended', 'net: room 状态 ended');

    /* ---- 8. 关停 ---- */
    room.shutdown('测试结束');
    const sh1 = await waitFor(() => box1.events.some(e => e.kind === 'shutdown'), 5000);
    const sh2 = await waitFor(() => box2.events.some(e => e.kind === 'shutdown'), 5000);
    T.assert(sh1 && sh2, 'net: 双方收到 server-shutdown 广播');
    const shEv = box1.events.find(e => e.kind === 'shutdown');
    T.assert(!!shEv && shEv.payload && shEv.payload.reason === '测试结束', 'net: shutdown reason 透传');
    await sleep(300);
    T.assert(c1.getStatus().shut === true && c2.getStatus().shut === true, 'net: 关停后客户端停止一切重连');
    T.assert(c1.getStatus().stopped === true && c2.getStatus().stopped === true, 'net: 传输定时器/轮询已清(无残留任务)');
    // token 轮换: 断线重连后新 token ≠ 旧 token(会话续接走轮换后的 token)
    T.assert(!!tokenBefore && c1.getStatus().token !== tokenBefore, 'net: 断线重连后 sessionToken 已轮换');

    /* ---- 9. 汇总不变量 ---- */
    const iv1 = checkInvariants(box1.states, 0, '房主');
    const iv2 = checkInvariants(box2.states, 1, '客机');
    T.assert(iv1.ok, iv1.name);
    T.assert(iv2.ok, iv2.name);
    T.assert(box1.states.length > 5 && box2.states.length > 5, 'net: state 广播次数充足(房主' + box1.states.length + '/客机' + box2.states.length + ')');
    const commonSeq = box1.states.map(s => s.viewSeq).filter(v => box2.states.some(s2 => s2.viewSeq === v));
    T.assert(commonSeq.length > 0, 'net: 双方共享同一 viewSeq 快照序列(交集 ' + commonSeq.length + ')');
    for (const pm of box1.prompts) T.assert(pm.pid === 0, 'net: 房主收到的每条提示 pid=0');
    for (const pm of box2.prompts) T.assert(pm.pid === 1, 'net: 客机收到的每条提示 pid=1');
    T.assert(box1.events.some(e => e.kind === 'turn'), 'net: turn 事件广播');
    T.assert(box1.events.filter(e => e.kind === 'log').length > 20, 'net: log 事件充足(' + box1.events.filter(e => e.kind === 'log').length + ' 条)');

    console.log('[adapter-test] 统计  state: 房主' + box1.states.length + '/客机' + box2.states.length +
      '  event: 房主' + box1.events.length + '/客机' + box2.events.length +
      '  prompt: 房主' + box1.prompts.length + '/客机' + box2.prompts.length +
      '  自动托管 endTurn: ' + (box1.autoEndCount + box2.autoEndCount) +
      ' / 自动应答: ' + (box1.autoRespCount + box2.autoRespCount));

    c1.stop(); c2.stop();
    await sleep(50);
    T.assert(true, 'net: 客户端干净停止');
  } finally {
    if (dbgIv) clearInterval(dbgIv);
    try { room.shutdown('收尾'); } catch (e) { /* 忽略 */ }
    c1.stop(); c2.stop();
    lp.close();
    ws.shutdown();
    try { server.closeIdleConnections(); server.closeAllConnections(); } catch (e) { /* 忽略 */ }
    await new Promise((res) => server.close(res));
  }
}

/* ---------------- 入口 ---------------- */
(async () => {
  const t0 = Date.now();
  T.assert(typeof adapter.createLocalClient === 'function' && typeof adapter.createNetClient === 'function', 'adapter: 导出 createLocalClient/createNetClient');
  T.assert(typeof lobby.mountLobby === 'function', 'lobby: 导出 mountLobby(CommonJS)');
  try {
    await localSmoke();
    await netFlow();
  } catch (e) {
    T.assert(false, '顶层异常: ' + (e && e.stack || e));
  }
  T.summary();
  console.log('耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  process.exit(T.fail ? 1 : 0);
})();
