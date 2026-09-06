# P1 验收报告（Gate 验证）

> 验证者：P1 gate verifier（独立验证）
> 范围：v4-web P1 模块拆分（src/data + src/engine 九模块 + 聚合入口 game.js）
> 结论：**全部 6 项验收通过，里程碑已提交，未 push**。
> 提交：`7c4e8aaa8c336063092311db0e2e56e12ee9b791`

---

## 1. 语法检查：`node --check` ✅ 12/12 通过

| 文件 | 结果 |
|---|---|
| game.js | PASS |
| src\data\cards.js | PASS |
| src\data\professions.js | PASS |
| src\data\identities.js | PASS |
| src\engine\core.js | PASS |
| src\engine\battle.js | PASS |
| src\engine\tricks.js | PASS |
| src\engine\skills.js | PASS |
| src\engine\index.js | PASS |
| src\net\net-api.js | PASS |
| test.js | PASS |
| test-extra.js | PASS |

输出：`ALL 12 FILES: node --check PASS`，无任何失败。

## 2. 54 键奇偶校验 ✅ PARITY-OK

- 实际导出：`Object.keys(require('./game.js')).sort().join(',')` → **54 键**
- 快照：`docs\p1a-keys-snapshot.txt` → **54 键**
- 排序后逐字节比对：**diff 为空**（两侧字符串完全一致）

## 3. 测试 ✅ 全绿

`node test.js` 连续 3 轮：

```
=== 汇总: A通过=40/40 (不含120守恒=40/40) | B通过=5/5 | C通过=6/6 | 耗时=0.1s ===   (×3)
```

`node test-extra.js` 连续 3 轮：

```
=== 汇总: E通过=34/34 | 断言失败=0 ===   (×3)
```

## 4. 浏览器加载顺序冒烟 ✅ BROWSER-SMOKE-OK

按 index.html 第 197–205 行的 9 个 `<script>` 标签顺序，用临时脚本（`new Function('window','self','globalThis','module','require', code)`，共享 `window={}`、`module=undefined` 走浏览器分支）依次 eval 9 个文件后：

- `window.OIKill` 为**扁平对象**（无 data/engine 嵌套槽），**恰好 54 键**，排序后与快照逐字节一致；
- 抽验：createGame/playCard/unitAttack/isBlack 为函数；suitZh 为花色映射对象 `{spade:'♠',club:'♣',heart:'♥',diamond:'♦'}`（注意：suitZh 本身是对象而非函数，符合预期）。
- 临时脚本 `_p1-gate-smoke.js` 用后已删除，无残留。

## 5. grep 检查 ✅

- `game.js` L14 含 `module.exports = require('./src/engine/index.js')` ✅
- `index.html` L197–205 恰好 9 个有序 script 标签：cards → professions → identities → core → battle → tricks → skills → index → game.js，顺序与拆分报告第四节一致 ✅
- `src\net\net-api.js`：`node --check` 通过，独立 `require` 成功（返回对象，4 个导出键），仍可独立解析 ✅

## 6. 里程碑提交 ✅

- 命令：`git add -A`（仓库根 `D:\projects\oi-kill`）→ `git commit`
- 提交哈希：**`7c4e8aaa8c336063092311db0e2e56e12ee9b791`**
- 提交信息：`refactor(v4): P1 模块拆分——src/data+src/engine 九模块+聚合入口，54键等价，含net-api协议面`
- 统计：26 files changed, 6653 insertions(+), 2161 deletions(-)
- **未 push**（按指令）。

## 备注（供主代理知悉）

1. 提交范围除 P1 拆分产物（src 九模块、game.js、index.html 脚本标签、快照与两份报告）外，按 `git add -A` 一并纳入了工作区中其它代理的既有产物：fixlog-1a/1b/1c/2/3a/3b/3c.md、_verify-3c-runs.txt、net-protocol.md、p1b-协议面报告.md、test-extra.js，以及 requirement.txt、test.js、index.html（timer-ring/toast/日志命名映射等 UI 增强）的既有改动。
2. P1a 拆分报告声称"未触碰 test.js"，git 显示 test.js 相对基线有 14 行改动（fixlog-3a 相关：手牌上限容忍 +5→+6、弃牌后容忍 +2→+3、`Math.random()`→`g.rnd()` 播种）。这与 P1a 拆分无关，且当前 test.js 三轮全绿，不影响验收结论。
3. 冒烟脚本（`_p1-gate-smoke.js`）已删除；除本报告文件（提交后新增、未纳入提交）外工作区干净。
