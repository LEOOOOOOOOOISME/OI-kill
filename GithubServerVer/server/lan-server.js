/*!
 * lan-server.js — 《OI杀》v4 多人局域网版入口（mode: lan, 房主即服务器）
 *
 * 依据：recon-02 §B.1（绑定 0.0.0.0; 加入方浏览器零安装打开 http://<host-ip>:<port>）。
 * 接线：boot.runServer 选定端口后, 把 http-static（服务 v4-web 根）+ ws-server（主推传输）+
 *       longpoll（兜底传输）+ room（房间/权威层）挂到同一 http server; q 安全退出。
 * 运行：node server/lan-server.js [--no-browser]
 */
'use strict';

const path = require('node:path');
const { createStatic } = require('../src/net/http-static.js');
const { createWsServer } = require('../src/net/ws-server.js');
const { createLongPoll } = require('../src/net/longpoll.js');
const { createRoom } = require('../src/net/room.js');
const engine = require('../src/engine/index.js');
const { runServer } = require('./boot.js');

runServer({
  mode: 'lan',
  host: '0.0.0.0',
  noBrowser: process.argv.includes('--no-browser'),
  createApp(server) {
    // 注意顺序: 长轮询先于静态注册（http-static 依据 req.__oikillHandled 跳过已处理请求,
    // 若静态先注册, GET /poll 会先触发 fs 探测, 回调时响应已发 → ERR_HTTP_HEADERS_SENT）
    const lp = createLongPoll({ server, logInbound: false });
    const ws = createWsServer({ server });
    const stat = createStatic({ server, rootDir: path.join(__dirname, '..') }); // 服务 v4-web 根(index.html + src/**)
    const room = createRoom({ engine, mode: 'lan' });
    room.attachWs(ws);
    room.attachLongPoll(lp);
    return {
      room,
      close() { stat.close(); lp.close(); ws.shutdown(); },
    };
  },
}).catch((e) => {
  console.error('[lan-server] 启动失败: ' + (e && e.message));
  process.exit(1);
});
