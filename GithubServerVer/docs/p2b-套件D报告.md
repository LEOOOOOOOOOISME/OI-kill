# P2b 套件 D 多人化测试报告（suite-d）

> 执行代理：P2b（test author）
> 新增文件：`v4-web/suite-d.js`（**唯一新建代码文件**；test.js / test-extra.js / index.html / src\ / game.js 均未改动）
> 本报告：`v4-web/docs/p2b-套件D报告.md`（UTF-8）
> 规格依据：`docs/p2a-多人化报告.md`（多人化新契约）+ recon §F.1 的 suite-d 期望
> 结论：**套件 D 8/8 全绿（178 断言，0 失败，连跑 2 轮稳定）；A/B/C/E 回归全绿。**

---

## 一、产物与范围

| 项 | 内容 |
|---|---|
| 新增文件 | `v4-web/suite-d.js`（约 400 行，自包含：`const O = require('./game.js');` + 轻量断言器 + tc 运行器，风格对齐 test.js / test-extra.js） |
| 改动其它文件 | 无（未触碰 test.js / test-extra.js / index.html / src\ / game.js） |
| 覆盖不变式 | D01..D08 共 8 组（任务清单 1–8 逐条对应） |

## 二、用例覆盖明细（D01..D08）

### D01 多人类创建
- `createGame({humans:[0,2,4], seed})` → `humanSet` 恰含 {0,2,4}、`isHuman(0/2/4)=true`、`isHuman(1/3/5)=false`、`g.human === 0`（首个人类 pid）。
- 兼容路径：`{human:3}` → `{3}`；无参默认 `{0}`；`humans:[null,2,undefined]` 过滤空值 → `{2}`。
- 导出键契约：`Object.keys(O).length === 58`，且 `drive/timeoutPrompt/duePrompts/promptCount` 均为函数（原 54 键 + 新增 4 键）。
- 新局提示层为空：`prompts` 为 Map、`size=0`、`promptCount()=0`、`pending=null`。

### D02 提示多槽位（AOE 2 人类目标并存）
- 构造：6 人局 `humans:[0,2]`，AI pid5 打 `aoeAtk`（`aoeOrder` 自下家起 [0,1,2,3,4]）。
- 断言：`prompts` 并存 2 条 `aoeResp`（pid 0、pid 2），**座次序插入 [0,2]**；每条含 `id/deadlineMs=10000/createdAt`；`g.pending` 别名 === 第一条（pid0）。
- **乱序解析**：先 `respondAoeResp(g,2,false,e2.id)` → 返回 `pending-group`，只移除 pid2 条目，pid0 条目与别名原样保留（不 clobber），仅 pid2 受 1 伤。
- 全部解析后：`prompts` 空、`pending===null`、`promptCount()===0`；AI 受害者按座次序续算各受 1 伤；牌张守恒。

### D03 无泄漏不变量（2 人类 + 4 AI 完整对局）
- `humans:[0,3]` 真实对局（不 strip），judgePhase/drawPhase/aiTurn 驱动至终局（seed 31337：43 步、round 8、winner=反贼）。
- **每个阶段后**：循环用 `timeoutPrompt` 解析全部挂起提示，逐条断言"被解析条目不在 map 中"；随后断言 `prompts.size===0 && promptCount()===0 && pending===null`；每 25 步抽查 120 守恒；所有提示 pid 均须为人类。
- 全程 14 个人类回合、16 次超时解析、**0 泄漏违规**；终局 120 守恒。

### D04 超时语义（timeoutPrompt 默认应答）
| 类型 | 默认 | 断言 |
|---|---|---|
| dodge | 否（不出WA） | 目标受 1 伤、WA 保留在手、不扣灵感、条目移除、守恒 |
| counter | 放弃反制 | 【卡评测机】生效受 1 伤、特判保留、不扣灵感、条目移除、守恒 |
| aoeResp | 否 | 受 1 伤、条目移除、守恒 |
| harvest | **弃权（不选牌）** | 手牌不变、条目移除、守恒（见下方注①） |

### D05 duePrompts 截止时间语义
- dodge 提示 `deadlineMs=10000`；新鲜提示 `duePrompts(g,now)` 为空；拨回 `createdAt`（过期 15s）后返回该条目；`now-createdAt` 恰等于/大于 `deadlineMs` 计入、小于不计入。
- `timeoutPrompt(g,'pd-不存在')` → `{ok:false}`。
- evo 提示 `deadlineMs=45000`；`timeoutPrompt(evo)` → `{ok:true,result:'declined'}`，`evoWait` 清空、牌未进化、条目移除。

### D06 drive 全流程（1 人类 + 5 AI）
- `drive(g,{thinkMs:0,onState,onPrompt,onEvent})` 驱动至终局（seed 707001，round 15，winner 非空）。
- 状态序列以 `{status:'over',winner}` 收尾（含 `human-turn` 与 `prompt` 交错的完整轨迹，`over=true`）；首状态 `human-turn`；无 `cap`。
- 每个 `prompt` 状态携带 `promptId` 且 pid 为人类；超时解析后槽清空、无残留；`onState=60`、`onPrompt=17`、`onEvent=427` 均被调用；终局 `prompts` 空且 **120 守恒**。

### D07 AI 补齐正确性（2 人类 + 4 AI）
- `humans:[0,3]` 6 人局：AI 座次 1/2/4/5 `isHuman=false`，人类座次 0/3 `isHuman=true`，`g.human===0`。
- AI pid1 攻击人类 pid0 挂起 dodge 后，`aiTurn(2)`、`aiTurn(4)` 正常执行（回合照常轮转），**不触碰/不代答人类提示**（条目与 hp 原样）；随后人类以显式 promptId 作答正常结算。

### D08 respondX promptId 精确性
- 双人类 AOE → 两条同型 `aoeResp` 提示（pid0/pid2）。
- 负例：pid 与 promptId 错配、不存在的 promptId → `{ok:false}` 且**不消费任何条目**。
- 正例：显式 `respondAoeResp(g,2,false,e2.id)` 只解析 pid2 条目（pid0 条目与别名原样），仅 pid2 受伤；再解析 pid0 条目后全部清空。

## 三、验证过程

```
node --check suite-d.js   → 通过（无语法错误）
node suite-d.js           → D通过=8/8 | 断言=178 | 断言失败=0   （连跑 2 轮结果一致）
```

首次运行曾出现 2 处失败，排查后均为**本套件自身调用错误**（把 promptId 误置于 `respondDodge` 第 4 参 helperId 位，正确应为第 5 参），修复测试后转绿；引擎无缺陷。

## 四、回归（各跑 1 轮，workdir v4-web）

```
node test.js       : === 汇总: A通过=40/40 (不含120守恒=40/40) | B通过=5/5 | C通过=6/6 ===  (断言失败 0; 牌种审计为已知进化改写噪声)
node test-extra.js : === 汇总: E通过=34/34 | 断言失败=0 ===
```

A/B/C/E 与 P2a 报告的基线完全一致，多人化改造无回归。

## 五、最终汇总行

```
node --check suite-d.js: 通过
node suite-d.js      : === 汇总: D通过=8/8 | 断言=178 | 断言失败=0 ===  (×2 稳定)
node test.js         : === 汇总: A通过=40/40 (不含120守恒=40/40) | B通过=5/5 | C通过=6/6 ===
node test-extra.js   : === 汇总: E通过=34/34 | 断言失败=0 ===
新增: suite-d.js + docs/p2b-套件D报告.md; 其余文件零改动
```

## 六、备注（供主代理 / 门禁代理知悉）

1. **harvest 超时默认与任务简述不一致**：任务清单第 4 项括号写 "harvest (first choice)"，但 P2a 报告（本任务认定的契约）与引擎实现均为 **`respondHarvest(pid,null)` 弃权（不选牌）**。套件 D 按 P2a 契约锁定"弃权"行为并断言通过；若产品意图确为"默认取第一张牌"，属引擎变更项，请门禁代理裁定。
2. **respondDodge 签名陷阱**：`respondDodge(g,pid,yes,helperId,promptId)`——显式 promptId 在**第 5 参**。测试曾误填第 4 参，引擎按 helper 校验拒绝且**提示已被取走**（与 P2a 风险备注 3 记录的行为一致：respondX 先取走提示再校验）。
3. **drive 的 evo 提示**（非阻断型）也会以 `status:'prompt'` 喂给 onPrompt，`timeoutPrompt(evo)` 走"放弃进化"路径正确清理（D06 已覆盖）。
4. **D03/D06 的 120 守恒与无泄漏**在完整对局（含题海战术洗回、阵亡弃置、濒死救援）下逐阶段验证通过，多人化提示层无泄漏。
