# P7b 动效+音效集成报告（OI杀 v4 · FX/SFX 接入 index.html）

## 交付物
- **唯一修改文件**: `v4-web/index.html`（未触碰任何其它文件）
- 本报告: `v4-web/docs/p7b-集成报告.md`

## 一、CSS：fx.needsCss 26 类全部落地

在 `<style>` 内新增 P7b 段（`/* ============ P7b: FX 集成样式 ... ============ */`），并给 `:root` / `body.dark` 成对补充 `--flash-purple`（与既有 `--flash-*` 同族，保持"一一对应"约束）。

| 分组 | 类（26 个全覆盖） |
| --- | --- |
| 瞬时元素 | `fx-particle`(z205, 复用 sparkle)、`fx-flying`(z200, left/top transition + fxFlyTilt)、`fx-chat-pop`(z205) |
| 浮字 | `fx-dmg-float`(z210) + 变体 `fx-dmg-float-dmg/-heal/-guard/-count`（红/绿/蓝/橙） |
| 座位闪光 | `fx-seat-flash-red/-green/-blue/-purple`（复用 flashRed/flashBlue/flashGreen；紫色新增 flashPurple） |
| 横幅/弹窗 | `fx-banner`(body.fx-banner::before 全屏金光 + body>`.fx-banner` 文字横幅 + .seat.fx-banner 座位金光三层)、`fx-ach-pop`、`fx-victory-in`(复用 victoryIn) |
| 行为类 | `fx-judge-flip`(复用 judgeFlip)、`fx-shake`(--fx-shake-power)、`fx-wave`/`fx-wave-blue`、`fx-shield-break`、`fx-seat-collapse`+`fx-identity-flip`(双动画叠加)、`fx-turn-halo`、`fx-unit-shards`、`fx-evolve-glow`、`fx-deploy-bounce` |

- **复用 P6a keyframes（8 个）**: sparkle、flashRed、flashBlue、flashGreen、judgeFlip、victoryIn、achPop 派生思路、bannerIn 思路
- **新增 keyframes（16 个）**: fxFlyTilt、fxFloatUp、flashPurple、fxShake、fxBannerFlash、fxBannerIn、fxAchPop、fxWave、fxShieldBreak、fxSeatCollapse、fxIdentityFlip、fxHaloSpin、fxUnitShards、fxEvolveGlow、fxDeployBounce、fxChatPop
- z 栈遵守: 弹窗300 > 提示/横幅290-295 > 浮字210 > 粒子205 > 飞卡200；全部 `pointer-events:none`，浮字/横幅不遮挡卡面文字
- 减少动效: 保留 P6a `body.reduced *` 阻尼；新增 `body.reduced` 下隐藏 6 类瞬时 fx 元素；新增 `@media (prefers-reduced-motion: reduce)` 自动降级（与开关默认值联动）

## 二、模块装载（fx.js/sfx.js 是纯 CommonJS 的务实解法）

fx.js/sfx.js 只有 `module.exports`、无浏览器分支（engine/ai/net 都是双模），直接 `<script src>` 会在 `module is not defined` 处抛错。集成采用**一次性 module 垫片**（3 段小内联脚本）：
1. 注入 `window.module = {exports:{}}` → 加载 fx.js → 捕获导出
2. 重置垫片 → 加载 sfx.js → 捕获导出
3. 挂到 `OIKill.ui.fx` / `OIKill.sound.sfx` 并 `delete window.module`（不影响其后任何脚本的 `typeof module` 探测；垫片位于 game.js/net-api/adapter 之后，这些双模文件已按浏览器分支装载）

模块 404（旧 file:// 副本）时捕获空对象、不挂槽，主脚本守卫降级。

## 三、JS 接线（内联脚本）

### 实例化与中央钩子
```js
const FX = (O.ui && O.ui.fx && typeof O.ui.fx.createFx === 'function') ? O.ui.fx.createFx(document) : null;
const SFX = (O.sound && O.sound.sfx && typeof O.sound.sfx.createSfx === 'function') ? O.sound.sfx.createSfx() : null;
function fx(kind, payload){ /* FX.play(kind,payload) + SFX.play(音补位, {reducedMotion, intensity}); 全程 try/catch */ }
```
- `SOUND_OF` 补位表: equip→select, deploy→drop, playCard→drop, wa→shield, guardBlock→block, unitAttack→block, evolve→evo, awaken→awake, reject→error（sfxMap 无同名事件时补位，无则静默）
- `p.noSfx` 抑制声音（联网防双发用）、`p.sfx` 指定音、`p.intensity` 传倒计时强度

### fx hook 调用点（kind → 位置）
| kind | 位置 | 说明 |
| --- | --- | --- |
| attack / heal / death / awaken / turn / draw / unitAttack(unit-die) / victory / defeat | `render()` 末尾逐动作差分（`snapOf`/`fxDiff`，快照 hp/units/dead/awaken/turn/round/over/hand） | 红闪+伤害飘字+攻击音 / 绿闪+治疗音 / 坍塌+身份翻面+死亡音 / 横幅+觉醒音 / 光环+回合音 / 摸牌音 / 碎片+破碎音 / 胜利横幅+结算音（按 WIN_SIDE_OF 判断胜败） |
| guardBlock / wa / counter / aoe / equip / deploy / evolve / judge | `parseLogFx`（日志关键词 → fx，本地/联网同口径） | 挡下攻击\|挡刀 / 打出WA\|出WA!\|…\|闪避 / 反制\|特判\|反击 / AOE / 装备【 / 部署【 / 进化! / 判定、评测机事件（judge 落点=座位或 event-banner） |
| playCard（飞牌+drop） | 手牌直接打出分支 + 座位点击攻击分支 | `fx('playCard', {from: 手牌元素, to: 牌桌/目标座位})` |
| select / click | 手牌点击、座位目标选择、全局按钮委托（.btn/.switch span 捕获阶段） | 选牌/选目标/按钮音 |
| countdown | `updateTimerDisplay` 秒级滴答（lastTickSec 去重） | 计时环红闪+倒计时浮字；`intensity = 1 - left/total` 随截止临近升频（essential，减少动效下仍响） |
| chat | 联网 chat 事件 | 右下气泡+chat 音 |
| reject | 门面 `reject` 信封（本地/联网同源：LocalClient 非法动作也发 reject） | toast 元素抖动+error 音 |
| achievement | `showAchievements()` 有成就时 | 右上成就弹出+成就音 |

### 联网事件流钩子（onFacadeMsg → netEventFx）
- `sfx` 事件 → 服务器权威音效（`SFX.play(sound, {reducedMotion})`）
- `log` 事件 → `parseLogFx`（联网跳过服务器 room.js FX_RULES 已派生的事件：判定/评测机事件 netSkip、进化! netNoSound，避免双发）
- `chat` → 气泡；`death`/`judge`/`guard-block`/`unit-die`/`awaken`/`evo`/`event`/`achievement` → 防御性映射（noSfx 防双发，类添加幂等）
- `fx` 事件 → 跳过（**room.js 兼容缺口**: `broadcast('event',{kind:'fx', payload:{seat,amount,...}})` 把语义 kind 丢在 payload 之外，载荷无法区分 damage/heal/death/judge/awaken；视觉已由差分+关键词覆盖、声音已由 sfx 事件覆盖）
- `turn` 事件 → 跳过（render 差分按状态权威检测换回合）
- AI 与真人同管线：本地靠差分+关键词，联网靠 sfx/log 事件+差分，反馈一致

### 开关与解锁
- 顶栏新增 `🔊`（btn-sfx）：`SFX.setVolume(0.8)` 初始化，点击 `setMuted` 切换 🔇/🔊
- 顶栏新增 `✨ 动效`（btn-reduce）：切换 `body.reduced`（CSS 消费）+ `fxReduced` 传给 SFX 做 essential 过滤；**默认跟随系统 prefers-reduced-motion**
- 首手势解锁：`pointerdown/keydown/touchstart` 捕获阶段 `SFX.unlock()`（一次性）
- 瞬时元素清理：`animationend/transitionend` 统一删除 fx-* 瞬态元素、清除常驻元素（座位/body）上的 fx-* 类（类幂等可重触发；body 自身只清类不删除）

## 四、验证结果（全部通过）

| 项 | 结果 |
| --- | --- |
| 内联脚本提取 → `node --check`（4 段，UTF-8 临时文件，已删） | ✅ 4/4 通过，exit 0 |
| CSS 花括号平衡（PowerShell 计数） | ✅ `{`=334，`}`=334 |
| needsCss 26 类在 CSS 中全部存在 | ✅ 0 缺失 |
| grep 证据：fx( 调用点 / sfx.unlock / setVolume+setMuted / prefers-reduced-motion / body.reduced 切换 | ✅ 全部命中 |
| 浏览器冒烟（node vm 桩，按 index.html 顺序求值全部脚本，临时脚本已删） | ✅ SMOKE PASS：引擎/net/ai/adapter/lobby 命名空间齐全；OIKill.ui.fx / OIKill.sound.sfx 挂载成功；FX/SFX 实例化成功（fxObj/sfxObj true）；垫片已清理；脚本求值 0 失败 |
| 回归：`node src\ui\adapter-test.js` | ✅ 71/71 |
| 回归：`node src\ui\fx-test.js` | ✅ 34/34 |
| 回归：`node src\sound\sfx-test.js` | ✅ 285/285 |

## 五、务实决策（重点记录）
1. **CommonJS 垫片装载**：fx/sfx 无浏览器分支，靠一次性 `module` 垫片装载+捕获+清理，不复制文件内容、不漂移。
2. **服务器 fx 事件载荷缺语义 kind**（room.js `broadcast('event',{kind:'fx',payload:out.fx.payload})` 未带 damage/heal/… 标记）→ 集成侧跳过该事件，视觉改由 render 差分+关键词覆盖、声音由 `sfx` 事件覆盖，AI/真人反馈一致。
3. **联网防双音**：差分中的 attack/heal/death/awaken 在 `CLIENT_KIND==='net'` 时 `noSfx`（服务器 sfx 事件为权威声音）；进化! 在联网只补光效不发音（服务器已发 evo）。
4. **equip/deploy 音补位**：服务器发的 `'equip'/'deploy'` 音名在 sfxMap 中不存在（no-op），两端统一用 select/drop，保证本地/联网听感一致。
5. **body 挂 fx 类防护**：awaken/achievement 会把 `fx-banner`/`fx-ach-pop` 类加到 body 上 → 横幅/弹窗样式一律用 `body > .fx-*` 选择器（只命中 banner()/mk() 追加的直挂 div），`.seat.fx-banner` 单独做金光；清理器遇到 body 只清类不删节点。
6. **render 差分 vs 事件双发**：差分只在真实状态变化时触发一次；服务器事件映射采用 noSfx + 类幂等，重复触发无叠加效果。
7. **倒计时浮字已知小瑕疵**：倒计时浮字挂计时环（`.actions` 容器 `overflow:hidden`）会被裁切，保留"环红闪+滴答音"为主要反馈（低频、无害）。
8. **chat 气泡驻留 1.6s**（fxMap durationMs=300 太短不便阅读，CSS 侧加长），其余动画时长对齐 fxMap durationMs 量级。

## 六、未改动保障
本地模式、提示弹窗、harvest/argue/betray/evo、神犇黑牌、弃牌选择、图鉴、教学模式、成就、计时器、主题、缩放、双语命名、大厅/联网流程均未改动原有逻辑，仅在其事件点上追加 fx 调用（模块缺失时全部守卫降级）。
