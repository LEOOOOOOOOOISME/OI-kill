// build/leak-hunt.mjs — P10a: 定位 1-human easy 守恒≠120 的牌去向
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const O = require('../game.js');
const NAMES6 = ['主', '甲', '乙', '丙', '丁', '戊'];
function isRealCard(c) { return !!c && c.id !== -1; }
function totalCards(g, extra) {
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
  return t;
}
for (let i = 0; i < 200; i++) {
  const seed = i + 1;
  const g = O.createGame({ seed, humans: [0], difficulty: 'easy' });
  O.setup(g, NAMES6);
  O.startTurn(g, 0);
  let guard = 0;
  while (!g.over && guard++ < 20000) {
    const r = await O.drive(g, { thinkMs: 0 });
    if (r.status === 'prompt') { let d = 0; while (g.pending && d++ < 100) O.timeoutPrompt(g, g.pending.id); }
    else if (r.status === 'human-turn') { if (!g.over) { O.discardPhase(g, r.pid); O.endTurn(g, r.pid); } }
    else if (r.status === 'over' || r.status === 'cap') break;
  }
  const t = totalCards(g);
  if (t !== 120) {
    let promptCards = 0, groupCards = 0;
    for (const e of g.prompts.values()) if (e.ctx && Array.isArray(e.ctx.cards)) for (const c of e.ctx.cards) if (isRealCard(c)) promptCards++;
    if (g._promptGroups) for (const gr of g._promptGroups.values()) {
      const ctx = gr && gr.resume && gr.resume.ctx;
      if (ctx && Array.isArray(ctx.cards)) for (const c of ctx.cards) if (isRealCard(c)) groupCards++;
    }
    console.log(`seed=${seed} winner=${g.winner} rounds=${g.round} total=${t} promptCards=${promptCards} groupCards=${groupCards} promptsLeft=${g.prompts.size}`);
    for (const e of g.prompts.values()) console.log('   prompt:', e.type, 'pid=' + e.pid);
    // pendingEvo / evoWait 检查
    const pendEvo = Object.values(g.pendingEvo || {}).reduce((s, a) => s + a.length, 0);
    if (pendEvo) console.log('   pendingEvo entries=' + pendEvo);
    if (g.evoWait) console.log('   evoWait=', JSON.stringify(g.evoWait));
  }
}
