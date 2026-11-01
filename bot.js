/* Bot Monopoli: tiga level kesulitan. Murni logika, tanpa DOM. */
(function (root) {
  'use strict';
  var G = root.MonoGame, D = root.MonoData;
  var BOARD = D.BOARD;

  var PROFILES = {
    mudah:  { label: 'Mudah',  reserve: 400000, build: false, brave: 0.2 },
    sedang: { label: 'Sedang', reserve: 200000, build: true,  brave: 0.6 },
    sulit:  { label: 'Sulit',  reserve: 150000, build: true,  brave: 1 }
  };

  function groupOf(id) { var t = BOARD[id]; return t.group; }

  /* Seberapa bahaya papan lawan untuk pemain p (sewa maksimum yang bisa mampir). */
  function danger(s, p) {
    var worst = 0;
    BOARD.forEach(function (t) {
      var pr = s.props[t.id];
      if (!pr || pr.owner === null || pr.owner === p.id || pr.mortgaged) return;
      var r = (t.type === 'prop') ? t.rent[pr.houses]
        : (t.type === 'rail') ? 200000
        : 70000;
      if (r > worst) worst = r;
    });
    return worst;
  }

  function wantsToStayInJail(s, seat) {
    var p = s.players[seat];
    return danger(s, p) > p.cash * 0.5;
  }

  /* niat menawar properti saat resolve-buy: seat = kursi penawar (pendingBuyer). */
  function offerIntent(s, profile) {
    var seat = s.pendingBuyer;
    if (s.players[seat].bankrupt) return { kind: 'skip' };
    return buyIntent(s, seat, profile);
  }

  /* Dagang: pilih properti lawan yang melengkapi grup kita; tawarkan properti
     tak terpakai + uang secukupnya. Hanya saat giliran sendiri & tidak sibuk. */
  function groupMates(id) {
    var t = BOARD[id];
    if (!t.group || t.group === 'rail' || t.group === 'util') return [];
    return BOARD.filter(function (x) { return x.group === t.group && x.id !== id; }).map(function (x) { return x.id; });
  }
  function tradeKey(from, to, give, get) {
    return from + '>' + to + ':' + give.slice().sort().join(',') + '=' + get.slice().sort().join(',');
  }
  /* Keping id melengkapi grup pemilik seat bila semua mate sudah milik seat. */
  function completesGroup(s, id, seat) {
    var mates = groupMates(id);
    if (mates.length === 0) return false;
    if (s.props[id].owner === seat) return false;
    return mates.every(function (m) { return s.props[m].owner === seat; });
  }
  function tradeable(s, id) {
    var pr = s.props[id];
    return pr && pr.houses === 0 && !pr.mortgaged;
  }
  function matesOwned(s, id, seat) {
    return groupMates(id).filter(function (m) { return s.props[m].owner === seat; }).length;
  }
  function tradeIntent(s, seat, profile) {
    if (s.trade || s.phase === 'over') return null;
    if (seat !== s.turn) return null;
    if (s.phase !== 'roll' && s.phase !== 'end') return null;
    if (s.players[seat].bot && profile === 'mudah') return null;
    var p = s.players[seat];
    var mem = s.tradeMemory || {};
    var reserve = PROFILES[profile].reserve * 0.5;
    var mine = Object.keys(s.props).map(Number).filter(function (id) { return s.props[id].owner === seat; });
    var offers = [];
    // 1. Tukar timbal-balik: keping lawan yang melengkapi grupku,
    //    dibayar dengan kepingku yang melengkapi grup lawan.
    BOARD.forEach(function (t) {
      var pr = s.props[t.id];
      if (!pr || pr.owner === null || pr.owner === seat || !tradeable(s, t.id)) return;
      if (s.players[pr.owner].bankrupt) return;
      if (!completesGroup(s, t.id, seat)) return;
      var other = pr.owner;
      mine.forEach(function (g) {
        if (!tradeable(s, g)) return;
        if (BOARD[g].group === t.group) return;
        if (!completesGroup(s, g, other)) return;
        var cash = Math.max(0, BOARD[t.id].price - BOARD[g].price);
        cash = Math.round(cash / 1000) * 1000;
        if (p.cash - cash < reserve) return;
        if (mem[tradeKey(seat, other, [g], [t.id])]) return;
        if (G.canOffer(s, seat, other, [g], [t.id], cash)) {
          offers.push({ kind: 'offer', to: other, give: [g], get: [t.id], cash: cash, score: 100 + BOARD[t.id].price / 1000 });
        }
      });
    });
    // 2 & 3. Minta keping pelengkap (skor 50) atau progres (skor 20): bayar keping cadangan + kas.
    BOARD.forEach(function (t) {
      var pr = s.props[t.id];
      if (!pr || pr.owner === null || pr.owner === seat || !tradeable(s, t.id)) return;
      if (s.players[pr.owner].bankrupt) return;
      var mates = groupMates(t.id);
      var owned = mates.filter(function (m) { return s.props[m].owner === seat; }).length;
      var full = mates.length > 0 && owned === mates.length;
      if (!full && owned < 1) return;
      if (!full && profile === 'sedang' && Math.random() < 0.5) return;
      var myGroup = t.group;
      var spare = mine.filter(function (id) {
        return BOARD[id].group !== myGroup && tradeable(s, id) && matesOwned(s, id, pr.owner) === 0;
      });
      spare.sort(function (a, b) { return BOARD[a].price - BOARD[b].price; });
      var give = [];
      var need = BOARD[t.id].price * 1.1;
      var val = 0;
      for (var i = 0; i < spare.length && val < need; i++) { give.push(spare[i]); val += BOARD[spare[i]].price; }
      var cash = Math.max(0, Math.round((need - val) / 1000) * 1000);
      if (give.length === 0 && cash === 0) return;
      if (p.cash - cash < reserve) return;
      if (cash > p.cash * 0.8) return;
      if (mem[tradeKey(seat, pr.owner, give, [t.id])]) return;
      if (G.canOffer(s, seat, pr.owner, give, [t.id], cash)) {
        offers.push({ kind: 'offer', to: pr.owner, give: give, get: [t.id], cash: cash, score: (full ? 50 : 20) + BOARD[t.id].price / 1000 });
      }
    });
    if (!offers.length) return null;
    offers.sort(function (a, b) { return b.score - a.score; });
    var best = offers[0];
    return { kind: 'offer', to: best.to, give: best.give, get: best.get, cash: best.cash };
  }

  /* Menjawab tawaran masuk: terima bila melengkapi grup atau nilainya wajar. */
  function answerIntent(s, seat, profile) {
    var tr = s.trade;
    if (!tr || tr.to !== seat) return null;
    if (profile === 'mudah') return Math.random() < 0.3 ? { kind: 'answer', accept: true } : { kind: 'answer', accept: false };
    var mine = {};
    Object.keys(s.props).forEach(function (id) { if (s.props[id].owner === seat) mine[id] = 1; });
    var completes = tr.get.some(function (id) {
      var mates = groupMates(id);
      return mates.length > 0 && mates.every(function (m) { return s.props[m].owner === seat || String(m) in mine || m === id; });
    });
    var giveVal = tr.give.reduce(function (a, id) { return a + BOARD[id].price; }, 0);
    var getVal = tr.get.reduce(function (a, id) { return a + BOARD[id].price; }, 0);
    var fair = getVal + 0 >= giveVal * (profile === 'sulit' ? 1.05 : 0.9) - (PROFILES[profile].brave * 50000);
    var iLoseGroup = tr.give.some(function (id) {
      var mates = groupMates(id);
      return mates.length > 0 && mates.every(function (m) { return s.props[m].owner === seat; });
    });
    var progress = tr.get.some(function (id) {
      var mates = groupMates(id);
      return mates.length > 0 && mates.some(function (m) { return s.props[m].owner === seat; });
    });
    if (iLoseGroup && !completes && !progress) return { kind: 'answer', accept: false };
    if (completes) return { kind: 'answer', accept: s.players[seat].cash - tr.cash >= 0 };
    if (iLoseGroup) return { kind: 'answer', accept: false };
    var valueRatio = giveVal > 0 ? getVal / giveVal : 2;
    if (profile === 'sulit') return { kind: 'answer', accept: (fair || valueRatio >= 0.85) && s.players[seat].cash - tr.cash >= PROFILES[profile].reserve * 0.5 };
    return { kind: 'answer', accept: fair && Math.random() < 0.5 };
  }

  function buyIntent(s, seat, profile) {
    var p = s.players[seat];
    var id = s.pendingBuy;
    var t = BOARD[id];
    if (p.cash < t.price) return { kind: 'skip' };
    if (profile === 'mudah') {
      return (t.price <= p.cash * 0.25) ? { kind: 'buy' } : { kind: 'skip' };
    }
    var group = groupOf(id);
    var completes = false, blocks = false;
    if (group && group !== 'rail' && group !== 'util') {
      var mates = BOARD.filter(function (x) { return x.group === group && x.id !== id; });
      completes = mates.every(function (x) { return s.props[x.id].owner === seat; });
      blocks = mates.some(function (x) { return s.props[x.id].owner !== null && s.props[x.id].owner !== seat; });
    }
    var reserve = PROFILES[profile].reserve;
    if (completes) return (p.cash - t.price >= 50000) ? { kind: 'buy' } : { kind: 'skip' };
    if (profile === 'sulit' && blocks) return (p.cash - t.price >= reserve) ? { kind: 'buy' } : { kind: 'skip' };
    return (p.cash - t.price >= reserve) ? { kind: 'buy' } : { kind: 'skip' };
  }

  function jailIntent(s, seat, profile) {
    var p = s.players[seat];
    if (profile === 'mudah') return { kind: 'payFine' };
    if (p.jailCards > 0 && !wantsToStayInJail(s, seat)) return { kind: 'useCard' };
    if (profile === 'sulit' && wantsToStayInJail(s, seat) && p.jailTurns < 2) return { kind: 'jailRoll' };
    if (p.jailTurns >= 1 && p.cash > 300000) return { kind: 'payFine' };
    return { kind: 'jailRoll' };
  }

  function manageIntent(s, seat, profile) {
    var p = s.players[seat];
    var prof = PROFILES[profile];
    var ids = Object.keys(s.props).map(Number);
    var mine = ids.filter(function (id) { return s.props[id].owner === seat; });
    // 1. Tebus hipotek bila aman.
    for (var i = 0; i < mine.length; i++) {
      if (G.canUnmortgage(s, mine[i], seat) && p.cash - G.unmortgageCost(mine[i]) > prof.reserve) {
        return { kind: 'unmortgage', id: mine[i] };
      }
    }
    if (!prof.build) return null;
    // 2. Bangun di grup paling mahal dulu, jaga cadangan kas.
    var buildable = mine.filter(function (id) { return G.canBuild(s, id, seat); });
    buildable.sort(function (a, b) { return BOARD[b].rent[0] - BOARD[a].rent[0]; });
    for (var j = 0; j < buildable.length; j++) {
      if (p.cash - BOARD[buildable[j]].house > prof.reserve) return { kind: 'build', id: buildable[j] };
    }
    return null;
  }

  /* Satu langkah bot sesuai fase. resolve-buy diselesaikan kursi penawar (pendingBuyer).
     trade dijawab kapan pun; trade diajukan hanya di giliran sendiri. */
  function decide(s, profile) {
    if (s.trade) return answerIntent(s, s.trade.to, profile);
    var seat = s.phase === 'resolve-buy' ? s.pendingBuyer : s.turn;
    switch (s.phase) {
      case 'roll': return manageIntent(s, seat, profile) || tradeIntent(s, seat, profile) || { kind: 'roll' };
      case 'jail': return jailIntent(s, seat, profile);
      case 'resolve-buy': return offerIntent(s, profile);
      case 'card': return { kind: 'cardOk' };
      case 'end': return manageIntent(s, seat, profile) || tradeIntent(s, seat, profile) || { kind: 'end' };
      default: return null;
    }
  }

  root.MonoBot = { PROFILES: PROFILES, decide: decide, offerIntent: offerIntent, danger: danger };
})(typeof window !== 'undefined' ? window : globalThis);
