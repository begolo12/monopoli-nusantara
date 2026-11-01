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

  /* Titik patah untuk nama yang terlalu panjang bagi petak HP (~30px). */
  var HYPHEN = {
    Malioboro: 'Malio\u00ADboro', Kesempatan: 'Kesem\u00ADpatan',
    Palembang: 'Palem\u00ADbang', Balikpapan: 'Balik\u00ADpapan',
    Borobudur: 'Boro\u00ADbudur', Yogyakarta: 'Yogya\u00ADkarta',
    Surabaya: 'Sura\u00ADbaya', Semarang: 'Sema\u00ADrang',
    Sudirman: 'Sudir\u00ADman', Makassar: 'Makas\u00ADsar',
    Penghasilan: 'Peng\u00ADhasilan'
  };

  function hyphenate(name) {
    return name.split(/\s+/).map(function (w) { return HYPHEN[w] || w; }).join(' ');
  }

  /* Kata/kepingan terpanjang menentukan ukuran huruf: --n dibaca .tname di styles.css. */
  function longestChunk(name) {
    var n = 1;
    hyphenate(name).split(/\s+/).forEach(function (w) {
      w.split('\u00AD').forEach(function (part) { n = Math.max(n, part.length); });
    });
    return n;
  }

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
      /* Nama panjang dipatahkan di tempat yang wajar (soft hyphen), bukan di tengah kata
         sembarang. Dengan begitu semua petak bisa memakai satu ukuran huruf yang sama. */
      inner += '<span class="tname" style="--n:' + longestChunk(t.name) + '">' + hyphenate(t.name) + '</span>';
      if (t.price) inner += '<span class="tprice num">' + G.fmt(t.price) + '</span>';
      if (t.type === 'tax') inner += '<span class="tprice num">' + G.fmt(t.amount) + '</span>';
      inner += '<span class="houses"></span><span class="ownring"></span>';
      el.innerHTML = inner;
      el.addEventListener('click', function () {
        selectedId = (selectedId === t.id ? null : t.id);
        render();
      });
      boardEl.appendChild(el);
    });
  }

  function tileEl(id) { return boardEl.querySelector('[data-id="' + id + '"]'); }

  /* ---------- token ---------- */

  /* Empat bidak khas papan permainan: bidak, mobil, topi, dan perahu. Digambar sebagai
     siluet SVG supaya tetap terbaca di petak sekecil 10px — huruf awal dulu jadi bintik. */
  var PIECES = [
    '<circle class="tk-shape" cx="12" cy="6.4" r="4"/>' +
      '<path class="tk-shape" d="M9 17.4 L9.6 13 C10 11.2 11 10.2 12 10.2 C13 10.2 14 11.2 14.4 13 L15 17.4 Z"/>' +
      '<rect class="tk-shape" x="6.2" y="17.2" width="11.6" height="3.4" rx="1.7"/>',
    '<path class="tk-shape" d="M4.2 11 L6.3 10.4 L8.3 7.8 C8.6 7.4 9.1 7.1 9.6 7.1 H14.4 C14.9 7.1 15.4 7.4 15.7 7.8 L17.7 10.4 L19.8 11 C20.4 11.2 20.8 11.7 20.8 12.3 V14.3 C20.8 14.9 20.3 15.4 19.7 15.4 H4.3 C3.7 15.4 3.2 14.9 3.2 14.3 V12.3 C3.2 11.7 3.6 11.2 4.2 11 Z"/>' +
      '<circle class="tk-dark" cx="7.6" cy="16.6" r="2.1"/>' +
      '<circle class="tk-dark" cx="16.4" cy="16.6" r="2.1"/>',
    '<path class="tk-shape" d="M8.8 4.2 H15.2 C15.7 4.2 16.1 4.6 16.2 5.1 L17.2 16.3 C17.2 16.9 16.8 17.3 16.2 17.3 H7.8 C7.2 17.3 6.8 16.9 6.8 16.3 L7.8 5.1 C7.9 4.6 8.3 4.2 8.8 4.2 Z"/>' +
      '<rect class="tk-shape" x="3.4" y="16.5" width="17.2" height="3.1" rx="1.55"/>',
    '<path class="tk-shape" d="M3.4 15.6 H20.6 L18 19.5 C17.6 20.1 17 20.4 16.3 20.4 H7.7 C7 20.4 6.4 20.1 6 19.5 Z"/>' +
      '<path class="tk-shape" d="M12.6 3.6 V14 H18.8 Z"/>' +
      '<rect class="tk-shape" x="11.4" y="3.6" width="1.4" height="10.4" rx="0.7"/>'
  ];

  function pieceSvg(pid) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + PIECES[pid % 4] + '</svg>';
  }

  /* Bidak berbaris di bibir petak, tepat di atas pita warna (sisi dalam papan),
     jadi nama kota & harga tetap terbaca. Petak sudut tidak punya pita: di sana
     bidak ditaruh 2x2 di bawah nama petak. */
  var CORNER_SLOTS = [[0.28, 0.58], [0.72, 0.58], [0.28, 0.85], [0.72, 0.85]];

  function tokenSpot(pid, tileId) {
    var t = tileEl(tileId);
    var corner = (tileId % 10 === 0);
    if (!t || corner) {
      var s = CORNER_SLOTS[pid % 4];
      return { x: s[0], y: s[1] };
    }
    var mates = state.players.filter(function (p) { return p.pos === tileId; })
      .map(function (p) { return p.id; })
      .sort(function (a, b) { return a - b; });
    /* Satu bidak di tengah bibir; makin ramai makin rapat, seperti bidak berdiri berdempet.
       Saat bidak sedang melintas (belum tercatat di petak itu) ia lewat di tengah. */
    var idx = mates.indexOf(pid);
    var f = idx < 0 ? 0.5 : (idx + 1) / (mates.length + 1);
    var cls = t.className;
    if (/side-bottom/.test(cls)) return { x: f, y: 0.125 };
    if (/side-top/.test(cls)) return { x: f, y: 0.875 };
    if (/side-left/.test(cls)) return { x: 0.875, y: f };
    if (/side-right/.test(cls)) return { x: 0.125, y: f };
    return { x: f, y: 0.5 };
  }

  function buildTokens() {
    tokensEl.innerHTML = '';
    state.players.forEach(function (p) {
      var el = document.createElement('span');
      el.className = 'token tok-' + p.color;
      el.dataset.p = p.id;
      el.innerHTML = pieceSvg(p.id);
      tokensEl.appendChild(el);
      placeToken(p.id, p.pos, true);
    });
  }

  function placeToken(pid, tileId, instant) {
    var el = tokensEl.querySelector('[data-p="' + pid + '"]');
    var t = tileEl(tileId);
    if (!el || !t) return;
    var slot = tokenSpot(pid, tileId);
    /* Bidak ikut mengecil di papan kecil; batas bawah 9px supaya siluetnya masih terbaca. */
    var size = Math.round(Math.max(9, Math.min(14, boardEl.clientWidth * 0.0225)));
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    var x = t.offsetLeft + t.offsetWidth * slot.x - size / 2;
    var y = t.offsetTop + t.offsetHeight * slot.y - size / 2;
    if (instant) el.style.transition = 'none';
    el.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    el.dataset.tile = tileId;
    if (instant) { void el.offsetWidth; el.style.transition = ''; }
    el.classList.toggle('down', state.players[pid].bankrupt);
  }

  async function animatePath(pid, path) {
    for (var i = 0; i < path.length; i++) {
      placeToken(pid, path[i]);
      /* Langkah ringkas: 12 langkah (dadu kembar 6+6) selesai di bawah 1,4 detik. */
      await sleep(110);
    }
    settleTokens();
  }

  /* Barisan bidak bergeser saat ada yang datang/pergi: rapikan semua sekaligus. */
  function settleTokens() {
    state.players.forEach(function (p) { placeToken(p.id, p.pos); });
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
    settleTokens();
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
  /* Kursi yang sedang harus bertindak: saat dagang yang menjawab, saat tawar properti yang ditawari. */
  function actorSeat() {
    if (!state) return -1;
    return state.trade ? state.trade.to : (state.phase === 'resolve-buy' ? state.pendingBuyer : state.turn);
  }
  function isMyActionTurn() {
    if (!state || state.phase === 'over') return false;
    var seat = actorSeat();
    if (typeof seat !== 'number' || seat < 0 || !state.players[seat]) return false;
    if (!iControl(seat) || state.players[seat].bot) return false;
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
    b.disabled = !!disabled || busy || sending;
    b.addEventListener('click', fn);
    return b;
  }

  function phaseHint() {
    switch (state.phase) {
      case 'roll': return 'lempar dadu';
      case 'jail': return 'di penjara';
      case 'resolve-buy': return 'beli atau lewati';
      case 'card': return 'buka kartu';
      case 'end': return 'selesaikan giliran';
      default: return '';
    }
  }

  function renderControls() {
    controlsEl.innerHTML = '';
    if (state.phase === 'over') {
      controlsEl.appendChild(btn('Main Lagi', 'btn--primary', leaveToStart));
      return;
    }
    if (state.trade && state.trade.to !== undefined) {
      var tr = state.trade;
      var meAnswer = tradeMine(tr);
      // Jawaban lewat tombol di dalam modal dagang; di sini sediakan jalan
      // pintas bila modal sedang ditutup (Lihat Papan Dulu) + tombol tutup darurat.
      if (meAnswer && tradeDismissed && !busy) {
        controlsEl.appendChild(btn('Jawab Dagang', 'btn--primary', function () { tradeDismissed = false; showTrade(); }));
      }
      return;
    }
    var status = document.createElement('span');
    status.className = 'ctl-status';
    var ap = state.players[actorSeat()];
    status.innerHTML = 'Giliran <strong>' + esc(ap ? ap.name : '-') + '</strong>' + (phaseHint() ? ' · ' + phaseHint() : '');
    controlsEl.appendChild(status);
    if (sending) { status.innerHTML = 'Menunggu host memproses aksi…'; return; }
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
    var t = BOARD[selectedId], pr = state.props[selectedId];
    var ownerName = pr.owner === null ? 'Belum dimiliki' : state.players[pr.owner].name;
    var lines = '<div class="pp-head"><h3>' + t.name + '</h3>' +
      '<button class="btn btn--small pp-x" id="ppClose" type="button">Tutup</button></div>' +
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
    var actor = state.trade ? state.trade.to : (state.phase === 'resolve-buy' ? state.pendingBuyer : state.turn);
    var inTurn = pr.owner === actor && iControl(actor) && !state.players[actor].bot && state.phase !== 'over' && !state.pendingMove && !state.trade;
    if (inTurn && (state.phase === 'roll' || state.phase === 'end' || state.phase === 'resolve-buy')) {
      if (t.house) {
        acts.appendChild(btn('Bangun (' + G.fmt(t.house) + ')', 'btn--small', function () { act('build', { id: selectedId }); }, !G.canBuild(state, selectedId, actor)));
        acts.appendChild(btn('Jual Bangunan', 'btn--small', function () { act('sellBuilding', { id: selectedId }); }, !G.canSellBuilding(state, selectedId, actor)));
      }
      acts.appendChild(btn('Hipotekkan', 'btn--small', function () { act('mortgage', { id: selectedId }); }, !G.canMortgage(state, selectedId, actor)));
      acts.appendChild(btn('Tebus (' + G.fmt(G.unmortgageCost(selectedId)) + ')', 'btn--small', function () { act('unmortgage', { id: selectedId }); }, !G.canUnmortgage(state, selectedId, actor)));
      acts.appendChild(btn('Tawar Dagang', 'btn--small', function () { openOffer(actor); }));
    } else if (state.phase !== 'over' && !state.trade && !state.pendingMove && state.props[selectedId].owner !== null && state.props[selectedId].owner !== actor && iControl(actor) && !state.players[actor].bot) {
      acts.appendChild(btn('Tawar Properti Ini', 'btn--small', function () { openOfferTarget(actor, selectedId); }));
    }
    propPanelEl.appendChild(acts);
    propPanelEl.hidden = false;
    var px = $('ppClose');
    if (px) px.addEventListener('click', function () { selectedId = null; render(); });
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
    focusBoard();
    deckChanceEl.textContent = state.decks.chance.length;
    deckChestEl.textContent = state.decks.chest.length;
    if (state.trade && !tradeDismissed && overlayEl.hidden) showTrade();
    if (!state.trade) { tradeDismissed = false; if (showingTrade) hideOverlay(); }
    if (state.phase === 'over') showWinner();
  }

  /* Di HP papan lebih lebar dari layar; geser otomatis ke bidak pemain yang sedang jalan. */
  var focusKey = '';
  function focusBoard() {
    if (!state) return;
    if (!window.matchMedia('(max-width: 62rem)').matches) return;
    var p = state.players[state.turn];
    if (!p) return;
    var key = state.turn + ':' + p.pos;
    if (key === focusKey) return;
    focusKey = key;
    var t = tileEl(p.pos);
    if (!t) return;
    var sc = $('boardScroll');
    if (!sc) return;
    /* Geser HANYA jendela papan, jangan halaman: supaya zoom & tombol aksi tidak terdorong keluar layar. */
    var wr = sc.getBoundingClientRect();
    var tr = t.getBoundingClientRect();
    var seen = tr.left >= wr.left && tr.right <= wr.right && tr.top >= wr.top && tr.bottom <= wr.bottom;
    if (seen) return;
    sc.scrollTo({
      left: t.offsetLeft + t.offsetWidth / 2 - sc.clientWidth / 2,
      top: t.offsetTop + t.offsetHeight / 2 - sc.clientHeight / 2,
      behavior: 'smooth'
    });
  }

  function tradeName(id) { return BOARD[id].name; }
  function tradeSide(ids) { return ids.length ? ids.map(tradeName).join(', ') : 'tidak ada'; }

  var tradeDismissed = false;

  function tradeMine(tr) {
    return !state.players[tr.to].bot && iControl(tr.to);
  }

  function showTrade() {
    var tr = state.trade;
    if (!tr) return;
    var A = state.players[tr.from], B = state.players[tr.to];
    var waiting = B.bot ? 'Menunggu jawaban ' + B.name + ' (bot).' :
      (session.mode === 'online' && session.isHost && seats[tr.to] && seats[tr.to].guestId) ? 'Menunggu jawaban ' + B.name + ' (online).' : null;
    var meAnswer = tradeMine(tr);
    showOverlay('<div class="sheet trade-sheet" role="dialog" aria-modal="true" aria-labelledby="tradeTitle">' +
      '<span class="cs-deck">Tawaran dagang</span>' +
      '<p class="cs-text" id="tradeTitle">' + esc(A.name) + ' menawarkan ke ' + esc(B.name) + '.</p>' +
      '<ul class="rs-list">' +
      '<li>Memberi: <strong>' + esc(tradeSide(tr.give)) + (tr.cash > 0 ? ' + ' + G.fmt(tr.cash) : '') + '</strong></li>' +
      '<li>Meminta: <strong>' + esc(tradeSide(tr.get)) + '</strong></li>' +
      '</ul>' +
      (waiting && !meAnswer ? '<p class="ss-sub">' + esc(waiting) + '</p>' : '') +
      (meAnswer ? '<div class="pp-acts">' +
        '<button class="btn btn--primary" id="tradeYes">Terima Dagang</button>' +
        '<button class="btn" id="tradeNo">Tolak</button>' +
        '<button class="btn" id="tradeLater">Lihat Papan Dulu</button></div>' : '') +
      (!meAnswer && !waiting ? '<div class="pp-acts"><button class="btn" id="tradeClose">Tutup</button></div>' : '') +
      '</div>');
    showingTrade = true;
    if (meAnswer) {
      $('tradeYes').addEventListener('click', function () { tradeDismissed = false; hideOverlay(); act('answer', { accept: true }); });
      $('tradeNo').addEventListener('click', function () { tradeDismissed = false; hideOverlay(); act('answer', { accept: false }); });
      $('tradeLater').addEventListener('click', function () { tradeDismissed = true; hideOverlay(); render(); });
      $('tradeYes').focus();
    } else {
      var c = $('tradeClose');
      if (c) c.addEventListener('click', function () { tradeDismissed = true; hideOverlay(); render(); });
    }
  }

  function afterChange() {
    if (session.mode === 'online' && session.isHost) broadcast();
    render();
    scheduleBot();
  }

  /* ---------- aksi manusia / tamu ---------- */

  var sending = false;   // tamu online sedang menunggu host memproses aksinya
  var sendTimer = null;
  function sendDone() {
    sending = false;
    if (sendTimer) { clearTimeout(sendTimer); sendTimer = null; }
  }
  async function act(kind, opt) {
    if (busy || sending || !state || state.phase === 'over') return;
    if (session.mode === 'online' && !session.isHost) {
      if (kind === 'cardOk') { hideOverlay(); }
      /* Aksi dikirim di kolom 'act': kolom 'kind' dipakai Net untuk jenis pesan. */
      Net.send('intent', { act: kind, opt: opt || null, seat: session.mySeat });
      sending = true; renderControls();
      if (sendTimer) clearTimeout(sendTimer);
      sendTimer = setTimeout(function () { sending = false; sendTimer = null; renderControls(); }, 8000);
      return;
    }
    busy = true; renderControls();
    var seat = state.trade ? state.trade.to : (state.phase === 'resolve-buy' ? state.pendingBuyer : state.turn);
    var res = G.intent(state, seat, kind, opt);
    /* Siarkan hasilnya lebih dulu: tiap perangkat menonton animasi langkahnya
       sendiri, jadi pemain lain tidak ikut menunggu animasi di layar host. */
    if (session.mode === 'online' && session.isHost) broadcast();
    if (res.dice) renderDice(res.dice);
    if (res.path && res.path.length) await animatePath(seat, res.path);
    await snapToPos(seat);
    busy = false;
    if (state.phase === 'card' && state.pendingCard && iControl(state.turn) && !state.players[state.turn].bot) {
      /* Kartu belum ditutup, tetapi tamu tetap harus melihat hasil lemparan sekarang. */
      if (session.mode === 'online' && session.isHost) broadcast();
      showCard();
    } else afterChange();
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
    setTimeout(function () { botScheduled = false; botStep(); }, 700);
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
    if (session.mode === 'online' && session.isHost) broadcast();
    if (res.dice) renderDice(res.dice);
    if (res.path && res.path.length) await animatePath(seat, res.path);
    await snapToPos(seat);
    busy = false;
    afterChange();
  }

  /* ---------- modal ---------- */

  var overlayEl = $('overlay');
  var showingTrade = false;
  function showOverlay(html) { overlayEl.innerHTML = html; overlayEl.hidden = false; showingTrade = false; }
  function hideOverlay() { overlayEl.hidden = true; overlayEl.innerHTML = ''; showingTrade = false; }

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
      /* Semua isian dibaca dulu: hideOverlay() mengosongkan lembar, jadi $('ofTo') jadi null. */
      var to = +$('ofTo').value;
      hideOverlay();
      act('offer', { to: to, give: give, get: get, cash: cash });
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
    keepAwake(false);
    try { Net.close(); } catch (e) { /* abaikan */ }
    state = null;
    session = { mode: 'local', mySeats: [0, 1, 2, 3], isHost: true, room: null, mySeat: null, myName: '' };
    seats = [];
    openStart();
  }

  /* ---------- layar mulai / lobi ---------- */

  var BOT_OPTS = [['human', 'Orang'], ['mudah', 'Bot mudah'], ['sedang', 'Bot sedang'], ['sulit', 'Bot sulit']];
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
    $('mLocal').addEventListener('click', function () { openLocalSetup(); });
    $('mHost').addEventListener('click', openHostSetup);
    $('mJoin').addEventListener('click', openJoinSetup);
  }

  function openLocalSetup(prev) {
    var names = prev || ['Pemain 1', 'Pemain 2', 'Pemain 3', 'Pemain 4'];
    var sels = ['human', 'human', 'human', 'human'];
    showOverlay('<div class="sheet sheet--form start-sheet" role="dialog" aria-modal="true">' +
      '<span class="ss-kicker">Main di perangkat ini</span>' +
      '<h2>Siapa yang bermain?</h2>' +
      '<p class="ss-sub">Giliran berjalan bergantian di perangkat ini. Kursi bot dimainkan otomatis.</p>' +
      '<form id="startForm" class="ss-form">' +
      [0, 1, 2, 3].map(function (i) { return seatRow(i, names[i], BOT_OPTS, sels[i]); }).join('') +
      '</form>' +
      '<div class="sheet-acts">' +
      '<button class="btn btn--primary" type="submit" form="startForm">Mulai Bermain</button>' +
      '<button class="btn" id="backModes">Kembali</button></div></div>');
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
      /* Tiap kursi bisa diatur: biarkan untuk tamu online, atau isi bot. */
      var pick = '';
      if (s.type !== 'sini') {
        var cur = s.type === 'online' ? 'online' : 'bot-' + (s.bot || 'sedang');
        pick = '<select class="seat-pick" data-seat="' + i + '" aria-label="Isi kursi ' + (i + 1) + '"' + (s.guestId ? ' disabled' : '') + '>' +
          '<option value="online"' + (cur === 'online' ? ' selected' : '') + '>Tamu online</option>' +
          ['mudah', 'sedang', 'sulit'].map(function (b) {
            return '<option value="bot-' + b + '"' + (cur === 'bot-' + b ? ' selected' : '') + '>' +
              'Bot ' + Bot.PROFILES[b].label.toLowerCase() + '</option>';
          }).join('') + '</select>';
      }
      return '<li class="pl pl-p' + (i + 1) + '"><span class="pl-dot tok-p' + (i + 1) + '">' + (i + 1) + '</span>' +
        '<span class="pl-name">' + esc(s.name) + '</span><span class="badge">' + tag + '</span>' +
        (s.type === 'online' && !s.guestId ? '<span class="pl-meta num">kosong</span>' : '') +
        pick + '</li>';
    }).join('');
    showOverlay('<div class="sheet start-sheet" role="dialog" aria-modal="true">' +
      '<span class="ss-kicker">Ruang online</span>' +
      '<h2>Kode: <span class="room-code">' + esc(session.room) + '</span></h2>' +
      '<p class="ss-sub net-status">' + esc(hostNetMsg) + '</p>' +
      '<p class="ss-sub">Bagikan kode ini ke pemain lain. Mereka pilih Gabung ruang, lalu masukkan kode dan namanya.</p>' +
      '<div class="pp-acts"><label class="ss-row">Nama saya <input id="hostName" maxlength="14" value="' + esc(session.myName || 'Host') + '"></label></div>' +
      '<ul class="players">' + rows + '</ul>' +
      '<div class="pp-acts"><button class="btn btn--primary" id="hostStart">Mulai Bermain</button>' +
      '<button class="btn" id="hostCancel">Batal</button></div></div>');
    Array.prototype.forEach.call(document.querySelectorAll('.seat-pick'), function (sel) {
      sel.addEventListener('change', function () {
        var i = +sel.dataset.seat;
        if (isNaN(i) || !seats[i] || seats[i].guestId) return;
        var v = sel.value;
        if (v === 'online') { seats[i].type = 'online'; seats[i].bot = null; seats[i].name = 'Kursi ' + (i + 1); }
        else { seats[i].type = 'bot'; seats[i].bot = v.replace('bot-', ''); seats[i].name = 'Kursi ' + (i + 1); }
        renderHostLobby();
      });
    });
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
    if (known < 0) {
      known = reclaimSeat(d.id);
      if (known >= 0) {
        Net.sendToGuest(d.id, { kind: 'welcome', seat: known, seats: pubSeats() });
        broadcast(); render(); scheduleBot();
        return;
      }
    }
    if (known >= 0) {
      Net.sendToGuest(d.id, { kind: 'welcome', seat: known, seats: pubSeats() });
      if (state) broadcast();
      return;
    }
    var slot = -1;
    seats.forEach(function (s, i) { if (slot < 0 && s.type === 'online' && !s.guestId) slot = i; });
    /* Sebelum permainan dimulai, kursi bot yang masih kosong boleh dipakai tamu:
       tuan rumah cukup membagikan kode, empat orang langsung dapat kursi. */
    if (slot < 0 && !state) {
      seats.forEach(function (s, i) { if (slot < 0 && (s.type === 'bot' || s.type === 'sedang-bot') && !s.guestId) slot = i; });
    }
    if (slot < 0) {
      Net.sendToGuest(d.id, { kind: 'room-full' });
      return;
    }
    seats[slot].guestId = d.id;
    seats[slot].type = 'online';
    seats[slot].bot = null;
    seats[slot].name = d.name || ('Tamu ' + (slot + 1));
    Net.sendToGuest(d.id, { kind: 'welcome', seat: slot, seats: pubSeats() });
    if (state) {
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
          var leftName = state.players[i].name;
          s.type = 'bot'; s.bot = 'sedang'; s.name = 'Bot ' + (i + 1);
          G.log(state, leftName + ' keluar; bot sedang mengambil alih kursinya.', 'warn');
          state.players[i].bot = 'sedang';
          broadcast(); render(); scheduleBot();
        } else { s.name = 'Kursi ' + (i + 1); renderHostLobby(); }
      }
    });
  }
  function onGuestMsg(d) {
    if (!state || state.phase === 'over') return;
    var m = d.msg || {};
    if (m.kind !== 'intent' || !m.act) return;
    var seat = -1;
    seats.forEach(function (s, i) { if (s.guestId === d.id) seat = i; });
    if (seat < 0) {
      /* Bot sudah meminjam kursinya; pemain aslinya ambil alih lagi lalu aksinya diproses. */
      seat = reclaimSeat(d.id);
      if (seat < 0) return;
      broadcast(); render();
    }
    var actor = state.trade ? state.trade.to : (state.phase === 'resolve-buy' ? state.pendingBuyer : state.turn);
    if (seat !== actor) return;
    clearGuestTimer();
    var res = G.intent(state, seat, m.act, m.opt);
    if (!res.ok) return;
    /* Hasil langsung disiarkan; animasi di tiap perangkat berjalan sendiri-sendiri. */
    broadcast();
    if (!res.path || !res.path.length) { render(); scheduleBot(); return; }
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
    showOverlay('<div class="sheet sheet--form start-sheet" role="dialog" aria-modal="true">' +
      '<span class="ss-kicker">Gabung ruang</span>' +
      '<h2>Masukkan kode</h2>' +
      '<form id="joinForm" class="ss-form">' +
      '<label class="ss-row">Kode ruang <input id="joinCode" maxlength="6" autocomplete="off" autocapitalize="characters" placeholder="mis. K7Q2XA"></label>' +
      '<label class="ss-row">Namamu <input id="joinName" maxlength="14" placeholder="Namamu"></label>' +
      '</form>' +
      '<div class="sheet-acts">' +
      '<button class="btn btn--primary" type="submit" form="joinForm">Gabung</button>' +
      '<button class="btn" id="backModes2">Kembali</button></div></div>');
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
      showOverlay('<div class="sheet" role="dialog"><h2>Menghubungi host…</h2><p class="ss-sub">Pastikan tab host masih terbuka di perangkat host.</p><p class="ss-sub">Di jaringan lambat ini bisa sampai 30 detik. Jangan tutup halaman.</p></div>');
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

  var snapSeq = 0;
  async function applySnapshot(snap, pub) {
    sendDone();
    var my = ++snapSeq;
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
        if (my !== snapSeq) return; // snapshot yang lebih baru sudah datang; biarkan dia yang menggambar
        if (!document.hidden && old[i] !== state.players[i].pos) await animatePath(i, diffPath(old[i], state.players[i].pos));
      }
      if (my !== snapSeq) return;
      busy = false;
    }
    hideOverlay();
    if (!old) renderDice(state.dice && state.dice[0] ? state.dice : null);
    render();
  }

  function clearGuestTimer() {
    if (guestTimer) { clearTimeout(guestTimer); guestTimer = null; }
  }
  /* Tamu boleh mengobrol dulu: 3 menit tanpa aksi baru kursinya dipinjamkan ke bot,
     dan tamu itu tetap bisa mengambilnya kembali kapan saja. */
  var GUEST_WAIT_MS = 180000;

  function armGuestTimer() {
    if (!session.isHost || session.mode !== 'online' || !state) return;
    clearGuestTimer();
    var p = G.cur(state);
    if (p.bot) return;
    var isGuestTurn = seats[state.turn] && seats[state.turn].guestId;
    if (!isGuestTurn) return;
    var key = state.turn + ':' + state.phase + ':' + state.round;
    guestTimer = setTimeout(function () {
      if (!state || (state.turn + ':' + state.phase + ':' + state.round) !== key || state.phase === 'over') return;
      var seat = state.turn;
      var sd = seats[seat];
      G.log(state, state.players[seat].name + ' belum bergerak; bot meminjam kursinya sampai dia kembali.', 'warn');
      sd.takenFrom = sd.guestId; sd.takenName = sd.name;
      sd.type = 'bot'; sd.bot = 'sedang'; sd.guestId = null; sd.name = 'Bot ' + (seat + 1);
      state.players[seat].bot = 'sedang';
      afterChange();
    }, GUEST_WAIT_MS);
  }

  /* Kursi yang dipinjamkan ke bot bisa diambil lagi oleh tamu aslinya. */
  function reclaimSeat(guestId) {
    if (!guestId) return -1;
    var slot = -1;
    seats.forEach(function (s, i) { if (slot < 0 && s.takenFrom === guestId) slot = i; });
    if (slot < 0) return -1;
    var s = seats[slot];
    s.type = 'online'; s.bot = null; s.guestId = guestId;
    s.name = s.takenName || ('Tamu ' + (slot + 1));
    s.takenFrom = null; s.takenName = null;
    if (state) {
      state.players[slot].bot = null;
      state.players[slot].name = s.name;
      G.log(state, s.name + ' kembali memegang kursinya.', 'info');
    }
    return slot;
  }

  /* ---------- mulai main ---------- */

  function beginPlay() {
    selectedId = null; busy = false; sendDone();
    try { window.scrollTo(0, 0); } catch (e) { /* abaikan */ }
    buildTokens();
    renderDice([0, 0]);
    hideOverlay();
    render();
    scheduleBot();
    armGuestTimer();
    keepAwake(session.mode === 'online' && session.isHost);
  }

  /* Host online adalah "server" permainan: layar HP-nya jangan sampai mati
     lalu menidurkan tab dan menghentikan giliran semua orang. */
  var wakeLock = null;
  function keepAwake(on) {
    try {
      if (on) {
        if (!wakeLock && navigator.wakeLock && navigator.wakeLock.request) {
          navigator.wakeLock.request('screen').then(function (wl) { wakeLock = wl; }).catch(function () { /* ditolak */ });
        }
      } else if (wakeLock) { wakeLock.release(); wakeLock = null; }
    } catch (e) { /* peramban tanpa wakeLock: abaikan */ }
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden || !state || session.mode !== 'online' || !session.isHost) return;
    if (wakeLock === null) keepAwake(true);
  });
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
      '<li>Online: host membuat ruang, tamu gabung dengan kode. Bila tamu diam 3 menit, bot meminjam kursinya, dan tamu bisa mengambilnya kembali dengan beraksi atau gabung ulang.</li>' +
      '</ul><button class="btn btn--primary" id="rulesOk">Mengerti</button></div>');
    $('rulesOk').addEventListener('click', function () { hideOverlay(); if (state) render(); else openStart(); });
  }

  /* ---------- zoom papan (penting di HP) ---------- */

  var zoom = 1;
  /* Lebar papan pada zoom 100% (CSS: max(640px, 100%)); diukur sekali, bukan memakai lebar jendela. */
  function boardBase() {
    var prev = boardEl.style.width;
    boardEl.style.width = '';
    var w = boardEl.offsetWidth || 640;
    boardEl.style.width = prev;
    return w;
  }
  function applyZoom() {
    if (zoom === 1) {
      boardEl.style.width = '';
    } else {
      boardEl.style.width = Math.round(boardBase() * zoom) + 'px';
    }
    var zr = $('zoomReset');
    if (zr) zr.textContent = Math.round(zoom * 100) + '%';
    if (state) state.players.forEach(function (p) { placeToken(p.id, p.pos, true); });
  }
  function setZoom(z) {
    zoom = Math.min(2.5, Math.max(0.5, z));
    applyZoom();
  }
  function wireZoom() {
    var zin = $('zoomIn'), zout = $('zoomOut'), zr = $('zoomReset'), sc = $('boardScroll');
    if (zin) zin.addEventListener('click', function () { setZoom(zoom + 0.25); });
    if (zout) zout.addEventListener('click', function () { setZoom(zoom - 0.25); });
    if (zr) zr.addEventListener('click', function () { setZoom(1); });
    if (sc) {
      var pinch0 = 0;
      sc.addEventListener('touchmove', function (e) {
        if (e.touches.length === 2) {
          e.preventDefault();
          var d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
          if (pinch0 > 0) setZoom(zoom * (d / pinch0));
          pinch0 = d;
        }
      }, { passive: false });
      sc.addEventListener('touchend', function () { pinch0 = 0; applyZoom(); });
      sc.addEventListener('wheel', function (e) {
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(zoom - Math.sign(e.deltaY) * 0.1); }
      }, { passive: false });
    }
  }

  /* ---------- init ---------- */

  buildBoard();
  wireZoom();
  $('btnRules').addEventListener('click', openRules);
  $('btnNew').addEventListener('click', leaveToStart);
  window.addEventListener('resize', function () { applyZoom(); });
  window.MonoDebug = {
    get state() { return state; },
    get busy() { return busy; },
    get session() { return session; },
    get seats() { return seats; },
    actions: { act: act, cardOk: function () { hideOverlay(); act('cardOk'); } }
  };
  openStart();
})();
