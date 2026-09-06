# P6a UI 对齐报告（v4-web/index.html）

> 任务：按 `docs/recon-07-UI标准v2.md`（提取自 `ui-design.html`）对 `v4-web/index.html` 做**纯视觉/CSS/布局对齐**。
> 唯一改动文件：`D:\projects\oi-kill\v4-web\index.html`。未读/未改 `src\`（引擎重构中），内联脚本的引擎调用（`O.*`）一行未动。
> 验证方式：`node --check` + grep 证据（未运行 test.js，不宣称视觉截图验证）。
> 备注：ui-design.html 实测为 **UTF-8 编码**（前 200 字节严格 UTF-8 解码成功，非任务描述所称 GBK）；仍按指令走 PowerShell 转写临时 UTF-8 文件读取，临时文件已删除。

---

## 1. 主题 token 对齐（CSS 行 8–42）

- `:root`（行 8–25）与 `body.dark`（行 26–42）已与 recon-07 §1.2 表逐项对齐，并补齐原缺失 token：
  `--glow`、`--warn-bg`、`--seat-front-line`、`--halo`、`--switch-on-bg`、`--switch-on-line`、`--switch-on-tx`。
- 新增 `--flash-red/--flash-blue/--flash-green`（落实改进建议 #6）：受击/格挡/治疗光晕 keyframes 改用该 token，黑主题下光晕色与主题联动。
- 既有命名（`--unit-bg/--unit-line`、`--judge-bg/--judge-line`、`.unit-chip/.judge-chip/.eq`）全部保留，现有规则不受影响。
- **对比度红线（改进 #14）**：白主题 `--faint` `#7d8894`→`#6a7684`（on #fff ≈ 4.6:1），黑主题 `#5a6574`→`#7a8696`（on #10151c ≈ 5.0:1），均达 WCAG AA 4.5:1。其余值严格等于标准表。
- 双主题变量名一一对应校验（PowerShell 比对）：root 42 个、dark 41 个，唯一差集为 `--mono`——标准明确其不随主题变化，符合规格。

## 2. 缩放四档 #scaler

- CSS 行 46：`#scaler{position:relative;width:100vw;height:100vh;transform-origin:0 0}` 已是标准 §2 的 transform-origin 策略（先按 1/v 排版再 scale，净占用恒为 100vw×100vh，**1.3 档结构上不会溢出视口**；`body` `overflow:hidden` + `.table-wrap/.seats-area` `overflow:auto` 兜底）。
- JS 行 300–313：四档显式化 `const SCALES = [0.85, 1, 1.15, 1.3]`（小/标准/大/特大），循环顺序与原先「0.85→1→1.15→1.3」完全一致；`applyScale` 内部逻辑（100/v + scale(v)）未变，🔍 缩放按钮照常工作。

## 3. z-index 层级栈（标准 §4）

标准栈：300 弹窗 > 290 提示 > 210 伤害浮字 > 205 特效 > 200 飞行卡 > 6 选中卡 > 5 悬停卡 > 默认。

| 层 | 值 | 元素 | 行号 | 状态 |
|---|---|---|---|---|
| 弹窗 | 300 | `.modal-mask`（含所有 prompt 弹窗/图鉴/成就/胜利结算） | 153 | 已有 ✓ |
| 提示 | 290 | `.tip` | 165 | 已有 ✓ |
| 提示 | 290 | `.toast`（**原 400 违禁，已降为 290**） | 186 | 修复 ✓ |
| 伤害浮字 | 210 | `.dmg-float` | 176 | 新增 ✓ |
| 特效 | 205 | `.spark`、`.suit-bounce` | 180、182 | 新增 ✓ |
| 飞行卡 | 200 | `.card.flying` | 175 | 新增 ✓ |
| 选中卡 | 6 | `.card.selected`、`.card.discard-sel` | 128、130 | 已有 ✓（弃牌选中态补 z-index:6） |
| 悬停卡 | 5 | `.card:hover` | 127 | 已有 ✓ |

- 环形倒计时 `.timer-ring .tt` 的 `z-index:1`（行 171）为环内部局部堆叠（父级 relative），不入全局栈，保留。
- 全文件无 >300 的大数值（如 9999）残留（grep 校验通过）。
- 胜利结算复用 `.modal-mask`(300) + 新增 `#table-title.game-over` 横幅动画（行 159–160、JS 行 432–433 仅挂类）。

## 4. 动画补齐（标准 §5 的 24 项表）

新增 keyframes 共 17 个，全部「定义 1 处 + animation 引用 ≥1 处」配对通过（grep 校验见 §6）。

| keyframes | 定义行 | 作用规则 | 触发点现状 |
|---|---|---|---|
| `seatHit` | 94 | `.seat.hit`（组合 flashRed） | CSS 就绪；内联 JS 暂无 flashSeat 调用（引擎阶段接线，不加新 JS） |
| `flashRed` | 95 | `.seat.hit` | 同上（token 化，改进#6） |
| `flashBlue` | 96 | `.seat.blocked` | 同上 |
| `flashGreen` | 97 | `.seat.heal` | 同上 |
| `unitDie` | 116 | `.unit-chip.die` | 同上（保留既有 .unit-chip 类名） |
| `judgeFlip` | 119 | `.judge-chip.pop`（3D 翻牌） | CSS 就绪；翻牌触发点当前不存在，预留 .pop 钩子 |
| `cardShake` | 132 | `.card.shake` | CSS 就绪；现有 JS 无咖啡/无效出牌抖卡触发 |
| `logIn` | 148 | `.log-item:last-child` | **已接入**：logToHtml 每次整体重建整列，故只对最新一条播放入场，避免整列每帧重放 |
| `bannerIn` | 76 | `.event-banner` | 已接入（挂载即播；文本更新不重播，同标准已知局限） |
| `maskIn` | 155 | `.modal-mask.show` | 已接入：所有弹窗（含图鉴/成就/胜利）开合触发 |
| `modalIn` | 156 | `.modal-mask.show .modal` | 已接入：弹窗入场 pop |
| `achPop` | 158 | `.ach-pop` | 已接入：showAchievements 行 1189 结果容器加类 |
| `victoryIn` | 160 | `#table-title.game-over` | 已接入：render() 行 433 按 v.over 切换类 |
| `floatUp` | 178 | `.dmg-float`(+.heal/.mp) | CSS 就绪；现有 JS 无 floatText 调用 |
| `sparkle` | 180 | `.spark` | CSS 就绪；现有 JS 无 sparkles 调用 |
| `suitBounce` | 182 | `.suit-bounce` | CSS 就绪；现有 JS 无判定翻牌演示调用 |
| `toastIn` | 187 | `.toast` | **已接入**：现有 toast() 显示/隐藏切换即重播 |

- 已有未动的动画：`targ`(89)、`pulse`(121)、`ringPulse`(172)、卡牌 hover 抬升+辉光(127)、selected(128)、座位 .2s 过渡(85)、单位 .4s 过渡(114)、body 主题渐变(45)、btn/switch 过渡(50–53, 65–66)。
- 新增交互反馈：`.btn:hover` 蓝边+`--glow`、`.btn:active` scale(.97)、`.btn.primary`、`.switch span:hover`、`.card.playable`。
- 动效降级：`body.reduced *{animation/transition .01s!important}`（行 183）已落地；当前 UI 无「减少动态」开关（后续阶段接线）。
- 标准中的 `spin`（旧圆环 spinner）未移植：现实现已用 conic-gradient 环形倒计时（行 168–172）替代，属等价演进，非缺失。

## 5. 布局与响应式地基（标准 §3，不含大厅页）

- safe-center 双写补齐：`.table-wrap`(78)、`.seats-area`(82)、`.seat-grid`(83)、`.hand`(125) 均改为 `center` + `safe center` 回退双写。
- `.game-top` 补 `overflow-x:auto`（74）；`.seats-area` 补 `overflow:auto`、gap 对齐 10px（82）；滚动条对齐标准 8px/4px（47）；`body` 补 `user-select:none`（45）。
- 桌面布局保持不变：`.game-body` 1fr+270px 日志栏、stage 640–1240、min-height:660（stage 安全最小高度，table-wrap auto 兜底横滚）。
- 响应式（行 187–203，不建大厅页）：
  - ≤1024px：日志栏 270→220px（改进 #13 落地）。
  - ≤820px：`.game-body` 单列（table-wrap 上、日志栏下并限高 170px）；stage 去掉 640/660 最小尺寸；**`.seat-grid` 转横排 nowrap + overflow-x:auto → 座位区变成顶部横向滚动手牌式条带**；`.player-zone` 单列（手牌行 + 操作行），手牌区保留 `overflow-x:auto`/`scrollbar-width:thin` 持续可用；`.hand` 窄屏改左对齐避免居中裁切。

## 6. 验证证据

1. **node --check**：PowerShell 正则提取 `<script>…</script>` 内联块（43,330 字符）→ UTF-8 临时文件 → `node --check` → **exit code 0**（Node v24.18.1）。临时文件已删除。
2. **grep 证据**：
   - z-index 栈值全部出现：5(127)、6(128/130)、200(175)、205(180/182)、210(176)、290(165/186)、300(153)；无 >300 违禁值。
   - 缩放四档：行 301 `const SCALES = [0.85, 1, 1.15, 1.3]`。
   - 20 个 @keyframes（含既有 3 个）逐一 def=1 且 animation 引用 ≥1，全部 OK。
3. **token 奇偶校验**：`:root` 42 变量 / `body.dark` 41 变量，差集仅 `--mono`（标准注明不随主题）。

## 7. 对齐明细表（标准条目 → 状态）

| 标准条目 | 状态 | 说明 |
|---|---|---|
| §1.1/1.2 双主题 token 全套 | ✅ 已实现 | 补齐 7 个缺失 token + flash 三件套；faint 提对比度（唯一偏离标准数值处，理由=AA 红线+改进#14） |
| §1.3 双主题变量名一一对应 | ✅ 已实现 | PowerShell 差集仅 --mono（规格允许） |
| §2 四档缩放 0.85/1/1.15/1.3 | ✅ 已实现 | 原先循环逻辑等价，已显式化为 SCALES 数组 |
| §3.3/3.4 safe-center 双写 + overflow 策略 | ✅ 已实现 | 5 处双写补齐；各容器 overflow 对齐 |
| §3.5 <640 窄屏横滚 | ✅ 已实现 | 桌面保留 min-width 640 + table-wrap auto；≤820px 另有横排方案 |
| §4 z-index 栈 | ✅ 已实现 | toast 400→290 修复；其余新增层按表落位 |
| §5 动画 24 项 | ⚠️ 大部分实现 | 17 个 keyframes 补齐并配对引用；其中已接现有触发点的 6 个（logIn/bannerIn/maskIn/modalIn/achPop/victoryIn/toastIn），其余为 CSS 就绪、JS 触发点待引擎阶段（内联脚本无 flashSeat/floatText/飞卡/判定翻牌调用，本任务禁止新增 JS 功能） |
| §5 spin 转圈 | 🔀 等价替代 | conic-gradient 环形倒计时已有（L 功能），不移植旧 spinner |
| §5 body.reduced | ✅ CSS 已落地 | 无开关触发点（后续阶段） |
| §6 音效 | ⏭ 不适用 | 不在本任务范围（视觉对齐） |
| §7 命名双轨 | ✅ 已保护 | 未改动；命名切换/日志映射逻辑原样 |
| §8 计时器 45s/10s 警示态 | ✅ 已保护 | timer-ring/ringPulse/低秒变红逻辑原样，未动 |
| §9 弹窗 | ✅ 已保护 | prompt/harvest/卖队友/进化等全部原样；仅加 mask/modal 入场动画 |
| §10 图鉴/教学/成就/胜负 | ✅ 已保护 | 图鉴/教学模式逻辑未动；成就与胜负加 pop 动画（纯类挂接） |
| §11.2 对比度 | ✅ 已修复 | faint 两主题均 ≥4.5:1 |
| §11.3 hover/active 反馈 | ✅ 已实现 | btn/switch/card hover 补齐 glow 与按压缩放 |
| §12 #4 命名双轨覆盖不全 | ⏭ 延期 | 属文案层，超出本轮视觉范围 |
| §12 #5 音效死代码 | ⏭ 延期 | 音效不在范围 |
| §12 #7 无障碍（focus-visible/aria） | ⏭ 延期 | 属交互语义层，后续阶段 |
| §12 #8 tip 不随缩放 | ⏭ 延期 | 需 JS 换算，本任务禁改功能 |
| §12 #9 fx 特效档 | ⏭ 延期 | 需接线 sparkles/飞卡开关 |
| §12 #11 魔法数字 | ⏭ 延期 | 引擎/时序重构期 |
| §12 #13 小屏策略 | ✅ 已实现 | 1024/820 两档断点见 §5 |
| §12 #14 微字号/faint 对比度 | ✅ 部分实现 | faint 已达标；9.5–10px 微字号保留（改动会破坏卡面排版） |

## 8. 功能保护清单（未触碰、未破坏）

- ✅ prompt 弹窗全家族（dodge/counter/cold/bbst/chase/guard/aoeResp/report/**harvest 题解大会**/卖队友/进化选择）
- ✅ 神犇黑牌（碾压当攻击）逻辑、弃牌自选（discardMode/discardSel/toast 失败保留）
- ✅ 命名双轨切换（sw-mode/plain-mode 与日志映射）
- ✅ 环形计时器（45s/10s、≤10s 变红脉动、超时动作）、toast、卡牌图鉴、教学模式、成就结算、胜利弹窗
- ✅ file:// 可玩性：全部为单文件内联 CSS/JS 追加，无新增外部依赖
- ⚠️ 已知观感变化（有意为之，均属对齐项）：日志每条渲染仅最新行有入场动画；所有弹窗开合带 0.2–0.3s 入场；toast 层高从 400 降至 290（仍高于所有战斗反馈层，低于弹窗）

## 9. 附：改动行号速查

| 区段 | 行号 |
|---|---|
| 主题 token（:root / body.dark） | 8–42 |
| 通用组件/反馈（btn/tag/kbd/switch/scrollbar/body） | 43–71 |
| 游戏主界面布局（top/banner/table/stage/seats/halo） | 73–121 |
| 玩家区/卡牌态/单位/判定 | 122–139 |
| 日志 + 弹窗/成就/胜利动画 | 142–163 |
| tip / 计时环 | 164–172 |
| 战斗反馈层（flying/dmg/spark/suit/reduced/toast） | 173–187 |
| 响应式媒体查询 | 187–203 |
| JS：缩放四档 | 300–313 |
| JS：game-over 类挂接 | 431–433 |
| JS：成就容器 ach-pop | 1189 |
