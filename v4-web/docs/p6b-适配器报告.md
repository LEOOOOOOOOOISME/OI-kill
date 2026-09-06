# P6b 适配器报告（v2a：adapter + lobby）

- 交付：`src/ui/adapter.js`、`src/ui/lobby.js`、`src/ui/adapter-test.js`（新建）；`src/net/net-api.js`（仅浏览器分支子槽挂载，见 §5）。
- 验证：`node --check` 四文件全过；`node src/ui/adapter-test.js` 连续 3 次 **71/71 全绿**（exit 0，统计完全一致：state 房主79/客机78、event 双方311、prompt 房主11/客机1、自动托管 endTurn 9 次、自动应答 5 次，单次约 21.6s，确定性强）。
- 本报告摘要：§1 门面 API、§2 传输回退、§3 测试覆盖、§4 务实决策、§5 net-api 变更、§6 接线注意（给后续接线阶段）。

## 1. 门面 API（UI 代码只依赖这一层，传输无关）

统一形状（`createLocalClient` 与 `createNetClient` 完全一致，另加各自扩展）：

| 方法 | 语义 |
| --- | --- |
| `join({name, spectate})` | 返回 Promise\<hello\>；网络端带随机 nonce，以 hello.nonce 关联（长轮询共享流防串收） |
| `start(config)` | 网络端 = `config` + `start` 两连发（房主专属由房间层把关）；本地端直接开局并启动 AI 泵 |
| `config(cfg)` / `chat(text)` / `leave()` / `ping()` | 附加门面（房间层同款消息），大厅/集成阶段可用 |
| `sendAction(kind, args)` | 自动补 `args.pid`（lordRedraw/lordCanRedraw 除外）；返回 Promise，ack{ref:kind} 即 resolve，超时（默认 4s 可配）resolve null |
| `sendResponse(promptId, value)` | **由本层依 prompt.payload.type 推导响应 kind**（dodge/counter/cold/bbst/chase/harvest/guard/aoeResp/argueResp/report；`ctx.betrayConsent` 走 dodge 全参路径、`value.targetId` 走 betray）；`evo`/`discard` 两类自动转成 `evolvePick`/`discardCards` 动作；缺省 value=各类型"否/放弃"合法值。返回 Promise（ack{ref:promptId}） |
| `subscribe(cb)` | 收到 `{type:'state'|'prompt'|'event'|'setup'|'lobby'|'hello'|'reject'|'ack'|'pong', ...}`；返回退订函数 |
| `getState()` | 最近一条 state 消息（含 viewSeq/view/deadline） |
| `getView()` | 最近 `publicView`（本地端即 `O.publicView(g, pid)`，网络端取最近 state.view） |
| `getLobby/getSetup/getSelf/getTransport/getStatus/reconnect/stop` | 扩展：大厅数据、自身座位、当前传输、状态（含 token）、手动续接、干净停止 |

网络端 `getStatus()` 暴露 `{transport, stopped, shut, joined, clientId, self, token}`，测试与集成排查用。

**本地客户端**（`createLocalClient(O, opts)`）：引擎同页直驱。join/start/sendAction/sendResponse 同步调引擎函数并**同步派发事件**（hello/lobby/setup/state/prompt/ack/reject 与网络端同形状）；AI 回合由 `O.drive` 异步泵驱动（mirror room.js pump 守卫：人类回合或挂起提示即暂停），提示带本地权威超时（默认按引擎 deadlineMs）。单机语义：仅 1 个真人（pid 0 = 主公），其余座位 AI 顶替；`spectate:true` 时 hello 座位为空、start 被拒（本地无观战场景）。

## 2. 传输回退逻辑（网络端）

- **WS 主通道**：构造即连（浏览器/Node 24 全局 WebSocket），未就绪的消息进 outbox 排队，onopen 冲刷。
- **自动回退**：ws onclose（未 stop 且未收到 shutdown）→ 切换 `mode='lp'`，若已有 sessionToken 立即 `POST /act {join, token, nonce}` 会话续接（token 每次 join 轮换，适配层自动更新）；若初始 join 尚未完成则把未发出的 join 改走 /act。
- **长轮询**：`GET /poll?since=<lastSeq>` 单飞循环（**同一时刻只允许一个在途请求**——第一版曾因遗留 pollTimer 并发重复拉取导致共享流事件重放/viewSeq 倒退，已修）；事件按 `to`（`'*'` 或 `to===clientId`）过滤，join 握手前仅认 nonce 匹配的 hello/reject，握手后按 `seq <= joinSeq` 抑制历史重放（含断线重连场景）。
- **保活**：每 8s（可配）ping；WS 直接发，长轮询经 `/act`（自动附 clientId——房间层靠 clientId 定位会话）。
- **关停语义**：收到 `event{kind:'shutdown'}` → 置 shut，清轮询/定时器/ws，**停止一切重连**（room.shutdown 后的 ws 1001 close 不再触发回退）。
- 已知边界（LAN 可接受）：join 握手瞬间 ws 断线可能留下空座位（hello 已丢），由 UI 重试或 token 重连/宽限期兜底。

## 3. adapter-test 覆盖（71 断言）

- **A 本地冒烟（12 项）**：hello/setup 同步派发、getView=publicView(g,0)、own view、endTurn 直驱、日志事件、停泵干净。
- **B 网络主流程（59 项）**：进程内 room + 真实 http/ws/longpoll（mirror room-test 组装，seed 424242、thinkMs 0）：
  - join 首座=房主（sessionToken≥32）→ 次座非房主 → lobby 广播 canStart；
  - 非房主 config 被拒 → start(2 人类+aiFill 4) → setup（房主=0 号主公、起手 96 牌）→ 初始 own view；
  - 房主/客机 endTurn 均 ack，随后双方收到新 state；
  - 提示定向：首条提示 pid 与收件客户端一致、带 promptId+剩余超时、700ms 内未串发另一客户端、手动 `sendResponse` 收到 ack{ref=promptId}；
  - 兜底：强制关闭房主 ws → 自动切 lp 并 token 续接 → 继续收 state 广播 → 单回合手动让出（manualNext）后经 `/act` endTurn 收到 ack → sessionToken 已轮换；
  - 自动托管至终局：双方收到 gameover 且 **identity===null**、winner 合法、room ended；
  - room.shutdown → 双方收到 server-shutdown（reason 透传）→ 客户端 shut/stopped（无残留轮询/重连）→ 服务器干净关闭；
  - 不变量：全程每客户端 own view（me.id 匹配）、others 无 hand 字段、viewSeq 不倒退、双方共享同一 viewSeq 序列、每条提示 pid 定向正确、turn/log 事件充足。

## 4. 务实决策

1. **response 信封带 kind**：客户端契约写 `response{promptId,value}`，但房间层 `handleResponse` 要求 `payload.kind`；由适配层按提示语义类型推导并随信封发出（与 room-test 的 respondDefault 同口径），UI 无需感知——这是本层对契约的补偿，见偏差记录。
2. **卖队友转嫁同意走 dodge kind**：`ctx.betrayConsent` 用 `respondDodge(g,pid,yes,helperId,promptId)` 全参路径（房间层 betrayConsent 映射的 args 顺序会把 promptId 顶进 helperId 槽，刻意绕开）；`targetId` 显式给定时才走 `betray`。
3. **evo/discard 提示转动作**：这两种语义提示在协议里没有 response 形态，适配层自动转 `evolvePick`/`discardCards`。
4. **本地单机 = 1 真人**：`humanCount` 只决定总人数，其余座位 AI 顶替；随机身份/难度照常传入引擎（drive 采样）。
5. **ack 超时 resolve(null)**：网络端 ack 承诺超时可配（测试 4s），调用方以 null 判无 ack，不阻塞 UI。
6. **自动托管测试无时间窗去重**：thinkMs=0 时一整轮约 150ms，房间层 noteTurn 已按同 pid 去重，客户端再设 1.5s 去重窗会把相邻两轮同一座位的回合事件吞掉造成 60s 停滞（首版踩坑，已移除）。
7. **测试计数快照在动作发送前取**：ack 与随后广播的 state 可能同 TCP 批到达，微任务在整批 frame 派发后才执行，发送后取快照会被新 state 抢先计数（首版 stOk2 踩坑，已改为发送前取）。

## 5. net-api.js 变更（仅浏览器分支）

- 原：`Object.assign(NS, api)` 把 ACTIONS/EVENTS/PENDING_TYPES/buildApi 扁平铺到根命名空间，会被 game.js 浏览器分支的 `root.OIKill = api` 重新赋值覆盖。
- 现：挂 `OIKill.net` 子槽（`NS.net = NS.net || {}; Object.assign(NET, api)`），与 `OIKill.data.* / OIKill.ui.*` 并列。**Node 分支（module.exports）一字未动**，服务器/测试行为不变。
- 接线注意（给 P6b 接线阶段）：`net-api.js`（及依赖它的 protocol 相关脚本、`adapter.js`/`lobby.js`）必须在 `game.js` **之后**加载——game.js 会把根重新赋值为扁平引擎 api，先于它挂上的子槽都会被覆盖。

## 6. 接线注意（后续阶段）

- 浏览器命名空间：`OIKill.ui.adapter`、`OIKill.ui.lobby`（CommonJS 导出同时保留，Node 测试直接 require）。
- lobby.js 的样式类统一 `.lobby-*`（lobby-root/panel/title/url/join-row/name/spectate/join/seats/seat(-me/-host/-off/-empty)/config/cfg/actions/start/status/copy），集成阶段补 CSS；页面切换经 opts 回调（onHello/onLobby/onReject/onGameStart/onState）。
- index.html 由后续接线 agent 负责（本阶段未触碰）。
