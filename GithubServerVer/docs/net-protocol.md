# 《OI杀》v4 网络协议 v1 规格

> 版本：`proto: 1` ｜ 依据：recon-02 架构方案 B.3（协议草案）与 B.4（权威模型）
> 接口规格源码：`src/net/net-api.js`（ACTIONS / EVENTS / PENDING_TYPES / buildApi，本协议表格以其为准）
> 角色：服务器 = 房主 exe 进程（唯一真实状态）；客户端 = 浏览器（只发意图、只收视图）

## 1. 消息信封（transport 无关）

所有消息均为单个 JSON 对象：`{ "type": "<消息名>", ...载荷字段 }`。

- **主推传输**：WebSocket 文本帧（手写 RFC6455 服务端，零依赖）。
- **兜底传输**：JSON 长轮询 —— `GET /poll?since=<seq>` 拉取增量、`POST /act` 提交消息；与 WS **共用同一信封与同一 room 会话层**，仅传输实现不同。WS upgrade 失败（企业代理/防火墙）时客户端自动降级；回合制 1~2s 延迟可容忍。
- 客户端提交的每个动作/响应消息，服务器回 `ack` 受理回执；非法操作回 `reject`。

## 2. 客户端 → 服务器

| 消息 | 载荷 | 说明 |
|---|---|---|
| `join` | `{name, token?}` | 入座；携 `token`（此前下发的 sessionToken）为断线重连；`{name:"", spectate:true}` 观战 |
| `config` | `{humanCount, aiFill, randomIdentity, difficulty}` | 仅房主可改：房间配置（humanCount 1~6，aiFill 补位 AI 数，身份随机开关，难度） |
| `start` | `{}` | 仅房主可开局：服务器执行 `setup(g, names)` → 广播 `setup`+`state` → 主公先手 |
| `action` | `{kind, args}` | 玩家**意图**。`kind` ∈ `ACTIONS`（net-api.js 24 项：playCard/equipCard/deployUnit/unitAttack/skillUse/endTurn/discardFun/kspAttack/fangAttack/lordRedraw/discardCards/playerLeave/evolvePick/lordCanRedraw 与全部 respond*）；`args` 按 ACTIONS 声明的参数顺序（含 `pid`，服务器校验 pid 与座位会话一致）。服务器经 `buildApi(engine)` 映射到引擎函数调用并校验 |
| `response` | `{promptId, kind, value}` | 响应挂起提示。`kind` ∈ `PENDING_TYPES.type`（dodge/counter/betray/cold/bbst/chase/harvest/guard/aoeResp/report/argueResp/betrayConsent，见 net-api.js）；`value` 形状：`{yes?, helperId?, targetId?, cardKey?, indices?, choiceKey?}`；`promptId` 对应服务器下发的 prompt |
| `chat` | `{text}` | 聊天广播（全员可见，含 AI 视觉一致要求） |
| `ping` | `{}` | 心跳；服务器回 `pong`（心跳间隔 15s，超时判定断线） |
| `leave` | `{}` | 主动离场 → 服务器执行 `playerLeave`（离场即投降，身份公开） |

## 3. 服务器 → 客户端

| 消息 | 载荷 | 说明 |
|---|---|---|
| `hello` | `{proto:1, mode:'lan'\|'single', self:{pid, seatId, name, isHost}, sessionToken}` | 握手：版本、运行模式、本机席位信息；首次入座下发 sessionToken（crypto 随机） |
| `lobby` | `{players:[], config, canStart}` | 大厅状态（房主 config 变更后广播） |
| `setup` | `{professions, myIdentity, lordPid, deckCount}` | 开局信息：职业分配、本人身份、主公席位、牌堆数 |
| `state` | `{view: publicView(pid), seq, deadline:{turn, resp}}` | 权威快照，每个动作/响应结算后**按玩家**广播；v1 全量（可后加增量）；`view` 只含本视角（手牌/身份过滤），`seq` 单调递增（长轮询 since 游标） |
| `prompt` | `{promptId, type, payload, timeoutMs:10000}` | 要求该玩家响应挂起提示：`type`/`payload` 形状见 `PENDING_TYPES`（net-api.js）；10s 超时 = 按「否」 |
| `event` | `{kind, payload}` | 全局广播（AI 与真人走同一条管线）：`kind` ∈ `EVENTS`（net-api.js 22 项：state/log/fx/sfx/judge/damage/heal/death/guard-block/equip/deploy/unit-die/awaken/evo/event/gameover/achievement/chat/turn/prompt/reject/shutdown），`payload` 形状见 EVENTS 声明 |
| `reject` | `{why, ref?}` | 非法动作/响应拒绝（如「非行动阶段」「灵感不足」「无挂起询问」——原样透传引擎返回的 why），`ref` 引用被拒消息 |
| `ack` | `{ref?}` | 动作/响应受理回执（不代表结算完成，结算结果以 `state`/`event` 为准） |
| `pong` | `{}` | `ping` 应答 |

## 4. 超时语义（服务器权威）

| 计时项 | 时长 | 到期行为 |
|---|---|---|
| 出牌回合 | **45s** | 服务器强制结束出牌：内部先跑 `discardPhase`（弃至手牌上限）再 `endTurn`，并广播 `turn`/`state` |
| 挂起响应 | **10s** | 视为「否」：按 `PENDING_TYPES` 对应应答函数的 `yes=false`（或默认选择）结算并广播 |

- 计时**只在服务器**（room.js 权威时钟）；客户端计时器仅作展示，客户端提交一律以服务器时钟校验，超时后的迟到提交按 `reject` 或忽略处理。

## 5. 断线重连

1. `join` 成功即下发 `sessionToken`（crypto 随机），会话与座位绑定。
2. 断线（心跳 15s 无响应或连接断开）进入 **60s 宽限期**：携原 token 重新 `join` → 服务器重发全量 `state` + 当前未决 `prompt`（含剩余超时）。
3. 宽限期满未归 → 服务器执行 `playerLeave`（离场即投降，requirement 2.7；身份公开）。
4. 观战者断线：仅重新订阅广播，不占座位、不触发 playerLeave。
5. 房主断线即服务器不可用：客户端提示重连失败，等待房主重启（`shutdown` 广播提示）。

## 6. 权威模型

- **服务器持有唯一真实状态**：`g` 对象只存在于房主 exe 进程；客户端只收 `state` 视图、只发意图，绝不信任客户端状态（手牌/牌堆/身份/费用一律以服务器为准）。
- **每个 action/response 经引擎校验**：服务器对 `action.kind` 查 `ACTIONS` 表 → `buildApi(engine).fnByName[fn]` 调用（`g` 由服务器注入、`pid` 与座位会话比对）→ 返回 `{ok:false, why}` 即回 `reject`。
- **敏感信息过滤**：`state.view` 只发 own view；`event.log` 与 `event.event` 广播需保持内奸脱敏口径（与引擎 `kill()` 日志、UI `logToHtml` 两处一致）。
- **响应顺序**：护驾/特判连锁/AOE 逐人询问由服务器按座位顺序（requirement FAQ-2：自当前行动者下家起逆时针）串行生成 prompt，不信任客户端自报。

## 7. 与 net-api.js 的对应关系

- 动作全集 = `ACTIONS`（24 项，`kind`/`fn`/`args` 与 game.js 基线签名一致，含 recon-01 的两处签名修正：`playCard`/`skillUse` 实际为 5 参）。
- 广播事件全集 = `EVENTS`（22 项）。
- 挂起提示全集 = `PENDING_TYPES`（12 项：10 个基础类型 + fixlog-1a 的 `argueResp`/`betrayConsent` 变体）。
- 引擎多人化缺口（`g.pending` 单槽、`g.askDodge` 单布尔、`g.discardChoice` 死引用等）见 net-api.js 第五节注释，属 P2 改造范围，不在本协议文件内解决。
