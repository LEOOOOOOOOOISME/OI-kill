# P8a 音效系统报告（OI杀 v4）

## 产物清单

| 文件 | 操作 |
| --- | --- |
| `v4-web/src/sound/sfx.js` | 新建（音效合成模块，CommonJS、零依赖、Node 安全） |
| `v4-web/src/sound/sfx-test.js` | 新建（自检脚本） |
| `v4-web/docs/p8a-音效报告.md` | 新建（本报告） |

**未修改任何其他文件**（0 处改动），未读取大型文档。

## sfxMap 覆盖表（23 事件）

| 事件 | type | freqs/notes (Hz) | dur (s) | gain | glideTo |
| --- | --- | --- | --- | --- | --- |
| click | tone | 1200 | 0.04 | 0.15 | – |
| select | tone | 880 | 0.06 | 0.18 | – |
| attack | tone | 220 | 0.15 | 0.35 | 110 ↓ |
| block | noise | 180(低通) | 0.08 | 0.25 | – |
| heal | seq | 523→659→784 | 0.30 | 0.22 | – |
| draw | tone | 400 | 0.20 | 0.15 | 900 ↑ |
| drop | tone | 300 | 0.12 | 0.25 | 150 ↓ |
| fun | seq | 392→523→659→784 | 0.40 | 0.25 | – |
| dice | seq | 700→850→950 | 0.25 | 0.25 | – |
| death | tone | 200 | 0.60 | 0.35 | 60 ↓ |
| awake | seq | 440→660 | 0.35 | 0.25 | – |
| judge | tone | 980+1244 | 0.30 | 0.25 | – |
| aoe | noise | 400(低通) | 0.35 | 0.30 | – |
| counter | tone | 600 | 0.15 | 0.30 | 1200 ↑ |
| victory | seq | 523→659→784→1046 | 0.60 | 0.30 | – |
| defeat | seq | 392→330→262 | 0.60 | 0.30 | – |
| achievement | seq | 880→1108→1318 | 0.45 | 0.25 | – |
| countdown | tone | 520（intensity 升频） | 0.15 | 0.30 | – |
| chat | tone | 1000+1250 | 0.09 | 0.10 | – |
| turn | tone | 700 | 0.12 | 0.25 | 500 ↓ |
| error | tone | 220+180（不和谐） | 0.18 | 0.30 | – |
| shield | tone | 350 | 0.20 | 0.25 | 700 ↑ |
| evo | seq | 440→660→880→1320 | 0.50 | 0.30 | – |

全部参数满足边界：freqs/notes/glideTo ∈ [20, 20000] Hz，dur ∈ [0.02, 2] s，gain ∈ [0.01, 1]。

## 关键实现与集成注意（unlock()）

- **unlock() 必须由集成阶段在首次用户手势（click/touch/keydown）中调用**：惰性创建并 resume AudioContext。未解锁前 play() 静默安全（不报错、不出声）。
- AudioContext 仅在 play()/unlock() 内惰性创建，全程 try/catch；Node 或浏览器无 AudioContext（`typeof window==='undefined' || !window.AudioContext`）时所有方法安全 no-op。额外兼容了 `webkitAudioContext`（务实选择）。
- `play(kind, opts)`：`opts.intensity` (0..1) 供 countdown 使用——强度升高音调与音量（freqScale=1+0.75I、gainScale=1+0.3I，峰值再钳制）；`opts.reducedMotion` 为真时仅播放 essential 音效 `error/turn/countdown`（`ESSENTIAL_KINDS`），过滤逻辑抽为纯函数 `shouldPlay(kind, reducedMotion)` 便于测试。
- 合成方式：sine 振荡器（tone/seq）+ 白噪声低通（noise）+ 指数包络防爆音，全部 Web Audio 实时合成，无音频文件。
- 音量：`setVolume(v)` 钳制 0..1 并写 master gain；`setMuted(b)`；`getState()` 返回 `{volume, muted, unlocked, audioContextReady, nodeEnvironment}`。

## 验证结果

- `node --check src\sound\sfx.js` ✅
- `node --check src\sound\sfx-test.js` ✅
- `node src\sound\sfx-test.js` ✅ 退出码 0
- **断言：285/285 通过，0 失败**。覆盖：23 事件全覆盖、配方参数边界（type/dur/gain/freqs/notes/glideTo）、API 形状、Node 下 23 种 play 全部安全 no-op、reduced-motion 过滤（shouldPlay 全组合）、音量钳制/静音/getState/unlock。
