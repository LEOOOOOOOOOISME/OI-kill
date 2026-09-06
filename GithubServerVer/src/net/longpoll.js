/*!
 * longpoll.js — 《OI杀》v4 JSON 长轮询兜底传输（零依赖，仅 node:http/node:url）
 *
 * 依据：recon-02 B.2（兜底传输）/ net-protocol.md §1（与 WS 共用同一信封）。
 *   GET  /poll?since=<seq>  拉取 seq 之后的事件；无事件则挂起至 timeoutMs(默认 25s) 后回 {events:[]}
 *   POST /act               提交消息：body → protocol.decodeMsg → 校验通过 → seq++ → 入事件流
 * 事件流为全量追加日志（保留最近 maxEvents 条）：emit(kind, payload) 编码进流并唤醒所有挂起者；
 * POST /act 的入站消息默认也进流（logInbound:true）——提交者可立即看到自身消息回声，房间层亦可关掉。
 * 与其它 http 模块共存约定：响应前设置 req.__oikillHandled = true，http-static 据此跳过。
 */
'use strict';

const url = require('node:url');
const protocol = require('./protocol.js');

const DEFAULT_POLL_PATH = '/poll';
const DEFAULT_ACT_PATH = '/act';
const DEFAULT_TIMEOUT_MS = 25000;
const MAX_BODY = 64 * 1024; // POST /act 请求体上限
const DEFAULT_MAX_EVENTS = 2000; // 事件日志保留条数（LAN 规模足够）

function createLongPoll(opts) {
  if (!opts || !opts.server) throw new Error('[longpoll] createLongPoll 需要 { server }');
  const server = opts.server;
  const pollPath = opts.path || DEFAULT_POLL_PATH;
  const actPath = opts.actPath || DEFAULT_ACT_PATH;
  const timeoutMs = opts.timeoutMs == null ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;
  const maxEvents = opts.maxEvents == null ? DEFAULT_MAX_EVENTS : opts.maxEvents;
  const logInbound = opts.logInbound !== false;

  let seq = 0;               // 事件游标：从 0 起，首个事件 seq=1（客户端首次 poll 用 since=0）
  const log = [];            // { seq, msg }，msg = { type, seq, ...payload }
  const waiters = [];        // { res, since, timer, done }

  const api = {
    onMessage: opts.onMessage || null, // (msg) => msg = { kind, payload, seq }（入站动作，房间层挂接）
    getSeq: () => seq,
    emit,
    close: shutdown,
  };

  function respondJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(body);
  }

  /* ---------- 事件流 ---------- */
  function emit(kind, payload) {
    seq++;
    const msg = Object.assign({ type: kind, seq }, payload); // 信封由 protocol.encodeMsg 校验同款规则
    try {
      protocol.encodeMsg(kind, payload, seq); // 校验 kind/payload/seq 合法性（抛错则不外推）
    } catch (e) {
      throw e;
    }
    log.push({ seq, msg });
    if (log.length > maxEvents) log.splice(0, log.length - maxEvents);
    wake();
    return seq;
  }

  function wake() {
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w.done) { waiters.splice(i, 1); continue; }
      const events = [];
      for (const e of log) if (e.seq > w.since) events.push(e.msg);
      if (events.length) {
        w.done = true;
        clearTimeout(w.timer);
        waiters.splice(i, 1);
        respondJson(w.res, 200, { events });
      }
    }
  }

  /* ---------- GET /poll?since=seq ---------- */
  function handlePoll(searchParams, res) {
    let since = 0;
    const raw = searchParams.get('since');
    if (raw !== null && raw !== '') {
      const n = Number(raw);
      if (Number.isInteger(n) && n >= 0) since = n;
    }
    const events = [];
    for (const e of log) if (e.seq > since) events.push(e.msg);
    if (events.length) return respondJson(res, 200, { events });

    const w = { res, since, timer: null, done: false };
    w.timer = setTimeout(() => {
      if (w.done) return;
      w.done = true;
      const i = waiters.indexOf(w);
      if (i >= 0) waiters.splice(i, 1);
      respondJson(res, 200, { events: [] }); // 挂起超时：空事件
    }, timeoutMs);
    waiters.push(w);
    res.on('close', () => { // 客户端提前断开：释放挂起占位
      if (w.done) return;
      w.done = true;
      clearTimeout(w.timer);
      const i = waiters.indexOf(w);
      if (i >= 0) waiters.splice(i, 1);
    });
  }

  /* ---------- POST /act ---------- */
  function handleAct(req, res) {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        respondJson(res, 413, { ok: false, why: 'body too large' });
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const decoded = protocol.decodeMsg(Buffer.concat(chunks).toString('utf8'));
      if (!decoded.ok) return respondJson(res, 400, { ok: false, why: decoded.why });
      seq++;
      const msg = Object.assign({ type: decoded.kind, seq }, decoded.payload);
      if (logInbound) log.push({ seq, msg });
      if (log.length > maxEvents) log.splice(0, log.length - maxEvents);
      if (api.onMessage) {
        try { api.onMessage({ kind: decoded.kind, payload: decoded.payload, seq }); } catch (e) { /* 上层异常不扩散 */ }
      }
      wake();
      respondJson(res, 200, { ok: true, seq });
    });
  }

  /* ---------- 路由（非本模块路径不动手，交给 http-static 等） ---------- */
  function onRequest(req, res) {
    const u = new url.URL(req.url || '/', 'http://oikill.local');
    let pathname;
    try {
      pathname = decodeURIComponent(u.pathname);
    } catch (e) {
      req.__oikillHandled = true;
      return respondJson(res, 400, { ok: false, why: 'bad url encoding' });
    }
    if (pathname === pollPath && req.method === 'GET') {
      req.__oikillHandled = true;
      return handlePoll(u.searchParams, res);
    }
    if (pathname === actPath && req.method === 'POST') {
      req.__oikillHandled = true;
      return handleAct(req, res);
    }
    // 非本模块路由：忽略（http-static 处理或 404）
  }

  server.on('request', onRequest);

  function shutdown() {
    server.removeListener('request', onRequest);
    for (const w of waiters) {
      if (w.done) continue;
      w.done = true;
      clearTimeout(w.timer);
      respondJson(w.res, 200, { events: [] });
    }
    waiters.length = 0;
  }

  return api;
}

module.exports = { createLongPoll };
