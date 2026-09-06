// pages-smoke.mjs -- P12a pages 单文件 vm 烟测(镜像 P5 口径)
// 用法: node build/pages-smoke.mjs
// 流程: 在 Node vm 中加载 dist/_pages.js(global.window=globalThis, 无 DOM/无服务器)
//       断言 OIKill 命名空间装配(6 项)
//       随后 createLocalClient(thinkMs:0, pid:0) 驱动 1 人类 + 5 AI 整局:
//       人类提示全部默认"否/放弃"、人类回合 discardPhase+endTurn, 直至 gameover
//       终局断言: over=true、winner 合法、120 牌守恒、提示残留=0、非法动作=0
// Exit: 0 = 全部通过; 1 = 任一失败
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const code = readFileSync(path.join(repoRoot, 'dist', '_pages.js'), 'utf8');

global.window = globalThis;
vm.runInThisContext(code, { filename: '_pages.js' });

const O = globalThis.OIKill;
const checks = [];
const addCheck = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${name.padEnd(34)} ${ok ? 'PASS' : 'FAIL'}  ${detail}`);
};

// ---------- 1. 命名空间装配断言 ----------
addCheck('OIKill 对象存在', !!O && typeof O === 'object', typeof O);
addCheck('ui.adapter.createLocalClient', !!(O && O.ui && O.ui.adapter) && typeof O.ui.adapter.createLocalClient === 'function', 'adapter 已装配');
addCheck('ui.fx.createFx', !!(O && O.ui && O.ui.fx) && typeof O.ui.fx.createFx === 'function', 'fx 已装配');
addCheck('sound.sfx.createSfx', !!(O && O.sound && O.sound.sfx) && typeof O.sound.sfx.createSfx === 'function', 'sfx 已装配');
addCheck('引擎 api(publicView/createGame/drive/timeoutPrompt)', !!O && [O.publicView, O.createGame, O.drive, O.timeoutPrompt].every((f) => typeof f === 'function'), '扁平 api 完整');
const aiMods = ['difficulty', 'scorer', 'identityPolicy', 'heuristics'];
addCheck('OIKill.ai.{difficulty,scorer,identityPolicy,heuristics}', !!(O && O.ai) && aiMods.every((k) => O.ai[k] && typeof O.ai[k] === 'object'), 'AI 四模块已装配');

// ---------- 2. 1 人类 + 5 AI 整局 ----------
const client = O.ui.adapter.createLocalClient(O, { thinkMs: 0, pid: 0, seed: 7 });
let setupMsg = null, gameOverMsg = null, prompts = 0, states = 0, humanTurns = 0;
client.subscribe((m) => {
  if (m.type === 'setup') setupMsg = m;
  else if (m.type === 'state') {
    states++;
    const g = client.getGame();
    if (g && !g.over && g.turn === 0 && O.promptCount(g) === 0) {
      humanTurns++;
      client.sendAction('endTurn');
    }
  } else if (m.type === 'prompt') {
    prompts++;
    if (m.pid === 0) client.sendResponse(m.promptId); // 默认"否/放弃"(harvest/report 由 adapter 转合法空值)
  } else if (m.type === 'event' && m.kind === 'gameover') gameOverMsg = m;
});
await client.join({ name: '烟测' });
await client.start({ humanCount: 1, aiFill: 5, difficulty: 'normal' });

const deadline = Date.now() + 120000;
while (!gameOverMsg && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));

const g = client.getGame();
const LEGAL = ['反贼', '主公方', '内奸(摸鱼怪)'];

// ---------- 守恒计数(与 ai-stats.mjs / suite-d.js totalCards 同法) ----------
const isRealCard = (c) => !!c && c.id !== -1;
const _seenCtx = new WeakSet();
function countCtxCards(ctx, acc) {
  if (!ctx || typeof ctx !== 'object' || _seenCtx.has(ctx)) return;
  _seenCtx.add(ctx);
  if (Array.isArray(ctx.cards)) for (const c of ctx.cards) if (isRealCard(c)) acc.t += 1;
  if (ctx.cont && typeof ctx.cont === 'object') countCtxCards(ctx.cont.ctx || ctx.cont, acc);
}
function totalCards(gg) {
  let t = 0;
  for (const c of gg.deck) if (isRealCard(c)) t += 1;
  for (const c of gg.discard) if (isRealCard(c)) t += 1;
  for (const p of gg.players) {
    for (const c of p.hand) if (isRealCard(c)) t += 1;
    if (isRealCard(p.weapon)) t += 1;
    if (isRealCard(p.armor)) t += 1;
    for (const c of p.units) if (isRealCard(c)) t += 1;
    for (const c of p.delayArea) if (isRealCard(c)) t += 1;
  }
  const acc = { t };
  if (gg.prompts) for (const e of gg.prompts.values()) countCtxCards(e.ctx, acc);
  if (gg._promptGroups) for (const gr of gg._promptGroups.values()) {
    const ctx = gr && gr.resume && gr.resume.ctx;
    countCtxCards(ctx, acc);
  }
  return acc.t;
}

// ---------- 3. 终局断言 ----------
addCheck('setup: total=6, pid=0', !!(setupMsg && setupMsg.total === 6 && setupMsg.pid === 0), setupMsg ? `total=${setupMsg.total} pid=${setupMsg.pid}` : 'setup 未收到');
addCheck('对局推进至 gameover', !!gameOverMsg, gameOverMsg ? `winner=${gameOverMsg.payload.winner}` : '120s 内未 gameover');
addCheck('g.over === true', !!(g && g.over), g ? String(g.over) : 'g 不存在');
addCheck('winner 合法阵营', !!(g && LEGAL.includes(g.winner)), g ? g.winner : 'g 不存在');
const cards = g ? totalCards(g) : -1;
addCheck('终局 120 牌守恒', cards === 120, `cards=${cards}`);
const leak = g ? O.promptCount(g) : -1;
addCheck('终局提示残留=0', leak === 0, `promptCount=${leak}`);
const illegal = g ? g.log.filter((l) => l.txt && l.txt.indexOf('[AI] 跳过非法动作') >= 0).length : -1;
addCheck('非法动作=0', illegal === 0, `illegal=${illegal}`);
addCheck('事件流正常(states>0)', states > 0, `states=${states} prompts=${prompts} humanTurns=${humanTurns} rounds=${g ? g.round : '?'}`);

client.stop();

const allOk = checks.every((c) => c.ok);
console.log(allOk ? '=== PAGES SMOKE ALL PASS ===' : '=== PAGES SMOKE SOME FAILED ===');
process.exitCode = allOk ? 0 : 1;
await new Promise((r) => setTimeout(r, 200));
