/*!
 * bundle-server.mjs — P9 SEA: 服务端 SEA 前体 bundle 流水线
 *
 * 步骤:
 *   1) emitStaticMap(): 生成 build/static-map.generated.js (index.html + src/** 快照)
 *   2) esbuild 双 bundle(均 --bundle --platform=node --format=cjs), 注入 SEA 编译常量:
 *        BUILD_MODE              = 'lan' | 'single'
 *        STATIC_MAP              = 1                  (SEA 显式标记)
 *        globalThis.__OI_SEA__   = true               (boot.js 守卫条件恒真)
 *        __dirname               = globalThis.__OI_STATIC_ROOT__  (boot.js 在模块加载期设置;
 *                                                      使 path.join(__dirname,'..') 归一化到解包目录)
 *      boot.js 里守卫式 require('../build/static-map.generated.js') 因此被打包内联,
 *      exe 运行时无任何外部文件依赖。dev 模式不经过本脚本(直接 node server/*.js), 零影响。
 *   3) node --check + define 生效自检(不得残留裸 __dirname; 必须含 __OI_STATIC_ROOT__)
 *
 * 产物:
 *   dist/bundle-lan.cjs     ← server/lan-server.js
 *   dist/bundle-single.cjs  ← server/single-server.js
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, statSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emitStaticMap } from './emit-static-map.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const distDir = path.join(root, 'dist');
mkdirSync(distDir, { recursive: true });

/* 1) 先刷新静态资源快照 —— esbuild 随后会把它内联进 bundle */
const mapInfo = emitStaticMap();
const r = spawnSync(process.execPath, ['--check', mapInfo.outFile], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error('[bundle-server] ✗ static-map.generated.js 语法校验失败:\n' + (r.stderr || r.stdout));
  process.exit(1);
}
console.log('[bundle-server] ✓ static-map.generated.js node --check 通过');

const base = { bundle: true, platform: 'node', format: 'cjs', target: ['node24'], logLevel: 'info' };

const jobs = [
  { entry: path.join(root, 'server', 'lan-server.js'), out: path.join(distDir, 'bundle-lan.cjs'), mode: 'lan' },
  { entry: path.join(root, 'server', 'single-server.js'), out: path.join(distDir, 'bundle-single.cjs'), mode: 'single' },
];

/* SEA 编译常量(仅注入两个 SEA bundle; dev 直接跑源码时不存在) */
const seaDefines = {
  STATIC_MAP: '1',
  'globalThis.__OI_SEA__': 'true',
  __dirname: 'globalThis.__OI_STATIC_ROOT__',
};

for (const j of jobs) {
  await build({
    ...base,
    entryPoints: [j.entry],
    outfile: j.out,
    define: { BUILD_MODE: JSON.stringify(j.mode), ...seaDefines },
  });
}

let ok = true;
for (const j of jobs) {
  const src = readFileSync(j.out, 'utf8');
  const problems = [];
  const r = spawnSync(process.execPath, ['--check', j.out], { encoding: 'utf8' });
  if (r.status !== 0) problems.push('node --check 失败: ' + (r.stderr || r.stdout).split('\n')[0]);
  // define 生效自检(注意: static-map 快照内容以模板字符串内联, 其中会合法出现 __dirname 等字样, 故只做正向断言)
  const rootRefs = (src.match(/globalThis\.__OI_STATIC_ROOT__/g) || []).length; // 期望: boot.js 2 次赋值 + 入口 1 次使用 = 3
  if (rootRefs !== 3) problems.push('globalThis.__OI_STATIC_ROOT__ 出现 ' + rootRefs + ' 次(期望 3)');
  if (!src.includes('path.join(globalThis.__OI_STATIC_ROOT__')) problems.push('define __dirname 未作用于入口的 path.join(__dirname,\'..\')');
  if (src.includes('__OI_SEA__')) problems.push('define globalThis.__OI_SEA__ 未生效(残留标识符)');
  if (src.includes('STATIC_MAP')) problems.push('define STATIC_MAP 未生效(残留标识符)');
  if (problems.length) {
    ok = false;
    for (const p of problems) console.error('[bundle-server] ✗ ' + path.basename(j.out) + ': ' + p);
  } else {
    console.log('[bundle-server] ✓ ' + path.basename(j.out) + ' (' + statSync(j.out).size + ' 字节; node --check + define 自检通过)');
  }
}

if (!ok) {
  console.error('[bundle-server] ✗ 至少一个服务端 bundle 校验未通过');
  process.exit(1);
}
console.log('[bundle-server] ✓ 两个 SEA bundle 就绪(静态资源已内联; 下一步: node --experimental-sea-config → postject)');
