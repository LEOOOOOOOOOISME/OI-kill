/*!
 * single-server.js — 《OI杀》v4 单人版入口（mode: single）
 *
 * 依据：recon-02 §B.1（绑定 127.0.0.1; 1 人类 + N AI; 跳过大厅直进对局）。
 * N 来源（默认 5）：
 *   - 命令行: node server/single-server.js --ai=4
 *   - 浏览器地址查询参数: http://127.0.0.1:<port>/?ai=4（首页请求捕获, 早于 join 生效）
 * 接线与 lan-server 相同（同一份 UI/协议/房间代码）; autoStart 在首个玩家 join 后立即开局。
 * 运行：node server/single-server.js [--ai=N] [--no-browser]
 */
'use strict';

const path = require('node:path');
const { createStatic } = require('../src/net/http-static.js');
const { createWsServer } = require('../src/net/ws-server.js');
const { createLongPoll } = require('../src/net/longpoll.js');
const { createRoom } = require('../src/net/room.js');
const engine = require('../src/engine/index.js');
const { runServer } = require('./boot.js');

/* 解析 AI 数: --ai=N(2~5 有效, 默认 5); ?ai=N 查询参数(0~5, 不足 3 总人数时房间层自动补 AI 至 3 人局) */
let aiFill = 5;
const cli = process.argv.find((a) => a.indexOf('--ai=') === 0);
if (cli) {
  const n = parseInt(cli.slice(5), 10);
  if (Number.isInteger(n) && n >= 0 && n <= 5) aiFill = n;
}

runServer({
  mode: 'single',
  host: '127.0.0.1',
  noBrowser: process.argv.includes('--no-browser'),
  createApp(server) {
    // 捕获首页请求的 ?ai=N（先于 http-static 注册, 不响应只读取）
    server.on('request', (req) => {
      const m = /[?&]ai=(\d+)/.exec(req.url || '');
      if (m) {
        const n = parseInt(m[1], 10);
        if (Number.isInteger(n) && n >= 0 && n <= 5) aiFill = n;
      }
    });

    const lp = createLongPoll({ server, logInbound: false });
    const ws = createWsServer({ server });
    const stat = createStatic({ server, rootDir: path.join(__dirname, '..') }); // 长轮询先注册(见 lan-server 注释)
    const room = createRoom({
      engine,
      mode: 'single',
      autoStart: () => ({ humanCount: 1, aiFill, randomIdentity: false, difficulty: 'normal' }),
    });
    room.attachWs(ws);
    room.attachLongPoll(lp);
    return {
      room,
      close() { stat.close(); lp.close(); ws.shutdown(); },
    };
  },
}).catch((e) => {
  console.error('[single-server] 启动失败: ' + (e && e.message));
  process.exit(1);
});
