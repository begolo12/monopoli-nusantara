/* Jaringan P2P: host-otoritatif, tamu mengirim niat, host menyiarkan state utuh.
   Tanpa server sendiri, tanpa akun. Transport lapis dua:
   1. Lokal (BroadcastChannel + localStorage) untuk tab se-perangkat.
   2. Internet (PeerJS cloud publik) untuk beda perangkat/kota — inilah yang
      dipakai pasangan main LDR. Pesan punya ID unik sehingga rangkap dari
      dua jalur otomatis dibuang. */
(function () {
  'use strict';
  var PEER_CDN = 'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js';
  var PEER_PREFIX = 'monopoli-nusantara-v1-';

  var listeners = {};
  var hostSend = null;
  var isHost = false;
  var myId = null;
  var room = null;
  var joined = {};
  var seen = {};
  var seenOrder = [];

  function on(ev, fn) {
    listeners[ev] = listeners[ev] || [];
    listeners[ev].push(fn);
  }
  function emit(ev, data) {
    (listeners[ev] || []).forEach(function (fn) { try { fn(data); } catch (e) { /* abaikan */ } });
  }

  function uid() {
    return 'p' + Math.random().toString(36).slice(2, 8);
  }
  /* ID tamu disimpan per tab: halaman yang dimuat ulang (misal HP mati layar)
     kembali memakai kursi yang sama, bukan dianggap tamu baru. */
  function guestId() {
    try {
      var v = sessionStorage.getItem('monopoli-gid-v1');
      if (!v) { v = uid(); sessionStorage.setItem('monopoli-gid-v1', v); }
      return v;
    } catch (e) { return uid(); }
  }
  function mid() {
    return 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }
  function roomCode() {
    var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    var s = '';
    for (var i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
  }

  function remember(id) {
    if (seen[id]) return false;
    seen[id] = 1; seenOrder.push(id);
    if (seenOrder.length > 500) delete seen[seenOrder.shift()];
    return true;
  }

  /* ---- jalur lokal: BC + localStorage ---- */
  var LS_KEY = 'monopoli-net-v1';
  var bc = null;
  var lsHandler = null;

  function localPost(msg) {
    if (bc) { try { bc.postMessage(msg); } catch (e) { /* abaikan */ } }
    try { localStorage.setItem(LS_KEY, JSON.stringify(msg)); } catch (e) { /* abaikan */ }
  }
  function localListen() {
    if (bc) { try { bc.onmessage = function (e) { onBusMessage(e.data); }; } catch (e) { /* abaikan */ } }
    if (!lsHandler) {
      lsHandler = function (e) {
        if (!e || e.key !== LS_KEY || !e.newValue) return;
        var m = null;
        try { m = JSON.parse(e.newValue); } catch (err) { return; }
        onBusMessage(m);
      };
      window.addEventListener('storage', lsHandler);
    }
  }
  function localOpen(code) {
    localClose();
    if ('BroadcastChannel' in window) {
      try { bc = new BroadcastChannel('monopoli-' + code); } catch (e) { bc = null; }
    }
    localListen();
  }
  function localClose() {
    if (bc) { try { bc.close(); } catch (e) { /* abaikan */ } }
    bc = null;
  }

  /* ---- jalur internet: PeerJS ---- */
  var peer = null;
  var hostConn = null;   // dipakai tamu: koneksi ke host
  var guestConns = {};   // dipakai host: guestId -> koneksi
  var peerLoading = null;

  function ensurePeer(cb) {
    if (window.Peer) { cb(null); return; }
    if (peerLoading) { peerLoading.push(cb); return; }
    peerLoading = [cb];
    var done = function (err) {
      var q = peerLoading; peerLoading = null;
      q.forEach(function (f) { try { f(err); } catch (e) { /* abaikan */ } });
    };
    var script = document.createElement('script');
    var timer = setTimeout(function () { done(new Error('timeout')); }, 20000);
    script.onload = function () { clearTimeout(timer); done(window.Peer ? null : new Error('gagal muat')); };
    script.onerror = function () { clearTimeout(timer); done(new Error('gagal muat')); };
    script.src = PEER_CDN;
    document.head.appendChild(script);
  }

  function hostPeerId(code) { return PEER_PREFIX + code + '-host'; }

  function peerPost(msg, toConn) {
    try {
      if (toConn && toConn.open) { toConn.send(msg); return true; }
    } catch (e) { /* abaikan */ }
    return false;
  }

  function attachHostPeer(p) {
    p.on('connection', function (conn) {
      conn.on('data', function (m) { onBusMessage(m, conn); });
      conn.on('close', function () {
        Object.keys(guestConns).forEach(function (gid) {
          if (guestConns[gid] === conn) {
            delete guestConns[gid];
            /* 'close' = koneksi putus mendadak (HP mati layar, sinyal hilang).
               Kursinya tidak dibuang permanen; tamu bisa mengambilnya lagi. */
            emit('guest-bye', { id: gid, reason: 'close' });
          }
        });
      });
      conn.on('error', function () { /* abaikan, close menyusul */ });
    });
  }

  /* ---- kirim gabungan ---- */
  function busPost(msg) {
    msg._mid = msg._mid || mid();
    localPost(msg);
    if (isHost) {
      if (msg.to === 'all') {
        Object.keys(guestConns).forEach(function (gid) { peerPost(msg, guestConns[gid]); });
      } else if (guestConns[msg.to]) {
        peerPost(msg, guestConns[msg.to]);
      }
    } else if (hostConn) {
      peerPost(msg, hostConn);
    }
  }

  /* ---- host ---- */
  function hostRoom(code) {
    close();
    isHost = true; room = code || roomCode(); myId = uid();
    localOpen(room);
    emit('room', { room: room, id: myId });
    emit('host-net', { ok: false, message: 'Menyiapkan koneksi online…' });
    ensurePeer(function (err) {
      if (!isHost) return;
      if (err) { emit('host-net', { ok: false, message: 'Tanpa internet: hanya perangkat ini yang bisa gabung. Periksa koneksi lalu buat ruang baru.' }); return; }
      var startPeer = function (codeTry) {
        var p = new window.Peer(hostPeerId(codeTry));
        p.on('open', function () {
          peer = p;
          emit('host-net', { ok: true, message: 'Online siap. Bagikan kode ke pasangan, biarkan tab ini terbuka.' });
        });
        p.on('error', function (e) {
          if (e && e.type === 'unavailable-id') {
            try { p.destroy(); } catch (x) { /* abaikan */ }
            room = roomCode();
            localOpen(room);
            emit('room', { room: room, id: myId });
            startPeer(room);
          } else if (e && (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error')) {
            emit('host-net', { ok: false, message: 'Koneksi online putus. Cek internet; tamu bisa gabung ulang dengan kode yang sama.' });
          }
        });
        attachHostPeer(p);
      };
      startPeer(room);
    });
    return { room: room, id: myId };
  }

  /* ---- tamu ---- */
  function joinRoom(code, name, opts) {
    /* silent dipakai saat gabung ulang: kursi lama dipakai lagi, jadi jangan
       mengirim 'bye' yang justru membebaskan kursi itu. */
    var silent = !!(opts && opts.silent);
    close(silent);
    isHost = false; room = (code || '').toUpperCase().trim(); myId = guestId();
    localOpen(room);
    emit('room', { room: room, id: myId });
    ensurePeer(function (err) {
      if (isHost || !room) return;
      if (err || !window.Peer) { tryPeerLocal(); return; }
      var p = new window.Peer();
      p.on('open', function () {
        peer = p;
        var conn = p.connect(hostPeerId(room), { reliable: true });
        conn.on('open', function () {
          hostConn = conn;
          startHello(name);
        });
        conn.on('data', function (m) { onBusMessage(m); });
        conn.on('close', function () {
          hostConn = null;
          if (!joined.host) emit('error', { message: 'Host tidak menjawab. Pastikan kode ruang benar dan tab host masih terbuka.' });
          else emit('conn-lost', {});
        });
        conn.on('error', function () { /* abaikan, close menyusul */ });
      });
      p.on('error', function (e) {
        if (e && e.type === 'peer-unavailable') {
          tryPeerLocal();
        } else if (!joined.host) {
          emit('error', { message: 'Tidak bisa menghubungi host. Periksa kode ruang dan koneksi internet.' });
        }
      });
    });
    return { room: room, id: myId };
  }

  function tryPeerLocal() {
    // Host mungkin se-perangkat (tab lain): andalkan jalur lokal saja.
    hostSend = function (msg) { localPost(Object.assign({ from: myId, to: 'host', room: room }, msg)); };
    startHello('local');
  }

  function startHello(name) {
    if (hostSendHello) return;
    hostSendHello = true;
    if (!hostSend) {
      hostSend = function (msg) { busPost(Object.assign({ from: myId, to: 'host', room: room }, msg)); };
    }
    var tries = 0;
    var myTimer = setInterval(function () {
      tries++;
      if (joined.host) { clearInterval(myTimer); hostSendHello = false; return; }
      hostSend({ kind: 'hello', name: name || 'Tamu' });
      /* Jaringan lambat / relay jauh bisa butuh puluhan detik; jangan menyerah terlalu cepat. */
      if (tries > 60) {
        clearInterval(myTimer);
        hostSendHello = false;
        emit('error', { message: 'Host tidak menjawab. Pastikan kode ruang benar dan tab host masih terbuka.' });
      }
    }, 750);
    hostSend({ kind: 'hello', name: name || 'Tamu' });
  }
  var hostSendHello = false;

  function send(kind, data) {
    /* Jenis amplop selalu menang: isi pesan tidak boleh menimpa kind. */
    var msg = Object.assign({}, data || {}, { kind: kind });
    if (isHost) busPost(Object.assign({ from: myId, to: 'all', room: room }, msg));
    else if (hostSend) hostSend(msg);
    else if (hostConn) busPost(Object.assign({ from: myId, to: 'host', room: room }, msg));
  }

  function sendToGuest(gid, msg) {
    if (!isHost) return;
    busPost(Object.assign({ from: myId, to: gid, room: room }, msg));
  }

  /* Host memakainya untuk membedakan "tamu menutup ruang/koneksi" dari
     "koneksi putus sebentar, tamu masih di sana". */
  function isGuestOnline(id) {
    var c = guestConns[id];
    return !!(c && c.open !== false);
  }

  function onBusMessage(m, conn) {
    if (!m || m.room !== room || !m._mid || !remember(m._mid)) return;
    if (isHost) {
      if (m.to !== 'host' || m.from === myId) return;
      if (conn && m.kind === 'hello') guestConns[m.from] = conn;
      if (m.kind === 'hello') { emit('guest-hello', { id: m.from, name: m.name }); joined[m.from] = true; }
      else if (m.kind === 'bye') { emit('guest-bye', { id: m.from, reason: 'bye' }); delete joined[m.from]; delete guestConns[m.from]; }
      else emit('guest-msg', { id: m.from, msg: m });
    } else {
      if (m.kind === 'bye-room') { emit('room-closed', {}); return; }
      if (m.from !== 'host' && m.to !== myId && m.to !== 'all') return;
      if (m.kind === 'welcome') { joined.host = true; emit('joined', { id: myId, seat: m.seat, seats: m.seats }); }
      else emit('host-msg', m);
    }
  }

  function close(silent) {
    if (!silent && !isHost && (hostSend || hostConn)) { try { busPost({ from: myId, to: 'host', room: room, kind: 'bye' }); } catch (e) { /* abaikan */ } }
    if (!silent && isHost && room) { try { busPost({ from: myId, to: 'all', room: room, kind: 'bye-room' }); } catch (e) { /* abaikan */ } }
    try {
      Object.keys(guestConns).forEach(function (gid) { try { guestConns[gid].close(); } catch (e) { /* abaikan */ } });
      if (hostConn) { try { hostConn.close(); } catch (e) { /* abaikan */ } }
      if (peer) { try { peer.destroy(); } catch (e) { /* abaikan */ } }
    } catch (e) { /* abaikan */ }
    localClose();
    peer = null; hostConn = null; guestConns = {};
    hostSend = null; hostSendHello = false; joined = {};
    isHost = false; myId = null; room = null;
  }

  window.MonoNet = {
    on: on, hostRoom: hostRoom, joinRoom: joinRoom,
    send: send, sendToGuest: sendToGuest, isGuestOnline: isGuestOnline, close: close,
    get isHost() { return isHost; },
    get myId() { return myId; },
    get room() { return room; }
  };
})();
