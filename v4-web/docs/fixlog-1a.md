# Fix-1a 修复日志（v4-web/game.js 引擎）

- 修复代理：Fix-1a
- 日期：2025-06（会话内）
- 范围：仅 `v4-web/game.js`（未触碰 index.html / test.js）；另按要求清理 `requirement.txt` 两处悬空引用
- 输入：`docs/recon-03-审计A-牌堆卡牌.md`、`docs/recon-04-审计B-规则逻辑.md`、`requirement.txt`
- 结论：9 项任务全部完成；新增 2 项修复过程中发现的连带问题（进化取回崩溃防御、清空回收站 case 标签）；`node --check` 通过；测试 **A 39/40、B 5/5、C 6/6**（A 的 1 处偏差为测试自身容差启发式，详见文末"测试结论与偏差说明"）

---

## 1. 【H-1】判定牌置回牌堆底（req 11.2 + FAQ#9）

- 需求：判定牌结算后**置回牌堆底**（不进弃牌堆），全场公开可追踪。
- 问题：`draw()` 用 `g.deck.pop()`（数组尾=牌堆顶），原代码 `g.deck.push(c)` 把判定牌放回**牌堆顶**，与需求完全反向。
- 改动：`judgeCard`（game.js L488–501，关键行 L499）：`push` → `unshift`，即判定牌插到数组头=牌堆底；同步更新注释。
- 复核：grep 全部 `judgeCard` 调用点（judgePhase、loseHp 的记忆化搜索/玄学/回忆、attackPlayer 随机评测机、resolveDodge 玄学判题、aoeApplyOne 玄学判题）只读 `card.suit`，无任何代码依赖旧位置；`peek`/`uPeek`/`chao`/`harvest` 均以数组尾为顶，不受影响。
- 验证：手工脚本确认判定后 `deck[0]` 即为判定牌（原 `[1,2,3]` → pop 3 → `[3,1,2]`）。

## 2. 【H-2】checkAwaken 重复 case（req 第十三章觉醒列）

- 需求：打表狂魔=手牌上限+1；学长=讲题时你同摸1；爆零=爆零伤害+1；图灵=摸2。
- 问题：`case 'dabiao'` 出现两次（第二个为死代码），且 xuezhang/baoling/tuling/dabiao 被合并执行 `draw(g,pid,2)`：打表狂魔上限+1 永不生效、学长白拿摸2、`baolingBonus` 从未置 1（爆零觉醒伤害+1 失效）。
- 改动：`checkAwaken` switch（game.js L768–775）拆分为四个独立 case：
  - `xuezhang` → `p.teachBonus = true`（讲题同摸1）
  - `baoling` → `p.baolingBonus = 1`（爆零伤害+1，L2156 技能读取生效）
  - `tuling` → `draw(g, pid, 2)`（摸2，行为不变）
  - `dabiao` → `p.handLimitBonus += 1`（手牌上限+1，discardPhase/publicView 读取生效）
- 联动：`skillUse` teach 分支（game.js L2112）改读 `p.teachBonus`（与 `p.awaken` 等价但语义精确）。
- 验证：手工脚本逐职业验证四个觉醒效果均正确落地。

## 3. 【H-3】publicView 暴露 pending 的 srcId/dmg（UI 契约）

- 需求（任务书契约）：`view.pending.srcId`（发起询问的 pid，attack/counter/aoe 等）与 `view.pending.dmg`（伤害值）必须存在；只在底层 `g.pending` 具有时附加，原有字段不动。
- 改动：新增内部函数 `pendingView(pd)`（game.js L1686–1698），在原有 type/target/attacker/victim/trickKey/helpers/ctx 基础上，`pd.srcId !== undefined` 时附加 `srcId`、`pd.dmg !== undefined` 时附加 `dmg`；`publicView` 的 pending 字段改用它（约 L1703）。未新增导出键（module.exports 保持 54 键）。
- 验证：argueResp / betrayConsent / counter / aoeResp / dodge 等 pending 均能正确暴露 srcId/dmg（dodge 类 pending 自带 dmg）；无 pending 时仍返回 null。

## 4. 【A-M1】祖安对线：双目标 + 各自选择（req 18.3 L624）

- 需求：`指定 2 名玩家：各弃 1 张，或互受 1 伤（各自选）`。实现解读（与 recon-03 建议一致）：使用者指定 2 名不同玩家；每名目标**各自选择**弃 1 张手牌或受 1 伤。
- 改动：
  - `playCard` 签名扩展第 5 参 `targetId2`（向后兼容）；`case 'funArgue'`（game.js L1595–1604）要求两名不同目标，打出后进入 `argueStep`。
  - 新增内部流程 `argueStep`（L1229）/`argueApplyOne`（L1254）：按顺序结算两名目标；每名目标先经 `tryCounter` 特判（可反制，挂起由 respondCounter 经 `ctx.type==='argue'` 继续，L1063–1073），再做自选：AI 目标引擎随机选（有手牌 50% 弃 1 / 否则受 1 伤）；人类目标挂起 `argueResp` pending（victim/srcId/trickKey/dmg），经 **respondAoeResp**（L1270 起，扩展接受 `argueResp` 类型）作答——yes=弃 1 张随机手牌，no=受 1 伤，答完自动继续下一目标。
  - `doTrickCore` 的 funArgue 单段结算（特判放弃兜底路径，L1139）同步改为自选逻辑；卡面 desc 更新为「指定2名玩家:各弃1张或互受1伤(各自选)」。
  - AI 出牌（aiTurn 步骤5，约 L1810–1824）：祖安对线挑选两名**互不相同**的 AI 目标（人类目标的选择需 UI 挂起，AI 不指向人类）。
- 验证：手工脚本覆盖双目标打出、人类目标 argueResp 挂起与作答（受1伤/弃1张）、特判挂起→放弃→自选、pending 清理；全部通过。

## 5. 【A-M2】进化表补缺：主席树守卫 / 清空回收站（req 15.2 L574–575）

- 需求：`线段树守卫→主席树守卫｜该单位挡下攻击｜守擂且被消灭时你摸 1`；`删库→清空回收站｜消灭一个单位｜消灭单位后摸 1`。
- 改动：
  - CARDS 新增两张进化牌（L97–98）：`uGuardEvo`（主席树守卫，unit/guard，desc 注明进化效果）、`killUnitEvo`（清空回收站，trick）；两者均不在 DECK_COUNT（120 张不变）。
  - `EVO_MAP` 增加 `uGuard:'uGuardEvo'`、`killUnit:'killUnitEvo'`（L103）。
  - `queueEvo(g,pid,key,cardId)`（L717）：新增可选 cardId，记录触发卡真实牌 id 到 `g.evoSrcCards`——因为这两张触发卡进化时在弃牌堆（守擂被消灭的守卫 / 已使用的删库），回合结束进化需**从弃牌堆取回改名加入手牌**（req 15.1「加入手牌」）。
  - `tryEvolve`（L728）：手牌优先（与其他进化一致）；守卫/删库在手牌无同名牌时按记录 id 从弃牌堆取回，改名、`evoTotal++`、日志。守恒：同一张真实牌只移动位置，不增不删。
  - 触发点1（attackPlayer 守擂分支，L810–818）：基础守卫挡下攻击被消灭时 `queueEvo(target.id,'uGuard',guard.id)`（克隆体 id=-1 不触发）；**进化后**守卫再守擂被消灭时 `draw(target.id,1)` 摸 1。
  - 触发点2（playCard killUnit，L1511–1523）：`case 'killUnit': case 'killUnitEvo':`；基础删库消灭单位后 `queueEvo(pid,'killUnit',c.id)`；进化牌消灭单位后 `draw(pid,1)` 摸 1。
- 验证：手工脚本走通 守卫挡刀→回合结束进化（从弃牌堆取回）→再部署→再挡刀摸 1；删库→进化→清空回收站消灭单位摸 1（净手牌 0 = 用1摸1）；evoWait 视图经既有 EVO_MAP 映射自动兼容新键。

## 6. 【A-L】防火墙描述补「受伤+1」（req 9.3 L414 / 17 章 L601）

- 改动：`aFw` desc（L76）：`免疫AOE伤害(暴力评测机事件期间失效)` → `免疫AOE伤害(暴力评测机事件期间失效且受伤+1)`。
- 说明：本项仅补卡面描述（任务书要求）；club 事件对 AOE 伤害的实际 +1 结算属 recon-04 M-4 事件结算项，不在本修复清单。

## 7. 【A-L】MLE 悬空引用清理（req 7.2 L301 / FAQ L640）

- 背景：grep 确认 game.js 全文无任何 `MLE/mle` 引用；悬空引用只存在于 requirement.txt 两处正文。按任务书决策：**不新增卡牌**（120 张牌堆为准），删除引用。
- 改动（requirement.txt）：
  - L301：`手牌上限固定 5，与体力无关（图灵奖得主被动 +1 → 6；【MLE】锦囊当回合 -2）。` → `手牌上限固定 5，与体力无关（图灵奖得主被动 +1 → 6；奠基再 +2）。`
  - L640：`10. 手牌上限？固定 5，与体力无关；MLE 当回合 -2。` → `10. 手牌上限？固定 5，与体力无关；图灵奖得主被动 +1、奠基再 +2。`
- 说明：未用「最近的已定义牌」替换，因为没有规则严格需要一张"-2 手牌上限"牌（手牌上限规则在图灵被动/奠基/打表觉醒下自洽），按任务书"否则删除引用"处理。DECK_COUNT 保持 120。

## 8. 【A-L】卖队友需新目标同意（req 18.3 L618）

- 需求：被攻击时可将攻击转给一名其他玩家（**需其同意**；一局一次）。
- 改动（三处协同）：
  - `attackPlayer` 卖队友自动分支（L833–859）：AI 被攻击者随机选转嫁目标；若目标是**人类**，挂起同意询问 pending（type:'dodge' + `ctx.betrayConsent:true` + betrayer + srcId/dmg），由 UI 经 **respondDodge** 作答；若目标是 AI，走引擎侧同意判定 `aiBetrayConsent`（L1957：新目标受该伤害后仍存活则同意，否则拒绝）——拒绝则不消耗牌、攻击继续对原目标结算，同意则转嫁。
  - `respondBetray`（L1963–1990）：人类被攻击者主动转嫁——AI 新目标走引擎同意判定；人类新目标挂起同一同意询问（牌暂不消耗，拒绝退回）。
  - `respondDodge`（L1872–1895）：识别 `ctx.betrayConsent` 同意询问：yes=消耗卖队友牌、攻击转给新目标（其后续 WA 响应照常挂起）；no=攻击落回原目标继续结算、牌保留。
- UI 契约：同意询问经 `publicView().pending` 以 `type:'dodge'` + `ctx.betrayConsent` + `srcId`/`dmg` 呈现，用现有 `respondDodge(g,pid,yes)` 作答（未新增导出键）。B 套件的 pending 解析器（respondDodge(g,0,true)）天然驱动该询问，故 B 不需改动即保持绿色。
- 保底轨 desc 同步修正（L49）：`保底:本回合受伤-1` → `保底:本回合首次受伤-1`（与 req 18.3 措辞一致；保底逻辑原本就是"首次"）。
- 验证：手工脚本覆盖「AI 转嫁→人类挂起同意→拒绝（攻击落回原目标、牌不消耗）/同意（转嫁成功、牌入弃牌堆）」；C2（既有卖队友转嫁单测）不受影响。

## 9. 【死代码】discardPhase 的 g.discardChoice 未定义引用（~L420）

- 问题：`g.discardChoice` 全文件从未定义（recon-01 亦标注为死引用）。
- 改动：`discardPhase`（L419–425）删除死引用，改为引擎兜底弃第 1 张并注释说明「弃牌自选由 UI 通过 discardCards API 预弃置」；行为与原兜底路径（三元恒取 0）完全一致，无行为变化。

## 附带修复（修复过程中发现并处理）

1. **tryEvolve 弃牌堆取回崩溃**：B 套件（seed 102，Math.random 非确定）偶发 `Cannot read properties of undefined (reading 'id')`——引擎存在既有"幻影 undefined"在 牌堆/弃牌堆/手牌 间传播的隐患（经 Proxy 逐层定位到 `discardFromHand` 把空洞元素推入弃牌堆）。防御三处：
   - `tryEvolve` 取回查询改为 `findIndex(c => c && c.id === srcId)`（L744）；
   - `discardFromHand` 推入前判真（L315，幻影不入弃牌堆）；
   - `draw` 摸牌入手指判真（L305，幻影不入弃牌堆）；祖安对线两处弃牌同步加判真（L1266/L1287）。
   修复后 B 套件连跑 5 轮全部 5/5。
2. **清空回收站无法打出**：进化牌 key 为 `killUnitEvo`，原 `case 'killUnit'` 标签未覆盖，落入 default「未实现的卡牌」。已改为 `case 'killUnit': case 'killUnitEvo':`（L1511）。

## 约束核对

- DECK_COUNT 合计 = 120，未增删任何入牌堆牌种；假牌 id=-1 排除逻辑未动。
- module.exports 保持 54 键（`Object.keys(API).length === 54` 实测），新增函数均为内部函数。
- Node（CommonJS）+ 浏览器双兼容（IIFE + `module.exports`/`root.OIKill` 结构未动）；未使用对象展开等新语法。
- 未触碰 index.html 与 test.js。

## 测试结论与偏差说明

- `node --check game.js`：通过。
- 最终 `node test.js`（v4-web 目录）：
  - **A：39/40**（唯一失败：seed=29，`hand-limit` 断言，见下）
  - **B：5/5**（连跑 5 轮稳定）
  - **C：6/6**
- **A seed=29 偏差的精确诊断（非守恒/逻辑 bug）**：断言为测试自身的容差启发式——回合开始时手牌 `> 上限+5`。现场：退役选手（tuiyi）回合开始手牌 11 = 弃牌阶段正确压到 5 之后，回合间合法累积 +2（玄学优化/锦囊）+2（觉醒「回2血摸2」，req 第十三章）+2（挣扎锁定技）= **11 > 5+5**。三项全部是需求规定的效果；测试注释自己假设"觉醒+1"（对应萌新），未覆盖 tuiyi 觉醒 +2 的组合，故合法状态越过容差 1 张。该选手当回合弃牌阶段仍正确压回 ≤5（`hand-limit-post` 断言未触发），120 张守恒断言在全部 40 局通过。
- **轨迹敏感性的实验证据**：将 H-1 临时还原为 push（其余修复保留）后 A 套件仍是 39/40——失败转移到 seed=11，且是完全相同的 tuiyi「5+2+2+2=11」模式。说明该容差断言对 RNG 轨迹敏感，任何改变牌序/随机消耗的修复（H-1、H-2、进化、祖安对线等均为任务书强制项）都会使某个种子越过该启发式阈值。这不是可由引擎侧合法消除的回归：消除它只能违反需求（削减觉醒/挣扎/玄学优化的摸牌）或放宽 test.js 的容差（test.js 为禁区）。若上级要求严格 40/40，唯一合规出路是把 test.js L144 的 `lim + 5` 容差上调 1（或按职业区分觉醒摸牌量），需要上级裁定。

## 最终结果行

```
=== 汇总: A通过=39/40 (不含120守恒=39/40) | B通过=5/5 | C通过=6/6 | 耗时=0.1s ===
```
