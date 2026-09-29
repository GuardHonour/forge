/* Filmstrip: one row per exercise, one column per point in the rep. Shows the motion
   arc across a whole repetition in a single still image — the fallback for when an
   animated format cannot survive the delivery channel.
   node _shot_filmstrip.cjs <frames> <cell> <id,id,...> <out.png> */
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9355;
const FRAMES = parseInt(process.argv[2] || '9', 10);
const CELL = parseInt(process.argv[3] || '190', 10);
const ids = (process.argv[4] || '').split(',').filter(Boolean);
const out = process.argv[5] || '_filmstrip.png';
const TMP = '_gifwork';

const probe = `
<script>
window.addEventListener('load', function(){
  setTimeout(function(){
    var html='<div style="display:grid;grid-template-columns:repeat(2,'+(3+${FRAMES}*(${CELL}+5))+775+'px);gap:10px">';
    /* one block per exercise: name row + a row of frames */
    html='<div style="display:flex;flex-direction:column;gap:12px">';
    ${JSON.stringify(ids)}.forEach(function(id){
      var e=EXBY[id], d=DEMOS[id]; if(!d) return;
      html+='<div style="background:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px">'
        + '<div style="display:flex;gap:10px;align-items:baseline;margin-bottom:5px">'
          + '<span style="font:700 13px Archivo,system-ui;color:var(--ink);min-width:190px">'+e.n+'</span>'
          + '<span style="font:600 9px Archivo,system-ui;color:var(--dim);letter-spacing:.07em">'
          + d.ph[0]+' \\u2192 '+d.ph[1]+'  \\u00b7  '+e.cat+'  \\u00b7  '+d.scene+' / '+d.view+'</span>'
        + '</div>'
        + '<div style="display:flex;gap:5px">';
      for(var f=0;f<${FRAMES};f++){
        html+='<div><svg viewBox="0 0 200 200" width="${CELL}" height="${CELL}" style="display:block;background:color-mix(in srgb,var(--card3) 55%,transparent);border-radius:7px"><g id="g_'+id+'_'+f+'"></g></svg>'
          + '<div style="font:700 8px Archivo,system-ui;color:var(--mut);text-align:center;margin-top:2px">'+Math.round(f/${FRAMES}*3140)+'ms</div></div>';
      }
      html+='</div></div>';
    });
    html+='</div>';
    document.body.style.cssText='margin:0;background:var(--bg);font-family:Archivo,system-ui';
    document.body.innerHTML='<div style="display:inline-block;padding:10px">'+html+'</div>';

    var errs=[];
    ${JSON.stringify(ids)}.forEach(function(id){
      var d=DEMOS[id];
      for(var f=0;f<${FRAMES};f++){
        var g=document.getElementById('g_'+id+'_'+f);
        if(!g||!d) continue;
        try{ var P=ANIMS[id].gen(f/${FRAMES}); g.innerHTML=drawFigure(d,P,loadFor(d,P)); }
        catch(err){ errs.push(id+'@'+f); }
      }
    });
    var r=document.getElementById('wrap')?null:document.body.firstChild.getBoundingClientRect();
    window.__size={w:Math.ceil(r.width),h:Math.ceil(r.height),errs:errs.length};
  }, 400);
});
<\/script>`;

fs.mkdirSync(TMP, { recursive: true });
fs.writeFileSync(TMP + '/strip.html', fs.readFileSync('index.html', 'utf8').replace('</body>', probe + '</body>'));

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.cwd() + '\\' + TMP + '\\p2', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let ws = null, id = 0; const pending = new Map();
  const send = (m, p) => new Promise((res, rej) => { const n = ++id; pending.set(n, { res, rej }); ws.send(JSON.stringify({ id: n, method: m, params: p || {} })); });
  for (let i = 0; i < 80; i++) {
    try { const l = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json(); const pg = l.find(t => t.type === 'page'); if (pg) { ws = new WebSocket(pg.webSocketDebuggerUrl); break; } } catch (e) {}
    await sleep(250);
  }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
  await send('Page.enable'); await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'file:///' + process.cwd().replace(/\\/g, '/') + '/' + TMP + '/strip.html' });
  await sleep(2000);
  const size = (await send('Runtime.evaluate', { expression: 'window.__size', returnByValue: true })).result.value;
  if (!size) { console.log('FAIL: probe did not run'); chrome.kill(); process.exit(1); }
  await send('Emulation.setDeviceMetricsOverride', { width: size.w, height: size.h, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log('wrote ' + out + '  ' + size.w + 'x' + size.h + '  (' + ids.length + ' exercises x ' + FRAMES + ' frames, ' + size.errs + ' errors)');
  chrome.kill(); await sleep(1000);
  for (let i = 0; i < 5; i++) { try { fs.rmSync(TMP + '/p2', { recursive: true, force: true }); break; } catch (e) { await sleep(500); } }
  process.exit(0);
})();
