/* Smoke test mesin aturan: simulasi game acak + invariant. Jalankan: node test.mjs */
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('./data.js');
require('./game.js');
const G = globalThis.MonoGame;
const D = globalThis.MonoData;

let fails = 0;
function check(cond, msg) {
  if (!cond) { fails++; console.error('FAIL:', msg); }
}

function invariants(s, tag) {
  s.players.forEach((p) => check(p.cash >= 0, `${tag}: cash negatif ${p.name} ${p.cash}`));
  Object.keys(s.props).forEach((id) => {
    const pr = s.props[id], t = D.BOARD[id];
    check(pr.houses >= 0 && pr.houses <= 5, `${tag}: houses luar rentang ${id}`);
    if (pr.mortgaged) check(pr.houses === 0, `${tag}: mortgaged punya rumah ${id}`);
    if (pr.owner !== null) check(!s.players[pr.owner].bankrupt, `${tag}: pemilik bangkrut ${id}`);
    if (t.group && t.group !== 'rail' && t.group !== 'util') {
      const hs = D.BOARD.filter((x) => x.group === t.group).map((x) => s.props[x.id].houses);
      check(Math.max(...hs) - Math.min(...hs) <= 1, `${tag}: bangunan tidak rata di ${t.group}`);
    }
  });
  const alive = s.players.filter((p) => !p.bankrupt).length;
  if (s.phase === 'over') check(alive === 1, `${tag}: over tapi pemain aktif ${alive}`);
}

/* unit: sewa */
{
  const s = G.create(['A', 'B', 'C', 'D']);
  s.props[1].owner = 0; s.props[3].owner = 0;
  check(G.rentOf(s, 1, 7) === 4000, 'sewa ganda grup coklat lengkap');
  s.props[3].owner = 1;
  check(G.rentOf(s, 1, 7) === 2000, 'sewa dasar coklat');
  s.props[3].owner = 0; s.props[1].houses = 2;
  check(G.rentOf(s, 1, 7) === 30000, 'sewa 2 rumah');
  s.props[1].houses = 5;
  check(G.rentOf(s, 1, 7) === 250000, 'sewa hotel');
  s.props[1].houses = 0; s.props[1].mortgaged = true;
  check(G.rentOf(s, 1, 7) === 0, 'mortgaged tanpa sewa');
  s.props[1].mortgaged = false;
  s.props[5].owner = 0;
  check(G.rentOf(s, 5, 7) === 25000, 'sewa 1 stasiun');
  s.props[15].owner = 0; s.props[25].owner = 0; s.props[35].owner = 0;
  check(G.rentOf(s, 5, 7) === 200000, 'sewa 4 stasiun');
  s.props[12].owner = 0;
  check(G.rentOf(s, 12, 7) === 28000, 'sewa utilitas 4x dadu');
  s.props[28].owner = 0;
  check(G.rentOf(s, 12, 7) === 70000, 'sewa utilitas 10x dadu');
  check(G.fmt(1500000) === 'Rp 1.500.000', 'format rupiah');
}

/* simulasi acak */
const GAMES = 150, MAXSTEPS = 20000;
let finished = 0, totalSteps = 0;
for (let g = 0; g < GAMES; g++) {
  const s = G.create(['A', 'B', 'C', 'D']);
  let steps = 0;
  while (s.phase !== 'over' && steps < MAXSTEPS) {
    steps++; totalSteps++;
    const r = Math.random();
    if (s.phase === 'roll') {
      // main "rakus": tebus hipotek, bangun sebanyak mungkin tiap giliran, sesekali jual acak
      Object.keys(s.props).forEach((id) => { if (G.canUnmortgage(s, +id)) G.unmortgage(s, +id); });
      Object.keys(s.props).forEach((id) => {
        let guard = 0;
        while (G.canBuild(s, +id) && guard++ < 6) G.buildHouse(s, +id);
      });
      if (r < 0.05) {
        const mine = Object.keys(s.props).filter((id) => s.props[id].owner === s.turn);
        if (mine.length) {
          const id = +mine[Math.floor(Math.random() * mine.length)];
          if (r < 0.02) G.sellBuilding(s, id); else G.mortgage(s, id);
        }
      }
      G.roll(s);
    } else if (s.phase === 'jail') {
      if (r < 0.5) G.jailRoll(s); else if (r < 0.8) G.payFine(s); else G.useJailCard(s);
    } else if (s.phase === 'resolve-buy') {
      G.buyPending(s);
    } else if (s.phase === 'card') {
      G.applyCard(s);
      if (s.pendingMove) G.finishPendingMove(s);
    } else if (s.phase === 'end') {
      G.endTurn(s);
    }
    if (steps % 37 === 0) invariants(s, `game${g} step${steps}`);
  }
  invariants(s, `game${g} akhir`);
  if (s.phase === 'over') finished++;
}

console.log(`simulasi: ${GAMES} game, ${totalSteps} langkah, ${finished} selesai sebelum batas langkah`);
// Tanpa lelang/dagang, grup warna jarang lengkap sehingga banyak game memang panjang;
// yang diuji di sini mesinnya: invariant aman dan sebagian game pasti tiba di akhir.
check(finished > GAMES * 0.2, 'terlalu sedikit game yang selesai');
if (fails) { console.error(`${fails} kegagalan`); process.exit(1); }
console.log('SEMUA TEST LOLOS');
