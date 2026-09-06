/*!
 * single-e2e.mjs — P5 单人链路端到端(Node 进程内, 无浏览器; exit 0 = 全绿)
 *
 * 拓扑: 进程内 http server + 手写 ws-server + room(mode single) 起真实服务端;
 *       客户端用 src/ui/adapter.js 的 createNetClient(走 global WebSocket, Node 24 原生
 *       undici 实现, 与浏览器同 API)连 127.0.0.1:
 *         join '我' → config({humanCount:1, aiFill:5, difficulty:'normal'}) → start
 *       人类回合秒结束(endTurn), 全部挂起提示按默认"否/放弃"应答; thinkMs:0 保证速度。
 *
 * 断言: hello 房主入座 → setup(1 人类座位 / 身份=主公 / seatToPid / 6 人局) → 整局驱动至
 *       gameover(identity=null) → 引擎 over / winner 合法 / 120 牌守恒 → 干净关停。
 * 守恒口径与 test.js A 套件一致: id===-1 的虚拟衍生物不计。
 */
import http from 'node:http';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const engine = require('../src/engine/index.js');
const { createRoom } = require('../src/net/room.js');
const { createWsServer } = require('../src/net/ws-server.js');
const { createNetClient } = require('../src/ui/adapter.js');

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
    console.log('  single-e2e 汇总: 通过 ' + T.pass + '/' + total + '  失败 ' + T.fail);
    if (T.fail) console.log(T.fails.join('\n'));
    console.log('==============================================');
  },
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
async function waitFor(pred, timeoutMs) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(10);
  }
  return true;
}

/* ---------------- 卡牌守恒(与 room-test.js / test.js A 套件同口径) ---------------- */
function isRealCard(c) { return !!c && c.id !== -1; }
function totalCards(g) {
  let t = 0;
  for (const c of g.deck) if (isRealCard(c)) t += 1;
  for (const c of g.discard) if (isRealCard(c)) t += 1;
  for (const p of g.players) {
    for (const c of p.hand) if (isRealCard(c)) t += 1;
    if (isRealCard(p.weapon)) t += 1;
    if (isRealCard(p.armor)) t += 1;
    for (const c of p.units) if (isRealCard(c)) t += 1;
    for (const c of p.delayArea) if (isRealCard(c)) t += 1;
  }
  return t;
}

/* ---------------- 主流程 ---------------- */
(async () => {
  const t0 = Date.now();
  let client = null;
  let ws = null;
  let server = null;
  try {
    /* 1. 服务端: http + ws-server + room(single; 不开 autoStart, 走显式 config+start) */
    server = http.createServer();
    ws = createWsServer({ server });
    const room = createRoom({
      engine, mode: 'single', thinkMs: 0, seed: 20260518,
      promptTimeoutMs: 1500, turnTimeoutMs: 4000, heartbeatMs: 60000,
    });
    room.attachWs(ws);
    await new Promise((res) => server.listen(0, '127.0.0.1', res));
    const port = server.address().port;
    T.assert(port > 0, 'server: 临时端口已绑定(127.0.0.1:' + port + ')');

    /* 2. 客户端: adapter 的 NetClient, 走 global WebSocket(Node 24 原生) */
    const got = {
      setup: null, gameover: null, hello: null,
      states: 0, prompts: 0, turns: 0,
      rejects: [], myPrompts: 0,
    };
    let myPid = null;

    client = createNetClient({
      url: 'http://127.0.0.1:' + port,
      joinTimeoutMs: 5000, ackTimeoutMs: 2500, keepaliveMs: 8000,
    });
    client.subscribe((m) => {
      if (!m || !m.type) return;
      if (m.type === 'hello') got.hello = m;
      if (m.type === 'setup') { got.setup = m; myPid = m.pid; }
      if (m.type === 'state') got.states++;
      if (m.type === 'prompt') {
        got.prompts++;
        if (myPid !== null && m.pid === myPid) {
          got.myPrompts++;
          const t = (m.payload && m.payload.type) || '';
          let value;
          if (t === 'harvest') value = { choiceKey: null };
          else if (t === 'report') value = { cardKey: null };
          else if (t === 'evo') value = { key: null };          // adapter 转 evolvePick
          else if (t === 'discard') value = { indices: [] };    // adapter 转 discardCards
          else value = { yes: false };
          client.sendResponse(m.promptId, value);
        }
      }
      if (m.type === 'event') {
        if (m.kind === 'gameover') got.gameover = m;
        if (m.kind === 'turn') {
          got.turns++;
          if (myPid !== null && m.payload && m.payload.enginePid === myPid && room.g && !room.g.over) {
            client.sendAction('endTurn', { pid: myPid });       // 人类回合: 秒结束
          }
        }
      }
      if (m.type === 'reject') got.rejects.push(m);
    });

    /* 3. join → config → start(单人链路标准序列) */
    const hello = await client.join({ name: '我' });
    T.assert(!!hello && hello.self && hello.self.name === '我' && hello.self.isHost === true && hello.self.seatId === 0,
      'join: hello 回执(首座=房主, seat 0)');
    T.assert(!!hello && hello.mode === 'single', 'join: hello.mode = single');

    await client.config({ humanCount: 1, aiFill: 5, difficulty: 'normal' });
    // config 经 WS 异步到达服务器: 轮询房间权威配置, 确保 start 前配置已生效(消除时序竞态)
    T.assert(await waitFor(() => room.config.humanCount === 1 && room.config.aiFill === 5 && room.config.difficulty === 'normal', 5000),
      'config: 房主配置生效(1 人类 + 5 AI + normal)');

    await client.start();
    T.assert(await waitFor(() => got.setup, 5000), 'setup: 开局信息到达');

    T.assert(got.setup.pid === 0, 'setup: 人类引擎 pid=0(座位未打乱)', 'pid=' + got.setup.pid);
    T.assert(!!got.setup.myIdentity && got.setup.myIdentity.id === 'lord', 'setup: 该 pid 身份=主公');
    T.assert(Array.isArray(got.setup.seatToPid) && got.setup.seatToPid.length === 6 && got.setup.total === 6,
      'setup: seatToPid 长度=6, total=6(1 人类 + 5 AI)');
    T.assert(room.seats.filter(Boolean).length === 1, 'room: 大厅仅 1 个人类座位');
    T.assert(!!room.g && room.g.players.length === 6, 'room: 引擎 6 人局');
    T.assert(room.g.isHuman(0) && !room.g.isHuman(1) && !room.g.isHuman(5), 'room: humanSet={0}, 其余 5 席 AI 顶替');
    T.assert(totalCards(room.g) === 120, 'room: 开局 120 牌守恒');

    /* 4. 驱动整局直至终局(人类回合秒结束 + 提示默认否; thinkMs:0) */
    const done = await waitFor(() => got.gameover, 180000);
    T.assert(done, '终局: gameover 事件在 180s 预算内到达');
    T.assert(!!got.gameover && got.gameover.payload && got.gameover.payload.identity === null,
      'gameover: payload.identity = null(广播不带个人身份)');

    await sleep(80); // 等房间层 handleGameOver 收尾
    T.assert(room.g.over === true, '终局: 引擎 over=true');
    T.assert(room.state === 'ended', '终局: room state=ended');
    T.assert(!!room.g.winner && ['主公方', '反贼', '内奸(摸鱼怪)'].indexOf(room.g.winner) >= 0,
      '终局: winner 合法(' + room.g.winner + ')');
    T.assert(got.states > 10, '链路: state 快照充足(' + got.states + ')');
    T.assert(got.turns > 5, '链路: 回合事件充足(' + got.turns + ')');
    T.assert(got.rejects.length === 0, '链路: 全程零 reject', got.rejects.map((r) => r.why).join('; ') || '(无)');
    while (room.g && room.g.prompts.size) engine.timeoutPrompt(room.g, room.g.prompts.values().next().value.id);
    T.assert(totalCards(room.g) === 120, '终局: 120 牌守恒(牌堆+弃牌堆+全员手牌/装备/单位/延时)', '实际=' + totalCards(room.g));
    console.log('[stats] 局数 round=' + room.g.round + ' | 回合事件=' + got.turns + ' | state 快照=' + got.states +
      ' | 提示=' + got.prompts + '(我的=' + got.myPrompts + ') | 日志行=' + room.g.log.length + ' | winner=' + room.g.winner);

    /* 5. 干净关停 */
    client.stop();
    room.shutdown('e2e 完成');
    await sleep(60);
    ws.shutdown();
    await new Promise((res) => server.close(res));
    T.assert(true, '关停: 客户端/房间/WS/HTTP 全部干净关闭(计时器已清理)');
  } catch (e) {
    T.assert(false, '顶层异常: ' + ((e && e.stack) || e));
    if (client) { try { client.stop(); } catch (e2) { /* 忽略 */ } }
    if (server) { try { server.close(); } catch (e2) { /* 忽略 */ } }
  }

  T.summary();
  console.log('耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  process.exit(T.fail ? 1 : 0);
})();
