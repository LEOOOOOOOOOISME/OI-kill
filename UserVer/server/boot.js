/*!
 * boot.js — 《OI杀》v4 服务端共用启动引导（lan-server / single-server 共用, 零依赖）
 *
 * 依据：recon-02 §B.1 / §C.3（端口策略 / UTF-8 横幅 / 局域网 IP / 防火墙提示 / q 安全退出 / 自动开浏览器）。
 *
 * 端口策略：先试 8080 → 8081..8099 → 全占则绑 0（OS 随机分配）。
 * 局域网 IP：os.networkInterfaces() 过滤非回环 IPv4（排除 127.0.0.1 / 0.0.0.0 / internal），
 *             与旧版 C++ main.cpp（gethostname+getaddrinfo+inet_ntoa, 排除 127.0.0.1/0.0.0.0）同法。
 * 自动开浏览器：child_process.exec('start http://127.0.0.1:<port>')（Windows, 经 cmd /c）；
 *              --no-browser 关闭。
 * 安全退出：stdin 输入 q → 广播 server-shutdown → 关闭传输/HTTP → 退出码 0。
 * 控制台子系统：本文件只用 console/stdin/stdout（GUI=0 控制台程序, 打包时须保持 console subsystem）。
 */
'use strict';

const os = require('node:os');
const http = require('node:http');
const readline = require('node:readline');
const { exec } = require('node:child_process');

const VERSION = 'v4.0.0';

/* 端口候选: 8080 → 8081..8099 → 0(OS 随机) */
const PORT_CANDIDATES = (() => {
  const list = [];
  for (let p = 8080; p <= 8099; p++) list.push(p);
  list.push(0);
  return list;
})();

/** 局域网 IPv4 列表（与旧 C++ main.cpp 同法: 非回环 IPv4, 排除 127.0.0.1 / 0.0.0.0） */
function lanIPv4() {
  const out = [];
  const ifs = os.networkInterfaces();
  for (const name of Object.keys(ifs)) {
    for (const a of ifs[name] || []) {
      if (a.family === 'IPv4' && !a.internal && a.address && a.address !== '0.0.0.0' && a.address !== '127.0.0.1') {
        out.push(a.address);
      }
    }
  }
  return Array.from(new Set(out));
}

function listenOnce(host, port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.once('error', (e) => {
      try { srv.close(); } catch (e2) { /* 忽略 */ }
      reject(e);
    });
    srv.listen(port, host, () => resolve(srv));
  });
}

/** 按候选表顺序绑定, 返回 { server, port } */
async function pickPort(host) {
  let lastErr = null;
  for (const port of PORT_CANDIDATES) {
    try {
      const srv = await listenOnce(host, port);
      return { server: srv, port: srv.address().port };
    } catch (e) {
      lastErr = e;
      if (!e || (e.code !== 'EADDRINUSE' && e.code !== 'EACCES')) throw e;
    }
  }
  throw lastErr || new Error('[boot] 端口全部占用');
}

function printBanner(info) {
  const mode = info.mode === 'single' ? 'single' : 'lan';
  const modeZh = mode === 'single' ? '单人版' : '多人局域网版';
  const port = info.port;
  const ips = lanIPv4();
  console.log('================================================');
  console.log('  《OI杀》 ' + (info.version || VERSION) + ' · ' + modeZh + '  (mode: ' + mode + ')');
  console.log('================================================');
  console.log('  本机地址:   http://127.0.0.1:' + port + '/');
  if (ips.length) {
    for (const ip of ips) console.log('  局域网地址: http://' + ip + ':' + port + '/');
  } else {
    console.log('  局域网地址: (未检测到非回环 IPv4, 请检查网卡/防火墙)');
  }
  console.log('  其它设备无法访问时, 请在房主电脑以管理员运行:');
  console.log('    netsh advfirewall firewall add rule name="OIKill" dir=in action=allow protocol=TCP localport=' + port);
  console.log('  输入 q 回车安全退出 (退出前广播 server-shutdown)');
}

/** 自动打开默认浏览器（Windows 用 cmd start; 失败静默, 不影响服务器） */
function openBrowser(port) {
  const url = 'http://127.0.0.1:' + port;
  let cmd;
  if (process.platform === 'win32') cmd = 'start "" "' + url + '"';
  else if (process.platform === 'darwin') cmd = 'open "' + url + '"';
  else cmd = 'xdg-open "' + url + '"';
  exec(cmd, (err) => { /* 无图形环境/无浏览器时静默忽略 */ });
}

/**
 * 共用启动流程：
 *   opts = { mode:'lan'|'single', host?, version?, noBrowser?, createApp(server) }
 *   createApp 必须返回 { room, close() }（close 卸载静态/长轮询/WS）。
 * 返回 { server, port, app, exitClean }；q/SIGINT/SIGTERM → exitClean（广播关停→关传输→退出码 0）。
 */
async function runServer(opts) {
  if (!opts || typeof opts.createApp !== 'function') {
    throw new Error('[boot] runServer 需要 { createApp(server) }');
  }
  const mode = opts.mode === 'single' ? 'single' : 'lan';
  const host = opts.host || (mode === 'single' ? '127.0.0.1' : '0.0.0.0');

  // UTF-8 控制台: 旧版同法(chcp 65001); 子进程 chcp 不影响父控制台, 现代终端默认 UTF-8, 尽力而为
  if (process.platform === 'win32') {
    try { exec('chcp 65001 >nul', () => {}); } catch (e) { /* 忽略 */ }
  }

  const { server, port } = await pickPort(host);
  const app = opts.createApp(server);
  printBanner({ mode, version: opts.version || VERSION, port });
  if (!opts.noBrowser) openBrowser(port);

  let exiting = false;
  const exitClean = (reason) => {
    if (exiting) return;
    exiting = true;
    try { if (app.room) app.room.shutdown(reason || '服务器关闭'); } catch (e) { /* 忽略 */ }
    try { if (app.close) app.close(); } catch (e) { /* 忽略 */ }
    try {
      server.close(() => process.exit(0));
    } catch (e) {
      process.exit(0);
    }
    setTimeout(() => process.exit(0), 2000).unref(); // 兜底: 挂起连接不阻塞退出
  };

  try {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('line', (line) => {
      if (String(line).trim().toLowerCase() === 'q') exitClean('房主退出');
    });
  } catch (e) { /* 无 stdin 环境(如双击 exe)时忽略, 仍有信号路径 */ }
  process.on('SIGINT', () => exitClean('进程中断'));
  process.on('SIGTERM', () => exitClean('进程终止'));

  return { server, port, app, exitClean };
}

module.exports = { VERSION, PORT_CANDIDATES, lanIPv4, pickPort, printBanner, openBrowser, runServer };
