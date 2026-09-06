# P9 SEA 单可执行文件构建报告

> 执行：P9 subagent（SEA 打包流水线）
> 环境：Node v24.18.1、npm 11.16.0（npm 镜像可用）、postject@1.0.0-alpha.6
> 结论：**全部任务完成，双 exe 构建成功，HTTP 烟测全绿，干净退出。** 仅改动 `server\boot.js`（只加内存静态解包逻辑）与 `build\`、`dist\`、`docs\p9-SEA报告.md`；未动 `index.html` / `src\*` / `tests`。

## 0. 核心结论

| 产物 | 大小 | 烟测 |
|---|---|---|
| `dist\oikill-lan.exe` | 93,774,336 B（89.43 MiB） | ✅ 全绿，exit 0 |
| `dist\oikill-single.exe` | 93,774,848 B（89.43 MiB） | ✅ 全绿，exit 0 |

P5 留下的边界（http-static 读盘、SEA 内无磁盘）已解决：SEA bundle 把 `index.html + src/**`（共 29 个文件）内联进 bundle，boot.js 启动时解包到 `os.tmpdir()/oikill-static-<pid>/root`，并把静态根目录指向该临时目录。exe 运行时**不依赖任何外部文件、不需要目标机器装 Node**。

## 1. 流水线文件清单

| 文件 | 说明 | 状态 |
|---|---|---|
| `build\emit-static-map.mjs` | 读取 index.html + src\**（递归、含隐藏/符号链接、不跳过任何文件）→ 生成 `build\static-map.generated.js`（`module.exports = {"index.html":"<内容>",...}`，JSON.stringify 原文，键字典序 → 确定性） | ✅ 新建，`node --check` 通过 |
| `build\static-map.generated.js` | 静态快照：**29 个文件**，642,836 B（内容合计 628,086 B） | ✅ 生成 |
| `build\bundle-server.mjs` | 先跑 emitStaticMap，再 esbuild 双 bundle（entry=server/lan-server.js、single-server.js；`--bundle --platform=node --format=cjs`），注入 SEA defines；末尾 node --check + define 生效自检 | ✅ 更新 |
| `build\sea-lan.json` / `build\sea-single.json` | SEA 配置 `{"main":"dist/bundle-*.cjs","output":"dist/*.blob","disableExperimentalSEAWarning":true}` | ✅ 新建 |
| `build\smoke-exe.ps1` | 双 exe 烟测脚本（重定向 stdin/stdout 启动 → 解析横幅端口 → 4/5 项 HTTP 断言 → stdin 写 'q' → 断言 exit 0 + 临时解包目录 + 端口释放；纯 ASCII 源码防 PS 5.1 编码坑） | ✅ 新建 |
| `server\boot.js` | **唯一被改的服务端文件**：仅新增 SEA 静态解包逻辑（守卫式 require + 解包 + 日志），dev 模式零影响（实测） | ✅ 仅加逻辑 |
| `dist\bundle-lan.cjs` / `dist\bundle-single.cjs` | SEA 前体（静态快照已内联，BUILD_MODE 注入） | ✅ 1,107,579 / 1,108,188 B |
| `dist\lan.blob` / `dist\single.blob` | `node --experimental-sea-config` 产物 | ✅ 1,107,623 / 1,108,235 B |
| `dist\oikill-lan.exe` / `dist\oikill-single.exe` | node.exe 复制 + postject 注入 | ✅ 见上表 |

## 2. 关键实现：静态资源内存化（不碰 lan/single-server、不碰 http-static）

- **快照**：`emit-static-map.mjs` 把 index.html 与 src\ 下全部 28 个文件（data/engine/ai/net/ui/sound，含测试文件——按"skip nothing"要求）逐字节序列化。输出键形如 `"index.html"`、`"src/data/cards.js"`（正斜杠，与 http-static 的 rel 计算一致）。
- **接线（boot.js 顶部，守卫式 + 懒加载）**：
  ```js
  let staticMap = null;
  try {
    if (globalThis.__OI_SEA__ || (typeof STATIC_MAP !== 'undefined' && STATIC_MAP)) {
      staticMap = require('../build/static-map.generated.js');
    }
  } catch (e) { /* dev 环境无该文件时静默 */ }
  ```
  dev 模式（直接 `node server/*.js`，无 define）条件恒假 → 不 require、行为零变化（实测：dev 启动无解包日志、不建临时目录）。
  SEA bundle 中该 require 被 esbuild **打包内联**，运行时无外部文件依赖。
- **解包**：若 staticMap 存在 → `os.tmpdir()/oikill-static-<pid>/root`（mkdirSync recursive + writeFileSync，utf8）逐条落盘，打印 `[boot] 静态资源已解包至 <dir> (29 个文件)`；失败兜底指向 os.tmpdir()（静态 404 但服务器不崩）。
- **rootDir 重定向（唯一需要解释的坑）**：lan/single-server 里 `rootDir = path.join(__dirname, '..')` 是硬编码，而任务只允许改 boot.js。解法：SEA bundle 额外注入 `--define:__dirname=globalThis.__OI_STATIC_ROOT__`，boot.js 在模块加载期（早于 createApp 执行）设 `globalThis.__OI_STATIC_ROOT__ = path.join(rootDir, 'sea')`，使 `path.join(该值, '..')` 归一化恰为解包目录。http-static 本身零改动、照常读"磁盘"（=临时目录）。已用 bundle 自检验证：入口行编译为 `path.join(globalThis.__OI_STATIC_ROOT__, "..")`。
- **与任务推荐模式的一处必要偏差**：任务示例 `let STATIC_MAP = null; ... STATIC_MAP = require(...)` 若原样照抄，会被 `--define:STATIC_MAP=1` 替换成 `let 1 = null` / `1 = require(...)` → 语法错误。故变量改名为 `staticMap`，`STATIC_MAP=1` define 仍按任务原样注入，经 `typeof STATIC_MAP` 守卫消费。
- **SEA defines（仅注入两个 bundle）**：`BUILD_MODE='lan'|'single'`、`STATIC_MAP=1`、`globalThis.__OI_SEA__=true`、`__dirname=globalThis.__OI_STATIC_ROOT__`。bundle-server 自检：`__OI_STATIC_ROOT__` 恰好出现 3 次（boot 两次赋值 + 入口一次使用）、`path.join(globalThis.__OI_STATIC_ROOT__` 存在、无 `__OI_SEA__`/`STATIC_MAP` 残留。

## 3. SEA 构建步骤执行记录

1. `npm install -D postject` → **postject@1.0.0-alpha.6**（devDependencies，package-lock 已更新）。
2. `node build\emit-static-map.mjs` → 29 文件快照。
3. `node build\bundle-server.mjs` → 双 bundle，esbuild 5 条既有 warning（引擎源码重复键/重复 case，P5 已记录，非本次引入），exit 0。
4. `node --experimental-sea-config build\sea-lan.json` / `build\sea-single.json` → `Wrote single executable preparation blob to dist\lan.blob`（单例同）。
5. `Copy-Item (node -p process.execPath)` → dist\oikill-lan.exe / oikill-single.exe；`npx postject ... NODE_SEA_BLOB ... --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2` 双双 `💉 Injection done!`。postject 警告 `The signature seems corrupted!` = 预期（Authenticode 签名被注入破坏 → SmartScreen 提示，见第 6 节）。

## 4. 烟测结果（exe 内真实运行，非 node 解释）

端口策略：8080 空闲（实测 free），两 exe 均绑定 **8080**。断言含**逐字节全等**校验（磁盘原文 vs 解包后服务内容），证明内联/解包链路无损。

**oikill-lan.exe --no-browser**（横幅：多人局域网版 mode:lan）：

| 检查 | 结果 | 明细 |
|---|---|---|
| GET /api/hello | **HTTP 200** | ok:true |
| GET / | **HTTP 200** | 含"OI杀"，与磁盘 index.html 全等（104,066 B） |
| GET /src/data/cards.js | **HTTP 200** | 与磁盘全等（12,731 B） |
| GET /src/engine/core.js | **HTTP 200** | 与磁盘全等（95,090 B，含模板字面量 → 证明 esbuild 字符串转义无损） |
| 干净退出 | PASS | stdin 'q' → **exitCode=0** |
| 临时解包目录 | PASS | `...\Temp\oikill-static-16232\root` 含 **29 个文件**（横幅打印 `[boot] 静态资源已解包至 ...`） |
| 端口释放 | PASS | 8080 无监听 |

**oikill-single.exe --no-browser**（横幅：单人版 mode:single，绑定 8080）：

| 检查 | 结果 | 明细 |
|---|---|---|
| GET /api/hello | **HTTP 200** | ok:true |
| GET / | **HTTP 200** | 含"OI杀"，与磁盘全等 |
| GET /src/data/cards.js | **HTTP 200** | 与磁盘全等 |
| GET /src/engine/core.js | **HTTP 200** | 与磁盘全等 |
| GET /index.html | **HTTP 200** | 含"OI杀" |
| 干净退出 | PASS | stdin 'q' → **exitCode=0** |
| 临时解包目录 | PASS | `...\Temp\oikill-static-16032\root` 29 文件 |
| 端口释放 | PASS | 8080 无监听 |

**dev 模式零影响**：`node server\lan-server.js --no-browser` 实测 hello 200、无解包日志、不建临时目录 ✅。

## 5. 验证清单

- `node --check` 全部通过：`build\emit-static-map.mjs`、`build\bundle-server.mjs`、`build\static-map.generated.js`、`server\boot.js`、`dist\bundle-lan.cjs`、`dist\bundle-single.cjs`（fail 数 = 0）。
- 双 exe 均：能启动、能服务、`q` 退出码 0、解包目录 29 文件、端口释放。

## 6. 给用户/后续阶段的注意事项

1. **未签名 exe**：SmartScreen 首次运行弹"更多信息"→"仍要运行"属预期（postject 注入必然破坏 Authenticode 签名）；发布说明需写明，可选自签。
2. **体积**：exe ≈ 89.4 MiB = Node v24 运行时本体（+ 约 1.1 MB 注入的 blob），属方案预期（recon-02 C.1 预估 85~90MB）。
3. **目标机器无需 Node**：运行时就绪；静态 UI 全部内嵌，无文件可被外部看到。
4. **控制台窗口常驻**（设计如此）：显示版本/模式、本机与局域网地址、防火墙提示（`netsh advfirewall firewall add rule name="OIKill" dir=in action=allow protocol=TCP localport=<port>`）、`输入 q 回车安全退出`。
5. **并行改动注意**：执行期间检测到其他 agent 正在改 `src\ai\scorer.js`、`identity-policy.js` 等（19:38 仍在写入）。快照 = 构建时刻的 src 状态；**发布/验收前必须重跑流水线刷新快照**（重跑即得最新 UI，流水线本身对固定源码是确定性的）。
6. 端口策略：8080 → 8081..8099 → 0 随机；烟测横幅解析法可确定实际端口（`127\.0\.0\.1:(\d+)`）。

## 7. 供后续阶段复用的精确命令（workdir = v4-web）

```bat
:: 依赖（一次性）
npm install -D esbuild postject

:: 1) 静态快照（可单独跑）
node build\emit-static-map.mjs

:: 2) SEA 双 bundle（先自动跑快照再打包，含 node --check + define 自检）
node build\bundle-server.mjs

:: 3) blob
node --experimental-sea-config build\sea-lan.json
node --experimental-sea-config build\sea-single.json

:: 4) 复制 node.exe（须与构建用 Node 同大版本 v24）并注入
Copy-Item (node -p process.execPath) dist\oikill-lan.exe
Copy-Item (node -p process.execPath) dist\oikill-single.exe
npx postject dist\oikill-lan.exe NODE_SEA_BLOB dist\lan.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
npx postject dist\oikill-single.exe NODE_SEA_BLOB dist\single.blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

:: 5) 烟测（自动起 exe → HTTP 断言 → 'q' 干净退出 → exit 0/1）
pwsh -NoProfile -File build\smoke-exe.ps1 -ExePath dist\oikill-lan.exe
pwsh -NoProfile -File build\smoke-exe.ps1 -ExePath dist\oikill-single.exe -CheckIndexHtml
```
