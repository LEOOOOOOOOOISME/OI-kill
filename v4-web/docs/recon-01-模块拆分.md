# 《OI杀》v4-web 代码盘点与多文件拆分方案

> 盘点执行方式：只读（read/glob/grep/pwsh），除本交付文档外未改动任何源文件。
> 口径说明：行数采用 read 工具口径（含空行）。`pwsh Get-Content | Measure-Object -Line` 对空行计 0（字符串语义），得到 2041/964/554/81/12，差额恰好等于各文件空行数，故本报告以 read 口径为准。

## 一、v4-web 目录盘点

### 1.1 行数统计

| 文件 | 行数 | 空行 | 字节 | 角色 |
|---|---|---|---|---|
| `game.js` | 2144 | 103 | 119,637 (117KB) | 纯逻辑引擎（单个 IIFE，无 DOM，浏览器/Node 双端） |
| `index.html` | 1013 | 49 | 56,347 (55KB) | 可玩 UI |
| `test.js` | 601 | 47 | 27,390 (27KB) | 引擎自动化测试 |
| `README.md` | 112 | 31 | 8,719 (8.5KB) | v4-web 文档 |
| `bugreport.md` | 14 | 2 | 2,037 (2KB) | 主代理任务指令 |

### 1.2 game.js 结构

- **封装**：整个文件是单个 IIFE `(function(root){...})(window||globalThis)`，`'use strict'`。**无任何 `require()` / `import`**（v4-web 中唯一的 `require` 是 test.js 第 12 行的 `require('./game.js')`）。全部顶层定义缩进 2 格位于 IIFE 内，因此 `^function|^const` 列 0 位扫描无结果（grep 仅命中行 1 注释）。
- **双端导出**（行 2142–2143）：`module.exports = api`（Node）/ `root.OIKill = api`（浏览器）。
- **module.exports 完整清单（共 54 个键 = 9 数据表 + 40 函数 + 5 判断助手）**：

```
数据表(9): CARDS, DECK_COUNT, PROFESSIONS, DOMAINS, IDENTITIES, ID_TABLE,
           EVENTS, EVO_MAP, SKILLS
函数(40):  createGame, setup, startTurn, judgePhase, drawPhase, discardPhase,
           endTurn, playCard, equipCard, deployUnit, publicView, aiTurn,
           respondDodge, respondCounter, respondBetray, respondCold, respondBbst,
           respondChase, respondHarvest, respondGuard, respondAoeResp, discardCards,
           respondReport, playerLeave, discardFun, kspAttack, fangAttack,
           evolvePick, tryEvolve, unitAttack, skillUse, lordCanRedraw, lordRedraw,
           nextAlive, draw, spec, effectiveCost, attackPlayer, loseHp, checkVictory
助手(5):   suitZh, isBlack, isRed, isAttackKey, isDodgeKey
```

- **未导出但存在的顶层成员**（按文件区块注释分组）：
  - RNG：`makeRng`
  - 卡牌定义区：`buildDeck`、`SUITS`
  - 基础操作：`cardName`、`discardCard`、`discardFromHand`、`domOf`、`spend`、`gainMp`
  - 回合流程：`judgeCard`
  - 伤害/濒死：`nearDeath`、`kill`、`giveAttack`、`forceEndByCount`、`end`、`settleAchievements`、`queueEvo`、`checkAwaken`
  - 战斗裁决：`canDodge`、`resolveDodge`、`afterDodge`、`resolveHit`
  - 特判/锦囊：`COUNTERABLE`(行 998)、`tryCounter`、`doTrickCore`、`aoeOrder`、`aoeApplyOne`、`resumeAoe`、`canPlay`、`harvestStep`
  - 其他：`helperDodge`、`onBecomeTarget`、`resumeMultiAttack`、`unequipArmor`、`unitDie`、`aiSkill`、`pickTarget`
- **内部状态钩子**：`g.human`、`g.askDodge`（单布尔）、`g.pending`（单槽）、`g.evoWait`、`g.discardChoice`（行 420 引用但从未定义——遗留死代码）。

### 1.3 index.html 结构

- **内联块**：`<style>` 第 7–129 行（123 行，11.5KB）；`<script src="game.js">` 第 188 行；内联 `<script>` 第 189–1011 行（823 行，38.5KB）；DOM 骨架约 6.4KB。
- **UI 功能清单**（从脚本识别）：
  - 缩放：`applyScale` / `btn-scale`（0.85→1.30 步进 0.15，#scaler transform）
  - 主题：`btn-theme` 切 `body.dark`（CSS 变量双主题）
  - 命名双轨：`sw-mode` 切 `plain-mode`（OI黑话/通俗版，`.name-zh` / `.name-plain`）
  - 渲染：`render` / `seatHtml`（座位网格、手牌卡面、双轨条、装备/单位/延时 chips、回合光环、日志 `logToHtml` 含内奸脱敏 H10）
  - 出牌交互：点手牌出牌；`NEED_TARGET`（15 键）选目标；`seatTargetable` 高亮；ESC 取消
  - 特殊模式：欢乐牌「打出/弃置保底」双按钮、手写快排 `kspAttack` 目标模式、放手一搏 `fang` 多目标(≤3)、神犇碾压黑牌当攻
  - 技能：`SKILLS`（12 职业）动态按钮、目标技选座、限定技 `usedLimited`
  - 弃牌选择：`discardMode` / `discardSel`（L5 自选弃牌）
  - 响应弹窗（按 `pending.type` 分派 9 类）：`dodge`(含护驾 helpers、卖队友 betrayOptions)、`counter`、`cold/bbst/chase/guard`、`aoeResp`、`report`；`respondNo()` 超时统一“否”
  - 进化选择：`renderEvoPrompt` / `evoPick`
  - AI 循环：`runAi` / `afterAction` / `aiRespondPending`；自动托管 `autoLoop`(400ms)
  - 计时器：出牌 45s / 响应 10s（`syncTimers` / `onTurnTimeout` / `onRespTimeout`，250ms 轮询）
  - 图鉴：`showGallery`（5 组含进化牌）；教学：`tutorOn` / `TUTOR_TIPS`（4 条）；开局：人数选择 3~6、身份/职业弹窗、主公重洗 `lordRedraw`；成就结算 `showAchievements`

### 1.4 test.js 结构（601 行）

- `const API = require('./game.js')`；工具：`makeRec` 失败记录器、`totalCards`（卡牌守恒，排除 id=-1 假牌）、`checkBounds`、`checkView`、`keyAudit`（终局牌种审计）。
- **A 套件（全AI不变量回归）**：seeds 1..40，6 人局（human:99），每局 ≤3000 步；断言：牌堆守恒 120 / card-drift / pending 无泄漏 / 数值边界(hp/mp/mpMax) / 手牌上限 / turn-stuck / publicView 健全 / 终局 keyAudit。
- **B 套件（人类流程模拟）**：human=0，seeds 101..105；人类按 治疗→攻击→装备→部署→锦囊 顺序行动，`resolvePendingForHuman` 处理全部 pending 类型（dodge/counter/harvest/cold/bbst/chase/aoeResp/report），`finishHumanTurn` 收尾（discardPhase + endTurn + evolvePick）。
- **C 套件（定向单测 6 项）**：C1 WA响应（出/不出）、C2 卖队友转嫁、C3 守擂挡刀、C4 题海战术、C5 特判反制、C6 特判放弃反制（曾 100% 复现崩溃 bug）。
- 汇总输出：按失败类合并计数与样本、牌种审计、A/B/C 通过率。

### 1.5 README.md 结构与不一致统计

章节：`# 标题`、`## 文件`、`## 运行`、`## 已实现的 v4.0 规则`、`## ⚠️ 已知「需求-实现不一致」清单`、`## 自动化测试`、`## 已修复的重要 Bug`、`## 自动化回归记录`。

- **不一致清单 18 项**（#1–#18）：16 项 ✅已实装，2 项 ⚠️ 未解决 —— #13 多人响应顺序（逆时针询问，多人局域网需补）、#14 平衡胜率偏差。
- **已修复 Bug 列表实际 42 条**（编号 1–42），但标题自称「累计 25 项」——文档自身不一致。
- **胜率数据两处矛盾**：#14 称 200 局 反贼 53.5% / 主公方 28.5% / 内奸 18%（目标 33/60/7）；末尾回归记录称 40 局 主公方 67.5% / 反贼 25% / 内奸 7.5%。
- `bugreport.md`（14 行）：主代理指令 —— 多 subagent 操作、拆分多文件减少臃肿、单人/多人双版本、房主即服务器、无依赖单一可执行文件、GitHub Pages（GithubServerVer 文件夹）+ 归档旧版至 cppversion(old) + UserVer 源码 + release、大幅完善动效/特效/音效、AI 增强、参照 ui-design.html、多轮测试、写好更新日志。

## 二、工作区根目录盘点

```
D:\projects\oi-kill\
├── requirement.txt        (770 行) v4.0 权威需求文档（唯一规范）
├── README.md              (94 行)  玩家手册 —— 实为 v3.x 规则（距离/坐骑/3-9人），与 v4.0 冲突，不可作为 v4-web 依据
├── ui-design.html         (54.4KB) UI 设计标准稿（GBK 编码；bugreport 要求参照它改进）
├── 超时空辉夜姬.md         (301.6KB) 与本项目无关的文本
├── BUG Report.md          (4.8KB)   C++ 旧版自动化测试 Bug 清单（对照 v3.0 需求）
├── _bug_reports_\fixed\0815-8.md
├── useless\  code1.py (28.5KB) + AI 架构存档 txt (58.4KB)
├── v4-web\  （本次盘点对象）
└── 【C++ 旧版局域网服务器（v3.x，Winsock:8080，无第三方依赖）】
    ├── main.cpp (3.4KB)          服务器入口
    ├── game_engine.h/.cpp (10.2/174.5KB)  游戏引擎
    ├── network_server.h/.cpp (2.5/38.3KB) HTTP + WebSocket（8080）
    ├── room_manager.h/.cpp (1.8/16.7KB)   房间管理
    ├── auth.h (15.3KB)           XOR 会话认证
    ├── socket_util.h (13.6KB) / logger.h (3.8KB)
    ├── html_content.h (102.9KB)  内嵌网页
    ├── nlohmann\json.hpp (931KB) 第三方 JSON
    ├── build.bat (g++ UTF-8 编译脚本) / diag.ps1 (XOR 解码小工具)
    ├── OIKillServer.exe (2.9MB 编译产物) / users.dat (12.3KB)
    ├── test_game.mjs (10.7KB) Node 自动化对局客户端（WebSocket，端到端测试思路可复用）
    ├── logs\oi_kill_20260808~20260905.log ×6
    └── srv_rn/rne/np/npe/t/te.txt, b1/b2.txt, boot_err/out.txt  运行日志
```

要点：C++ 版（main.cpp / network_server.cpp / room_manager.cpp / game_engine.cpp）即未来局域网版的服务端参考；`test_game.mjs` 是现成的端到端测试客户端。

## 三、game.js 多文件拆分方案

### 3.1 总体设计（保持 CommonJS 形状 → test.js 零改动）

- **模块化机制**：每文件沿用「IIFE + 共享命名空间」双端模式：

```js
(function (root) {
  'use strict';
  const NS = root.OIKill = root.OIKill || {};   // 浏览器共享命名空间
  // ... 本模块定义 ...
  const api = { /* 本模块导出 */ };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node 导本模块
  else Object.assign(NS, api);                    // 浏览器挂载
})(typeof window !== 'undefined' ? window : globalThis);
```

- **新 game.js 变聚合入口**（约 30 行）：Node 下 `require` 全部子模块合并后 `module.exports = api`（**54 个键名与签名完全不变**）；浏览器下仅断言各模块已挂载。→ `test.js` 的 `require('./game.js')` 与全部 `API.xxx` 调用**零修改**；`index.html` 的 `const O = window.OIKill` 同样零修改。
- **跨模块调用约定**：模块间一律**运行时引用**（函数体内 `NS.engine.playCard(...)`，或顶层只解构无环依赖），因为 engine ↔ combat ↔ tricks 存在循环依赖（playCard → attackPlayer → loseHp → checkVictory）。IIFE 顶层解构跨模块引用会因加载顺序/循环拿到 undefined，须避免。
- **加载顺序**（浏览器 `<script>` 与 Node require 均按此序）：`constants → cards-data → util → engine → combat → tricks → skills → ai → net-api → game`。

### 3.2 模块清单（9 个 + 聚合入口，精确到函数/常量名）

| 模块 | 估算行数 | 迁入的现有成员（原名） |
|---|---|---|
| `constants.js` | ~90 | `DECK_COUNT, PROFESSIONS, DOMAINS, IDENTITIES, ID_TABLE, EVENTS, EVO_MAP, SKILLS, SUITS, suitZh, COUNTERABLE` |
| `cards-data.js` | ~135 | `CARDS`（78 张定义：基础 4 + 常规锦囊 18 + 欢乐 8 + 武器 11 + 防具 9 + 单位 8 + 进化 8 + aShield） |
| `util.js` | ~240 | `makeRng, buildDeck, isBlack, isRed, isAttackKey, isDodgeKey, spec, cardName, draw, discardCard, discardFromHand, effectiveCost, domOf, spend, gainMp, nextAlive, judgeCard, onBecomeTarget, unequipArmor, unitDie` |
| `engine.js` | ~620 | `createGame, setup, startTurn, judgePhase, drawPhase, discardPhase, endTurn, canPlay, playCard, equipCard, deployUnit, discardCards, publicView, lordCanRedraw, lordRedraw, playerLeave, checkVictory, forceEndByCount, end, settleAchievements, queueEvo, tryEvolve, evolvePick, checkAwaken` |
| `combat.js` | ~430 | `attackPlayer, canDodge, resolveDodge, afterDodge, resolveHit, helperDodge, resumeMultiAttack, respondDodge, respondBetray, respondCold, respondBbst, respondChase, respondGuard, loseHp, nearDeath, kill, giveAttack` |
| `tricks.js` | ~380 | `tryCounter, respondCounter, doTrickCore, aoeOrder, aoeApplyOne, resumeAoe, respondAoeResp, harvestStep, respondHarvest, respondReport, discardFun` |
| `skills.js` | ~230 | `skillUse, kspAttack, fangAttack, unitAttack` |
| `ai.js` | ~170 | `aiTurn, aiSkill, pickTarget` |
| `net-api.js` | ~150（新增） | 见 3.3 |
| `game.js`（聚合） | ~30 | 仅 require/合并 + 导出 |

> 任务候选清单中的 7 个模块全部覆盖：engine.js 若按 7 文件方案将达 1400+ 行，故按职责再拆出 combat.js（战斗裁决 + 伤害濒死）与 tricks.js（锦囊/AOE/响应）——若坚持 7 文件，则 combat/tricks 并入 engine.js（单文件 ~1400 行，不推荐）。

### 3.3 网络动作面（net-api.js = 未来多人协议的接口规格）

**客户端/AI → 服务器可调用动作（映射到现有引擎函数）**：
- 回合动作：`playCard(g,pid,cardIdx,targetId)`、`equipCard(g,pid,cardIdx)`、`deployUnit(g,pid,cardIdx)`、`discardFun(g,pid,cardIdx,targetId)`、`kspAttack(g,pid,targetId)`、`fangAttack(g,pid,targetIds,cardIdx)`、`skillUse(g,pid,name,targetId)`、`unitAttack(g,pid,unitIdx,victimPid)`、`discardCards(g,pid,indices)`、`endTurn(g,pid)`（服务器先内部跑 discardPhase）、`lordRedraw(g)`、`playerLeave(g,pid)`
- 响应动作（对应 pending）：`respondDodge(g,pid,yes,helperId)`、`respondCounter(g,pid,yes)`、`respondBetray(g,pid,targetId)`、`respondCold / respondBbst / respondChase / respondAoeResp(g,pid,yes)`、`respondHarvest(g,pid,choiceKey)`、`respondReport(g,pid,cardKey)`、`respondGuard(g,pid,yes)`（现为占位）、`evolvePick(g,pid,key)`
- 服务器内部自动（客户端不直接调）：`judgePhase / drawPhase / discardPhase / endTurn / startTurn`

**服务器 → 客户端事件**：
- `state`：每动作后按玩家广播 `publicView(g,pid)`（已做手牌/身份信息过滤；局域网版必须严格只发 own view）
- `pending` 9 种：`dodge`(ctx 含 betrayAvail/betrayOptions、helpers 护驾)、`counter`、`cold`、`bbst`、`chase`、`guard`(占位)、`aoeResp`、`report`(ctx.cards)、`harvest`(ctx.cards/order)
- 语义事件（由 log / view diff 派生）：`draw / damage / heal / death(翻身份) / guard-block / judge / event(评测机翻牌·题海战术洗回) / equip / deploy / unit-die / awaken / evo(evoWait) / gameover(winner+achievements) / leave`
- 计时：`turn 45s`、`resp 10s` 服务器权威，超时视为 respondNo

**多人化必须补的引擎缺口**（写进 net-api 注释，不属本次拆分范围）：
- `g.askDodge` 是单布尔 → 需改为「询问目标集合」；
- `g.pending` 单槽 → AOE 逐人、护驾多询问需服务器按座位顺序串行生成；
- 响应顺序需按需求 19.2 逆时针；
- `discardPhase` 中死引用 `g.discardChoice` 需清理或实现；
- `publicView` 之外 UI 还直接读 `g.players`（如 `g.players[v.turn].name`），多人版应封进 view。

### 3.4 index.html 拆分

- `style.css`：第 7–129 行（123 行，11.5KB）原样搬出；
- `ui.js`：第 189–1011 行脚本（823 行，38.5KB）搬出，末尾保留 `openSetupModal()` 初始化；
- `index.html` 骨架：约 170 行 / 6.4KB；`<head>` 改为 `<link rel="stylesheet" href="style.css">`；`<script src="game.js">` 改为按 3.1 顺序的 9 个 `<script>` 标签（file:// 直开依然可用）；
- **未来单可执行打包**：届时用 esbuild / 自定义 concat 把 css + js 内联回单 html，再随 Node 服务端（或 pkg/nexe）打包；本阶段无需打包即可开发。

### 3.5 拆分后规模估算

- 总计约 2475 行 / 112KB（比原 2144 行略增，多出每文件 ~20 行头部样板）；**单文件最大 620 行**（engine.js）。
- 复用点：单人版与局域网版共享 constants / cards-data / util / engine / combat / tricks / skills / ai 七个纯逻辑模块；仅 ui.js（UI）与 net-api/网络层（多人）不同。

### 3.6 实施任务拆分（3 个 subagent 任务，附验收标准）

**任务 1（纯机械搬运 + 接线，低风险）**
将 game.js 拆为 constants / cards-data / util / engine / combat / tricks / skills / ai 8 个模块 + 新聚合 game.js；index.html 换按序加载标签。
验收：① `node test.js` 全绿（A 40/40、B 5/5、C 6/6）；② `node -e` 对比脚本断言新旧导出键集合一致（54 键、签名不变）；③ file:// 打开可开局可玩（人工清单 8 项：开局/出牌/攻击选目标/WA 弹窗/装备/弃牌/进化/结束结算）。

**任务 2（UI 拆分）**
index.html → style.css + ui.js + 骨架。
验收：缩放/主题/命名切换/欢乐牌双按钮/快排与放手一搏/技能/弃牌选择/图鉴/教学/成就 逐项功能回归 + `node test.js` 仍绿。

**任务 3（网络面显式化）**
新增 net-api.js（ACTIONS 表、EVENTS 表、applyAction 分派、pending 序列化、多人缺口注释）+ net-protocol.md。
验收：`node -e` 断言 ACTIONS 覆盖引擎全部公开动作函数且签名匹配、EVENTS 覆盖 9 类 pending 与全部语义事件；`node test.js` 仍绿。

### 3.7 风险与注意事项

- 循环依赖（engine ↔ combat ↔ tricks）：只允许函数体内运行时引用，禁止顶层解构跨模块。
- `discardPhase` 中 `g.discardChoice` 死引用：搬运时保持原样或加注释，**不改行为**。
- 内奸日志脱敏耦合：脱敏逻辑在 UI `logToHtml` 与引擎 `kill()` 日志文本两处，拆分时不要移动其一。
- 导出面 54 键是 test.js 与 UI 的共同契约，聚合 game.js 必须逐键对齐。
