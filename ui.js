/* Lapisan UI browser: papan, token, panel aksi, modal, bot lokal, dan online P2P.
   Host memegang state otoritatif; tamu mengirim niat dan menerima snapshot utuh. */
(function () {
  'use strict';
  var D = window.MonoData, G = window.MonoGame, Bot = window.MonoBot, Net = window.MonoNet;
  var BOARD = D.BOARD;

  var state = null;
  var busy = false;
  var selectedId = null;
  var guestTimer = null;

  var session = { mode: 'local', mySeats: [0, 1, 2, 3], isHost: true, room: null, mySeat: null, myName: '' };
  var seats = []; // [{type:'sini'|'bot'|'online', bot:'mudah'|.., guestId, name}]

  var $ = function (id) { return document.getElementById(id); };
  var boardEl = $('board'), tokensEl = $('tokens'), controlsEl = $('controls'),
      playersEl = $('players'), logEl = $('log'), turnCardEl = $('turnCard'),
      propPanelEl = $('propPanel'), diceEl = $('dice'), turnChipEl = $('turnChip'),
      deckChanceEl = $('deckChance'), deckChestEl = $('deckChest');

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function cellOf(id) {
    if (id <= 10) return { row: 11, col: 11 - id };
    if (id <= 20) return { row: 21 - id, col: 1 };
    if (id <= 30) return { row: 1, col: id - 19 };
    return { row: id - 29, col: 11 };
  }
  function sideOf(id) {
    if (id === 0 || id === 10 || id === 20 || id === 30) return 'corner';
    if (id < 10) return 'bottom';
    if (id < 20) return 'left';
    if (id < 30) return 'top';
    return 'right';
  }

  /* ---------- papan ---------- */

  function buildBoard() {
    BOARD.forEach(function (t) {
      var c = cellOf(t.id);
      var el = document.createElement('div');
      el.className = 'tile side-' + sideOf(t.id) + (t.type === 'prop' || t.type === 'rail' || t.type === 'util' ? ' ownable' : '');
      el.style.gridRow = c.row; el.style.gridColumn = c.col;
      el.dataset.id = t.id;
      var inner = '';
      if (t.group && t.group !== 'rail' && t.group !== 'util') inner += '<span class="band grp-' + t.group + '"></span>';
      if (t.group === 'rail') inner += '<span class="band grp-rail"></span>';
      if (t.group === 'util') inner += '<span class="band grp-util"></span>';
      inner += '<span class="tname">' + t.name + '</span>';
      if (t.price) inner += '<span class="tprice num">' + G.fmt(t.price) + '</span>';
      if (t.type === 'tax') inner += '<span class="tprice num">' + G.fmt(t.amount) + '</span>';
      inner += '<span class="houses"></span><span class="ownring"></span>';
      el.innerHTML = inner;
      el.addEventListener('click', function () { selectedId = (selectedId === t.id ? null : t.id); render(); });
      boardEl.appendChild(el);
    });
  }

  function tileEl(id) { return boardEl.querySelector('[data-id="' + id + '"]'); }

  /* ---------- token ---------- */

  var SLOTS = [[0.32, 0.34], [0.68, 0.34], [0.32, 0.7], [0.68, 0.7]];

  function buildTokens() {
    tokensEl.innerHTML = '';
    state.players.forEach(function (p) {
      var el = document.createElement('span');
      el.className = 'token tok-' + p.color;
      el.dataset.p = p.id;
      el.textContent = p.name.charAt(0).toUpperCase();
      tokensEl.appendChild(el);
      placeToken(p.id, p.pos, true);
    });
  }

  function placeToken(pid, tileId, instant) {
    var el = tokensEl.querySelector('[data-p="' + pid + '"]');
    var t = tileEl(tileId);
    if (!el || !t) return;
    var corner = (tileId % 10 === 0);
    el.classList.toggle('sm', !corner);
    var slot = SLOTS[pid % 4];
    var size = corner ? 20 : 15;
    var x = t.offsetLeft + t.offsetWidth * slot[0] - size / 2;
    var y = t.offsetTop + t.offsetHeight * slot[1] - size / 2;
    if (instant) el.style.transition = 'none';
    el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    el.dataset.tile = tileId;
    if (instant) { void el.offsetWidth; el.style.transition = ''; }
    el.classList.toggle('down', state.players[pid].bankrupt);
  }

  async function animatePath(pid, path) {
    for (var i = 0; i < path.length; i++) {
      placeToken(pid, path[i]);
      await sleep(150);
    }
  }
  function diffPath(from, to) {
    var fwd = (to - from + 40) % 40, bwd = (from - to + 40) % 40;
    var path = [], i;
    if (bwd < fwd) { for (i = 1; i <= bwd; i++) path.push((from - i + 40) % 40); }
    else { for (i = 1; i <= fwd; i++) path.push((from + i) % 40); }
    return path;
  }
  async function snapToPos(pid) {
    var el = tokensEl.querySelector('[data-p="' + pid + '"]');
    var p = state.players[pid];
    var curTile = el ? el.dataset.tile : null;
    if (curTile !== String(p.pos)) { placeToken(pid, p.pos); await sleep(160); }
  }

  /* ---------- dadu ---------- */

  var PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function dieHTML(v) {
    var cells = '';
    for (var i = 0; i < 9; i++) cells += '<i' + (PIPS[v] && PIPS[v].indexOf(i) > -1 ? ' class="on"' : '') + '></i>';
    return '<span class="die" role="img" aria-label="Dadu ' + v + '">' + cells + '</span>';
  }
  function renderDice(d) {
    diceEl.innerHTML = d && d[0] ? dieHTML(d[0]) + dieHTML(d[1]) + '<span class="dice-sum num">' + (d[0] + d[1]) + '</span>' : '<span class="dice-idle">Dadu siap</span>';
    if (d && d[0]) { diceEl.classList.remove('rolling'); void diceEl.offsetWidth; diceEl.classList.add('rolling'); }
  }

  /* ---------- peran ---------- */

  function isBotSeat(i) { return !!(state && state.players[i].bot); }
  function iControl(i) { return session.mySeats.indexOf(i) > -1; }
  function isMyActionTurn() {
    if (!state || state.phase === 'over') return false;
    if (!iControl(state.turn)) return false;
    return ['roll', 'jail', 'resolve-buy', 'card', 'end'].indexOf(state.phase) > -1;
  }
  function seatLabel() {
    if (!state) return '';
    var p = G.cur(state);
    if (session.mode === 'local') return isBotSeat(state.turn) ? ' (bot ' + Bot.PROFILES[p.bot].label + ')' : '';
    if (iControl(state.turn)) return session.isHost && isBotSeat(state.turn) ? ' (bot ' + Bot.PROFILES[p.bot].label + ')' : ' (kamu)';
    return '';
  }

  /* ---------- render ---------- */

  function hintFor() {
    var p = G.cur(state);
    var yours = iControl(state.turn) ? 'Giliranmu. ' : 'Giliran ' + p.name + '. ';
    switch (state.phase) {
      case 'roll': return yours + 'Lempar dadu untuk melangkah.';
      case 'jail': return yours + 'Di penjara: coba dadu kembar, bayar denda, atau pakai kartu.';
      case 'resolve-buy': return yours + BOARD[state.pendingBuy].name + ' tersedia. Beli atau lewati?';
      case 'card': return state.pendingMove ? 'Melangkah…' : yours + 'Buka kartunya.';
      case 'end': return yours + 'Giliran selesai. Akhiri untuk pemain berikutnya.';
      case 'over': return 'Permainan selesai.';
    }
    return '';
  }

  function renderTiles() {
    BOARD.forEach(function (t) {
      var el = tileEl(t.id), pr = state.props[t.id];
      if (!pr) { el.classList.remove('owned', 'mortgaged'); return; }
      el.classList.toggle('owned', pr.owner !== null);
      el.classList.toggle('mortgaged', pr.mortgaged);
      el.classList.remove('own-p1', 'own-p2', 'own-p3', 'own-p4');
      if (pr.owner !== null) el.classList.add('own-' + state.players[pr.owner].color);
      var h = el.querySelector('.houses');
      if (pr.houses === 5) h.innerHTML = '<b class="hotel"></b>';
      else h.innerHTML = '<b class="house"></b>'.repeat(pr.houses);
      el.classList.toggle('sel', selectedId === t.id);
    });
  }

  function renderPlayers() {
    playersEl.innerHTML = state.players.map(function (p) {
      var props = Object.keys(state.props).filter(function (id) { return state.props[id].owner === p.id; }).length;
      var badges = '';
      if (p.bot) badges += '<span class="badge">bot ' + Bot.PROFILES[p.bot].label.toLowerCase() + '</span>';
      if (session.mode === 'online' && p.id === session.mySeat && !session.isHost) badges += '<span class="badge">kamu</span>';
      if (p.jail) badges += '<span class="badge">penjara</span>';
      if (p.jailCards) badges += '<span class="badge">kartu bebas ×' + p.jailCards + '</span>';
      if (p.bankrupt) badges += '<span class="badge badge-bad">bangkrut</span>';
      return '<li class="pl pl-' + p.color + (p.id === state.turn ? ' now' : '') + (p.bankrupt ? ' out' : '') + '">' +
        '<span class="pl-dot tok-' + p.color + '">' + esc(p.name.charAt(0).toUpperCase()) + '</span>' +
        '<span class="pl-name">' + esc(p.name) + '</span>' + badges +
        '<span class="pl-meta num">' + props + ' properti</span>' +
        '<span class="pl-cash num">' + G.fmt(p.cash) + '</span></li>';
    }).join('');
  }

  function renderTurnCard() {
    var p = G.cur(state);
    turnCardEl.className = 'turn-card pl-' + p.color;
    var roomTag = session.mode === 'online' ? '<span class="tc-round num">Ruang ' + esc(session.room) + ' · Ronde ' + state.round + '</span>' : '<span class="tc-round num">Ronde ' + state.round + '</span>';
    turnCardEl.innerHTML = roomTag +
      '<span class="tc-name">' + esc(p.name) + seatLabel() + '</span>' +
      '<span class="tc-cash num">' + G.fmt(p.cash) + '</span>' +
      '<span class="tc-hint">' + hintFor() + '</span>';
    turnChipEl.textContent = 'Giliran: ' + p.name;
  }

  function btn(label, cls, fn, disabled) {
    var b = document.createElement('button');
    b.className = 'btn ' + (cls || '');
    b.textContent = label;
    b.disabled = !!disabled || busy;
    b.addEventListener('click', fn);
    return b;
  }

  function renderControls() {
    controlsEl.innerHTML = '';
    if (state.phase === 'over') {
      controlsEl.appendChild(btn('Main Lagi', 'btn--primary', leaveToStart));
      return;
    }
    if (state.trade && state.trade.to !== undefined) {
      var tr = state.trade;
      var meAnswer = !state.players[tr.to].bot && ((session.mode !== 'online') || tr.to === session.mySeat || (session.isHost && seats[tr.to] && !seats[tr.to].guestId));
      if (meAnswer && !busy) {
        controlsEl.appendChild(btn('Terima Dagang', 'btn--primary', function () { act('answer', { accept: true }); }));
        controlsEl.appendChild(btn('Tolak', '', function () { act('answer', { accept: false }); }));
        return;
      }
      return;
    }
    if (!isMyActionTurn()) return;
    var p = G.cur(state);
    if (session.mode === 'online' && !session.isHost && state.phase === 'card' && state.pendingMove) return;
    if (state.phase === 'roll') controlsEl.appendChild(btn('Lempar Dadu', 'btn--primary', function () { act('roll'); }));
    if (state.phase === 'jail') {
      controlsEl.appendChild(btn('Coba Dadu Kembar', 'btn--primary', function () { act('jailRoll'); }));
      controlsEl.appendChild(btn('Bayar Denda ' + G.fmt(D.RULES.jailFine), '', function () { act('payFine'); }));
      controlsEl.appendChild(btn('Gunakan Kartu (' + p.jailCards + ')', '', function () { act('useCard'); }, p.jailCards < 1));
    }
    if (state.phase === 'resolve-buy') {
      var t = BOARD[state.pendingBuy];
      controlsEl.appendChild(btn('Beli ' + G.fmt(t.price), 'btn--primary', function () { act('buy'); }));
      controlsEl.appendChild(btn('Lewati', '', function () { act('skip'); }));
    }
    if (state.phase === 'end') controlsEl.appendChild(btn('Akhiri Giliran', 'btn--primary', function () { act('end'); }));
    if (state.phase === 'card' && !state.pendingMove) controlsEl.appendChild(btn('Buka Kartu', 'btn--primary', function () { showCard(); }));
  }

  function renderPropPanel() {
    if (selectedId === null || !state.props[selectedId]) { propPanelEl.hidden = true; return; }
    var t = BOARD[selectedId], pr = state.props[selectedId], p = G.cur(state);
    var mine = pr.owner === state.turn && iControl(state.turn);
    var ownerName = pr.owner === null ? 'Belum dimiliki' : state.players[pr.owner].name;
    var lines = '<h3>' + t.name + '</h3>' +
      '<p class="pp-line">Pemilik: <strong>' + esc(ownerName) + '</strong>' + (pr.mortgaged ? ', dihipotekkan' : '') + '</p>';
    if (t.rent) {
      lines += '<p class="pp-line">Sewa sekarang: <strong class="num">' + G.fmt(G.rentOf(state, selectedId, state.dice[0] + state.dice[1] || 7)) + '</strong></p>';
      lines += '<p class="pp-line">Bangunan: <strong>' + (pr.houses === 5 ? 'Hotel' : pr.houses + ' rumah') + '</strong></p>';
    }
    if (t.type === 'rail') lines += '<p class="pp-line">Sewa naik sesuai jumlah stasiun yang dimiliki pemilik.</p>';
    if (t.type === 'util') lines += '<p class="pp-line">Sewa 4× atau 10× angka dadu.</p>';
    propPanelEl.innerHTML = lines;
    var acts = document.createElement('div');
    acts.className = 'pp-acts';
    var inTurn = mine && state.phase !== 'over' && !state.pendingMove;
    if (inTurn) {
      acts.appendChild(btn('Bangun (' + G.fmt(t.house || 0) + ')', 'btn--small', function () { act('build', { id: selectedId }); }, !G.canBuild(state, selectedId)));
      acts.appendChild(btn('Jual Bangunan', 'btn--small', function () { act('sellBuilding', { id: selectedId }); }, !G.canSellBuilding(state, selectedId)));
      acts.appendChild(btn('Hipotekkan', 'btn--small', function () { act('mortgage', { id: selectedId }); }, !G.canMortgage(state, selectedId)));
      acts.appendChild(btn('Tebus (' + G.fmt(G.unmortgageCost(selectedId)) + ')', 'btn--small', function () { act('unmortgage', { id: selectedId }); }, !G.canUnmortgage(state, selectedId)));
      acts.appendChild(btn('Tawar Dagang', 'btn--small', function () { openOffer(state.turn); }));
    } else if (state.phase !== 'over' && !state.trade && !state.pendingMove && state.props[selectedId].owner !== null && state.props[selectedId].owner !== state.turn && iControl(state.turn)) {
      acts.appendChild(btn('Tawar Properti Ini', 'btn--small', function () { openOfferTarget(state.turn, selectedId); }));
    }
    propPanelEl.appendChild(acts);
    propPanelEl.hidden = false;
  }

  function renderLog() {
    logEl.innerHTML = state.log.slice(0, 60).map(function (e) {
      return '<li class="lg-' + e.kind + '">' + e.text + '</li>';
    }).join('');
  }

  function render() {
    if (!state) return;
    renderTiles(); renderPlayers(); renderTurnCard(); renderControls(); renderPropPanel(); renderLog();
    state.players.forEach(function (p) { placeToken(p.id, p.pos, true); });
    deckChanceEl.textContent = state.decks.chance.length;
    deckChestEl.textContent = state.decks.chest.length;
    if (overlayEl.hidden && state.trade) showTrade();
    if (state.phase === 'over') showWinner();
  }

  function tradeName(id) { return BOARD[id].name; }
  function tradeSide(ids) { return ids.length ? ids.map(tradeName).join(', ') : 'tidak ada'; }

  function showTrade() {
    var tr = state.trade;
    if (!tr) return;
    var A = state.players[tr.from], B = state.players[tr.to];
    var waiting = B.bot ? 'Menunggu jawaban ' + B.name + ' (bot)…' :
      (session.mode === 'online' && session.isHost && seats[tr.to] && seats[tr.to].guestId) ? 'Menunggu jawaban ' + B.name + ' (online)…' : null;
    showOverlay('<div class="sheet trade-sheet" role="dialog" aria-modal="true">' +
      '<span class="cs-deck">Tawaran dagang</span>' +
      '<p class="cs-text">' + esc(A.name) + ' menawarkan ke ' + esc(B.name) + '.</p>' +
      '<ul class="rs-list">' +
      '<li>Memberi: <strong>' + esc(tradeSide(tr.give)) + (tr.cash > 0 ? ' + ' + G.fmt(tr.cash) : '') + '</strong></li>' +
      '<li>Meminta: <strong>' + esc(tradeSide(tr.get)) + '</strong></li>' +
      '</ul>' +
      (waiting ? '<p class="ss-sub">' + esc(waiting) + '</p>' : '') +
      '</div>');
    renderControls();
  }

  function afterChange() {
    if (session.mode === 'online' && session.isHost) broadcast();
    render();
    scheduleBot();
  }

  /* ---------- aksi manusia / tamu ---------- */

  async function act(kind, opt) {
    if (busy || !state || state.phase === 'over') return;
    if (session.mode === 'online' && !session.isHost) {
      if (kind === 'cardOk') { hideOverlay(); }
      Net.send('intent', { kind: kind, opt: opt || null, seat: session.mySeat });
      renderControls();
      return;
    }
    busy = true; renderControls();
    var seat = state.trade ? state.trade.to : (state.phase === 'resolve-buy' ? state.pendingBuyer : state.turn);
    var res = G.intent(state, seat, kind, opt);
    if (res.dice) renderDice(res.dice);
    if (res.path && res.path.length) await animatePath(seat, res.path);
    await snapToPos(seat);
    busy = false;
    if (state.phase === 'card' && state.pendingCard && iControl(state.turn) && !state.players[state.turn].bot) showCard();
    else afterChange();
  }

  /* ---------- bot ---------- */

  var botScheduled = false;
  function authorityFor(i) {
    if (session.mode === 'local') return true;
    return session.isHost;
  }
  function tradeNeedsHuman() {
    if (!state || !state.trade) return false;
    if (state.players[state.trade.to].bot) return false;
    if (session.mode === 'online') {
      if (!session.isHost) return false;
      var sd = seats[state.trade.to];
      return !(sd && sd.guestId);
    }
    return true;
  }
  function scheduleBot() {
    if (botScheduled || !state || state.phase === 'over') return;
    if (tradeNeedsHuman()) return;
    var seat = state.trade ? state.trade.to : (state.phase === 'resolve-buy' ? state.pendingBuyer : state.turn);
    var ap = state.players[seat];
    if (!ap.bot || !authorityFor(seat)) return;
    botScheduled = true;
    setTimeout(function () { botScheduled = false; botStep(); }, 900);
  }

  async function botStep() {
    if (busy || !state || state.phase === 'over') return;
    var seat = state.trade ? state.trade.to : (state.phase === 'resolve-buy' ? state.pendingBuyer : state.turn), p = state.players[seat];
    if (!p.bot || !authorityFor(seat)) return;
    var step = Bot.decide(state, p.bot);
    if (!step) { scheduleBot(); return; }
    busy = true; renderControls();
    var res = { ok: true, path: [] };
    if (step.kind === 'cardOk' && !state.pendingCard) { busy = false; afterChange(); return; }
    res = G.intent(state, seat, step.kind, step);
    if (res.dice) renderDice(res.dice);
    if (res.path && res.path.length) await animatePath(seat, res.path);
    await snapToPos(seat);
    busy = false;
    afterChange();
  }

  /* ---------- modal ---------- */

  var overlayEl = $('overlay');
  function showOverlay(html) { overlayEl.innerHTML = html; overlayEl.hidden = false; }
  function hideOverlay() { overlayEl.hidden = true; overlayEl.innerHTML = ''; }

  function showCard() {
    var pc = state.pendingCard;
    if (!pc) { render(); return; }
    showOverlay('<div class="sheet card-sheet sheet-' + pc.deck + '" role="dialog" aria-modal="true">' +
      '<span class="cs-deck">' + (pc.deck === 'chance' ? 'Kesempatan' : 'Dana Umum') + '</span>' +
      '<p class="cs-text">' + pc.card.text + '</p>' +
      '<button class="btn btn--primary" id="cardOk">Lanjutkan</button></div>');
    $('cardOk').addEventListener('click', function () { hideOverlay(); act('cardOk'); });
    $('cardOk').focus();
    render();
  }

  function openOffer(fromSeat) {
    var others = state.players.filter(function (p) { return p.id !== fromSeat && !p.bankrupt; });
    if (!others.length) return;
    var myProps = Object.keys(state.props).map(Number).filter(function (id) { return sPropsOf(state, id, fromSeat); });
    showOverlay('<div class="sheet trade-sheet" role="dialog" aria-modal="true">' +
      '<span class="cs-deck">Ajukan dagang</span>' +
      '<p class="cs-text">Pilih yang kamu beri dan yang kamu minta. Properti berumah atau terhipotek tidak bisa didagangkan.</p>' +
      '<form id="offerForm" class="ss-form">' +
      '<label class="ss-row">Ke pemain <select id="ofTo">' + others.map(function (p) { return '<option value="' + p.id + '">' + esc(p.name) + '</option>'; }).join('') + '</select></label>' +
      '<fieldset class="of-group"><legend>Kamu beri (centang bila perlu)</legend><div class="of-list">' + myProps.map(function (id) {
        return '<label><input type="checkbox" data-give="' + id + '"> ' + esc(tradeName(id)) + '</label>';
      }).join('') + '</div></fieldset>' +
      '<fieldset class="of-group"><legend>Kamu minta (centang bila perlu)</legend><div class="of-list" id="ofGet"></div></fieldset>' +
      '<label class="ss-row">Uang tunai (Rp) <input id="ofCash" inputmode="numeric" value="0"></label>' +
      '<button class="btn btn--primary" type="submit">Kirim Tawaran</button></form>' +
      '<button class="btn" id="ofCancel">Batal</button></div>');
    var upd = function () {
      var to = +$('ofTo').value;
      var theirs = Object.keys(state.props).map(Number).filter(function (id) { return state.props[id].owner === to && state.props[id].houses === 0 && !state.props[id].mortgaged; });
      $('ofGet').innerHTML = theirs.map(function (id) {
        return '<label><input type="checkbox" data-get="' + id + '"> ' + esc(tradeName(id)) + '</label>';
      }).join('') || '<span class="ss-sub">Tidak ada properti yang bisa diminta.</span>';
    };
    $('ofTo').addEventListener('change', upd); upd();
    $('ofCancel').addEventListener('click', function () { hideOverlay(); render(); });
    $('offerForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var give = Array.prototype.slice.call(document.querySelectorAll('[data-give]:checked')).map(function (c) { return +c.dataset.give; });
      var get = Array.prototype.slice.call(document.querySelectorAll('[data-get]:checked')).map(function (c) { return +c.dataset.get; });
      var cash = Math.max(0, parseInt(($('ofCash').value || '0').replace(/[^0-9]/g, ''), 10) || 0);
      hideOverlay();
      act('offer', { to: +$('ofTo').value, give: give, get: get, cash: cash });
    });
  }
  function openOfferTarget(fromSeat, wantId) {
    var owner = state.props[wantId].owner;
    showOverlay('<div class="sheet trade-sheet" role="dialog" aria-modal="true">' +
      '<span class="cs-deck">Ajukan dagang</span>' +
      '<p class="cs-text">Kamu meminta <strong>' + esc(tradeName(wantId)) + '</strong> milik ' + esc(state.players[owner].name) + '. Pilih imbalanmu:</p>' +
      '<form id="offerForm" class="ss-form">' +
      '<fieldset class="of-group"><legend>Kamu beri (centang bila perlu)</legend><div class="of-list">' +
      Object.keys(state.props).map(Number).filter(function (id) { return sPropsOf(state, id, fromSeat); }).map(function (id) {
        return '<label><input type="checkbox" data-give="' + id + '"> ' + esc(tradeName(id)) + '</label>';
      }).join('') + '</div></fieldset>' +
      '<label class="ss-row">Uang tunai (Rp) <input id="ofCash" inputmode="numeric" value="0"></label>' +
      '<button class="btn btn--primary" type="submit">Kirim Tawaran</button></form>' +
      '<button class="btn" id="ofCancel">Batal</button></div>');
    $('ofCancel').addEventListener('click', function () { hideOverlay(); render(); });
    $('offerForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var give = Array.prototype.slice.call(document.querySelectorAll('[data-give]:checked')).map(function (c) { return +c.dataset.give; });
      var cash = Math.max(0, parseInt(($('ofCash').value || '0').replace(/[^0-9]/g, ''), 10) || 0);
      hideOverlay();
      act('offer', { to: owner, give: give, get: [wantId], cash: cash });
    });
  }

  function sTradeable(id) {
    var pr = state.props[id];
    return pr && pr.houses === 0 && !pr.mortgaged;
  }
  function sPropsOf(st, id, seat) { return st.props[id].owner === seat && sTradeable(id); }

  function showWinner() {
    var w = state.players[state.winner];
    var props = Object.keys(state.props).filter(function (id) { return state.props[id].owner === w.id; }).length;
    showOverlay('<div class="sheet win-sheet" role="dialog" aria-modal="true">' +
      '<span class="ws-kicker">Permainan selesai</span>' +
      '<h2>' + esc(w.name) + ' menang!</h2>' +
      '<p class="ws-sub">Tutup dengan ' + G.fmt(w.cash) + ' dan ' + props + ' properti setelah ' + state.round + ' ronde.</p>' +
      '<button class="btn btn--primary" id="winAgain">Main Lagi</button></div>');
    $('winAgain').addEventListener('click', leaveToStart);
  }

  function leaveToStart() {
    if (guestTimer) { clearTimeout(guestTimer); guestTimer = null; }
    try { Net.close(); } catch (e) { /* abaikan */ }
    state = null;
    session = { mode: 'local', mySeats: [0, 1, 2, 3], isHost: true, room: null, mySeat: null, myName: '' };
    seats = [];
    openStart();
  }

  /* ---------- layar mulai / lobi ---------- */

  var BOT_OPTS = [['human', 'Orang (di sini)'], ['mudah', 'Bot mudah'], ['sedang', 'Bot sedang'], ['sulit', 'Bot sulit']];
  var HOST_OPTS = [['sini', 'Saya (host)'], ['mudah', 'Bot mudah'], ['sedang', 'Bot sedang'], ['sulit', 'Bot sulit'], ['online', 'Pemain online']];

  function seatRow(i, name, opts, sel) {
    return '<label class="ss-row"><span class="pl-dot tok-p' + (i + 1) + '">' + (i + 1) + '</span>' +
      '<input id="snm' + i + '" maxlength="14" value="' + esc(name).replace(/"/g, '') + '" aria-label="Nama kursi ' + (i + 1) + '">' +
      '<select id="stp' + i + '" aria-label="Jenis kursi ' + (i + 1) + '">' +
      opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sel ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select></label>';
  }

  function openStart() {
    hideOverlay();
    showOverlay('<div class="sheet start-sheet" role="dialog" aria-modal="true">' +
      '<span class="ss-kicker">Pilih cara bermain</span>' +
      '<h2>Monopoli berempat</h2>' +
      '<div class="mode-grid">' +
      '<button class="btn btn--primary" id="mLocal">Main di perangkat ini</button>' +
      '<button class="btn" id="mHost">Buat ruang online</button>' +
      '<button class="btn" id="mJoin">Gabung ruang</button>' +
      '</div>' +
      '<p class="ss-sub">Satu pemain pun bisa: isi kursi kosong dengan bot mudah, sedang, atau sulit.</p>' +
      '</div>');
    $('mLocal').addEventListener('click', openLocalSetup);
    $('mHost').addEventListener('click', openHostSetup);
    $('mJoin').addEventListener('click', openJoinSetup);
  }

  function openLocalSetup(prev) {
    var names = prev || ['Pemain 1', 'Pemain 2', 'Pemain 3', 'Pemain 4'];
    var sels = ['human', 'human', 'human', 'human'];
    showOverlay('<div class="sheet start-sheet" role="dialog" aria-modal="true">' +
      '<span class="ss-kicker">Main di perangkat ini</span>' +
      '<h2>Siapa yang bermain?</h2>' +
      '<p class="ss-sub">Giliran berjalan bergantian di perangkat ini. Kursi bot dimainkan otomatis.</p>' +
      '<form id="startForm" class="ss-form">' +
      [0, 1, 2, 3].map(function (i) { return seatRow(i, names[i], BOT_OPTS, sels[i]); }).join('') +
      '<button class="btn btn--primary" type="submit">Mulai Bermain</button></form>' +
      '<button class="btn" id="backModes">Kembali</button></div>');
    $('backModes').addEventListener('click', openStart);
    $('startForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var built = [0, 1, 2, 3].map(function (i) {
        var nm = $('snm' + i).value.trim();
        var ty = $('stp' + i).value;
        return { name: nm || (ty === 'human' ? 'Pemain ' + (i + 1) : 'Bot ' + (i + 1)), bot: ty === 'human' ? null : ty };
      });
      startLocal(built);
    });
  }

  function startLocal(built) {
    session = { mode: 'local', mySeats: built.map(function (b, i) { return b.bot ? -1 : i; }).filter(function (i) { return i > -1; }), isHost: true, room: null, mySeat: null, myName: '' };
    seats = built.map(function (b) { return { type: b.bot ? 'bot' : 'sini', bot: b.bot, name: b.name }; });
    state = G.create(built);
    beginPlay();
  }

  var hostNetMsg = 'Menyiapkan koneksi online…';

  function openHostSetup() {
    var info = Net.hostRoom(null, 'Host');
    session = { mode: 'online', mySeats: [], isHost: true, room: info.room, mySeat: null, myName: '' };
    seats = [0, 1, 2, 3].map(function (i) {
      return { type: i === 0 ? 'sini' : (i === 1 ? 'online' : 'sedang-bot'), bot: i === 0 ? null : 'sedang', name: 'Kursi ' + (i + 1), guestId: null };
    });
    seats[0].type = 'sini';
    Net.on('guest-hello', onGuestHello);
    Net.on('guest-bye', onGuestBye);
    Net.on('guest-msg', onGuestMsg);
    Net.on('host-net', function (d) { hostNetMsg = d.message; if (!state) renderHostLobby(); });
    Net.on('room', function (d) { session.room = d.room; if (!state) renderHostLobby(); });
    renderHostLobby();
  }

  function renderHostLobby() {
    var rows = seats.map(function (s, i) {
      var tag = s.type === 'sini' ? 'Saya' : (s.type === 'online' ? (s.guestId ? esc(s.name) + ' (online)' : 'Menunggu pemain…') : 'Bot ' + Bot.PROFILES[s.bot].label.toLowerCase());
      return '<li class="pl pl-p' + (i + 1) + '"><span class="pl-dot tok-p' + (i + 1) + '">' + (i + 1) + '</span>' +
        '<span class="pl-name">' + esc(s.name) + '</span><span class="badge">' + tag + '</span>' +
        (s.type === 'online' && !s.guestId ? '<span class="pl-meta num">kosong</span>' : '') + '</li>';
    }).join('');
    showOverlay('<div class="sheet start-sheet" role="dialog" aria-modal="true">' +
      '<span class="ss-kicker">Ruang online</span>' +
      '<h2>Kode: <span class="room-code">' + esc(session.room) + '</span></h2>' +
      '<p class="ss-sub net-status">' + esc(hostNetMsg) + '</p>' +
      '<p class="ss-sub">Bagikan kode ini ke pasangan. Mereka pilih Gabung ruang lalu masukkan kode dan namanya. Kursi kosong yang tersisa bisa diisi bot.</p>' +
      '<ul class="players">' + rows + '</ul>' +
      '<div class="pp-acts"><label class="ss-row">Nama saya <input id="hostName" maxlength="14" value="' + esc(session.myName || 'Host') + '"></label></div>' +
      '<div class="pp-acts"><button class="btn btn--primary" id="hostStart">Mulai Bermain</button>' +
      '<button class="btn" id="hostCancel">Batal</button></div></div>');
    $('hostStart').addEventListener('click', function () {
      session.myName = $('hostName').value.trim() || 'Host';
      seats[0].name = session.myName;
      startOnlineGame();
    });
    $('hostCancel').addEventListener('click', leaveToStart);
  }

  function onGuestHello(d) {
    var known = -1;
    seats.forEach(function (s, i) { if (s.guestId === d.id) known = i; });
    if (known >= 0) {
      Net.sendToGuest(d.id, { kind: 'welcome', seat: known, seats: pubSeats() });
      if (state) broadcast();
      return;
    }
    var slot = -1;
    seats.forEach(function (s, i) { if (slot < 0 && s.type === 'online' && !s.guestId) slot = i; });
    if (slot < 0) {
      Net.sendToGuest(d.id, { kind: 'room-full' });
      return;
    }
    seats[slot].guestId = d.id;
    seats[slot].name = d.name || ('Tamu ' + (slot + 1));
    Net.sendToGuest(d.id, { kind: 'welcome', seat: slot, seats: pubSeats() });
    if (state) {
      seats[slot].type = 'online';
      state.players[slot].bot = null;
      state.players[slot].name = seats[slot].name;
      broadcast(); render(); scheduleBot();
    } else renderHostLobby();
  }
  function onGuestBye(d) {
    seats.forEach(function (s, i) {
      if (s.guestId === d.id) {
        s.guestId = null;
        if (state) {
          s.type = 'bot'; s.bot = 'sedang'; s.name = 'Bot ' + (i + 1);
          G.log(state, s.name + ' mengambil alih kursi yang ditinggalkan.', 'warn');
          state.players[i].bot = 'sedang';
          broadcast(); render(); scheduleBot();
        } else { s.name = 'Kursi ' + (i + 1); renderHostLobby(); }
      }
    });
  }
  function onGuestMsg(d) {
    if (!state || state.phase === 'over') return;
    var m = d.msg || {};
    if (m.kind !== 'intent') return;
    var seat = -1;
    seats.forEach(function (s, i) { if (s.guestId === d.id) seat = i; });
    if (seat < 0) return;
    var actor = state.trade ? state.trade.to : (state.phase === 'resolve-buy' ? state.pendingBuyer : state.turn);
    if (seat !== actor) return;
    clearGuestTimer();
    var res = G.intent(state, seat, m.kind, m.opt);
    if (!res.ok) return;
    if (!res.path || !res.path.length) { broadcast(); render(); scheduleBot(); return; }
    (function (path) {
      busy = true; renderControls();
      animatePath(seat, path).then(function () { snapToPos(seat); }).then(function () {
        busy = false; broadcast(); render(); scheduleBot();
      });
    })(res.path);
  }

  function pubSeats() {
    return seats.map(function (s) { return { type: s.type, bot: s.bot, name: s.name }; });
  }
  function broadcast() {
    if (!state) return;
    Net.send('state', { snap: G.snapshot(state), seats: pubSeats() });
  }

  function startOnlineGame() {
    var built = seats.map(function (s, i) {
      if (s.type === 'online' && !s.guestId) return { name: 'Bot ' + (i + 1), bot: 'sedang' };
      if (s.type === 'sini') return { name: s.name };
      if (s.type === 'online') return { name: s.name, bot: null };
      return { name: s.name, bot: s.bot };
    });
    session.mySeats = [0];
    session.mySeat = 0;
    state = G.create(built);
    state.players.forEach(function (p, i) { seats[i].type = p.bot ? 'bot' : (i === 0 ? 'sini' : 'online'); });
    beginPlay();
    broadcast();
  }

  function openJoinSetup() {
    showOverlay('<div class="sheet start-sheet" role="dialog" aria-modal="true">' +
      '<span class="ss-kicker">Gabung ruang</span>' +
      '<h2>Masukkan kode</h2>' +
      '<form id="joinForm" class="ss-form">' +
      '<label class="ss-row">Kode ruang <input id="joinCode" maxlength="6" autocomplete="off" placeholder="mis. K7Q2XA"></label>' +
      '<label class="ss-row">Namamu <input id="joinName" maxlength="14" placeholder="Namamu"></label>' +
      '<button class="btn btn--primary" type="submit">Gabung</button></form>' +
      '<button class="btn" id="backModes2">Kembali</button></div>');
    $('backModes2').addEventListener('click', openStart);
    $('joinForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = $('joinCode').value.trim().toUpperCase();
      var name = $('joinName').value.trim() || 'Tamu';
      if (!code) return;
      session = { mode: 'online', mySeats: [], isHost: false, room: code, mySeat: null, myName: name };
      Net.on('joined', onJoined);
      Net.on('host-msg', onHostMsg);
      Net.on('room-closed', function () { showOverlay('<div class="sheet" role="dialog"><h2>Ruang ditutup</h2><p class="ss-sub">Host menutup permainan.</p><button class="btn btn--primary" id="rcOk">Kembali</button></div>'); $('rcOk').addEventListener('click', leaveToStart); });
      Net.on('error', function (d) {
        showOverlay('<div class="sheet" role="dialog"><h2>Gagal gabung</h2><p class="ss-sub">' + esc(d.message || 'Tidak bisa gabung.') + '</p><button class="btn btn--primary" id="rjOk">Kembali</button></div>');
        $('rjOk').addEventListener('click', openStart);
      });
      showOverlay('<div class="sheet" role="dialog"><h2>Menghubungi host…</h2><p class="ss-sub">Pastikan tab host masih terbuka di perangkat host.</p></div>');
      Net.joinRoom(code, name);
    });
  }

  function onJoined(d) {
    session.mySeat = d.seat;
    session.mySeats = [d.seat];
    showOverlay('<div class="sheet" role="dialog"><h2>Kamu kursi ' + (d.seat + 1) + '</h2><p class="ss-sub">Menunggu host memulai permainan…</p></div>');
  }

  function onHostMsg(m) {
    if (m.kind === 'room-full' && !state) {
      showOverlay('<div class="sheet" role="dialog"><h2>Ruang penuh</h2><p class="ss-sub">Semua kursi online sudah terisi atau permainan sudah dimulai tanpa kursi kosong. Minta host mulai ulang dengan kursi kosong.</p><button class="btn btn--primary" id="rfOk">Kembali</button></div>');
      $('rfOk').addEventListener('click', leaveToStart);
      return;
    }
    if (m.kind === 'state' && m.snap) applySnapshot(m.snap, m.seats);
  }

  async function applySnapshot(snap, pub) {
    var old = state ? state.players.map(function (p) { return p.pos; }) : null;
    state = G.restore(snap);
    if (pub) {
      seats = pub.map(function (s) { return { type: s.type, bot: s.bot, name: s.name, guestId: null }; });
      if (state.players[session.mySeat]) state.players[session.mySeat].name = session.myName;
    }
    if (selectedId === null && state.pendingBuy !== null && iControl(state.turn)) selectedId = state.pendingBuy;
    if (old) {
      busy = true; renderControls();
      if (state.dice && state.dice[0]) renderDice(state.dice);
      for (var i = 0; i < 4; i++) {
        if (old[i] !== state.players[i].pos) await animatePath(i, diffPath(old[i], state.players[i].pos));
      }
      busy = false;
    }
    hideOverlay();
    renderDice([0, 0]);
    state.players.forEach(function (p, i) { placeToken(i, p.pos, true); });
    render();
  }

  function clearGuestTimer() {
    if (guestTimer) { clearTimeout(guestTimer); guestTimer = null; }
  }
  function armGuestTimer() {
    if (!session.isHost || session.mode !== 'online' || !state) return;
    clearGuestTimer();
    var p = G.cur(state);
    if (p.bot) return;
    var i = seats.findIndex(function (s) { return s.guestId && s.type === 'online'; });
    var isGuestTurn = seats[state.turn] && seats[state.turn].guestId;
    if (!isGuestTurn) return;
    var key = state.turn + ':' + state.phase + ':' + state.round;
    guestTimer = setTimeout(function () {
      if (!state || (state.turn + ':' + state.phase + ':' + state.round) !== key || state.phase === 'over') return;
      var seat = state.turn;
      G.log(state, state.players[seat].name + ' tidak merespons; kursinya diambil alih bot sedang.', 'warn');
      seats[seat].type = 'bot'; seats[seat].bot = 'sedang'; seats[seat].guestId = null; seats[seat].name = 'Bot ' + (seat + 1);
      state.players[seat].bot = 'sedang';
      afterChange();
    }, 60000);
  }

  /* ---------- mulai main ---------- */

  function beginPlay() {
    selectedId = null; busy = false;
    buildTokens();
    renderDice([0, 0]);
    hideOverlay();
    render();
    scheduleBot();
    armGuestTimer();
  }
  var _afterChangeBase = afterChange;
  afterChange = function () {
    _afterChangeBase();
    armGuestTimer();
  };

  function openRules() {
    showOverlay('<div class="sheet rules-sheet" role="dialog" aria-modal="true">' +
      '<h2>Aturan singkat</h2><ul class="rs-list">' +
      '<li>Tiap pemain mulai dengan ' + G.fmt(D.RULES.startCash) + '. Lewat atau berhenti di MULAI: terima ' + G.fmt(D.RULES.goSalary) + '.</li>' +
      '<li>Mendarat di properti kosong: beli atau lewati (tanpa lelang). Mendarat di milik lawan: bayar sewa.</li>' +
      '<li>Miliki satu warna lengkap untuk sewa ganda dan boleh membangun rumah; rumah harus rata, maksimal hotel.</li>' +
      '<li>Dadu kembar: lempar lagi. Tiga kali kembar berturut-turut: masuk penjara.</li>' +
      '<li>Di penjara: bebas dengan dadu kembar, denda ' + G.fmt(D.RULES.jailFine) + ', atau kartu bebas penjara.</li>' +
      '<li>Kekurangan uang: bangunan terjual dan properti terhipotek otomatis; tetap kurang berarti bangkrut.</li>' +
      '<li>Pemain terakhir yang tidak bangkrut menang.</li>' +
      '<li>Kursi kosong bisa diisi bot: mudah (santai), sedang (membangun), sulit (agresif dan bertahan di penjara saat papan berbahaya).</li>' +
      '<li>Online: host membuat ruang, tamu gabung dengan kode. Jika tamu diam 60 detik, kursinya diambil alih bot.</li>' +
      '</ul><button class="btn btn--primary" id="rulesOk">Mengerti</button></div>');
    $('rulesOk').addEventListener('click', function () { hideOverlay(); if (state) render(); else openStart(); });
  }

  /* ---------- init ---------- */

  buildBoard();
  $('btnRules').addEventListener('click', openRules);
  $('btnNew').addEventListener('click', leaveToStart);
  window.addEventListener('resize', function () { if (state) state.players.forEach(function (p) { placeToken(p.id, p.pos, true); }); });
  window.MonoDebug = {
    get state() { return state; },
    get busy() { return busy; },
    get session() { return session; },
    actions: { act: act, cardOk: function () { hideOverlay(); act('cardOk'); } }
  };
  openStart();
})();
