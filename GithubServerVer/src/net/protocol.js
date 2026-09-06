/*!
 * protocol.js — 《OI杀》v4 消息信封（transport 无关，WS 与长轮询共用）
 *
 * 依据：recon-02 B.3 / net-protocol.md §1。
 * 信封 = 单个 JSON 对象：{ "type": "<消息名>", "seq"?: <长轮询游标>, ...载荷字段 }
 *   - type 必须 ∈ 已知消息集（客户端 8 种 / 服务器 9 种）
 *   - seq  为传输层注入的长轮询游标（非负整数、单调递增）；WS 无需 seq
 *   - 其余字段即消息载荷（必须是 JSON 对象；保留字段 type/seq 由传输层持有）
 *
 * 本模块只依赖 net-api.js 的 ACTIONS 表（不 require 引擎，可被 node --check 独立解析）；
 * validateAction 为骨架：先按 ACTIONS 声明校验参数形状，P4b 房间层启动时 bindEngine(engine)
 * 后经 net-api.js buildApi 惰性映射引擎函数，返回 { ok, fn } 供房间层直接调用。
 */
'use strict';

const netApi = require('./net-api.js'); // 复用 ACTIONS/EVENTS/PENDING_TYPES/buildApi（不改动）

const PROTO = 1;

/* ---------- 一、已知消息集（net-protocol.md §2/§3 顶层 type） ---------- */
const CLIENT_KINDS = ['join', 'config', 'start', 'action', 'response', 'chat', 'ping', 'leave'];
const SERVER_KINDS = ['hello', 'lobby', 'setup', 'state', 'prompt', 'event', 'reject', 'ack', 'pong'];
const KNOWN_KINDS = new Set(CLIENT_KINDS.concat(SERVER_KINDS));

function isPlainObject(v) {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/* ---------- 二、编码：encodeMsg(kind, payload[, seq]) → JSON 字符串 ---------- */
function encodeMsg(kind, payload, seq) {
  if (typeof kind !== 'string' || !KNOWN_KINDS.has(kind)) {
    throw new TypeError('[protocol] encodeMsg: 未知消息类型 ' + JSON.stringify(kind));
  }
  if (!isPlainObject(payload)) {
    throw new TypeError('[protocol] encodeMsg: payload 必须是 JSON 对象');
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'type')) {
    throw new TypeError('[protocol] encodeMsg: payload 不得包含保留字段 type');
  }
  const hasSeq = seq !== undefined && seq !== null;
  if (hasSeq) {
    if (!Number.isInteger(seq) || seq < 0) {
      throw new TypeError('[protocol] encodeMsg: seq 必须是非负整数');
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'seq')) {
      throw new TypeError('[protocol] encodeMsg: payload 携带 seq 时不得再传 seq 参数（传输层注入）；如需透传请省略 seq 参数');
    }
  }
  const msg = Object.assign({ type: kind }, hasSeq ? { seq: seq } : null, payload);
  return JSON.stringify(msg);
}

/* ---------- 三、解码：decodeMsg(text) → { ok, kind, seq, payload } | { ok:false, why } ---------- */
function decodeMsg(text) {
  const bad = (why) => ({ ok: false, why });
  if (typeof text !== 'string' || text.trim() === '') return bad('empty message');
  let root;
  try {
    root = JSON.parse(text);
  } catch (e) {
    return bad('bad json: ' + e.message);
  }
  if (!isPlainObject(root)) return bad('message root must be a JSON object');
  const kind = root.type;
  if (typeof kind !== 'string' || !KNOWN_KINDS.has(kind)) {
    return bad('unknown type: ' + JSON.stringify(kind));
  }
  if (Object.prototype.hasOwnProperty.call(root, 'seq') && root.seq !== null) {
    if (!Number.isInteger(root.seq) || root.seq < 0) return bad('bad seq');
  }
  const payload = {};
  for (const k of Object.keys(root)) {
    if (k !== 'type' && k !== 'seq') payload[k] = root[k];
  }
  return { ok: true, kind, seq: Number.isInteger(root.seq) ? root.seq : null, payload };
}

/* ---------- 四、动作校验骨架（后续经 buildApi 惰性接引擎） ---------- */
let boundApi = null;

/** P4b 房间层启动时调用：绑定引擎 → 内部走 net-api.js buildApi(engine)（缺失动作函数即抛错） */
function bindEngine(engine) {
  boundApi = netApi.buildApi(engine);
  return boundApi;
}

/**
 * validateAction(kind, args) → { ok:true, action, fn? } | { ok:false, why }
 * 骨架阶段：按 ACTIONS 声明校验 kind 存在性 + 必需参数齐全 + pid 非负整数。
 * bindEngine 之后额外返回 fn（引擎函数映射），供房间层 `fn(...args, g)` 直接调用；
 * 语义合法性（阶段/费用/座位会话）由引擎函数自身返回 {ok:false, why} 透传 reject。
 */
function validateAction(kind, args) {
  const action = netApi.ACTIONS.find((a) => a.kind === kind);
  if (!action) return { ok: false, why: '未知动作 kind: ' + JSON.stringify(kind) };
  if (args === undefined || args === null) args = {};
  if (!isPlainObject(args)) return { ok: false, why: 'args 必须是 JSON 对象' };
  for (const decl of action.args) {
    const name = decl.replace(/\?$/, '');
    const optional = decl.endsWith('?');
    if (!Object.prototype.hasOwnProperty.call(args, name)) {
      if (optional) continue;
      return { ok: false, why: '缺少必需参数: ' + name };
    }
    if (name === 'pid' && !(Number.isInteger(args.pid) && args.pid >= 0)) {
      return { ok: false, why: 'pid 必须是非负整数' };
    }
  }
  return boundApi
    ? { ok: true, action, fn: boundApi.fnByName[action.fn] }
    : { ok: true, action };
}

module.exports = {
  PROTO,
  CLIENT_KINDS,
  SERVER_KINDS,
  KNOWN_KINDS,
  encodeMsg,
  decodeMsg,
  validateAction,
  bindEngine,
  isPlainObject,
};
