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
      propPanelEl = $('propPanel'), assetsEl = $('assets'), diceEl = $('dice'), turnChipEl = $('turnChip'),
      deckChanceEl = $('deckChance'), deckChestEl = $('deckChest');

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function escAttr(s) { return esc(s).replace(/"/g, '&quot;'); }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  /* Satu keluarga ikon garis 24px untuk tombol; tidak ada emoji atau huruf sebagai ikon. */
  var ICONS = {
    local: '<rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><path d="M17 13.5v7M13.5 17h7"/>',
    host: '<path d="M4 11.2 12 4.8l8 6.4"/><path d="M6.3 10.4V19h11.4v-8.6"/><path d="M9.8 19v-4.4h4.4V19"/>',
    join: '<path d="M10.5 4H6.2A1.7 1.7 0 0 0 4.5 5.7v12.6A1.7 1.7 0 0 0 6.2 20h4.3"/><path d="M13.5 8.5 17.5 12l-4 3.5M9.5 12h8"/>',
    arrow: '<path d="M5 12h13M13 7l5 5-5 5"/>',
    x: '<path d="M5.5 5.5l13 13M18.5 5.5l-13 13"/>',
    swap: '<path d="M4 9h13.5M14 5.5 17.5 9 14 12.5M20 15H6.5M10 11.5 6.5 15 10 18.5"/>',
    share: '<path d="M12 3.5v11M8.5 7 12 3.5 15.5 7"/><path d="M5 12.5v6A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5v-6"/>',
    copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M5.5 15.5h-1A1.5 1.5 0 0 1 3 14V5.5A1.5 1.5 0 0 1 4.5 4H13a1.5 1.5 0 0 1 1.5 1.5v1"/>',
    install: '<path d="M12 3.5v10M8.2 9.8l3.8 3.9 3.8-3.9"/><path d="M4.5 16v2.5A2 2 0 0 0 6.5 20.5h11a2 2 0 0 0 2-2V16"/>'
  };
  function icon(name) {
    return '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' + (ICONS[name] || '') + '</svg>';
  }

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
      /* Petak bisa diklik dan dijangkau keyboard: panel properti adalah satu-satunya
         jalan ke membangun/menjual, jadi jangan kunci di tetikus saja. */
      el.setAttribute('role', 'button');
      el.setAttribute('aria-pressed', 'false');
      el.tabIndex = 0;
      el.addEventListener('click', function () {
        selectedId = (selectedId === t.id ? null : t.id);
        render();
      });
      el.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); }
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
    el.classList.toggle('turn', state.turn === pid && state.phase !== 'over');
  }

  async function animatePath(pid, path) {
    /* Di HP papan 100% terlalu kecil untuk diikuti. Saat bidak berjalan,
       besarkan papan sekali di awal lalu ikuti petaknya langkah demi langkah. */
    if (path.length && narrowScreen() && zoom < FOCUS_MIN) setZoom(FOCUS_ZOOM);
    for (var i = 0; i < path.length; i++) {
      placeToken(pid, path[i]);
      if (narrowScreen()) centerTile(path[i], false);
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
    var mine = iControl(state.turn) && !p.bot;
    switch (state.phase) {
      case 'roll': return mine ? 'Lempar dadu untuk melangkah.' : 'Menunggu ' + p.name + ' melempar dadu.';
      case 'jail': return mine ? 'Coba dadu kembar, bayar denda, atau pakai kartu.' : 'Menunggu ' + p.name + ' keluar dari penjara.';
      case 'resolve-buy':
        var buyer = state.players[state.pendingBuyer], bt = BOARD[state.pendingBuy];
        if (iControl(state.pendingBuyer) && !buyer.bot) return bt.name + ' tersedia. Beli atau lewati?';
        return 'Menunggu ' + buyer.name + ' memutuskan ' + bt.name + '.';
      case 'card': return state.pendingMove ? 'Bidak sedang melangkah…' : 'Buka kartu untuk melihat kejadiannya.';
      case 'end': return mine ? 'Akhiri giliran untuk melanjutkan.' : 'Menunggu ' + p.name + ' mengakhiri giliran.';
      case 'over': return 'Permainan selesai.';
    }
    return '';
  }

  /* Satu kalimat status yang dipakai kartu giliran dan bar aksi: giliranmu, bot, atau tunggu. */
  function statusLabel() {
    if (state.phase === 'over') return { text: 'Selesai', cls: '' };
    if (state.trade) {
      var mineOffer = tradeMine(state.trade);
      return { text: mineOffer ? 'Tawaran untukmu' : 'Menunggu jawaban', cls: mineOffer ? ' notice' : '' };
    }
    var a = actorSeat(), ap = state.players[a];
    if (!ap) return { text: '', cls: '' };
    if (iControl(a) && !ap.bot) return { text: 'Giliranmu', cls: ' mine' };
    if (ap.bot) return { text: 'Bot bermain', cls: '' };
    return { text: 'Menunggu ' + ap.name, cls: '' };
  }

  function renderTiles() {
    var turner = state.players[state.turn];
    var hereId = turner && state.phase !== 'over' ? turner.pos : -1;
    BOARD.forEach(function (t) {
      var el = tileEl(t.id), pr = state.props[t.id];
      el.classList.remove('here', 'here-p1', 'here-p2', 'here-p3', 'here-p4');
      if (t.id === hereId && turner) {
        el.classList.add('here', 'here-p' + turner.color);
      }
      el.classList.toggle('sel', selectedId === t.id);
      el.setAttribute('aria-pressed', selectedId === t.id ? 'true' : 'false');
      var owner = pr && pr.owner !== null ? state.players[pr.owner].name : 'belum dimiliki';
      var priceTxt = t.price ? ', ' + G.fmt(t.price) : (t.type === 'tax' ? ', pajak ' + G.fmt(t.amount) : '');
      el.setAttribute('aria-label', t.name + priceTxt + ', ' + owner + (pr && pr.mortgaged ? ', dihipotekkan' : ''));
      if (!pr) return;
      el.classList.toggle('owned', pr.owner !== null);
      el.classList.toggle('mortgaged', pr.mortgaged);
      el.classList.remove('own-p1', 'own-p2', 'own-p3', 'own-p4');
      if (pr.owner !== null) el.classList.add('own-' + state.players[pr.owner].color);
      var h = el.querySelector('.houses');
      if (pr.houses === 5) h.innerHTML = '<b class="hotel"></b>';
      else h.innerHTML = '<b class="house"></b>'.repeat(pr.houses);
    });
  }

  /* Kekayaan = uang + nilai properti (setengah harga bila terhipotek) + nilai
     bangunan. Angka ini yang paling jujur untuk membandingkan pemain. */
  function netWorth(p) {
    var w = p.cash;
    BOARD.forEach(function (t) {
      var pr = state.props[t.id];
      if (!pr || pr.owner !== p.id) return;
      w += (pr.mortgaged ? Math.floor((t.price || 0) / 2) : (t.price || 0)) + pr.houses * (t.house || 0);
    });
    return w;
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
        '<span class="pl-meta num">' + props + ' properti · kekayaan ' + G.fmt(netWorth(p)) + '</span>' +
        '<span class="pl-cash num">' + G.fmt(p.cash) + '</span></li>';
    }).join('');
  }

  /* ---------- daftar aset ----------
     Tanpa ringkasan ini, mengelola hipotek/rumah harus mencari petaknya satu per
     satu di papan — hampir mustahil di layar HP yang kecil. Satu sentuhan chip
     membuka panel aksi petak itu (bangun, jual, hipotek, tebus, tawar). */
  function assetSeat() {
    if (!state) return null;
    var a = actorSeat();
    if (a >= 0 && state.players[a] && !state.players[a].bot && iControl(a)) return a;
    for (var i = 0; i < state.players.length; i++) {
      if (!state.players[i].bot && !state.players[i].bankrupt && iControl(i)) return i;
    }
    return null;
  }

  function renderAssets() {
    if (!assetsEl) return;
    if (!state || state.phase === 'over') { assetsEl.hidden = true; return; }
    var seat = assetSeat();
    if (seat === null) { assetsEl.hidden = true; return; }
    var p = state.players[seat];
    var mine = BOARD.filter(function (t) { return state.props[t.id] && state.props[t.id].owner === seat; });
    var html = '<h2>Aset ' + esc(p.name) + ' · ' + mine.length + ' properti</h2>';
    if (!mine.length) {
      html += '<p class="as-empty">Belum ada properti. Singgahi petak kosong lalu pilih Beli agar bisa menagih sewa dari lawan.</p>';
    } else {
      html += '<div class="as-list">' + mine.map(function (t) {
        var pr = state.props[t.id];
        var tag = pr.mortgaged ? '<span class="as-tag as-mg">hipotek</span>'
          : pr.houses === 5 ? '<span class="as-tag">hotel</span>'
          : pr.houses > 0 ? '<span class="as-tag num">' + pr.houses + ' rumah</span>' : '';
        return '<button type="button" class="as-chip' + (pr.mortgaged ? ' mg' : '') + (selectedId === t.id ? ' sel' : '') +
          '" data-id="' + t.id + '" aria-pressed="' + (selectedId === t.id) + '">' +
          '<span class="as-swatch grp-' + (t.group || 'util') + '" aria-hidden="true"></span>' +
          '<span class="as-name">' + esc(t.name) + '</span>' + tag + '</button>';
      }).join('') + '</div>';
    }
    assetsEl.innerHTML = html;
    assetsEl.hidden = false;
    Array.prototype.forEach.call(assetsEl.querySelectorAll('.as-chip'), function (el) {
      el.addEventListener('click', function () {
        var id = Number(el.dataset.id);
        selectedId = (selectedId === id ? null : id);
        render();
      });
    });
  }

  function renderTurnCard() {
    /* Saat properti ditawarkan atau tawaran dagang menunggu jawaban, yang
       menjadi pusat perhatian adalah pemain yang harus memutuskan, bukan
       pemain yang sedang memegang giliran. */
    var p = state.players[actorSeat()] || G.cur(state);
    turnCardEl.className = 'turn-card pl-' + p.color;
    var st = statusLabel();
    var roomTag = session.mode === 'online'
      ? 'Ruang ' + esc(session.room) + ' · Ronde ' + state.round
      : 'Ronde ' + state.round;
    var last = state.log[0];
    turnCardEl.innerHTML =
      '<div class="tc-top"><span class="tc-round num">' + roomTag + '</span>' +
      (st.text ? '<span class="tc-state' + st.cls + '">' + esc(st.text) + '</span>' : '') + '</div>' +
      '<div class="tc-who"><span class="tc-name">' + esc(p.name) + (seatLabel() ? '<span class="tc-you">' + esc(seatLabel()) + '</span>' : '') + '</span>' +
      '<span class="tc-cash num">' + G.fmt(p.cash) + '</span></div>' +
      '<span class="tc-hint">' + hintFor() + '</span>' +
      (last ? '<p class="tc-last lg-' + last.kind + '">' + esc(last.text) + '</p>' : '');
    /* Penanda di tengah papan: warna bidak + uang, supaya jelas siapa yang jalan. */
    turnChipEl.className = 'turn-chip tok-' + p.color;
    turnChipEl.innerHTML = '<i aria-hidden="true"></i>' + esc(p.name) + ' · ' + G.fmt(p.cash);
  }

  function btn(label, cls, fn, disabled) {
    var b = document.createElement('button');
    b.className = 'btn ' + (cls || '');
    b.textContent = label;
    b.disabled = !!disabled || busy || sending;
    b.addEventListener('click', fn);
    return b;
  }

  /* Tombol uang di panel properti: nama aksi di baris atas, nominal di bawah,
     supaya tidak patah di tengah "· Rp 50.000" saat panel sempit. */
  function moneyBtn(label, amount, fn, disabled) {
    var b = document.createElement('button');
    b.className = 'btn btn--small';
    b.innerHTML = '<span class="pa-t">' + esc(label) + '</span><span class="pa-v num">' + esc(amount) + '</span>';
    b.disabled = !!disabled || busy || sending;
    b.addEventListener('click', fn);
    return b;
  }

  function phaseHint() {
    switch (state.phase) {
      case 'roll': return 'lempar dadu';
      case 'jail': return 'pilih cara keluar';
      case 'resolve-buy': return 'beli atau lewati';
      case 'card': return 'buka kartu';
      case 'end': return 'akhiri giliran';
      default: return '';
    }
  }

  function renderControls() {
    controlsEl.innerHTML = '';
    if (state.phase === 'over') {
      controlsEl.appendChild(btn('Main Baru', 'btn--primary', leaveToStart));
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
    var ap = state.players[actorSeat()];
    status.className = 'ctl-status pl-' + (ap ? ap.color : '1');
    var st = statusLabel();
    status.innerHTML = '<strong>' + esc(st.text || 'Menunggu') + '</strong>' +
      (phaseHint() ? '<span>' + phaseHint() + '</span>' : '');
    controlsEl.appendChild(status);
    if (sending) {
      status.innerHTML = '<strong>Menunggu host</strong><span>memproses aksi…</span>';
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
    var scrim = $('ppScrim');
    if (selectedId === null || !state.props[selectedId]) {
      propPanelEl.hidden = true;
      if (scrim) scrim.hidden = true;
      return;
    }
    var t = BOARD[selectedId], pr = state.props[selectedId];
    var grp = D.GROUPS[t.group] ? D.GROUPS[t.group].label : (t.type === 'rail' ? 'Stasiun' : 'Utilitas');
    var ownerName = pr.owner === null ? 'Bank' : state.players[pr.owner].name;
    var rent = G.rentOf(state, selectedId, (state.dice[0] + state.dice[1]) || 7);
    var houses = pr.houses === 5 ? 'Hotel' : pr.houses + ' rumah';
    var html = '<div class="pp-head">' +
        '<span class="pp-swatch grp-' + (t.group || 'util') + '" aria-hidden="true"></span>' +
        '<div class="pp-titles"><h3>' + esc(t.name) + '</h3>' +
        '<p class="pp-sub">' + esc(grp) + ' · ' + (pr.owner === null ? 'belum dimiliki' : 'milik ' + esc(ownerName)) + '</p></div>' +
        '<button class="btn btn--small pp-x" id="ppClose" type="button" aria-label="Tutup panel properti">' + icon('x') + '</button>' +
      '</div>' +
      '<div class="pp-grid">' +
        '<div class="pp-cell"><span>Harga</span><strong class="num">' + G.fmt(t.price) + '</strong></div>' +
        '<div class="pp-cell"><span>Sewa sekarang</span><strong class="num">' + G.fmt(rent) + '</strong></div>' +
        '<div class="pp-cell"><span>Bangunan</span><strong>' + (t.house ? houses : 'tidak dapat dibangun') + '</strong></div>' +
        '<div class="pp-cell"><span>Pemilik</span><strong>' + esc(ownerName) + '</strong></div>' +
      '</div>';
    if (pr.mortgaged) html += '<p class="pp-line">Dihipotekkan: sewa tidak dibayar sampai properti ditebus.</p>';
    /* Tangga sewa: pemain langsung tahu berapa yang akan ditagih setelah
        membangun — tanpa membuka aturan atau menebak-nebak. */
    if (t.rent && t.house) {
      var rentLabels = ['Tanpa rumah', '1 rumah', '2 rumah', '3 rumah', '4 rumah', 'Hotel'];
      html += '<div class="pp-rent' + (pr.mortgaged ? ' off' : '') + '" role="group" aria-label="Tangga sewa">' +
        rentLabels.map(function (lbl, i) {
          return '<span class="pp-rent-c' + (pr.houses === i ? ' cur' : '') + '"><span>' + lbl + '</span>' +
            '<strong class="num">' + G.fmt(t.rent[i]) + '</strong></span>';
        }).join('') + '</div>';
    }
    if (t.type === 'rail') html += '<p class="pp-note">Sewa naik untuk tiap stasiun yang dipegang pemilik yang sama.</p>';
    if (t.type === 'util') html += '<p class="pp-note">Sewa = 4× angka dadu, atau 10× bila kedua utilitas satu pemilik.</p>';
    if (t.house && !pr.mortgaged) {
      var groupTiles = BOARD.filter(function (x) { return x.group === t.group; });
      var full = pr.owner !== null && groupTiles.every(function (x) { return state.props[x.id].owner === pr.owner; });
      if (full) html += '<p class="pp-note">Satu warna lengkap: sewa dasar menjadi dua kali lipat.</p>';
    }
    propPanelEl.innerHTML = html;

    var acts = document.createElement('div');
    acts.className = 'pp-acts';
    var actor = actorSeat();
    var mine = iControl(actor) && !state.players[actor].bot;
    var inTurn = pr.owner === actor && mine && state.phase !== 'over' && !state.pendingMove && !state.trade;
    if (inTurn && (state.phase === 'roll' || state.phase === 'end' || state.phase === 'resolve-buy')) {
      if (t.house) {
        /* Label mengikuti tingkat bangunan: rumah 1-4, lalu hotel. */
        acts.appendChild(moneyBtn(pr.houses >= 4 ? 'Bangun hotel' : 'Bangun rumah', G.fmt(t.house), function () { act('build', { id: selectedId }); }, !G.canBuild(state, selectedId, actor)));
        acts.appendChild(moneyBtn('Jual rumah', '+' + G.fmt(t.house), function () { act('sellBuilding', { id: selectedId }); }, !G.canSellBuilding(state, selectedId, actor)));
      }
      if (pr.mortgaged) {
        acts.appendChild(moneyBtn('Tebus', G.fmt(G.unmortgageCost(selectedId)), function () { act('unmortgage', { id: selectedId }); }, !G.canUnmortgage(state, selectedId, actor)));
      } else {
        acts.appendChild(moneyBtn('Hipotekkan', '+' + G.fmt(Math.floor((t.price || 0) / 2)), function () { act('mortgage', { id: selectedId }); }, !G.canMortgage(state, selectedId, actor)));
      }
      acts.appendChild(btn('Tawar dagang', 'btn--small', function () { openOffer(actor); }));
    } else if (state.phase !== 'over' && !state.trade && !state.pendingMove && pr.owner !== null && pr.owner !== actor && mine) {
      acts.appendChild(btn('Ajukan tawaran untuk properti ini', 'btn--small', function () { openOfferTarget(actor, selectedId); }));
    }
    if (acts.children.length) propPanelEl.appendChild(acts);
    propPanelEl.hidden = false;

    if (scrim) {
      scrim.hidden = !window.matchMedia('(max-width: 62rem)').matches;
      scrim.onclick = function () { selectedId = null; render(); };
    }
    var px = $('ppClose');
    if (px) px.addEventListener('click', function () { selectedId = null; render(); });
  }

  function renderLog() {
    logEl.innerHTML = state.log.slice(0, 60).map(function (e) {
      return '<li class="lg-' + e.kind + '">' + esc(e.text) + '</li>';
    }).join('');
  }

  var toastTimer = null, toastKey = '';
  function showToast(text, kind) {
    var el = $('toast');
    if (!el || !text) return;
    el.textContent = text;
    el.className = 'toast toast--' + (kind || 'info');
    void el.offsetWidth;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('on'); }, 2600);
  }
  /* Kejadian penting (sewa, gaji, bangkrut) juga muncul di atas papan, sebab catatan
     permainan ada di bawah lipatan layar HP dan mudah terlewat. */
  function toastForLog() {
    if (!state || !state.log.length) return;
    var e = state.log[0], key = e.text + '#' + state.log.length;
    if (key === toastKey) return;
    var first = !toastKey;
    toastKey = key;
    if (first || !overlayEl.hidden) return;
    if (['gain', 'pay', 'bad', 'warn'].indexOf(e.kind) < 0) return;
    showToast(e.text, e.kind);
  }

  function render() {
    if (!state) return;
    /* Tamu online tidak melewati beginPlay(), jadi bidak bisa belum dibuat. */
    if (!tokensEl.children.length) buildTokens();
    renderTiles(); renderPlayers(); renderTurnCard(); renderControls(); renderAssets(); renderPropPanel(); renderLog();
    state.players.forEach(function (p) { placeToken(p.id, p.pos, true); });
    focusBoard();
    deckChanceEl.textContent = state.decks.chance.length;
    deckChestEl.textContent = state.decks.chest.length;
    if (state.trade && !tradeDismissed && overlayEl.hidden) showTrade();
    if (!state.trade) { tradeDismissed = false; if (showingTrade) hideOverlay(); }
    if (state.phase === 'over') showWinner();
    toastForLog();
  }

  /* Di HP papan lebih lebar dari layar; geser otomatis ke bidak pemain yang sedang jalan. */
  var focusKey = '';
  function narrowScreen() { return window.matchMedia('(max-width: 62rem)').matches; }
  /* Geser HANYA jendela papan, jangan halaman: supaya zoom & tombol aksi tidak terdorong keluar layar. */
  function centerTile(tileId, smooth) {
    var t = tileEl(tileId), sc = $('boardScroll');
    if (!t || !sc) return;
    var maxL = Math.max(0, sc.scrollWidth - sc.clientWidth);
    var maxT = Math.max(0, sc.scrollHeight - sc.clientHeight);
    var left = Math.max(0, Math.min(maxL, t.offsetLeft + t.offsetWidth / 2 - sc.clientWidth / 2));
    var top = Math.max(0, Math.min(maxT, t.offsetTop + t.offsetHeight / 2 - sc.clientHeight / 2));
    sc.scrollTo({ left: left, top: top, behavior: smooth ? 'smooth' : 'auto' });
  }
  function focusBoard() {
    if (!state) return;
    if (!narrowScreen()) return;
    var p = state.players[state.turn];
    if (!p) return;
    var key = state.turn + ':' + p.pos;
    if (key === focusKey) return;
    focusKey = key;
    /* Di HP, giliran baru langsung dibesarkan ke petak pemain aktif. */
    if (state.phase !== 'over' && zoom < FOCUS_MIN) setZoom(FOCUS_ZOOM);
    var t = tileEl(p.pos);
    if (!t) return;
    var sc = $('boardScroll');
    if (!sc) return;
    /* Kalau petak sudah terlihat, jangan geser papan tanpa perlu. */
    var wr = sc.getBoundingClientRect();
    var tr = t.getBoundingClientRect();
    var seen = tr.left >= wr.left && tr.right <= wr.right && tr.top >= wr.top && tr.bottom <= wr.bottom;
    if (!seen) centerTile(p.pos, true);
  }

  function tradeName(id) { return BOARD[id].name; }

  var tradeDismissed = false;

  function tradeMine(tr) {
    return !state.players[tr.to].bot && iControl(tr.to);
  }

  function tradeChips(ids, cash) {
    var out = ids.map(function (id) {
      var t = BOARD[id];
      return '<span class="trade-chip"><i class="grp-' + (t.group || 'util') + '"></i>' + esc(t.name) + '</span>';
    }).join('');
    if (cash > 0) out += '<span class="trade-chip cash">' + G.fmt(cash) + '</span>';
    return out || '<span class="trade-empty">tidak ada</span>';
  }

  function showTrade() {
    var tr = state.trade;
    if (!tr) return;
    var A = state.players[tr.from], B = state.players[tr.to];
    var waiting = B.bot ? 'Menunggu jawaban ' + B.name + ' (bot).' :
      (session.mode === 'online' && session.isHost && seats[tr.to] && seats[tr.to].guestId) ? 'Menunggu jawaban ' + B.name + ' (online).' : null;
    var meAnswer = tradeMine(tr);
    showOverlay('<div class="sheet trade-sheet" role="dialog" aria-modal="true" aria-labelledby="tradeTitle">' +
      '<h2 id="tradeTitle">Tawaran dagang</h2>' +
      '<p class="trade-note">' + esc(A.name) + ' menawarkan ke ' + esc(B.name) + '.</p>' +
      '<div class="trade-sides">' +
        '<div class="trade-side"><h3>' + esc(A.name) + ' memberi</h3>' + tradeChips(tr.give, tr.cash) + '</div>' +
        '<span class="trade-swap" aria-hidden="true">' + icon('swap') + '</span>' +
        '<div class="trade-side"><h3>' + esc(A.name) + ' meminta</h3>' + tradeChips(tr.get, 0) + '</div>' +
      '</div>' +
      (waiting && !meAnswer ? '<p class="trade-note">' + esc(waiting) + '</p>' : '') +
      (meAnswer ? '<div class="sheet-acts">' +
        '<button class="btn btn--primary" id="tradeYes">Terima</button>' +
        '<button class="btn" id="tradeNo">Tolak</button>' +
        '<button class="btn" id="tradeLater">Lihat Papan Dulu</button></div>' : '') +
      (!meAnswer && !waiting ? '<div class="sheet-acts"><button class="btn" id="tradeClose">Tutup</button></div>' : '') +
      '</div>', 'trade');
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
  var overlayMode = '';
  function showOverlay(html, mode) { overlayEl.innerHTML = html; overlayEl.hidden = false; showingTrade = false; overlayMode = mode || ''; }
  function hideOverlay() { overlayEl.hidden = true; overlayEl.innerHTML = ''; showingTrade = false; overlayMode = ''; }

  function showCard() {
    var pc = state.pendingCard;
    if (!pc) { render(); return; }
    showOverlay('<div class="sheet card-sheet sheet-' + pc.deck + '" role="dialog" aria-modal="true">' +
      '<span class="cs-deck">' + (pc.deck === 'chance' ? 'Kesempatan' : 'Dana Umum') + '</span>' +
      '<p class="cs-text">' + pc.card.text + '</p>' +
      '<button class="btn btn--primary" id="cardOk">Lanjutkan</button></div>', 'card');
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
      '<p id="offerErr" class="form-err" hidden>Isi setidaknya satu properti atau uang tunai.</p>' +
      '<div class="sheet-acts"><button class="btn btn--primary" type="submit">Kirim Tawaran</button>' +
      '<button class="btn" type="button" id="ofCancel">Batal</button></div></form></div>');
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
      /* Tawaran kosong hanya membuat lawan bingung; minta pemain mengisi dulu. */
      var err = $('offerErr');
      if (!give.length && !get.length && !cash) {
        if (err) err.hidden = false;
        return;
      }
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
      '<p id="offerErr" class="form-err" hidden>Beri setidaknya satu properti atau uang tunai.</p>' +
      '<div class="sheet-acts"><button class="btn btn--primary" type="submit">Kirim Tawaran</button>' +
      '<button class="btn" type="button" id="ofCancel">Batal</button></div></form></div>');
    $('ofCancel').addEventListener('click', function () { hideOverlay(); render(); });
    $('offerForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var give = Array.prototype.slice.call(document.querySelectorAll('[data-give]:checked')).map(function (c) { return +c.dataset.give; });
      var cash = Math.max(0, parseInt(($('ofCash').value || '0').replace(/[^0-9]/g, ''), 10) || 0);
      var err = $('offerErr');
      if (!give.length && !cash) {
        if (err) err.hidden = false;
        return;
      }
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
    var order = state.players.slice().sort(function (a, b) {
      if (a.bankrupt !== b.bankrupt) return a.bankrupt ? 1 : -1;
      if (a.id === state.winner) return -1;
      if (b.id === state.winner) return 1;
      return b.cash - a.cash;
    });
    var rows = order.map(function (p, i) {
      var n = Object.keys(state.props).filter(function (id) { return state.props[id].owner === p.id; }).length;
      return '<li class="standing pl-' + p.color + (p.id === state.winner ? ' win' : '') + (p.bankrupt ? ' off' : '') + '">' +
        '<span class="rk">' + (i + 1) + '</span>' +
        '<span class="who">' + esc(p.name) + '</span>' +
        '<span class="cash num">' + G.fmt(p.cash) + '</span>' +
        '<span class="meta">' + n + ' properti' + (p.bankrupt ? ' · bangkrut' : '') + '</span></li>';
    }).join('');
    showOverlay('<div class="sheet win-sheet" role="dialog" aria-modal="true" aria-labelledby="winTitle">' +
      '<h2 id="winTitle">' + esc(w.name) + ' menang!</h2>' +
      '<p class="ws-sub">Tutup dengan ' + G.fmt(w.cash) + ' dan ' +
        Object.keys(state.props).filter(function (id) { return state.props[id].owner === w.id; }).length +
        ' properti setelah ' + state.round + ' ronde.</p>' +
      '<ul class="standings">' + rows + '</ul>' +
      '<button class="btn btn--primary" id="winAgain">Main Baru</button></div>', 'over');
    $('winAgain').addEventListener('click', leaveToStart);
  }

  function leaveToStart() {
    if (guestTimer) { clearTimeout(guestTimer); guestTimer = null; }
    keepAwake(false);
    try { Net.close(); } catch (e) { /* abaikan */ }
    state = null;
    selectedId = null;
    toastKey = '';
    clearTimeout(toastTimer);
    tradeDismissed = false;
    focusKey = '';
    if (assetsEl) { assetsEl.hidden = true; assetsEl.innerHTML = ''; }
    session = { mode: 'local', mySeats: [0, 1, 2, 3], isHost: true, room: null, mySeat: null, myName: '', netState: null };
    seats = [];
    openStart();
  }

  /* "Main Baru" di tengah permainan tidak boleh langsung jalan: satu ketukan
     salah di HP bisa membuang satu jam bermain. */
  function confirmLeave() {
    if (!state) { openStart(); return; }
    var online = session.mode === 'online';
    var note = online && session.isHost
      ? 'Ruang online akan ditutup dan tamu tidak bisa melanjutkan permainan ini.'
      : online
        ? 'Kamu keluar dari ruang. Kursimu masih bisa diambil lagi dengan kode yang sama.'
        : 'Semua pemain di perangkat ini kehilangan posisi, uang, dan propertinya.';
    showOverlay('<div class="sheet leave-sheet" role="dialog" aria-modal="true" aria-labelledby="leaveTitle">' +
      '<h2 id="leaveTitle">Mulai permainan baru?</h2>' +
      '<p class="cs-text">' + note + '</p>' +
      '<div class="sheet-acts"><button class="btn btn--primary" id="leaveYes" type="button">Ya, main baru</button>' +
      '<button class="btn" id="leaveNo" type="button">Lanjut main</button></div></div>', 'confirm');
    $('leaveNo').addEventListener('click', function () { hideOverlay(); if (state) render(); else openStart(); });
    $('leaveYes').addEventListener('click', leaveToStart);
    $('leaveNo').focus();
  }

  /* ---------- layar mulai / lobi ---------- */

  var BOT_OPTS = [['human', 'Orang'], ['mudah', 'Bot mudah'], ['sedang', 'Bot sedang'], ['sulit', 'Bot sulit']];

  /* Ruang terakhir disimpan di tab: setelah HP menutup halaman atau sinyal
     hilang, tamu tidak perlu mencari-cari kode lagi. */
  var LAST_KEY = 'monopoli-last-room-v1';
  function rememberRoom() {
    try {
      sessionStorage.setItem(LAST_KEY, JSON.stringify({ room: session.room, name: session.myName || 'Tamu' }));
    } catch (e) { /* mode privat: abaikan */ }
  }
  function forgetRoom() {
    try { sessionStorage.removeItem(LAST_KEY); } catch (e) { /* abaikan */ }
  }
  function lastRoom() {
    try {
      var v = JSON.parse(sessionStorage.getItem(LAST_KEY) || 'null');
      return v && /\b[A-Z0-9]{4,8}\b/.test(v.room || '') ? v : null;
    } catch (e) { return null; }
  }

  function seatRow(i, name, opts, sel) {
    return '<label class="ss-row"><span class="pl-dot tok-p' + (i + 1) + '">' + (i + 1) + '</span>' +
      '<input id="snm' + i + '" maxlength="14" value="' + esc(name).replace(/"/g, '') + '" aria-label="Nama kursi ' + (i + 1) + '">' +
      '<select id="stp' + i + '" aria-label="Jenis kursi ' + (i + 1) + '">' +
      opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sel ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select></label>';
  }

  function openStart() {
    hideOverlay();
    $('toast').classList.remove('on');
    var last = lastRoom();
    showOverlay('<div class="sheet start-sheet" role="dialog" aria-modal="true" aria-labelledby="startTitle">' +
      '<div class="start-head"><h2 id="startTitle">Mau main di mana?</h2>' +
      '<p class="ss-sub">Sendiri, berempat di satu perangkat, atau online lintas perangkat.</p></div>' +
      '<div class="mode-grid">' +
        (last ? '<button class="mode" id="mResume" type="button">' +
          '<span class="mode-ic">' + icon('join') + '</span>' +
          '<span class="mode-txt"><span class="mode-t">Kembali ke ruang ' + esc(last.room) + '</span>' +
          '<span class="mode-s">Kursimu masih disimpan selama host belum menutup ruang.</span></span>' +
          '<span class="mode-go">' + icon('arrow') + '</span></button>' : '') +
        '<button class="mode mode--primary" id="mLocal" type="button">' +
          '<span class="mode-ic">' + icon('local') + '</span>' +
          '<span class="mode-txt"><span class="mode-t">Main di perangkat ini</span>' +
          '<span class="mode-s">Bergantian di satu HP atau laptop. Kursi kosong diisi bot.</span></span>' +
          '<span class="mode-go">' + icon('arrow') + '</span></button>' +
        '<button class="mode" id="mHost" type="button">' +
          '<span class="mode-ic">' + icon('host') + '</span>' +
          '<span class="mode-txt"><span class="mode-t">Buat ruang online</span>' +
          '<span class="mode-s">Bagikan satu kode; teman gabung dari perangkatnya sendiri.</span></span>' +
          '<span class="mode-go">' + icon('arrow') + '</span></button>' +
        '<button class="mode" id="mJoin" type="button">' +
          '<span class="mode-ic">' + icon('join') + '</span>' +
          '<span class="mode-txt"><span class="mode-t">Gabung ruang</span>' +
          '<span class="mode-s">Sudah punya kode dari host? Masuk ke mejanya.</span></span>' +
          '<span class="mode-go">' + icon('arrow') + '</span></button>' +
      '</div>' +
      '<p class="start-foot">Online butuh internet. Host adalah penjaga permainan: biarkan tabnya tetap terbuka.</p>' +
      '</div>', 'start');
    $('mLocal').addEventListener('click', function () { openLocalSetup(); });
    $('mHost').addEventListener('click', function () { openHostSetup(); });
    $('mJoin').addEventListener('click', function () { openJoinSetup(); });
    if (last) $('mResume').addEventListener('click', function () { openJoinSetup(last.room, last.name); });
    addInstallBtn();
  }

  /* ---------- pasang sebagai aplikasi (PWA) ----------
     Di HP, game yang terpasang terasa seperti aplikasi biasa: ikon di layar
     utama, layar penuh, dan tetap terbuka walau sinyal hilang. */
  var installPrompt = null;
  function addInstallBtn() {
    var grid = document.querySelector('.mode-grid');
    if (!grid || !installPrompt || document.getElementById('mInstall')) return;
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'mode';
    b.id = 'mInstall';
    b.innerHTML = '<span class="mode-ic">' + icon('install') + '</span>' +
      '<span class="mode-txt"><span class="mode-t">Pasang sebagai aplikasi</span>' +
      '<span class="mode-s">Ikon di layar utama HP; tetap jalan tanpa internet.</span></span>' +
      '<span class="mode-go">' + icon('arrow') + '</span>';
    b.addEventListener('click', function () {
      if (!installPrompt) return;
      var pr = installPrompt;
      installPrompt = null;
      pr.prompt();
      (pr.userChoice || Promise.resolve()).then(function () { removeInstallBtn(); });
    });
    grid.appendChild(b);
  }
  function removeInstallBtn() {
    var b = document.getElementById('mInstall');
    if (b) b.parentNode.removeChild(b);
  }
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    installPrompt = e;
    addInstallBtn();
  });
  window.addEventListener('appinstalled', function () {
    installPrompt = null;
    removeInstallBtn();
  });

  /* Susunan cepat: pasangan LDR biasanya berdua + dua bot, tapi semuanya bisa diubah. */
  var PRESETS = {
    solo: [['Kamu', 'human'], ['Bot 2', 'sedang'], ['Bot 3', 'sedang'], ['Bot 4', 'sedang']],
    duo: [['Pemain 1', 'human'], ['Pemain 2', 'human'], ['Bot 3', 'sedang'], ['Bot 4', 'sedang']],
    four: [['Pemain 1', 'human'], ['Pemain 2', 'human'], ['Pemain 3', 'human'], ['Pemain 4', 'human']]
  };
  function markPreset(kind) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
      b.setAttribute('aria-pressed', b.dataset.preset === kind ? 'true' : 'false');
    });
  }
  function applyPreset(kind) {
    var cfg = PRESETS[kind];
    if (!cfg) return;
    cfg.forEach(function (c, i) {
      var n = $('snm' + i), s = $('stp' + i);
      if (n) n.value = c[0];
      if (s) s.value = c[1];
    });
    markPreset(kind);
    var err = $('setupErr');
    if (err) err.hidden = true;
  }

  function openLocalSetup(prev) {
    var names = prev || ['Pemain 1', 'Pemain 2', 'Pemain 3', 'Pemain 4'];
    var sels = ['human', 'human', 'human', 'human'];
    showOverlay('<div class="sheet sheet--form start-sheet" role="dialog" aria-modal="true" aria-labelledby="setupTitle">' +
      '<h2 id="setupTitle">Siapa yang bermain?</h2>' +
      '<p class="ss-sub">Giliran bergantian di perangkat ini. Kursi bot dimainkan otomatis.</p>' +
      '<div class="presets" role="group" aria-label="Susunan cepat kursi">' +
        '<button class="chip" type="button" data-preset="solo" aria-pressed="false">Sendirian + 3 bot</button>' +
        '<button class="chip" type="button" data-preset="duo" aria-pressed="false">Berdua + 2 bot</button>' +
        '<button class="chip" type="button" data-preset="four" aria-pressed="false">Berempat</button>' +
      '</div>' +
      '<form id="startForm" class="ss-form">' +
      [0, 1, 2, 3].map(function (i) { return seatRow(i, names[i], BOT_OPTS, sels[i]); }).join('') +
      '</form>' +
      '<p id="setupErr" class="form-err" hidden>Sisakan setidaknya satu kursi untuk orang.</p>' +
      '<div class="sheet-acts">' +
      '<button class="btn btn--primary" type="submit" form="startForm">Mulai Bermain</button>' +
      '<button class="btn" id="backModes">Kembali</button></div></div>', 'setup');
    Array.prototype.forEach.call(document.querySelectorAll('[data-preset]'), function (b) {
      b.addEventListener('click', function () { applyPreset(b.dataset.preset); });
    });
    $('startForm').addEventListener('change', function () {
      markPreset('');
      var err = $('setupErr');
      if (err) err.hidden = true;
    });
    $('backModes').addEventListener('click', openStart);
    $('startForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var built = [0, 1, 2, 3].map(function (i) {
        var nm = $('snm' + i).value.trim();
        var ty = $('stp' + i).value;
        return { name: nm || (ty === 'human' ? 'Pemain ' + (i + 1) : 'Bot ' + (i + 1)), bot: ty === 'human' ? null : ty };
      });
      if (!built.some(function (b) { return !b.bot; })) {
        var err = $('setupErr');
        if (err) err.hidden = false;
        var first = $('stp0');
        if (first) first.focus();
        return;
      }
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
    session = { mode: 'online', mySeats: [], isHost: true, room: info.room, mySeat: null, myName: '', netState: 'wait' };
    seats = [0, 1, 2, 3].map(function (i) {
      return { type: i === 0 ? 'sini' : (i === 1 ? 'online' : 'sedang-bot'), bot: i === 0 ? null : 'sedang', name: 'Kursi ' + (i + 1), guestId: null };
    });
    seats[0].type = 'sini';
    renderHostLobby();
  }

  function inviteText() {
    return 'Ayo main Monopoli Nusantara! Buka ' + location.origin + location.pathname +
      ' lalu pilih Gabung ruang dengan kode ' + session.room + '.';
  }
  function noteShare(text) {
    var el = $('shareMsg');
    if (!el) return;
    el.textContent = text;
    el.hidden = false;
  }
  function copyInvite(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function () {
          noteShare('Undangan disalin. Tinggal tempel di chat.');
        }, function () { noteShare('Kode ruang: ' + session.room); });
        return;
      }
    } catch (e) { /* peramban lama: tampilkan kodenya saja */ }
    noteShare('Kode ruang: ' + session.room);
  }
  function shareInvite() {
    var text = inviteText();
    if (navigator.share) {
      navigator.share({ title: 'Monopoli Nusantara', text: text }).then(function () {
        noteShare('Undangan dibagikan.');
      }).catch(function () { noteShare('Kode ruang: ' + session.room); });
      return;
    }
    copyInvite(text);
  }

  function renderHostLobby() {
    /* Nama yang sedang diketik tidak boleh hilang saat tamu lain bergabung. */
    var nameInput = $('hostName');
    if (nameInput) session.myName = nameInput.value;
    seats[0].name = (session.myName || 'Host').trim() || 'Host';
    var netCls = session.netState === 'ok' ? ' ok' : (session.netState === 'bad' ? ' bad' : '');
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
    showOverlay('<div class="sheet start-sheet" role="dialog" aria-modal="true" aria-labelledby="lobbyTitle">' +
      '<h2 id="lobbyTitle">Ruang <span class="room-code">' + esc(session.room) + '</span></h2>' +
      '<p class="ss-sub">Bagikan kode ini. Tamu memilih <strong>Gabung ruang</strong>, lalu memasukkan kode dan namanya.</p>' +
      '<div class="pp-acts">' +
      '<button class="btn invite-act" id="hostShare" type="button">' + icon('share') + '<span>Bagikan kode</span></button>' +
      '<button class="btn invite-act" id="hostCopy" type="button">' + icon('copy') + '<span>Salin</span></button></div>' +
      '<p class="ss-sub" id="shareMsg" hidden></p>' +
      '<p class="ss-sub net-status' + netCls + '">' + esc(hostNetMsg) + '</p>' +
      '<label class="ss-row">Nama saya <input id="hostName" maxlength="14" value="' + esc(session.myName || 'Host').replace(/"/g, '') + '"></label>' +
      '<p class="ss-sub">Kursi tanpa tamu diisi bot saat mulai. Tamu yang masuk mengambil kursi kosong.</p>' +
      '<ul class="players">' + rows + '</ul>' +
      '<div class="pp-acts lobby-acts"><button class="btn btn--primary" id="hostStart">Mulai Bermain</button>' +
      '<button class="btn" id="hostCancel">Batal</button></div></div>', 'lobby');
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
    $('hostShare').addEventListener('click', shareInvite);
    $('hostCopy').addEventListener('click', function () { copyInvite(inviteText()); });
    $('hostName').addEventListener('input', function () {
      session.myName = this.value;
      seats[0].name = (session.myName || 'Host').trim() || 'Host';
      clearTimeout(lobbyTimer);
      lobbyTimer = setTimeout(broadcastLobby, 450);
    });
    $('hostName').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); $('hostStart').click(); }
    });
    $('hostStart').addEventListener('click', function () {
      session.myName = $('hostName').value.trim() || 'Host';
      seats[0].name = session.myName;
      startOnlineGame();
    });
    $('hostCancel').addEventListener('click', leaveToStart);
    broadcastLobby();
  }
  var lobbyTimer = null;

  /* Lobi disiarkan ke semua tamu yang menunggu, jadi daftar kursi ikut hidup. */
  function broadcastLobby() {
    if (state || session.mode !== 'online' || !session.isHost || !session.room) return;
    Net.send('lobby', { seats: pubSeats() });
  }

  function onGuestHello(d) {
    if (session.mode !== 'online' || !session.isHost) return;
    var known = -1;
    seats.forEach(function (s, i) { if (s.guestId === d.id) known = i; });
    if (known < 0) known = reclaimSeat(d.id);
    var fresh = false;
    if (known < 0) {
      var slot = -1;
      seats.forEach(function (s, i) { if (slot < 0 && s.type === 'online' && !s.guestId && !s.takenFrom) slot = i; });
      /* Sebelum permainan dimulai, kursi bot yang masih kosong boleh dipakai tamu:
         tuan rumah cukup membagikan kode, empat orang langsung dapat kursi. */
      if (slot < 0 && !state) {
        seats.forEach(function (s, i) { if (slot < 0 && (s.type === 'bot' || s.type === 'sedang-bot') && !s.guestId) slot = i; });
      }
      if (slot < 0) {
        Net.sendToGuest(d.id, { kind: 'room-full' });
        return;
      }
      known = slot;
      fresh = true;
      seats[known].guestId = d.id;
      seats[known].type = 'online';
      seats[known].bot = null;
      seats[known].name = d.name || ('Tamu ' + (known + 1));
    }
    var s = seats[known];
    if (!s.name) s.name = d.name || ('Tamu ' + (known + 1));
    Net.sendToGuest(d.id, { kind: 'welcome', seat: known, seats: pubSeats() });
    if (state) {
      state.players[known].bot = null;
      state.players[known].name = s.name;
      if (fresh) G.log(state, s.name + ' bergabung di kursi ' + (known + 1) + '.', 'info');
      broadcast(); render(); scheduleBot(); armGuestTimer();
    } else renderHostLobby();
  }

  function onGuestBye(d) {
    if (session.mode !== 'online' || !session.isHost) return;
    seats.forEach(function (s, i) {
      if (s.guestId !== d.id) return;
      /* Sambungan lama putus setelah tamu sudah menyambung lagi: jangan singkirkan. */
      if (d.reason === 'close' && Net.isGuestOnline(d.id)) return;
      var leftName = state && state.players[i] ? state.players[i].name : s.name;
      s.guestId = null;
      if (!state) {
        s.type = 'online'; s.bot = null; s.name = 'Kursi ' + (i + 1);
        s.takenFrom = null; s.takenName = null;
        renderHostLobby();
        return;
      }
      s.type = 'bot';
      s.bot = 'sedang';
      s.name = 'Bot ' + (i + 1);
      /* Kursi tetap milik tamu aslinya: siapa pun yang kembali dengan id
         yang sama mengambil kursi yang sama, bukan kursi kosong lain. */
      s.takenFrom = d.id; s.takenName = leftName;
      if (d.reason === 'close') {
        G.log(state, leftName + ' terputus; bot meminjam kursinya sampai dia kembali.', 'warn');
      } else {
        G.log(state, leftName + ' keluar; bot meminjam kursinya sampai dia kembali.', 'warn');
      }
      state.players[i].bot = 'sedang';
      state.players[i].name = s.name;
      broadcast(); render(); scheduleBot(); armGuestTimer();
    });
  }
  function onGuestMsg(d) {
    if (!state || state.phase === 'over' || session.mode !== 'online' || !session.isHost) return;
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
    if (!res.path || !res.path.length) { render(); scheduleBot(); armGuestTimer(); return; }
    (function (path) {
      busy = true; renderControls();
      animatePath(seat, path).then(function () { snapToPos(seat); }).then(function () {
        busy = false; broadcast(); render(); scheduleBot(); armGuestTimer();
      });
    })(res.path);
  }

  function pubSeats() {
    return seats.map(function (s) { return { type: s.type, bot: s.bot, name: s.name, online: !!s.guestId }; });
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

  var waitSeats = null;

  function seatListHTML(list, mySeat) {
    if (!list || !list.length) return '';
    return '<ul class="players">' + list.map(function (s, i) {
      var tag = i === mySeat ? 'kamu' :
        (s.type === 'sini' ? 'host' : (s.type === 'online' ? (s.online ? 'online' : 'kosong') : 'bot'));
      return '<li class="pl pl-p' + (i + 1) + '">' +
        '<span class="pl-dot tok-p' + (i + 1) + '">' + (i + 1) + '</span>' +
        '<span class="pl-name">' + esc(s.name || ('Kursi ' + (i + 1))) + '</span>' +
        '<span class="badge">' + tag + '</span></li>';
    }).join('') + '</ul>';
  }

  function showJoining(code) {
    showOverlay('<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="joinWaitTitle">' +
      '<h2 id="joinWaitTitle">Menghubungi host…</h2>' +
      '<p class="ss-sub">Ruang <strong class="room-code">' + esc(code) + '</strong>. Pastikan tab host masih terbuka.</p>' +
      '<div class="wait-line"><i></i><span>Mencari host…</span></div>' +
      '<p class="ss-sub">Di jaringan lambat ini bisa sampai 30 detik. Jangan tutup halaman.</p>' +
      '<button class="btn" id="joinCancel">Batal</button></div>', 'wait');
    $('joinCancel').addEventListener('click', leaveToStart);
  }

  function renderWaiting() {
    showOverlay('<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="waitTitle">' +
      '<h2 id="waitTitle">Kamu di kursi ' + (session.mySeat + 1) + '</h2>' +
      '<p class="ss-sub">Ruang <strong class="room-code">' + esc(session.room) + '</strong> · menunggu host memulai permainan.</p>' +
      seatListHTML(waitSeats, session.mySeat) +
      '<div class="wait-line"><i></i><span>Menunggu host…</span></div>' +
      '<button class="btn" id="joinLeave">Keluar ruang</button></div>', 'wait');
    $('joinLeave').addEventListener('click', leaveToStart);
  }

  function openJoinSetup(code, name) {
    showOverlay('<div class="sheet sheet--form start-sheet" role="dialog" aria-modal="true" aria-labelledby="joinTitle">' +
      '<h2 id="joinTitle">Gabung ruang</h2>' +
      '<p class="ss-sub">Masukkan kode enam huruf dari host, lalu namamu.</p>' +
      '<form id="joinForm" class="ss-form">' +
      '<label class="ss-row">Kode ruang <input id="joinCode" maxlength="6" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="mis. K7Q2XA" value="' + escAttr(code || '') + '"></label>' +
      '<label class="ss-row">Namamu <input id="joinName" maxlength="14" placeholder="Namamu" value="' + escAttr(name || '') + '"></label>' +
      '</form>' +
      '<div class="sheet-acts">' +
      '<button class="btn btn--primary" type="submit" form="joinForm">Gabung</button>' +
      '<button class="btn" id="backModes2">Kembali</button></div></div>', 'join');
    $('joinCode').focus();
    $('backModes2').addEventListener('click', function () { Net.close(); openStart(); });
    $('joinForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var code = $('joinCode').value.trim().toUpperCase();
      var name = $('joinName').value.trim() || 'Tamu';
      if (!code) { $('joinCode').focus(); return; }
      session = { mode: 'online', mySeats: [], isHost: false, room: code, mySeat: null, myName: name, netState: null, hostClosed: false };
      waitSeats = null;
      showJoining(code);
      Net.joinRoom(code, name);
    });
  }

  function onJoined(d) {
    session.mySeat = d.seat;
    session.mySeats = [d.seat];
    rememberRoom();
    if (d.seats) waitSeats = d.seats;
    renderWaiting();
  }

  function onRoomClosed() {
    session.hostClosed = true;
    forgetRoom();
    showOverlay('<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="closedTitle">' +
      '<h2 id="closedTitle">Host menutup ruang</h2>' +
      '<p class="ss-sub">Permainan di ruang ini sudah dihentikan. Kamu bisa membuat ruang sendiri atau bergabung dengan kode baru.</p>' +
      '<button class="btn btn--primary" id="rcOk">Kembali</button></div>', 'error');
    $('rcOk').addEventListener('click', leaveToStart);
  }

  function showJoinError(msg) {
    showOverlay('<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="joinErrTitle">' +
      '<h2 id="joinErrTitle">Gagal gabung</h2>' +
      '<p class="ss-sub">' + esc(msg || 'Tidak bisa gabung ke ruang itu.') + '</p>' +
      '<div class="sheet-acts"><button class="btn btn--primary" id="rjRetry">Coba lagi</button>' +
      '<button class="btn" id="rjOk">Kembali</button></div></div>', 'error');
    $('rjRetry').addEventListener('click', function () {
      var code = session.room, name = session.myName;
      Net.close();
      openJoinSetup(code, name);
    });
    $('rjOk').addEventListener('click', leaveToStart);
  }

  function showDisconnected() {
    if (session.hostClosed) return;
    showOverlay('<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="lostTitle">' +
      '<h2 id="lostTitle">Koneksi terputus</h2>' +
      '<p class="ss-sub">Kursimu di ruang <strong class="room-code">' + esc(session.room) + '</strong> masih disimpan. Sambungkan internet, lalu gabung ulang.</p>' +
      '<div class="sheet-acts"><button class="btn btn--primary" id="rejoin">Gabung ulang</button>' +
      '<button class="btn" id="rejoinQuit">Keluar</button></div></div>', 'error');
    $('rejoin').addEventListener('click', rejoinRoom);
    $('rejoinQuit').addEventListener('click', leaveToStart);
  }

  function rejoinRoom() {
    var code = session.room, name = session.myName || 'Tamu';
    if (!code) { leaveToStart(); return; }
    session.hostClosed = false;
    session.mySeat = null;
    waitSeats = null;
    showJoining(code);
    Net.joinRoom(code, name, { silent: true });
  }

  function onHostMsg(m) {
    if (m.kind === 'room-full' && !state) {
      showOverlay('<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="fullTitle">' +
        '<h2 id="fullTitle">Ruang penuh</h2>' +
        '<p class="ss-sub">Semua kursi sudah terisi, atau permainan sudah dimulai tanpa kursi kosong. Minta host memakai kursi lain atau membuat ruang baru.</p>' +
        '<div class="sheet-acts"><button class="btn btn--primary" id="rfRetry">Coba kode lain</button>' +
        '<button class="btn" id="rfOk">Kembali</button></div></div>', 'error');
      $('rfRetry').addEventListener('click', function () { openJoinSetup(session.room, session.myName); });
      $('rfOk').addEventListener('click', leaveToStart);
      return;
    }
    if (m.kind === 'lobby' && !state) {
      waitSeats = m.seats || null;
      if (session.mySeat !== null) renderWaiting();
      return;
    }
    if (m.kind === 'state' && m.snap) applySnapshot(m.snap, m.seats);
  }

  /* Semua pendengar jaringan dipasang sekali; kalau dipasang tiap kali gabung,
     pesan yang sama diproses berkali-kali setelah beberapa percobaan. */
  var netWired = false;
  function wireNet() {
    if (netWired) return;
    netWired = true;
    Net.on('guest-hello', function (d) { if (session.mode === 'online' && session.isHost) onGuestHello(d); });
    Net.on('guest-bye', function (d) { if (session.mode === 'online' && session.isHost) onGuestBye(d); });
    Net.on('guest-msg', function (d) { if (session.mode === 'online' && session.isHost) onGuestMsg(d); });
    Net.on('host-net', function (d) {
      if (session.mode !== 'online' || !session.isHost) return;
      hostNetMsg = d.message;
      session.netState = d.ok ? 'ok' : (/menyiapkan/i.test(d.message || '') ? 'wait' : 'bad');
      if (!state) renderHostLobby();
      else if (!d.ok) showToast(d.message, 'bad');
    });
    Net.on('room', function (d) {
      if (session.mode !== 'online') return;
      session.room = d.room;
      if (session.isHost && !state) renderHostLobby();
    });
    Net.on('joined', function (d) { if (session.mode === 'online' && !session.isHost) onJoined(d); });
    Net.on('host-msg', function (m) { if (session.mode === 'online' && !session.isHost) onHostMsg(m); });
    Net.on('room-closed', function () { if (session.mode === 'online' && !session.isHost) onRoomClosed(); });
    Net.on('conn-lost', function () { if (session.mode === 'online' && !session.isHost) showDisconnected(); });
    Net.on('error', function (d) { if (session.mode === 'online' && !session.isHost) showJoinError(d && d.message); });
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
    /* Lembar aturan tidak ditutup oleh snapshot: pemain mungkin sedang membacanya. */
    if (overlayMode !== 'rules') hideOverlay();
    session.hostClosed = false;
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
    if (state.trade) return;
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
    /* Kejadian "permainan dimulai" tidak perlu toast. */
    toastKey = state.log[0] ? state.log[0].text + '#' + state.log.length : '';
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

  function openRules() {    showOverlay('<div class="sheet rules-sheet" role="dialog" aria-modal="true">' +
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
  var FOCUS_ZOOM = 1.5;   // cukup besar untuk membaca nama petak di HP
  var FOCUS_MIN = 1.25;   // di bawah ini papan dianggap terlalu kecil untuk diikuti
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
    if (state) state.players.forEach(function (p) {
      /* Saat animasi berjalan, state sudah di petak tujuan. Pakai petak yang
         sedang tampil supaya bidak tidak melompat ke tujuan ketika di-zoom. */
      var el = tokensEl.querySelector('[data-p="' + p.id + '"]');
      var shown = el && el.dataset.tile !== undefined && el.dataset.tile !== '' ? Number(el.dataset.tile) : p.pos;
      placeToken(p.id, shown, true);
    });
  }
  function setZoom(z, focus) {
    zoom = Math.min(2.5, Math.max(0.5, z));
    applyZoom();
    /* Tombol zoom di HP langsung memusatkan papan ke pemain yang sedang giliran. */
    if (focus && state && state.players[state.turn]) centerTile(state.players[state.turn].pos, true);
  }
  function wireZoom() {
    var zin = $('zoomIn'), zout = $('zoomOut'), zr = $('zoomReset'), sc = $('boardScroll');
    if (zin) zin.addEventListener('click', function () { setZoom(zoom + 0.25, true); });
    if (zout) zout.addEventListener('click', function () { setZoom(zoom - 0.25, true); });
    if (zr) zr.addEventListener('click', function () { setZoom(1, true); });
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
  wireNet();
  $('btnRules').addEventListener('click', openRules);
  $('btnNew').addEventListener('click', confirmLeave);
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
