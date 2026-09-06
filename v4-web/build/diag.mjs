// build/diag.mjs — P10a 诊断: 打印每局胜方/轮次/击杀链/终局存活身份
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const O = require('../game.js');
const NAMES6 = ['主', '甲', '乙', '丙', '丁', '戊'];
const N = parseInt(process.argv[2] || '30', 10);
const diff = process.argv[3] || 'normal';

for (let i = 0; i < N; i++) {
  const seed = i + 1;
  const g = O.createGame({ seed, human: 99, difficulty: diff });
  O.setup(g, NAMES6);
  O.startTurn(g, 0);
  let guard = 0;
  while (!g.over && guard++ < 20000) {
    const r = await O.drive(g, { thinkMs: 0 });
    if (r.status === 'prompt') { let d = 0; while (g.pending && d++ < 100) O.timeoutPrompt(g, g.pending.id); }
    else if (r.status === 'human-turn') { if (!g.over) { O.discardPhase(g, r.pid); O.endTurn(g, r.pid); } }
    else if (r.status === 'over' || r.status === 'cap') break;
  }
  const kills = g.log.filter(l => l.txt && l.txt.indexOf('击杀') >= 0).map(l => l.txt);
  const alive = g.players.filter(p => !p.dead).map(p => p.name + '(' + p.identity + ',hp' + p.hp + ')');
  console.log(`seed=${seed} 胜=${g.winner} 回合=${g.round} 存活=${alive.join('/')}`);
  for (const k of kills) console.log('    ' + k);
}
