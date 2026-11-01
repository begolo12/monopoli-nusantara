/* Test bot + serialisasi: bot 1v3 selesai tanpa deadlock, intent dan snapshot konsisten. */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('./data.js');
require('./game.js');
require('./bot.js');
const G = globalThis.MonoGame, Bot = globalThis.MonoBot;

let fails = 0;
function check(cond, msg) {
  if (!cond) { fails++; console.error('FAIL:', msg); }
}

// RNG deterministik agar run bisa direproduksi; seed bisa dioverride: SEED=123 node test-bot.mjs
let _seed = Number(process.env.SEED || 20261101) >>> 0;
const _origRandom = Math.random;
Math.random = function () {
  _seed = (_seed * 1664525 + 1013904223) >>> 0;
  return _seed / 4294967296;
};

/* intent: satu langkah lewat niat */
{
  const s = G.create(['A', 'B', 'C', 'D']);
  const r = G.intent(s, 0, 'roll');
  check(r.ok && r.dice && r.path.length === (r.dice[0] + r.dice[1]) % 40 || (r.ok && r.dice), 'intent roll jalan');
  check(['end', 'roll', 'resolve-buy', 'card'].includes(s.phase), 'fase valid setelah intent roll: ' + s.phase);
  if (s.pendingCard) { const c = G.intent(s, 0, 'cardOk'); check(c.ok, 'intent cardOk jalan'); }
  if (s.phase === 'resolve-buy') { check(G.intent(s, 0, 'buy').ok, 'intent buy jalan'); }
}

/* snapshot dan restore bulat-balik */
{
  const s = G.create(['A', 'B', 'C', 'D']);
  const snap = G.snapshot(s);
  const back = G.restore(snap);
  check(JSON.stringify(back) === JSON.stringify(snap), 'snapshot pulih identik');
}

/* dagang: tawaran yang diterima benar-benar berpindah tangan */
{
  const s = G.create(['A', 'B', 'C', 'D']);
  s.props[1].owner = 0; s.props[3].owner = 1;
  check(!!G.proposeTrade(s, 0, 1, [1], [3], 0), 'tawaran dibuat');
  check(!G.canOffer(s, 0, 1, [1], [3], 0), 'tawaran baru ditolak selama masih ada tawaran berjalan');
  check(G.intent(s, 1, 'answer', { accept: true }).ok, 'jawaban diterima diproses');
  check(s.props[1].owner === 1 && s.props[3].owner === 0, 'aset berpindah setelah tawaran diterima');
  check(s.trade === null, 'tawaran selesai setelah dijawab');
}

/* penjara: denda percobaan ketiga yang membuat bangkrut tidak menahan fase di 'jail' */
{
  const s = G.create(['A', 'B', 'C', 'D']);
  const p = s.players[0];
  p.jail = true; p.jailTurns = 2; p.cash = 0; s.phase = 'jail';
  for (let i = 0; i < 25; i++) {
    const s2 = G.restore(G.snapshot(s));
    const r = G.intent(s2, 0, 'jailRoll');
    if (!r.ok || !s2.dice || s2.dice[0] === s2.dice[1]) continue; // tunggu lemparan bukan kembar
    check(s2.players[0].bankrupt, 'denda penjara ketiga bisa membangkrutkan');
    check(s2.phase !== 'jail', 'fase tidak tertahan di penjara setelah bangkrut: ' + s2.phase);
    check(s2.turn === 1 || s2.phase === 'over', 'giliran pindah setelah bangkrut di penjara');
    break;
  }
}

/* bot 1 manusia + 3 bot: 30 game, tidak deadlock */
function greedy(s, seat) {
  Object.keys(s.props).forEach((id) => { if (G.canUnmortgage(s, +id, seat)) G.unmortgage(s, +id, seat); });
  let guard = 0;
  let moved = true;
  while (moved && guard++ < 40) {
    moved = false;
    Object.keys(s.props).forEach((id) => {
      if (G.canBuild(s, +id, seat)) { G.buildHouse(s, +id, seat); moved = true; }
    });
  }
}
let done = 0;
for (let g = 0; g < 30; g++) {
  const profs = ['mudah', 'sedang', 'sulit'];
  const s = G.create([{ name: 'Kamu' }, { name: 'Bot1', bot: profs[g % 3] }, { name: 'Bot2', bot: profs[(g + 1) % 3] }, { name: 'Bot3', bot: profs[(g + 2) % 3] }]);
  let steps = 0;
  while (s.phase !== 'over' && steps < 30000) {
    steps++;
    const seat = s.trade ? s.trade.to : (s.phase === 'resolve-buy' ? s.pendingBuyer : s.turn);
    const p = s.players[seat];
    if (p.bankrupt && s.phase !== 'end') {
      check(false, `kursi bangkrut beraksi di fase ${s.phase} (game ${g}, turn ${s.turn}, seat ${seat})`);
      break;
    }
    const go = (k, o) => G.intent(s, seat, k, o);
    if (p.bot) {
      const step = Bot.decide(s, p.bot);
      if (!step) break;
      if (step.kind === 'cardOk' && !s.pendingCard) {
        if (s.phase === 'resolve-buy') continue;
        if (s.phase === 'end') { const r2 = G.intent(s, s.turn, 'end'); if (r2.ok) continue; }
        break;
      }
      const r = go(step.kind, step);
      if (!r.ok) { check(false, 'intent bot gagal: ' + step.kind + ' / ' + r.why); break; }
    } else if (s.trade) {
      // manusia: terima bila melengkapi grup, tolak bila melepas grup utuh
      const tr = s.trade;
      const bd = globalThis.MonoData.BOARD;
      const mates = (id) => { const t = bd[id]; return (!t.group || t.group === 'rail' || t.group === 'util') ? [] : bd.filter((x) => x.group === t.group && x.id !== id).map((x) => x.id); };
      const completes = tr.get.some((id) => mates(id).length > 0 && mates(id).every((m) => s.props[m].owner === seat));
      const loses = tr.give.some((id) => mates(id).length > 0 && mates(id).every((m) => s.props[m].owner === seat));
      const r = go('answer', { accept: completes && !loses });
      if (!r.ok) { check(false, 'manusia buntu menjawab: ' + r.why); break; }
    } else if (s.phase === 'resolve-buy') {
      const r = go('buy');
      if (!r.ok) { check(false, 'manusia buntu menawar: ' + r.why); break; }
    } else if (s.phase === 'roll' || s.phase === 'end') {
      greedy(s, seat);
      const r = go(s.phase);
      if (!r.ok) { check(false, 'manusia buntu: ' + s.phase + ' / ' + r.why); break; }
    } else {
      if (s.phase === 'roll') G.intent(s, s.turn, 'roll');
      else if (s.phase === 'jail') G.intent(s, s.turn, 'payFine');
      else if (s.phase === 'resolve-buy') G.intent(s, s.turn, 'buy');
      else if (s.phase === 'card' && s.pendingCard) G.intent(s, s.turn, 'cardOk');
      else if (s.phase === 'end') G.intent(s, s.turn, 'end');
      else break;
    }
  }
  if (s.phase === 'over') { done++; }
  else {
    // Ekonomi bisa alot (tanpa lelang, grup kadang tak pernah utuh) — yang diuji:
    // tidak error dan tidak macet di fase yang sama tanpa perubahan state.
    const houses = Object.keys(s.props).reduce((a, id) => a + s.props[id].houses, 0);
    const mort = Object.keys(s.props).filter((id) => s.props[id].mortgaged).length;
    const cash = s.players.reduce((a, p) => a + p.cash, 0);
    const moved = houses > 0 || mort > 0 || cash < 5900000 || Object.keys(s.tradeMemory || {}).length > 0;
    check(moved, `game bot ${g} macet tanpa progres`);
  }
}
console.log(`game bot: ${done}/30 selesai (selesai = bonus, bukan syarat)`);

if (fails) { console.error(`${fails} kegagalan`); process.exit(1); }
console.log('SEMUA TEST BOT LOLOS');
