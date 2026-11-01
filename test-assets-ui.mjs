/* Cek cepat panel "Aset" (daftar properti + pintasan aksi) di desktop dan ukuran HP.
   Jalankan: node test-assets-ui.mjs (server statis di 127.0.0.1:4173) */
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9335;
const URL_GAME = 'http://127.0.0.1:4173/';
const profile = mkdtempSync(join(tmpdir(), 'monopoli-assets-'));
let chrome = null;
let ws = null;
let nextId = 1;
const pending = new Map();
const errors = [];

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
    }, 15000);
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
    if ((await evalPage('document.readyState')) === 'complete') break;
    await new Promise((r) => setTimeout(r, 150));
  }
  await new Promise((r) => setTimeout(r, 400));
  await evalPage(`(function () {
    window.addEventListener('error', function (e) { errors.push(String(e.message)); });
    document.getElementById('mLocal').click();
    document.querySelector('[data-preset="solo"]').click();
    document.getElementById('startForm').requestSubmit();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 600));

  // Beri pemain manusia dua properti (satu dengan rumah, satu dihipotek) lalu render.
  await evalPage(`(function () {
    const s = MonoDebug.state;
    s.props[1].owner = 0; s.props[1].houses = 2;
    s.props[3].owner = 0; s.props[3].mortgaged = true;
    s.props[5].owner = 1;
    document.querySelector('#board [data-id="1"]').click();
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 300));

  const readState = `(function () {
    const box = document.getElementById('assets');
    const chips = box ? box.querySelectorAll('.as-chip') : [];
    const first = chips[0];
    return {
      visible: !!(box && !box.hidden),
      title: box ? box.querySelector('h2').textContent : '',
      chips: chips.length,
      chipTexts: Array.prototype.map.call(chips, function (c) { return c.textContent.replace(/\\s+/g, ' ').trim(); }),
      chipH: first ? Math.round(first.getBoundingClientRect().height) : 0,
      panelHidden: document.getElementById('propPanel').hidden,
      scrollW: document.documentElement.scrollWidth,
      innerW: window.innerWidth
    };
  })()`;

  const desktop = await evalPage(readState);

  // Klik chip kedua: panel aksi petak itu harus terbuka, petak di papan tersorot.
  const afterClick = await evalPage(`(function () {
    document.querySelectorAll('#assets .as-chip')[1].click();
    const panel = document.getElementById('propPanel');
    return {
      panelVisible: !panel.hidden,
      panelTitle: panel.querySelector('h3') ? panel.querySelector('h3').textContent : '',
      panelActions: Array.prototype.map.call(panel.querySelectorAll('.pp-acts .btn'), function (b) { return b.textContent.replace(/\\s+/g, ' ').trim(); }),
      tileSel: !!document.querySelector('#board .tile.sel'),
      chipSel: !!document.querySelector('#assets .as-chip.sel')
    };
  })()`);
  await new Promise((r) => setTimeout(r, 200));

  // Ukuran HP 390x844.
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await new Promise((r) => setTimeout(r, 400));
  const phone = await evalPage(readState);

  const ok = desktop.visible && desktop.chips === 2 && afterClick.panelVisible &&
    /Malioboro/.test(afterClick.panelTitle) && afterClick.panelActions.length > 0 &&
    afterClick.tileSel && afterClick.chipSel && phone.chips === 2 &&
    phone.chipH >= 40 && phone.scrollW <= phone.innerW && errors.length === 0;
  console.log(JSON.stringify({ ok, errors, desktop, afterClick, phone }, null, 2));
  cleanup(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('GAGAL: ' + (e && e.stack || e));
  cleanup(1);
});
