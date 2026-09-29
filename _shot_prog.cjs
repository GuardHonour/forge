/* FORGE · Progress tab legibility probe.
   The two things a reader complained about were both VISUAL: an average label a
   green bar painted over, and a grid of coloured squares that was not a calendar.
   Neither can be proved by reading a string, so this drives the real app in
   headless Chrome at true phone widths, measures the geometry, taps a day, and
   writes the two cards out as images.

   Run: node _shot_prog.cjs   → _prog_volume.png, _prog_consistency.png */
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9337;
const TEMP = '_prog_shot';

/* confirm() guards the demo loader; the probe accepts it the way a user would */
const probe = `<script>
window.__err=[];
window.addEventListener('error',function(e){window.__err.push((e.message||'')+' @'+e.lineno)});
window.confirm=function(){return true};
<\/script>`;
fs.mkdirSync(TEMP, { recursive: true });
const PROBE_URL = 'file:///' + process.cwd().replace(/\\/g, '/') + '/' + TEMP + '/probe.html';
fs.writeFileSync(TEMP + '/probe.html', fs.readFileSync('index.html', 'utf8').replace('<head>', '<head>' + probe));

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.cwd() + '\\' + TEMP + '\\prof',
  'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

const MEASURE = `(function(){
  function ov(a,b){var w=Math.min(a.right,b.right)-Math.max(a.left,b.left);var h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);return(w>0&&h>0)?Math.round(w*h):0}
  var out={w:window.innerWidth,docScroll:document.documentElement.scrollWidth,errors:(window.__err||[]).slice(0,3)};

  /* ---- weekly volume chart ---- */
  var svg=document.querySelector('.chart');
  var svgBox=svg.getBoundingClientRect();
  var kEl=svg.querySelector('.avgk'),vEl=svg.querySelector('.avgv');
  var bars=[].slice.call(svg.querySelectorAll('rect.bar,rect.bar-cur')).map(function(r){return r.getBoundingClientRect()});
  var cur=svg.querySelector('rect.bar-cur').getBoundingClientRect();
  var kB=kEl.getBoundingClientRect(),vB=vEl.getBoundingClientRect();
  var gutterB={left:Math.min(kB.left,vB.left),right:Math.max(kB.right,vB.right),top:kB.top,bottom:vB.bottom};
  var vals=[].slice.call(svg.querySelectorAll('text.barv,text.barv-cur'));
  out.chart={avgLabel:kEl.textContent+' '+vEl.textContent,bars:bars.length,
    gutterW:Math.round(gutterB.right-gutterB.left),
    gutterRight:Math.round(gutterB.right-svgBox.left),
    firstBarLeft:Math.round(bars[0].left-svgBox.left),
    /* the contract: the annotation's right edge is left of every bar's left edge,
       so no bar can ever share a pixel with it — regardless of paint order */
    clearOfBars:bars.every(function(b){return ov(gutterB,b)===0}),
    /* and the old failure in one number: how much of the words a bar covers */
    coveredByBars:bars.reduce(function(a,b){return a+ov(gutterB,b)},0),
    overCurrentBar:ov(gutterB,cur),
    insideChart:gutterB.left>=svgBox.left-1&&gutterB.right<=svgBox.right+1&&gutterB.top>=svgBox.top-1&&gutterB.bottom<=svgBox.bottom+1,
    hiddenValues:vals.filter(function(v){return ov(gutterB,v.getBoundingClientRect())>0}).length,
    valueCount:vals.length,
    labelLines:2,kFontPx:getComputedStyle(kEl).fontSize,vFontPx:getComputedStyle(vEl).fontSize};

  /* ---- consistency calendar ---- */
  var grid=document.querySelector('.heat');
  var cells=[].slice.call(document.querySelectorAll('.hcell'));
  var dows=[].slice.call(document.querySelectorAll('.hdow'));
  var wks=[].slice.call(document.querySelectorAll('.hwl'));
  var live=cells.filter(function(c){return !c.classList.contains('hfut')});
  out.heat={cols:getComputedStyle(grid).gridTemplateColumns.split(' ').length,
    cells:cells.length,dows:dows.length,weekLabels:wks.length,
    rowLetters:dows.map(function(d){return d.textContent}).join(''),
    gridOverflow:grid.scrollWidth-grid.clientWidth,
    firstLabel:wks[0]?wks[0].textContent:'',lastLabel:wks[wks.length-1]?wks[wks.length-1].textContent:'',
    ringed:[].slice.call(document.querySelectorAll('.hcell.htoday')).map(function(c){return c.dataset.d}),
    future:cells.filter(function(c){return c.classList.contains('hfut')}).length,
    head:document.querySelector('.hsum')?document.querySelector('.hsum').innerText.replace(/\\n/g,' | '):'',
    legend:document.querySelector('.hlegend')?document.querySelector('.hlegend').innerText.replace(/\\n/g,' '):'',
    aria:live[live.length-1]?live[live.length-1].getAttribute('aria-label'):''};
  /* a row must be one weekday, and cell widths must be uniform (a ragged grid
     is exactly how the old one hid the fact that it was not a calendar) */
  var ws=cells.map(function(c){return Math.round(c.getBoundingClientRect().width)});
  out.heat.cellW=ws[0];out.heat.ragged=ws.some(function(x){return Math.abs(x-ws[0])>1});
  var rows={};cells.forEach(function(c){var t=Math.round(c.getBoundingClientRect().top);
    var dow=(new Date(c.dataset.d+'T00:00:00').getDay()+6)%7;rows[t]=rows[t]||new Set();rows[t].add(dow)});
  out.heat.rowsMixed=Object.keys(rows).filter(function(k){return rows[k].size>1}).length;
  out.heat.rowCount=Object.keys(rows).length;

  /* tap the most recent logged day the way a thumb would */
  var last=live.filter(function(c){return /session|no session/.test(c.getAttribute('aria-label')||'')&&!/no session/.test(c.getAttribute('aria-label')||'')});
  var target=last[last.length-1];
  if(target)target.click();
  var host=document.getElementById('toasts');
  out.tap={date:target?target.dataset.d:null,toast:host?host.innerText.replace(/\\n/g,' | '):''};
  return out;
})()`;

(async () => {
  let ws = null, id = 0;
  const pending = new Map();
  const send = (method, params) => new Promise((res, rej) => {
    const n = ++id; pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params: params || {} }));
  });
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/list');
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); break; }
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  if (!ws) { console.log('FAIL: could not attach to Chrome'); chrome.kill(); process.exit(1); }
  await new Promise(r => ws.addEventListener('open', r));
  ws.addEventListener('message', ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
  });
  await send('Page.enable'); await send('Runtime.enable');
  const evaluate = async expression => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };
  const shot = async (sel, file) => {
    await evaluate("(function(){var e=document.querySelector('" + sel + "');if(e)e.scrollIntoView({block:'center'});return 1})()");
    await sleep(250);
    const s = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(s.data, 'base64'));
  };

  let bad = 0, m = null;
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: PROBE_URL });
  await sleep(1500);
  await evaluate('(function(){G.regen();G.nav("prog");return 1})()');
  await sleep(400);
  m = await evaluate(MEASURE);
  await shot('.chart', '_prog_volume.png');
  await shot('.heat', '_prog_consistency.png');

  const c = m.chart, h = m.heat, t = m.tap;
  console.log('  WIDTH ' + m.w + 'px  docScroll=' + m.docScroll + (m.docScroll > m.w + 1 ? '  DOC OVERFLOW' : '  fits'));
  console.log('  WEEKLY VOLUME');
  console.log('    average label "' + c.avgLabel + '" in the gutter: ' + c.gutterW + 'px wide at x ' + Math.round(c.gutterRight - c.gutterW) + '-' + c.gutterRight
    + ', first bar starts at ' + c.firstBarLeft + '  (' + c.kFontPx + ' / ' + c.vFontPx + ')');
  console.log('    a bar covering the words: ' + c.coveredByBars + 'px² (must be 0)'
    + '   gutter clear of every bar: ' + c.clearOfBars
    + '   week numbers hidden: ' + c.hiddenValues + '/' + c.valueCount
    + '   inside chart: ' + c.insideChart);
  console.log('  CONSISTENCY');
  console.log('    grid ' + h.rowCount + ' rows x ' + (h.cols - 1) + ' week columns, row letters "' + h.rowLetters + '", cell ' + h.cellW + 'px'
    + (h.ragged ? '  RAGGED' : '') + ', rows mixing weekdays: ' + h.rowsMixed + ' (must be 0)');
  console.log('    cells=' + h.cells + ' not-yet=' + h.future + ' ringed=' + JSON.stringify(h.ringed)
    + '  axis "' + h.firstLabel + ' … ' + h.lastLabel + '"  grid overflow=' + h.gridOverflow + 'px');
  console.log('    head:  ' + h.head);
  console.log('    legend: ' + h.legend);
  console.log('    aria:  ' + h.aria);
  console.log('    tap ' + t.date + ' -> toast: ' + t.toast);

  if (m.docScroll > m.w + 1) { bad++; console.log('    FAIL: the page scrolls sideways at ' + m.w + 'px'); }
  if (c.coveredByBars !== 0 || !c.clearOfBars) { bad++; console.log('    FAIL: a bar shares pixels with the average label'); }
  if (c.gutterRight > c.firstBarLeft) { bad++; console.log('    FAIL: the average label reaches into the plot area'); }
  if (c.hiddenValues !== 0) { bad++; console.log('    FAIL: the average label hides a week\'s own volume number'); }
  if (!c.insideChart) { bad++; console.log('    FAIL: the average label leaves the chart'); }
  if (!/^AVG /.test(c.avgLabel)) { bad++; console.log('    FAIL: the average label does not read as AVG'); }
  if (h.rowsMixed !== 0 || h.rowCount !== 7) { bad++; console.log('    FAIL: a row is not one weekday — this is not a calendar'); }
  if (h.cells !== 56 || h.dows !== 7 || h.weekLabels !== 8) { bad++; console.log('    FAIL: grid is not 7x8'); }
  if (h.gridOverflow > 0 || h.ragged) { bad++; console.log('    FAIL: the calendar grid is broken or clipped'); }
  if (h.ringed.length !== 1) { bad++; console.log('    FAIL: today is not marked exactly once'); }
  if (!/Last session/.test(h.head)) { bad++; console.log('    FAIL: the card does not say when the last session was'); }
  if (!/[A-Z][a-z]+day, .* (kg|lb)|No session/.test(t.toast)) { bad++; console.log('    FAIL: tapping a day reports nothing useful'); }
  if (m.errors.length) { bad++; console.log('    ERRORS: ' + m.errors.join('; ')); }

  /* the narrow end of the range Chrome's metrics can actually reach */
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
  await sleep(350);
  const n360 = await evaluate(MEASURE);
  console.log('  WIDTH 360px  docScroll=' + n360.docScroll + (n360.docScroll > 361 ? '  DOC OVERFLOW' : '  fits')
    + '  grid overflow=' + n360.heat.gridOverflow + 'px  cell=' + n360.heat.cellW + 'px'
    + '  avg label covered=' + n360.chart.coveredByBars + 'px²  gutter right=' + n360.chart.gutterRight
    + ' < first bar ' + n360.chart.firstBarLeft);
  if (n360.docScroll > 361) { bad++; console.log('    FAIL: sideways scroll at 360px'); }
  if (n360.heat.gridOverflow > 0) { bad++; console.log('    FAIL: the calendar overflows its card at 360px'); }
  if (n360.chart.coveredByBars !== 0 || n360.chart.gutterRight > n360.chart.firstBarLeft) { bad++; console.log('    FAIL: the average label collides with a bar at 360px'); }
  if (n360.errors.length) { bad++; console.log('    ERRORS@360: ' + n360.errors.join('; ')); }

  console.log(bad ? '\nPROGRESS CHECK FAILED (' + bad + ')' : '\nPROGRESS CHECK CLEAN');
  chrome.kill();
  await sleep(1200);
  for (let i = 0; i < 5; i++) { try { fs.rmSync(TEMP, { recursive: true, force: true }); break; } catch (e) { await sleep(600); } }
  process.exit(bad ? 1 : 0);
})();
