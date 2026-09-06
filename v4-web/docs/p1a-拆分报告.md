# P1a 模块拆分报告（game.js → src/data + src/engine）

> 执行代理：P1a（模块拆分）
> 范围：`v4-web/game.js`（2668 行单 IIFE）→ `src/data/*`(3) + `src/engine/*`(5) + 新聚合 `game.js`(35 行)；`index.html` 脚本标签替换。
> 结论：**零行为变更**，54 键导出逐键等价，全部验收通过。未触碰 `test.js` / `test-extra.js` / `src/net/net-api.js`（P1b 产物）与任何 docs 之外的既有文件。

---

## 一、目标结构与产物清单

| 文件 | 行数 | 字节 | 内容（导出键 = 该模块在 54 键聚合中的键数） |
|---|---|---|---|
| `src/data/cards.js` | 109 | 12,731 | CARDS / DECK_COUNT / EVO_MAP / isAttackKey / isDodgeKey（5） |
| `src/data/professions.js` | 62 | 5,417 | PROFESSIONS / SKILLS / DOMAINS（3） |
| `src/data/identities.js` | 33 | 2,054 | IDENTITIES / ID_TABLE / EVENTS / SUITS / suitZh / isBlack / isRed（聚合取 6，SUITS 不进聚合） |
| `src/engine/core.js` | 1291 | 73,665 | 回合/胜负/进化/入口 + 共享工具（25） |
| `src/engine/battle.js` | 369 | 21,206 | 战斗裁决/WA/濒死救援/响应（6） |
| `src/engine/tricks.js` | 637 | 37,341 | 特判/AOE/锦囊/欢乐牌/快排/放手一搏（7） |
| `src/engine/skills.js` | 187 | 11,698 | skillUse / unitAttack / aiSkill（2） |
| `src/engine/index.js` | 42 | 3,304 | 54 键合并聚合（Node 合并导出；浏览器挂到 `OIKill.engine.index`） |
| `game.js`（新聚合） | 35 | 2,612 | Node：`module.exports = require('./src/engine/index.js')`；浏览器：命名空间完整性断言后重新暴露 `window.OIKill` |

拆分后单文件最大 1291 行（core.js），符合 recon-01「单文件最大 ~620 行」的量级目标（core 含 playCard 全派发，略超估算属预期）。

## 二、导出键快照对比（BEFORE vs AFTER）

- **BEFORE**（拆分前 `node -e "Object.keys(require('./game.js'))..."` 快照，已存 `docs/p1a-keys-snapshot.txt`，54 键）：
  `CARDS,DECK_COUNT,DOMAINS,EVENTS,EVO_MAP,IDENTITIES,ID_TABLE,PROFESSIONS,SKILLS,aiTurn,attackPlayer,checkVictory,createGame,deployUnit,discardCards,discardFun,discardPhase,draw,drawPhase,effectiveCost,endTurn,equipCard,evolvePick,fangAttack,isAttackKey,isBlack,isDodgeKey,isRed,judgePhase,kspAttack,lordCanRedraw,lordRedraw,loseHp,nextAlive,playCard,playerLeave,publicView,respondAoeResp,respondBbst,respondBetray,respondChase,respondCold,respondCounter,respondDodge,respondGuard,respondHarvest,respondReport,setup,skillUse,spec,startTurn,suitZh,tryEvolve,unitAttack`
- **AFTER**：与 BEFORE **完全一致（diff 为空）**，`=== PARITY-OK`。
- 键位分布：cards 5 + professions 3 + identities 6（SUITS 除外）+ core 25 + battle 6 + tricks 7 + skills 2 = **54**。
- 说明：`SUITS` 在旧 game.js 中本就**不是**导出键（仅内部使用）；拆分后仍只在 `OIKill.data.identities` 命名空间内供 `buildDeck` 使用，聚合按旧 api 逐键排除它 —— 故各模块模块级导出合计 55，聚合恰好 54。

## 三、拆分机制（遵循 recon-01 / recon-02 §A）

- 每个文件沿用旧 game.js 的双端 IIFE 骨架：`(function (root) { 'use strict'; ... })(typeof window !== 'undefined' ? window : globalThis);`，内部 `const NS = root.OIKill = root.OIKill || {};` 建立共享命名空间（Node 下即 globalThis.OIKill）。
- Node：每个文件 `module.exports` 自己的键；浏览器：`Object.assign(me, api)` 挂到对应嵌套槽（`OIKill.data.cards` / `OIKill.engine.core` 等）。
- **跨模块调用全部改为调用期运行时引用**（`NS.engine.core.loseHp(...)`、`NS.engine.battle.nearDeath(...)`、`NS.engine.tricks.tryCounter(...)`、`NS.data.cards.isAttackKey(...)` 等），消除 engine↔battle↔tricks↔skills 的加载期循环依赖；同模块内调用保持原闭包引用不变。核心链 `playCard → attackPlayer → resolveDodge → afterDodge → attackPlayer`、`loseHp → nearDeath → kill → checkVictory`、`aiTurn → fangAttack → resumeMultiAttack → attackPlayer` 均在运行期经 NS 正确闭合。
- 各引擎模块除 54 键子集外，还向命名空间暴露内部工具（judgeCard/discardFromHand/queueEvo/onBecomeTarget/unequipArmor/unitDie/aoeOrder 等），供跨模块调用；聚合入口只挑选旧 api 的 54 键，命名空间上的额外键不影响导出面。
- `src/engine/index.js`：Node 下先按序 `require` 全部子模块（它们自注册进共享命名空间），再按**旧 api 对象逐键同序**合并为 54 键对象；浏览器下直接从命名空间合并并挂到 `OIKill.engine.index`。
- 新 `game.js` 浏览器分支：断言 8 个子模块命名空间与 54 键完整性（缺失即抛错），然后把扁平 54 键 api 重新赋给 `root.OIKill` —— 与拆分前的 `window.OIKill` 形态完全一致，`index.html` 的 `const O = window.OIKill` 零改动。

## 四、index.html 脚本加载顺序（验收 5 证据）

第 197–205 行（替换原单行 `<script src="game.js">`），保持 file:// 直接可玩：

```html
<script src="src/data/cards.js"></script>
<script src="src/data/professions.js"></script>
<script src="src/data/identities.js"></script>
<script src="src/engine/core.js"></script>
<script src="src/engine/battle.js"></script>
<script src="src/engine/tricks.js"></script>
<script src="src/engine/skills.js"></script>
<script src="src/engine/index.js"></script>
<script src="game.js"></script>
```

内联脚本（第 207 行起）未做任何改动；`const O = window.OIKill`（第 207 行）继续可用。

## 五、验收结果汇总

| # | 验收项 | 结果 |
|---|---|---|
| 1 | `node --check` 全部新文件 + game.js | ✅ 9/9 通过（cards/professions/identities/core/battle/tricks/skills/index/game） |
| 2 | 54 键奇偶校验（BEFORE=docs/p1a-keys-snapshot.txt vs AFTER） | ✅ PARITY-OK，两侧各 54 键、排序后逐字节一致 |
| 3a | `node test.js` | ✅ **A 40/40、B 5/5、C 6/6**（连跑 2 轮稳定） |
| 3b | `node test-extra.js` | ✅ **E 34/34、断言失败 0** |
| 4 | 浏览器路径冒烟 | ✅ 用 `new Function('window','module',code)` 模拟浏览器全局，按 index.html 顺序 eval 9 个文件后，`root.OIKill` 为扁平 54 键 api，与快照一致；**index.html 期望的全局名 = `window.OIKill`**（第 207 行 `const O = window.OIKill`），冒烟中确认已完整填充 |
| 5 | index.html 新脚本标签列表 | ✅ 见第四节 grep 证据（9 个标签、顺序正确） |

约束核对：
- **DECK_COUNT = 120** 未动（cards.js 原样搬运；test.js 头部「规格牌堆=120张; DECK_COUNT 实际求和=120张」确认）。
- 未触碰 `test.js` / `test-extra.js`（二者 `require('./game.js')` 零修改即绿）。
- fixlog-1a/1b/1c 修复标记全部保留：`judgeCard` 的 `g.deck.unshift(c)`（core.js L398）、`counterChain`（tricks.js L28）、`unitDie` 克隆体守卫 `unitObj.id !== -1`（core.js L1297）、`case 'duel': case 'duelEvo'`（core.js L881 / tricks.js L349）、`case 'killUnit': case 'killUnitEvo'`（core.js L914）、划水怪·随缘 `bi2` 重查（core.js L276）等。

## 六、拆分中的放置决策（与任务书清单的差异点，均已按"follow the code"处理）

1. `isBlack / isRed`：任务书未指定归属；按原始代码位置（紧邻 SUITS/suitZh 定义）放入 `src/data/identities.js`。
2. `SUITS`：任务书列于 identities.js；确认旧 api **不导出** SUITS，故仅存在于模块导出与命名空间，不进 54 键聚合。
3. `playCard / equipCard / deployUnit / canPlay / pendingView`：任务书清单未点名；按代码归属放入 core.js（playCard 是锦囊/战斗/技能的派发枢纽，跨模块经 NS 调用 tricks/battle）。
4. `aiSkill`：跟随 `skillUse` 放入 skills.js（core.aiTurn 经 `NS.engine.skills.aiSkill` 调用）；`aiTurn`/`pickTarget` 按任务书留在 core.js，功能未变（后续 P3 再迁 src/ai）。
5. `aoeOrder`：任务书同时出现在 core 与 tricks 清单；按 core 的显式清单放入 core.js（调用点仅在 playCard）。
6. `COUNTERABLE`：原样保留在 tricks.js（旧代码中即为定义未引用，保持零变更）。

## 七、风险与备注（供主代理/P1b 知悉）

1. **Node 下的共享命名空间**：为满足「跨模块调用走调用期 NS 引用」，各模块在 Node 下除 `module.exports` 外也会把自身注册到 `globalThis.OIKill`（嵌套槽 `OIKill.data.* / OIKill.engine.*`）。这是纯新增的进程内注册表，不参与 54 键聚合，对 test.js 等调用方无可见影响。
2. **P1b 的 `src/net/net-api.js` 共存在线**：该文件在浏览器分支是 `Object.assign(NS, api)` 扁平挂载到 OIKill 顶层；若未来把它加入 index.html 且放在 `game.js` **之前**加载，会被 game.js 的 `root.OIKill = api` 重赋值覆盖掉其扁平键。P1b 接线 index.html 时建议改为挂到 `OIKill.net` 子槽并在 game.js 之后加载（或由 P1b 决定合并策略）。本次未改动该文件。
3. 浏览器分支的完整性断言依赖 9 个脚本按第四节顺序加载；顺序打乱会抛「OI杀引擎加载不完整」错误而非静默错乱，便于排查。

## 八、最终结果行

```
node --check: 9/9 通过
54 键奇偶校验: PARITY-OK (BEFORE 54 = AFTER 54, diff 为空)
node test.js      : === 汇总: A通过=40/40 (不含120守恒=40/40) | B通过=5/5 | C通过=6/6 | 耗时=0.1s ===
node test-extra.js: === 汇总: E通过=34/34 | 断言失败=0 ===
浏览器冒烟: window.OIKill 54 键与快照一致 (BROWSER-SMOKE-OK)
index.html: 9 个脚本标签按序加载, 内联脚本零改动
DECK_COUNT=120 守恒不变; test.js / test-extra.js 未改动
```
