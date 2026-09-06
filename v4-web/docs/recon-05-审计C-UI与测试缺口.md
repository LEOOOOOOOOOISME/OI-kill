# 审计C：UI 逻辑与测试覆盖缺口

- 审计对象：`v4-web/index.html`（内联脚本，1013 行）、`v4-web/game.js`（2144 行）、`v4-web/test.js`（601 行）、`requirement.txt`（770 行）
- 审计方式：只读（grep 定位 + 按需读区间），未修改任何被审计文件。
- 结论速览：pending 分派 8 类中 1 类（harvest/题解大会）UI 完全缺失 → 必现死锁（高）；2 项中危显示错误（publicView 剥离 srcId/dmg）；计时器、弃牌自选、技能按钮、图鉴主体功能正确；test.js 对技能/自选弃牌/限时/进化细节等大量规则零覆盖，且手牌上限断言容差过松。

---

## 一、【UI 不符/疑点】（按严重度排序）

### 高

1. **题解大会（harvest）pending 无 UI 分派 → 人类必死锁**
   - 引擎创建：`game.js:2048` `g.pending = { type: 'harvest', victim: pid, ctx }`（`harvestStep`，人类在选牌顺序中即挂起）；`game.js:2059 respondHarvest` 可用。
   - UI 缺失：`index.html:634-642 renderPendingPrompt` 只分派 dodge/counter/cold/bbst/chase/guard/aoeResp/report，**无 harvest 分支**；`index.html:754-767 respondNo`（10s 超时/ESC 默认处理）无 harvest；`index.html:819-830 aiRespondPending`、`:837-846 autoLoop` 也无 harvest。
   - 后果：人类打出【题解大会】或 AI 打出轮到人类选牌时，无任何弹窗；10s 响应计时器首次超时后 `respondNo` 直接 return（pending 不清除、计时器不再重挂），游戏卡死且 ESC 无效。
   - 修复建议：`renderPendingPrompt` 增加 `renderHarvestPrompt`（列出 `pd.ctx.cards`，点击调用 `O.respondHarvest(g, HUMAN, cardKey)`，可加"放弃选择"）；`respondNo`/`aiRespondPending`/`autoLoop` 增加 harvest 分支（默认选第一张或放弃）。
   - 注意：`test.js:203-207` B 套在引擎层已处理 harvest，掩盖了 UI 层缺失。

### 中

2. **publicView 不暴露 `pending.srcId` 与 `pending.dmg` → 响应弹窗显示错乱**
   - 根因：`game.js:1577` publicView 的 pending 只透出 `type/target/attacker/victim/trickKey/helpers/ctx`。
   - 表现：
     - `index.html:716` 特判弹窗：`pd.srcId != null ? pd.srcId : pd.attacker`，counter pending（`game.js:1005`）两者皆无 → 显示 "? 对你使用【…】"。
     - `index.html:648-649` AOE 弹窗：`playerName(pd.srcId)` → "?"；`伤害${pd.dmg}` → "伤害undefined"（`game.js:1139` 的 dmg 在顶层，不在 ctx）。
     - `index.html:688` 攻击弹窗：`pd.dmg != null ? pd.dmg : 1` 恒走 1 → 咖啡+1 / attackEvo（2 伤）等真实伤害不显示。
   - 修复建议：publicView 透出 `srcId`、`dmg`（信息不涉密）。

3. **report（举报）超时无默认动作**
   - `index.html:754-767 respondNo` 无 report 分支；10s 超时后仅停表，弹窗滞留（可手动点卡片恢复，不致死锁，但违背"超时视为否"的 8.2 要求）。ESC 同样无效。
   - 建议：超时/ESC 默认弃第一张（与 `index.html:829 aiRespondPending` 一致）。

### 低

4. **神犇黑牌当攻击的目标模式条件过宽**
   - UI：`index.html:440` 仅排除 `isAttackKey`；引擎：`game.js:1260` 另排除 `isDodgeKey` 与 `counter/counterEvo`。
   - 后果：神犇点黑色 WA/特判会进入选目标模式，选定后引擎报 "响应牌,非出牌阶段使用"（`game.js:1287`）→ 白选目标的挫败体验。建议 UI 条件与引擎对齐（补 `!O.isDodgeKey(c.key) && c.key !== 'counter' && c.key !== 'counterEvo'`）。

5. **图鉴标题与实际条目数不符**
   - `index.html:920` 标题 "卡牌图鉴 · 120张(含进化牌)"，实际展示 68 个牌型（61 进牌堆牌型 − aShield + 8 进化牌）。120 是牌堆物理张数（requirement 4.1），分组计数是牌型数而非张数。功能正确，措辞易误导。

6. **命名风格切换不作用于日志**
   - requirement 3.1（`requirement.txt:188`）要求卡面/日志/教程/图鉴同步切换；`index.html:57-58` plain-mode 仅 CSS 切换双套名 span；`logToHtml`（`index.html:245-253`）直接输出引擎文本（仅黑话名），日志不随切换。

7. **弃牌确认未检查 discardCards 返回值**
   - `index.html:575` 忽略 `O.discardCards` 结果；引擎 `game.js:1216-1227` 会拒绝非法索引。索引来自本地手牌，风险低。

8. **45s 倒计时为文本条而非"倒计时环"**
   - requirement 23.3（`requirement.txt:736`）要求"45 秒倒计时环"；UI 为 `timer-info` 文本（`index.html:872-882`）。功能齐全，视觉偏差。

### 信息（非缺陷，供维护参考）

9. **guard 分支全链路为死代码**：引擎从不创建 `type:'guard'` pending（`respondGuard` 是占位 API，`game.js:1796-1799`；忠臣挡刀在 `loseHp` 内自动裁决，`game.js:523-534`，人类恒为主公故忠臣恒为 AI）。UI 的 `index.html:639/750/762/827` guard 分支、`aiRespondPending` guard 分支均不可达。

10. **题解大会选取顺序：引擎与需求不一致**：requirement 9.2（`requirement.txt:358`）"从你起按行动顺序各选 1 张"；引擎 `game.js:1460-1462` 从使用者下家开始（`nextAlive(g, pid)`）。无测试断言顺序（见测试缺口）。

---

## 二、pending 机制核对总表（任务 1）

| type | 引擎创建（game.js） | 询问字段 | UI 分派（index.html） | responder 调用 | 超时默认(respondNo) |
|---|---|---|---|---|---|
| dodge | 808/825/835 | target（护驾 helpers / 卖队友 ctx.betrayAvail） | renderDodgePrompt ✓ | respondDodge / dodgeHelperResp / respondBetray ✓ | ✓ 视为否 |
| counter | 1005 | victim | renderCounterPrompt ✓ | respondCounter ✓ | ✓ 视为否 |
| cold | 962 | attacker | renderWeaponPrompt ✓ | respondCold ✓ | ✓ 视为否 |
| bbst | 908 | attacker | renderWeaponPrompt ✓ | respondBbst ✓ | ✓ 视为否 |
| chase | 893 | attacker | renderWeaponPrompt ✓ | respondChase ✓ | ✓ 视为否 |
| guard | 从不创建（挡刀自动裁决） | — | 死代码分支（无害） | respondGuard 占位 | — |
| aoeResp | 1139 | victim | renderAoePrompt ✓ | respondAoeResp ✓ | ✓ 视为否 |
| report | 1084 | victim（=使用者） | renderReportPrompt ✓ | respondReport ✓ | ✗ 无默认（疑点 3） |
| harvest | 2048 | victim | ✗ **缺失** | respondHarvest 引擎有，UI 从不调用 | ✗（疑点 1，死锁） |

---

## 三、计时器核对（任务 2）—— 确认 ✓

- 实现：`index.html:859-904`。回合计时 `want='turn:'+g.turn+':'+g.round`（45s）；响应计时 `want='resp:'+pdKeyOf(pd)`（10s，`pdKeyOf` 含类型/双方 id/helpers/回合轮次，`index.html:629-633`）。`want` 变化即重置 deadline → **回合切换、pending 出现/更换均正确重置** ✓。
- 超时：45s → `onTurnTimeout` → `endPlayFlow` 自动结束出牌 ✓（`index.html:894-900`）；10s → `onRespTimeout` → `respondNo` 视为"否" ✓（`index.html:901-904`），但 report/harvest 例外（疑点 1、3）。
- 弹窗内 `#resp-count` 与主计时同步 ✓（`index.html:880-881`）；弃牌选择期间不设独立计时（符合 8.1，仅行动阶段限 45s）；autoMode 下回合计时停用（设计如此）。

## 四、弃牌自选核对（任务 3）—— 确认 ✓

- `index.html:560-578`：`over = hand.length − handLimit`，>0 进入 discardMode；`toggleDiscardSel`（`:591-597`）按手牌索引收集；确认按钮校验 `size === over` 后 `O.discardCards(g, HUMAN, [...discardSel])`。
- 引擎 `discardCards`（`game.js:1216-1227`）按索引降序 splice，索引语义与 UI 一致 ✓；随后 `discardPhase`（引擎兜底）→ `endTurn` ✓；ESC 可退出模式 ✓。handLimit 计算 UI 与引擎一致（`index.html:563` / `game.js:1594` / `game.js:418`）。唯一小问题：未检查返回值（疑点 7）。

## 五、黑牌攻击 / 进化 / 特殊选牌 UI（任务 4）

- **神犇黑牌当攻击**：`index.html:440-445` 黑非攻击牌 → 目标模式 → seat click → `playCard(g, HUMAN, selected, id)` → 引擎碾压分支 `game.js:1260-1273` ✓（边界问题见疑点 4）。
- **进化 pick**：`renderEvoPrompt`/`evoPick`（`index.html:769-785`）→ `O.evolvePick` ✓；`afterAction` 与 `autoLoop` 均处理 `evoWait` ✓。
- **觉醒**：引擎自动触发（checkAwaken），UI 座位显示 ✨觉醒（`index.html:373`）✓，无需选择 UI（符合 16 章）。
- **对拍**（duel）：NEED_TARGET ✓（`index.html:382`），引擎 `doTrickCore 'duel'` 自动轮流出攻，无额外弹窗需要 ✓。
- **举报**（funReport）：NEED_TARGET ✓ → report pending → `renderReportPrompt` ✓。
- **题解大会**（harvest）：✗ 无 UI（疑点 1）。

## 六、技能按钮核对（任务 5）—— 确认 ✓

- UI SKILLS 表（`index.html:197-210`）与引擎 SKILLS（`game.js:2115-2119`）12 项一一对应：akioi/kachang/live/rejudge/seal/teach/dabiao/kouhai/chao/shuiqun/baoling/dianji ✓。
- 按钮启停（`index.html:306-315`）：限定技已用、need 手牌不足、needRed 无红牌 → disabled ✓；其余条件（灵感、每回合 1 次）由引擎校验并弹 why ✓。
- 目标技走 seat 模式 → `skillUse(name, id)`（`index.html:485-492`）；非目标 → `skillUse(name, undefined)`（`:552`）✓。
- 护驾：dodge pending 的 helpers 按钮 → `dodgeHelperResp` → `respondDodge(g, HUMAN, true, helperId)` ✓（`index.html:678-681`）。
- 挡刀：引擎自动裁决（见疑点 9）；UI guard 分支死代码。
- 主公重铸：`lordRedraw`（`index.html:987-992`）+ `lordCanRedraw`（`game.js:2098-2111`）✓；人类恒为主公（lord 固定 0 号，human=0）→ 无误触发风险 ✓。
- 手写快排 ksp（`index.html:338/500-507`）、放手一搏 fang（`:431-437/508-515`）✓。

## 七、图鉴完整性核对（任务 6）—— 确认 ✓

- `showGallery`（`index.html:907-921`）：按 basic/trick/equip/unit/evo 分组；进化牌以 desc 含 "(进化)" 识别（8 张全部命中）；`aShield`（假牌，id:-1，不进牌堆）显式排除 ✓。
- 覆盖：61 个进牌堆牌型全部展示 + 8 个进化牌型 = 68 条目；无遗漏、无假牌混入 ✓。仅标题 "120张" 措辞偏差（疑点 5）。

---

## 八、test.js 覆盖映射（任务 7）

### 套件 → 需求条款

| 套件 | 内容 | 覆盖条款 |
|---|---|---|
| A（seeds 1..40，6 人全 AI） | 120 牌守恒（:127/:137）、牌漂移、hp/mp 边界（:61-74）、turn 推进（:156-159）、手牌上限（容差 +5/+2，:141-146/:160-163）、全 AI 下 pending 恒 null（:132-134）、3000 回合终局+winner（:167-170）、视图健全（:76-94）、牌种审计（:97-116） | 1.3 铁律、4.1 牌堆 120、2.8/4.3 题海战术（间接）、7.2 手牌上限（宽松）、8.1 回合流转、12 濒死边界 |
| B（seeds 101..105，human=0） | 人类出牌 heal/attack/equip/deploy/trick（:233-297）；resolvePendingForHuman 处理 dodge/counter/harvest/cold/bbst/chase/aoeResp/report（:190-221）；finishHumanTurn → discardPhase/endTurn/evolvePick（:224-231） | 6.1 攻击/WA、9.x 锦囊（含 counter）、18.3 funReport/funBetray（顺带）、15.1 evolvePick（仅取首个） |
| C1 | WA 响应 yes/no：闪避扣 1 灵感不掉血 / 不闪掉 1 血（:348-385） | 6.1、9.1 WA |
| C2 | 卖队友转嫁 respondBetray（:388-410） | 18.3 卖队友 |
| C3 | 守擂单位挡刀（:413-430） | 6.2 |
| C4 | 题海战术：摸空洗回 + 全体存活 −1（:433-456） | 2.8、4.3 |
| C5/C6 | 特判反制 yes / 放弃反制（:459-505） | 9.2 特判 |

### 【测试缺口】（需求规则无自动化覆盖，未来测试任务）

1. **8.2/1.3-5 限时 45s/10s**：test.js 不加载 index.html，UI 定时器/超时自动响应零覆盖（疑点 1、3 正因如此未被发现）。
2. **L5 弃牌自选 `discardCards`**：从未调用；B 套只走 `discardPhase` 自动弃牌。
3. **13 章 12 个主动技 `skillUse`**：从未调用。
4. **2.6 主公重铸 `lordRedraw/lordCanRedraw`**：从未调用。
5. **2.6 护驾 helperId 代出 WA 路径**：C1 只测 `respondDodge(yes/no)`。
6. **2.6/H4 忠臣挡刀**（loseHp 自动裁决）：无测试。
7. **15 章进化细节**：每回合 1 次/每局 3 次上限、各进化条件、8 张进化牌效果——B 仅 `evolvePick` 首个候选。
8. **16 章觉醒**：触发与 19 职业效果无测试。
9. **17 章评测机事件**：无定向断言（A/B 随机局仅顺带经过）。
10. **11 章判定机制**：延时锦囊判定、判定牌置回牌堆底无测试。
11. **12.1 濒死救援**：咖啡自救、学长谈心无测试。
12. **18.3 欢乐牌**：仅 funBetray（C2）、funReport（B 顺带）；funLie/funClone/funGiveup/funPower/funArgue/funCcf 效果与保底轨无断言。
13. **14 章领域亲和、2.9 计分成就、2.7 离场投降 playerLeave、2.3/2.5 胜利判定与击杀奖惩细节、9.3 换装免费、19.2 特判反制特判链、H2-1 主公首轮免伤、H2-2 评测机护盾**：无定向测试。
14. **UI 层整体**（index.html 分派/按钮/图鉴/计时器）：零覆盖，需浏览器级测试（如 Playwright）。

### 测试中可能错误的期望

1. **手牌上限容差过松**：A 套回合开始容忍 `lim+5`（:145）、弃牌后容忍 `lim+2`（:162-163）。按 8.1⑤ 弃牌后应严格 ≤ 上限；容差会掩盖 discardPhase 缺陷（任务提示所指）。建议收紧，或对合法来源（挣扎+2/觉醒+1/玄学优化+2/集训+1 等）逐项核销后再断言。
2. C1/C5 以 `g.round = 2` 绕过主公首轮免伤（H2-1），H2-1 本身无正/反向测试（见缺口 13）。
3. A 套 "全 AI 下 pending 恒 null" 依赖"pending 只为人类创建"的引擎约定——合理但脆弱，建议注释注明。
4. C4 仅断言存活玩家 −1（与引擎行为一致，OK）。

---

## 九、【确认】简要结论

1. **pending 完整性**：引擎共 8 类 pending，UI 覆盖 7 类；唯一硬缺口是 **harvest（题解大会）无 UI** → 人类遇到必死锁（最高优先级）。guard 类型引擎不产生，UI 分支为死代码。
2. **计时器**：45s/10s 已实现，回合切换与 pending 出现均正确重置，超时默认"否"；report/harvest 无超时默认（后者同死锁）。
3. **弃牌自选**：链路正确（索引语义一致），仅未检查返回值。
4. **黑牌攻击/进化/特殊选牌**：碾压、进化 pick、对拍、举报均可用；题解大会除外。
5. **技能按钮**：12/12 与引擎对齐；护驾 ✓；挡刀引擎自动裁决；主公重铸 ✓。
6. **图鉴**：61 进牌堆牌型 + 8 进化牌全覆盖，假牌 aShield 已排除 ✓。
7. **测试覆盖**：A/B/C 三套映射清晰；最大缺口为技能 skillUse、弃牌自选 discardCards、限时机制、进化/觉醒/事件细节、多数欢乐牌；手牌上限断言容差过松是明确的"错误期望"。
