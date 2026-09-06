/*!
 * bundle-pages.mjs — P5 打包: 生成 dist/oikill-pages.html(单文件离线演示)
 *
 * 流程:
 *   1. esbuild 打包 build/pages-entry.js(引擎聚合+AI+UI 适配层+动效+音效)
 *      → dist/_pages.js(--bundle --format=iife --minify --platform=browser)
 *   2. 读 index.html: 把 16 个外部 <script src> 标签(9 引擎/数据 + net-api + 4 AI +
 *      adapter + lobby)以及 fx.js/sfx.js 两个外部模块及其 3 个垫片内联脚本, 整体替换为
 *      单块内联 <script>(bundle 内容); 内联 <style> 与 UI 逻辑内联 <script> 原样保留。
 *   3. 写 dist/oikill-pages.html 并做结构自检:
 *      <script src= 计数 = 0; 内联 <script> 恰 2 个(bundle + UI); UI 脚本标记存在。
 *
 * 产物可用浏览器直接 file:// 打开: UI boot() 检测 file: 协议 → LocalClient 直驱引擎 + 5 AI
 * (/api/hello 探活失败亦走同一回落路径)。
 */
import { build } from 'esbuild';
import { readFileSync, writeFileSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const distDir = path.join(root, 'dist');
const pagesJs = path.join(distDir, '_pages.js');
const pagesHtml = path.join(distDir, 'oikill-pages.html');

mkdirSync(distDir, { recursive: true });

// ---- 1. esbuild 打包(平台=browser, IIFE, 压缩) ----
await build({
  entryPoints: [path.join(here, 'pages-entry.js')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  minify: true,
  target: ['es2018'],
  outfile: pagesJs,
  logLevel: 'info',
});
const bundle = readFileSync(pagesJs, 'utf8');

// ---- 2. 组装单文件 HTML ----
let html = readFileSync(path.join(root, 'index.html'), 'utf8');

// 脚本区: 从第一个引擎 <script src> 到 UI 内联脚本开头(<script>\nconst O = window.OIKill;)
const startMark = '<script src="src/data/cards.js"></script>';
const endMark = '<script>\nconst O = window.OIKill;';
const i0 = html.indexOf(startMark);
const i1 = html.indexOf(endMark);
if (i0 < 0 || i1 < 0 || i1 <= i0) {
  console.error('[bundle-pages] ✗ index.html 脚本区定位失败(i0=' + i0 + ', i1=' + i1 + '), 结构可能已变化');
  process.exit(1);
}
html = html.slice(0, i0) + '<script>\n' + bundle + '\n</script>\n' + html.slice(i1);

writeFileSync(pagesHtml, html);

// ---- 3. 结构自检 ----
const srcTags = (html.match(/<script\s+src=/g) || []).length;
const inlineOpen = (html.match(/<script>/g) || []).length;
const closeTags = (html.match(/<\/script>/g) || []).length;
const hasUiScript = html.indexOf(endMark) >= 0;
const hasLocalClient = bundle.indexOf('createLocalClient') >= 0;
const size = statSync(pagesHtml).size;
const bundleSize = statSync(pagesJs).size;

console.log('[bundle-pages] 产物: ' + pagesHtml);
console.log('[bundle-pages] 文件尺寸: ' + size + ' 字节 (' + (size / 1024).toFixed(1) + ' KiB)');
console.log('[bundle-pages] bundle 尺寸: ' + bundleSize + ' 字节 (' + (bundleSize / 1024).toFixed(1) + ' KiB)');
console.log('[bundle-pages] 自检: <script src= 数量 = ' + srcTags + ' (期望 0)');
console.log('[bundle-pages] 自检: 内联 <script> 数量 = ' + inlineOpen + ' (期望 2: bundle + UI)');
console.log('[bundle-pages] 自检: </script> 数量 = ' + closeTags + ' (期望 2)');
console.log('[bundle-pages] 自检: UI 内联脚本保留 = ' + hasUiScript);
console.log('[bundle-pages] 自检: createLocalClient 存在于 bundle = ' + hasLocalClient);

const ok = srcTags === 0 && inlineOpen === 2 && closeTags === 2 && hasUiScript && hasLocalClient;
if (!ok) {
  console.error('[bundle-pages] ✗ 结构自检未通过');
  process.exit(1);
}
console.log('[bundle-pages] ✓ 结构自检通过(单块引擎 bundle + 原 UI 内联脚本)');
