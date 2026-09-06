# Fix-2 修复报告（v4-web/index.html，仅 UI）

- 修复对象：`v4-web/index.html`（内联 CSS+JS，1013 行 → 1118 行）
- 遵守约束：未触碰 `game.js` / `test.js`；guard 分支保持原样；文件仍为独立 HTML（file:// 可玩）；主题/缩放/双命名/技能/欢乐牌/图鉴/教学/成就/计时器全部保留。
- 引擎契约按给定事实处理：`O.respondHarvest({choiceKey})`、`view.pending.srcId/dmg` 防御式取用。

---

## 1. 【H】题解大会（harvest）死锁修复 —— 最高优先级

**改动（行号为新文件行号）**

| 位置 | 行 | 内容 |
|---|---|---|
| 弹窗分派 | 682 | `renderPendingPrompt` 增加 `else if (pd.type === 'harvest') renderHarvestPrompt(v, count);` |
| 选牌弹窗与响应器（新增块） | 719–757 | `harvestChoices(pd)`（兼容 `pd.ctx.cards` / `pd.choices`）、`harvestRespond(pd, choiceKey)`、`harvestFirstKey(pd)`、`renderHarvestPrompt(v, count)`、`harvestPick(choiceKey)` |
| 10s 超时/ESC 默认路径 | 850 | `respondNo` 增加 `else if (pd.type === 'harvest') harvestRespond(pd, harvestFirstKey(pd));` —— 超时自动选第 1 张（无牌可选时传 `null` 跳过，不会卡死 pending） |
| AI 响应 | 917 | `aiRespondPending` 增加 harvest 分支，AI 选第 1 张 |
| 自动托管 | 934 | `autoLoop` 增加 harvest 分支，人类自动选第 1 张 |

**关键实现细节**

- 按钮点击调用 `harvestPick(key)` → `harvestRespond(pd, key)`。为兼容并行修复的契约签名与当前旧签名，`harvestRespond` 用参数个数判别：`O.respondHarvest.length >= 3` 走旧签名 `(g, victim, choiceKey)`，否则按契约走 `O.respondHarvest({ choiceKey })`。
- 弹窗内提供「⏭ 跳过(不选)」按钮（`harvestPick(null)`），并注明“超时自动选第1张”。
- 选牌按钮同时带 `name-zh` / `name-plain` 双名 span，随命名切换。

**验证（grep 证据）**

- 分派：`index.html:682` `else if (pd.type === 'harvest') renderHarvestPrompt(v, count);` ✓
- 超时路径：`index.html:850` `else if (pd.type === 'harvest') harvestRespond(pd, harvestFirstKey(pd)); // H: 超时默认选第1张` ✓
- AI/自动循环：`index.html:917`（aiRespondPending）、`index.html:934`（autoLoop）✓
- 共 13 处 `harvest` 命中，四要素齐全。

---

## 2. 【M1】弹窗信息：使用 `view.pending.srcId/dmg`

- 特判（counter）弹窗：行 800–802。`const src = pd.srcId !== undefined ? pd.srcId : (pd.attacker != null ? pd.attacker : '?');`，经 `playerName()`（`g.players[pid].name`）查名，不再显示 “?”。
- AOE 弹窗：行 685–698。`const src = pd.srcId !== undefined ? pd.srcId : '?'`、`const dmg = pd.dmg !== undefined ? pd.dmg : '?'`；正文“伤害${dmg}”与按钮“不出,受${dmg}伤”均用真实伤害，不再出现 “伤害undefined”。
- 攻击弹窗（dodge）：行 772。`伤害${pd.dmg !== undefined ? pd.dmg : 1}` —— 引擎透出 dmg 后显示真实伤害（咖啡+1、attackEvo 2 伤等），旧引擎无该字段时回退 1。
- guard 分支（行 823）按要求保持原样未动。

**验证**：grep `srcId|pd\.dmg` → 行 689–691、772、800–801 命中（823 为 guard 原文，未改）✓

---

## 3. 【M2】举报（report）超时默认动作

- 行 849：`respondNo` 增加 `else if (pd.type === 'report') { if (O.respondReport) O.respondReport(g, HUMAN, null); }`。
- 形状镜像文件内既有调用点（行 714 `O.respondReport(g, HUMAN, cardKey)`、行 916/933 AI 分支）；`null` 即“放弃举报/不弃牌”的安全默认，10s 超时与 ESC 均生效。

**验证**：grep 行 849 命中 ✓

---

## 4. 【L】神犇黑牌当攻击的目标模式条件收紧

- 行 477–479：条件从 `!O.isAttackKey(c.key)` 收紧为与引擎 `playCard` 碾压分支（game.js:1260）对齐：
  `!O.isAttackKey(c.key) && !O.isDodgeKey(c.key) && c.key !== 'counter' && c.key !== 'counterEvo'`
- 效果：黑色 WA/特判/反制不再进入选目标模式，避免“白选目标后被引擎拒绝”的挫败体验。

**验证**：grep `isDodgeKey` → 行 479 命中 ✓

---

## 5. 【L】图鉴标题改为诚实计数

- 行 1013：新增 `let totalKinds = 0;`
- 行 1020：分组循环内 `totalKinds += cards.length;`
- 行 1025：标题改为 `` `🃏 卡牌图鉴 · 牌库120张 · ${totalKinds}种牌型(含进化牌)` ``（实际 61 + 8 = 68 种牌型，动态计算，永不撒谎）。

**验证**：grep `totalKinds|牌库120张` → 行 1013、1020、1025 命中 ✓

---

## 6. 【L】黑话/通俗命名切换作用于战斗日志

- 行 259：`logToHtml` 中 `const txt = mapLogNames(String(l.txt).replace(...))`。
- 行 283–301：新增 `cardNamePairs()`（O.CARDS 的 name→plain 映射，按名称长度降序替换，避免子串截断；带缓存）与 `mapLogNames(txt)`（`body.plain-mode` 生效时替换）。
- 行 242–247：命名切换监听器末尾新增 `if (g) render();`，切换后立即重绘日志（卡面双名走原 CSS 机制，不冲突）。

**验证**：grep `mapLogNames` → 行 259、296 命中 ✓

---

## 7. 【L】弃牌确认检查 `O.discardCards` 返回值

- 行 612–617：`const r = O.discardCards ? O.discardCards(g, HUMAN, [...discardSel]) : { ok:false, why:'引擎不支持自选弃牌' };`，`r.ok === false` 时 `toast(r.why || '弃牌失败,请重新选择'); return;` —— 保留选择、不清除，用户可重选。
- 新增轻量 toast：CSS 行 135–137（`.toast`）、元素行 196（`<div class="toast" id="toast"></div>`）、JS 行 274–282（`toast()`，2.6s 自动消失，无元素时回退 openModal）。

**验证**：grep `discardCards` 行 614–615、`toast(` 行 615 命中 ✓

---

## 8. 【L】45s/10s 环形倒计时

- CSS 行 129–134：`.timer-ring` 用 `conic-gradient(var(--ring-color) calc(var(--ring-frac,0)*1%), var(--panel3) 0)` 画环，内圈 `::after` 挖孔；`.timer-ring.low` 触发 `ringPulse` 缩放脉动动画。颜色走主题变量（--orange/--red/--panel）。
- HTML 行 164：行动栏 phase-info 旁插入 `<span class="timer-ring" id="timer-ring" style="display:none"><span class="tt"></span></span>`（原文本计时保留，作为补充）。
- JS 行 961–984：`updateTimerDisplay` 计算剩余比例写入 `--ring-frac`，`left <= 10` 时 `--ring-color` 变红并加 `low` 类脉动，环心显示剩余秒数；无计时器时隐藏圆环。
- 行 985–996：定时器超时后立即 `updateTimerDisplay()` 清空文本与圆环。

**验证**：grep `timer-ring` → 行 130–133（CSS）、164（HTML）、963（JS）命中 ✓

---

## 综合验证

- 语法：提取内联 `<script>` 至 `%TEMP%\fix2-check.js`（47003 字节，UTF-8 无 BOM），`node --check` 通过。
- 未运行 test.js（引擎并行修改中）；未修改 game.js / test.js。
- 所有 8 项修复的 grep 证据如上逐条列出。

**node --check 结果：exit code 0（语法通过）**
