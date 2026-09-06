/* ============================================================================
 * OI杀 v4.0 · test/ai-stats.mjs — AI 对局统计与平衡度量 (P3-6 / P10a)
 * 用法(workdir = v4-web 或任意):
 *   node test/ai-stats.mjs [N=200] [difficulty=normal] [--seed base=1] [--quiet] [--no-human]
 * 例:
 *   node test\ai-stats.mjs 200 normal            # 200 局 normal
 *   node test\ai-stats.mjs 500 hard --seed 777   # 500 局 hard, 种子 777+i
 *   node test\ai-stats.mjs 100 easy --quiet      # 只打汇总表
 *   node test\ai-stats.mjs 200 normal --no-human # 全 AI 局(无人类座位, 对照 p3b 基线口径)
 *
 * 对局模型 A(默认, 与 suite-d.js D06 完全同法):
 *   createGame({seed, humans:[0], difficulty}) → 1 人类座位(恒为 0 号=主公, setup 固定)
 *   该人类座位的一切挂起提示经 timeoutPrompt 秒答"否/放弃"; 人类回合直接弃牌+结束;
 *   其余 5 座位 AI 由引擎 drive({thinkMs:0}) 驱动(关闭人形延迟, 决策用 g.difficulty 档)。
 * 对局模型 B(--no-human): createGame({seed, human:99}) → 6 座位全 AI, 无任何挂起提示,
 *   与 p3b 报告的 10 局/档基线同口径(平衡目标 33/60/7 即按该口径标定)。
 * 统计口径(win-share, 非每阵营独立胜率):
 *   每局恰有一个胜方阵营(反贼/主公方/内奸); 阵营胜场占比 = 胜场数 / 总局数 ×100%。
 * 度量:
 *   winner 阵营分布 / 平均回合数(g.round) / 平均行动轮数(turnsPlayed 合计) /
 *   崩溃(未捕获异常) / 非法动作(日志 [AI] 跳过非法动作, 零容忍) /
 *   终局牌张守恒 120 / 终局提示无泄漏 / 单局 drive 步进 cap。
 * ==========================================================================*/
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const O = require(path.join(here, '..', 'game.js'));

const NAMES6 = ['主', '甲', '乙', '丙', '丁', '戊'];
const DIFFS = ['easy', 'normal', 'hard'];
const VALID_DIFFS = new Set(DIFFS);

/* ---------- CLI ---------- */
const argv = process.argv.slice(2);
let N = 200;
let difficulty = 'normal';
let seedBase = 1;
let quiet = false;
let noHuman = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--quiet') quiet = true;
  else if (a === '--no-human') noHuman = true;
  else if (a === '--seed') seedBase = parseInt(argv[++i], 10) || 1;
  else if (VALID_DIFFS.has(a)) difficulty = a;
  else if (/^\d+$/.test(a)) N = parseInt(a, 10);
}
if (!VALID_DIFFS.has(difficulty)) { console.error('未知难度: ' + difficulty + ' (可用: ' + DIFFS.join('/') + ')'); process.exit(2); }
if (!(N >= 1 && N <= 100000)) { console.error('N 需在 [1, 100000]'); process.exit(2); }

/* ---------- 守恒计数(与 suite-d.js totalCards 同法 + P10a 扩展) ---------- */
/* P10a 扩展: 对局结束时仍挂起的提示共享 ctx(harvest 展示牌, 含特判连锁 cont.ctx 嵌套) —
 * 引擎内部临时持有、未计入任何常规区域; 递归计入后才可与 120 对齐(见报告 §守恒口径)。 */
function isRealCard(c) { return !!c && c.id !== -1; }
const _seenCtx = new WeakSet();
function countCtxCards(ctx, acc) {
  if (!ctx || typeof ctx !== 'object' || _seenCtx.has(ctx)) return; // 共享 ctx 去重(提示/组恢复点引用同一对象)
  _seenCtx.add(ctx);
  if (Array.isArray(ctx.cards)) for (const c of ctx.cards) if (isRealCard(c)) acc.t += 1;
  if (ctx.cont && typeof ctx.cont === 'object') countCtxCards(ctx.cont.ctx || ctx.cont, acc);
}
function totalCards(g) {
  let t = 0;
  for (const c of g.deck) if (isRealCard(c)) t += 1;
  for (const c of g.discard) if (isRealCard(c)) t += 1;
  for (const p of g.players) {
    for (const c of p.hand) if (isRealCard(c)) t += 1;
    if (isRealCard(p.weapon)) t += 1;
    if (isRealCard(p.armor)) t += 1;
    for (const c of p.units) if (isRealCard(c)) t += 1;
    for (const c of p.delayArea) if (isRealCard(c)) t += 1;
  }
  const acc = { t };
  if (g.prompts) for (const e of g.prompts.values()) countCtxCards(e.ctx, acc);
  if (g._promptGroups) for (const gr of g._promptGroups.values()) {
    const ctx = gr && gr.resume && gr.resume.ctx;
    countCtxCards(ctx, acc);
  }
  return acc.t;
}

/* ---------- 单局 ---------- */
async function runOne(seed, diff) {
  const g = noHuman
    ? O.createGame({ seed, human: 99, difficulty: diff })
    : O.createGame({ seed, humans: [0], difficulty: diff });
  O.setup(g, NAMES6);
  O.startTurn(g, 0);
  const rec = {
    seed, winner: null, rounds: 0, turns: 0,
    prompts: 0, humanTurns: 0, cap: false, illegal: 0, cards: -1, promptLeak: 0, crash: null,
  };
  let guard = 0;
  let lastStatus = null;
  try {
    while (!g.over && guard++ < 20000) {
      const r = await O.drive(g, { thinkMs: 0 });
      lastStatus = r.status;
      if (r.status === 'prompt') {
        rec.prompts++;
        let d = 0;
        while (g.pending && d++ < 200) O.timeoutPrompt(g, g.pending.id);
      } else if (r.status === 'human-turn') {
        rec.humanTurns++;
        if (!g.over) { O.discardPhase(g, r.pid); O.endTurn(g, r.pid); }
      } else if (r.status === 'over') break;
      else if (r.status === 'cap') { rec.cap = true; break; }
    }
    if (g.over && lastStatus !== 'over') await O.drive(g, { thinkMs: 0 });
    rec.winner = g.winner || null;
    rec.rounds = g.round;
    rec.turns = g.players.reduce((s, p) => s + (p.turnsPlayed || 0), 0);
    rec.cards = totalCards(g);
    rec.promptLeak = O.promptCount(g);
    for (const l of g.log) if (l.txt && l.txt.indexOf('[AI] 跳过非法动作') >= 0) rec.illegal++;
  } catch (e) {
    rec.crash = String((e && e.stack) || e);
  }
  return rec;
}

/* ---------- 汇总 ---------- */
const CAMP = ['反贼', '主公方', '内奸(摸鱼怪)'];
function summarize(recs) {
  const byCamp = { '反贼': 0, '主公方': 0, '内奸(摸鱼怪)': 0 };
  let rounds = 0, turns = 0, crashes = 0, illegal = 0, badCards = 0, leaks = 0, caps = 0, nWin = 0;
  for (const r of recs) {
    if (r.winner && byCamp[r.winner] !== undefined) { byCamp[r.winner]++; nWin++; }
    rounds += r.rounds; turns += r.turns;
    if (r.crash) crashes++;
    illegal += r.illegal;
    if (r.cards !== 120) badCards++;
    if (r.promptLeak > 0) leaks++;
    if (r.cap) caps++;
  }
  const n = recs.length;
  const pct = (x) => (n > 0 ? (100 * x / n).toFixed(1) + '%' : 'n/a');
  return { n, byCamp, nWin, rounds, turns, crashes, illegal, badCards, leaks, caps, pct };
}

/* ---------- 主流程 ---------- */
const t0 = Date.now();
const recs = [];
for (let i = 0; i < N; i++) {
  const rec = await runOne(seedBase + i, difficulty);
  recs.push(rec);
  if (!quiet) {
    const w = rec.winner || '(无)';
    const bad = rec.crash ? ' 崩溃!' : (rec.illegal ? ` 非法×${rec.illegal}!` : '');
    const cardBad = rec.cards !== 120 ? ` 守恒${rec.cards}!` : '';
    const capBad = rec.cap ? ' CAP!' : '';
    process.stdout.write(
      `#${String(i + 1).padStart(4)} seed=${rec.seed} 胜=${w} 回合=${rec.rounds} 轮=${rec.turns}${bad}${cardBad}${capBad}\n`);
  }
}
const ms = Date.now() - t0;
const s = summarize(recs);

console.log('\n========== 汇总: %d 局 @ %s%s (种子 %d..%d) ==========',
  s.n, difficulty, noHuman ? ' [全AI]' : ' [1人类+5AI]', seedBase, seedBase + N - 1);
for (const c of CAMP) {
  const share = s.nWin > 0 ? (100 * s.byCamp[c] / s.nWin).toFixed(1) + '%' : 'n/a';
  console.log(`  胜方阵营: ${c.padEnd(7)} 胜场=${s.byCamp[c]}  占总局=${s.pct(s.byCamp[c])}  占已判胜局=${share}`);
}
if (s.nWin < s.n) console.log(`  (未判胜负局: ${s.n - s.nWin})`);
console.log('  平均回合数: ' + (s.rounds / s.n).toFixed(1) + ' | 平均行动轮数: ' + (s.turns / s.n).toFixed(1));
console.log(`  崩溃=${s.crashes} 非法动作局数累加=${s.illegal} 守恒失败=${s.badCards} 终局提示残留=${s.leaks}(信息项) cap=${s.caps}`);
console.log(`  耗时=${(ms / 1000).toFixed(1)}s (${(s.n / (ms / 1000)).toFixed(0)} 局/s)`);
const ok = s.crashes === 0 && s.illegal === 0 && s.badCards === 0 && s.caps === 0 && s.nWin === s.n;
console.log(ok ? '  健康检查: 全部通过 ✓ (终局提示残留仅作信息: 对局中途结算终止时引擎未清空的挂起组)' : '  健康检查: 存在异常 ✗');
console.log('====================================================\n');
if (!ok) process.exitCode = 3;
