// smoke-http.mjs -- P12a SEA exe byte-exact smoke test (Node, cross-platform)
// Usage: node build/smoke-http.mjs <exe-path> [--check-index]
// Flow:  spawn exe --no-browser (stdio piped)
//        parse banner for 127.0.0.1:<port> (35s cap)
//        GET /api/hello            -> 200 + ok:true
//        GET /                     -> 200 + byte-equal disk index.html
//        GET /src/data/cards.js    -> 200 + byte-equal disk source
//        GET /src/engine/core.js   -> 200 + byte-equal disk source
//                                     + must contain 'duelTurns' and 'tiebreakExtra'
//                                     (proves refreshed balance rules are baked in)
//        [--check-index] GET /index.html -> 200 + byte-equal disk index.html
//        stdin 'q' -> wait exit (8s cap) -> assert exitCode 0
//        assert extraction dir %TEMP%/oikill-static-<pid>/root has >= 28 files
// Exit: 0 = all checks passed; 1 = any failure
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const exePath = path.resolve(process.argv[2]);
const checkIndex = process.argv.includes('--check-index');

const checks = [];
const addCheck = (name, ok, detail) => checks.push({ name, ok, detail });

const diskOf = (rel) => path.join(repoRoot, rel);

async function getBytes(base, rel) {
  const res = await fetch(base + rel);
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, buf };
}

const child = spawn(exePath, ['--no-browser'], {
  cwd: path.dirname(exePath),
  stdio: ['pipe', 'pipe', 'pipe'],
});
const pidOfExe = child.pid;

// --- parse banner ---
let banner = '';
let port = null;
const deadline = Date.now() + 35000;
const lineReader = (async () => {
  let buf = '';
  for await (const chunk of child.stdout) {
    buf += chunk.toString('utf8');
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, '');
      buf = buf.slice(i + 1);
      banner += line + '\n';
      const m = line.match(/127\.0\.0\.1:(\d+)/);
      if (m && !port) port = Number(m[1]);
    }
  }
})();
while (!port && Date.now() < deadline) {
  if (child.exitCode !== null) break;
  await new Promise((r) => setTimeout(r, 100));
}
lineReader.catch(() => {});

if (!port) {
  console.log('SMOKE FAIL: no port parsed within 35s (exe may have failed to start)');
  console.log('--- banner so far ---');
  console.log(banner);
  try { child.kill(); } catch {}
  process.exitCode = 1;
  await lineReader;
  await new Promise((r) => setTimeout(r, 300));
  throw new Error('no port');
}

const base = `http://127.0.0.1:${port}`;

// 1) /api/hello
try {
  const { status, buf } = await getBytes(base, '/api/hello');
  const okJson = /"ok"\s*:\s*true/.test(buf.toString('utf8'));
  addCheck('/api/hello', status === 200 && okJson, `HTTP ${status} okJson=${okJson}`);
} catch (e) { addCheck('/api/hello', false, 'exception: ' + e.message); }

// 2) / and /index.html -- byte-equal disk index.html
const indexDisk = await readFile(diskOf('index.html'));
try {
  const { status, buf } = await getBytes(base, '/');
  addCheck('/', status === 200 && buf.equals(indexDisk), `HTTP ${status} identicalToDisk=${buf.equals(indexDisk)} bytes=${buf.length}`);
} catch (e) { addCheck('/', false, 'exception: ' + e.message); }
if (checkIndex) {
  try {
    const { status, buf } = await getBytes(base, '/index.html');
    addCheck('/index.html', status === 200 && buf.equals(indexDisk), `HTTP ${status} identicalToDisk=${buf.equals(indexDisk)} bytes=${buf.length}`);
  } catch (e) { addCheck('/index.html', false, 'exception: ' + e.message); }
}

// 3) /src/data/cards.js -- byte-equal disk
const cardsDisk = await readFile(diskOf('src/data/cards.js'));
try {
  const { status, buf } = await getBytes(base, '/src/data/cards.js');
  addCheck('/src/data/cards.js', status === 200 && buf.equals(cardsDisk), `HTTP ${status} identicalToDisk=${buf.equals(cardsDisk)} bytes=${buf.length}`);
} catch (e) { addCheck('/src/data/cards.js', false, 'exception: ' + e.message); }

// 4) /src/engine/core.js -- byte-equal disk + new balance rule markers
const coreDisk = await readFile(diskOf('src/engine/core.js'));
try {
  const { status, buf } = await getBytes(base, '/src/engine/core.js');
  const txt = buf.toString('utf8');
  const hasDuel = txt.includes('duelTurns');
  const hasTie = txt.includes('tiebreakExtra');
  addCheck('/src/engine/core.js', status === 200 && buf.equals(coreDisk) && hasDuel && hasTie,
    `HTTP ${status} identicalToDisk=${buf.equals(coreDisk)} bytes=${buf.length} hasDuelTurns=${hasDuel} hasTiebreakExtra=${hasTie}`);
} catch (e) { addCheck('/src/engine/core.js', false, 'exception: ' + e.message); }

// 5) clean exit via 'q'
child.stdin.write('q\n');
let exited = false;
try { exited = await Promise.race([new Promise((r) => child.once('exit', () => r(true))), new Promise((r) => setTimeout(() => r(false), 8000))]); } catch {}
if (!exited) { try { child.kill(); } catch {} }
addCheck('clean-exit', exited && child.exitCode === 0, `exited=${exited} exitCode=${child.exitCode}`);
let err = '';
try { for await (const c of child.stderr) err += c.toString('utf8'); } catch {}
banner += `\n${err ? '--- stderr ---\n' + err : ''}`;
try { await lineReader; } catch {}

// 6) extraction dir file count
try {
  const tmpRoot = path.join(tmpdir(), `oikill-static-${pidOfExe}`, 'root');
  let n = 0;
  const walk = async (dir) => {
    for (const d of await import('node:fs/promises').then((m) => m.readdir(dir, { withFileTypes: true }))) {
      const p = path.join(dir, d.name);
      if (d.isDirectory()) await walk(p); else n++;
    }
  };
  await walk(tmpRoot);
  addCheck('extract-dir', n >= 28, `${tmpRoot} files=${n}`);
} catch (e) { addCheck('extract-dir', false, 'exception: ' + e.message); }

// --- report ---
console.log(`=== SMOKE RESULT for ${exePath} ===`);
let allOk = true;
for (const c of checks) {
  if (!c.ok) allOk = false;
  console.log(`${c.name.padEnd(22)} ${c.ok ? 'PASS' : 'FAIL'}  ${c.detail}`);
}
console.log('--- banner ---');
console.log(banner.trimEnd());
console.log(allOk ? 'ALL PASS' : 'SOME FAILED');
process.exitCode = allOk ? 0 : 1;
// let child stdio streams drain/close naturally to avoid libuv closing-handle asserts
await new Promise((r) => setTimeout(r, 300));
