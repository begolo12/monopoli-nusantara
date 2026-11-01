/* Uji PWA: service worker terpasang, aset ter-cache, dan game tetap bisa
   dibuka + dimainkan saat offline. Jalankan: node test-pwa-ui.mjs */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9338;
const URL_GAME = 'http://127.0.0.1:4173/';
const profile = mkdtempSync(join(tmpdir(), 'monopoli-pwa-'));
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

async function main() {
  chrome = spawn(CHROME, [
    '--headless=new',
    '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile,
    '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars',
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
  await send('Network.enable');

  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    console.log((ok ? 'OK  ' : 'FAIL') + ' ' + name + (detail === undefined ? '' : ' -> ' + JSON.stringify(detail)));
  };

  await send('Page.navigate', { url: URL_GAME });
  for (let i = 0; i < 100; i++) {
    if ((await evalPage('document.readyState')) === 'complete') break;
    await new Promise((r) => setTimeout(r, 150));
  }

  /* manifest & ikon harus bisa diambil */
  const manifest = await evalPage(`(async function () {
    const m = await fetch('./manifest.webmanifest');
    const j = await m.json();
    const icon = await fetch('./icon-192.png');
    return { status: m.status, name: j.name, icons: (j.icons || []).length, iconStatus: icon.status, iconType: icon.headers.get('content-type') };
  })()`);
  check('manifest & ikon', manifest.status === 200 && manifest.icons >= 3 && manifest.iconStatus === 200 && /image\/png/.test(manifest.iconType || ''), manifest);

  /* service worker terpasang dan mengambil alih halaman */
  const sw = await evalPage(`(async function () {
    if (!('serviceWorker' in navigator)) return { supported: false };
    const reg = await navigator.serviceWorker.ready;
    await navigator.serviceWorker.ready;
    return { supported: true, active: !!(reg && reg.active), scope: reg ? reg.scope : null };
  })()`);
  check('service worker aktif', sw.supported && sw.active, sw);

  /* cache berisi seluruh aset aplikasi */
  const cached = await evalPage(`(async function () {
    const keys = await caches.keys();
    const c = await caches.open(keys[0]);
    const reqs = await c.keys();
    return reqs.map(function (r) { return new URL(r.url).pathname; });
  })()`);
  const need = ['/index.html', '/styles.css', '/ui.js', '/game.js', '/data.js', '/bot.js', '/net.js', '/tokens.css', '/icon-192.png'];
  const missing = need.filter((p) => !cached.some((c) => c === p || c === p.replace('/index.html', '/')));
  check('cache berisi aset', missing.length === 0, { cached: cached.length, missing });

  /* OFFLINE: muat ulang lalu mainkan */
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await send('Page.navigate', { url: URL_GAME });
  let loaded = false;
  for (let i = 0; i < 60; i++) {
    try {
      if ((await evalPage('document.readyState')) === 'complete') { loaded = true; break; }
    } catch (e) { /* halaman belum ada */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  const offlineApp = loaded ? await evalPage(`(function () {
    return { tiles: document.querySelectorAll('#board .tile').length, hasData: !!window.MonoData, hasUi: !!window.MonoDebug };
  })()`) : null;
  check('halaman terbuka saat offline', loaded && offlineApp && offlineApp.tiles === 40 && offlineApp.hasData && offlineApp.hasUi, offlineApp);

  const offlinePlay = loaded ? await evalPage(`(function () {
    document.getElementById('mLocal').click();
    document.querySelector('[data-preset="solo"]').click();
    document.getElementById('startForm').requestSubmit();
    const s = MonoDebug.state;
    const btn = Array.prototype.slice.call(document.querySelectorAll('#controls .btn')).filter(function (b) { return /^Lempar Dadu/.test(b.textContent.trim()) && !b.disabled; })[0];
    if (!btn) return { started: !!s, canRoll: false };
    btn.click();
    return { started: !!s, canRoll: true, players: s ? s.players.length : 0 };
  })()`) : null;
  await new Promise((r) => setTimeout(r, 1500));
  const afterRoll = loaded ? await evalPage(`(function () {
    const s = MonoDebug.state;
    return { phase: s.phase, round: s.round, log: s.log.length };
  })()`) : null;
  check('main offline (lempar dadu jalan)', offlinePlay && offlinePlay.started && offlinePlay.canRoll && afterRoll && afterRoll.log > 0, { play: offlinePlay, after: afterRoll });

  const ok = results.every((r) => r.ok);
  console.log('\n=== HASIL PWA ===');
  console.log('lolos: ' + results.filter((r) => r.ok).length + '/' + results.length);
  cleanup(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('GAGAL: ' + (e && e.stack || e));
  cleanup(1);
});
