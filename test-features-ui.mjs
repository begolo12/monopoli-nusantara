/* Uji alur fitur lewat UI asli: beli, bangun, jual, hipotek, tebus, dagang,
   penjara (3 jalan keluar), kartu. Semua aksi diklik lewat tombol yang benar-benar
   tampil di layar, lalu efeknya dicek di state.
   Jalankan: node test-features-ui.mjs (server statis di 127.0.0.1:4173) */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9336;
const URL_GAME = 'http://127.0.0.1:4173/';
const profile = mkdtempSync(join(tmpdir(), 'monopoli-feat-'));
let chrome = null;
let ws = null;
let nextId = 1;
const pending = new Map();

function cleanup(code) {
  try { if (ws) ws.close(); } catch (e) { /* abaikan */ }
  if (chrome) {
    try { chrome.kill(); } catch (e) { /* abaikan */ }
    spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
  process.exitCode = code;
}

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error('CDP timeout: ' + method));
    }, 20000);
  });
}

async function evalPage(expression, awaitPromise = true) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text || 'eval gagal');
  }
  return r.result ? r.result.value : undefined;
}

async function waitReady() {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    try {
      const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (v && v.webSocketDebuggerUrl) return v;
    } catch (e) { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('Chrome debugging tidak siap');
}

/* ---------- papan aksi di dalam halaman ---------- */

const PAGE_BOOT = `
(function () {
  const T = window.__featTest = { errors: [], steps: [] };
  window.addEventListener('error', function (e) { T.errors.push('error: ' + (e.message || e.error)); });
  window.addEventListener('unhandledrejection', function (e) { T.errors.push('rejection: ' + (e.reason && (e.reason.message || e.reason.stack) || e.reason)); });
  const oldErr = console.error;
  console.error = function () { T.errors.push('console: ' + Array.prototype.map.call(arguments, String).join(' ').slice(0, 300)); oldErr.apply(console, arguments); };
  /* Percepat khusus pengujian: jeda bot 700ms -> 250ms supaya jawaban dagang cepat. */
  const nativeST = window.setTimeout.bind(window);
  window.setTimeout = function (fn, ms) {
    ms = Number(ms) || 0;
    const capped = ms >= 400 ? Math.min(ms, 250) : Math.min(ms, 4);
    return nativeST.apply(window, [fn, capped].concat(Array.prototype.slice.call(arguments, 2)));
  };
  document.getElementById('mLocal').click();
  document.querySelector('[data-preset="solo"]').click();
  document.getElementById('startForm').requestSubmit();
  return true;
})()
`;

/* Rig state lalu paksa render dengan mengklik petak netral (id 0 = Mulai). */
const HELPERS = `
window.__ft = {
  s: function () { return MonoDebug.state; },
  /* Paksa render tanpa mengubah pilihan petak: klik petak netral dua kali. */
  render: function () { var el = document.querySelector('#board [data-id="0"]'); el.click(); el.click(); },
  /* Pilih petak (buka panel propertinya) apa pun kondisi pilihan sebelumnya. */
  select: function (id) {
    var el = document.querySelector('#board [data-id="' + id + '"]');
    if (el.classList.contains('sel')) el.click();
    el.click();
  },
  /* Pengecekan instan saja: jangan sibuk menunggu di dalam halaman karena
     putaran sibuk justru memblokir timer bot (jawaban dagang) dan animasi. */
  free: function () { return !MonoDebug.busy; },
  tradeGone: function () { return !(MonoDebug.state && MonoDebug.state.trade); },
  /* Klik tombol di #controls sesuai teks awalnya. */
  ctl: function (re) {
    var btns = Array.prototype.slice.call(document.querySelectorAll('#controls .btn')).filter(function (b) { return !b.disabled; });
    var b = btns.filter(function (x) { return re.test(x.textContent.trim()); })[0];
    if (!b) return false;
    b.click();
    return true;
  },
  /* Klik tombol uang di panel properti (Bangun/Jual/Tebus/Hipotek). */
  pp: function (re) {
    var btns = Array.prototype.slice.call(document.querySelectorAll('#propPanel .pp-acts .btn')).filter(function (b) { return !b.disabled; });
    var b = btns.filter(function (x) { return re.test(x.textContent.trim()); })[0];
    if (!b) return false;
    b.click();
    return true;
  }
};
true
`;

async function step(name, fn) {
  const code = `(function () { try { const r = ${fn}; return { name: ${JSON.stringify(name)}, ok: r === true, detail: r }; } catch (e) { return { name: ${JSON.stringify(name)}, ok: false, detail: String(e && e.message || e) }; } })()`;
  const r = await evalPage(code, false);
  const errorsNow = await evalPage('window.__featTest.errors', false);
  const ok = r && r.ok && errorsNow.length === 0;
  console.log((ok ? 'OK  ' : 'FAIL') + ' ' + r.name + ' -> ' + JSON.stringify(r.detail));
  return { name: r.name, ok, detail: r.detail, errors: errorsNow.slice() };
}

async function main() {
  chrome = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--window-size=1280,800',
    'about:blank'
  ], { stdio: 'ignore' });

  await waitReady();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((x) => x.type === 'page');
  if (!page) throw new Error('Tidak ada target page');
  await new Promise((resolve, reject) => {
    ws = new WebSocket(page.webSocketDebuggerUrl);
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('WebSocket error'));
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
      }
    };
  });
  await send('Runtime.enable');
  await send('Page.enable');
  await send('Page.navigate', { url: URL_GAME });
  for (let i = 0; i < 100; i++) {
    if ((await evalPage('document.readyState', false)) === 'complete') break;
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 400));
  await evalPage(PAGE_BOOT);
  await new Promise((r) => setTimeout(r, 600));
  await evalPage(HELPERS);

  const results = [];

  /* 1. Beli properti lewat tombol Beli di #controls. */
  results.push(await step('beli', `
    (function () {
      const s = __ft.s();
      s.turn = 0; s.phase = 'resolve-buy'; s.pendingBuy = 1; s.pendingBuyer = 0;
      s.pendingMove = false; s.trade = null; s.canExtra = false;
      __ft.render();
      const before = s.players[0].cash, price = MonoData.BOARD[1].price;
      if (!__ft.ctl(/^Beli/)) return 'tombol Beli tidak tampil';
      return s.props[1].owner === 0 && s.players[0].cash === before - price && s.phase === 'end';
    })()
  `));

  /* 2. Bangun rumah lewat panel properti. */
  results.push(await step('bangun-rumah', `
    (function () {
      const s = __ft.s();
      s.props[3].owner = 0; s.phase = 'end'; s.turn = 0;
      __ft.select(1);
      const before = s.players[0].cash, cost = MonoData.BOARD[1].house;
      if (!__ft.pp(/^Bangun rumah/)) return 'tombol Bangun tidak tampil';
      return s.props[1].houses === 1 && s.players[0].cash === before - cost;
    })()
  `));

  /* 3. Jual rumah. */
  results.push(await step('jual-rumah', `
    (function () {
      const s = __ft.s();
      __ft.select(1);
      const before = s.players[0].cash, back = MonoData.BOARD[1].house / 2;
      if (!__ft.pp(/^Jual rumah/)) return 'tombol Jual tidak tampil';
      return s.props[1].houses === 0 && s.players[0].cash === before + back;
    })()
  `));

  /* 4. Hipotekkan. */
  results.push(await step('hipotek', `
    (function () {
      const s = __ft.s();
      __ft.select(1);
      const before = s.players[0].cash, val = Math.floor(MonoData.BOARD[1].price / 2);
      if (!__ft.pp(/^Hipotekkan/)) return 'tombol Hipotekkan tidak tampil';
      return s.props[1].mortgaged === true && s.players[0].cash === before + val;
    })()
  `));

  /* 5. Tebus. */
  results.push(await step('tebus', `
    (function () {
      const s = __ft.s();
      __ft.select(1);
      const before = s.players[0].cash;
      if (!__ft.pp(/^Tebus/)) return 'tombol Tebus tidak tampil';
      return s.props[1].mortgaged === false && s.players[0].cash < before;
    })()
  `));

  /* 6. Ajukan tawaran dagang ke bot: kirim lewat lembar tawaran, tunggu jawaban. */
  results.push(await step('dagang', `
    (function () {
      const s = __ft.s();
      s.phase = 'end'; s.turn = 0;
      __ft.select(1);
      const btn = Array.prototype.slice.call(document.querySelectorAll('#propPanel .pp-acts .btn')).filter(function (b) { return /Tawar dagang/.test(b.textContent); })[0];
      if (!btn) return 'tombol Tawar dagang tidak tampil';
      btn.click();
      const to = document.getElementById('ofTo');
      if (!to) return 'lembar tawaran tidak terbuka';
      to.value = '1';
      to.dispatchEvent(new Event('change'));
      const give = document.querySelector('[data-give="1"]');
      if (!give) return 'daftar properti yang diberi kosong';
      give.checked = true;
      document.getElementById('ofCash').value = '500000';
      document.getElementById('offerForm').requestSubmit();
      return !!(MonoDebug.state && MonoDebug.state.trade);
    })()
  `));

  /* Bot menjawab lewat timer (250ms dipercepat): tunggu dari sisi Node agar
     event loop halaman tetap jalan, lalu nilai jawabannya. */
  {
    let answered = false;
    for (let i = 0; i < 40 && !answered; i++) {
      await new Promise((r) => setTimeout(r, 250));
      answered = await evalPage('__ft.tradeGone()', false);
    }
    results.push(await step('dagang-jawab', `
      (function () {
        const s = __ft.s();
        if (s.trade) return 'tawaran tidak pernah dijawab bot';
        return s.log.some(function (e) { return /dagang|Tawaran/.test(e.text); });
      })()
    `));
  }

  /* 7a. Keluar penjara dengan kartu. */
  results.push(await step('penjara-kartu', `
    (function () {
      const s = __ft.s();
      const p = s.players[0];
      p.jail = true; p.jailTurns = 0; p.jailCards = 1;
      s.phase = 'jail'; s.turn = 0; s.canExtra = false; s.pendingMove = false; s.trade = null;
      __ft.render();
      if (!__ft.ctl(/^Gunakan Kartu/)) return 'tombol Gunakan Kartu tidak tampil';
      return s.players[0].jail === false && s.players[0].jailCards === 0;
    })()
  `));

  /* 7b. Keluar penjara dengan bayar denda. */
  results.push(await step('penjara-denda', `
    (function () {
      const s = __ft.s();
      const p = s.players[0];
      p.jail = true; p.jailTurns = 0; p.jailCards = 0;
      s.phase = 'jail'; s.turn = 0; s.canExtra = false;
      __ft.render();
      const before = s.players[0].cash, fine = MonoData.RULES.jailFine;
      if (!__ft.ctl(/^Bayar Denda/)) return 'tombol Bayar Denda tidak tampil';
      return s.players[0].jail === false && s.players[0].cash === before - fine;
    })()
  `));

  /* 7c. Coba dadu kembar (hasil acak, cukup pastikan tidak melempar error). */
  results.push(await step('penjara-dadu', `
    (function () {
      const s = __ft.s();
      const p = s.players[0];
      p.jail = true; p.jailTurns = 0; p.jailCards = 0;
      s.phase = 'jail'; s.turn = 0; s.canExtra = false;
      __ft.render();
      if (!__ft.ctl(/^Coba Dadu/)) return 'tombol Coba Dadu tidak tampil';
      return typeof s.players[0].jail === 'boolean' && s.phase !== 'jail';
    })()
  `));

  /* 8. Kartu Dana Umum: buka lembar kartu lalu Lanjutkan. */
  results.push(await step('kartu', `
    (function () {
      const s = __ft.s();
      s.turn = 0; s.phase = 'card'; s.pendingMove = false; s.trade = null;
      s.pendingCard = { deck: 'chest', card: { text: 'Uji dana umum.', fx: { t: 'gain', n: 50000 } } };
      __ft.render();
      if (!__ft.ctl(/^Buka Kartu/)) return 'tombol Buka Kartu tidak tampil';
      const ok = document.getElementById('cardOk');
      if (!ok) return 'lembar kartu tidak terbuka';
      const before = s.players[0].cash;
      ok.click();
      return s.players[0].cash === before + 50000 && s.pendingCard === null;
    })()
  `));

  const errors = await evalPage('window.__featTest.errors', false);
  const ok = results.every((r) => r.ok) && (!errors || errors.length === 0);
  console.log('\\n=== HASIL FITUR ===');
  console.log('langkah lolos: ' + results.filter((r) => r.ok).length + '/' + results.length);
  console.log('error JS: ' + (errors ? errors.length : 0));
  if (errors && errors.length) console.log(JSON.stringify(errors, null, 1));
  cleanup(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('GAGAL: ' + (e && e.stack || e));
  cleanup(1);
});
