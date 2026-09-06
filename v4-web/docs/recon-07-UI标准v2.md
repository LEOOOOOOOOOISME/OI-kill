# UI标准 v2（OI杀 v4.0 界面规范）

> 提取源：`D:\projects\oi-kill\ui-design.html`（共 694 行，约 55KB，单文件 HTML+CSS+JS 演示原型）
> 用途：供后续实现重建/改进 UI 时的完整规范基线。每条目含 **文件位置（行号区间）** 与 **新实现验证方法**。
> 行号以当前文件为准；若原文件变动，请以条目描述的类名/ID 定位。
> 相关规则引擎：响应/判定等 pending 机制在 `v4-web\game.js`（见 §9）。

---

## 1. 主题与色彩 token

### 1.1 定义位置
- 亮色主题（默认「白色极客」）：`:root`，行 **9–24**
- 暗色主题（「评测机深夜」）：`body.dark`，行 **25–40**（通过 `body` 加 `.dark` 类整包覆盖）
- 等宽字体族 `--mono` 单独在第二个 `:root`：行 **59**
- 全局使用方式：`body{background:var(--bg);color:var(--text)}`（43–44），主题切换仅切换 class：`setTheme()` 行 561–566

### 1.2 变量清单（左=白/默认，右=黑/dark）

| 分组 | 变量 | 白主题值（行 9–24） | 黑主题值（行 25–40） |
|---|---|---|---|
| 背景 | `--bg` / `--bg2` | `#f6f8fa` / `#eef1f4` | `#07090c` / `#0b0f14` |
| 面板 | `--panel` / `--panel2` / `--panel3` | `#ffffff` / `#f0f3f6` / `#e6ebf0` | `#10151c` / `#151b24` / `#1a2230` |
| 边框 | `--line` / `--line2` | `#d0d7de` / `#b8c2cd` | `#1e2836` / `#2a3a50` |
| 语义强调 | `--blue` 行动/选中 | `#0969da` | `#5aa7e0` |
| | `--green` 成功/己方/主公 | `#1a7f37` | `#4ec9b0` |
| | `--red` 伤害/危险 | `#cf222e` | `#f44747` |
| | `--orange` 费用/警告/判定 | `#953800` | `#d19a66` |
| | `--purple` 单位/锦囊(TRICK) | `#8250df` | `#c586c0` |
| | `--yellow` 身份/点数/成就分 | `#9a6700` | `#dcdcaa` |
| 文字三级 | `--text` / `--dim` / `--faint` | `#1f2328` / `#57606a` / `#7d8894` | `#d7dde6` / `#8b95a5` / `#5a6574` |
| 阴影/辉光 | `--shadow` | `0 2px 10px rgba(31,35,40,.08)` | `0 4px 18px rgba(0,0,0,.5)` |
| | `--glow`（hover 蓝辉） | `0 2px 12px rgba(9,105,218,.16)` | `0 0 14px rgba(94,176,224,.22)` |
| 状态底 | `--hot-bg`(绿) / `--warn-bg`(橙) / `--bad-bg`(红) / `--front-bg`(蓝) | `#f0faf3` / `#fdf6ec` / `#fdf0f1` / `#eef6ff` | `#0f2b1d` / `#2b2210` / `#2b1214` / `#0e2233` |
| 事件横幅 | `--banner-bg` / `--banner-line` / `--banner-tx` | `#fdf0f1` / `#eec0c4` / `#a8242e` | `rgba(244,71,71,.1)` / `rgba(244,71,71,.4)` / `#e8a0a8` |
| 卡面 | `--card-grad` | `linear-gradient(165deg,#ffffff,#f2f5f8)` | `linear-gradient(160deg,#141b25,#0d1219)` |
| 花色 | `--suit-black` | `#38424d` | `#9fb2c8` |
| 座位/单位 | `--seat-front-line` | `#7ab4e8` | `#3b82c9` |
| | `--unit-bg` / `--unit-line` | `#f6f0fc` / `#c9aee8` | `rgba(197,134,192,.08)` / `#a86fc7` |
| 判定 | `--judge-bg` / `--judge-line` | `#fdf8ec` / `#d8bd7a` | `rgba(209,154,102,.08)` / `#6b4a2a` |
| 桌面 | `--table-bg` | `radial-gradient(ellipse at center,#edf3f9 0%,var(--bg) 72%)` | `radial-gradient(ellipse at center,#0d141c 0%,var(--bg) 72%)` |
| 弹窗遮罩 | `--modal-mask` | `rgba(31,35,40,.35)` | `rgba(4,6,9,.72)` |
| 回合光环 | `--halo` | `rgba(26,127,55,.12)` | `rgba(78,201,176,.2)` |
| 开关选中 | `--switch-on-bg` / `--switch-on-line` / `--switch-on-tx` | `#eef6ff` / `#7ab4e8` / `var(--blue)` | `#12222e` / `#2d6a80` / `var(--green)` |
| 字体 | `--mono`（行 59） | `"Cascadia Code","JetBrains Mono","SF Mono",Consolas,"Courier New",monospace` | 同左（不随主题变化） |

其余硬编码色仅出现在动画关键帧里（flashRed/flashBlue/flashGreen 的 rgba，行 236–241），与 `--red/--blue/--green` 对应但不引用变量——见【改进建议】#6。

### 1.3 验证方法
1. 写自动化测试断言两个主题块中**变量名一一对应**（`body.dark` 不得增删变量名）。
2. 切换主题时整页仅 class 变化、无 JS 改内联色；用 `getComputedStyle` 抽查 `--panel/--text/--card-grad` 生效。
3. 黑白主题各截图对比，确认所有组件（tag/btn/seat/tip/modal）均用 token、无「白底白字」泄漏。

---

## 2. #scaler 缩放机制

### 2.1 定义位置
- CSS：行 **49** `#scaler{position:relative;width:100vw;height:100vh;transform-origin:0 0}`
- DOM：行 **267** `<div id="scaler">` 包裹全部三个 page 与 tip 之外的固定层（tip 在 scaler 外，行 492）
- JS：`applyScale(v)` 行 **682–688**
- 设置项：行 **506**（0.85/1/1.15/1.3 → 小/标准/大/特大），绑定在行 **582**

### 2.2 计算逻辑
```js
s.style.width  = (100/v) + 'vw';   // v=1.3 时布局宽度 = 76.92vw
s.style.height = (100/v) + 'vh';
s.style.transform = `scale(${v})`; // 原点 (0,0)
```
- 核心思路：**先按 1/v 倍视口尺寸排版，再整体 scale(v)**，净占用恒等于 100vw×100vh → 缩放永不溢出视口、无滚动条；v 越大元素视觉越大（「特大」档元素实际占满布局宽度，内部靠 overflow 兜底）。
- **无固定基准分辨率**：以视口为基准的自适应缩放；元素尺寸仍按 CSS px 写死（见 §3）。
- 缩放层外的 `position:fixed` 元素（tip/dmg-float/spark/flying-card/modal）不受 scale 影响，但 JS 一律用 `getBoundingClientRect()`（返回缩放后真实屏幕坐标）定位，故与缩放后 UI 对齐（行 608、622、646、654 等）。

### 2.3 验证方法
1. 四档各测：`document.body.scrollWidth ≤ innerWidth` 且无滚动条；stage 内容仍可操作。
2. v=1.3 时点击手牌→攻击：飞卡终点、伤害浮字必须仍落在目标座位中心（检验坐标换算链路）。
3. 缩放切换后 tip 悬停定位仍正确（tip 本身不缩放，见【改进建议】#8）。

---

## 3. 布局分区（DOM 结构与尺寸约定）

### 3.1 页面框架
- 行 56–57：`.page{display:none}` / `.page.active{display:block}`；`go(id)` 切页（行 516）。
- 三个页面：`#page-login`（270–286）、`#page-lobby`（289–344）、`#page-game`（347–487）。
- `body`：`overflow:hidden; user-select:none; font-size:14px`（46），背景/文字色 transition 0.25s（47）。

### 3.2 登录页（93–108）
- `#page-login`：`height:100%; flex column; justify-content:center;` + `safe center` 回退双写（94）；`gap:24px`；`background:var(--table-bg)`；`overflow-y:auto`。
- `.logo h1`：mono 46px、字距 6px、绿色 + `--halo` 发光（97）。
- `.login-win`：宽 380px（99），`.body` padding 20px 26px、列距 14px（100）。
- `.field label::before{content:"$ "}`（102）；输入框样式行 54–55（focus 蓝边+glow）。

### 3.3 大厅（110–130）
- `#page-lobby`：flex column、`height:100%; overflow:hidden`（111–112）。
- `.topbar`：高 **56px**、padding 0 18px、`overflow-x:auto`（113）。
- `.lobby-body`：`grid-template-columns:minmax(0,1fr) 330px`、gap 16px、padding 18px 20px、`overflow-y:auto`（116）。
- 右栏 `.side`：`position:sticky; top:0`（125）。

### 3.4 游戏主界面（132–487）
- `#page-game`：flex column、`height:100%; min-height:0`（133–134）。
- `.game-top`：高 **54px**、padding 0 16px、mono 12px、`overflow-x:auto`（135）。内含：room-id(蓝) → round(橙) → `.event-banner`(flex:1, 行 138–139) → turn-now(绿) → `.timer`(142–143) → 命名/主题/音效开关 → ⚙。
- `.game-body`：`grid-template-columns:minmax(0,1fr) 272px; grid-template-rows:minmax(0,1fr); overflow:hidden`（145）。**右列 272px = 日志栏**。
- `.table-wrap`：`position:relative; flex; align-items:stretch; justify-content:center;`+`safe center` 双写；`overflow:auto`；`background:var(--table-bg)`（146）。

#### stage 舞台（149–155）
- `.stage`：`flex:1; flex column; min-width:640px; max-width:1240px; padding:14px 18px 14px`（149）。**零绝对定位、flex 分层、零遮挡**（注释行 148）。
- `.seats-area`：`flex:1; column; justify-content:center`+safe 双写；`gap:10px; min-height:0; overflow:auto`（150）。
- `.table-title`（151）：`gap:10px; flex-wrap:wrap`，含牌桌说明与牌堆计数 `#deck-info`（368）。
- `.seat-grid`：`flex:1; column; center`+safe；`gap:14px; min-height:0`（154）。
- `.seat-row`：`flex; justify-content:center; align-items:stretch; gap:14px; flex-wrap:wrap`（155）。

#### 座位 .seat（156–184）
- `.seat`：`flex:0 1 226px; min-width:196px; padding:14px 16px 12px; border-radius:14px; background:var(--panel); border:1px solid var(--line); position:relative; transition:.2s`（159）。
- `.seat.me`：2px 绿边（156）。`.seat.targetable`：2px 蓝虚线 + targ 脉冲（160–161）。
- 内部结构（示例 372–434，6 人局完整：1/3/4 号第一排，2号/你/5号第二排）：
  1. `.seat-top`：座位号 `.seatno` + 身份 `.ident`（168–169，`.ident.hidden` 置灰）
  2. `.head`：头像 `.avatar` 46×46 圆角12（164）+ `.who`（nick 加粗14px 截断 + job 11px 截断）
  3. `.stat`（体力）：`❤` + `.cells`（♥ 逐个着色，`.on` 红 `.off` 灰，行 172–174）+ `.val`（右对齐 `4/4`）
  4. `.stat.mp`（灵感）：`💡` + ● 点阵（`.on` 蓝，行 175–177）
  5. `.chips`：装备 `.eq`（180）/单位 `.unit`（181，紫）/判定 `.judge`（182，橙虚线）
- `.turn-halo`：`position:absolute; inset:-3px`，绿边+`--halo` 光环、pulse 常驻（183–184）——当前回合者座位（示例在 2号，行 405）。

#### 底部玩家区 .player-zone（186–195）
- `.player-zone`：`flex:none; height:208px; grid-template-columns:minmax(0,1fr) 200px; gap:12px; align-items:stretch`（187）。
- 左 `.hand-box`：`overflow-x:auto; overflow-y:hidden; padding-top:12px`（193）；`.hand-note` 手牌计数提示（442）。
- `.hand`：`flex; gap:9px; justify-content:center`+safe 双写；`align-items:flex-end; min-width:max-content`（195）。
- 右 `.my-hud`：面板、radius 10、padding 10px 12px、`gap:6px`（188）；`.btns-col` 纵向按钮列 `overflow-y:auto`（189）；`.track` 进度条 8px 高（192，示例中未用）；`#hint-line` 教学提示（465）。

#### 卡牌 .card（196–211）
- `.card`：**100×142px**、radius 8、`background:var(--card-grad)`、`position:relative`、`flex:none`、padding 0（197）。
- 内部绝对定位：`.cost` 左上（200，橙 mono 12px）、`.suit` 右上（201–202，红/黑花色）、`.cname` top:31px 居中 13px 加粗（203）、`.csub` top:54px 10px faint（204）、`.ctype` bottom:14px 9.5px mono（205，BASIC 蓝 / TRICK 紫 / EQUIP 黄，207）。
- 状态：`.playable` 绿边+halo（206）、`.selected` 抬升（199）、`.shake`（210–211）。
- 示例手牌 8 张（444–451）：做法假了×2、WA、CCF捐款、咖啡、摸鱼、删库、躺赢。

#### 右侧日志 .side-log（219–230）
- 272px 列：`border-left:1px solid var(--line); background:var(--panel); min-width:0`（220）。
- `h3` 标题（221–222）、`.log-body` `flex:1; overflow:auto; padding:12px 14px`（223）、`.log-item` 三种：普通(dim)/`.act`(绿左边条)/`.evt`(橙左边条)/`.bad`(红)（224–229）；`.side-bottom` 按钮行（230：图鉴/弃牌堆）。

### 3.3 safe-center 约定
`justify-content:safe center` 出现于行 94、146、150、154、195，均**双写回退**（先写 `center` 再写 `safe center`，不支持的浏览器用前一条）。新实现必须保留该双写模式。

### 3.4 overflow 处理总结
| 容器 | 策略 |
|---|---|
| body | hidden（47） |
| table-wrap | auto（146）——stage min-width 640 时窄屏横滚 |
| seats-area | auto（150） |
| hand-box | overflow-x auto（193） |
| btns-col | overflow-y auto（189） |
| log-body / modal / lobby-body / login | auto（223/259/116/94） |

### 3.5 验证方法
1. 断点测试 1920/1366/1024/768 宽：stage 在 640–1240 间自适应；<640 时 table-wrap 出横向滚动而非压缩卡牌。
2. 座位>6 人、手牌>12 张时：座位 wrap、手牌横向滚动，无重叠。
3. `justify-content` 计算样式在旧内核下仍为 center（safe 回退生效）。

---

## 4. z-index 层级栈（完整数字列表）

| 层级 | 值 | 元素 | 行号 |
|---|---|---|---|
| 弹窗 | **300** | `.modal-mask` | 257 |
| 悬浮提示 | **290** | `.tip` | 214 |
| 伤害浮字 | **210** | `.dmg-float` | 244 |
| 特效 | **205** | `.spark`、`.suit-bounce` | 251、252 |
| 飞行卡 | **200** | `.card.flying` | 209 |
| 选中卡 | **6** | `.card.selected` | 199 |
| 悬停卡 | **5** | `.card:hover` | 198 |
| 默认 | auto | 其余全部（座位、日志、面板） | — |

规则：全屏遮罩 > 信息提示 > 战斗反馈（伤害>特效>飞卡）> 卡牌交互态（选中>悬停）> 页面内容。`.turn-halo` 用 `position:absolute; inset:-3px` 在 `.seat`（`position:relative`）内局部堆叠，不参与全局层级。

### 验证方法
1. 同时触发攻击（飞行卡+浮字+火花）并悬停卡牌、打开弹窗：渲染顺序必须为 弹窗>tip>浮字>特效>飞卡>手牌。
2. 新组件入层必须复用此表并在文档登记，禁止临时大数值（如 9999）。

---

## 5. 动画清单（keyframes / transition 全集）

| 名称 | 类型 | 定义行 | 触发时机 | 时长/缓动/次数 | 作用元素 |
|---|---|---|---|---|---|
| body 主题渐变 | transition | 47 | 切主题 | .25s（background,color） | body |
| btn 反馈 | transition | 77–79 | hover/active | .15s all；active `scale(.97)` | .btn |
| icon-btn | transition | 85 | hover | .15s | .icon-btn |
| switch 项 | transition | 105 | hover/选中 | .15s all | .switch span |
| room 悬停 | transition | 120 | hover | .15s | .room |
| `spin` | keyframes | 144 | 常驻 | **1.5s linear infinite** | .timer .ring（转圈） |
| `targ` | keyframes | 161 | 目标可选态 | 1.2s ease-in-out infinite（box-shadow 3px↔7px） | .seat.targetable |
| `pulse` | keyframes | 184 | 常驻 | 1.6s ease-in-out infinite（opacity .45↔1） | .turn-halo |
| 座位过渡 | transition | 159 | 状态变化 | .2s | .seat |
| 单位过渡 | transition | 181 | 状态变化 | .4s | .seat .unit |
| `flashGreen`(heal) | keyframes | 240 | 治疗 | .6s ease | .seat.heal(158) / .my-hud.heal(241) |
| 卡牌 hover | transition | 197–198 | 悬停 | all .16s；`translateY(-10px) scale(1.05)`、z-index 5 | .card:hover |
| 卡牌 selected | transition | 199 | 选中 | `translateY(-18px) scale(1.07)`、z-index 6 | .card.selected |
| `cardShake` | keyframes | 210 | 无效/咖啡 | .3s ease-in-out ×2（X 轴 ±3px 抖动） | .card.shake |
| 飞行卡 | transition | 209 | 出牌 | **.45s cubic-bezier(.3,.7,.4,1)**（transform、opacity） | .card.flying |
| `logIn` | keyframes | 225 | 日志新增 | .3s ease（opacity 0→1 + X+8px） | .log-item |
| `seatHit` | keyframes | 233 | 受击 | .35s ease（X ±4px 抖动） | .seat.hit |
| `flashRed` | keyframes | 236 | 受击 | .5s ease（红晕扩散） | .seat.hit（与 seatHit 组合，行 237） |
| `flashBlue` | keyframes | 238 | 格挡 | .5s ease（蓝晕扩散） | .seat.blocked |
| `unitDie` | keyframes | 242 | 单位死亡 | .5s ease forwards（缩小+旋转+max-width 0） | .unit.die |
| `floatUp` | keyframes | 247 | 数值浮字 | 1s ease forwards（0→1.15→1 缩放、上浮 46px、淡出） | .dmg-float |
| `bannerIn` | keyframes | 248 | 事件横幅挂载即播 | .4s ease（上移 5px 淡入） | .event-banner |
| `sparkle` | keyframes | 250 | 欢乐牌 | .9s ease forwards（缩放+旋转 360°+淡出） | .spark |
| `suitBounce` | keyframes | 253 | 判定翻牌 | 1.1s ease forwards（下落弹跳+淡出） | .suit-bounce |
| 全局降级 | 规则 | 254 | `body.reduced` | 所有 animation/transition 强制 .01s !important | * |

### 触发管线（JS，行 617–681）
- `flashSeat(sel,cls)`（623）：移除→`void offsetWidth` 强制重排→加类→600ms 移除（标准 reflow 重放技巧）。
- `floatText(x,y,txt,cls)`（618）：建 `.dmg-float`，1s 后删除。`.heal` 绿、`.mp` 蓝 17px（245–246）。
- `sparkles(x,y)`（619）：6 个 ✨、±70/40px 随机偏移、随机延迟 ≤0.25s、1.2s 清理。
- `suitBounce(x,y,suit)`（620）：1.2s 清理。
- 出牌飞行（644–659）：克隆卡为 `.card.flying` 放 (c.x-50, c.y-71)（卡心对齐）→ 下一帧设 `translate(Δ) rotate(10deg) scale(.7)` + opacity .85 → 380ms 命中结算（音效+hit 动画+浮字+日志）→ 460ms 移除飞卡 → 800ms 取消选中。
- 动效降级开关 `motion`（580）：切 `body.reduced`。

### 验证方法
1. 用 DevTools Animation 面板核对每个 keyframes 的时长/缓动与上表一致。
2. 连点攻击：飞卡必须在 460ms 内移除，无残留 DOM 节点（定时器泄漏检查）。
3. 开「减少动态效果」后所有动画 <50ms、页面静止。

---

## 6. 音效设计（Web Audio 合成，无外部文件）

### 6.1 引擎（行 521–556）
- 惰性单例 `Sfx`：首次播放才建 `AudioContext`；`ac()` 在 state==='suspended' 时 resume（524）。
- `tone(f0,f1,dur,type,vol=.18)`：Oscillator + Gain，频率 `exponentialRamp` f0→f1，增益指数衰减至 .0001，stop 于 dur+.02（525–531）。
- `noise(dur,vol=.12)`：生成衰减白噪声 buffer 播放（532–537）。
- `set(v)` 总开关（539）；全局首次点击 resume（558）。

### 6.2 音效事件表（行 540–553）
| key | 触发事件 | 合成参数 |
|---|---|---|
| `click` | 通用点击（房间/按钮/开关/主题/保存/图鉴/教学/结束出牌） | tone(880→660, .06s, square, .06) |
| `select` | 手牌选中（631） | tone(520→720, .08s, triangle, .12) |
| `attack` | 攻击命中结算（延迟 380ms，653） | tone(300→70, .22s, sawtooth, .2) + noise(.12, .1) |
| `block` | 打出 WA 闪避（670） | tone(1100→1400,.12s,sine,.14) + tone(1500→1800,.1s,sine,.08) 叠加 |
| `heal` | CCF捐款治疗（669）、咖啡（671） | tone(523 平,.12s) + 110ms 后 tone(784 平,.16s)（C5→G5 双音） |
| `draw` | 摸鱼摸牌（672） | tone(700→900,.07s,triangle) + 70ms 后 tone(900→1100,.07s) |
| `drop` | 删库炸单位（662） | tone(180→60, .25s, square, .16) + noise(.15, .08) |
| `fun` | 躺赢欢乐牌（673） | tone(600→1200,.14s,triangle) + 100ms 后 tone(900→1600,.14s) |
| `dice` | 判定演示（677） | noise(.18, .14) + tone(400→200, .15s, triangle, .1) |
| `death` | **未接线**（已定义） | tone(220→50, .6s, sawtooth, .16) |
| `awake` | **未接线**（已定义，觉醒） | tone(660→990,.12s,sine) + 110ms 后 tone(990→1320,.2s) |

### 6.3 验证方法
1. 逐事件点击，用 AudioContext 录制对比频率曲线（起止频率、波形 type、时长与上表一致）。
2. 静音开关 `snd`（579）后 Sfx 内部短路：确认 `Sfx.set(false)` 后 `play` 零开销且无报错。
3. 浏览器自动播放策略：首次无手势调用必须不抛错（demo 已用 once 监听 resume，行 558）。

---

## 7. 命名双轨（黑话 / 通俗 切换机制）

### 7.1 机制
- CSS：行 **88–91** —— `.name-plain{display:none}`；`body.plain-mode .name-zh{display:none}`；`body.plain-mode .name-plain{display:inline}`。
- JS：`setMode(m)` 行 **568–571** 切 `body.plain-mode`。
- 开关：`.switch[data-sw="mode"]` 三处（登录 280、大厅 295、游戏 354、设置 503），通用绑定在 573–585。
- 用法约定：每个词条**成对写** `<span class="name-zh">黑话</span><span class="name-plain">通俗</span>`，默认显示黑话。

### 7.2 已收录词条表（示例，新实现须全量覆盖）
| 黑话 | 通俗 | 位置 |
|---|---|---|
| 机房第一排 | 前线机房 | 306 |
| 蒟蒻训练营 | 新手训练营 | 311 |
| AK全场 | 全场制霸 | 316 |
| 神犇 | 高手 | 376 |
| 评测姬 | 裁判 | 386 |
| 女装大佬 | 伪装者 | 396 |
| 几何画板 | 测绘员 | 400 |
| 毒瘤出题人 | 刁钻考官 | 409 |
| 传奇Au选手 | 传奇选手 | 419 |
| 划水怪 | 摸鱼者 | 429 |
| 线段树守卫 | 防线卫士 | 390 |
| 学长助教 | 突击助教 | 423 |
| 评测机护盾 | 护盾 | 423 |
| 机器人队友 | 勤务兵 | 433 |
| 水群 | 拖延 | 413 |
| 封神 | 爆发 | 458 |
| 做法假了 | 攻击 | 444 等 |
| WA | 闪避 | 446 |
| CCF捐款 | 治疗 | 447 |
| 咖啡 | 提神 | 448 |
| 摸鱼 | 补给 | 449 |
| 删库 | 格式化 | 450 |
| 躺赢 | 坐享其成 | 451 |

注意：`.ident`「身份隐藏」、成就名「护主/掀翻/明君」（333–335）、log 文本大部分**未做双轨**——见【改进建议】#4。

### 7.3 验证方法
1. 切通俗版后全局搜索快照：不得残留任何 `.name-zh` 可见文本（除纯数字/emoji）。
2. 断言两个 span 在两种模式下 `offsetParent` 可见性恰好互斥。
3. 新卡牌/新文案入库必须同时提供双轨 span，在代码审查清单中强制。

---

## 8. 计时器（45s / 10s 展示与超时行为）

### 8.1 现状（行 142–143、353、456、600、689–691）
- UI：`.timer` 含 24px 圆环 spinner（`spin` 1.5s 常转）+ `#timer-num` 显示 `0:42`（mono 橙）。
- 行动阶段时长：45 秒（行 456「行动阶段 · 限时 45 秒」；tip endturn 行 600「行动阶段限时 45 秒」）。
- 演示实现（689–691）：`sec=42` 起、每秒减 1、**归 0 重置为 45**、`padStart(2,'0')` 格式 `0:SS`——这是纯循环演示，**未与回合/服务器状态绑定**。
- **10 秒响应倒计时在本文件中完全不存在**（全文 grep 无 "10 秒/10s/超时"）。响应询问（WA 闪避等）的时限属于规则层，需从 `v4-web\game.js` 的 pending 机制推导（见 §9），新 UI 必须自建。

### 8.2 v2 规范（补全要求）
- 行动倒计时 45s：服务器下发剩余秒数，UI 每 1s 渲染 `0:SS`；≤10s 时 `.timer` 加警示态（橙→红、ring 加速/换色）——本文件无此逻辑，属新增。
- 响应倒计时 10s：挂起询问（dodge/counter/cold/bbst/chase/harvest/aoeResp）弹出后倒计时，归零自动视为「不响应」并回包。
- 超时行为：行动超时自动结束出牌（进入弃牌阶段，手牌弃至上限 5，行 442/600）；响应超时按各 pending 类型的默认拒绝分支结算（见 game.js `respond*` 函数）。

### 8.3 验证方法
1. 模拟服务器时间戳：倒计时显示与剩余秒数一致、无负值、无跳秒。
2. 45s 到 0 与 10s 到 0 分别触发对应超时动作，且只触发一次（防重入）。
3. ≤10s 警示样式与音频提示（可复用 `click` 或新音效）生效。

---

## 9. 弹窗与响应弹窗类型

### 9.1 通用弹窗骨架（256–263）
- `.modal-mask`：`position:fixed; inset:0; background:var(--modal-mask); z-index:300; display:none`；`.show` 显示（257–258）。
- `.modal`（复用 `.win`）：`width:min(470px,92vw); max-height:84vh; overflow:auto`（259）。
- 内容行 `.mrow`：`flex; space-between; padding:11px 0; border-bottom:1px solid var(--line)`，末行无边框（261–262）；`.lab small` 副说明（263）。
- 交互：`openModal/closeModal`（517–518）；点遮罩空白处关闭（519）。
- 现有实例仅 **#settings 一个**（495–512），六行开关：主题 / 命名 / 特效等级(fx: 全效|轻量|无) / 界面尺寸(scale) / 音效 / 减少动态。

### 9.2 响应弹窗（dodge/counter/betray/cold/bbst/chase/harvest/guard/aoeResp/report 等）
**本文件零实现**（grep 确认全文无这些类型）。它们作为 `g.pending.type` 存在于 `v4-web\game.js`（dodge:808/825/835、chase:893、bbst:908、cold:962、counter:1005、aoeResp:1139、harvest:1463/2048），且 game.js 注释 261 行注明 `betrayTo`（卖队友转嫁）已弃用。`guard` 是结算结果值（game.js 787 `return 'guard'`）而非询问弹窗。
- v2 规范：为每种 pending 建一个弹窗实例，统一复用 `.modal-mask>.win.modal` 骨架：
  - 头部：标题（双轨词条）+ 10s 倒计时环；
  - 主体：可选手牌缩略卡（响应牌高亮 `.playable`）、目标/对象选择、可选「卖队友」(betray) 分支按钮；
  - 底部：确认/取消（取消=不响应，走默认分支）；
  - 文案与按钮须与 game.js 各 `respond*`/`resolve*` 的判定分支一一对应。

### 9.3 验证方法
1. 用 game.js 造出每种 pending 场景，UI 弹出对应弹窗且选项与规则分支一致。
2. 弹窗出现时遮罩 z-index 300 盖住 tip(290) 与浮字(210)。
3. 10s 倒计时归零自动回「不响应」，无 pending 时弹窗必须可关闭/自动消失。

---

## 10. 卡牌图鉴 / 悬浮问答 / 教学提示 / 成就弹窗 / 胜败画面

### 10.1 悬浮问答（.tip，214–217 + 590–615）
- `.tip`：`position:fixed; z-index:290; width:236px`；面板底、radius 8、padding 12、`pointer-events:none`（214）。
- 结构：`.t-name`（绿加粗）→ `.t-body`（dim、line-height 1.6）→ 可选 `.qa`（橙、上虚线分隔、11px，问答双栏）（215–217）。
- 数据：`TIPS` 字典 10 条（590–601）：attack / wa / heal / coffee / fish / drop / fun / skill1 / skill2 / endturn；绑定任意 `[data-tip]` 元素（手牌 444–451、技能按钮 458–463）。
- 定位算法（602–615）：`x = r.right+12, y = r.top-10`；右溢出（`x+248>innerWidth`）翻转到左 `r.left-248`；下溢出（`y+190>innerHeight`）贴底 `innerHeight-200`。mouseenter 显示 / mouseleave 隐藏。
- 注意：tip 位于 #scaler 之外（492），不随 UI Scale 缩放（见【改进建议】#8）。

### 10.2 卡牌图鉴
- 仅一个按钮「🃏 图鉴」（482），**无任何实现**。v2 需新增：全卡列表弹窗（按 type/cost/花色筛选、含双轨名与 desc）、可从手牌 tip 跳转。

### 10.3 教学提示
- 大厅 Solo 教学卡（338–341）：4 局逐机制解锁——① 用牌+打人+灵感 → ② 机位 → ③ 单位/判定/事件 → ④ 进化/觉醒/欢乐牌；按钮无实现。
- 游戏内 `#hint-line`（465）：静态一行提示（「点【做法假了】可攻击任意玩家…」）；v2 应改为状态驱动的分步引导（当前阶段→推荐操作→可点元素高亮）。

### 10.4 成就
- 大厅右栏 `.ach` 列表（330–336）：`.ic` emoji + `.nm` 名（含 small 描述 11px）+ `.pt` 分数（mono 黄）；已列 4 条：搅局者+1 / 护主+1 / 掀翻+2 / 明君+1。
- **成就弹窗（获得瞬间的 popup）不存在**；且除「搅局者」外其余成就名未做双轨。

### 10.5 胜败画面
- **完全缺失**。v2 需新增：结算页（胜/负/身份揭晓、MVP、各玩家战绩、成就达成、返回大厅/再来一局），动画建议复用 `bannerIn/suitBounce` 语言。

### 10.6 验证方法
1. tip：悬停每张卡/技能按钮，检查文案与 TIPS 一致、四边不越界、pointer-events:none 不挡点击。
2. 图鉴/成就/胜败为新增功能：按 §9 弹窗骨架验收 + 双轨检查。
3. 教学：4 局解锁顺序与大厅文案一致，hint-line 随阶段变化。

---

## 11. 可视性与易用性规则

### 11.1 字号体系（基准 14px，行 46）
| 层级 | 大小 | 示例 |
|---|---|---|
| Logo | 46px mono | .logo h1（97） |
| 品牌/房间号 | 17/15px | brand(114)、rid(122) |
| 正文/昵称/卡名 | 14/13px | body(46)、nick(166)、cname(203) |
| 辅助 | 12px | tip、日志、bar title、switch |
| 小字 | 11px | tag、job、ach small |
| 微字 | **10.5/10/9.5px** | unit(181)、judge(182)、seatno(157)、ident(168)、log 时间(226)、ctype(205) |

### 11.2 对比度（现状值，供改进）
- 三级文字 token：text（主）/ dim（次）/ faint（弱）。
- 白主题 faint `#7d8894` on `#fff` ≈ **3.3:1**；黑主题 faint `#5a6574` on `#10151c` ≈ **3.1:1** —— 均低于 WCAG AA 4.5:1（小字不达标），只适合 ≥18px 大文本。
- 语义色仅用于强调（绿/蓝/橙/红文字多为 11–13px），需实测确认 4.5:1。

### 11.3 交互反馈规则
- 一切可点元素必须有 hover 反馈：`.btn:hover` 蓝边+glow（78）、`.room:hover`（121）、`.card:hover` 抬升（198）、`.switch span:hover`（106）。
- 按压缩放反馈：`.btn:active{scale(.97)}`（79）。
- 状态可视化：`.playable` 绿边、`.selected` 抬升、`.targetable` 虚线+脉冲、`.turn-halo` 常亮、`.ident.hidden` 置灰。
- 键盘：`input:focus` 蓝边+glow（55）；**其余控件无 :focus-visible 样式**（见【改进建议】#7）。
- 指针隔离：tip/dmg-float/spark/flying 均 `pointer-events:none`，不阻挡操作。
- 文本防选中：`user-select:none`（46）。
- 滚动条：全局 8px 圆角（50–52）；局部容器 `scrollbar-width:thin`（189、193）。
- 提示可见性：`kbd` 默认账号（283）、手牌计数与弃牌提示（442）、hint-line（465）、tip 全覆盖。

### 11.4 降级与辅助
- 减少动态：`body.reduced`（254、580）。
- 特效档 fx（505、582）：**空实现**（注释说明而已）。
- UI Scale 四档（506、582）见 §2。
- 音效开关（507、579）。
- 双主题（§1）、命名双轨（§7）。

### 11.5 验证方法
1. 用对比度工具（axe / Chrome DevTools）扫描：所有 <14px 文本需达 4.5:1，列出违规清单并修复。
2. Tab 键遍历：所有开关/按钮可聚焦且有可见焦点环。
3. 开 reduced + scale=特大 + 黑主题组合下截图：无裁切、无重叠、无滚动条。

---

## 12. 改进建议汇总（【改进建议】，按优先级）

1. **【改进建议·P0】响应弹窗全家缺失**：dodge/counter/betray/cold/bbst/chase/harvest/guard/aoeResp/report 在 ui-design.html 零实现，只有通用 `.modal` 骨架（§9.2）。必须按 §9.2 规范补建 10s 倒计时响应弹窗组件，并与 game.js 的 pending/respond 分支对齐（betray 在 game.js 已标弃用）。
2. **【改进建议·P0】计时器**：45s 倒计时是 42→0→45 的演示循环（689–691），10s 响应倒计时完全不存在。需绑定服务器 tick、≤10s 警示态、超时动作防重入（§8）。
3. **【改进建议·P0】缺失功能**：图鉴（482 按钮无实现）、成就弹窗、胜败画面、教学流程（338–341 按钮无实现）均为占位。
4. **【改进建议·P1】命名双轨覆盖不全**：成就名（333–335）、`.ident`、log 文本（656 等）大多未双轨；「搅局者」是唯一做了 span 双轨的成就。建议文案层统一走双轨数据表而非散落硬编码。
5. **【改进建议·P1】音效死代码与缺口**：`death`/`awake` 已定义无触发点；`syncSoundBtn`（557）定义了从未调用；音效开关关闭后按钮图标不变化。补：玩家阵亡/觉醒事件接线 + 静音图标同步。
6. **【改进建议·P1】动画硬编码色**：flashRed/flashBlue/flashGreen（236–241）写死 rgba 而不引用 `--red/--blue/--green`，黑主题下光晕颜色与主题脱节；建议改为 `color-mix` 或加 `--flash-red/--flash-blue/--flash-green` token。
7. **【改进建议·P1】无障碍**：`.switch` 是 div/span 组合（104–107），无 role/键盘支持；无 `:focus-visible` 样式；emoji 图标按钮缺 aria-label（部分仅有 title）。建议 switch 改 radiogroup/button 语义，全站补焦点环。
8. **【改进建议·P2】tip 不随 UI Scale 缩放**：tip 在 #scaler 外且固定 236px，特大局下面板文字相对偏小、定位仍准但观感不一致；建议把 tip 移入缩放层，或按当前 v 动态换算 width/字号。
9. **【改进建议·P2】fx 特效档空实现**（582）：应真实控制 sparkles/飞卡/浮字开关（无/轻量=只留浮字与日志）。
10. **【改进建议·P2】token 分散**：`--mono` 定义在第二个 `:root`（59），与主 token 区分离；建议合并，且两个 `:root` 块合并为一个。
11. **【改进建议·P2】魔法数字**：飞卡时序 380/460/800ms（651–658）、tip 偏移 12/10/248/190/200（608–611）散落；建议抽常量表并用 animationend 替代 setTimeout 链。
12. **【改进建议·P3】bannerIn 依赖 CSS 声明即播**（249）：事件更新时需重挂类/节点；建议改为 JS 显式触发类。
13. **【改进建议·P3】小屏策略**：stage min-width 640px + 右侧 272px 日志列，在 <912px 视口出现横向滚动（table-wrap 兜底）。建议明确 1280px 以下压缩侧栏（272→220px）或允许整体缩小。
14. **【改进建议·P3】微字号**：ctype 9.5px、seatno/ident/log 时间 10px 偏小；建议最小 11px 并提升 faint 对比度（白主题 faint 建议 ≥ #6a7684，黑主题 ≥ #7a8696）以满足 4.5:1。

---

## 附：文件结构速查（ui-design.html）

| 区段 | 行号 |
|---|---|
| head/style 主题 token | 7–59 |
| 终端窗口/通用组件/命名双轨 | 61–91 |
| 登录页样式 | 93–108 |
| 大厅样式 | 110–130 |
| 游戏主界面/座位/手牌/卡牌/日志样式 | 132–230 |
| 动效 keyframes | 232–254 |
| 弹窗样式 | 256–263 |
| body / 登录页 DOM | 266–286 |
| 大厅 DOM | 288–344 |
| 游戏 DOM | 346–487 |
| tip + settings 弹窗 DOM | 491–512 |
| JS：页面/弹窗/音效/主题/双轨/开关 | 514–587 |
| JS：TIPS 与悬浮提示 | 589–615 |
| JS：动效工具与出牌演示 | 617–681 |
| JS：applyScale / 倒计时 | 682–691 |
