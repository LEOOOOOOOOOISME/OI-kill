/*!
 * transport-test.js — 《OI杀》v4 传输层运行时自检（P4a）
 *
 * 用法：node src/net/transport-test.js  →  全部断言通过时进程退出 0，失败退出 1。
 * 覆盖（仅用 node 内置模块充当客户端）：
 *   0. protocol.js   信封编码/解码/seq/校验、validateAction 骨架
 *   1. ws-server.js  手动 HTTP Upgrade 握手 + Sec-WebSocket-Accept 校验；掩码文本帧 echo
 *                    （短文本 / >125B 16位长度 / 分片重组 / ping→pong / close 握手）；
 *                    未掩码客户端帧 → 服务端 1002 关断
 *   2. longpoll.js   POST /act → seq++；GET /poll?since=0 事件回程；非法消息 400；挂起超时 events:[]
 *   3. http-static.js  /api/hello、index.html、src 静态文件、路径穿越 → 404
 * 全部挂在同一个 http server（listen(0) 临时端口）上，结束后干净关闭。
 */
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');

const protocol = require('./protocol.js');
const ws = require('./ws-server.js');
const longpoll = require('./longpoll.js');
const httpStatic = require('./http-static.js');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

let passed = 0;
let failed = 0;

function assert(cond, name) {
  if (cond) {
    passed++;
    console.log('    ok  ' + name);
  } else {
    failed++;
    console.error('    FAIL ' + name);
  }
}
function assertEq(actual, want, name) {
  assert(actual === want, name + '  (got ' + JSON.stringify(actual) + ', want ' + JSON.stringify(want) + ')');
}
function section(title) {
  console.log('');
  console.log('== ' + title + ' ==');
}

/* ---------- 客户端工具：HTTP JSON 请求 ---------- */
function httpJson(port, method, reqPath, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path: reqPath, method,
      headers: body != null
        ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
        : {},
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (e) { /* 非 JSON 响应 */ }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body != null) req.write(body);
    req.end();
  });
}

/* ---------- 客户端工具：手动 WS 握手 ---------- */
function wsConnect(port) {
  return new Promise((resolve, reject) => {
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      host: '127.0.0.1', port, path: '/ws', agent: false,
      headers: {
        Connection: 'Upgrade',
        Upgrade: 'websocket',
        'Sec-WebSocket-Key': key,
        'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (res, socket, head) => resolve({ key, res, socket, head }));
    req.on('error', reject);
    req.end();
  });
}

/* ---------- 客户端工具：帧编码（客户端→服务端：必须掩码） ---------- */
function encodeClientFrame(opcode, payload, opts) {
  opts = opts || {};
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload, 'utf8');
  const maskKey = opts.maskKey || crypto.randomBytes(4);
  const len = buf.length;
  const head = Buffer.alloc(len < 126 ? 2 : len < 65536 ? 4 : 10);
  head[0] = (opts.fin === false ? 0 : 0x80) | opcode;
  if (len < 126) {
    head[1] = 0x80 | len;
  } else if (len < 65536) {
    head[1] = 0x80 | 126;
    head.writeUInt16BE(len, 2);
  } else {
    head[1] = 0x80 | 127;
    head.writeBigUInt64BE(BigInt(len), 2);
  }
  const masked = Buffer.allocUnsafe(len);
  for (let i = 0; i < len; i++) masked[i] = buf[i] ^ maskKey[i & 3];
  return Buffer.concat([head, maskKey, masked]);
}

function clientCloseFrame(code) {
  const head = Buffer.alloc(2);
  head.writeUInt16BE(code, 0);
  return encodeClientFrame(8, head);
}

/* ---------- 客户端工具：帧读取器（服务端帧不掩码） ---------- */
function frameReader(socket) {
  let buf = Buffer.alloc(0);
  const queue = [];
  const waiters = [];
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 2) break;
      const b0 = buf[0], b1 = buf[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) {
        if (buf.length < 4) break;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) break;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      let maskKey = null;
      if (masked) {
        if (buf.length < off + 4) break;
        maskKey = buf.subarray(off, off + 4);
        off += 4;
      }
      if (buf.length < off + len) break;
      let payload = buf.subarray(off, off + len);
      if (maskKey) {
        const p = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) p[i] = payload[i] ^ maskKey[i & 3];
        payload = p;
      }
      buf = buf.subarray(off + len);
      const frame = { fin, opcode, masked, payload };
      if (waiters.length) waiters.shift()(frame);
      else queue.push(frame);
    }
  });
  return {
    next(ms) {
      return new Promise((resolve, reject) => {
        if (queue.length) return resolve(queue.shift());
        const timer = setTimeout(() => {
          const i = waiters.indexOf(entry);
          if (i >= 0) waiters.splice(i, 1);
          reject(new Error('等待帧超时 ' + (ms == null ? 5000 : ms) + 'ms'));
        }, ms == null ? 5000 : ms);
        const entry = (f) => { clearTimeout(timer); resolve(f); };
        waiters.push(entry);
      });
    },
  };
}

/* ============================================================
 * 0. protocol.js 信封与动作校验
 * ============================================================ */
function testProtocol() {
  section('0. protocol.js 信封 / decode 校验 / validateAction 骨架');

  let s = protocol.encodeMsg('ping', {});
  assertEq(s, '{"type":"ping"}', 'encodeMsg 基础形状 {type}');

  let d = protocol.decodeMsg('{"type":"ping"}');
  assert(d.ok === true && d.kind === 'ping' && d.seq === null, 'decodeMsg 解出 kind=ping');

  d = protocol.decodeMsg('{"type":"action","kind":"playCard","args":{"pid":0,"cardIdx":1}}');
  assert(d.ok && d.kind === 'action' && d.payload.kind === 'playCard' && d.payload.args.cardIdx === 1,
    'action 载荷逐字段解码');

  s = protocol.encodeMsg('chat', { text: 'hi' }, 7);
  assertEq(s, '{"type":"chat","seq":7,"text":"hi"}', 'encodeMsg seq 注入');
  d = protocol.decodeMsg(s);
  assert(d.ok && d.seq === 7 && d.payload.text === 'hi', 'seq 解码往返');

  assertEq(protocol.decodeMsg('not json').ok, false, '坏 JSON → 拒绝');
  assertEq(protocol.decodeMsg('[1,2]').ok, false, '根不是对象 → 拒绝');
  assertEq(protocol.decodeMsg('{"type":"nope"}').ok, false, '未知 type → 拒绝');
  assertEq(protocol.decodeMsg('{"type":"ping","seq":-1}').ok, false, '负 seq → 拒绝');
  assertEq(protocol.decodeMsg('{"type":"ping","seq":1.5}').ok, false, '非整数 seq → 拒绝');
  assert(protocol.decodeMsg('{"type":"ping","x":[1,2]}').ok, '载荷内数组字段合法');

  let threw = false;
  try { protocol.encodeMsg('nope', {}); } catch (e) { threw = true; }
  assert(threw, 'encodeMsg 未知 type → 抛错');
  threw = false;
  try { protocol.encodeMsg('ping', { type: 'x' }); } catch (e) { threw = true; }
  assert(threw, 'payload 携带保留字段 type → 抛错');
  threw = false;
  try { protocol.encodeMsg('ping', { seq: 3 }, 4); } catch (e) { threw = true; }
  assert(threw, 'payload 携带 seq 且再传 seq → 抛错');

  let v = protocol.validateAction('playCard', { pid: 0, cardIdx: 1, targetId: 0 });
  assert(v.ok, 'validateAction playCard 形状合法（targetId2 可选省略）');
  v = protocol.validateAction('playCard', { pid: 0, cardIdx: 1 });
  assert(v.ok === false && /targetId/.test(v.why || ''), '缺 targetId（ACTIONS 表必填）→ 拒绝');
  v = protocol.validateAction('playCard', { pid: 0 });
  assert(v.ok === false && /cardIdx/.test(v.why || ''), '缺 cardIdx → 拒绝并说明参数名');
  v = protocol.validateAction('playCard', { pid: -1, cardIdx: 0 });
  assert(v.ok === false && /pid/.test(v.why || ''), 'pid 负数 → 拒绝');
  v = protocol.validateAction('noSuchAction', {});
  assert(v.ok === false, '未知动作 kind → 拒绝');
  v = protocol.validateAction('lordRedraw', {});
  assert(v.ok, '无参动作 lordRedraw 合法');
  v = protocol.validateAction('discardCards', { pid: 0, indices: [1, 2] });
  assert(v.ok, 'discardCards 数组参数合法');
  v = protocol.validateAction('playCard', 'not-an-object');
  assert(v.ok === false, 'args 非对象 → 拒绝');
}

/* ============================================================
 * 1. WebSocket：握手 + 帧（echo）
 * ============================================================ */
async function testWs(port, wsServer) {
  section('1. WebSocket 手写 RFC6455 服务端');

  const closedInfo = [];
  wsServer.onClose = (id, code, reason) => closedInfo.push({ id, code, reason });
  const connected = [];
  wsServer.onConnection = (id) => connected.push(id);

  // ---- 连接 1：完整生命周期 ----
  const c1 = await wsConnect(port);
  assertEq(c1.res.statusCode, 101, '握手返回 101 Switching Protocols');
  assertEq(String(c1.res.headers.upgrade).toLowerCase(), 'websocket', '响应 Upgrade 头正确');
  const wantAccept = crypto.createHash('sha1').update(c1.key + WS_GUID).digest('base64');
  assertEq(c1.res.headers['sec-websocket-accept'], wantAccept, 'Sec-WebSocket-Accept = base64(SHA1(key+GUID))');
  assertEq(connected.length, 1, 'onConnection 触发一次 (connId=1)');

  const r1 = frameReader(c1.socket);

  // 短文本 echo（掩码 → 服务端不掩码回显）
  c1.socket.write(encodeClientFrame(1, '{"type":"ping","n":1}'));
  let f = await r1.next();
  assertEq(f.masked, false, '服务端帧不掩码（RFC6455 §5.1）');
  assertEq(f.opcode, 1, 'echo 帧 opcode=1(文本)');
  assertEq(f.fin, true, 'echo 帧 FIN=1');
  assertEq(f.payload.toString('utf8'), '{"type":"ping","n":1}', '短文本 echo 一致');

  // >125 字节载荷（16 位长度编码路径）
  const big = '{"type":"ping","pad":"' + 'x'.repeat(300) + '"}';
  c1.socket.write(encodeClientFrame(1, big));
  f = await r1.next();
  assertEq(f.payload.length, big.length, '>125B 载荷长度正确（126 编码）');
  assertEq(f.payload.toString('utf8'), big, '>125B echo 一致');

  // 分片帧（FIN=0 起始 + continuation 收尾 → 自动重组）
  c1.socket.write(encodeClientFrame(1, '{"type":"ping","par', { fin: false }));
  c1.socket.write(encodeClientFrame(0, 't":"ok"}'));
  f = await r1.next();
  assertEq(f.payload.toString('utf8'), '{"type":"ping","part":"ok"}', '分片帧重组后 echo 一致');

  // ping → 自动 pong
  c1.socket.write(encodeClientFrame(9, 'hb'));
  f = await r1.next();
  assertEq(f.opcode, 10, 'ping(opcode9) 自动回 pong(opcode10)');
  assertEq(f.payload.toString('utf8'), 'hb', 'pong 载荷回显');

  // close 握手：客户端发 close(1000) → 服务端回 close(1000) 并断开
  c1.socket.write(clientCloseFrame(1000));
  f = await r1.next();
  assertEq(f.opcode, 8, 'close 握手回 close 帧');
  assertEq(f.payload.length >= 2 ? f.payload.readUInt16BE(0) : -1, 1000, 'close 码回显 1000');
  await new Promise((r) => c1.socket.once('close', r));
  assert(closedInfo.length === 1 && closedInfo[0].id === 1 && closedInfo[0].code === 1000,
    'onClose(connId=1, code=1000) 触发');

  // ---- 连接 2：协议违规 → 1002 关断 ----
  const c2 = await wsConnect(port);
  assertEq(connected.length, 2, '第二连接 onConnection (connId=2)');
  const r2 = frameReader(c2.socket);
  // 未掩码文本帧（违规：客户端帧必须掩码）
  c2.socket.write(Buffer.concat([Buffer.from([0x81, 0x02]), Buffer.from('hi', 'utf8')]));
  f = await r2.next();
  assertEq(f.opcode, 8, '未掩码客户端帧 → 服务端回 close');
  assertEq(f.payload.readUInt16BE(0), 1002, '未掩码 → close 码 1002（协议错误）');
  await new Promise((r) => c2.socket.once('close', r));
  assert(closedInfo.length === 2 && closedInfo[1].id === 2 && closedInfo[1].code === 1002,
    'onClose(connId=2, code=1002) 触发');
}

/* ============================================================
 * 2. JSON 长轮询
 * ============================================================ */
async function testLongPoll(port, lp) {
  section('2. JSON 长轮询（GET /poll + POST /act）');

  let r = await httpJson(port, 'POST', '/act', JSON.stringify({ type: 'ping', text: 'lp-echo' }));
  assertEq(r.status, 200, '/act 合法消息 → 200');
  assert(r.json && r.json.ok === true && r.json.seq === 1, '/act 受理并 seq++ → {ok:true, seq:1}');

  r = await httpJson(port, 'GET', '/poll?since=0');
  assertEq(r.status, 200, '/poll → 200');
  assert(Array.isArray(r.json.events) && r.json.events.length === 1, 'since=0 拉到 1 条事件');
  assertEq(r.json.events[0].type, 'ping', '事件 type=ping 回程');
  assertEq(r.json.events[0].seq, 1, '事件 seq=1 回程');
  assertEq(r.json.events[0].text, 'lp-echo', '事件载荷回程（往返一致）');

  r = await httpJson(port, 'POST', '/act', 'not-json');
  assertEq(r.status, 400, '坏 JSON → 400');
  assert(r.json && r.json.ok === false, '坏 JSON → {ok:false}');

  r = await httpJson(port, 'POST', '/act', JSON.stringify({ type: 'nope' }));
  assertEq(r.status, 400, '未知 type → 400');
  assert(r.json && r.json.ok === false, '未知 type → {ok:false}');
  assertEq(lp.getSeq(), 1, '非法提交不推进 seq');

  assertEq(lp.emit('chat', { from: 0, text: 'hi' }), 2, 'emit 返回新 seq=2');
  r = await httpJson(port, 'GET', '/poll?since=1');
  assertEq(r.json.events.length, 1, 'emit 后 since=1 拉到 1 条');
  assertEq(r.json.events[0].type, 'chat', 'emit 事件 type=chat');
  assertEq(r.json.events[0].seq, 2, 'seq 单调递增 → 2');

  const t0 = Date.now();
  r = await httpJson(port, 'GET', '/poll?since=99'); // 无新事件：挂起至短超时(400ms)
  assertEq(r.status, 200, '无事件挂起超时 → 200');
  assertEq(JSON.stringify(r.json.events), '[]', '超时返回 {events:[]}');
  assert(Date.now() - t0 >= 350, '挂起持续到超时（≥350ms，默认 25s 可配）');
}

/* ============================================================
 * 3. 静态文件与 /api/hello
 * ============================================================ */
async function testStatic(port) {
  section('3. http-static：静态文件 + /api/hello + 穿越防护');

  let r = await httpJson(port, 'GET', '/api/hello');
  assertEq(r.status, 200, '/api/hello → 200');
  assert(r.json && r.json.ok === true && r.json.proto === 1 && typeof r.json.time === 'number',
    '/api/hello → {ok:true, proto:1, time}');
  assert(String(r.headers['content-type'] || '').includes('application/json'), '/api/hello content-type=json');

  r = await httpJson(port, 'GET', '/');
  assertEq(r.status, 200, 'GET / → index.html 200');
  assert(String(r.headers['content-type'] || '').includes('text/html'), 'html content-type');
  assert(/<!doctype|<html/i.test(r.text), 'index.html 内容有效');

  r = await httpJson(port, 'GET', '/src/net/net-api.js');
  assertEq(r.status, 200, 'src/** 静态文件 → 200');
  assert(String(r.headers['content-type'] || '').includes('javascript'), 'js content-type');
  assert(r.text.includes('buildApi'), 'net-api.js 内容完整');

  r = await httpJson(port, 'GET', '/no-such-file.xyz');
  assertEq(r.status, 404, '不存在文件 → 404');

  r = await httpJson(port, 'GET', '/%2e%2e/%2e%2e/Windows/win.ini');
  assertEq(r.status, 404, '路径穿越（编码 ..）→ 404');

  r = await httpJson(port, 'GET', '/src/../game.js');
  assertEq(r.status, 200, '根内相对路径规范化后正常服务');
  assert(r.text.length > 1000, 'game.js 内容有效');
}

/* ============================================================
 * 主流程
 * ============================================================ */
async function main() {
  console.log('[transport-test] 《OI杀》v4 传输层自检（P4a）');

  testProtocol();

  const server = http.createServer();
  const wsServer = ws.createWsServer({ server, echo: true }); // echo 钩子：测试用回显
  const lp = longpoll.createLongPoll({ server, timeoutMs: 400 }); // 缩短挂起超时以便测超时路径
  const stat = httpStatic.createStatic({
    server,
    rootDir: path.resolve(__dirname, '..', '..'), // v4-web 根目录
    indexFile: 'index.html',
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  console.log('  临时端口: 127.0.0.1:' + port);

  await testWs(port, wsServer);
  await testLongPoll(port, lp);
  await testStatic(port);

  console.log('');
  console.log('== 收尾：干净关闭 ==');
  wsServer.shutdown();
  lp.close();
  stat.close();
  await new Promise((resolve) => server.close(resolve));
  console.log('  http server 已关闭（WS 长轮询 静态均已卸载）');

  console.log('');
  console.log('结果: ' + passed + ' 断言通过, ' + failed + ' 失败');
  if (failed) {
    console.error('FAIL: 传输层自检未通过');
    process.exit(1);
  }
  console.log('OK: 传输层自检全部通过（退出码 0）');
  process.exit(0);
}

main().catch((e) => {
  console.error('测试崩溃:', e);
  process.exit(1);
});
