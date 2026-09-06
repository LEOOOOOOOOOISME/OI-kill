# Fix-1c 修复日志（v4-web/game.js 引擎）

- 修复代理：Fix-1c
- 范围：仅 `v4-web/game.js`（未触碰 index.html / test.js / test-extra.js / requirement.txt）
- 输入：`docs/fixlog-1a.md`、`docs/fixlog-1b.md`（已读，未回退任何 1a/1b 修复）、`requirement.txt`
- 结论：3 项缺陷全部修复；`node --check` 通过；定向验证 22/22；测试 **A 40/40、B 5/5、C 6/6（连跑 12 轮，崩溃复现 0 次）**、**E 34/34**

---

## 修复 1【崩溃】划水怪·随缘：摸牌触发题海战术洗回后 splice 取回 undefined

- 需求引用：requirement.txt L522「划水怪 / 摸鱼者 … 随缘(被动)：摸牌阶段可改为摸1+弃牌堆拿1张基本牌」。
- 缺陷：`drawPhase`（game.js L419–441）先按预取的 `bi` 执行 `draw(g,pid,1)`，但 `draw`（L289–307）在牌堆为空时会触发题海战术——弃牌堆整体洗回牌堆并清空；随后 `g.discard.splice(bi,1)[0]` 返回 `undefined`，`spec(got.key).name` 崩溃（B 套件 seed=103 间歇复现）。
- 改动（`drawPhase`，game.js L424–439）：
  1. 摸 1 后先 `if (g.over) return;`（题海战术过载可能终局）；
  2. **重查弃牌堆**（`bi2 = g.discard.findIndex(...)` 后再 splice），保证 `got` 非空才推入手牌；
  3. 弃牌堆已被洗回且无基本牌时**优雅退化**：再从牌堆摸 1 张（合计摸 2，即退回常规摸牌阶段），并记日志。选择"从牌堆补摸第二张"而非"跳过弃牌堆拿牌"的理由：需求措辞是「摸牌阶段**可改为**摸1+弃牌堆拿1张基本牌」——当弃牌堆被洗回、拿基本牌的前提已不存在时，退回默认的摸 2 最贴合"可改为"的可选语义，且不使玩家凭空少摸。
- 守恒：两条路径的牌都来自牌堆（洗回后弃牌堆即牌堆），不创建、不销毁任何牌张；临时脚本断言 `deck+discard+hand` 总量前后相等。
- 验证：临时脚本（已删除）构造「牌堆空+弃牌堆有基本牌」精确复现原崩溃路径——不再崩溃、题海战术正常触发、合计摸 2、牌张守恒；常规路径（牌堆非空）仍摸 1+拿回弃牌堆基本牌。

## 修复 2【不可打出】WC对决（duelEvo）无 playCard case 标签

- 需求引用：requirement.txt L345「对拍 / 决斗 ×3 | 2 | 双方轮流出【做法假了】，先无者受 1 伤。获胜方本牌进化候选【WC对决】」、L570「对拍 → WC对决 | 对拍获胜 | 败者受 2 伤」。
- 缺陷：`playCard` 的锦囊派发只有 `case 'duel'`，`duelEvo` 落入 default「未实现的卡牌」退回手牌；且 `doTrickCore` 内部虽有 `trickKey === 'duelEvo' ? 2 : 1` 的结算代码，但其 case 标签同样只有 `case 'duel'`，实际到不了（死代码）。
- 改动（镜像 fixlog-1a 合并 `killUnitEvo` 的方式）：
  1. `playCard`（game.js L1784）：`case 'duel':` → `case 'duel': case 'duelEvo':`（目标校验/花费/特判询问完全复用 `duel` 路径；`COUNTERABLE` 已含 duelEvo，无需改）；
  2. `doTrickCore`（game.js L1446）：case 标签同步合并，结算走原 M8 轮流攻击逻辑，败者受 `trickKey==='duelEvo' ? 2 : 1` 伤；`queueEvo` 仅 `trickKey==='duel'` 时登记（进化牌不再二次进化，与既有语义一致）；
  3. AI 出牌目标表 `needs`（game.js L2116）加入 `'duelEvo'`，避免 AI 拿进化牌无目标反复尝试。
- 验证：临时脚本——duelEvo 可打出、使用者/目标无攻击时受 2 伤、牌离手入弃牌堆、无目标被拒且退回、基础 duel 仍受 1 伤并登记进化候选（22/22 全过）；test-extra.js E17「WC对决」分支由"记录引擎缺口"自动切换为真实结算断言并通过。

## 修复 3【evaluate】respondDodge 先清 pending 后校验护驾帮手

- 需求引用：requirement.txt L138「主公技【护驾 / 车队带飞】：任何玩家可在主公被攻击时代为主公打出【WA / 闪避】（付 1 灵感）」。
- 缺陷：`respondDodge` 首行 `g.pending = null` 之后才校验帮手（`!h || h.dead || !canDodge(g,h)`）；帮手非法时询问已被清空，UI 无法让玩家重新作答。
- 改动（`respondDodge`，game.js L2177–2218）：把帮手合法性校验**前移**到清 pending 之前（L2180–2187），校验失败直接返回且 pending 保留；通过后再清空 pending 并走 `helperDodge`。同时把原 `pd.ctx && pd.ctx.betrayConsent` 提取为 `isBetray`，并限定仅非转嫁同意询问才做帮手校验——转嫁同意路径的 helperId 语义与改动前完全一致（该路径本就不消费 helperId）。
- 安全性论证：`canDodge` 只读 armor/hand、无副作用，前移无状态风险；`resolveDodge`/`helperDodge` 的调用时点与清 pending 的相对顺序不变。
- 验证：临时脚本——非法帮手被拒且 `g.pending` 保留（type 仍为 dodge）、随后换合法帮手作答成功且 pending 清空、yes/no 无帮手路径回归正常。B 套件仅调用 `respondDodge(g,0,true)`（无 helperId），语义不受影响；test-extra.js E14 场景 B 断言（`ok:false` + why 含"无法代出WA"）继续通过。注意：E14 中 `c.note` 记录的"拒绝时 pending 已被清空"行为备注现已成为过时描述（note 非断言、不影响结果；测试为禁区，未改动）。

---

## 约束核对

- 未触碰 index.html / test.js / test-extra.js / requirement.txt；仅修改 `v4-web/game.js` 4 处（drawPhase、doTrickCore case、playCard case、aiTurn needs、respondDodge）。
- `module.exports` 保持 54 键（实测 `Object.keys(API).length === 54`）；未新增导出键/语法特性。
- 牌堆守恒：随缘退化路径只从牌堆摸牌；duelEvo 打出走 spend→弃牌堆→结算，无牌张增删。
- 未回退 fixlog-1a/1b 的任何修复（随缘分支、题海战术、killUnitEvo 合并、特判体系等均原样保留，仅在其上加固/扩展）。

## 测试结论

- `node --check game.js`：通过。
- 定向验证（临时脚本 tmp-verify-1c.js，验证后已删除）：22/22 断言通过。
- `node test.js`（v4-web 目录）连跑 **12 轮**：每轮均 **A 40/40、B 5/5、C 6/6**；崩溃/异常复现 **0 次 / 12 轮**。
- `node test-extra.js`：**E 34/34，断言失败 0**。

## 最终结果行

```
=== 汇总: A通过=40/40 (不含120守恒=40/40) | B通过=5/5 | C通过=6/6 | 耗时=0.1s ===
=== 汇总: E通过=34/34 | 断言失败=0 ===
```

- B 套件崩溃（seed=103 间歇）复现次数：**0 / 12 轮**（目标：零出现 ✅）。
