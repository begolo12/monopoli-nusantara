/* Ukur kelancaran permainan 4 pemain (1 manusia + 3 bot) di UI asli.
   Metrik: long task main-thread, jarak antar-frame, latensi aksi (klik -> render),
   jumlah render, dan pertumbuhan memori. Jalankan dengan:
   PERF_VIEWPORT=desktop|phone node test-perf-ui.mjs */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const URL_GAME = 'http://127.0.0.1:4173/';
const VIEWPORT = process.env.PERF_VIEWPORT === 'phone' ? { width: 390, height: 844, mobile: true, dsf: 2 } : { width: 1280, height: 800, mobile: false, dsf: 1 };
const RUN_MS = Number(process.env.PERF_MS || 45000);
const profile = mkdtempSync(join(tmpdir(), 'monopoli-perf-'));
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

async function evalPage(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
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

const BOOT = `
(function () {
  const T = window.__perfTest = {
    errors: [], longTasks: [], frameGaps: [], renderTimes: [], renders: 0,
    actions: 0, clickAt: 0, heapStart: 0, started: Date.now()
  };
  window.addEventListener('error', function (e) { T.errors.push('error: ' + (e.message || e.error)); });
  window.addEventListener('unhandledrejection', function (e) { T.errors.push('rejection: ' + (e.reason && (e.reason.message || e.reason.stack) || e.reason)); });

  /* tugas panjang di main thread: sinyal jank yang paling jujur */
  try {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (e) { T.longTasks.push(Math.round(e.duration)); });
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* browser tanpa dukungan longtask */ }

  /* jarak antar-frame: hanya bermakna bila kompositor headless menghasilkan frame */
  var lastFrame = 0;
  (function loop(ts) {
    if (lastFrame) T.frameGaps.push(Math.round(ts - lastFrame));
    lastFrame = ts;
    requestAnimationFrame(loop);
  })(0);

  /* setiap render() membangun ulang daftar pemain: hitung dan ukur latensi aksi */
  var mo = new MutationObserver(function () { T.renders++; if (T.clickAt) { T.renderTimes.push(Math.round(performance.now() - T.clickAt)); T.clickAt = 0; } });
  mo.observe(document.getElementById('players'), { childList: true });

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
  return true;
})()
`;

const DRIVER = `
(function () {
  const T = window.__perfTest;
  const driver = setInterval(function () {
    if (!window.MonoDebug || !MonoDebug.state) return;
    const s = MonoDebug.state;
    if (s.phase === 'over') { clearInterval(driver); return; }
    if (MonoDebug.busy) return;
    const click = function (id) { const el = document.getElementById(id); if (el) { el.click(); T.actions++; return true; } return false; };
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
    if (btn) { T.clickAt = performance.now(); btn.click(); T.actions++; }
  }, 35);
  return true;
})()
`;

const READOUT = `
(function () {
  const T = window.__perfTest, s = MonoDebug.state;
  const q = function (a) { return a.slice().sort(function (x, y) { return x - y; }); };
  const gaps = q(T.frameGaps.filter(function (g) { return g > 0 && g < 2000; }));
  const rend = q(T.renderTimes);
  const p = function (a, f) { return a.length ? a[Math.min(a.length - 1, Math.floor(a.length * f))] : 0; };
  const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  return {
    phase: s.phase, round: s.round, actions: T.actions, renders: T.renders,
    longTaskCount: T.longTasks.length,
    longTaskMax: T.longTasks.length ? Math.max.apply(null, T.longTasks) : 0,
    longTaskOver100: T.longTasks.filter(function (d) { return d > 100; }).length,
    frameCount: gaps.length,
    frameGapMax: gaps.length ? gaps[gaps.length - 1] : 0,
    frameGapP95: p(gaps, 0.95),
    frameGapMedian: p(gaps, 0.5),
    actionLatencyAvgMs: rend.length ? Math.round(rend.reduce(function (a, b) { return a + b; }, 0) / rend.length) : 0,
    actionLatencyP95Ms: p(rend, 0.95),
    heapMB: heap, heapStartMB: T.heapStart,
    errors: T.errors.slice(0, 5), elapsed: Math.round((Date.now() - T.started) / 1000)
  };
})()
`;

function pct(arr, f) { if (!arr.length) return 0; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * f))]; }

async function main() {
  chrome = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--enable-precise-memory-info',
    '--window-size=' + VIEWPORT.width + ',' + VIEWPORT.height,
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
  if (VIEWPORT.mobile) await send('Emulation.setDeviceMetricsOverride', { width: VIEWPORT.width, height: VIEWPORT.height, deviceScaleFactor: VIEWPORT.dsf, mobile: true });
  await send('Page.navigate', { url: URL_GAME });
  for (let i = 0; i < 100; i++) {
    if ((await evalPage('document.readyState')) === 'complete') break;
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 400));

  await evalPage(BOOT);
  await evalPage('window.__perfTest.heapStart = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : 0; true');
  await new Promise((r) => setTimeout(r, 500));
  await evalPage(DRIVER);

  const began = Date.now();
  let last = null;
  while (Date.now() - began < RUN_MS) {
    await new Promise((r) => setTimeout(r, 3000));
    last = await evalPage(READOUT);
    console.log(`[${Math.round((Date.now() - began) / 1000)}s] ronde ${last.round} · aksi ${last.actions} · render ${last.renders} · longtask ${last.longTaskCount} (max ${last.longTaskMax}ms) · latensi aksi ${last.actionLatencyAvgMs}ms`);
    if (last.phase === 'over') break;
  }

  console.log('\n=== HASIL KINERJA (' + (VIEWPORT.mobile ? 'HP 390x844' : 'desktop 1280x800') + ', 4 pemain) ===');
  console.log(JSON.stringify(last, null, 2));
  const ok = last && last.errors.length === 0 && last.longTaskOver100 === 0 && last.actionLatencyAvgMs < 900 &&
    (last.heapMB == null || last.heapMB < Math.max(80, last.heapStartMB * 3));
  console.log('\nverdict: ' + (ok ? 'LANCAR' : 'PERLU DIPERIKSA'));
  cleanup(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('GAGAL: ' + (e && e.stack || e));
  cleanup(1);
});
