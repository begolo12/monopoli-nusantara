/* Uji satu permainan penuh lewat UI asli di Chrome headless.
   Jalankan: node test-ui-game.mjs
   Hasil: test-ui-game.result.json + log ringkas di stdout. */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9333;
const URL_GAME = 'http://127.0.0.1:4173/';
const MAX_MS = Number(process.env.MAX_MS || 20 * 60 * 1000);
const profile = mkdtempSync(join(tmpdir(), 'monopoli-ui-'));
const resultFile = new URL('./test-ui-game.result.json', import.meta.url);
let chrome = null;
let ws = null;
let nextId = 1;
const pending = new Map();
const logs = [];

function cleanup(code) {
  try { if (ws) ws.close(); } catch (e) { /* abaikan */ }
  if (chrome) {
    try { chrome.kill(); } catch (e) { /* abaikan */ }
    spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  try { rmSync(profile, { recursive: true, force: true }); } catch (e) { /* abaikan */ }
  process.exitCode = code;
}
process.on('SIGINT', () => cleanup(130));

function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error('CDP timeout: ' + method));
    }, 15000);
  });
}

async function evalPage(expression, awaitPromise = true) {
  const r = await send('Runtime.evaluate', {
    expression,
    awaitPromise,
    returnByValue: true,
    userGesture: true,
    allowUnsafeEvalBlockedByCSP: true
  });
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

function connect(url) {
  return new Promise((resolve, reject) => {
    const sock = new WebSocket(url);
    ws = sock;
    sock.onopen = () => resolve();
    sock.onerror = (e) => reject(new Error('WebSocket error'));
    sock.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) p.reject(new Error(m.error.message)); else p.resolve(m.result);
        return;
      }
      if (m.method === 'Log.entryAdded' && m.params && m.params.entry) {
        const e = m.params.entry;
        if (e.level === 'error') logs.push({ source: e.source, text: e.text, url: e.url || '' });
      }
      if (m.method === 'Runtime.exceptionThrown' && m.params) {
        const d = m.params.exceptionDetails;
        logs.push({ source: 'runtime', text: (d.exception && d.exception.description) || d.text, url: d.url || '' });
      }
    };
  });
}

const SETUP = `
(function () {
  const T = window.__gameTest = {
    errors: [], bankrupts: [], done: false, actions: 0,
    started: Date.now(), lastActionAt: Date.now(), lastLogLen: 0, stuck: 0
  };
  window.addEventListener('error', function (e) { T.errors.push('error: ' + (e.message || e.error)); });
  window.addEventListener('unhandledrejection', function (e) { T.errors.push('rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)); });
  const oldErr = console.error;
  console.error = function () { T.errors.push('console: ' + Array.prototype.map.call(arguments, String).join(' ').slice(0, 400)); oldErr.apply(console, arguments); };

  /* Percepat khusus pengujian: animasi 110ms -> 4ms, jeda bot 700ms -> 250ms.
     Jeda bot tetap lebih panjang dari satu langkah animasi supaya bot tidak menabrak busy. */
  const nativeST = window.setTimeout.bind(window);
  window.setTimeout = function (fn, ms) {
    ms = Number(ms) || 0;
    const capped = ms >= 400 ? Math.min(ms, 250) : Math.min(ms, 4);
    return nativeST.apply(window, [fn, capped].concat(Array.prototype.slice.call(arguments, 2)));
  };

  document.getElementById('mLocal').click();
  document.querySelector('[data-preset="solo"]').click();
  for (let i = 1; i < 4; i++) document.getElementById('stp' + i).value = 'sulit';
  document.getElementById('startForm').requestSubmit();

  const driver = setInterval(function () {
    if (!window.MonoDebug || !MonoDebug.state) return;
    const s = MonoDebug.state;
    s.players.forEach(function (p) {
      if (!p.bankrupt) return;
      const token = document.querySelector('.token[data-p="' + p.id + '"]');
      const row = document.querySelectorAll('#players .pl')[p.id];
      const now = {
        id: p.id, name: p.name, round: s.round, cash: p.cash,
        tokenDown: !!(token && token.classList.contains('down')),
        rowOut: !!(row && row.classList.contains('out')),
        badge: !!(row && /bangkrut/.test(row.textContent)),
        winSheet: !!(document.getElementById('winTitle')),
        log: s.log[0] ? s.log[0].text : ''
      };
      const prev = T.bankrupts.filter(function (x) { return x.id === p.id; })[0];
      /* Saat status bangkrut baru diset, render berikutnya belum tentu jalan.
         Simpan catatan pertama, lalu perbarui sampai baris & lencana tampil. */
      if (!prev) T.bankrupts.push(now);
      else if (!prev.rowOut || !prev.badge) Object.assign(prev, now);
    });
    if (s.phase === 'over') { T.done = true; clearInterval(driver); return; }
    if (MonoDebug.busy) return;
    const click = function (id) { const el = document.getElementById(id); if (el) { el.click(); T.actions++; T.lastActionAt = Date.now(); return true; } return false; };
    if (click('tradeNo')) return;
    if (click('cardOk')) return;
    const seat = s.trade ? s.trade.to : (s.phase === 'resolve-buy' ? s.pendingBuyer : s.turn);
    const p = s.players[seat];
    if (!p || p.bot || MonoDebug.session.mySeats.indexOf(seat) < 0) return;
    const btns = Array.prototype.slice.call(document.querySelectorAll('#controls .btn')).filter(function (b) { return !b.disabled; });
    const pick = function (re) { return btns.filter(function (b) { return re.test(b.textContent.trim()); })[0]; };
    let btn = null;
    if (s.phase === 'roll') btn = pick(/^Lempar Dadu/);
    else if (s.phase === 'jail') btn = pick(/^Bayar Denda/) || pick(/^Gunakan Kartu/) || pick(/^Coba Dadu/);
    else if (s.phase === 'resolve-buy') btn = pick(/^Beli/) || pick(/^Lewati/);
    else if (s.phase === 'end') btn = pick(/^Akhiri Giliran/);
    else if (s.phase === 'card') btn = pick(/^Buka Kartu/);
    if (btn) { btn.click(); T.actions++; T.lastActionAt = Date.now(); }
  }, 35);
  T.driver = driver;
  return { visibility: document.visibilityState, players: MonoDebug.state.players.map(function (p) { return { name: p.name, bot: p.bot }; }) };
})()
`;

const STATUS = `
(function () {
  const s = window.MonoDebug && MonoDebug.state;
  const T = window.__gameTest;
  if (!s || !T) return { ready: false };
  const title = document.getElementById('winTitle');
  const sheet = title && title.closest('.sheet');
  const overBtns = sheet ? Array.prototype.map.call(sheet.querySelectorAll('button'), function (b) { return b.textContent.trim(); }) : [];
  const stand = sheet ? Array.prototype.map.call(sheet.querySelectorAll('.standings li'), function (li) {
    return { text: li.textContent.replace(/\\s+/g, ' ').trim(), win: li.classList.contains('win'), off: li.classList.contains('off') };
  }) : [];
  return {
    ready: true, phase: s.phase, round: s.round, turn: s.turn, winner: s.winner,
    done: T.done, actions: T.actions, errors: T.errors.slice(), bankrupts: T.bankrupts.slice(),
    players: s.players.map(function (p) {
      return { id: p.id, name: p.name, bot: p.bot, cash: p.cash, bankrupt: p.bankrupt, pos: p.pos,
        props: Object.keys(s.props).filter(function (id) { return s.props[id].owner === p.id; }).length };
    }),
    log: s.log.slice(0, 6).map(function (x) { return x.text; }),
    overlay: title ? title.textContent : null, standings: stand, overBtns: overBtns,
    doc: { w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight },
    visibility: document.visibilityState,
    gen: window.__gameTest && window.__gameTest.actions
  };
})()
`;

async function main() {
  chrome = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--window-size=1280,800',
    'about:blank'
  ], { stdio: 'ignore' });

  const version = await waitReady();
  const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const page = targets.find((x) => x.type === 'page');
  if (!page) throw new Error('Tidak ada target page');
  await connect(page.webSocketDebuggerUrl);
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Log.enable');
  try { await send('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch (e) { /* opsional */ }
  try { await send('Page.bringToFront'); } catch (e) { /* opsional */ }

  await send('Page.navigate', { url: URL_GAME });
  for (let i = 0; i < 100; i++) {
    const ready = await evalPage('document.readyState', false);
    if (ready === 'complete') break;
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 500));
  const vis = await evalPage('document.visibilityState', false);
  console.error('visibility: ' + vis);
  try { await send('Page.setWebLifecycleState', { state: 'active' }); } catch (e) { /* opsional */ }

  const setup = await evalPage(SETUP);
  console.error('setup: ' + JSON.stringify(setup));

  const began = Date.now();
  let last = null;
  let lastPrint = 0;
  let firstBankrupt = null;
  while (Date.now() - began < MAX_MS) {
    await new Promise((r) => setTimeout(r, 1000));
    let st;
    try { st = await evalPage(STATUS, false); } catch (e) { console.error('status gagal: ' + e.message); continue; }
    if (!st || !st.ready) continue;
    last = st;
    if (!firstBankrupt && st.bankrupts.length) firstBankrupt = st.bankrupts[0];
    const now = Date.now();
    if (now - lastPrint > 5000) {
      lastPrint = now;
      console.log(`[${Math.round((now - began) / 1000)}s] ronde ${st.round} · ${st.phase} · giliran ${st.turn} · aksi ${st.actions} · bangkrut ${st.bankrupts.length} · error ${st.errors.length}`);
    }
    if (st.done || st.phase === 'over') break;
  }

  if (!last) throw new Error('Tidak mendapat status permainan');
  const elapsed = Math.round((Date.now() - began) / 1000);
  const ok = last.phase === 'over' && last.done && last.errors.length === 0 && last.overlay &&
    last.standings.filter((x) => x.win).length === 1 && last.players.filter((p) => p.bankrupt).length === 3;
  const out = {
    ok, elapsedSec: elapsed, visibility: last.visibility,
    firstBankrupt, final: last,
    jsLogs: logs.filter((x) => !/favicon|fontshare|ERR_|Failed to load resource/i.test(x.text + ' ' + x.url))
  };
  writeFileSync(resultFile, JSON.stringify(out, null, 2));
  console.log('\n=== HASIL ===');
  console.log('selesai: ' + last.phase + ' | ronde ' + last.round + ' | aksi ' + last.actions + ' | ' + elapsed + 's');
  console.log('pemenang: ' + (last.players.find((p) => p.id === last.winner) || {}).name);
  console.log('bangkrut: ' + last.players.filter((p) => p.bankrupt).map((p) => p.name).join(', '));
  console.log('layar akhir: ' + last.overlay);
  console.log('error JS: ' + last.errors.length + ' | log browser: ' + out.jsLogs.length);
  console.log('hasil JSON: ' + resultFile.pathname);
  cleanup(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('GAGAL: ' + (e && e.stack || e));
  cleanup(1);
});
