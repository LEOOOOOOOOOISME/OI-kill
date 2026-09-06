// build/dup-find.mjs — P10a: 找 seed 88 hard 1-human 终局重复牌
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const O = require('../game.js');
const seed = parseInt(process.argv[2] || '88', 10);
const diff = process.argv[3] || 'hard';
const g = O.createGame({ seed, humans: [0], difficulty: diff });
O.setup(g, ['主', '甲', '乙', '丙', '丁', '戊']);
O.startTurn(g, 0);
(async () => {
  let gu = 0;
  while (!g.over && gu++ < 20000) {
    const r = await O.drive(g, { thinkMs: 0 });
    if (r.status === 'prompt') { let d = 0; while (g.pending && d++ < 100) O.timeoutPrompt(g, g.pending.id); }
    else if (r.status === 'human-turn') { if (!g.over) { O.discardPhase(g, r.pid); O.endTurn(g, r.pid); } }
    else if (r.status === 'over' || r.status === 'cap') break;
  }
  const seen = new Map();
  const add = (where, c) => { if (!c || c.id === -1) return; if (!seen.has(c.id)) seen.set(c.id, []); seen.get(c.id).push(where); };
  for (const c of g.deck) add('deck', c);
  for (const c of g.discard) add('discard', c);
  for (const p of g.players) {
    for (const c of p.hand) add(p.name + '.hand', c);
    if (p.weapon) add(p.name + '.weapon', p.weapon);
    if (p.armor) add(p.name + '.armor', p.armor);
    for (const c of p.units) add(p.name + '.unit', c);
    for (const c of p.delayArea) add(p.name + '.delay', c);
  }
  for (const e of g.prompts.values()) if (e.ctx && Array.isArray(e.ctx.cards)) for (const c of e.ctx.cards) add('ctx', c);
  let dup = 0;
  for (const [id, ws] of seen) if (ws.length > 1) { dup++; console.log('DUP id=' + id + ' at ' + ws.join(',')); }
  console.log('distinct real cards:', seen.size, 'dups:', dup);
  console.log('deck=' + g.deck.length + ' discard=' + g.discard.length);
  console.log('winner=' + g.winner + ' rounds=' + g.round);
  console.log('last logs:');
  for (const l of g.log.slice(-12)) console.log('  [' + l.t + '] ' + l.txt);
})();
