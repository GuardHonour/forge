/* Verify the deploy page's download buttons produce files named EXACTLY index.html / sw.js
   and containing the gated bytes.

   Why this exists: the first deploy attempt landed in the repo as index.html.txt / sw.js.txt
   and replaced nothing, because the page relied on the anchor `download` attribute while the
   files are STORED as .txt (the real index.html path is the landing page). I asserted the
   attribute would name them correctly without ever testing it. So this drives the actual
   click in a real browser with a real download directory and reads the filename off disk.

   Nothing here trusts the page's own markup: it asserts the file that APPEARS, and hashes it. */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const PAGE = process.env.PAGE || 'http://127.0.0.1:3080/forge/deploy/index.html';
const TEMP = '_cdp_dlname';
const DL = path.join(process.cwd(), TEMP, 'downloads');

const sha = b => crypto.createHash('sha256').update(b).digest('hex');
fs.rmSync(TEMP, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + path.join(process.cwd(), TEMP, 'profile'),
  'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, label) => { if (c) { pass++; console.log('  PASS ' + label); } else { fail++; console.log('  FAIL ' + label); } };

(async () => {
  let ws = null, id = 0; const pending = new Map(); const events = [];
  const send = (method, params) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const page = (await r.json()).find(t => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch (e) {}
    await sleep(250);
  }
  if (!ws) { console.log('FAIL: could not attach to Chrome'); chrome.kill(); process.exit(1); }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method) events.push(m);
  });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL, eventsEnabled: true });

  const goto = async url => { await send('Page.navigate', { url }); await sleep(2500); };

  /* what the page shipped with the gated bytes */
  const gated = {
    'index.html': sha(fs.readFileSync('_deploy/index.html')),
    'sw.js': sha(fs.readFileSync('_deploy/sw.js'))
  };

  await goto(PAGE);
  const n = (await send('Runtime.evaluate', { expression: 'document.querySelectorAll("a.btn").length', returnByValue: true })).result.value;
  ok(n === 2, 'the deploy page offers two download buttons (got ' + n + ')');

  const clearDl = () => { for (const f of fs.readdirSync(DL)) fs.rmSync(path.join(DL, f), { force: true }); };
  const waitForFile = async () => {
    for (let i = 0; i < 80; i++) {
      const f = fs.readdirSync(DL);
      if (f.length && !f.some(x => x.endsWith('.crdownload'))) return f[0];
      await sleep(250);
    }
    return null;
  };

  for (let i = 0; i < 2; i++) {
    clearDl();
    const before = events.length;
    await send('Runtime.evaluate', { expression: 'document.querySelectorAll("a.btn")[' + i + '].click()' });
    const got = await waitForFile();
    const want = i === 0 ? 'index.html' : 'sw.js';

    /* the browser's own view of the suggested name, where the browser reports it */
    const ev = events.slice(before).find(e => e.method === 'Browser.downloadWillBegin');
    if (ev) ok(ev.params.suggestedFilename === want,
      'browser proposed the filename "' + want + '" (got "' + ev.params.suggestedFilename + '")');

    ok(got === want, 'clicking button ' + (i + 1) + ' saved a file named EXACTLY "' + want + '" (got ' + JSON.stringify(got) + ')');
    if (!got) continue;
    const bytes = fs.readFileSync(path.join(DL, got));
    ok(sha(bytes) === gated[want], 'that file is byte-identical to the gated ' + want + ' (' + sha(bytes).slice(0, 16) + ')');
    ok(!got.endsWith('.txt'), 'it did NOT land as "' + want + '.txt" — the exact failure of the first attempt');
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  chrome.kill();
  await sleep(400);
  fs.rmSync(TEMP, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();