/*!
 * pages-entry.js — Pages 单文件离线演示入口(P5 打包)
 *
 * 与 index.html 的脚本装载结果等价(16 个 <script src> + fx/sfx 模块垫片):
 *   1. require 引擎聚合 src/engine/index.js —— 其 Node 分支按序加载 data/* + engine/*,
 *      末尾拉起 ai/heuristics(→ difficulty/scorer/identity-policy), 全部模块挂共享命名空间
 *      OIKill.data.* / OIKill.engine.* / OIKill.ai.*, 并返回扁平引擎 api(旧 54 键 + P2 新增 4 键)。
 *   2. 按 index.html 的 ai 依赖序显式 require 四个 AI 模块(幂等, 与引擎聚合内的加载互不冲突)。
 *   3. require 纯 CommonJS 的 src/ui/fx.js、src/sound/sfx.js、src/ui/adapter.js
 *      (Node 分支只导出、不自动挂命名空间, 由本入口统一装配)。
 *   4. 与浏览器 game.js 行为一致: window.OIKill = 扁平引擎 api;
 *      再挂 OIKill.ai.* / OIKill.ui.* / OIKill.sound.* —— index.html 的内联 UI 脚本在运行时
 *      引用 OIKill.ui.adapter / OIKill.ui.fx / OIKill.sound.sfx(见 boot() 的 bootLocal 分支)。
 *
 * 注: 引擎/数据/AI 模块在加载期各自捕获共享命名空间引用(NS), window.OIKill 被替换为扁平 api
 * 不影响它们的运行时互引(与 game.js 浏览器分支同构, 已由 core.js/battle.js/tricks.js 的
 * NS.ai.* 运行时查找验证)。
 */
'use strict';
(function () {
  const root = (typeof window !== 'undefined') ? window : globalThis;

  // 1. 引擎聚合(内部完成 data/* + engine/* + ai/heuristics 的按序加载)
  const engine = require('../src/engine/index.js');

  // 2. AI 模块按 index.html 依赖序显式加载(difficulty → scorer → identity-policy → heuristics)
  require('../src/ai/difficulty.js');
  require('../src/ai/scorer.js');
  require('../src/ai/identity-policy.js');
  require('../src/ai/heuristics.js');

  // 3. UI / 音效(纯 CommonJS, Node 分支仅 module.exports)
  const adapter = require('../src/ui/adapter.js');
  const fx = require('../src/ui/fx.js');
  const sfx = require('../src/sound/sfx.js');

  // 4. 装配 window.OIKill(与 game.js 浏览器分支一致: 扁平 api), 再挂子命名空间
  const shared = root.OIKill || {};   // 各模块闭包持有的共享命名空间(装配后仍被引擎内部引用)
  const ai = Object.assign({}, shared.ai);

  root.OIKill = engine;
  engine.ai = ai;
  engine.ui = { adapter: adapter, fx: fx };
  engine.sound = { sfx: sfx };

  // 5. 自检: 内联 UI 脚本(bootLocal: createLocalClient + openSetupModal)运行时依赖的关键子槽
  const missing = [];
  if (!engine.ui.adapter || typeof engine.ui.adapter.createLocalClient !== 'function') missing.push('ui.adapter(createLocalClient)');
  if (!engine.ui.fx || typeof engine.ui.fx.createFx !== 'function') missing.push('ui.fx(createFx)');
  if (!engine.sound.sfx || typeof engine.sound.sfx.createSfx !== 'function') missing.push('sound.sfx(createSfx)');
  if (typeof engine.publicView !== 'function' || typeof engine.createGame !== 'function' ||
      typeof engine.drive !== 'function' || typeof engine.timeoutPrompt !== 'function') {
    missing.push('engine(publicView/createGame/drive/timeoutPrompt)');
  }
  if (missing.length) throw new Error('[pages-entry] OIKill 命名空间装配缺失: ' + missing.join(' / '));
})();
