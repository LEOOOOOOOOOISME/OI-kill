# P1b 网络协议面报告（net-api.js / net-protocol.md）

> 交付文件：`v4-web/src/net/net-api.js`、`v4-web/docs/net-protocol.md`
> 验证方式：`node --check src\net\net-api.js` + `node -e "require('./src/net/net-api.js'); buildApi(require('./game.js'))"` 运行时抽查（未运行 test.js，未触碰 game.js / index.html / test.js / test-extra.js 与 src\ 其他文件）

## 1. 交付概览

| 项目 | 数量 | 说明 |
|---|---|---|
| ACTIONS（客户端→服务器动作） | **24** | 覆盖任务书列出的全部动作：playCard/equipCard/deployUnit/unitAttack/skillUse/endTurn/discardFun/kspAttack/fangAttack/lordRedraw/discardCards/playerLeave/evolvePick/lordCanRedraw + 9 个 respond* + respondDodge/Counter/Betray/Cold/Bbst/Chase/Harvest/Guard/AoeResp/Report |
| EVENTS（服务器→客户端广播） | **22** | state/log/fx/sfx/judge/damage/heal/death/guard-block/equip/deploy/unit-die/awaken/evo/event/gameover/achievement/chat/turn/prompt/reject/shutdown，各带 payload 形状 |
| PENDING_TYPES（挂起提示） | **12** | 10 个基础类型（dodge/counter/betray/cold/bbst/chase/harvest/guard/aoeResp/report）+ fixlog-1a 新增 argueResp、betrayConsent 两变体 |
| `node --check` | **通过** | `CHECK OK` |
| `buildApi` 运行时契约 | **通过** | 对真实 game.js 绑定 24/24；对空对象抛描述性错误 |

## 2. 与 recon-01 的签名修正（重要）

1. **playCard 实际 5 参**：`playCard(g, pid, cardIdx, targetId, targetId2?)`（game.js L1652）——recon-01 记作 4 参。第 5 参 targetId2 仅【祖安对线 funArgue】需要第二名目标（L1898），其余牌忽略。
2. **skillUse 实际 5 参**：`skillUse(g, pid, name, targetId, targetId2?)`（L2390）——recon-01 记作 4 参。targetId2 供觉醒【口嗨 kouhai】第二目标（L2389/L2466）。
3. **guard 无引擎 pending**：recon-01 说 respondGuard「现为占位」属实——引擎无 `type:'guard'`，respondGuard 恒返回 `{ok:false, why:'挡刀由引擎自动裁决,无挂起询问'}`（L2271）。协议保留该 kind 供未来启用。
4. **betray 无独立 pending 类型**：复用 `type:'dodge'` + `ctx.betrayAvail/betrayOptions`（L920），respondBetray 校验 `pd.type!=='dodge'` 即拒（L2284）。
5. **lordRedraw(g) 无 pid**（L2627）：多人化后服务器需校验调用者是主公（先调 lordCanRedraw）。
6. 其余签名与 recon-01 一致（equipCard/deployUnit/unitAttack/discardFun/kspAttack/fangAttack/discardCards/playerLeave/evolvePick/lordCanRedraw 及各 respond*）。

## 3. PENDING_TYPES 两处 fixlog 变体（均已核实）

- **argueResp**（fixlog-1a L42-45）：引擎 `type:'argueResp'`（game.js L1560），payload `{victim, srcId, trickKey:'funArgue', dmg:1, ctx?}`；经 **respondAoeResp** 作答（L1576-1594 扩展接受该类型）：yes=弃 1 张随机手牌，no=受 1 伤，答完自动继续下一目标。
- **betrayConsent**（fixlog-1a L76-79）：引擎复用 `type:'dodge'` + `ctx.betrayConsent:true` + betrayer/srcId/dmg（L926/L2308）；经 **respondDodge** 作答（L2177-2205）：yes=同意转嫁、no=攻击落回原目标且牌保留。
- 附带：fixlog-1b 的 counterChain 复用 `type:'counter'` + `ctx.type:'counterChain'`（L1133），已写入 counter 条目的 payload 与 desc。

## 4. 实现要点

- `net-api.js` 为 CommonJS + IIFE 双端模块（沿用 recon-01 3.1 模板），**不 require 引擎**，引擎拆分落地前即可独立 `node --check`。
- `buildApi(engine)` 惰性构建 `{fnByName}`（动作函数名 → bind(engine) 后的引擎函数）；缺失时一次性抛出列出全部缺失函数名 + 行号的描述性错误。
- ACTIONS 每条含 `kind/fn/args/desc/line/note`，EVENTS 每条含 `kind/payload/desc`，PENDING_TYPES 每条含 `type/respond/respondArgs/value/payload/desc/cite`。
- 多人化引擎缺口（g.pending 单槽、g.askDodge 单布尔、g.discardChoice 死引用、逆时针询问顺序、publicView 之外直读 g.players）按要求写入 net-api.js 第五节注释。
- `net-protocol.md` 按 recon-02 B.3/B.4 落成：client→server 7 条（join/config/start/action/response/chat/ping/leave）、server→client 9 条（hello/lobby/setup/state/prompt/event/reject/ack/pong）、45s/10s 服务器权威超时、sessionToken+60s 宽限+playerLeave 重连、服务器唯一状态+buildApi 校验权威模型、WS 主推 + 长轮询兜底同信封。

## 5. 对并行 src\ 构建 agent 的提示

- 本文件只占用 `src\net\net-api.js` 一个路径；不 export 与引擎模块同名键，浏览器命名空间只挂 `OIKill.ACTIONS/EVENTS/PENDING_TYPES/buildApi`。
- 引擎聚合入口（src/engine/index.js）若保持 54 键契约，`buildApi` 即可零改动通过运行时校验（已用旧 game.js 验证 24/24）。
