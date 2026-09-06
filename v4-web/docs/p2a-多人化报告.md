# P2a 多人化引擎改造报告（multi-human engine refactor）

> 执行代理：P2a（multi-human engine refactor）
> 范围：`v4-web/src/engine/*`（core/battle/tricks/skills/index）与 `v4-web/game.js`（仅新增导出键与断言清单）；**未触碰** index.html / test.js / test-extra.js / src\data / src\net / 既有 docs。
> 规格依据：`docs/recon-02-架构方案.md` §B.4（权威模型与引擎改造）与 §F.1（suite-d 期望）；`docs/p1a-拆分报告.md`（命名空间机制与 54 键快照）。
> 结论：**零规则行为变更**——A/B/C/E 全绿；原 54 键逐键不变，追加 4 键；多人提示层（`g.humanSet` + `g.prompts` 多槽 + `drive` 调度）就位。

---

## 一、改造点逐项说明

### 1. 单人类标志 → 多人类集合（`g.humanSet` + `g.isHuman`，移除 `g.askDodge`）

**文件/位置**：
- `src/engine/core.js` `createGame`（L52–L86）：新增 `humanSet:Set`、`prompts:Map`、`promptSeq`、`g.isHuman(pid)`；保留 `g.human` 为"第一个人类 pid"的兼容属性（支持 `opts.humans:[...]` 数组或 `opts.human:pid` 单值；无参默认 0 号，与旧 `human ?? 0` 一致）。
- 全部内部判定改写（grep `g.human` / `g.askDodge` 全清零）：
  - core.js：`endTurn` 进化分流（原 L331 → L708 附近）、`attackPlayer` 卖队友/护驾/WA 三处 `if (g.askDodge)` → `if (g.isHuman(target.id))`（L743–L795）、`playCard` 碾压/攻击（原 L776/L788）、`aiTurn` 祖安对线目标过滤 `q.id !== g.human` → `!g.isHuman(q.id)`（L1290 附近）。
  - battle.js：`afterDodge` 不死心/平衡树（L138–L172）、`resolveHit` 冷数据（L208–L217）、`respondDodge`/`respondBetray`/`respondChase`/`resumeMultiAttack` 中全部 `g.askDodge = (X === g.human)` 赋值删除（判定改由 `attackPlayer` 内部 `isHuman` 承担，语义等价）。
  - tricks.js：`counterChain`/`tryCounter`/`tryCounterOther`/`runCounterCont`harvest/`funReport`/`aoeApplyOne`/`argueApplyOne`/`harvestStep` 的 `q.id === g.human` → `g.isHuman(...)`（L30–L660 各点）。
- `g.askDodge` 标志**整体删除**（幽灵标志，其值恒等于 `X === g.human`，无任何残留读写）。

**兼容说明**：test.js / test-extra.js 只通过 `createGame({human: 0|99})` 传入单值，不直接读 `g.human`；`human:99` 时 `humanSet={99}`，所有真实 pid 均非人类 → A 套件全 AI 语义不变（`g.pending` 恒 null、零挂起）。

### 2. 提示多槽位（`g.prompts:Map` + `g.pending` 兼容别名）

**文件/位置**：
- `src/engine/core.js` L88–L167「多人提示层」：`setPrompt(g,data)`（生成 `pd-${++g.promptSeq}` 确定性 id，写入 `{id,pid,type,ctx,srcId,dmg,deadlineMs,createdAt,...}`，并记 `g._lastPrompt`）、`firstPrompt`、`lastPrompt`、`takePrompt(g,types,pid,promptId)`、`hasBlockingPrompt`（**evo 不阻断行动**，与旧 `evoWait` 语义一致）、`findPrompt`、提示组工具 `groupOpen/groupGet/groupAdd/groupHasOpen/purgeDeadGroupPrompts`。
- `g.pending` accessor（`Object.defineProperty`，enumerable）：**getter** = 第一个未决提示条目（Map 插入序 = 座次/事件序）；**setter** = 遗留语义（清空全部提示；值非 null 时按 `pidOfPromptType` 推断 pid 注册一条新提示）。内部代码已全部改走 `setPrompt/takePrompt`，setter 仅供外部遗留写入兜底（现有测试无直接写入）。
- 全部原 `g.pending = {...}` 创建点改为 `setPrompt`（约 18 处，core 6 / battle 6 / tricks 6）；全部 `g.pending = null` 改为 `takePrompt`（按 id 精确或按 pid+type 取走，**只移除被解析的那一条**，不 clobber 其它提示）。
- `if (g.pending)` 行动阻断守卫（canPlay/playCard 前置/discardFun/kspAttack/fangAttack/skillUse/unitAttack/aiTurn 循环）→ `hasBlockingPrompt(g)`（任一非 evo 提示存在即阻断，单人类下与旧单槽行为逐点等价）。
- 挂起后补写 ctx 的旧写法（`g.pending.ctx = ...`、`g.pending.multi = ...`）改为对 `lastPrompt(g)`（即刚创建的那条）补写；`g.pending.pid/card/cardIdx` 等**只写不读**的死字段删除（已验证无任何读取方）。

**兼容说明**：test.js B 套件读 `g.pending.type/ctx/target/attacker/helpers` 与 C 套件 `g.pending === null` 断言、test-extra E14/E25/E31/E33 对 `g.pending` 的读写全部经 getter/条目对象保持原形态（条目是普通对象，JSON.stringify 安全）。

### 3. respondX 按 promptId 解析 + 多目标拆分

**签名（全部"末尾追加可选 promptId"，旧调用零改动）**：
- battle.js：`respondDodge(g,pid,yes,helperId,promptId)`（L247）、`respondCold(g,pid,yes,promptId)`（L173）、`respondBbst`（L180）、`respondChase`（L192）、`respondBetray(g,pid,targetId,promptId)`（L341）。
- tricks.js：`respondCounter(g,pid,yes,promptId)`（L164）、`respondAoeResp(g,pid,yes,promptId)`（L518）、`respondHarvest(g,pid,choiceKey,promptId)`（L623）、`respondReport(g,pid,cardKey,promptId)`（L652）。
- 不传 promptId 时 = 取该 pid 的**第一个匹配类型未决提示**（插入序），与旧"当前 pending"语义一致；传 promptId 时校验 id+type+pid 后精确取走。

**多目标拆分（并行人提示共存）**：
- **AOE 逐人**：`aoeApplyOne`（tricks.js L385）人类受害者提示携带 `ctx={type:'aoe',...,aoeId,groupId,remaining}`；`precreateAoe`（L429）按座次序（自当前行动者下家，即 requirement.txt 第19章FAQ#2「响应顺序」+ §9.2「从你下家起按行动顺序」的引擎既有迭代序，未改变既有询问方向）为 remaining 中**全部人类受害者**批量预建提示；`resumeAoe`（L445）组感知（跳过已答人类、复用已挂起条目）；`respondAoeResp`（L518）解析后：组内仍有未决 → 挂起（`pending-group`），全部答完 → 从首个挂起点继续结算；单人类时 remaining 无其他人类 → 与旧单槽**逐字节等价**。
- **祖安对线逐目标**：`argueStep/argueApplyOne/precreateArgue`（L461/L495/L481），双人类目标各持一条 `argueResp` 提示（组 id 由 playCard 传入），乱序作答后按座次序继续结算 AI 目标。
- **题解大会逐人**：`harvestStep/precreateHarvest/respondHarvest`（L588/L611/L623），人类选牌者各挂一条 `harvest` 提示（共享 ctx、各带 `pickerPos`），全部答完从首个挂起选牌者之后继续；牌张守恒（每人恰好 1 张、余牌进弃牌堆）。
- **特判连锁**：保持**顺序询问**（每次只有链上"当前应询者"一条 counter 提示；回答后 `counterChain` 继续，产生新条目），多槽下互不覆盖；`counterAsk/contFromCtx/runCounterCont` 的 ctx 补写均指向刚创建的条目。
- **濒死救援**：当前实现全自动（退役/颓废/谈心/备用电源/咖啡均无挂起询问），**无槽位可拆**；已确认 battle.js `nearDeath` 无任何 pending 赋值，无需改动（未来若增加"是否咖啡自救"询问，直接 `setPrompt({type:'rescue',...})` 即可）。

### 4. 截止时间语义 + `timeoutPrompt` / `duePrompts`

- 每条提示自带 `deadlineMs`（响应类 10s；回合内选择类 `discard/evo/lordRedraw` 45s）与 `createdAt`（`Date.now()`），计时权威留给服务器，引擎只存/暴露（`publicView.prompts` 亦带这两字段）。
- `core.js` `timeoutPrompt(g,promptId)`（L1502）：按各 respondX 的"否/放弃"路径结算并移除该提示（dodge/counter/cold/bbst/chase/aoeResp/argueResp → false；harvest/report → null 弃权；evo → `evolvePick(pid,null)` 放弃进化；discard/lordRedraw → declined）。
- `duePrompts(g,now)`（L1521）：返回 `now - createdAt >= deadlineMs` 的提示数组；`promptCount(g)`（L1528）：`g.prompts.size`。

### 5. `drive(g, opts)` 异步调度器（core.js L1454）

- `opts = {thinkMs, difficulty, onState, onPrompt, onEvent}`。AI 回合：判定/摸牌 → think 延迟（`thinkMs` 显式值优先；`difficulty` 给 easy/normal 800–2500ms、hard 800–1500ms 人形随机；**缺省 0，测试无等待**）→ 调用**原样未改的同步 `aiTurn`**（P3 才重写 AI 逻辑）；人类提示挂起 → `onPrompt(g, prompt)` 后返回 `{status:'prompt', promptId, pid, type}`（外部 respondX 后再次 drive）；人类回合 → 代跑判定/摸牌后返回 `{status:'human-turn', pid}`（外部经 playCard/discardPhase/endTurn 驱动后再次 drive）；终局返回 `{status:'over', winner}`。`onEvent` 以日志增量事件喂出，`onState(g,pid)` 每步调用。`aiTurn` 导出保持 100% 同步、签名不变。

### 6. UI 回调槽 prompt 化（discardChoice / evoWait / lordRedraw）

- **`g.discardChoice`**：代码中不存在（仅 discardPhase 注释中的"死引用"幽灵），无需转换——保持现状并在注释中说明。
- **`g.evoWait`**：测试直接读写（test.js B 套件 `finishHumanTurn` 读 `g.evoWait.pid/keys`；test-extra E16 直接写 `g3.evoWait = {...}` 并断言 `=== null`）。采用**双写**：`endTurn` 对人类仍置 `evoWait`（兼容字段原样保留），同时 `setPrompt({type:'evo', pid, keys})`；`evolvePick` 同时清两者。测试读写的 evoWait 行为逐点不变。
- **`lordRedraw`**：引擎无回调槽（`lordCanRedraw` 为查询式 API），无需转换；`timeoutPrompt` 预留 `lordRedraw` 类型的 declined 分支。

### 7. 视图与聚合

- `publicView`（core.js L1198）：`pending` 改为 `pendingView(firstPrompt(g))`（旧字段形状不变），新增 `prompts:[...]`（多槽全量，含 id/pid/type/deadlineMs/createdAt）。
- `src/engine/index.js`：api 对象原 54 键逐键不变，末尾追加 `drive/timeoutPrompt/duePrompts/promptCount`；`game.js` 浏览器分支 KEYS 断言同步追加 4 键（缺任一时抛错），`window.OIKill` 仍为扁平 api。

---

## 二、验收结果

### 1. 语法检查
`node --check`：core.js / battle.js / tricks.js / skills.js / index.js / game.js **6/6 全部通过**。

### 2. 回归（workdir `v4-web`，各连跑 3 轮）

| 轮次 | test.js | test-extra.js |
|---|---|---|
| 1 | A 40/40、B 5/5、C 6/6 | E 34/34、断言失败 0 |
| 2 | A 40/40、B 5/5、C 6/6 | E 34/34、断言失败 0 |
| 3 | A 40/40、B 5/5、C 6/6 | E 34/34、断言失败 0 |

DECK_COUNT=120 守恒未动；test.js / test-extra.js **零修改**。

### 3. 多人冒烟（临时脚本，跑完已删除；31 项断言全过）

- **场景1 AOE 多人类**：3 人类受害者（pid 0/1/2，座次序 [0,1,2]）各持一条 `aoeResp` 提示并存（`deadlineMs=10000`）；AI 受害者 4/5 自动结算；乱序解析 pid1 → 不 clobber pid0/pid2（别名仍指 pid0）；全部解析后 `g.prompts.size===0`、`g.pending===null`、`promptCount()===0`（无泄漏）。
- **场景2 题解大会双人类**：2 条 `harvest` 提示按选牌序 [1,2] 并存；乱序选牌后各自入手正确牌、AI 选牌者照常各得 1 张、余牌守恒、无残留。
- **场景3 超时语义**：`duePrompts` 返回拨回 createdAt 的过期提示；`timeoutPrompt(dodge)` 默认=否 → 目标受 1 伤、提示移除无残留。
- **场景4 drive 全流程**：1 人类 + 5 AI，`drive({thinkMs:0})` 跑完整局到终局（over=true，winner=反贼）；6 次人类回合挂起、6 次 onPrompt（类型 counter/aoeResp/harvest）、6 次超时默认解析；终局 `g.prompts.size===0`。

### 4. 导出键校验（parity）

`node -e "console.log(Object.keys(require('./game.js')).sort().join(','))"` → **58 键** = 原 54 键（与 p1a 快照逐键一致）+ 新增 4 键：
- **新增键：`drive`、`timeoutPrompt`、`duePrompts`、`promptCount`**（全部为函数；旧键未删未改名未换位）。
- 浏览器路径冒烟：按 index.html 顺序 `new Function('window','module',code)` 模拟加载 9 文件 → `window.OIKill` 58 键、新 4 键为函数；`createGame({humans:[0,2]})` 后 `humanSet=[0,2]`、`isHuman(0/2)=true`、`isHuman(1)=false`，`BROWSER-SMOKE-OK`。

---

## 三、最终汇总行

```
node --check: 6/6 通过 (core/battle/tricks/skills/index/game)
node test.js      : === 汇总: A通过=40/40 (不含120守恒=40/40) | B通过=5/5 | C通过=6/6 ===  (×3 稳定)
node test-extra.js: === 汇总: E通过=34/34 | 断言失败=0 ===                                  (×3 稳定)
多人冒烟: 31 断言全过 (AOE 3人并存提示 / harvest 2人并存 / 乱序解析无clobber / 无泄漏 / pending别名 / duePrompts+timeoutPrompt / drive 全流程)
导出键: 58 = 原54(逐键一致) + drive,timeoutPrompt,duePrompts,promptCount
浏览器冒烟: window.OIKill 58键, humanSet/isHuman 正常 (BROWSER-SMOKE-OK)
DECK_COUNT=120 守恒不变; test.js / test-extra.js / index.html / src\data / src\net 未改动
```

## 四、风险与备注（供主代理 / P3 / P4 知悉）

1. **提示组状态 `g._promptGroups` 常驻不删**：每场 AOE/对线/大会各记一个小组对象（`{resume, resolved:Set}`），大小可忽略且局末随 g 弃置；删除时机留给 P4 的局对象回收。
2. **多人类 AOE/对线的特判机会简化**：已预建提示的人类受害者不再被重复询问特判（其段由响应作答决定）；单人类下完全不受影响（无预建）。如需严格"先特判后响应"双问，建议 P4 在服务器提示分发层排定同 pid 多提示的作答次序。
3. **respondX 在取走提示后才做校验**（如 respondDodge 的帮手校验、respondReport 的选牌校验）：与旧"pending 已清空"的观测行为一致（test-extra E14 记录同此行为），UI 依赖重问时请以"服务器先验"替代。
4. **drive 为 P2 最小调度器**：AI 决策仍是旧 aiTurn（含"AI 对人类目标的响应自动处理"）；P3 接入新 AI 时只需替换 `aiTurn` 调用点。`deadlineMs` 仅存储/暴露，**计时权威未实现**（P4 服务器负责）。
5. `g.human` 是普通属性（首个人类 pid）；运行时改 `g.human` 不会同步 `humanSet`——P4 若需动态换人（断线托管/补位），应改调 `g.humanSet`（并建议经 `g.isHuman` 统一判定）。
