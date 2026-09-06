# P7a 动效系统（fx）交付报告

## 交付物
- 新建 `v4-web/src/ui/fx.js` — 动效系统核心（CommonJS、零依赖、DOM-free 逻辑 + 可选 DOM 钩子）
- 新建 `v4-web/src/ui/fx-test.js` — node 自测（确定性、桩 DOM、退出码联动）
- 本报告 `v4-web/docs/p7a-动效报告.md`
- **未新建/修改任何其它文件**（三个目标文件此前均不存在，均为本次新建）

## fxMap 覆盖表（22 个事件）
| 事件 | cssClass | floatText | durationMs | desc |
| --- | --- | --- | --- | --- |
| playCard | fx-flying | 出牌 | 600 | 卡牌飞入 + 落地 |
| attack | fx-seat-flash-red | 攻击! | 400 | 目标红光闪烁 + 伤害飘字 |
| damage | fx-dmg-float | 伤害 | 500 | 血条损失 + 红色脉冲 |
| heal | fx-seat-flash-green | +1 | 500 | 绿色脉冲 + 治疗飘字 |
| equip | fx-evolve-glow | 装备 | 400 | 装备槽发光 |
| deploy | fx-deploy-bounce | 部署 | 500 | 单位弹跳入场 |
| unitAttack | fx-unit-shards | 交火 | 450 | 交火碰撞 + 碎片 |
| guardBlock | fx-shield-break | 格挡 | 500 | 护盾破碎 |
| evolve | fx-evolve-glow | 进化 | 900 | 金色变形 + 粒子 |
| awaken | fx-banner | 觉醒 | 1200 | 全屏闪光 + 横幅 |
| judge | fx-judge-flip | 判定 | 800 | 卡牌翻转 + 花色揭晓 |
| aoe | fx-wave | AOE | 600 | 环形冲击波 |
| wa | fx-wave | 波纹 | 600 | 蓝色波纹（play 时附加 fx-wave-blue） |
| counter | fx-seat-flash-purple | 反击 | 400 | 紫色闪光 |
| death | fx-seat-collapse | 阵亡 | 900 | 座位坍塌 + 身份翻面（play 时附加 fx-identity-flip） |
| victory | fx-victory-in | 胜利 | 1500 | 胜利结算特效 |
| defeat | fx-victory-in | 败北 | 1500 | 失败结算特效 |
| achievement | fx-ach-pop | 成就达成 | 1000 | 成就弹窗 |
| countdown | fx-seat-flash-red | 倒计时 | 500 | 红色脉冲 |
| turn | fx-turn-halo | 回合开始 | 800 | 光环旋转 |
| chat | fx-chat-pop | 消息 | 300 | 气泡弹出 |
| reject | fx-shake | 无效操作 | 400 | 抖动拒绝 |

## needsCss（26 个类，集成阶段补齐样式）
`fx-ach-pop, fx-banner, fx-chat-pop, fx-deploy-bounce, fx-dmg-float, fx-dmg-float-count, fx-dmg-float-dmg, fx-dmg-float-guard, fx-dmg-float-heal, fx-evolve-glow, fx-flying, fx-identity-flip, fx-judge-flip, fx-particle, fx-seat-collapse, fx-seat-flash-blue, fx-seat-flash-green, fx-seat-flash-purple, fx-seat-flash-red, fx-shake, fx-shield-break, fx-turn-halo, fx-unit-shards, fx-victory-in, fx-wave, fx-wave-blue`

说明：SPEC 示例列表中的 15 个类全部包含在内；另补充了语义所需的类（紫色闪光、波纹蓝色变体、身份翻面、座位坍塌、部署弹跳、光环旋转、聊天气泡）以及 floatText 的 4 个修饰变体类。

## 测试结果
- `node --check src\ui\fx.js` → 通过
- `node --check src\ui\fx-test.js` → 通过
- `node src\ui\fx-test.js` → 输出 `=== 汇总: F通过=34/34 | 断言失败=0 ===`，退出码 0
- 断言构成（34 项）：fxMap 存在(1) + 22 事件条目完整性(22) + 键集合与列举严格一致(1) + needsCss 非空(1) + needsCss 去重/合法/覆盖全部事件主类(1) + createFx({}) 返回全部 9 个方法(1) + 无 DOM 全方法不抛异常(1) + 无 DOM 返回 null/false 占位(1) + 桩 DOM 下 play 覆盖 22 事件(1) + 桩 DOM 下基础方法行为(1) + 确定性快照一致(1) + bindFxBus 订阅/转发/解绑(1) + bindFxBus 缺 on 安全(1)

## 决策备注（SPEC 歧义处的务实选择）
1. **21 vs 22**：SPEC 正文写“21 个事件”，但列举实际为 22 个 → 以列举为准覆盖全部 22 个，测试同步断言 22。
2. **counter 紫色**：示例类表只有红/绿/蓝三色，counter 描述为紫色 → 新增 `fx-seat-flash-purple`。
3. **wa 蓝色波纹**：主类复用 `fx-wave`，play 时附加变体类 `fx-wave-blue`。
4. **无定时器设计**：fx.js 不使用 setTimeout，所有类同步添加，移除/清理交由集成阶段（animationend / CSS 动画结束）；durationMs 会写入 transitionDuration / animationDuration 供 CSS 使用，保证 node 测试确定性。
5. **judgeFlip 回调**：同步调用 cb（无计时器），花色揭晓由回调实现。
6. **bindFxBus**：默认订阅全部 fxMap 事件，可选第三个参数 kinds 过滤；缺少 on 时安全返回空函数。
7. **floatText 修饰类**：kind 参数会追加 `fx-dmg-float-<kind>`（dmg/heal/guard/count），已列入 needsCss。
