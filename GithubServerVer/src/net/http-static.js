/*!
 * http-static.js — 《OI杀》v4 静态文件服务（零依赖，仅 node:http/node:fs/node:path/node:url）
 *
 * 依据：recon-02 B.1（浏览器零安装加入：http://<局域网IP>:<port>）。
 *   - 服务 v4-web 文件（index.html + src/**），GET/HEAD
 *   - Content-Type 映射（html/js/css/text/json/图片/音频等），Content-Length + no-cache
 *   - 路径穿越防护：path.resolve 后必须以 rootDir 开头（rootDir 本身或 rootDir + sep），否则 404
 *   - 内置 /api/hello 健康检查路由：{ ok:true, proto:1, time }（传输层探活，非协议 hello 消息）
 * 与其它 http 模块共存约定：req.__oikillHandled 为 true 时直接跳过（长轮询已处理）。
 * 注：dev 环境为磁盘读文件；SEA 构建（recon-02 C.2）将改为内存路由，接口不变。
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wasm': 'application/wasm',
};

function createStatic(opts) {
  if (!opts || !opts.server || !opts.rootDir) {
    throw new Error('[http-static] createStatic 需要 { server, rootDir[, indexFile] }');
  }
  const server = opts.server;
  const rootDir = path.resolve(opts.rootDir);
  const indexFile = opts.indexFile || 'index.html';

  function sendJson(res, code, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(body);
  }

  function onRequest(req, res) {
    if (req.__oikillHandled) return; // 长轮询等模块已处理
    if (req.method !== 'GET' && req.method !== 'HEAD') return; // 非本模块职责
    const u = new url.URL(req.url || '/', 'http://oikill.local');
    let pathname;
    try {
      pathname = decodeURIComponent(u.pathname);
    } catch (e) {
      req.__oikillHandled = true;
      return sendJson(res, 400, { ok: false, why: 'bad url encoding' });
    }

    if (pathname === '/api/hello') {
      req.__oikillHandled = true;
      const body = JSON.stringify({ ok: true, proto: 1, time: Date.now() });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(req.method === 'HEAD' ? undefined : body);
    }

    const rel = pathname === '/' ? indexFile : pathname.replace(/^\/+/, '');
    const full = path.resolve(rootDir, rel);
    // 路径穿越防护：解析结果必须仍在 rootDir 内（rootDir 本身或其子路径）
    if (full !== rootDir && !full.startsWith(rootDir + path.sep)) {
      req.__oikillHandled = true;
      return sendJson(res, 404, { ok: false, why: 'not found' });
    }

    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) {
        req.__oikillHandled = true;
        return sendJson(res, 404, { ok: false, why: 'not found' });
      }
      req.__oikillHandled = true;
      const ctype = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Content-Type': ctype,
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(full)
        .on('error', () => { try { res.destroy(); } catch (e) { /* 忽略 */ } })
        .pipe(res);
    });
  }

  server.on('request', onRequest);

  return {
    rootDir,
    close() { server.removeListener('request', onRequest); },
  };
}

module.exports = { createStatic };
