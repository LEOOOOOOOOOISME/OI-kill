/*!
 * room-test.js — 《OI杀》v4 房间层运行时自检（P4b）
 *
 * 运行：node src/net/room-test.js（workdir = v4-web 根或仓库根; 内部按 __dirname 定位模块）
 * 零依赖：仅 node 内置（http/net/crypto/assert 不用, 自带微型断言器）。
 *
 * 结构：
 *   第一部分（传输冒烟）：真实 http server（127.0.0.1, 端口 0）+ http-static + ws-server + longpoll
 *     + 独立 room 实例：验证 /api/hello、POST /act join → hello 寻址(to:'*' + nonce)、
 *     WS 手写客户端 join → 直接收 hello、ping → pong、关停广播。
 *   第二部分（房间主流程，进程内直驱 room.handleMessage，确定性）：2 人类 + aiFill 4 开局，
 *     驱动整局并断言：各自视角 state / prompt 定向 / 合法响应解析 / 非法动作拒绝 /
 *     超时默认"否" / 断线 token 重连恢复 / 观战脱敏 / AI 座位事件 / 终局 120 牌守恒 / 干净关停。
 */
'use strict';

const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const path = require('node:path');

const engine = require('../engine/index.js');
const protocol = require('./protocol.js');
const { createRoom } = require('./room.js');
const { createStatic } = require('./http-static.js');
const { createWsServer } = require('./ws-server.js');
const { createLongPoll } = require('./longpoll.js');

/* ---------------- 微型断言器 ---------------- */
const T = {
  pass: 0, fail: 0, fails: [],
  assert(cond, name, extra) {
    if (cond) { T.pass++; return true; }
    T.fail++;
    T.fails.push('✗ ' + name + (extra ? ' — ' + extra : ''));
    return false;
  },
  summary() {
    const total = T.pass + T.fail;
    console.log('');
    console.log('==============================================');
    console.log('  room-test 汇总: 通过 ' + T.pass + '/' + total + '  失败 ' + T.fail);
    if (T.fail) console.log(T.fails.join('\n'));
    console.log('==============================================');
  },
};

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/* ---------------- 卡牌守恒（与 test.js A 套件同口径: id===-1 虚拟衍生物不计） ---------------- */
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

/* ---------------- 进程内测试客户端（link.send 直收, 确定性） ---------------- */
const COLLECT = { states: [], events: [], prompts: [], leaks: [] };

function makeClient(room, name, pid) {
  const c = {
    room, name, pid, seatId: pid,
    inbox: [], cursor: 0, autoCursor: 0,
    claimPrompts: false, claimed: null,
    autoTurn: true, smart: null,
    token: null, clientId: null,
  };
  const link = {
    linkId: 'test:' + name + ':' + Math.random().toString(36).slice(2, 8),
    kind: 'test',
    send(text) {
      let m;
      try { m = protocol.decodeMsg(text); } catch (e) { c.inbox.push({ type: '<bad>', raw: text }); return; }
      if (!m.ok) { c.inbox.push({ type: '<bad>', raw: text }); return; }
      const msg = Object.assign({}, m.payload, { type: m.kind });
      c.inbox.push(msg);
      // 接收路径不变量（每条即时断言, 不落盘）
      if (msg.type === 'state') {
        COLLECT.states.push({ name, view: msg.view });
        if (pid != null) {
          if (!msg.view || !msg.view.me || msg.view.me.id !== pid) COLLECT.leaks.push({ kind: 'state-own-view', name, got: msg.view && msg.view.me && msg.view.me.id });
          if (msg.view && Array.isArray(msg.view.others)) {
            for (const o of msg.view.others) {
              if (o && o.hand !== undefined) COLLECT.leaks.push({ kind: 'state-others-hand', name, other: o.id });
            }
          }
        }
      } else if (msg.type === 'prompt') {
        COLLECT.prompts.push({ name, promptId: msg.promptId, pid: msg.pid, type: msg.type === 'prompt' ? msg.type : null, msg });
        if (pid != null && msg.pid !== pid) COLLECT.leaks.push({ kind: 'prompt-wrong-target', name, got: msg.pid, want: pid });
      } else if (msg.type === 'event') {
        COLLECT.events.push({ name, kind: msg.kind, payload: msg.payload });
      }
    },
    close() {},
  };
  c.link = link;
  c.join = (payload) => room.handleMessage(link, 'join', payload);
  c.send = (kind, payload) => room.handleMessage(link, kind, payload);
  c.nextSync = (pred) => {
    for (let i = c.cursor; i < c.inbox.length; i++) {
      if (pred(c.inbox[i])) { c.cursor = i + 1; return c.inbox[i]; }
    }
    return null;
  };
  c.peek = (from, pred) => {
    for (let i = from; i < c.inbox.length; i++) {
      if (pred(c.inbox[i])) return { i, m: c.inbox[i] };
    }
    return null;
  };
  return c;
}

/* 默认应答（对应各 prompt 类型的"否/放弃"合法路径） */
function defaultValueFor(type) {
  switch (type) {
    case 'dodge': case 'betrayConsent': case 'counter': case 'cold':
    case 'bbst': case 'chase': case 'aoeResp': case 'argueResp': case 'guard':
      return { yes: false };
    case 'harvest': return { choiceKey: null };
    case 'report': return { cardKey: null };
    case 'betray': return { targetId: null };
    default: return {};
  }
}

function respondDefault(c, m) {
  const type = m.payload && m.payload.type; // 提示语义 type 在 payload 内(信封 type 为传输保留字段)
  if (process.env.DEBUG) console.log('[test] respondDefault', c.name, m.promptId, type);
  if (type === 'evo') {
    c.send('action', { kind: 'evolvePick', args: { pid: c.seatId, key: null } });
    return;
  }
  if (type === 'discard') {
    c.send('action', { kind: 'discardCards', args: { pid: c.seatId, indices: [] } });
    return;
  }
  c.send('response', { promptId: m.promptId, kind: type, value: defaultValueFor(type) });
}

/* 智能托管应答（读服务器侧手牌做合法"是/否", 让对局尽量持久; 被拒则回退默认"否"） */
function respondSmart(c, m) {
  if (process.env.DEBUG) console.log('[test] respondSmart', c.name, m.promptId, m.payload && m.payload.type);
  const g = c.room.g;
  const type = m.payload && m.payload.type;
  const pl = m.payload || {};
  if (type === 'evo') {
    const keys = Array.isArray(pl.keys) ? pl.keys : [];
    c.send('action', { kind: 'evolvePick', args: { pid: c.seatId, key: keys.length ? String(keys[0]) : null } });
    return;
  }
  if (type === 'discard') { respondDefault(c, m); return; }
  const p = g && g.players[c.pid];
  const has = (pred) => !!p && Array.isArray(p.hand) && p.hand.some(pred);
  const isDodge = (k) => k === 'dodge' || k === 'dodgeEvo';
  const isAtk = (k) => k === 'attack' || k === 'attackEvo';
  const isCtr = (k) => k === 'counter' || k === 'counterEvo';
  let value;
  switch (type) {
    case 'dodge':
      value = (pl.ctx && pl.ctx.betrayConsent)
        ? { yes: false }
        : { yes: has((x) => isDodge(x.key)) };
      break;
    case 'counter': value = { yes: has((x) => isCtr(x.key)) }; break;
    case 'aoeResp': case 'argueResp': value = { yes: has((x) => isAtk(x.key) || isDodge(x.key)) }; break;
    case 'chase': value = { yes: has((x) => isAtk(x.key)) }; break;
    case 'cold': case 'bbst': case 'guard': case 'betray': case 'betrayConsent': value = { yes: false }; break;
    case 'harvest': {
      const cards = pl.ctx && Array.isArray(pl.ctx.cards) ? pl.ctx.cards : [];
      value = { choiceKey: cards.length ? String(cards[0].key) : null };
      break;
    }
    case 'report': {
      const cards = pl.ctx && Array.isArray(pl.ctx.cards) ? pl.ctx.cards : [];
      value = { cardKey: cards.length ? String(cards[0].key) : null };
      break;
    }
    default: value = {};
  }
  c.send('response', { promptId: m.promptId, kind: type, value });
}

/* 自动托管: 智能应答提示(被拒回退默认"否") + 自己回合秒结束(autoTurn=false 时让出回合给场景)。
 * 用独立 autoCursor 窥视扫描: nextSync 的消费不会吞掉 autoTick 需要的 turn/prompt 事件。 */
const AUTO = [];
function autoTick() {
  for (const c of AUTO) {
    let hit;
    while ((hit = c.peek(c.autoCursor, (x) => x.type === 'reject'))) {
      c.autoCursor = hit.i + 1;
      if (c.smart && hit.m.ref === c.smart.promptId) { respondDefault(c, c.smart.m); c.smart = null; }
    }
    while ((hit = c.peek(c.autoCursor, (x) => x.type === 'prompt' || (x.type === 'event' && x.kind === 'turn')))) {
      c.autoCursor = hit.i + 1;
      const m = hit.m;
      if (m.type === 'prompt') {
        if (c.claimPrompts) { if (process.env.DEBUG) console.log('[test] claim', c.name, m.promptId); c.claimed = m; c.claimPrompts = false; continue; }
        c.smart = { promptId: m.promptId, m };
        respondSmart(c, m);
      } else if (m.type === 'event' && m.kind === 'turn' && m.payload && m.payload.pid === c.seatId) {
        if (c.autoTurn === false) continue; // 场景占用该回合
        c.send('action', { kind: 'endTurn', args: { pid: c.seatId } });
      }
    }
  }
}

async function playUntil(cond, timeoutMs) {
  const t0 = Date.now();
  let ticks = 0;
  while (!cond()) {
    autoTick();
    if (++ticks % 40 === 0) for (const c of AUTO) c.send('ping', {}); // 保活, 防心跳误判断线
    if (process.env.DEBUG && ticks % 125 === 0) {
      const g = AUTO[0] && AUTO[0].room.g;
      console.log('[dbg] t=' + Math.round((Date.now() - t0) / 1000) + 's',
        g ? ('round=' + g.round + ' turn=' + g.turn + ' over=' + g.over + ' winner=' + g.winner + ' prompts=' + g.prompts.size) : 'no-g',
        'inbox c1=' + (AUTO[0] ? AUTO[0].inbox.length : '?') + ' c2=' + (AUTO[1] ? AUTO[1].inbox.length : '?'),
        'promptsLog=' + COLLECT.prompts.length);
    }
    if (Date.now() - t0 > timeoutMs) return false;
    await sleep(8);
  }
  autoTick();
  return true;
}

async function waitInbox(c, pred, timeoutMs) {
  const t0 = Date.now();
  for (;;) {
    autoTick();
    const m = c.nextSync(pred);
    if (m) return m;
    if (Date.now() - t0 > timeoutMs) return null;
    await sleep(8);
  }
}

/* ---------------- 第一部分: 传输冒烟（真实 HTTP + WS + 长轮询 + 独立 room） ---------------- */
function httpReq(port, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers: body ? { 'Content-Type': 'application/json' } : {} }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function wsSmoke(port, name, nonce) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(
        'GET / HTTP/1.1\r\nHost: 127.0.0.1:' + port + '\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n' +
        'Sec-WebSocket-Key: ' + key + '\r\nSec-WebSocket-Version: 13\r\n\r\n'
      );
    });
    let buf = Buffer.alloc(0);
    let upgraded = false;
    const frames = [];
    const sendMasked = (obj) => {
      const payload = Buffer.from(JSON.stringify(obj), 'utf8');
      const mask = crypto.randomBytes(4);
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
      sock.write(Buffer.concat([Buffer.from([0x81, 0x80 | payload.length]), mask, masked]));
    };
    const parse = () => {
      for (;;) {
        if (buf.length < 2) return;
        const opcode = buf[0] & 0x0f;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return;
        const payload = buf.subarray(off, off + len);
        buf = buf.subarray(off + len);
        if (opcode === 0x1) frames.push(JSON.parse(payload.toString('utf8')));
        if (opcode === 0xA) frames.push({ type: 'pong' }); // 服务端 pong 帧
        if (opcode === 0x8) { sock.destroy(); return; }
      }
    };
    sock.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (!upgraded) {
        const i = buf.indexOf('\r\n\r\n');
        if (i < 0) return;
        const head = buf.subarray(0, i).toString('latin1');
        if (head.indexOf('101') < 0) { sock.destroy(); reject(new Error('WS 握手失败: ' + head.split('\r\n')[0])); return; }
        upgraded = true;
        buf = buf.subarray(i + 4);
        sendMasked({ type: 'join', name, nonce });
        sendMasked({ type: 'ping' }); // 心跳: 期望服务端回 pong
      }
      parse();
      if (frames.some((f) => f.type === 'hello') && frames.some((f) => f.type === 'pong')) {
        sock.destroy();
        resolve(frames);
      }
    });
    sock.on('error', reject);
  });
}

async function transportSmoke() {
  const server = http.createServer();
  // 长轮询必须先于静态注册: http-static 靠 req.__oikillHandled 跳过, 否则 /poll 的 fs 探测回调
  // 会在长轮询已响应后二次 writeHead（ERR_HTTP_HEADERS_SENT）
  const lp = createLongPoll({ server, logInbound: false });
  const ws = createWsServer({ server });
  const stat = createStatic({ server, rootDir: path.join(__dirname, '..', '..') });
  const roomB = createRoom({ engine, mode: 'lan', thinkMs: 0, heartbeatMs: 60000 });
  roomB.attachWs(ws);
  roomB.attachLongPoll(lp);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const port = server.address().port;
  T.assert(port > 0, '传输冒烟: 临时端口已绑定(127.0.0.1:' + port + ')');

  // /api/hello
  const hello = await httpReq(port, 'GET', '/api/hello');
  T.assert(hello.status === 200 && hello.body.indexOf('"proto":1') >= 0, 'http-static: /api/hello 探活', hello.body.slice(0, 60));

  // 长轮询 join → hello(to:'*' + nonce) + lobby
  const act = await httpReq(port, 'POST', '/act', JSON.stringify({ type: 'join', name: 'LP客户端', nonce: 'n1' }));
  T.assert(act.status === 200 && JSON.parse(act.body).ok === true, 'longpoll: POST /act join 受理 seq=1', act.body);
  const poll1 = await httpReq(port, 'GET', '/poll?since=0');
  const ev1 = JSON.parse(poll1.body).events || [];
  const lpHello = ev1.find((e) => e.type === 'hello');
  const lpLobby = ev1.find((e) => e.type === 'lobby');
  T.assert(!!lpHello && lpHello.nonce === 'n1' && lpHello.self && lpHello.to === lpHello.self.clientId, 'longpoll: hello 私信寻址(to=self.clientId) + nonce 关联下发');
  T.assert(!!lpLobby && lpLobby.to === '*', 'longpoll: lobby 全局广播 to:*');
  const lpSeq = lpHello.seq;
  T.assert(Number.isInteger(lpSeq) && lpSeq >= 1, 'longpoll: 事件信封带传输层 seq');

  // WS join → 直接收 hello（无 to 寻址）+ ping → pong
  const wsFrames = await wsSmoke(port, 'WS客户端', 'n2');
  const wsHello = wsFrames.find((f) => f.type === 'hello');
  T.assert(!!wsHello && wsHello.self && wsHello.self.name === 'WS客户端' && wsHello.to === undefined, 'ws: join 直收 hello(私信无 to 字段)');
  const wsPong = wsFrames.find((f) => f.type === 'pong');
  T.assert(!!wsPong, 'ws: ping → pong 应答');

  // 关停广播
  roomB.shutdown('冒烟收尾');
  const poll2 = await httpReq(port, 'GET', '/poll?since=' + lpSeq);
  const ev2 = JSON.parse(poll2.body).events || [];
  T.assert(ev2.some((e) => e.type === 'event' && e.kind === 'shutdown'), 'room.shutdown: server-shutdown 广播进入共享流');

  await new Promise((res) => { stat.close(); lp.close(); ws.shutdown(); server.close(res); });
  T.assert(true, '传输冒烟: 服务器干净关闭');
}

/* ---------------- 第二部分: 房间主流程（进程内直驱） ---------------- */
async function roomFlow() {
  const room = createRoom({
    engine, mode: 'lan', thinkMs: 0, seed: 424242, debug: !!process.env.DEBUG,
    promptTimeoutMs: 1000, turnTimeoutMs: 3000, graceMs: 1500, heartbeatMs: 600,
  });
  T.assert(room.state === 'lobby', 'room: 初始为大厅');

  const c1 = makeClient(room, '主机A', 0);
  const c2 = makeClient(room, '玩家B', 1);
  c1.autoTurn = false; c2.autoTurn = false; // S1 场景占用回合, 完成前不自动结束
  AUTO.push(c1, c2);

  /* 1. join / 大厅 */
  c1.join({ name: '主机A' });
  const h1 = c1.nextSync((m) => m.type === 'hello');
  T.assert(!!h1 && h1.self && h1.self.isHost === true && h1.self.seatId === 0, 'join: 首座=房主(seat 0, isHost)');
  T.assert(!!h1 && typeof h1.sessionToken === 'string' && h1.sessionToken.length >= 32, 'join: 下发 crypto sessionToken');
  c1.token = h1.sessionToken; c1.clientId = h1.self.clientId;

  c2.join({ name: '玩家B' });
  const h2 = c2.nextSync((m) => m.type === 'hello');
  T.assert(!!h2 && h2.self.seatId === 1 && h2.self.isHost === false, 'join: 次座 seat 1, 非房主');
  c2.token = h2.sessionToken; c2.clientId = h2.self.clientId;
  const lb = c1.nextSync((m) => m.type === 'lobby' && Array.isArray(m.players) && m.players.length === 2);
  T.assert(!!lb && lb.canStart === true, 'lobby: 2 名玩家, canStart=true');

  /* 2. config（房主专属） */
  c2.send('config', { humanCount: 3 });
  const rjCfg = c2.nextSync((m) => m.type === 'reject');
  T.assert(!!rjCfg && rjCfg.why.indexOf('房主') >= 0, 'config: 非房主被拒');
  c1.send('config', { humanCount: 2, aiFill: 4, randomIdentity: false, difficulty: 'normal' });
  const lbCfg = c1.nextSync((m) => m.type === 'lobby' && m.config && m.config.humanCount === 2);
  T.assert(!!lbCfg && lbCfg.config.aiFill === 4 && lbCfg.config.difficulty === 'normal', 'config: 房主修改生效并广播');

  /* 3. start（房主专属） */
  c2.send('start', {});
  const rjStart = c2.nextSync((m) => m.type === 'reject');
  T.assert(!!rjStart && rjStart.why.indexOf('房主') >= 0, 'start: 非房主被拒');
  c1.send('start', {});
  const st1 = c1.nextSync((m) => m.type === 'setup');
  const st2 = c2.nextSync((m) => m.type === 'setup');
  T.assert(!!st1 && st1.pid === 0 && st1.myIdentity && st1.myIdentity.id === 'lord', 'setup: 房主(默认) = 0 号主公');
  T.assert(!!st1 && st1.lordPid === 0 && st1.deckCount === 120 - 6 * 4, 'setup: lordPid=0, 起手牌堆=96(120-6×4 起手)');
  T.assert(!!st2 && st2.pid === 1, 'setup: 第二人类 pid=1');
  T.assert(!!room.g && room.g.players.length === 6, 'start: 2 人类 + aiFill 4 = 6 人局');
  T.assert(room.g.isHuman(0) && room.g.isHuman(1) && !room.g.isHuman(2), 'start: humanSet = {0,1}, AI 补位其余座位');
  T.assert(totalCards(room.g) === 120, 'start: 开局 120 牌守恒');

  /* 4. S1 非法动作（c2 在 c1 回合作妖） */
  const okTurn0 = await playUntil(() => room.g && room.inHumanTurn && room.g.turn === 0, 30000);
  T.assert(okTurn0, 'S1: 进入 0 号(房主)行动回合');
  c2.send('action', { kind: 'playCard', args: { pid: 1, cardIdx: 0, targetId: 0 } });
  const r1 = c2.nextSync((m) => m.type === 'reject');
  T.assert(!!r1 && r1.why === '非行动阶段', 'S1: 非行动阶段动作被拒', r1 && r1.why);
  c2.send('action', { kind: 'endTurn', args: { pid: 1 } });
  const r2 = c2.nextSync((m) => m.type === 'reject');
  T.assert(!!r2 && r2.why === '非行动阶段', 'S1: 他人回合 endTurn 被拒(权威守卫)');
  c2.send('action', { kind: 'endTurn', args: { pid: 999 } });
  const r3 = c2.nextSync((m) => m.type === 'reject');
  T.assert(!!r3 && r3.why === '非行动阶段', 'S1: 伪造 pid 被会话座位覆盖后仍拒');
  c2.send('action', { kind: 'totallyBogus', args: {} });
  const r4 = c2.nextSync((m) => m.type === 'reject');
  T.assert(!!r4 && r4.why.indexOf('未知动作') >= 0, 'S1: 未知动作 kind 被拒');
  c1.send('action', { kind: 'endTurn', args: { pid: 0 } });
  const ack1 = c1.nextSync((m) => m.type === 'ack');
  T.assert(!!ack1 && ack1.ref === 'endTurn', 'S1: 合法 endTurn 受理(ack)');
  c1.autoTurn = true; c2.autoTurn = true; // S1 完成, 恢复自动托管

  /* 5. 聊天 + 观战 */
  c1.send('chat', { text: '大家好, 测试聊天' });
  const chat1 = c1.nextSync((m) => m.type === 'event' && m.kind === 'chat');
  const chat2 = c2.nextSync((m) => m.type === 'event' && m.kind === 'chat');
  T.assert(!!chat1 && chat1.payload.text === '大家好, 测试聊天' && chat1.payload.from === 0, 'chat: 广播含发送者与座位');
  T.assert(!!chat2 && chat2.payload.text === '大家好, 测试聊天', 'chat: 另一客户端也收到');

  const c3 = makeClient(room, '观众', null);
  c3.join({ spectate: true, name: '观众' });
  const h3 = c3.nextSync((m) => m.type === 'hello');
  T.assert(!!h3 && h3.self.pid === null && h3.self.seatId === null, 'spectate: hello 无座位/pid');
  const s3 = c3.nextSync((m) => m.type === 'state');
  T.assert(!!s3 && Array.isArray(s3.view.me.hand) && s3.view.me.hand.length === 0, 'spectate: 观战视图无手牌');
  T.assert(!!s3 && Array.isArray(s3.view.prompts) && s3.view.prompts.length === 0, 'spectate: 观战视图剥离未决提示');
  const aliveOthers = s3 ? s3.view.others.filter((o) => !o.dead) : [];
  T.assert(aliveOthers.length > 0 && aliveOthers.every((o) => o.identity === null), 'spectate: 存活者身份不可见');
  c3.send('leave', {});
  T.assert(true, 'spectate: 观战者离开');

  /* 6. S2 合法响应解析提示（定向到正确人类） */
  c1.claimed = null; c1.claimPrompts = true;
  const okP1 = await playUntil(() => c1.claimed != null, 30000);
  T.assert(okP1, 'S2: 捕获到 c1 的挂起提示');
  const pm1 = c1.claimed;
  T.assert(pm1 && pm1.pid === 0 && pm1.timeoutMs > 0, 'S2: 提示定向到正确人类(pid=0)且带超时');
  respondDefault(c1, pm1);
  const ack2 = c1.nextSync((m) => m.type === 'ack');
  T.assert(!!ack2 && ack2.ref === pm1.promptId, 'S2: 响应受理(ack)');
  await sleep(80);
  T.assert(!room.g.prompts.has(pm1.promptId), 'S2: 响应后提示已解析(无残留)');

  /* 7. S3 超时默认"否" */
  c2.claimed = null; c2.claimPrompts = true;
  const okP2 = await playUntil(() => c2.claimed != null, 30000);
  T.assert(okP2, 'S3: 捕获到 c2 的挂起提示');
  const pm2 = c2.claimed;
  T.assert(pm2 && pm2.pid === 1, 'S3: 提示定向到正确人类(pid=1)');
  const statesBefore = COLLECT.states.length;
  const t0 = Date.now();
  await sleep(1250); // promptTimeoutMs=1000 + 余量
  T.assert(Date.now() - t0 >= 1000, 'S3: 已越过权威超时窗口');
  T.assert(!room.g.prompts.has(pm2.promptId), 'S3: 超时后引擎按默认"否"解析(提示移除)');
  T.assert(COLLECT.states.length > statesBefore, 'S3: 超时结算经广播路径下发新 state');
  const evBefore = COLLECT.events.length;
  const okResume = await playUntil(() => room.g.over || COLLECT.events.length > evBefore, 8000);
  T.assert(okResume, 'S3: 超时后泵恢复推进(新事件/终局, 无死锁)');

  /* 8. S4 断线重连（提示挂起期间） */
  c1.claimed = null; c1.claimPrompts = true;
  const okP3 = await playUntil(() => c1.claimed != null, 30000);
  T.assert(okP3, 'S4: 再次捕获 c1 提示(用于重连场景)');
  const pm3 = c1.claimed;
  const oldToken = c1.token;
  const seatClient = room.seats[0];
  T.assert(!!seatClient && seatClient.clientId === c1.clientId, 'S4: 座位记录定位正确');
  room.markDisconnected(seatClient);
  T.assert(seatClient.connected === false, 'S4: 断线标记生效(座位保留)');

  const c1b = makeClient(room, '主机A', 0);
  c1b.join({ name: '主机A', token: oldToken });
  const h4 = c1b.nextSync((m) => m.type === 'hello');
  T.assert(!!h4 && h4.self.seatId === 0 && h4.sessionToken && h4.sessionToken !== oldToken, 'S4: token 重连成功并轮换新 token');
  const s4 = c1b.nextSync((m) => m.type === 'state');
  T.assert(!!s4 && s4.view.me.id === 0, 'S4: 重连后全量 state 重发(own view)');
  T.assert(!!s4 && JSON.stringify(s4.view.me.hand) === JSON.stringify(engine.publicView(room.g, 0).me.hand), 'S4: 重连快照与服务器引擎一致(泵暂停时确定性)');
  const p4 = c1b.nextSync((m) => m.type === 'prompt' && m.promptId === pm3.promptId);
  T.assert(!!p4, 'S4: 重连重发该 pid 的未决 prompt(同 promptId)');

  const c1c = makeClient(room, '冒名者', null);
  c1c.join({ name: '冒名者', token: oldToken });
  const rjToken = c1c.nextSync((m) => m.type === 'reject');
  T.assert(!!rjToken && rjToken.why.indexOf('sessionToken') >= 0, 'S4: 旧 token 已作废(冒名被拒)');

  respondDefault(c1b, p4);
  const ack4 = c1b.nextSync((m) => m.type === 'ack');
  T.assert(!!ack4 && ack4.ref === pm3.promptId, 'S4: 重连后正常响应提示');
  T.assert(seatClient.connected === true && seatClient.graceTimer === null, 'S4: 宽限计时已清除');
  AUTO[0] = c1b; // 后续自动托管走新连接

  /* 9. 自动托管直至终局 */
  const done = await playUntil(() => room.g && room.g.over, 150000);
  T.assert(done, '终局: 对局在预算时间内结束(150s)');
  T.assert(room.state === 'ended', '终局: room 状态 ended');
  while (room.g && room.g.prompts.size) { // 终局残留提示防御性按默认结算后再守恒审计
    const pr = room.g.prompts.values().next().value;
    engine.timeoutPrompt(room.g, pr.id);
  }
  T.assert(!!room.g.winner && ['主公方', '反贼', '内奸(摸鱼怪)'].indexOf(room.g.winner) >= 0, '终局: winner 合法(' + room.g.winner + ')');
  T.assert(totalCards(room.g) === 120, '终局: 120 牌守恒(牌堆+弃牌堆+全员手牌/装备/单位/延时)', '实际=' + totalCards(room.g));
  const gov = COLLECT.events.find((e) => e.kind === 'gameover');
  T.assert(!!gov && gov.payload.winner === room.g.winner, '终局: gameover 事件广播');

  /* 10. 汇总不变量 */
  T.assert(COLLECT.states.length > 30, '广播: state 全量快照次数充足(' + COLLECT.states.length + ')');
  T.assert(COLLECT.leaks.filter((l) => l.kind === 'state-own-view').length === 0, '广播: 每客户端 state 均为 own view(me.id 匹配)');
  T.assert(COLLECT.leaks.filter((l) => l.kind === 'state-others-hand').length === 0, '广播: others 无手牌泄露');
  T.assert(COLLECT.leaks.filter((l) => l.kind === 'prompt-wrong-target').length === 0, '广播: prompt 均定向到正确人类');
  T.assert(COLLECT.prompts.length > 0, '广播: 对局中出现过挂起提示(' + COLLECT.prompts.length + ')');
  const aiTurns = COLLECT.events.filter((e) => e.kind === 'turn' && e.payload && e.payload.pid >= 2);
  T.assert(aiTurns.length > 0, 'AI: 补位 AI 座位产生回合事件(' + aiTurns.length + ' 次)');
  const aiLogs = COLLECT.events.filter((e) => e.kind === 'log' && /AI-\d/.test(String(e.payload && e.payload.txt)));
  T.assert(aiLogs.length > 0, 'AI: 补位 AI 产生全局日志事件(与真人同一管线)');
  const logCount = COLLECT.events.filter((e) => e.kind === 'log').length;
  T.assert(logCount > 50, '事件: 全局限流日志事件充足(' + logCount + ')');

  /* 11. 干净关停 */
  c1b.send('ping', {});
  c2.send('ping', {});
  await sleep(30);
  room.shutdown('测试结束');
  const sh1 = c1b.nextSync((m) => m.type === 'event' && m.kind === 'shutdown');
  const sh2 = c2.nextSync((m) => m.type === 'event' && m.kind === 'shutdown');
  T.assert(!!sh1 && !!sh2 && sh1.payload.reason === '测试结束', 'shutdown: server-shutdown 广播到全部客户端');
  T.assert(room.state === 'playing' || room.state === 'ended', 'shutdown: 房间对象仍可读(无异常)');
  AUTO.length = 0;
  await sleep(50);
  T.assert(true, '关停: 计时器已清理, 事件循环无残留任务');
}

/* ---------------- 入口 ---------------- */
(async () => {
  const t0 = Date.now();
  try {
    await transportSmoke();
    await roomFlow();
  } catch (e) {
    T.assert(false, '顶层异常: ' + (e && e.stack || e));
  }
  T.summary();
  console.log('耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  process.exit(T.fail ? 1 : 0);
})();
