# fixlog-3c · 测试套件 B（人类流程模拟）确定性修复

## 结论

套件 B（`runHuman`, human=0, seeds 101..105）的目标选择原由 `Math.random()` 驱动，导致每次运行轨迹不同、间歇性引擎崩溃（~11%）无法复现。现将随机源切换为引擎自身的种子化 RNG（`g.rnd`），**10 次连续运行轨迹逐字节一致**，且 A 40/40、B 5/5、C 6/6 全部通过、无崩溃。

## 变更清单（仅 test.js，2 行）

| 位置 | 原代码 | 新代码 |
| --- | --- | --- |
| test.js L252（攻击目标选择） | `enemies[Math.floor(Math.random() * enemies.length)]` | `enemies[Math.floor(g.rnd() * enemies.length)]` |
| test.js L284（锦囊目标选择） | `enemies[Math.floor(Math.random() * enemies.length)].id` | `enemies[Math.floor(g.rnd() * enemies.length)].id` |

未改动任何断言、game.js、index.html、test-extra.js。选择逻辑本身（存活敌人中均匀取索引）语义不变，仅更换随机源。

## 确定性实现原理（引擎 RNG 机制引用）

- game.js L10-L16 定义私有 `makeRng(seed)`：标准数值配方 LCG —— `s = (s * 1664525 + 1013904223) >>> 0`，返回 `s / 4294967296`（[0,1) 浮点）。
- game.js L202 `createGame`：`const rnd = makeRng(opts.seed || Date.now())`，按传入 seed 构造这条确定流。
- game.js L203-L204：游戏对象字面量以简写属性暴露该函数 —— **`g.rnd` 即引擎的种子化 RNG，可直接访问**（任务书中称 `g.rng`，引擎实际字段名为 `g.rnd`，已核对）。
- 引擎内所有随机点均取自 `g.rnd`：洗身份（L228）、洗职业（L233）、洗牌堆（L235）、AI 选目标（L2068/L2079/L2113-L2121/L2145 等）。test.js 的两次抽签插入同一条确定性流后，每个 B seed（101..105）的全局抽签序列固定，因此整局轨迹（洗牌、AI 决策、人类行动）逐回合相同；跨进程运行无任何非确定源（其余 `Date.now` 仅用于计时输出）。

## 10 次连续运行验证（node test.js，Node v24.18.1）

- 方式：`node test.js` 连跑 10 次，输出落盘 `docs/_verify-3c-runs.txt`（原样保留备查）。
- 结果：10/10 次均为 **A 40/40（含 120 守恒）、B 5/5、C 6/6**，无 CRASH、无断言失败。
- 确定性证明：每次运行的 A/B/C 输出行拼接后计算 SHA256，前缀均为 `43BA1AF86C9A2110`（unique-hashes=1），即 10 次输出逐字节一致。

B 套件各 seed 固定轨迹（10 次完全一致）：

| seed | over | winner | turns | round | 人类行动数 | 断言 |
| --- | --- | --- | --- | --- | --- | --- |
| 101 | true | 内奸(摸鱼怪) | 25 | 7 | 12 | 全部通过 |
| 102 | true | 反贼 | 62 | 16 | 25 | 全部通过 |
| 103 | true | 反贼 | 72 | 14 | 25 | 全部通过 |
| 104 | true | 反贼 | 13 | 3 | 5 | 全部通过 |
| 105 | true | 内奸(摸鱼怪) | 40 | 9 | 17 | 全部通过 |

## 对间歇性崩溃复现的意义

修复前 B 的轨迹每次随机漂移，崩溃只按 ~11% 概率踩中。修复后每个 seed 轨迹唯一确定：若引擎存在轨迹相关缺陷，将在对应 seed 上 100% 复现或 0% 出现，可直接据此定位（本次 10 连跑未触发该崩溃，说明当前 5 个固定轨迹均不踩中缺陷路径；如需捕获，可在 B 中增跑更多 seed，但不在本任务范围内）。
