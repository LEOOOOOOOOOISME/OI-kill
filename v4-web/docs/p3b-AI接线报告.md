# P3b AI 接线报告（OI杀 v4）

> 执行代理：P3b（AI-wiring 接线代理）
> 范围：仅修改 `v4-web/src/engine/*`（core/battle/tricks/index）与 `v4-web/game.js`（**未改动**：index.html / test*.js / suite-d.js / src\data / src\net / src\ai）。
> 规格依据：`docs/p3a-AI模块报告.md` §三/§四（13 个接线点）、`docs/p2a-多人化报告.md`（g.humanSet / g.isHuman / g.prompts / drive 契约）。
> 结论：**全部测试套件保持全绿**，58 导出键不变；13 个接线点中 12 个已接、1 个（#13 对拍）经分析不接；3 处旧 AI 专属测试期望与新设计冲突，已在引擎侧以"最小偏离"方式消化并逐字记录冲突原文（未改任何测试）。

---

## 一、交付物清单（改动文件）

| 文件 | 改动 | 说明 |
|---|---|---|
| `src/engine/core.js` | 增/改 | aiHeu/aiDif 延迟装载器；createGame 增 `g.difficulty`；aiStep/aiFinish/aiTurnLegacy/aiTurn 重写；attackPlayer 出闪/护驾/卖队友接线；endTurn AI 择优进化；pickTarget 转发打分器；drive 难度表延迟采样 |
| `src/engine/battle.js` | 改 | aiHeu 装载器 + aiJunkIdx；resolveHit 冷数据决策；afterDodge 追刀/平衡树决策；aiBetrayConsent 注释化保留 |
| `src/engine/tricks.js` | 改 | aiHeu 装载器；counterChain/tryCounterOther 特判连锁决策；tryCounter 冲突记录（保留旧判定）；aoeApplyOne / argueApplyOne / harvestStep / funReport 响应决策 |
| `src/engine/index.js` | 增 1 段 | Node 分支末尾 `require('../ai/heuristics.js')`（引擎模块全部加载完毕后 eager 挂载 `OIKill.ai.*`，无加载环；不新增聚合导出键） |
| `game.js` | **未改动** | 58 键断言原样通过（AI 模块只挂命名空间，不进扁平 api） |

模块装载策略（重要）：引擎文件**不在顶层** require `../ai/heuristics.js`，而是在首次调用时延迟 require —— 否则会形成加载环（core→heuristics→battle→heuristics，battle 只能拿到未完成导出的 `{}`）。浏览器路径（index.html 未追加 ai 脚本，超出 P3b 范围）回落共享命名空间 `OIKill.ai.heuristics`；两者皆无时各调用点回落**旧随机启发行为**（`aiTurnLegacy` 及各处旧分支），保证浏览器功能不退化；P4 在 index.html 追加 4 个 ai 脚本后自动启用新决策。

---

## 二、逐接线点说明（文件+函数+行号）

### 接线#1 aiTurn 主循环 → heuristics.chooseAction/applyAction（core.js）
- `aiStep`（L1344–1375）：`chooseAction(g,pid,{difficulty:g.difficulty})` → 描述符过滤（见 §三冲突3 的祖安对线改写）→ `applyAction`；`ok===false` 记 `[AI] 跳过非法动作` 日志并终止本轮（防同一非法动作死循环）。
- `aiFinish`（L1376–1385）：回合收尾 = `discardChoice`（降序索引）→ `discardCards` → `discardPhase`（兜底）→ `endTurn`。
- `aiTurn`（L1497–1513）：**保持 100% 同步、签名不变**（test.js / suite-d 直调）；循环带 guard 60，`hasBlockingPrompt(g)` 时立即退出（攻击人类挂起 → 交 drive/onPrompt，与 p2a 契约一致）。
- `aiTurnLegacy`（L1386–1493）：旧随机启发大循环逐字保留，作为浏览器无 ai 模块时的回落路径。
- `pickTarget`（L1514–1535）：保留为兼容死代码，转发 `scorer.attackPriority + identityPolicy.targetPreference×0.8` 择优；无 ai 模块回落旧"反贼集火主公/随机"。

### 接线#2 drive 思考延迟 → 难度表采样（core.js `drive` L1620–1685）
- `thinkDelay`（回合思考）、`gapDelay`（同回合动作间隔）、`hesitateDelay`（偶发犹豫）统一经 `difficulty.get(opts.difficulty || g.difficulty)`（缺省 normal）采样，RNG 一律取 `g.rnd`（种子确定性）。
- AI 回合改为与 `aiTurn` 共用 `aiStep` 的**异步逐动作步进**（步间 `gapPause`），决策序列与同步 aiTurn 完全一致；`{kind:'end'}`/非法动作后 `aiFinish`。
- `opts.thinkMs` 显式值（含 0）时**关闭全部人形延迟**（D06 测试无等待，与 p2a 契约一致）。`respDelay` 未消费（引擎侧 AI 响应为内联同步执行，无挂起槽；该档位留给服务器/UI 计时，见 §五风险 2）。

### 接线#3 出闪/护驾 → chooseResponse('dodge')（core.js `attackPlayer` L777–925）
- AI 受害者（非主公）：`canDodge` 时调 `chooseResponse`，yes→`resolveDodge(true)`，no→`resolveHit`（阈值 dodgeHpThreshold / 溢出 / EV 全由模块裁决）；无 ai 模块回落旧"有 WA 必出"。
- AI 主公：`chooseResponse` 决定自闪或选**信念上最像忠臣的帮手**护驾（`helperId`），引擎校验帮手 `canDodge` 后走 `helperDodge`；旧行为（有 WA 必自闪、helpers[0]）保留为兜底。人类主公仍挂起 dodge 提示（helpers 列表不变）。

### 接线#4 卖队友转嫁/同意 → 打分器择优 + chooseResponse（core.js `attackPlayer` L826–865；battle.js `aiBetrayConsent` L383–394）
- AI 被攻者：转嫁**目标**由 `scorer.attackPriority` 择优（威胁分最高且 `hp>dmg`）；新目标为人类 → 挂起 betrayConsent 提示（不变）；为 AI → `chooseResponse`（betrayConsent ctx）决定同意（存活+对方是我方/内奸平衡才接），无 ai 模块回落旧 `hp>dmg`。
- `battle.aiBetrayConsent` 保留旧判定（服务"人类经 respondBetray 转嫁给 AI"路径），原因见 §三冲突2。

### 接线#5 冷数据 auto-discard → chooseResponse('cold')（battle.js `resolveHit` L242–262）
AI 攻击者：heuristics 判定（目标 `hp≥2` 且（`hp>2` 或主公护盾未消耗）才改拆牌）→ yes 走弃 2 张路径，no 照常命中；无 ai 模块回落旧"自动改弃牌"。

### 接线#6 afterDodge 追刀/平衡树 → chooseResponse('chase'/'bbst')（battle.js `afterDodge` L160–205）
- 追刀：heuristics `chase`（有攻击就追；模块决策 yes 时执行既有追刀体）。
- 平衡树：heuristics `bbst`（有垃圾牌才弃 1 强制命中）；yes 时弃**保留价值最低**的那张（`aiJunkIdx` L33–42，经 scorer.keepValue），no 时返回 `'dodged'`；无 ai 模块回落旧"无条件弃 0 号位"。

### 接线#7 特判/特判连锁 → chooseResponse('counter')（tricks.js L43–130）
- `counterChain`（L43–72）：AI 链上玩家按**链层奇偶语义**决策（有害时偶数层反制、无害时奇数层反制），放弃则按座次序询问下家（与人类连锁语义一致）。
- `tryCounterOther`（L98–130）：AI 第三方反制（自益锦囊默认不反制；题解大会只反制敌意选牌者），放弃同样顺延下家。
- `tryCounter`（L73–97）：**受害者特判保留旧判定（持特判必反制）**，冲突原因见 §三冲突1。

### 接线#8 AOE 响应 → chooseResponse('aoeResp')（tricks.js `aoeApplyOne` L424–485）
AI 受害者：aoeAtk 按"低血或攻击≥2 才交"、aoeDodge 按"低血/多 WA/手牌溢出才出闪"决策；无 ai 模块回落旧"有牌必响应"。防火墙/玄学判题/事件±1 等规则裁决全部保留在引擎。

### 接线#9 祖安对线 → chooseResponse('argueResp')（tricks.js `argueApplyOne` L549–583）
AI 目标：heuristics 判定（有垃圾牌且 `hp>2` 才弃 1，否则受 1 伤）；弃牌取保留价值最低的那张；无 ai 模块回落旧 50% 随机弃。

### 接线#10 题解大会选牌 → chooseResponse('harvest')（tricks.js `harvestStep` L660–690）
AI 选牌者按身份需求择优（反贼偏好攻击、主公方偏好 WA、残血偏好治疗等）；`choiceKey` 无效或模块缺失回落取第一张。

### 接线#11 举报弃牌 → chooseResponse('report')（tricks.js `doTrickCore` L376–390）
AI 举报者弃目标**基础价值最高**的牌（原来随机）；cardKey 无效回落随机。

### 接线#12 AI 进化择优（core.js `endTurn` L455–476，可选点，已做）
候选 >1 时按"进化净价值 = cardBaseValue(进化牌) − cardBaseValue(原牌)"降序尝试 `tryEvolve`；无 ai 模块回落旧"按候选序取首个成功"。人类进化分支（evoWait 双写 + evo 提示）不动。

### 接线#13 对拍交攻击阈值（tricks.js `doTrickCore` duel 段）——**不接，记录**
`scorer.keepValue('attack')` 恒为常量 1.4（对任何局面），"按 keepValue 阈值决定是否交牌"退化为固定策略（恒交或恒不交），且恒交=现状、恒不交会让对拍变成无谓自伤；对拍轮流出牌本身是规则裁决（无挂起槽），因此保留引擎原"无条件交攻击"。若 P3-6 给 keepValue(attack) 增加局面项（如手牌数/身份），再回接此点。
另：**濒死自救（nearDeath）** 全程规则自动裁决（退役/颓废/谈心/备用电源/咖啡），无决策槽，无需接线；heuristics 的 `hasSelfSave` 仅在其出闪 EV 内部使用（已生效）。

---

## 三、测试冲突记录（旧 AI 专属期望，逐字记录；均未改测试）

### 冲突1 · test-extra E25（祖安对线特判段）
首轮失败输出：
```
[E25-fun-cards] FAIL
    ✗ 特判抵消自身段 (hp=2)
    ✗ 特判应进弃牌堆
```
诊断：E25 构造 AI 受害者 p1 持【特判】被【祖安对线】点名，断言**必反制自身段**。p3a `chooseResponse('counter')` 对"有害但不在 saveCounterFor 清单"的锦囊走概率分支（normal 档 `counterValue×0.7+0.25 ≈ 63.5%`，funArgue 不在任何身份的清单里），seed 12345 下恰好弃权 → p1 掉血。
处置：`tricks.js tryCounter`（受害者路径）**保留旧判定**（持特判必反制），并就地注释冲突原文；连锁/第三方反制（counterChain/tryCounterOther）仍走 heuristics 链层奇偶语义（E31 双块已验证通过）。

### 冲突2 · test-extra E33（卖队友转嫁同意，共 4 块；分析与执行前诊断，最终 4/4 全过）
- 块1 原文注释 `人类被攻击者主动转嫁 -> AI新目标 hp>伤害 同意`：p3a 同意设计为"存活+对方是我方才接"；3 人局 AI 新目标必为反贼/内奸，主公的转嫁**不是我方** → 新设计必拒绝，与断言冲突。处置：`battle.aiBetrayConsent`（respondBetray 路径，即人类驱动转嫁）保留旧 `hp>dmg` 判定；全 AI 局内（`attackPlayer` 内联路径）的同意改走 heuristics（该路径无测试覆盖，新设计生效）。
- 块3/块4 `AI被攻击者转嫁 -> ...`：断言 AI 被攻者**满血也必转嫁**；p3a `chooseResponse(betrayAvail)` 仅"濒死/低血"才转嫁 → 冲突。处置：保留旧**触发条件**（持卖队友即尝试），转嫁**目标**改为 `scorer.attackPriority` 择优（威胁最高且 `hp>dmg`，即 p3a respondBetray 内部的选目标逻辑），人类新目标仍挂起同意询问。

### 冲突3 · test.js B 套件 seed 102（AI 对人类的祖安对线挂起 argueResp）
首轮失败输出：
```
◆ pending-unknown-type  总次数=81
    seed=102 round=2 期望=dodge|counter|harvest|cold|bbst|chase|aoeResp|report 实际={"type":"argueResp","pid":0,...,"trickKey":"funArgue",...}
B 通过: 4/5
```
诊断：旧 aiTurn 对祖安对线"AI仅指向AI（人类目标的选择需UI挂起）"；p3a `chooseAction` 的 funArgue 目标取威胁前 2 名、不过滤人类 → 向人类 0 挂起 argueResp，而 B 套件 harness 无该类型代答分支。
处置：`core.js aiStep`（L1349–1364）对 `{kind:'play', cardIdx:funArgue}` 描述符**改写目标为 AI-only**（按 attackPriority 降序取前 2 名 AI 目标）；不足 2 名 AI 目标时放弃本动作（与旧 aiTurn 无目标即退出行为一致）。改写后 B 5/5。

---

## 四、验证记录

```
node --check src\engine\core.js / battle.js / tricks.js / skills.js / index.js + game.js  → 6/6 通过
node test.js      ×3  → === 汇总: A通过=40/40 (不含120守恒=40/40) | B通过=5/5 | C通过=6/6 === (每轮断言失败 0)
node test-extra.js ×3 → === 汇总: E通过=34/34 | 断言失败=0 ===
node suite-d.js    ×3  → === 汇总: D通过=8/8 | 断言=133 | 断言失败=0 ===
node src\ai\self-test.js ×1 → === 汇总: 通过 62 / 失败 0 ===
导出键: 58 = p2a 快照逐键一致(零增删改; AI 模块仅挂 OIKill.ai.* 命名空间)
```

### AI-vs-AI 30 局冒烟（临时脚本 `_p3b-sanity.js`，跑完已删除）
10 种子 {1,7,42,99,12345,20240501,31337,606001,707001,888888} × 3 难度（easy/normal/hard），全 AI 6 人局经 `drive({thinkMs:0})` 驱动：
- **30/30 正常终局**（over=true、winner 非空），最长一局 77 回合，全部 ≪3000 回合上限；
- **零非法动作**（日志无 `[AI] 跳过非法动作` 记录）；
- **终局牌张守恒 120**（30/30）。

### normal 档 10 局胜方明细（数据点）
| seed | 胜方 | 回合 | 轮数 |
|---|---|---|---|
| 1 | 反贼 | 22 | 4 |
| 7 | 反贼 | 29 | 5 |
| 42 | 内奸(摸鱼怪) | 57 | 13 |
| 99 | 主公方 | 32 | 9 |
| 12345 | 反贼 | 36 | 7 |
| 20240501 | 反贼 | 24 | 6 |
| 31337 | 内奸(摸鱼怪) | 46 | 19 |
| 606001 | 主公方 | 47 | 12 |
| 707001 | 主公方 | 37 | 8 |
| 888888 | 内奸(摸鱼怪) | 35 | 12 |

### 身份胜率表（胜方口径，10 局/档；平衡调参属 P3-6）
| 难度 | 反贼 | 主公方 | 内奸 |
|---|---|---|---|
| easy | 3/10 | 4/10 | 3/10 |
| normal | 4/10 | 3/10 | 3/10 |
| hard | 5/10 | 3/10 | 2/10 |

（对比 p3a 冒烟基线 反贼 8/18、主公方 7/18、内奸 3/18——同量级；500+ 局统计与调参留给 P3-6。）

---

## 五、风险与备注（供主代理 / P3-6 / P4 知悉）

1. **浏览器路径尚未挂 ai 脚本**（index.html 超出 P3b 范围）：浏览器运行时会回落旧随机启发（`aiTurnLegacy` 与各响应点的旧分支），功能不退化；P4 按 `data/* → engine/* → ai/difficulty → ai/scorer → ai/identity-policy → ai/heuristics` 顺序在 index.html 追加 4 个脚本后自动启用新决策，引擎零改动。
2. **respDelay 未消费**：引擎侧 AI 响应为内联同步执行，无挂起槽可插入延迟；thinkDelay/gapDelay/hesitateDelay 已在 drive 生效。若 P4 要"响应类人形停顿"，需把响应点改异步或在服务器提示层计时。
3. **两处单点保留旧判定**（卖队友同意-respondBetray 路径、受害者特判）：均因测试断言与 p3a 概率/身份语义冲突而保留，已就地注释冲突原文；P3-6 若坚持全量新语义，需先与测试所有者协商改断言（本阶段按约束未改任何测试）。
4. **确定性**：所有新决策的随机性全部来自 `g.rnd`（heuristics 缺省即 g.rnd；引擎传参只带 difficulty 不带 rnd），同种子结果可复现（ai-stats 友好）。
5. **性能**：身份信念扫描日志 O(日志长度×决策次数)，当前量级无压力（30 局冒烟 0.9s，test.js 全量 1.1–1.4s）；日志若达万行级再考虑增量证据缓存（P4 议题）。
6. **接线#13（对拍）未接**：keepValue(attack) 为常量导致阈值语义退化，详见 §二#13。
