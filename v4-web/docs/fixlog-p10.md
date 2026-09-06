# P10 引擎微修复报告：终局过渡态清扫 + 提示残留清零（OI杀 v4）

> 执行代理：Fix-P10（引擎微修复）
> 范围：仅修改 `src/engine/core.js` 与 `src/engine/tricks.js`（共 72 行新增/1 行调整）。未触碰 `src/ai/*`、index.html、tests、server、build、data；`game.js` 无需改导出，未动。
> 性质：纯 bug 修复，无任何规则/平衡语义变更——所有压测胜率表与修复前逐项一致（见 §五）。
> 对应问题：p10a-AI平衡报告 §八.5 / §十一 的两个引擎层缺陷：
> (a) 1 人类口径终局提示残留（每 200 局 4–10 次）；
> (b) easy seed 161 的 1 张牌停在结算过渡态（唯一真守恒异常，1/600 局）。

---

## 一、结论速览

1. **两个 bug 均已修复并验证**：终局牌张守恒 120 在全部压测口径（1 人类 / 全 AI × 三难度，共 1101 局）为 **0 失败**；终局提示残留全部为 **0**（修复前 1 人类口径每 200 局 4–10 次）。
2. **修复对玩法零影响**：`100 normal` before/after 同种子对比，胜方阵营、平均回合、平均轮数**完全相同**（89/8/3，10.7 回合，47.1 轮），仅残留 2→0；easy/normal/hard 各 200 局胜率表与 p10a 报告 §5.2 **逐项一致**。
3. **回归全绿**：`node --check` 两文件通过；test.js A 40/40 + B 5/5 + C 6/6；test-extra E 34/34；suite-d D 8/8（148 断言）；self-test 62/62；附赠 room-test 73/73。

---

## 二、Bug (b) 根因（文件+行号）

### 2.1 病灶：自益锦囊牌在"特判连锁询问挂起"期间离手未入堆

`src/engine/core.js` `playCard` 的自益锦囊分支（draw2/funLie、peek、mull、cheat、recover、funGiveup、funClone，行 1001–1029 与 1163–1209）：

```js
// core.js: 行 952 牌已离手
p.hand.splice(cardIdx, 1);
// core.js: 行 1002-1005（以 draw2 为例）
spend(g, p, cost);
const cr = nsEngine.tricks.tryCounterOther(g, pid, c.key, { kind: 'self', ctx: { srcId: pid, trickKey: c.key, card: c } });
if (cr === 'pending') return { ok: true, result: 'pending' }; // ← 直接返回: 牌 c 既不在手、也不在弃牌堆
```

此时 `c` 的**唯一持有者**是提示条目：`src/engine/tricks.js` 行 106 为人类挂起的特判连锁询问：

```js
nsEngine.core.setPrompt(g, { type: 'counter', pid: q.id, ..., ctx: { type: 'counterChain', trickKey, srcId: casterId, depth: 0, cont } });
// ctx.cont = { kind:'self', ctx:{ srcId, trickKey, card: c } }  ← 在途牌藏在这里
```

若对局在提示挂起期间经 `forceEndByCount`（保底终局）结束，原 `end()` 不清提示也不动 ctx，牌便永久停在结算过渡态 → 终局只有 119 张。

### 2.2 seed 161 全链路复现（1 人类口径，逐牌 id 审计）

- 乙（pid2）出【摸鱼】（draw2）→ 人类主公（pid0）收到特判连锁询问（counterChain，cont.kind='self'）→ 乙为【划水怪】，回合收尾技能【终极摸鱼】摸 2 → 牌堆耗尽触发**第 2 次洗牌** → `forceEndByCount`【保底终局】内奸获胜。
- 审计结果（修复前）：真实牌 119 张、0 重复，**缺失 id=47**——正是那张 draw2，藏在挂起提示 `ctx.cont.ctx.card` 中；同时 `prompts.size=1`（残留）。
- 全 AI 口径 0 发生的原因：无人类座位 → tryCounterOther 永不挂起 → 牌始终由同步结算收进弃牌堆。

### 2.3 排查中一并发现的三个次生风险（同类过渡态，均已在本次封堵）

1. **残留重入**：终局后结算续跑（如 AOE 续算再询问人类目标）会再次 `setPrompt`，即使 `end()` 清了提示也会被重新污染；
2. **重复弃置/空数组崩溃**：终局清扫后 `harvestStep` 续跑会对已清空的 `ctx.cards` 执行 `shift()` 取回 `undefined` 推入手牌（崩溃），或对已清扫的牌再次弃置（121 张）；
3. **漏扫丢牌**：`respondCounter` 入口已 `takePrompt` 取走提示后，若中途 counterEvo 摸牌触发终局，`ctx` 仅存调用栈，`end()` 的清扫看不到它 → 牌无人兜底（永久丢失）。

---

## 三、修复实现

### 3.1 `src/engine/core.js`

| 位置 | 改动 |
|---|---|
| `setPrompt`（行 127 起） | 新增终局闸：`g.over` 时不注册提示、返回形如条目的哑对象并更新 `_lastPrompt`（兼容结算代码读 `lastPrompt` 补 ctx 的旧写法）→ 封堵残留重入 |
| `groupOpen`（行 183 起） | 新增终局闸：`g.over` 时 `return null`，不注册提示组 |
| `sweepTransientCards(g)`（行 690–727，新增） | 终局清扫：以 WeakSet 按数组/牌对象去重；`harvest` ctx 的 `cards` 数组整组归还弃牌堆并**清空数组**；`counterChain` ctx 的 `cont.kind==='self'` 单牌（`cont.ctx.card`）归还弃牌堆。全部带 `id !== -1` 守恒守卫，常规区域（牌堆/弃牌堆/手牌/装备/单位/判定区）一律不触碰，不创建/销毁任何牌。report 提示的 cards 为视图克隆（无 type 字段），不在清扫之列 |
| `end()`（行 729 起） | 先 `sweepTransientCards(g)`（过渡态牌先入堆、快照=120），随后清空 `g.prompts` 与 `g._promptGroups`（修复 (a)）。所有终局路径（checkVictory/forceEndByCount）都经 `end()`，全覆盖 |

### 3.2 `src/engine/tricks.js`（终局后结算续跑守卫）

| 位置 | 改动 |
|---|---|
| `counterChain`（行 44） | `g.over` 时 `return false`：停止连锁；自益锦囊在途牌改由 `runCounterCont` 终局分支结算（防丢牌/重弃） |
| `tryCounter`（行 75） | `g.over` 时 `return false`：不再发起特判 |
| `tryCounterOther`（行 101） | `g.over` 时 `return 'proceed'`：自益牌由调用方正常结算入堆（恰好弃一次） |
| `runCounterCont`（行 150 起） | 终局分支：`cont.kind==='self'` 的在途牌若未被 `end()` 清扫（提示已被 `takePrompt` 取走、ctx 仅存调用栈），此处**补弃一张**并清引用——覆盖 §2.3 风险 3；题解大会展示牌已由 `end()` 清扫，不再触碰（防重弃） |
| `harvestStep`（行 674） | while 条件加 `!g.over`：终局停止选牌，直走收尾清空（此时 `ctx.cards` 已被清扫清空，收尾循环为空操作）→ 封堵 shift 空数组崩溃 |

---

## 四、回归结果（全部通过）

```
node --check src\engine\core.js / src\engine\tricks.js   → 通过
node test.js               → === 汇总: A通过=40/40 | B通过=5/5 | C通过=6/6 ===
node test-extra.js         → === 汇总: E通过=34/34 | 断言失败=0 ===
node suite-d.js            → === 汇总: D通过=8/8 | 断言=148 | 断言失败=0 ===
node src\ai\self-test.js   → === 汇总: 通过 62 / 失败 0 ===
node src\net\room-test.js  → room-test 汇总: 通过 73/73  失败 0（附赠验证房间层终局守恒）
```

未改动任何测试断言；p3b 记录的三个旧 AI 兼容偏差路径（E25/E33/B102）未被触发。

---

## 五、压测终验（守恒失败 / 提示残留 / 胜率表）

### 5.1 修复后（本报告口径：`test/ai-stats.mjs`，零崩溃、零非法动作、零 cap）

| 口径 | 难度 | 局数（种子） | 反贼 | 主公方 | 内奸 | 平均回合 | 平均轮数 | 守恒失败 | 终局提示残留 |
|---|---|---|---|---|---|---|---|---|---|
| 1人类+5AI | easy | 200 (1..200) | 58.5% (117) | 17.0% (34) | 24.5% (49) | 15.3 | 60.8 | **0** | **0** |
| 1人类+5AI | easy | 200 (501..700) | 57.0% (114) | 20.0% (40) | 23.0% (46) | 14.8 | 58.9 | **0** | **0** |
| 1人类+5AI | normal | 200 (1..200) | 80.5% (161) | 9.5% (19) | 10.0% (20) | 11.1 | 47.9 | **0** | **0** |
| 1人类+5AI | hard | 200 (1..200) | 79.0% (158) | 5.0% (10) | 16.0% (32) | 10.6 | 44.5 | **0** | **0** |
| 全AI | easy | 200 (1..200) | 24.5% (49) | 52.0% (104) | 23.5% (47) | 14.3 | 51.5 | **0** | **0** |
| 1人类+5AI | easy | 1 (seed 161) | — | — | 内奸胜 | 18.0 | 67.0 | **0** | **0** |

### 5.2 与修复前（p10a §5.2 / §十一）对照

| 难度 | 修复前 | 修复后 |
|---|---|---|
| easy 200 | 58.5/17.0/24.5，守恒失败 **1**（seed 161），残留 **6** | 58.5/17.0/24.5，守恒 **0**，残留 **0** |
| normal 200 | 80.5/9.5/10.0，守恒 0，残留 **4** | 80.5/9.5/10.0，守恒 0，残留 **0** |
| hard 200 | 79.0/5.0/16.0，守恒 0，残留 **10** | 79.0/5.0/16.0，守恒 0，残留 **0** |

胜方阵营占比、平均回合/轮数在修复前后**逐项一致**（同种子确定性复现），证明修复只动了终局收尾，未改任何对局进程。seed 161 单局：修复前 守恒119/残留1 → 修复后 守恒120/残留0，胜方（内奸）、18 回合、67 轮不变。

### 5.3 p10a 平衡数据 before/after（`node test\ai-stats.mjs 100 normal`，1 人类口径，种子 1..100）

| | 反贼 | 主公方 | 内奸 | 平均回合 | 平均轮数 | 守恒失败 | 提示残留 |
|---|---|---|---|---|---|---|---|
| **before**（HEAD 引擎 + p10a 调参 AI） | 89 (89.0%) | 8 (8.0%) | 3 (3.0%) | 10.7 | 47.1 | 0 | **2** |
| **after**（本修复引擎 + 同 AI） | 89 (89.0%) | 8 (8.0%) | 3 (3.0%) | 10.7 | 47.1 | 0 | **0** |

游戏进程**完全一致**（同一批种子、同一胜者、同回合数），仅终局提示残留 2→0。p10a 平衡结论不受影响。

---

## 六、交付物清单

| 文件 | 说明 |
|---|---|
| `src/engine/core.js`（改） | setPrompt/groupOpen 终局闸；新增 `sweepTransientCards`；`end()` 先清扫过渡态牌再清空 prompts/_promptGroups |
| `src/engine/tricks.js`（改） | counterChain/tryCounter/tryCounterOther/runCounterCont/harvestStep 五个终局守卫（防丢牌/重弃/空数组崩溃） |
| `docs/fixlog-p10.md`（本报告） | — |

未改动：`src/ai/*`、index.html、tests、server、build、data、game.js。

（完）
