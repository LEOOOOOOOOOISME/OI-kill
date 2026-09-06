# P4a 传输层报告（WebSocket / 长轮询 / 静态服务，零依赖）

> 阶段：P4a ｜ 依据：recon-02 B.2/B.3、net-protocol.md §1 ｜ 协议版本 `proto: 1`
> 约束：仅新建 `src/net/*`（未改动 net-api.js / engine / index.html / tests）；仅用 node 内置模块（node:http / node:crypto / node:fs / node:path / node:url）

## 1. 交付物清单

| 文件 | 行数 | 字节 | 职责 |
|---|---|---|---|
| `src/net/protocol.js` | 109 | 5,405 | 消息信封（encode/decode/seq/校验）+ validateAction 骨架 |
| `src/net/ws-server.js` | 225 | 9,924 | 手写 RFC6455 WebSocket 服务端（主推传输） |
| `src/net/longpoll.js` | 148 | 6,283 | JSON 长轮询兜底（GET /poll + POST /act） |
| `src/net/http-static.js` | 92 | 4,083 | 静态文件服务（index.html + src/**）+ /api/hello |
| `src/net/transport-test.js` | 361 | 17,843 | 运行时自检（node 内置 http 充当客户端） |

验证结果：

- `node --check` 5 个文件全部通过；
- `node src/net/transport-test.js`：**74 断言全部通过，进程退出码 0**，服务器干净关闭。

## 2. 模块设计说明

### 2.1 protocol.js — 消息信封（transport 无关）

- 信封 = 单个 JSON 对象：`{ "type": "<消息名>", "seq"?: <游标>, ...载荷字段 }`。
- `encodeMsg(kind, payload[, seq])` → JSON 字符串。校验：kind ∈ 17 种已知 type（客户端 8：join/config/start/action/response/chat/ping/leave；服务器 9：hello/lobby/setup/state/prompt/event/reject/ack/pong）；payload 必须是纯 JSON 对象且不得携带保留字段 `type`；seq 为非负整数时注入信封。
- `decodeMsg(text)` → `{ok:true, kind, seq, payload}` 或 `{ok:false, why}`（非抛出式，供每个入站帧/请求调用）。逐项拒绝：空串 / 坏 JSON / 根非对象 / 未知 type / 非法 seq。
- `validateAction(kind, args)` 骨架：按 net-api.js 的 `ACTIONS` 表（24 项，不修改）校验 kind 存在性、必需参数齐全（表内不带 `?` 的参数均为必填，如 playCard 的 `targetId`）、`pid` 非负整数；`bindEngine(engine)` 由 P4b 房间层启动时调用，内部惰性走 `buildApi(engine)`，此后 validateAction 额外返回 `fn` 供房间层直接调用引擎（语义校验仍由引擎 `{ok:false, why}` 透传 reject）。
- 复用：`require('./net-api.js')` 的 ACTIONS 表与 buildApi，未修改其内容。

### 2.2 ws-server.js — 手写 RFC6455 服务端（225 行）

- `createWsServer({server})` 挂到既有 http server 的 `upgrade` 事件；`createWsServer({port})` 自建并监听。
- 握手：校验 Upgrade/Version=13/Key 存在 → `Sec-WebSocket-Accept = base64(SHA1(key + GUID))`（node:crypto）→ 写 101 响应；非法握手回 400 并断开。
- 帧解析：FIN/RSV/opcode/MASK、7 位/16 位/64 位载荷长度；客户端帧**必须掩码**（否则 1002）；多帧 TCP 段缓冲循环解析。
- 文本帧(0x1) → `onMessage(connId, text)`；分片（FIN=0 起始 + continuation）自动重组后投递；二进制帧(0x2)静默忽略（v4 协议只用 JSON 文本）。
- close(0x8) → 回显 close 码并断开 → `onClose(connId, code, reason)`；ping(0x9) 自动回 pong(0xA)；pong 走 `onPong` 回调（心跳可用）。
- `send(connId, text)`：服务端帧**不掩码**（RFC6455 §5.1），长度 <126 / <65536 / ≥65536 三档编码。
- 防御：RSV 非 0、控制帧分片/超长、未知 opcode、未掩码 → 1002；载荷（含分片累计）>16MB → 1009；文本帧非法 UTF-8 → 1007。
- 附加：`echo:true` 测试回显钩子；`connIds()`；`shutdown()` 卸载 upgrade 监听、关闭全部连接（自建 server 时一并 close；端口模式下无 request 监听者时普通 HTTP 回 426）。

### 2.3 longpoll.js — JSON 长轮询兜底

- `createLongPoll({server, path='/poll', actPath='/act', timeoutMs=25000, logInbound=true, maxEvents=2000})`。
- `GET /poll?since=seq`：返回 seq 之后的事件 `{events:[{type,seq,...payload}]}`；无事件则挂起至 25s（可配）超时后回 `{events:[]}`；客户端提前断开自动释放挂起占位。
- `POST /act`：body（≤64KB）→ `protocol.decodeMsg` → 校验通过 `seq++` 入事件流 → 应答 `{ok:true, seq}`；非法消息 400 `{ok:false, why}`，**不推进 seq**。
- `emit(kind, payload)` → 新 seq：编码进事件流并唤醒所有挂起者；`onMessage({kind, payload, seq})` 回调供房间层处理入站动作。
- 与 WS 共用 protocol.js 信封，事件对象形状与 WS 文本帧内容完全一致 → 两传输可互换。
- 事件日志保留最近 2000 条（LAN 规模足够；v1 全量 `state` 快照兜底追平）。

### 2.4 http-static.js — 静态文件服务

- `createStatic({server, rootDir, indexFile='index.html'})`：服务 v4-web 文件（index.html + src/**），GET/HEAD。
- Content-Type 映射（html/js/css/text/json + 图片/音频等 19 项），Content-Length + no-cache。
- 路径穿越防护：`path.resolve(rootDir, rel)` 后必须等于 rootDir 或以 `rootDir + sep` 开头，否则 404；`decodeURIComponent` 失败回 400。
- 内置 `/api/hello` → `{ok:true, proto:1, time}`（传输层探活路由）。
- 与长轮询共存约定：响应前置 `req.__oikillHandled = true`，http-static 据此跳过已处理请求（同一 http server 多模块挂接无双重响应）。

### 2.5 transport-test.js — 运行时自检（74 断言）

单一 http server（`listen(0)` 临时端口）同时挂 ws + longpoll + static，客户端只用 node:http 手写：

0. **protocol 信封**（22 断言）：编解码往返、seq 注入/解码、坏 JSON/根非对象/未知 type/非法 seq 拒绝、保留字段冲突抛错、validateAction 骨架（必填/可选参数、pid 校验、无参动作）。
1. **WebSocket**（20 断言）：手动 Upgrade 握手 + Accept 校验；掩码文本帧 → 服务端**不掩码**文本帧 echo；>125B 载荷（126 长度编码）；分片帧重组 echo；ping→pong 自动应答；close(1000) 握手与 onClose 触发；未掩码客户端帧 → 1002 关断。
2. **长轮询**（19 断言）：POST /act → `{ok:true, seq:1}`；GET /poll?since=0 事件往返一致；坏 JSON/未知 type → 400 且不推进 seq；emit → seq=2 单调递增；无事件挂起超时 `{events:[]}`（timeoutMs 缩短为 400ms 验证路径）。
3. **静态**（13 断言）：/api/hello 三字段与 content-type；GET / → index.html；src/** js 文件；不存在文件 404；编码 `..` 路径穿越 → 404；根内相对路径正常服务。

收尾：ws.shutdown + lp.close + stat.close + server.close，无残留句柄，退出码 0。

## 3. 与 recon-02 / net-protocol 的偏差及理由

| # | 偏差 | 理由 |
|---|---|---|
| 1 | 信封新增传输层 `seq` 字段（recon-02 B.3 信封仅 `{type,...payload}`） | 长轮询 `since` 游标必须落在消息上；WS 不注入 seq（TCP 有序），两传输信封仍同构。net-protocol §3 `state` 载荷里的 `seq` 建议由房间层经 `emit`/`encodeMsg` 的 seq 参数注入（encodeMsg 禁止 payload 与参数同时携带 seq，避免歧义） |
| 2 | 长轮询默认把 `POST /act` 入站消息也写入事件流（`logInbound:true`） | 提交者能立即看到自己消息的回声/受理路径，自检可断言「往返一致」；房间层可用 `logInbound:false` 关闭，改由 room 广播 | 
| 3 | `/act` 应答 `{ok:true, seq}`，不含协议 `ack` | `ack/reject` 是房间层职责（net-protocol §1：服务器对每个动作回 ack；P4b 经 `emit('ack',{ref})` 下发）；传输层只管受理与游标 |
| 4 | `/api/hello` 返回 `{ok:true, proto:1, time}`，非协议 `hello` 消息 | 任务指定的传输层探活路由；协议 `hello`（含 mode/self/sessionToken）由房间层在 join 后经 WS/poll 下发 |
| 5 | 二进制帧静默忽略、非法 UTF-8 → 1007、>16MB → 1009、RSV/未掩码/未知 opcode → 1002 | RFC6455 合规性防御，v4 协议只用 JSON 文本帧，超出子集即协议错误关断 |
| 6 | 静态服务包含 `src/net/**`（dev 环境） | 任务要求「index.html + src/**」；SEA 构建（recon-02 C.2）将改为内存路由/内联资源，dev 静态服务仅供局域网开发与 Pages 演示 |
| 7 | 长轮询超时 25s 可配（`timeoutMs`） | 默认值与任务一致；自检缩短至 400ms 以便覆盖超时路径 |
| 8 | 事件日志保留上限 2000 条 | 内存有界；漏拉由 v1 全量 `state` 快照追平（net-protocol §3：v1 全量） |

## 4. 与 P4b（房间层 room.js）的对接要点

1. 启动：`ws = createWsServer({server})`、`lp = createLongPoll({server})`、`static = createStatic({server, rootDir})` 挂同一 http server；`bindEngine(engine)` 接引擎。
2. 入站：`ws.onMessage(connId, text)` → `protocol.decodeMsg` → 房间层处理；`lp.onMessage({kind, payload, seq})` 同语义。
3. 出站：按玩家/全员经 `ws.send(connId, text)` 或 `lp.emit(kind, payload)`（emit 自动注入 seq）；状态快照经 `emit('state', {view, deadline})`。
4. 心跳：`ws.onPong` 与 `lp` 的 `ping/pong` 消息均回 `pong`（15s 超时判断线，net-protocol §5）。
5. 房间层可关闭 `logInbound:false`，并以 `ack/reject` 消息回复每个 action/response（validateAction 的 `why` 直接透传 reject）。
