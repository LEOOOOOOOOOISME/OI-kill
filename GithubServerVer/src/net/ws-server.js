/*!
 * ws-server.js — 《OI杀》v4 手写 RFC6455 WebSocket 服务端（零依赖，仅 node:http/node:crypto）
 *
 * 依据：recon-02 B.2（主推传输）/ net-protocol.md §1。仅实现游戏协议所需子集：
 *   - HTTP Upgrade 握手：Sec-WebSocket-Accept = base64(SHA1(key + WS_GUID))，版本 13
 *   - 帧解析：FIN/RSV/opcode/MASK、7 位/16 位/64 位载荷长度；客户端帧必须掩码
 *   - 文本帧(0x1) → onMessage(connId, text)；分片(FIN=0)自动重组；二进制帧(0x2)静默忽略
 *   - close(0x8) → 回 close 帧并断开 → onClose(connId, code, reason)
 *   - ping(0x9) 自动回 pong(0xA)；pong 经 onPong 回调（心跳可用）
 *   - send(connId, text)：服务端帧按规范【不掩码】（RFC6455 §5.1）
 * 安全：RSV 非 0 / 未掩码 / 控制帧分片 / 未知 opcode → 1002；超 16MB → 1009；非法 UTF-8 → 1007。
 */
'use strict';

const http = require('node:http');
const crypto = require('node:crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const OP_CONT = 0x0, OP_TEXT = 0x1, OP_BIN = 0x2, OP_CLOSE = 0x8, OP_PING = 0x9, OP_PONG = 0xa;
const MAX_PAYLOAD = 16 * 1024 * 1024; // 16MB 上限（含分片累计），超出按 1009 关断
const HAS_IS_UTF8 = typeof Buffer.isUtf8 === 'function'; // Node ≥18.14

function createWsServer(opts) {
  opts = opts || {};
  const isOwn = !opts.server;
  const server = opts.server || http.createServer();
  if (isOwn) {
    server.listen(opts.port || 0);
    // 仅端口模式的兜底：没有其它 request 监听者时对普通 HTTP 请求回 426
    server.on('request', function fallback(req, res) {
      if (server.listenerCount('request') > 1) return; // 已挂长轮询/静态，交给它们
      res.writeHead(426, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('WebSocket only: Upgrade required');
    });
  }

  const conns = new Map(); // connId → { socket, buf, fragOpcode, fragBuf, fragLen, open }
  let nextId = 1;

  const api = {
    server,
    onConnection: opts.onConnection || null, // (connId, req)
    onMessage: opts.onMessage || null,       // (connId, text)
    onClose: opts.onClose || null,           // (connId, code, reason)
    onPong: opts.onPong || null,             // (connId, payloadText)
    echo: !!opts.echo,                       // 测试用：文本帧原样回显
    send,
    connIds: () => Array.from(conns.keys()),
    close: closeConn,
    shutdown,
  };

  /* ---------- 帧编码（服务端→客户端：不掩码） ---------- */
  function encodeFrame(opcode, payload, fin) {
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), 'utf8');
    const head = Buffer.alloc(buf.length < 126 ? 2 : buf.length < 65536 ? 4 : 10);
    head[0] = (fin === false ? 0 : 0x80) | opcode;
    if (buf.length < 126) {
      head[1] = buf.length;
    } else if (buf.length < 65536) {
      head[1] = 126;
      head.writeUInt16BE(buf.length, 2);
    } else {
      head[1] = 127;
      head.writeBigUInt64BE(BigInt(buf.length), 2);
    }
    return Buffer.concat([head, buf]);
  }

  function send(connId, text) {
    const st = conns.get(connId);
    if (!st || !st.open) return false;
    try {
      st.socket.write(encodeFrame(OP_TEXT, text));
      return true;
    } catch (e) {
      return false;
    }
  }

  function closePayload(code, reason) {
    const head = Buffer.alloc(2);
    head.writeUInt16BE(code & 0xffff, 0);
    return reason ? Buffer.concat([head, Buffer.from(String(reason), 'utf8')]) : head;
  }

  function sendControl(st, opcode, payload) {
    if (!st.open) return;
    try { st.socket.write(encodeFrame(opcode, payload)); } catch (e) { /* socket 已坏，忽略 */ }
  }

  /* ---------- 断开与清理 ---------- */
  function teardown(st, code, reason) {
    if (!st.open) return;
    st.open = false;
    conns.delete(st.connId);
    if (api.onClose) {
      try { api.onClose(st.connId, code, reason || ''); } catch (e) { /* 回调异常不扩散 */ }
    }
  }

  function fail(st, code, reason) {
    sendControl(st, OP_CLOSE, closePayload(code, reason));
    teardown(st, code, reason);
    try { st.socket.end(); } catch (e) { try { st.socket.destroy(); } catch (e2) { /* 忽略 */ } }
  }

  function closeConn(connId, code, reason) {
    const st = conns.get(connId);
    if (st) fail(st, code == null ? 1000 : code, reason);
  }

  /* ---------- 帧处理（客户端→服务端：必须掩码） ---------- */
  function deliver(st, payload) {
    if (HAS_IS_UTF8 && !Buffer.isUtf8(payload)) return fail(st, 1007, 'invalid UTF-8 in text frame');
    const text = payload.toString('utf8');
    if (api.onMessage) {
      try { api.onMessage(st.connId, text); } catch (e) { /* 上层异常不扩散 */ }
    }
    if (api.echo) send(st.connId, text);
  }

  function onFrame(st, fin, opcode, payload) {
    // 控制帧：不得分片、载荷 ≤125
    if (opcode >= 0x8) {
      if (!fin) return fail(st, 1002, 'control frames must not be fragmented');
      if (payload.length > 125) return fail(st, 1002, 'control frame payload too large');
      if (opcode === OP_CLOSE) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1005;
        const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
        sendControl(st, OP_CLOSE, payload.length >= 2 ? payload.subarray(0, 2) : closePayload(1000, ''));
        teardown(st, code, reason);
        try { st.socket.end(); } catch (e) { try { st.socket.destroy(); } catch (e2) { /* 忽略 */ } }
        return false; // 停止解析后续字节
      }
      if (opcode === OP_PING) { sendControl(st, OP_PONG, payload); return true; }
      if (opcode === OP_PONG) {
        if (api.onPong) {
          try { api.onPong(st.connId, payload.toString('utf8')); } catch (e) { /* 忽略 */ }
        }
        return true;
      }
      return fail(st, 1002, 'unknown control opcode ' + opcode);
    }
    // 数据帧：text / binary / continuation
    if (opcode === OP_TEXT || opcode === OP_BIN) {
      if (st.fragOpcode !== null) return fail(st, 1002, 'new data frame inside fragmented message');
      if (!fin) {
        st.fragOpcode = opcode;
        st.fragBuf = [payload];
        st.fragLen = payload.length;
        return true;
      }
      if (opcode === OP_TEXT) deliver(st, payload);
      return true; // 二进制帧 v4 协议不使用：静默忽略
    }
    if (opcode === OP_CONT) {
      if (st.fragOpcode === null) return fail(st, 1002, 'unexpected continuation frame');
      st.fragLen += payload.length;
      if (st.fragLen > MAX_PAYLOAD) return fail(st, 1009, 'fragmented message too large');
      st.fragBuf.push(payload);
      if (!fin) return true;
      const whole = Buffer.concat(st.fragBuf);
      const op = st.fragOpcode;
      st.fragOpcode = null;
      st.fragBuf = null;
      st.fragLen = 0;
      if (op === OP_TEXT) deliver(st, whole);
      return true;
    }
    return fail(st, 1002, 'unknown opcode ' + opcode);
  }

  function handleData(st) {
    if (!st.open) return;
    for (;;) {
      if (st.buf.length < 2) return;
      const b0 = st.buf[0], b1 = st.buf[1];
      const fin = (b0 & 0x80) !== 0;
      if (b0 & 0x70) return fail(st, 1002, 'RSV bits must be 0');
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) {
        if (st.buf.length < 4) return;
        len = st.buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (st.buf.length < 10) return;
        const big = st.buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_PAYLOAD)) return fail(st, 1009, 'payload too large');
        len = Number(big);
        off = 10;
      }
      if (!masked) return fail(st, 1002, 'client frames must be masked');
      if (st.buf.length < off + 4 + len) return; // 帧未收齐，等待更多字节
      const maskKey = st.buf.subarray(off, off + 4);
      const payload = Buffer.allocUnsafe(len);
      for (let i = 0; i < len; i++) payload[i] = st.buf[off + 4 + i] ^ maskKey[i & 3];
      st.buf = st.buf.subarray(off + 4 + len);
      if (!onFrame(st, fin, opcode, payload)) return;
    }
  }

  /* ---------- HTTP Upgrade 握手 ---------- */
  function onUpgrade(req, socket, head) {
    const key = req.headers['sec-websocket-key'];
    const okUpgrade = String(req.headers.upgrade || '').toLowerCase() === 'websocket';
    const okVersion = req.headers['sec-websocket-version'] === '13';
    if (!okUpgrade || !okVersion || !key) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      socket.destroy();
      return;
    }
    const accept = crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
    );
    socket.setNoDelay(true);
    const connId = nextId++;
    const st = {
      connId, socket, open: true,
      buf: head && head.length ? Buffer.from(head) : Buffer.alloc(0), // upgrade 余留字节可能是首帧
      fragOpcode: null, fragBuf: null, fragLen: 0,
    };
    conns.set(connId, st);
    if (api.onConnection) {
      try { api.onConnection(connId, req); } catch (e) { /* 忽略 */ }
    }
    socket.on('data', (chunk) => {
      st.buf = Buffer.concat([st.buf, chunk]);
      handleData(st);
    });
    socket.on('error', () => teardown(st, 1006, 'socket error'));
    socket.on('close', () => teardown(st, 1006, 'socket closed'));
  }

  server.on('upgrade', onUpgrade);

  function shutdown() {
    for (const st of Array.from(conns.values())) fail(st, 1001, 'server shutdown');
    server.removeListener('upgrade', onUpgrade);
    if (isOwn) server.close();
  }

  return api;
}

module.exports = { createWsServer };
