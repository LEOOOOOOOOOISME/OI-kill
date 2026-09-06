# P4b 房间层报告（Room/Server 权威层 + 双模式服务端入口）

> 阶段：P4b ｜ 依据：recon-02 §B/§C.3、net-protocol.md、p4a-传输层报告 §4、p2a-多人化报告（引擎契约）
> 约束遵守：仅在 `src/net/` 下**新增** `room.js` / `room-test.js`，**未改动** protocol.js / ws-server.js / longpoll.js / http-static.js / net-api.js；新建 `server/`（boot.js / lan-server.js / single-server.js）；**未触碰** src/engine、src/ai、src/data、index.html、test.js、test-extra.js。零 npm 依赖（仅 node:crypto / node:os / node:http / node:net / node:path / node:readline / node:child_process）。

## 1. 交付物清单

| 文件 | 行数 | 字节 | 职责 |
|---|---|---|---|
| `src/net/room.js` | 868 | 42,711 | 房间/会话/权威状态机（大厅、权威对局、权威计时、AI 泵、断线重连、观战、聊天、关停） |
| `src/net/room-test.js` | 514 | 28,291 | 运行时自检：**73 断言**（进程内直驱主流程 63 + 真实 HTTP/WS/长轮询传输冒烟 10） |
| `server/boot.js` | 124 | 6,103 | 共用启动：端口策略 8080→8099→0、UTF-8 横幅、局域网 IPv4、防火墙提示、自动开浏览器、q 安全退出 |
| `server/lan-server.js` | 34 | 1,758 | mode 'lan'：0.0.0.0 + 静态 + WS + 长轮询 + room |
| `server/single-server.js` | 52 | 2,363 | mode 'single'：127.0.0.1 + 1 人 + N AI（`--ai=N` / `?ai=N`，默认 5），跳过大厅直开对局 |

## 2. 验证结果

| 项目 | 结果 |
|---|---|
| `node --check` | 5/5 全过（room.js / room-test.js / boot.js / lan-server.js / single-server.js） |
| `node src\net\room-test.js` | **73/73 断言通过，退出码 0**，连跑 3 轮全绿（seed 固定 424242，thinkMs=0，确定性） |
| `node src\net\transport-test.js`（回归） | **74/74 全绿**，退出码 0（p4a 传输层无回归） |
| 引擎测试套件 | 按要求**未运行**（P2b/P3 并行施工中，非本代理文件） |
| single 模式 autoStart 冒烟 | join 1 人 → 直开 1 人类 + 3 AI = 4 人局（identity=lord、deck 正确、state.me.id=0） |
| lan-server 启动冒烟 | 横幅打印正确，`q` 回车广播 server-shutdown 后退出码 0 |

断言覆盖（room-test 63 项主流程）：join 座位/房主/sessionToken、lobby、config/start 房主专属拒绝、setup（lordPid/deckCount/seatToPid）、开局 120 牌守恒、**每客户端 state 只含 own view**（me.id 匹配 + others 无 hand 字段，逐条消息即时校验）、**prompt 定向到正确人类**、合法响应解析（无残留）、非法动作 4 类拒绝（非行动阶段 / 他人回合 endTurn / 伪造 pid 被覆盖 / 未知 kind）、**超时按默认"否"结算**、**断线 token 重连**（全量 state 重发 + 同 promptId 未决提示重发 + 快照与引擎逐字节一致 + 旧 token 作废）、观战脱敏（无手牌/无提示/存活身份不可见）、AI 座位产生回合/日志事件（与真人同一管线）、终局 winner/gameover 广播/**终局 120 牌守恒**、server-shutdown 广播与干净关停。

## 3. 实现要点（与任务逐条对应）

- **大厅生命周期**：`join`（name + crypto.randomUUID sessionToken，token 每次成功 join 轮换作废旧 token）；座位 ≤6、房主=首座；`config` 四字段房主专属；`start` → `engine.createGame({humans:[...], seed})` + `engine.setup(g, names)`，AI 补位其余座位（总人数 = clamp(humanCount+aiFill, 3, 6)，已入座人类不足 humanCount 时其余座位也由 AI 补）。
- **身份分配**：引擎固定 0 号=主公，`randomIdentity` 开关由房间层打乱 `seatToPid` 映射实现"主公不一定是房主"；默认房主=0 号主公（与 recon-02 B.4 一致）。
- **权威对局**：action/response 经 `protocol.validateAction`（bindEngine 已接 buildApi）执行；**每个动作结算后统一走广播路径**：state（每客户端各自 `publicView(g, 该客户端 enginePid)`）+ 目标人类 prompt + 全局 event；AI 与真人共用同一条 `drive` 事件流（onEvent 喂日志、onState 喂 state/回合事件）。
- **服务器权威计时**：出牌回合 45s（超时 → discardPhase+endTurn+广播，`turnTimeoutMs` 可配）；每个 prompt 条目独立 setTimeout（响应类 10s、回合选择类 evo 45s，取引擎条目 `deadlineMs`，`promptTimeoutMs` 可覆盖）→ `engine.timeoutPrompt(promptId)` 默认"否/放弃"并广播。迟到计时器不碰当前回合状态（防回合已轮转时误清 inHumanTurn）。
- **AI 泵**：`engine.drive(g,{thinkMs: 按 difficulty 采样(由 drive 内部 800~2500ms 人形随机), onState/onPrompt/onEvent})`；人类提示挂起即暂停泵，响应/超时后恢复；多槽并发提示（AOE 逐人/题解大会逐人）一次性补发全部人类提示；**防陈旧结果竞态**（drive 挂起期间被并发 endTurn 推进 → human-turn 结果作废重验）。
- **断线重连**：60s 宽限（`graceMs` 可配）；重连重发 hello+setup+全量 state+该 pid 未决 prompt（含剩余超时）；超期 → `playerLeave`+死亡事件广播；观战者断线仅清理。
- **观战**：`spectatorView` 剥除手牌/身份/未决提示（死亡翻牌规则与 publicView 同口径）。
- **聊天/关停**：chat 广播（from=座位/名字）；`shutdown` 广播 event kind `shutdown`，清全部计时器，退出码 0。
- **boot.js**：端口 8080→8081..8099→0；UTF-8 横幅（版本/模式、本机地址、局域网 IPv4 列表——`os.networkInterfaces` 过滤非回环 IPv4、排除 127.0.0.1/0.0.0.0，与旧 C++ main.cpp 同法）；netsh 防火墙提示；`输入 q 回车安全退出`；`--no-browser` 关闭自动开浏览器（`child_process.exec('start …')`）；保持控制台子系统（只用 stdin/stdout）。

## 4. 协议说明与偏差（对 recon-02 / net-protocol，均含理由）

| # | 偏差 | 理由 |
|---|---|---|
| 1 | `prompt` 消息为 `{promptId, pid, payload:{type,...}, timeoutMs}`，**type 放进 payload**，而非 net-protocol §3 的顶层 `{promptId, type, payload}` | 信封保留字段 `type` 由传输层持有（protocol.js 拒绝 payload 携带 type）；顶层同名字段在 JSON 序列化后互相覆盖、decodeMsg 直接判未知类型。语义信息零丢失（P6b 读 `payload.type`） |
| 2 | `state` 载荷用 `viewSeq`（房间层单调快照号）替代 net-protocol 的 `seq` | 长轮询传输层在信封注入 `seq` 游标，protocol.encodeMsg 禁止"payload 携带 seq 同时传 seq 参数"；两传输共用同一载荷形状。P6b 以 viewSeq 判断快照新旧，以信封 seq 做轮询游标 |
| 3 | 长轮询共享流无每连接通道 → 出站信封附 `to`（私信=clientId，全局='*'）寻址；join 需带 `nonce`，hello 原样回带 nonce 供客户端关联 | p4a 的 lp.emit 是全局流；"每客户端各自视角 state"必须靠寻址实现。WS 路径不受影响（直接私发，无 to 字段）。**P6b 适配层必须实现该过滤契约**（见 §6） |
| 4 | `randomIdentity` 通过打乱 `seatToPid`（座位→引擎 pid）映射实现 | 引擎 setup 固定 0 号=主公（p2a 契约未提供身份重排入口）；setup 消息携带权威 `pid`/`seatToPid`，hello 阶段 pid 暂用 seatId 占位 |
| 5 | 房间层补权威守卫：`endTurn/discardCards/discardFun/kspAttack/fangAttack/playCard/equipCard/deployUnit/unitAttack/skillUse` 强制 `g.turn === 本人引擎pid`；`lordRedraw/lordCanRedraw` 校验调用者=主公；`evolvePick` 校验有本人未决 evo 提示 | 引擎未给 endTurn/discardCards 等加回合守卫（实测他人可替任何人结束回合）；net-protocol §6 要求服务器校验，不信任客户端 |
| 6 | 引擎 void 返回（endTurn）与布尔返回（lordCanRedraw）视为成功 | ACTIONS 表语义：这些函数无 {ok} 契约；按 {ok:false} 处理会误拒合法 endTurn |
| 7 | 引擎若为 AI pid 生成挂起提示（契约上不应发生），房间层防御性立即 `timeoutPrompt`（默认"否"）继续泵 | 防死锁；正常对局不触发 |
| 8 | 长轮询必须先于 http-static 注册到同一 http server（lan/single 已按此接线） | http-static 靠 `req.__oikillHandled` 跳过已处理请求，但只在其异步 fs 回调里置位；若静态先注册，GET /poll 会先发起 fs 探测，回调时长轮询已响应 → ERR_HTTP_HEADERS_SENT 崩溃（room-test 实测复现并修复接线顺序）。p4a §4 推荐的挂接顺序即长轮询在前 |
| 9 | fx/sfx/judge/damage/heal/death/equip/deploy/awaken/evo/event/achievement 事件由 g.log 文本**启发式派生**（小规则表），payload 形状按 net-api EVENTS | 引擎只产出日志流；P7 动效系统落地前的过渡实现，事件管线（AI=真人同流）已就位，规则表可被 P7 替换 |
| 10 | 提示超时以引擎条目 `deadlineMs` 为准（响应类 10s / evo 45s），房间层 `promptTimeoutMs` 可整体覆盖（测试用） | 与 net-protocol §4 语义一致（45s 回合内选择、10s 响应），同时给测试留快进入口 |
| 11 | `evo` 提示经 ACTION `evolvePick` 应答（非 response 消息）；`discard/lordRedraw` 提示当前引擎不产生 | net-api PENDING_TYPES 12 项不含 evo；引擎 `timeoutPrompt` 的 evo 分支走 `evolvePick(pid,null)`，房间层保持同一语义 |
| 12 | state 的 `deadline` 发配置常量 {turn:45000, resp:10000}（非剩余毫秒）；实际剩余由客户端从 turn 事件起自行倒计时 | net-protocol §3 示例即常量；服务器权威超时判定不受客户端时钟影响 |

## 5. 启动横幅实测（`node server\lan-server.js --no-browser`，随后输入 q，退出码 0）

```
================================================
  《OI杀》 v4.0.0 · 多人局域网版  (mode: lan)
================================================
  本机地址:   http://127.0.0.1:8080/
  局域网地址: http://192.168.1.223:8080/
  局域网地址: http://172.30.0.1:8080/
  其它设备无法访问时, 请在房主电脑以管理员运行:
    netsh advfirewall firewall add rule name="OIKill" dir=in action=allow protocol=TCP localport=8080
  输入 q 回车安全退出 (退出前广播 server-shutdown)
```

single 模式横幅同版式（`单人版 (mode: single)`），仅本机地址（127.0.0.1）。

## 6. 对 P5 / P6b 的风险与对接要点

**P6b（NetClient 适配层）必须知道的契约：**
1. **长轮询过滤契约**：所有事件信封带 `to`（'*' 全局 / clientId 私信）；join 带自生成 `nonce`，收到 `nonce` 匹配的 hello 后，用 `self.clientId` 过滤后续私信；全局事件收 `to==='*'`。
2. **prompt 语义 type 在 `payload.type`**（偏差 #1）；response 消息仍为 `{promptId, kind: payload.type, value}`（kind 在 response 载荷顶层，与信封不冲突）。
3. **state 用 `viewSeq` 判新旧**（偏差 #2）；`deadline` 为配置常量。
4. **hello 的 self.pid 在开局前只是 seatId 占位**；`setup` 消息（携带权威 `pid`/`seatId`/`seatToPid`/`myIdentity`/`lordPid`/`professions`/`deckCount`）才是对局身份来源——所有视图/事件中的玩家标识均为**引擎 pid**，经 `seatToPid` 反查座位渲染。
5. 观战者：`state.view.me` 无意义（0 号玩家脱敏底），UI 需忽略 me、只用 others/事件；观战者不能发 action/response（reject）。
6. `gameover` 是全局广播（identity 字段为 null），各端阵营横幅取自己最后一份 state 的 `me.identity`。
7. 收 `event.kind==='shutdown'` 时停止重连并提示"房主已退出"（房主断线=服务器不可用，recon-02 §B.4 已知）。
8. 心跳：15s `ping`，服务器回 `pong`；两周期无动静判断线进宽限。

**P5（单机化/LocalClient）注意：**
- single-server 的 `autoStart`（1 人 + N AI 直开）已就绪，`?ai=N` 查询参数与 `--ai=N` 均生效；LocalClient 路径（`?mode=local`）只需与 NetClient 的事件流形状对齐（P5 验收的"事件流 diff 一致"）。
- 房间层对引擎的两点驱动假设（与 p2a 冒烟一致）：①开局**不**调 `startTurn(0)`（drive 自代判定/摸牌；实测调了会破坏首轮 lordCanRedraw 判定——该判定依赖 `turnsPlayed===0`）；②主公 mpMax 成长因此比其他人晚一轮生效（引擎侧已知怪癖，P2b 可择机修）。

**通用风险：**
- 局域网明文无 TLS/鉴权（LAN 信任模型，与 recon 一致）；token 轮换缓解冒名。
- fx/sfx 启发式规则粗粒度（seat 由名字匹配推断），P7 需在 fx-map 落地时替换。
- SEA 打包须保持控制台子系统（GUI 子系统丢 stdout）；`chcp 65001` 经子进程执行**不会**改变父控制台代码页（旧 C++ 是进程内调用），现代 Windows Terminal 默认 UTF-8 无碍，legacy cmd 可能乱码——发布说明建议用 Windows Terminal。
- 长轮询共享流含所有客户端的 state（每客户端一份，to 寻址），旁观客户端理论上可读到他人视角——LAN 信任模型可接受，如需加固可在 lp 层按 token 分片（超出本阶段范围）。
- 对局中离开=投降（playerLeave），座位保留但不可再入座，原 token 重连仅恢复观战视角。

## 7. 未改动文件确认

`src/net/protocol.js`、`src/net/ws-server.js`、`src/net/longpoll.js`、`src/net/http-static.js`、`src/net/net-api.js`、`src/engine/**`、`src/ai/**`、`src/data/**`、`index.html`、`test.js`、`test-extra.js` 均未修改（仅读取）。
