# 《OI杀》v4 双版本架构与实施阶段计划（供多 subagent 执行）

> 依据：`requirement.txt`（唯一权威）、`v4-web/bugreport.md`、`v4-web/game.js`(2144行, 109.7KB)、`v4-web/index.html`(53.6KB)、`v4-web/test.js`(601行)、`ui-design.html`(694行)、旧 C++ 版源码与 `OIKillServer.exe`(2.96MB)。
>
> 环境实测：Node v24.18.1、npm 11.16.0、git 2.47.3 可用；bun/esbuild 未装（esbuild 可 npm 安装）；仓库已有 origin=git@github.com:LEOOOOOOOOOISME/OI-kill.git（SSH），工作区有未提交变更（`需求.txt`→`requirement.txt` 重命名、v4-web 未跟踪等）。
>
> 引擎关键事实（调研结论）：纯同步逻辑、无 DOM 依赖、UMD 导出；单人类下标 `g.human` + 单槽挂起 `g.pending` + `g.askDodge` 标志；45s/10s 计时在 UI 层不在引擎；`publicView(g,pid)` 已是按视角视图（可作网络快照）；AI 为内联优先级脚本（`aiTurn`/`pickTarget`，反贼仅简单集火主公）；`playerLeave`（离场即投降）已实现可直接复用于断线超时。

---

## A. 版本与目录结构

### A.1 仓库目录（最终提交后的根布局）

```
D:\projects\oi-kill\
├─ cppversion(old)/            # 旧 C++ 版归档（git mv，不删除任何历史）
│  ├─ game_engine.cpp/.h  main.cpp  network_server.cpp/.h  room_manager.cpp/.h
│  ├─ socket_util.h  logger.h  auth.h  json.hpp  nlohmann/  html_content.h
│  ├─ build.bat  test_game.mjs  users.dat  logs/  srv_*.txt  boot_*.txt  diag.ps1  b1/b2.txt
│  └─ OIKillServer.exe         # 旧版发布物（同时作为 legacy release 资产，二进制不进 git）
├─ v4-web/                     # 开发工作区（旧文件保留作基线，新增 src/ 等）
│  ├─ game.js  index.html  test.js  README.md  bugreport.md   # 现状保留
│  ├─ src/
│  │  ├─ data/                 # 纯数据，无逻辑
│  │  │  ├─ cards.js           # CARDS / DECK_COUNT / EVO_MAP / isAttackKey / isDodgeKey
│  │  │  ├─ professions.js     # PROFESSIONS / SKILLS / DOMAINS
│  │  │  └─ identities.js      # IDENTITIES / ID_TABLE / EVENTS / SUITS / suitZh
│  │  ├─ engine/               # 引擎（game.js 按域拆分，导出签名不变）
│  │  │  ├─ core.js            # createGame/setup/回合六阶段/胜负/题海战术/保底终局
│  │  │  ├─ battle.js          # attackPlayer/WA/濒死救援链/守擂/单位战/击杀奖惩
│  │  │  ├─ tricks.js          # 锦囊/欢乐牌/延时/判定/特判/AOE/题解大会
│  │  │  ├─ skills.js          # 职业技能/觉醒/进化
│  │  │  ├─ prompts.js         # ★新增：多槽挂起提示系统（见 B.4）
│  │  │  └─ index.js           # 统一导出（与旧 game.js api 对象逐键一致）
│  │  ├─ ai/                   # ★重写 AI（替换内联 aiTurn）
│  │  │  ├─ scorer.js          # 手牌/局面/目标评分
│  │  │  ├─ identity-policy.js # 四身份策略
│  │  │  ├─ heuristics.js      # 用牌/响应决策
│  │  │  ├─ driver.js          # AI 回合驱动器（异步分步，人形节奏）
│  │  │  └─ difficulty.js      # easy/normal/hard 参数表
│  │  ├─ ui/                   # 前端（同一份 HTML 双版本共用）
│  │  │  ├─ adapter.js         # ★ClientAdapter 接口 + LocalClient/NetClient 两实现
│  │  │  ├─ render.js  lobby.js  gallery.js  tips.js  tutor.js
│  │  │  ├─ fx.js  fx-map.js   # 粒子/浮字/抖动/飞牌/判定旋转 + 逐操作反馈映射表
│  │  │  ├─ style.css          # 从 index.html 内联 CSS 拆出并按 ui-design.html 对齐
│  │  │  └─ index.html         # 唯一入口（?mode=single|lan|local 切换）
│  │  ├─ net/
│  │  │  ├─ protocol.js        # 消息枚举/校验/序列化
│  │  │  ├─ ws-server.js       # 手写 RFC6455（~200-250 行，零依赖）
│  │  │  ├─ longpoll.js        # JSON 长轮询兜底（~100 行）
│  │  │  ├─ http-static.js     # 静态文件 + /api 路由（node:http）
│  │  │  └─ room.js            # 房间/会话/座位/断线重连/超时权威计时
│  │  └─ sound/sfx.js          # Web Audio 合成音效（扩展 ui-design.html 的 Sfx）
│  ├─ server/
│  │  ├─ boot.js               # 公共启动：选端口/自动开浏览器/打印局域网 IP/防火墙提示
│  │  ├─ lan-server.js         # 多人版入口：0.0.0.0 + 大厅 + 房间
│  │  └─ single-server.js      # 单人版入口：127.0.0.1 + 1 人 + N AI（复用同一房间代码）
│  ├─ build/
│  │  ├─ bundle-server.mjs     # esbuild 打包服务端（内联 UI 资源）
│  │  ├─ bundle-pages.mjs      # esbuild 打包 Pages 单文件演示
│  │  ├─ sea-config.json       # SEA 注入配置
│  │  ├─ make-exe.ps1          # node.exe 复制 + postject 注入（单人/多人两 exe）
│  │  └─ push.ps1              # 人工推送兜底脚本（见 G.5）
│  ├─ test/                    # 测试资产（test.js 移入并扩展）
│  │  ├─ test.js               # A/B/C 原套件（require 新模块路径）
│  │  ├─ api-parity.mjs        # 新旧引擎导出逐键对比
│  │  ├─ suite-d.js            # 多人提示/多人类不变量
│  │  ├─ protocol.mjs          # 进程内 WS 协议测试
│  │  ├─ ai-stats.mjs          # AI 对 AI 胜率统计
│  │  └─ conformance.md        # requirement.txt 逐条对照 runbook
│  ├─ docs/
│  │  └─ recon-02-架构方案.md  # 本文件
│  └─ dist/                    # 构建产物（gitignore）
│     ├─ oikill-single.exe  oikill-lan.exe  oikill-pages.html
├─ GithubServerVer/            # ★提交到 GitHub 的新版服务器源码副本（见 G.4）
├─ UserVer/                    # ★提交到 GitHub 的客户端（单人）源码副本（见 G.6）
├─ CHANGELOG.md  更新日志.md
```

### A.2 模块复用图（核心交付物）

| 模块 | 单人 exe | 多人(LAN) exe | Pages 演示 | 说明 |
|---|---|---|---|---|
| src/data/** | ✅ | ✅ | ✅ | 唯一数据源 |
| src/engine/** | ✅ | ✅ | ✅ | 引擎只在"服务器进程"里跑（Pages 除外） |
| src/ai/** | ✅（N AI） | ✅（补位 AI） | ✅（5 AI） | driver.js 双端同一实现 |
| src/ui/**（render/fx/gallery/tips/tutor/style/index.html） | ✅ | ✅ | ✅ | 同一 HTML、同一渲染、同一动效管线 |
| src/sound/sfx.js | ✅ | ✅ | ✅ | 同一声效映射表 |
| src/ui/adapter.js NetClient | ✅（连 127.0.0.1） | ✅（连房主 IP） | ❌ | 网络传输差异点 |
| src/ui/adapter.js LocalClient | ❌ | ❌ | ✅ | 页内直接驱动引擎+AI（Pages 无服务器） |
| src/net/** + server/** + room.js | ✅（mode=single 简化） | ✅ | ❌ | 服务端差异点 |
| lobby.js | ❌（跳过） | ✅ | ❌ | 界面差异点 |

结论：**单一代码库，一处编译常量（MODE=single|lan）一个构建脚本出两个 exe；Pages 演示复用除 net/server/lobby 外的全部模块**。UI 永远通过 `ClientAdapter` 接口收发（`sendAction/sendResponse/subscribe`），对后端是本地引擎还是局域网服务器无感知——这是"AI 与真人视觉完全一致"的基础（所有反馈走状态变更+事件广播，不走本地点击路径）。

---

## B. 局域网方案（房主=服务器）

### B.1 拓扑与端口

- 多人 exe 启动：`net.createServer` 绑定 `0.0.0.0`，端口策略：先试 8080，被占则试 8081~8099，全占则绑 0（OS 随机分配）。控制台打印 `本机地址: http://<局域网IP>:<port>/`（`os.networkInterfaces()` 过滤非内网 IPv4，与旧 main.cpp 同法）。
- 加入方零安装：任何浏览器打开 `http://<host-ip>:<port>`。**合理性论证**：Windows 7/10/11 全部预装 Edge/IE，浏览器是 Windows 自带组件，不是"额外假设的运行时"；本方案的全部运行时负担都在房主一个 exe 里（内嵌 Node），加入方只用到操作系统必然携带的能力。对比"C++版需编译客户端 exe"方案，浏览器加入是零安装成本的最优解。
- 单人 exe = 同一份 room/server 代码，绑定 `127.0.0.1`，`mode=single`，固定 1 人类 + N AI（N 由启动页选择 2~5），跳过大厅直接进对局。这保证两个 exe 的 UI 与协议完全一致。

### B.2 传输层决策（主推 WebSocket，长轮询兜底）

**主推：手写 WebSocket 服务端（RFC6455）**。理由：①实时广播，响应弹窗/出牌/聊天零延迟，比长轮询的 1~2s 停顿体感好一个量级；②服务端仅需 HTTP Upgrade 握手 + SHA-1 accept-key（`node:crypto`）+ 帧编解码（FIN/opcode/mask/payload-length 7/16/64 位）+ ping/pong，约 200~250 行，零依赖；③浏览器原生 `WebSocket` 客户端，无需任何库。**兜底：JSON 长轮询**（`GET /poll?since=seq` + `POST /act`，约 100 行）：仅当 WS upgrade 失败（个别企业代理/防火墙）时客户端自动降级，回合制游戏 1~2s 延迟可容忍。两者共用同一 `protocol.js` 消息层与 `room.js` 会话层，只换传输实现。

### B.3 协议草案（JSON over WS 文本帧；长轮询同构）

客户端→服务器：

| 消息 | 载荷 | 说明 |
|---|---|---|
| `join` | `{name, token?}` | 入座或重连；`{spectate:true}` 观战 |
| `config` | `{humanCount, aiFill, randomIdentity, difficulty}` | 房主修改房间配置 |
| `start` | `{}` | 房主开局 |
| `action` | `{kind:'playCard'\|'equipCard'\|'deployUnit'\|'unitAttack'\|'skillUse'\|'endTurn'\|'discardFun'\|'kspAttack'\|'fangAttack'\|'lordRedraw'\|'discardCards', args}` | 意图，服务器用引擎 API 校验 |
| `response` | `{promptId, kind:'dodge'\|'counter'\|'aoe'\|'betray'\|'cold'\|'bbst'\|'chase'\|'harvest'\|'report'\|'discard'\|'evo', value:{yes?,targetId?,cardKey?,indices?,choiceKey?}}` | 响应挂起提示 |
| `chat` / `ping` / `leave` | | |

服务器→客户端：

| 消息 | 载荷 | 说明 |
|---|---|---|
| `hello` | `{proto:1, mode:'lan'\|'single', self:{pid,seatId,name,isHost}}` | 握手 |
| `lobby` | `{players[], config, canStart}` | 大厅状态 |
| `setup` | `{professions, myIdentity, lordPid, deckCount}` | 开局信息 |
| `state` | `{view:publicView(pid), seq, deadline:{turn,resp}}` | 权威快照（v1 全量，可后加增量） |
| `prompt` | `{promptId, type, payload, timeoutMs:10000}` | 要求该玩家响应（10s 超时=否） |
| `event` | `{kind:'log'\|'fx'\|'sfx'\|'judge'\|'death'\|'victory'\|'achievement'\|'chat'\|'turn'\|'shutdown', payload}` | 全局广播：所有客户端（含 AI 动作）走同一动效/音效管线 |
| `reject` | `{why}` | 非法动作拒绝（显示原因） |
| `ack` / `pong` | | |

### B.4 权威模型与引擎改造（P2 的核心）

- **服务器持有唯一真实状态**：`g` 对象只存在于房主 exe 进程；客户端只收 `state` 视图、只发意图；服务器对每个 `action/response` 调用引擎对应 API（`playCard/skillUse/respondDodge/...`）校验，非法即 `reject`，绝不信任客户端状态。
- **引擎"单人类→多人类"改造**（不动规则，只动提示层）：
  1. `g.human:int` → `g.humanSet:Set<int>` + `isHuman(pid)`；`g.askDodge` 标志 → `isHuman(target)` 直接判定（消除幽灵标志）。
  2. `g.pending` 单槽 → `g.prompts:Map<promptId,{pid,type,payload,deadline}>` 多槽：同一时刻可并存多个提示（AOE 逐人、题解大会逐人、护驾同时问目标+帮手、特判连锁）。为平滑迁移，过渡期保留 `g.pending` 作为"第一个未决提示"的只读别名，让原 test.js B 套件不改即过。
  3. 弃牌自选、进化选择、主公手牌重洗等"UI 回调"路径（`g.discardChoice`/`g.evoWait`）统一改成标准 prompt 类型（`discard/evo/lordRedraw`）。
  4. `aiTurn` 同步大循环 → `drive()` 异步调度器：引擎走到"需要人类"即挂起发 prompt；走到 AI 决策则按 difficulty 的 think 延迟（800~2500ms）分步执行后继续；45s/10s 计时**权威在服务器**（超时→按"否/结束出牌"推进并广播）。
- **重连策略**：入座发 `sessionToken`（crypto 随机），断线后 60s 宽限期内携 token 重连→重发全量 `state` + 当前未决 prompt；超期未归→执行 `playerLeave`（离场即投降，requirement 2.7）；观战者断线仅重订阅。心跳 ping/pong 15s。
- **AI 补位与节奏**：大厅 config 设 `humanCount`（1~6）与 `aiFill`（补到 6 的 AI 数）；AI 与真人共用同一 `action/response` 语义与同一 `event` 广播（人形延迟、无瞬发、视觉一致）。身份按 `ID_TABLE[总人数]` 分配（房主=0 号主公），可选"身份完全随机"开关；观战 spectator 只收公开信息（无手牌、无身份）。
- **房间配置项**：`humanCount / aiFill / randomIdentity / difficulty / spectate`。开局流程：房主 config → start → 服务器 `setup(g, names)` → 广播 `setup`+`state` → 主公先手。

---

## C. 单可执行文件策略

### C.1 三方案评估

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Node.js SEA**（主推） | 官方支持（Node20+）；本机 Node v24 现成；内嵌完整 Node 运行时=引擎测试环境与生产环境 100% 一致；esbuild+postject 均为 npm 依赖，零系统级安装 | exe ≈ 85~90MB（node.exe 本体）；postject 注入会破坏 Authenticode 签名（SmartScreen 对未签名 exe 弹"更多信息"提示） | ✅ 主推 |
| bun build --compile | 一行命令；体积相近 | 本机未装 bun（已实测）；需额外工具链；Node API 语义有差异（引擎行为可能与测试环境不一致） | 备选（SEA 受阻时，`npm i -g bun` 后一行构建） |
| vercel/pkg | 老牌 | **已弃维护**（Vercel 归档，不兼容 Node≥18 官方二进制），漏洞无人修 | ❌ 不选 |

### C.2 SEA 精确构建步骤（build/make-exe.ps1 固化）

1. `cd v4-web && npm init -y && npm i -D esbuild postject`（锁版本 esbuild@0.2x、postject@1.x）。
2. 打包服务端：`npx esbuild server/lan-server.js --bundle --platform=node --format=cjs --outfile=dist/bundle.cjs --define:BUILD_MODE='"lan"' --loader:.html=text --loader:.css=text --minify`（UI 资源以字符串内联进 bundle，运行时用内存路由服务，**不落盘、不依赖外部文件**）；单人版同命令换 `--define:BUILD_MODE='"single"'` 与入口 `single-server.js` → `dist/single.cjs`。
3. `sea-config.json`：`{"main":"dist/bundle.cjs","output":"dist/sea-prep.blob","disableExperimentalSEAWarning":true}` → `node --experimental-sea-config build/sea-config.json`。
4. 复制本机同版本 `node.exe` → `dist/oikill-lan.exe`。
5. `npx postject dist/oikill-lan.exe NODE_SEA_BLOB dist/sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`；单人版同法出 `dist/oikill-single.exe`。
6. 校验：`dist/oikill-lan.exe --version` 打印版本与模式；在**无 Node 环境的干净 Windows**（虚拟机/第二台电脑）双击验证。

### C.3 启动行为（boot.js，两个 exe 共用）

- 绑定端口后自动开浏览器：`child_process.exec('start http://127.0.0.1:'+port)`（Windows `start`，经 `cmd /c`）；`--no-browser` 参数可关。
- 控制台（UTF-8 codepage 65001，同旧版）打印：版本/模式、`本机地址 http://127.0.0.1:port`、逐条 `局域网地址: http://<ip>:<port>`、防火墙未放行时的提示 `netsh advfirewall firewall add rule name="OIKill" dir=in action=allow protocol=TCP localport=<port>`、`输入 q 回车安全退出（广播 server-shutdown）`。
- Windows 专有注意：exe 是 GUI=0 控制台程序；若被打包工具改为窗口程序会丢 stdout，故必须保持控制台子系统；未签名 exe 首次运行 SmartScreen 提示属预期（发布说明里写明，可选自签）；node.exe 必须与构建用 Node 同大版本（v24）。

### C.4 同一 HTML 双版本

`ui/index.html` 是唯一页面：启动时请求 `/api/hello` 拿 `mode`，`lan` 显示大厅（lobby.js），`single` 显示单人配置页；`?mode=local` 仅 Pages 演示用（LocalClient 直驱引擎）。两个 exe 服务的是同一份打包后的 HTML/CSS/JS。

---

## D. UI / 动效 / 音效升级计划（P6/P7/P8，按 subagent 任务拆分）

总原则：**一切反馈由服务器权威 `event` 广播 + `state` 前后差量驱动，AI 与真人走完全相同的渲染管线**（禁止在"本地点击"里直接放特效）。

**P7-1 动效基座 fx.js**：浮字（floatText，ui-design 已有雏形）、粒子（sparkles 升级为带速度/重力/颜色的粒子池）、震屏（hit-shake，力度分级）、闪红/闪绿（flashSeat 升级）、卡牌飞行动画（cloneNode 轨迹插值）、判定旋转（翻牌 3D rotate 亮花色）、全局 FX 事件总线 `onFx(kind,payload)`。

**P7-2 逐操作反馈映射表（验收清单，实现为 fx-map.js 一张表 + 事件触发）**：
出牌=卡牌飞出+落地缩放｜攻击=轨迹+目标闪红+浮字"-1"｜受伤=血条分段流失动画+红脉冲｜治疗=绿脉冲+浮字"+1"｜装备=栏位发光+卡入槽｜部署=单位卡落桌+阴影弹跳｜单位攻击=对冲撞击+消灭碎屑｜守擂挡刀=护盾碎裂+单位飞灰｜进化=卡面金边变形+粒子｜觉醒=✨全屏爆闪+职业横幅｜判定=卡背旋转亮花色+回牌堆底小动画｜AOE=环形波扫过全桌｜WA=蓝光涟漪抵消｜特判=紫色反击闪光｜死亡=座位坍塌+身份翻牌（内奸不翻）｜胜利/失败=结算遮罩+阵营横幅+成就徽章逐个弹出｜倒计时=环状计时条，≤10s 变红脉动+滴答音｜换回合=回合光环流转｜聊天=气泡弹出｜拒绝=抖动+错误音。

**P8-1 音效（sound/sfx.js，全部 Web Audio 合成、零音频文件）**：沿用 ui-design 的 tone/noise 原语，扩展事件→音色映射：click/select/attack(锯齿+噪声)/block(双音上行)/heal(双音)/draw(滑音)/drop(低方形波)/fun(琶音)/dice(噪声+三角)/death(低锯齿下坠)/awake(上行双音)/judge(翻牌咔哒)/aoe(风扫噪声)/counter(紫色反击短音)/victory(小号角琶音)/defeat(下行小调)/achievement(铃音)/countdown(秒针滴答,越急越密)/chat(气泡音)/turn(回合提示音)/error(短促双频)。含主音量滑块、静音开关、`prefers-reduced-motion` 联动、AudioContext 首手势解锁（autoplay 政策）。

**P6-1 UI 标准对齐（对照 ui-design.html 并改进）**：白/黑双主题 CSS 变量整套移植（`--bg/--panel/--blue/--green/--red...` 两套值）+ 等宽字体栈 + 深浅色下对比度校验（可视性红线）；命名双轨开关（黑话/通俗）；界面缩放 4 档（0.85/1/1.15/1.3）+ 键盘缩放；响应式：桌面 6 人环形牌桌网格、移动端纵向座位条+底部手牌区；大厅页（房间列表/创建房间/成就计分/Solo 入口）按 ui-design 布局实现到 v4 规则。

**P6-2 卡片交互**：hover 上浮+辉光+缩放，可出牌高亮（合法费用/目标态区分），选中抬高，桌面视差（鼠标位移微小倾斜），保持卡面文字可读性（视差幅度≤2°、辉光不遮字）。

---

## E. AI 升级计划（P3，subagent 任务拆分）

**P3-1 评分器 scorer.js**：对每张手牌算场景效用分（攻击牌价值/WA 保留价值/桃时机/装备槽位收益/欢乐牌双轨灵活性），对每个可攻击目标算威胁分（血量、身份概率估计、防具、守擂、觉醒状态），输出统一 `score(action)` 供所有决策共用。

**P3-2 身份策略 identity-policy.js**：
- 反贼：压迫主公但不盲打——首轮费用+1 时先铺装备/攒牌；主公护盾未破时先拆盾（爆零/拔网线/抄袭代码优先级提升）或打守擂；忠臣疑似暴露前先探明；主公残血才集火；不被"追着主公打"（bugreport 明确点名）。
- 忠臣：护主优先——主公残血时治疗/挡刀/护驾判定更积极；主动拆反贼装备与延时牌；必要时卖血保主。
- 内奸：平衡两方——反贼占优帮主公方清反贼、主公方占优保留反贼；绝不提前杀主公（胜利条件要求反贼先全灭）；保留颓废标记与治疗牌进 1v1；终局单挑用回血+攒牌磨死。
- 主公：自保流——优先装备与治疗；用盲狙试探（打疑似反贼者，吃 -1 惩罚也在所不惜）获取信息；善用护驾与首轮免伤窗口。

**P3-3 用牌启发 heuristics.js**：杀（目标选择按身份策略+威胁分）、闪（HP≤2 或手牌溢出才闪，留 1 灵感）、桃/咖啡（时机：低血优先，濒死咖啡保留）、装备（按槽位价值与减费铁律 1/2）、锦囊（延时牌给威胁最大者、拆给高价值装备、AOE 在敌多人时开、特判保留给关键锦囊）、单位（守擂保己方核心/速攻清敌方单位/亡语过牌）、技能（19 职业逐张策略表，含觉醒后行为变化）。

**P3-4 响应决策**：闪避/特判/护驾/卖队友/冷数据/平衡树/不死心/濒死自救，全部走期望价值（EV）估算：被击损失 × 概率 vs 资源成本 vs 保留价值；AI 之间不"上帝视角"（只用公开信息 + 身份概率）。

**P3-5 难度与节奏 difficulty.js**：easy=近似随机+长延迟；normal=启发式；hard=评分+威胁模型+更优保留决策。**人形化**：每步 think 800~2500ms 随机延迟、同回合动作间间隔、偶发"犹豫"停顿（响应前多停 1~2s）、绝不瞬发；视觉一致性由统一 event 总线保证（AI 动作与真人动作产生完全相同的 fx/sfx/日志序列，验收用事件流 diff 断言）。

**P3-6 平衡调参**：ai-stats.mjs 跑 500+ 局/难度，向 requirement 20.3 目标（反贼≈33%、主公方≈60%、内奸≈7%）收敛；README 已测随机 AI 为 67.5/25/7.5，说明现有 AI 偏向主公方，调参重点在反贼集火智慧与内奸搅局（含"搅局者"成就行为：杀反/忠制造混乱并活到最后）。

---

## F. 测试计划

1. **单元/回归（P1/P2 门槛）**：test.js 原 A/B/C 套件原样跑通新模块布局（A：40 种子全 AI 不变量+120 守恒+3000 回合上限；B：5 局人类流程；C：6 定向）；新增 suite-d.js：多人类挂起提示不变量（prompt 无泄漏/双 human 同时挂起/AI 补位正确/重连后快照一致/超时=否语义）。
2. **协议测试（P4 门槛）**：protocol.mjs 在进程内拉起 ws-server，用零依赖迷你 WS 客户端脚本跑：6 人类全流程对局、非法动作拒绝、断线 60s 内重连恢复、长轮询降级路径、server-shutdown 广播；随后**单机多窗口冒烟**：一台机器开 1~6 个浏览器标签（不同名）人工完整对局。
3. **跨机局域网流程（P9/P10）**：两台物理机同一 Wi-Fi：A 机跑 exe，B 机浏览器加入，完整 2 人+N AI 对局，验证延迟/一致性/房主关机时 B 端提示与超时；防火墙放行/不放行两条路径都测。
4. **AI 统计与平衡（P10 门槛）**：≥500 局/难度；验收区间：反贼 33±8%、主公方 60±8%、内奸 7±8%；无崩溃、单局≤3000 回合、时长分布 20~30 分钟对应轮数合理。
5. **requirement.txt 符合性 runbook（conformance.md）**：把 770 行规范映射为检查表：铁律 5 条、身份分配表（3~6 人）、胜利判定顺序 3 条、死亡翻牌例外、击杀奖惩、平衡四件套、题海战术+保底终局、费用/减费规则、120 牌堆守恒、攻击/守擂/单位裁决、判定回牌堆底、濒死救援链 5 步、19 职业技能+觉醒、进化 10 条、评测机事件 4 花色、欢乐牌 8 张双轨、FAQ 17 条、Solo 教学 4 局。每条标注"自动测试 id / 手动步骤 / 已实现证据"，最终 100% 打勾。
6. **性能/浸泡（P10）**：40 种子 × 3000 回合 soak（沿用）、1000 局 AI 夜跑、WS 4 客户端高聊天频率压力、内存驻留检查（<200MB）。
7. **每阶段回归门**：定义 gate 命令集 `node test/test.js && node test/suite-d.js && node test/protocol.mjs && node test/ai-stats.mjs --quick`，各阶段签收前必须全绿；主 agent 在 P1/P2/P3/P4/P6/P9/P10 后执行复核。

---

## G. GitHub 阶段计划（精确顺序）

1. **仓库前置检查**：确认 `git remote get-url origin`=SSH 地址可用（`ssh -T git@github.com` 或 `gh auth status`）。仓库现存未提交变更（`需求.txt`→`requirement.txt` 重命名、v4-web 未跟踪、b1.txt 修改）——第一步先提交这些现状文件，保证归档提交干净。
2. **归档旧 C++（git mv，不删历史）**：把根目录 C++ 源码/头文件/构建脚本/日志/users.dat/test_game.mjs/srv_*.txt/boot_*.txt/diag.ps1 移入 `cppversion(old)/`，独立 commit：`chore: 归档旧 C++ 版本至 cppversion(old)`。`超时空辉夜姬.md` 与 `_bug_reports_` 不动（非版本物）。
3. **旧版 exe release（legacy）**：旧版可发布物 = `OIKillServer.exe`（2.96MB，根目录唯一 exe，端口 8080 的 C++ Web 服务器）。**需人工确认**：若认同，则 `gh release create v3-cpp-legacy --title "OI杀 C++ 旧版服务器" --notes "<旧版说明：8080 端口、登录/管理地址、默认账号>" cppversion(old)/OIKillServer.exe`；exe 二进制不进 git，仅作 release 附件（cppversion(old)/ 内可留副本）。
4. **GithubServerVer 推送（新版服务器源码副本）**：内容 = `src/{data,engine,ai,net}` + `server/` + `build/` + `test/` + 一个 **Pages 单文件演示** `pages/oikill.html`（esbuild 把 engine+ai+ui+sfx 打进一个 HTML，LocalClient 直驱，无服务器）。commit 后 `git push origin main`。
5. **GitHub Pages 上线 + 在线测试**：仓库 Settings→Pages 指向 `GithubServerVer/pages`（或 gh-pages 分支/`/docs`）。**演示范围论证**：Pages 是纯静态托管，无长驻进程、无 WebSocket，故演示=**浏览器单文件单人版**（1 人类 + 5 AI，完整规则/UI/动效/音效），局域网多人能力无法在 Pages 提供（房主必须是进程）。上线后：打开部署 URL 人工冒烟 + 演示页内置"自检按钮"（浏览器内跑 test.js C 套件微缩版并显示结果）。若需 `gh api repos/.../pages` 或 Settings 网页操作，由主 agent 执行或转人工。
6. **UserVer 推送（客户端单人源码副本）**：内容 = `src/{data,engine,ai,ui,sound}` + `server/single-server.js` + `build/`（去 net 服务端与 lobby）；commit+push。
7. **新版本 release**：`gh release create v4.0-web --title "OI杀 v4.0 双版本" --notes "<更新日志摘要>" dist/oikill-single.exe dist/oikill-lan.exe`。
8. **CHANGELOG.md / 更新日志.md 大纲**：①v4.0 概述（单人/多人双 exe、房主即服务器、浏览器零安装加入）；②新特性（局域网大厅/补位 AI/观战/断线重连/聊天）；③动效音效（逐操作反馈清单、Web Audio 合成、三档特效+静音）；④AI 升级（身份策略/难度/人形节奏）；⑤UI 标准对齐（双主题/命名双轨/缩放/响应式）；⑥平衡数据（AI 统计胜率 vs 目标）；⑦测试记录（套件/协议/跨机/浸泡）；⑧旧版归档说明（cppversion(old) + v3-cpp-legacy release）；⑨已知问题与下一步。

**BLOCKED-ON-USER 定义**：若 `ssh -T git@github.com` 失败且 `gh auth status` 未登录（无凭据/无 gh CLI）——立即停止 push 步骤，向用户输出确切消息："GitHub 凭据不可用：请执行 `gh auth login` 或配置 SSH key 后回复『继续』；期间已准备本地交付物：①`git bundle create dist/oikill-release.bundle --all` 全量仓库包；②`dist/` 两个 exe 与 Pages 单文件；③`build/push.ps1`（含 gh release 两条命令与 push），人工登录后双击即可完成推送+发版。"

---

## H. 阶段划分（10 个实施阶段 + 2 个交付阶段）

| 阶段 | 内容（subagent 规模） | 输入 → 输出 | 依赖 | 验收标准 | 主 agent 复核 |
|---|---|---|---|---|---|
| P0 | 基线提交：现状入库、`node test.js` 跑通、环境核对（Node/gh/ssh） | 当前工作区 → 干净 commit + 基线报告 | — | 基线 40/40+5/5+6/6 全绿；remote/凭据状态明确 | ✅（含是否 BLOCKED 判定） |
| P1 | 模块拆分：game.js→src/{data,engine}，导出逐键等价 | game.js → 新模块 | P0 | test.js 不改一行即全绿；api-parity.mjs 逐键 diff 为空；esbuild cjs bundle 可 require | ✅ |
| P2 | 引擎多人化：humanSet/prompts 多槽/drive 调度/计时权威/UI 回调 prompt 化 | P1 模块 → 新引擎 | P1 | A/B/C 全绿 + suite-d.js 绿；`g.pending` 别名兼容期无泄漏 | ✅ |
| P3 | AI 重写：scorer/identity-policy/heuristics/driver/difficulty | P2 引擎 → ai/ | P2 | ai-stats.mjs 可跑；行为单测（反贼不盲打、忠臣保主、内奸留力）过；事件流与真人一致 | ✅（看统计与行为样例） |
| P4 | 网络层：protocol/ws-server/longpoll/http-static/room + lan-server | P2 引擎 → net/+server/ | P2 | protocol.mjs 全流程 6 人类过 WS；非法动作拒绝；重连/长轮询降级/关服广播过 | ✅ |
| P5 | 单机化：single-server(127.0.0.1+1人N AI)、LocalClient、mode 三态 | P4 + ui/adapter → single 链路 | P4、P6(接口) | 单人全流程经 LocalClient 与经 NetClient 事件流 diff 一致；Pages 打包脚本可产单文件 | ✅ |
| P6 | UI 重构+标准对齐：style.css、lobby、双主题、命名双轨、缩放、响应式 | ui-design.html+旧 index.html → 新 UI | P1（可与 P2-P4 并行） | 视觉对照表（ui-design 逐项）通过；lan/single 同一 HTML；无 console 报错 | ✅（人工目检+截图） |
| P7 | 动效系统：fx.js + fx-map 逐操作反馈 | P6 渲染钩子 → fx 全量 | P6 | D 节反馈映射表逐项演示通过；AI/人类事件流 fx diff 一致 | ✅ |
| P8 | 音效系统：sfx.js + 事件→音色映射 + 音量/静音/解锁 | ui-design Sfx → 扩展 | P6 | 映射表逐事件发声正确；首手势解锁；reduced-motion 联动 | ✅ |
| P9 | 打包发布：SEA 流水线出双 exe、自动开浏览器、LAN IP/防火墙提示、干净机验证 | P5-P8 产物 → dist/*.exe | P5+P6+P7+P8 | 无 Node 环境 Windows 双击可玩；第二台机器加入成功；`--version` 正常 | ✅（必须干净机实测） |
| P10 | 测试与平衡：conformance runbook 全量执行、AI 统计调参、soak/压力、跨机 LAN | 全部产物 → 测试报告 | P9（跨机）、P3（统计） | conformance 100%；胜率 33/60/7±8；3000 回合 soak 无死锁；每阶段回归门全绿 | ✅（终审数据） |
| P11 | GitHub 执行：G 节 1~7 步（归档/legacy release/Push 两目录/Pages/双 exe release） | 产物+凭据 → 远程仓库终态 | P9+P10 | 远程目录结构与 A.1 一致；Pages URL 可访问且自检过；releases 可见 | ✅（远程逐项核对） |
| P12 | 终验+更新日志：clean checkout 重跑全部 gate、更新日志.md/CHANGELOG、交付报告 | 远程仓库 → 最终报告 | P11 | 从远程 clone 全新跑 gate 全绿；日志与 release 内容一致 | ✅（最终签字） |

**并行安排**：P3（AI）∥ P4（网络）∥ P6（UI）在 P2 后三线并行（目录互不重叠）；P7∥P8 在 P6 后并行；P0/P1/P2/P9/P11 严格串行。主 agent 每阶段结束必须执行"复核"列动作并决定放行/打回。

---

## 前三大风险与缓解

1. **引擎多人化引入回归**（prompts 多槽/调度异步化改坏现有规则语义）：缓解——P2 严格"先别名兼容（test.js 不改即绿）再逐步替换"；suite-d 覆盖双 human 并发挂起；A 套件 40 种子守恒/终结不变式全程回归；任何规则改动只允许在 prompts/调度层，禁止触碰卡牌与结算逻辑。
2. **AI 平衡达不到 requirement 目标（反贼 33/主公方 60/内奸 7）**：缓解——P3 与 P10 独立两个阶段：先架构后调参；ai-stats 提供分身份/分难度/分职业统计与行为回放；允许在"不改规则"前提下引入软性难度补偿（AI 思考深度/保留策略），并把目标设为 ±8 容差、三难度至少两档达标；若仍不达，回写 requirement.txt（文档先行原则）并记录。
3. **打包/联网在目标机器失败**（SEA exe 无法启动、SmartScreen、防火墙拦截、Pages 无服务器误解）：缓解——P9 强制"干净 Windows 机器"验收（无 Node）；构建脚本锁定 node v24 版本并在 README 注明 SmartScreen 预期与 netsh 放行命令；Pages 演示在发布说明中明示"纯单机演示、局域网版请用 oikill-lan.exe"；若 SEA 在 Windows 签名环节出现硬阻，一键切换到备选 bun build --compile（build 层已抽象）。

---

## 附：调研发现（供主 agent 决策参考）

- 旧版可发布 exe 只有 `OIKillServer.exe`（2.96MB，端口 8080）；无旧版客户端 exe（旧版客户端是浏览器）。release 旧版时以此为准，G.3 需人工确认。
- 现有引擎的"响应顺序（逆时针）"在单人类下无歧义，多人化后护驾/特判需要显式顺序队列（requirement FAQ-2：从当前行动者下家起逆时针依次询问，一轮内完成）——已并入 P2 的 prompts 队列设计。
- `test.js` 输出在 GBK 控制台有乱码现象（emoji/中文），P0 阶段建议统一 `chcp 65001` 或改用英文输出，避免 CI/日志误判。
- README 已知"手写快排/放手一搏"曾标注未实装但代码已实装（kspAttack/fangAttack 存在），P10 conformance 时以代码行为为准重新核对。

（完。本方案由只读调研生成，除本交付文件外未修改任何文件；可直接作为任务书分发给 subagent。）
