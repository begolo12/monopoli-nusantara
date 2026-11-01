/* Mesin aturan Monopoli: murni logika, tanpa DOM. Dipakai browser dan test Node. */
(function (root) {
  'use strict';
  var D = root.MonoData;
  var BOARD = D.BOARD, RULES = D.RULES;

  var PLAYER_COLORS = ['p1', 'p2', 'p3', 'p4'];

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function fmt(n) { return 'Rp ' + n.toLocaleString('id-ID'); }

  function tile(id) { return BOARD[id]; }

  function create(namesOrSeats) {
    var props = {};
    BOARD.forEach(function (t) {
      if (t.type === 'prop' || t.type === 'rail' || t.type === 'util') {
        props[t.id] = { owner: null, houses: 0, mortgaged: false };
      }
    });
    var state = {
      players: namesOrSeats.map(function (n, i) {
        var name = 'Pemain ' + (i + 1), bot = null;
        if (typeof n === 'string') { if (n) name = n; }
        else if (n) { if (n.name) name = n.name; if (n.bot) bot = n.bot; }
        return { id: i, name: name, color: PLAYER_COLORS[i], bot: bot, cash: RULES.startCash, pos: 0, jail: false, jailTurns: 0, jailCards: 0, bankrupt: false };
      }),
      props: props,
      turn: 0,
      phase: 'roll',           // roll | jail | resolve-buy | card | end | over
      dice: [0, 0],
      doublesCount: 0,
      canExtra: false,
      pendingBuy: null,
      pendingCard: null,
      pendingMove: null,
      decks: { chance: shuffle(D.CHANCE.map(function (_, i) { return i; })), chest: shuffle(D.CHEST.map(function (_, i) { return i; })) },
      log: [],
      winner: null,
      round: 1
    };
    log(state, 'Permainan dimulai. Giliran ' + cur(state).name + '.', 'sys');
    return state;
  }

  function cur(s) { return s.players[s.turn]; }
  function active(s) { return s.players.filter(function (p) { return !p.bankrupt; }); }
  function log(s, text, kind) { s.log.unshift({ text: text, kind: kind || 'info', who: s.turn }); }

  function rollTwo() {
    var a = 1 + Math.floor(Math.random() * 6), b = 1 + Math.floor(Math.random() * 6);
    return [a, b];
  }

  function pathFrom(from, steps, dir) {
    var path = [];
    for (var i = 1; i <= steps; i++) path.push((from + dir * i + 40) % 40);
    return path;
  }

  function movePlayer(s, p, steps, dir) {
    dir = dir || 1;
    var old = p.pos;
    var next = (old + dir * steps + 40) % 40;
    if (dir === 1 && next < old) { p.cash += RULES.goSalary; log(s, p.name + ' lewat MULAI, terima ' + fmt(RULES.goSalary) + '.', 'gain'); }
    p.pos = next;
    return pathFrom(old, steps, dir);
  }

  function ownsGroup(s, p, group) {
    return BOARD.filter(function (t) { return t.group === group; }).every(function (t) { return s.props[t.id].owner === p.id; });
  }

  function rentOf(s, id, diceSum) {
    var t = tile(id), pr = s.props[id];
    if (!pr || pr.owner === null || pr.mortgaged) return 0;
    var owner = s.players[pr.owner];
    if (t.type === 'rail') {
      var n = BOARD.filter(function (x) { return x.group === 'rail' && s.props[x.id].owner === owner.id; }).length;
      return [25000, 50000, 100000, 200000][n - 1];
    }
    if (t.type === 'util') {
      var count = BOARD.filter(function (x) { return x.group === 'util' && s.props[x.id].owner === owner.id; }).length;
      return diceSum * (count === 2 ? 10000 : 4000);
    }
    if (pr.houses > 0) return t.rent[pr.houses];
    if (ownsGroup(s, owner, t.group)) return t.rent[0] * 2;
    return t.rent[0];
  }

  /* ---- pembayaran, likuidasi paksa, kebangkrutan ---- */

  function houseCount(s, p) {
    var houses = 0, hotels = 0;
    Object.keys(s.props).forEach(function (id) {
      var pr = s.props[id];
      if (pr.owner === p.id) { if (pr.houses === 5) hotels++; else houses += pr.houses; }
    });
    return { houses: houses, hotels: hotels };
  }

  function sellHouseValue(id) { return tile(+id).house / 2; }

  function liquidate(s, p) {
    // Jual semua bangunan, lalu hipotekkan semua properti tanpa hipotek.
    var raised = 0, changed = true;
    while (changed) {
      changed = false;
      var best = null;
      Object.keys(s.props).forEach(function (id) {
        var pr = s.props[id];
        if (pr.owner === p.id && pr.houses > 0 && (best === null || pr.houses > s.props[best].houses)) best = id;
      });
      if (best !== null) {
        var v = sellHouseValue(best);
        s.props[best].houses -= 1; raised += v; changed = true;
        log(s, p.name + ' menjual bangunan di ' + tile(+best).name + ' (+' + fmt(v) + ').', 'warn');
      }
    }
    BOARD.forEach(function (t) {
      var pr = s.props[t.id];
      if (pr && pr.owner === p.id && !pr.mortgaged) {
        var val = t.price / 2;
        pr.mortgaged = true; raised += val;
        log(s, p.name + ' menghipotekkan ' + t.name + ' (+' + fmt(val) + ').', 'warn');
      }
    });
    p.cash += raised;
    return raised;
  }

  function bankrupt(s, p, creditorId) {
    p.bankrupt = true; p.jail = false;
    var creditor = creditorId === null ? null : s.players[creditorId];
    BOARD.forEach(function (t) {
      var pr = s.props[t.id];
      if (pr && pr.owner === p.id) {
        if (pr.houses > 0) log(s, 'Bangunan di ' + t.name + ' kembali ke bank.', 'warn');
        pr.houses = 0;
        if (creditor) { pr.owner = creditor.id; }
        else { pr.owner = null; pr.mortgaged = false; }
      }
    });
    if (creditor) {
      creditor.cash += p.cash;
      creditor.jailCards += p.jailCards;
      log(s, p.name + ' BANGKRUT. Seluruh aset diserahkan ke ' + creditor.name + '.', 'bad');
    } else {
      log(s, p.name + ' BANGKRUT. Seluruh aset kembali ke bank.', 'bad');
    }
    p.cash = 0; p.jailCards = 0;
    var left = active(s);
    if (left.length === 1) { s.winner = left[0].id; s.phase = 'over'; log(s, left[0].name + ' MENANG!', 'sys'); }
  }

  function transfer(s, fromId, toId, amount, note) {
    var p = s.players[fromId];
    if (p.bankrupt) return;
    if (p.cash < amount) liquidate(s, p);
    if (p.cash < amount) {
      var rest = p.cash;
      if (toId !== null) s.players[toId].cash += rest;
      bankrupt(s, p, toId);
      return;
    }
    p.cash -= amount;
    if (toId !== null) s.players[toId].cash += amount;
    if (note) log(s, note, toId === null ? 'pay' : 'pay');
  }

  /* ---- alur giliran ---- */

  function startTurn(s) {
    var p = cur(s);
    s.doublesCount = 0; s.canExtra = false; s.pendingBuy = null; s.pendingBuyer = null; s.offerQueue = []; s.pendingCard = null; s.pendingCardIdx = null; s.pendingMove = false;
    s.phase = p.jail ? 'jail' : 'roll';
    log(s, 'Giliran ' + p.name + (p.jail ? ' (di penjara)' : '') + '.', 'sys');
  }

  function afterAction(s) {
    if (s.phase === 'over') return;
    if (cur(s).bankrupt) { endTurn(s); return; }
    s.phase = s.canExtra ? 'roll' : 'end';
  }

  function resolveLanding(s) {
    var p = cur(s), t = tile(p.pos), pr = s.props[p.pos];
    if (t.type === 'go' || t.type === 'jail' || t.type === 'parking') { afterAction(s); return {}; }
    if (t.type === 'gotojail') {
      p.jail = true; p.jailTurns = 0; p.pos = 10; s.canExtra = false;
      log(s, p.name + ' masuk penjara!', 'bad');
      s.phase = 'end'; return {};
    }
    if (t.type === 'tax') {
      transfer(s, p.id, null, t.amount, p.name + ' membayar ' + t.name + ' ' + fmt(t.amount) + '.');
      afterAction(s); return {};
    }
    if (t.type === 'chance' || t.type === 'chest') {
      var deckName = t.type;
      var deck = s.decks[deckName];
      if (deck.length === 0) {
        s.decks[deckName] = shuffle((deckName === 'chance' ? D.CHANCE : D.CHEST).map(function (_, i) { return i; }));
        deck = s.decks[deckName];
      }
      var idx = deck.pop();
      var card = (deckName === 'chance' ? D.CHANCE : D.CHEST)[idx];
      s.pendingCard = { deck: deckName, card: card };
      s.pendingCardIdx = idx;
      s.phase = 'card';
      return { card: card, deck: deckName };
    }
    // properti / stasiun / utilitas
    if (pr.owner === null) {
      var others = s.players.filter(function (o) { return !o.bankrupt && o.id !== p.id; }).map(function (o) { return o.id; });
      if (p.cash >= t.price) {
        s.pendingBuy = p.pos; s.pendingBuyer = p.id; s.offerQueue = others;
        s.phase = 'resolve-buy';
        return { buy: p.pos };
      }
      if (others.length > 0) {
        s.pendingBuy = p.pos; s.offerQueue = others.slice();
        log(s, p.name + ' tidak sanggup membeli ' + t.name + '; ditawarkan ke pemain lain.', 'info');
        nextOffer(s);
        return { buy: p.pos };
      }
      log(s, t.name + ' belum dimiliki; tak ada yang sanggup membeli.', 'info');
      afterAction(s); return {};
    }
    if (pr.owner !== p.id) {
      var rent = rentOf(s, p.pos, s.dice[0] + s.dice[1]);
      if (rent > 0) transfer(s, p.id, pr.owner, rent, p.name + ' membayar sewa ' + t.name + ' ' + fmt(rent) + ' ke ' + s.players[pr.owner].name + '.');
      else log(s, t.name + ' sedang dihipotekkan; tidak ada sewa.', 'info');
    } else {
      log(s, p.name + ' mampir di propertinya sendiri, ' + t.name + '.', 'info');
    }
    afterAction(s); return {};
  }

  function roll(s) {
    var p = cur(s);
    var d = rollTwo();
    s.dice = d;
    var doubles = d[0] === d[1];
    if (doubles) s.doublesCount += 1;
    log(s, p.name + ' melempar ' + d[0] + ' + ' + d[1] + (doubles ? ' (kembar!)' : '') + '.', 'dice');
    if (doubles && s.doublesCount === 3) {
      p.jail = true; p.jailTurns = 0; p.pos = 10; s.canExtra = false;
      log(s, 'Tiga kali kembar berturut-turut: ' + p.name + ' masuk penjara!', 'bad');
      s.phase = 'end';
      return { dice: d, path: [], doubles: doubles };
    }
    s.canExtra = doubles;
    var path = movePlayer(s, p, d[0] + d[1], 1);
    var info = resolveLanding(s);
    return { dice: d, path: path, doubles: doubles, info: info };
  }

  function jailRoll(s) {
    var p = cur(s);
    var d = rollTwo();
    s.dice = d;
    log(s, p.name + ' mencoba dadu kembar: ' + d[0] + ' + ' + d[1] + '.', 'dice');
    if (d[0] === d[1]) {
      p.jail = false; p.jailTurns = 0; s.canExtra = false;
      log(s, 'Kembar! ' + p.name + ' bebas dari penjara.', 'gain');
      var path = movePlayer(s, p, d[0] + d[1], 1);
      var info = resolveLanding(s);
      s.canExtra = false; // bebas lewat kembar tidak mendapat lemparan tambahan
      if (s.phase === 'roll') s.phase = 'end';
      return { dice: d, path: path, freed: true, info: info };
    }
    p.jailTurns += 1;
    if (p.jailTurns >= RULES.jailMaxTurns) {
      transfer(s, p.id, null, RULES.jailFine, p.name + ' gagal tiga kali; membayar denda ' + fmt(RULES.jailFine) + '.');
      p.jail = false; p.jailTurns = 0;
      var path2 = movePlayer(s, p, d[0] + d[1], 1);
      var info2 = resolveLanding(s);
      s.canExtra = false;
      if (s.phase === 'roll') s.phase = 'end';
      return { dice: d, path: path2, freed: true, paidFine: true, info: info2 };
    }
    log(s, 'Tidak kembar. ' + p.name + ' tetap di penjara (percobaan ' + p.jailTurns + '/3).', 'warn');
    s.phase = 'end';
    return { dice: d, path: [], freed: false };
  }

  function payFine(s) {
    var p = cur(s);
    transfer(s, p.id, null, RULES.jailFine, p.name + ' membayar denda penjara ' + fmt(RULES.jailFine) + '.');
    p.jail = false; p.jailTurns = 0;
    s.phase = 'roll';
  }

  function useJailCard(s) {
    var p = cur(s);
    if (p.jailCards < 1) return;
    p.jailCards -= 1; p.jail = false; p.jailTurns = 0;
    log(s, p.name + ' memakai kartu bebas penjara.', 'gain');
    s.phase = 'roll';
  }

  function nextOffer(s) {
    var seat = null;
    while (s.offerQueue.length > 0 && seat === null) {
      var cand = s.offerQueue.shift();
      if (!s.players[cand].bankrupt) seat = cand;
    }
    if (seat === null) {
      s.pendingBuy = null; s.pendingBuyer = null; s.offerQueue = [];
      afterAction(s); return false;
    }
    s.pendingBuyer = seat;
    var t = tile(s.pendingBuy);
    var who = s.players[seat];
    log(s, t.name + ' ditawarkan ke ' + who.name + ' seharga ' + fmt(t.price) + '.', 'info');
    s.phase = 'resolve-buy';
    return true;
  }

  function buyPending(s) {
    var p = cur(s), id = s.pendingBuy, seat = s.pendingBuyer;
    if (id === null || seat === null) return;
    var t = tile(id), who = s.players[seat];
    transfer(s, seat, null, t.price, who.name + ' membeli ' + t.name + ' seharga ' + fmt(t.price) + '.');
    if (!who.bankrupt) s.props[id].owner = seat;
    s.pendingBuy = null; s.pendingBuyer = null; s.offerQueue = [];
    afterAction(s);
  }

  function skipPending(s) {
    var t = tile(s.pendingBuy);
    log(s, s.players[s.pendingBuyer].name + ' melewati ' + t.name + '.', 'info');
    nextOffer(s);
  }

  function endTurn(s) {
    if (s.phase === 'over') return;
    var guard = 0;
    do { s.turn = (s.turn + 1) % s.players.length; guard++; } while (s.players[s.turn].bankrupt && guard < 8);
    if (s.turn === 0) s.round += 1;
    startTurn(s);
  }

  /* ---- kartu ---- */

  function applyCard(s) {
    var pc = s.pendingCard;
    s.pendingCard = null; s.pendingCardIdx = null;
    if (!pc) { afterAction(s); return { path: [] }; }
    var p = cur(s), fx = pc.card.fx;
    log(s, (pc.deck === 'chance' ? 'Kesempatan: ' : 'Dana Umum: ') + pc.card.text, 'card');
    switch (fx.t) {
      case 'gain': p.cash += fx.n; log(s, p.name + ' menerima ' + fmt(fx.n) + '.', 'gain'); afterAction(s); return { path: [] };
      case 'pay': transfer(s, p.id, null, fx.n, p.name + ' membayar ' + fmt(fx.n) + '.'); afterAction(s); return { path: [] };
      case 'payEach':
        active(s).forEach(function (o) { if (o.id !== p.id && !p.bankrupt) transfer(s, p.id, o.id, fx.n, p.name + ' membayar ' + fmt(fx.n) + ' ke ' + o.name + '.'); });
        afterAction(s); return { path: [] };
      case 'gainEach':
        active(s).forEach(function (o) { if (o.id !== p.id && !o.bankrupt) transfer(s, o.id, p.id, fx.n, o.name + ' membayar ' + fmt(fx.n) + ' ke ' + p.name + '.'); });
        afterAction(s); return { path: [] };
      case 'jailcard': p.jailCards += 1; afterAction(s); return { path: [] };
      case 'jail':
        p.jail = true; p.jailTurns = 0; p.pos = 10; s.canExtra = false;
        log(s, p.name + ' masuk penjara!', 'bad');
        s.phase = 'end'; return { path: [] };
      case 'repair': {
        var c = houseCount(s, p);
        var total = c.houses * fx.house + c.hotels * fx.hotel;
        if (total > 0) transfer(s, p.id, null, total, p.name + ' membayar perbaikan ' + fmt(total) + '.');
        else log(s, 'Tidak ada bangunan; tidak ada biaya perbaikan.', 'info');
        afterAction(s); return { path: [] };
      }
      case 'move': {
        var path = movePlayer(s, p, (fx.to - p.pos + 40) % 40, 1);
        s.pendingMove = true;
        return { path: path };
      }
      case 'back': {
        var pathB = movePlayer(s, p, fx.n, -1);
        s.pendingMove = true;
        return { path: pathB };
      }
      case 'rail': {
        var spots = [5, 15, 25, 35];
        var target = spots.find(function (x) { return x > p.pos; }) || spots[0];
        var pathR = movePlayer(s, p, (target - p.pos + 40) % 40, 1);
        s.pendingMove = true; s.pendingDoubleRent = true;
        return { path: pathR };
      }
      case 'util': {
        var us = [12, 28];
        var tu = us.find(function (x) { return x > p.pos; }) || us[0];
        var pathU = movePlayer(s, p, (tu - p.pos + 40) % 40, 1);
        s.pendingMove = true; s.pendingUtilRoll = true;
        return { path: pathU };
      }
    }
    afterAction(s);
    return { path: [] };
  }

  function finishPendingMove(s) {
    var p = cur(s);
    var doubleRent = s.pendingDoubleRent, utilRoll = s.pendingUtilRoll;
    s.pendingMove = false; s.pendingDoubleRent = false; s.pendingUtilRoll = false;
    var t = tile(p.pos), pr = s.props[p.pos];
    if (doubleRent && pr && pr.owner !== null && pr.owner !== p.id && !pr.mortgaged) {
      var rent = rentOf(s, p.pos, s.dice[0] + s.dice[1]) * 2;
      transfer(s, p.id, pr.owner, rent, p.name + ' membayar sewa ganda ' + fmt(rent) + ' ke ' + s.players[pr.owner].name + '.');
      afterAction(s); return {};
    }
    if (utilRoll && pr && pr.owner !== null && pr.owner !== p.id && !pr.mortgaged) {
      var d = rollTwo();
      s.dice = d;
      var rentU = (d[0] + d[1]) * 10000;
      log(s, 'Dadu utilitas: ' + d[0] + ' + ' + d[1] + '.', 'dice');
      transfer(s, p.id, pr.owner, rentU, p.name + ' membayar ' + fmt(rentU) + ' ke ' + s.players[pr.owner].name + '.');
      afterAction(s); return { dice: d };
    }
    var info = resolveLanding(s);
    return info;
  }

  /* ---- bangunan & hipotek ---- */

  function groupTiles(group) { return BOARD.filter(function (t) { return t.group === group; }); }

  /* who: index pemain eksplisit; default pemain yang sedang giliran. */
  function whoOf(s, who) { return (who === undefined || who === null) ? cur(s) : s.players[who]; }

  function canBuild(s, id, who) {
    var t = tile(id), pr = s.props[id], p = whoOf(s, who);
    if (p.bankrupt) return false;
    if (!t.group || t.group === 'rail' || t.group === 'util') return false;
    if (!pr || pr.owner !== p.id || pr.mortgaged || pr.houses >= 5) return false;
    if (!ownsGroup(s, p, t.group)) return false;
    if (p.cash < t.house) return false;
    if (groupTiles(t.group).some(function (x) { return s.props[x.id].mortgaged; })) return false;
    var min = Math.min.apply(null, groupTiles(t.group).map(function (x) { return s.props[x.id].houses; }));
    return pr.houses === min;
  }

  function canSellBuilding(s, id, who) {
    var t = tile(id), pr = s.props[id], p = whoOf(s, who);
    if (p.bankrupt) return false;
    if (!t.group || t.group === 'rail' || t.group === 'util') return false;
    if (!pr || pr.owner !== p.id || pr.houses <= 0) return false;
    var max = Math.max.apply(null, groupTiles(t.group).map(function (x) { return s.props[x.id].houses; }));
    return pr.houses === max;
  }

  function buildHouse(s, id, who) {
    if (!canBuild(s, id, who)) return false;
    var t = tile(id), p = whoOf(s, who);
    transfer(s, p.id, null, t.house, p.name + ' membangun di ' + t.name + ' (' + fmt(t.house) + ').');
    s.props[id].houses += 1;
    if (s.props[id].houses === 5) log(s, 'Hotel berdiri di ' + t.name + '!', 'gain');
    return true;
  }

  function sellBuilding(s, id, who) {
    if (!canSellBuilding(s, id, who)) return false;
    var v = sellHouseValue(id), p = whoOf(s, who);
    s.props[id].houses -= 1; p.cash += v;
    log(s, p.name + ' menjual bangunan di ' + tile(id).name + ' (+' + fmt(v) + ').', 'warn');
    return true;
  }

  function canMortgage(s, id, who) {
    var pr = s.props[id], t = tile(id), p = whoOf(s, who);
    return pr && !p.bankrupt && pr.owner === p.id && !pr.mortgaged && pr.houses === 0 && t.price;
  }

  function mortgage(s, id, who) {
    if (!canMortgage(s, id, who)) return false;
    var p = whoOf(s, who);
    var v = tile(id).price / 2;
    s.props[id].mortgaged = true; p.cash += v;
    log(s, p.name + ' menghipotekkan ' + tile(id).name + ' (+' + fmt(v) + ').', 'warn');
    return true;
  }

  function unmortgageCost(id) { return Math.round(tile(id).price / 2 * 1.1); }

  function canUnmortgage(s, id, who) {
    var pr = s.props[id], p = whoOf(s, who);
    return pr && !p.bankrupt && pr.owner === p.id && pr.mortgaged && p.cash >= unmortgageCost(id);
  }

  function unmortgage(s, id, who) {
    if (!canUnmortgage(s, id, who)) return false;
    var p = whoOf(s, who);
    var c = unmortgageCost(id);
    p.cash -= c; s.props[id].mortgaged = false;
    log(s, p.name + ' menebus ' + tile(id).name + ' (' + fmt(c) + ').', 'gain');
    return true;
  }

  /* ---- dagang properti ---- */

  function tradeValue(s, id) { return tile(id).price; }

  function canOffer(s, from, to, giveIds, getIds, cash) {
    if (s.trade) return false;
    if (from === to) return false;
    var A = s.players[from], B = s.players[to];
    if (!A || !B || A.bankrupt || B.bankrupt) return false;
    cash = cash || 0;
    if (cash < 0 || A.cash < cash) return false;
    var ok = giveIds.every(function (id) { var pr = s.props[id]; return pr && pr.owner === from && pr.houses === 0 && !pr.mortgaged; }) &&
      getIds.every(function (id) { var pr = s.props[id]; return pr && pr.owner === to && pr.houses === 0 && !pr.mortgaged; });
    if (!ok || (giveIds.length + getIds.length + (cash > 0 ? 1 : 0)) === 0) return false;
    var seen = {};
    var dup = giveIds.concat(getIds).some(function (id) { if (seen[id]) return true; seen[id] = 1; return false; });
    return !dup;
  }

  function proposeTrade(s, from, to, giveIds, getIds, cash) {
    if (!canOffer(s, from, to, giveIds, getIds, cash || 0)) return null;
    s.trade = { from: from, to: to, give: giveIds.slice(), get: getIds.slice(), cash: cash || 0 };
    var A = s.players[from], B = s.players[to];
    log(s, A.name + ' menawarkan dagang ke ' + B.name + ': ' + tradeText(s, s.trade) + '.', 'info');
    return s.trade;
  }

  function tradeText(s, tr) {
    var bits = [];
    var names = function (ids) { return ids.map(function (id) { return tile(id).name; }).join(', '); };
    if (tr.give.length) bits.push(names(tr.give));
    if (tr.cash > 0) bits.push(fmt(tr.cash));
    var left = bits.length ? bits.join(' + ') : 'tidak ada';
    var right = tr.get.length ? names(tr.get) : 'tidak ada';
    return left + ' ditukar ' + right;
  }

  function answerTrade(s, accept) {
    var tr = s.trade;
    if (!tr) return false;
    var A = s.players[tr.from], B = s.players[tr.to];
    if (accept && canOffer(s, tr.from, tr.to, tr.give, tr.get, tr.cash)) {
      tr.give.forEach(function (id) { s.props[id].owner = tr.to; });
      tr.get.forEach(function (id) { s.props[id].owner = tr.from; });
      if (tr.cash > 0) { A.cash -= tr.cash; B.cash += tr.cash; }
      log(s, B.name + ' menerima dagang: ' + tradeText(s, tr) + '.', 'gain');
    } else {
      s.tradeMemory = s.tradeMemory || {};
      s.tradeMemory[tr.from + '>' + tr.to + ':' + tr.give.slice().sort().join(',') + '=' + tr.get.slice().sort().join(',')] = 1;
      log(s, B.name + ' menolak dagang dari ' + A.name + '.', 'info');
    }
    s.trade = null;
    return true;
  }

  /* Serialisasi: seluruh state adalah data polos dan bisa di-JSON-kan. */
  function snapshot(s) {
    return JSON.parse(JSON.stringify({
      players: s.players, props: s.props, turn: s.turn, phase: s.phase,
      dice: s.dice, doublesCount: s.doublesCount, canExtra: s.canExtra,
      pendingBuy: s.pendingBuy, pendingBuyer: s.pendingBuyer, offerQueue: s.offerQueue,
      pendingCard: s.pendingCard, pendingCardIdx: s.pendingCardIdx,
      pendingMove: s.pendingMove, pendingDoubleRent: s.pendingDoubleRent, pendingUtilRoll: s.pendingUtilRoll,
      trade: s.trade || null, tradeMemory: s.tradeMemory || {},
      decks: s.decks, log: s.log.slice(0, 60), winner: s.winner, round: s.round
    }));
  }
  function restore(data) {
    return JSON.parse(JSON.stringify(data));
  }

  /* Satu langkah niat (dipakai UI manusia & bot & guest online). */
  function intent(s, seat, kind, opt) {
    var before = s.turn;
    var actorSeat = s.trade ? s.trade.to : (s.phase === 'resolve-buy' ? s.pendingBuyer : s.turn);
    if (seat !== actorSeat) return { ok: false, why: 'bukan giliran' };
    var actor = s.players[actorSeat];
    if (actor.bankrupt || s.phase === 'over') return { ok: false, why: 'permainan selesai' };
    var out = { ok: true, kind: kind, dice: null, path: [], freed: false, card: null, deck: null, info: null };
    switch (kind) {
      case 'roll':
        if (s.phase !== 'roll') return { ok: false, why: 'bukan fase dadu' };
        var r = roll(s); out.dice = r.dice; out.path = r.path; out.info = r.info; break;
      case 'jailRoll':
        if (s.phase !== 'jail') return { ok: false, why: 'bukan fase penjara' };
        var jr = jailRoll(s); out.dice = jr.dice; out.path = jr.path; out.freed = jr.freed; out.info = jr.info; break;
      case 'payFine':
        if (s.phase !== 'jail') return { ok: false, why: 'bukan fase penjara' };
        payFine(s); break;
      case 'useCard':
        if (s.phase !== 'jail') return { ok: false, why: 'bukan fase penjara' };
        if (actor.jailCards < 1) return { ok: false, why: 'tidak ada kartu' };
        useJailCard(s); break;
      case 'buy':
        if (s.phase !== 'resolve-buy') return { ok: false, why: 'bukan fase beli' };
        buyPending(s); break;
      case 'skip':
        if (s.phase !== 'resolve-buy') return { ok: false, why: 'bukan fase beli' };
        skipPending(s); break;
      case 'cardOk': {
        if (s.phase !== 'card') return { ok: false, why: 'tidak ada kartu' };
        if (!s.pendingCard) return { ok: true, already: true };
        var c = applyCard(s);
        out.path = c.path || [];
        break;
      }
      case 'end':
        if (s.phase !== 'end') return { ok: false, why: 'bukan fase akhiri' };
        endTurn(s); break;
      case 'build':
        if (!buildHouse(s, opt && opt.id, seat)) return { ok: false, why: 'tidak bisa bangun' };
        break;
      case 'sellBuilding':
        if (!sellBuilding(s, opt && opt.id, seat)) return { ok: false, why: 'tidak bisa jual' };
        break;
      case 'mortgage':
        if (!mortgage(s, opt && opt.id, seat)) return { ok: false, why: 'tidak bisa hipotek' };
        break;
      case 'unmortgage':
        if (!unmortgage(s, opt && opt.id, seat)) return { ok: false, why: 'tidak bisa tebus' };
        break;
      case 'offer': {
        var o = opt || {};
        var tr = proposeTrade(s, seat, o.to, o.give || [], o.get || [], o.cash || 0);
        if (!tr) return { ok: false, why: 'tawaran tidak sah' };
        out.trade = s.trade;
        break;
      }
      case 'answer': {
        if (!s.trade || s.trade.to !== seat) return { ok: false, why: 'tidak ada tawaran untukmu' };
        answerTrade(s, !!(opt && opt.accept));
        break;
      }
      default: return { ok: false, why: 'niat tidak dikenal' };
    }
    if (s.pendingMove) {
      var fm = finishPendingMove(s);
      if (fm && fm.dice) out.dice = fm.dice;
      if (fm && fm.info) out.info = fm.info;
    }
    out.moved = before !== s.turn;
    out.turn = s.turn; out.phase = s.phase;
    if (out.ok && s.pendingCard) { out.card = s.pendingCard.card; out.deck = s.pendingCard.deck; }
    return out;
  }

  root.MonoGame = {
    create: create, cur: cur, active: active, fmt: fmt, tile: tile,
    roll: roll, jailRoll: jailRoll, payFine: payFine, useJailCard: useJailCard,
    buyPending: buyPending, skipPending: skipPending, endTurn: endTurn,
    applyCard: applyCard, finishPendingMove: finishPendingMove,
    rentOf: rentOf, canBuild: canBuild, canSellBuilding: canSellBuilding,
    buildHouse: buildHouse, sellBuilding: sellBuilding,
    canMortgage: canMortgage, mortgage: mortgage, canUnmortgage: canUnmortgage, unmortgage: unmortgage, unmortgageCost: unmortgageCost,
    ownsGroup: ownsGroup, houseCount: houseCount, log: log,
    proposeTrade: proposeTrade, answerTrade: answerTrade, canOffer: canOffer, tradeText: tradeText, tradeValue: tradeValue,
    snapshot: snapshot, restore: restore, intent: intent
  };
})(typeof window !== 'undefined' ? window : globalThis);
