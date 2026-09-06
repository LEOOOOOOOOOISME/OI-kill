/*!
 * emit-static-map.mjs — P9 SEA: 把 UI 需要的全部静态文件(index.html + src/**)序列化为一个 CJS 模块
 *
 * 产物: build/static-map.generated.js
 *   module.exports = { "index.html": "<内容>", "src/data/cards.js": "<内容>", ... }
 *   (每个值都是 JSON.stringify(文件原文), 保证生成文件是合法 JS 且逐字节可还原)
 *
 * 规则: 确定性(键按字典序、内容原文不加工)、不跳过任何文件(index.html + src 下递归全部文件)。
 * 用法: node build/emit-static-map.mjs        (也可被 bundle-server.mjs import 后调用 emitStaticMap())
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

/** 递归收集 base 目录下全部文件(含隐藏文件; 符号链接按文件读取), 返回根相对路径(正斜杠) */
function collectFiles(dir, base, out) {
  const names = readdirSync(dir, { withFileTypes: true }).map((d) => d.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    const abs = path.join(dir, name);
    const ent = readdirSync(dir, { withFileTypes: true }).find((d) => d.name === name);
    if (ent.isDirectory()) collectFiles(abs, base, out);
    else if (ent.isFile() || ent.isSymbolicLink()) out.push(path.relative(base, abs).split(path.sep).join('/'));
  }
  return out;
}

/** 生成 build/static-map.generated.js; 返回 { outFile, entries, bytes, total } */
export function emitStaticMap() {
  const rels = collectFiles(path.join(root, 'src'), root, ['index.html']);
  rels.sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));

  const map = {};
  let total = 0;
  for (const rel of rels) {
    const content = readFileSync(path.join(root, rel), 'utf8'); // 原文, 不做任何加工
    map[rel] = content;
    total += Buffer.byteLength(content, 'utf8');
  }

  const lines = [
    '/*! 本文件由 build/emit-static-map.mjs 自动生成 — 勿手改。内容 = index.html + src/** 的完整快照 */',
    "'use strict';",
    'module.exports = {',
  ];
  for (const rel of rels) lines.push(JSON.stringify(rel) + ': ' + JSON.stringify(map[rel]) + ',');
  lines.push('};');
  lines.push('');

  const outFile = path.join(here, 'static-map.generated.js');
  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, lines.join('\n'), 'utf8');

  const size = statSync(outFile).size;
  console.log('[emit-static-map] ✓ ' + rels.length + ' 个文件 → ' + path.basename(outFile) + ' (' + size + ' 字节; 内容合计 ' + total + ' 字节)');
  return { outFile, entries: rels, bytes: size, total };
}

/* 直接执行(node build/emit-static-map.mjs)时也生成; 被 import 时不重复执行 */
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  emitStaticMap();
}
