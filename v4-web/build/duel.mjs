// build/duel.mjs — P10a 诊断: 统计 lord vs traitor 单挑的进入状态与结局
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const O = require('../game.js');
const NAMES6 = ['主', '甲', '乙', '丙', '丁', '戊'];
const N = parseInt(process.argv[2] || '200', 10);
const diff = process.argv[3] || 'normal';
const ROWS = [];

for (let i = 0; i < N; i++) {
  const seed = i + 1;
  const g = O.createGame({ seed, human: 99, difficulty: diff });
  O.setup(g, NAMES6);
  O.startTurn(g, 0);
  let duelEntry = null;
  const snap = () => {
    if (duelEntry) return;
    const al = g.players.filter(p => !p.dead);
    if (al.length === 2 && al.some(p => p.identity === 'lord') && al.some(p => p.identity === 'traitor')) {
      const lord = al.find(p => p.identity === 'lord');
      const tra = al.find(p => p.identity === 'traitor');
      duelEntry = {
        lordHp: lord.hp, traHp: tra.hp, lordHand: lord.hand.length, traHand: tra.hand.length,
        lordWeapon: !!lord.weapon, traWeapon: !!tra.weapon, lordArmor: !!lord.armor, traArmor: !!tra.armor,
        rounds: g.round,
      };
    }
  };
  let guard = 0;
  while (!g.over && guard++ < 20000) {
    const r = await O.drive(g, { thinkMs: 0, onState: snap });
    if (r.status === 'prompt') { let d = 0; while (g.pending && d++ < 100) O.timeoutPrompt(g, g.pending.id); }
    else if (r.status === 'human-turn') { if (!g.over) { O.discardPhase(g, r.pid); O.endTurn(g, r.pid); } }
    else if (r.status === 'over' || r.status === 'cap') break;
  }
  const tie = g.log.some(l => l.txt && l.txt.indexOf('保底终局') >= 0);
  if (duelEntry) ROWS.push(Object.assign({ seed, winner: g.winner, tie, endRounds: g.round }, duelEntry));
}
console.log('seed winner lordHp traHp lordHand traHand lordW traW lordA traA entryRounds endRounds tie');
for (const r of ROWS) console.log(`${r.seed} ${r.winner} ${r.lordHp} ${r.traHp} ${r.lordHand} ${r.traHand} ${r.lordWeapon ? 1 : 0} ${r.traWeapon ? 1 : 0} ${r.lordArmor ? 1 : 0} ${r.traArmor ? 1 : 0} ${r.rounds} ${r.endRounds} ${r.tie ? 1 : 0}`);
const lw = ROWS.filter(r => r.winner === '主公方');
const tw = ROWS.filter(r => r.winner === '内奸(摸鱼怪)');
const tieW = ROWS.filter(r => r.tie);
console.log(`\n单挑总数=${ROWS.length} 主公方胜=${lw.length} 内奸胜=${tw.length} 其中平票=${tieW.length}`);
const avg = (arr, k) => arr.length ? (arr.reduce((s, r) => s + r[k], 0) / arr.length).toFixed(2) : 'n/a';
console.log(`主公方胜局 entry: hp=${avg(lw, 'lordHp')}/${avg(lw, 'traHp')} hand=${avg(lw, 'lordHand')}/${avg(lw, 'traHand')}`);
console.log(`内奸胜局   entry: hp=${avg(tw, 'lordHp')}/${avg(tw, 'traHp')} hand=${avg(tw, 'lordHand')}/${avg(tw, 'traHand')}`);
const hpAdv = ROWS.filter(r => r.lordHp - r.traHp >= 1);
console.log(`主公 entry hp 领先≥1: ${hpAdv.length} 局, 其中主公方胜=${hpAdv.filter(r => r.winner === '主公方').length} 内奸胜=${hpAdv.filter(r => r.winner === '内奸(摸鱼怪)').length}`);
const hpDis = ROWS.filter(r => r.traHp - r.lordHp >= 1);
console.log(`内奸 entry hp 领先≥1: ${hpDis.length} 局, 其中主公方胜=${hpDis.filter(r => r.winner === '主公方').length} 内奸胜=${hpDis.filter(r => r.winner === '内奸(摸鱼怪)').length}`);
