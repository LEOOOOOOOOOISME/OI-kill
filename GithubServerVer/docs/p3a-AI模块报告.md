# P3a AI 决策模块报告（OI杀 v4）

> 执行代理：P3a（AI 决策模块作者）
> 范围：仅新增 `v4-web/src/ai/*`（5 个文件）与本报告；**未修改** engine / data / net / index.html / test 任何文件。
> 规格依据：`docs/recon-02-架构方案.md` §E（P3-1..P3-6）、`docs/p2a-多人化报告.md`、`requirement.txt`（身份策略/平衡四件套/技能条款）。
> 结论：5 个 CommonJS 模块（零外部依赖，浏览器经共享命名空间 `OIKill.ai.*` 双用）全部 `node --check` 通过；自测 **62/62 全绿**；6 种子 × 3 难度 = 18 局整局冒烟 18/18 跑通（零非法动作、全部正常终局）。

---

## 一、交付物清单与体积

| 文件 | 行数 | 字节 | 职责 |
|---|---|---|---|
| `src/ai/difficulty.js` | 73 | 4,360 | P3-5 难度与节奏表 + 延迟采样助手 |
| `src/ai/scorer.js` | 419 | 21,358 | P3-1/P3-4 场景评分器（手牌效用/目标威胁/身份信念） |
| `src/ai/identity-policy.js` | 173 | 9,697 | P3-2 四身份策略（权重/优先级/保留倾向） |
| `src/ai/heuristics.js` | 608 | 30,600 | P3-3/P3-4 用牌启发 + 响应决策 + 描述符执行器 |
| `src/ai/self-test.js` | 290 | 15,553 | 可运行自测（`node src/ai/self-test.js`） |
| 合计 | 1,563 | 81,568 | — |

模块间依赖（全部单向，无环）：`heuristics → {difficulty, scorer, identity-policy}`，`identity-policy → scorer`，`scorer → data/* + engine/core（只读 effectiveCost/spec）`。所有模块沿用引擎的 UMD-IIFE 模式：Node 走 `module.exports`，浏览器挂载 `OIKill.ai.<name>`（P3b 在 index.html 追加 4 个脚本即可双用；self-test 为纯 Node 脚本）。

---

## 二、自测结果（`node src/ai/self-test.js`）

```
=== 汇总: 通过 62 / 失败 0 ===
P3a AI 模块自测全绿 ✓
```

| 套件 | 断言数 | 内容 |
|---|---|---|
| S1 难度表 | 25 | 三档表形状（thinkMs/errPct/retentionBias/dodgeHpThreshold/evDepth 等）、延迟采样区间（easy 800~2500ms、hard 800~1500ms、绝不瞬发）、未知难度回落 normal |
| S2 身份信念 | 4 | 主公=lord 1.0；存活目标信念和为 1 且有限；挡刀计数→忠臣≥0.9；颓废标记日志→内奸≥0.9 |
| S3 打分器 | 5 | scoreCard/scoreHand/scoreTarget 全有限；构造场景下「带武+觉醒+守擂主公 ＞ 白板内奸」威胁分、「1 血主公 ＞ 满血内奸」攻击优先级；threatList 降序完整 |
| S4 身份策略 | 8 | 反贼 focusLord＞忠臣；忠臣 protectLord＞反贼；内奸 hoardForDuel＞反贼；主公 selfPreserve＞反贼；忠臣/内奸绝不攻击主公（prio ≤ -90）；反贼打主公加成＞打忠臣；四身份整体互异 |
| S5 合法性 | 2 | 3 种子 × 全身份座位：chooseAction 描述符经 applyAction 全部 `ok !== false`；四身份均产出过合法动作 |
| S6 纯性 | 2 | chooseAction 不修改状态（手牌快照一致）；discardChoice 未超限返回空 |
| S7 响应决策 | 13 | 低血必闪/满血留闪/有害锦囊特判/AOE 低血响应/题解大会反贼选攻击/举报弃最高价值/祖安对线（高血弃垃圾牌、1 血受伤害）/冷数据血厚改拆牌/不死心追刀（有无攻击）/转嫁同意（忠臣请求且存活→同意、会死→拒绝） |
| S8 完整对局 | 3 | heuristics 驱动 6 人全 AI 整局：零非法动作、3000 步内终局且 winner 非空、实际出牌 ≥20 次 |

另做 **18 局冒烟**（seed {1,7,42,99,12345,20240501} × {easy,normal,hard}，全 AI 6 人局）：18/18 正常终局、零非法动作；胜方含主公方/反贼/内奸三态，说明四身份路径均被走到（P3-6 平衡调参由此基线起步）。

引擎回归：`node test.js` 在交付前另行后台复核（本模块不触碰引擎，预期 A/B/C 全绿）。

---

## 三、设计契约（供 P3b 接线）

### 3.1 difficulty.js（P3-5）

```js
DIFFICULTY = { easy, normal, hard }            // 每档字段:
// label, thinkMs:[lo,hi], respMs:[lo,hi], gapMs:[lo,hi],
// hesitatePct, hesitateMs:[lo,hi],            // 偶发"犹豫"停顿(响应前多停1~2s)
// errPct, randomPickPct, retentionBias,       // 犯错率/随机率/保留倾向 0..1
// useIdentityPolicy, useThreatModel,          // 决策能力开关
// dodgeHpThreshold, overflowDodge, counterValue, evDepth
get(difficulty)            // 'easy'|'normal'|'hard'|表对象 → 表; 未知回落 normal
thinkDelay(d, rnd)         // 行动思考 ms(永不 0)
respDelay(d, rnd)          // 响应思考 ms
gapDelay(d, rnd)           // 同回合动作间隔 ms
hesitateDelay(d, rnd)      // 偶发犹豫 ms(0=不犹豫)
willErr(d, rnd)            // 是否犯错
willRandomTarget(d, rnd)   // 是否随机选目标
```

### 3.2 scorer.js（P3-1/P3-4）——纯函数族，只读 g

```js
identityBelief(g, viewerId, targetId)  // → {lord,loyal,rebel,traitor} 和为1
hostilityOf(g, pid, targetId)          // → 0..1 目标对"我"的敌意(信念加权)
scoreTarget(g, pid, targetId)          // → 威胁分: 血量/身份概率/防具/守擂单位/觉醒
attackPriority(g, pid, targetId)       // → 威胁分 + 终结价值(残血收割)
threatList(g, pid)                     // → [{id,hp,maxHp,threat,priority,hostility,belief}] 降序
scoreCard(g, pid, cardIdx)             // → 手牌场景效用 max(打出, 保留×0.55)
playValue(g, pid, cardIdx)             // → 现在打出的价值
keepValue(g, pid, cardIdx)             // → 保留价值(WA/桃/咖啡/特判/卖队友)
scoreHand(g, pid)                      // → 手牌总实力
cardBaseValue(key)                     // → 卡牌静态价值
handLimit(p) / lordOf(g) / costOf(g,p,key)  // 工具(费用经引擎 effectiveCost, 不自行复制规则)
```

**无上帝视角实现**：身份信念只读公开信息——主公公开；阵亡身份按 `阵亡!身份: X` 日志公开，未见公开者按规则反推=内奸；挡刀计数/【挡刀】【护驾】日志=忠臣铁证；【颓废标记】日志=内奸铁证；缴获主公装备、对主公延时锦囊=反贼证据，对主公【玄学优化】=示忠；先验取 `ID_TABLE` 扣除已知项；对数权重 softmax。**存活暗置身份字段一律不读**（主公除外）。

### 3.3 identity-policy.js（P3-2）

```js
policyFor(g, pid)      // → 策略对象:
// { identity, weights:{attack,heal,equip,unit,trick,skill,fun,retain},
//   aggression, protectLord, focusLord, focusNow, breakShieldFirst,
//   probeLoyalists, buildFirst, balancer, hoardForDuel, selfPreserve,
//   blindProbe, useGuardDodge, delayToThreat, aoeThreshold,
//   saveCounterFor:[key...], focusThreshold, firstRoundCostPenalty,
//   retention:{dodge,counter,heal,coffee},
//   attackPrio(targetId)→number }          // 目标偏好加成(身份/信念/局势动态)
sideBalance(g, pid)    // → {lordSide, rebelSide, rebelStrong} 内奸平衡用
rebelsAliveByRule(g)   // → bool 存活反贼数(ID_TABLE - 公开阵亡反贼, 规则推导)
lordShieldUp(g)        // → bool 主公护盾/守擂仍在
allyWeight(g, pid, targetId)  // → 0..1 目标是我方成员概率
targetPreference(g, pid, targetId) // = policyFor(...).attackPrio(tid)
```

要点：反贼——首轮 `buildFirst`（+1 费先铺装备/攒牌，打主公 prio -1.8）、`breakShieldFirst` 先拆盾/打守擂、`focusNow` 主公 ≤3 血或盾破才集火（+4.2）、探忠（打高忠信念 +0.7）；忠臣——`protectLord=1`、护驾更积极、绝不打主公（-99）、主动打疑似反贼并拆其装备；内奸——`balancer` 按 sideBalance 打强方、`rebelsAliveByRule` 为真时绝不杀主公（-99）、治疗/咖啡保留乘数 1.5 进单挑；主公——`selfPreserve=1`、`blindProbe=0.7` 打疑似反贼（误伤忠臣 -1 认罚，攻击权重按信念而非禁止）。

### 3.4 heuristics.js（P3-3/P3-4）

```js
chooseAction(g, pid, opts)        // → 动作描述符 | {kind:'end'}; opts={difficulty, rnd}
chooseResponse(g, pid, prompt, opts) // → 响应描述符 | null; prompt 为提示条目对象
discardChoice(g, pid, opts)      // → number[] 弃牌索引(降序, discardCards 友好)
applyAction(g, pid, desc)        // → 执行描述符(调引擎既有 API, 返回其 {ok,why,...})
DESCRIPTOR_KINDS                 // 全部动作种类名数组
```

**动作描述符 ⇄ 引擎调用 1:1 映射**（P3b 接线依据）：

| 描述符 | 引擎调用 |
|---|---|
| `{kind:'play', cardIdx, targetId?, targetId2?}` | `playCard(g,pid,cardIdx,targetId,targetId2)` |
| `{kind:'equip', cardIdx}` | `equipCard(g,pid,cardIdx)` |
| `{kind:'deploy', cardIdx}` | `deployUnit(g,pid,cardIdx)` |
| `{kind:'skill', name, targetId?, targetId2?}` | `skillUse(g,pid,name,targetId,targetId2)` |
| `{kind:'unitAttack', unitIdx, victimPid}` | `unitAttack(g,pid,unitIdx,victimPid)` |
| `{kind:'kspAttack', targetId}` | `kspAttack(g,pid,targetId)` |
| `{kind:'fangAttack', cardIdx, targetIds}` | `fangAttack(g,pid,targetIds,cardIdx)` |
| `{kind:'funFallback', cardIdx, targetId?}` | `discardFun(g,pid,cardIdx,targetId)` |
| `{kind:'discard', indices}` | `discardCards(g,pid,indices)` |
| `{kind:'end'}` | （调用方：`discardChoice`→`discardCards`→`endTurn`） |
| `{kind:'respondDodge', yes, helperId?, promptId?}` | `respondDodge(g,pid,yes,helperId,promptId)` |
| `{kind:'respondBetray', targetId, promptId?}` | `respondBetray(g,pid,targetId,promptId)` |
| `{kind:'respondCounter', yes, promptId?}` | `respondCounter(g,pid,yes,promptId)` |
| `{kind:'respondAoeResp', yes, promptId?}` | `respondAoeResp(g,pid,yes,promptId)`（兼 aoeResp/argueResp） |
| `{kind:'respondHarvest', choiceKey, promptId?}` | `respondHarvest(g,pid,choiceKey,promptId)` |
| `{kind:'respondReport', cardKey, promptId?}` | `respondReport(g,pid,cardKey,promptId)` |
| `{kind:'respondCold'/'respondBbst'/'respondChase', yes, promptId?}` | `respondCold/respondBbst/respondChase` |

决策要点：杀按「威胁分 + 身份策略加成」选目标；闪按 `HP≤dodgeHpThreshold` 或手牌溢出或 EV（`被击损失×概率 vs WA 价值×retentionBias`，hard 档算上濒死自救兜底）；桃/咖啡低血优先、濒死咖啡保留；装备按槽位价值换装（主公护盾不轻易换）；延时牌给最大威胁、拆/缴获给高价值装备、AOE 敌 ≥aoeThreshold 才开、特判保留给 saveCounterFor 清单关键锦囊；单位守擂保己方核心/速攻清敌方单位/亡语过牌；技能 19 职业逐张表（含觉醒：卡常免费、口嗨双目标、爆零 +1 伤、讲题同摸等）；欢乐牌双轨（效果/弃置保底各打分取高）。响应全走 EV：护驾（忠臣代出闪更积极/主公选信念最像忠臣的帮手）、卖队友转嫁与同意（存活+对方是我方才接）、冷数据（血厚/护盾吞伤时改拆牌）、平衡树（有垃圾牌才弃 1 强制命中）、不死心（有攻击就追）。难度应用：easy 近似随机+易空过；normal 启发式+少量随机；hard 最优+更优保留。RNG 缺省取 `g.rnd`（种子确定性，ai-stats 可复现）。

---

## 四、P3b 接线计划（引擎改动点，本阶段未动引擎）

| # | 引擎位置 | 现状 | 改为 |
|---|---|---|---|
| 1 | `core.js` `aiTurn`（L1255–1361）+ `pickTarget`（L1364） | 旧随机启发大循环 | 循环体改为：`chooseAction` → `applyAction`；`{kind:'end'}` 时 `discardChoice`→`discardCards`→`discardPhase`→`endTurn`；每步之间 `gapDelay`；`pickTarget` 保留为兼容死代码 |
| 2 | `core.js` `drive`（L1454） | think 延迟写死 800~2500/800~1500 | 换 `DIFFICULTY.thinkDelay/respDelay/gapDelay/hesitateDelay`（人形化统一入口） |
| 3 | `core.js` `attackPlayer` L819–820/L830 | AI 目标**无条件自动出闪**、主公帮手取 `helpers[0]` | 改调 `chooseResponse('dodge')`（阈值/溢出/EV 出闪；主公自闪或选信念最优帮手护驾；忠臣替主公代出闪） |
| 4 | `core.js` `attackPlayer` L795–806 | AI 被攻者随机转嫁、`battle.aiBetrayConsent`（hp>dmg） | 转嫁目标/同意改调 `chooseResponse`（betrayAvail/betrayConsent） |
| 5 | `battle.js` `resolveHit` L212–218 | AI 攻击者冷数据**自动改弃牌** | 改调 `chooseResponse('cold')`（血厚/护盾未消耗才拆牌） |
| 6 | `battle.js` `afterDodge` L152–168 | AI 自动追刀/平衡树 | 改调 `chooseResponse('chase'/'bbst')` |
| 7 | `tricks.js` `tryCounter` L62 / `counterChain` L41 / `tryCounterOther` L84 | AI **无条件出特判** | 改调 `chooseResponse('counter')`（有害锦囊+保留清单+链层奇偶语义） |
| 8 | `tricks.js` `aoeApplyOne` L408–424 | AI 有攻击/WA 必响应 | 改调 `chooseResponse('aoeResp')` |
| 9 | `tricks.js` `argueApplyOne` L505–513 | AI 50% 弃牌 | 改调 `chooseResponse('argueResp')`（有垃圾牌才弃） |
| 10 | `tricks.js` `harvestStep` L602 | AI 恒取第一张 | 改调 `chooseResponse('harvest')`（按身份需求选） |
| 11 | `tricks.js` `doTrickCore` `funReport` L346 | AI 随机弃目标一张 | 改调 `chooseResponse('report')`（弃价值最高） |
| 12 | `core.js` `endTurn` L435 | AI 进化恒取首个候选 | （可选）按 `scoreCard` 价值择优进化 |
| 13 | `tricks.js` `doTrickCore` `duel` L361–371 | AI 对拍无条件交攻击 | （可选）按 `keepValue(attack)` 阈值决定是否交牌 |

**接线注意（重要）**：
1. `chooseAction` 每步返回**一个**描述符，P3b 循环须带迭代上限（沿用旧 `aiTurn` guard 60）；攻击人类目标时引擎会产生挂起提示 → 循环须在 `hasBlockingPrompt(g)` 时退出，由 `drive` 交 `onPrompt`（与 p2a 契约一致）。
2. `applyAction` 直接转发引擎返回 `{ok, why, result}`；P3b 若遇 `ok:false` 应记日志并跳过该描述符（自测 S5/S8 已证当前条件下零非法，但人类目标/多槽时序变化时建议保留兜底）。
3. **引擎已知怪癖（供 P3b 知悉，非本模块缺陷）**：神犇碾压路径（core.js L871–882）在 `extra≤0` 时不扣基础费用（碾压攻击"免费"）——本模块按 `mp ≥ effectiveCost('attack')` 保守门控，不影响合法性；若 P4 修此怪癖，门控仍正确。
4. 本模块读身份字段仅限主公（公开）；其余一律经 `identityBelief`。P3b 请勿在接线处泄漏 `p.identity` 给决策层。
5. 浏览器双用：P3b 在 index.html 按 `data/* → engine/* → ai/difficulty → ai/scorer → ai/identity-policy → ai/heuristics` 顺序追加 4 个脚本即可；`game.js` 的 KEYS 断言不受影响（不新增聚合导出键）。

---

## 五、验证记录

```
node --check src\ai\difficulty.js / scorer.js / identity-policy.js / heuristics.js / self-test.js  → 5/5 通过
node src\ai\self-test.js  → 62/62 全绿
18 局冒烟(6种子×3难度, heuristics 驱动整局) → 18/18 终局, 零非法动作
node test.js 引擎回归 → A 40/40、B 5/5、C 6/6 全绿(引擎零改动得到复核确认)
```

## 六、给后续阶段的备注

- **P3-6 平衡调参**：`scorer` 顶部 `HP_W/CARD_W/MP_W`、`BASE` 静态表与 `difficulty` 三档参数是调参入口；自测 S3 的"明显更优目标"断言保证调参不破坏基本直觉；ai-stats 建议直接 require `game.js + src/ai/heuristics.js` 以 `{difficulty, rnd:g.rnd}` 驱动（种子确定）。
- 已知小样本胜率（6 种子冒烟）：反贼 8/18、主公方 7/18、内奸 3/18——样本极小仅作烟囱检验；是否贴近 requirement 20.3 目标（33/60/7）由 P3-6 的 500+ 局统计定论。
- 身份信念仅用日志文本与公开计数器，`g.log` 越长扫描成本越高（每决策 O(日志长度×相关行)），当前量级（<万行）无压力；若日后性能敏感可在 P4 加增量证据缓存。
