/* Verify the TRAIN card at real phone widths in headless Chrome.
   Layout is the risk in this surface: a prescription bar, a per-set effort strip
   and a six-column set row all have to fit 360px without horizontal scroll, and a
   clipped "42.5 kg" stepper is exactly the kind of bug a desktop eyeball misses.
   Also drives the effort control end to end, because the claim being made is that
   a per-set reading actually changes the next load.

   Run: node _shot_train.cjs
   Writes _train_360.png / _train_390.png / _train_430.png and the effort picker. */
const fs = require('fs');
const { spawn } = require('child_process');

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const TEMP = '_train_shot';
/* argv[2] lets the same probe measure a different build (e.g. the pre-change
   baseline) so a layout oddity can be attributed instead of guessed at. */
const FILE = process.argv[2] || 'index.html';
const BASELINE = FILE !== 'index.html';

const probe = `<script>
window.__err=[];
window.addEventListener('error',function(e){window.__err.push((e.message||'')+' @'+e.lineno)});
<\/script>`;
fs.mkdirSync(TEMP, { recursive: true });
const PROBE_URL = 'file:///' + process.cwd().replace(/\\/g, '/') + '/' + TEMP + '/probe.html';
fs.writeFileSync(TEMP + '/probe.html', fs.readFileSync(FILE, 'utf8').replace('<head>', '<head>' + probe));

const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--remote-debugging-port=' + PORT, '--user-data-dir=' + process.cwd() + '\\' + TEMP + '\\profile',
  'about:blank'], { stdio: 'ignore' });

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* A session whose last bench entry topped the rep range, dated a few days back so
   the session logged in the probe is unambiguously the newest for that lift. */
const SETUP = `(function(){
  S.hist=[{id:'pk1',date:addDays(todayISO(),-3),name:'Upper A',routineId:'upper-a',dur:3600,entries:[
    {id:'bench',sets:[{w:100,r:8},{w:100,r:8},{w:100,r:8}]},
    {id:'row',sets:[{w:65,r:10},{w:65,r:10},{w:65,r:8}]},
    {id:'ohp',sets:[{w:40,r:10},{w:40,r:10},{w:40,r:8}]}]}];
  saveLS();
  G.startRoutine('upper-a');
  return !!(typeof sess!=='undefined'&&sess)?sess.entries.length:-1;
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
  await send('Page.enable');
  await send('Runtime.enable');

  const evaluate = async (expression, byValue = true) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: byValue, awaitPromise: false });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description));
    return r.result.value;
  };

  let bad = 0;
  const problems = [];
  const WIDTHS = [360, 390, 430];
  for (const w of WIDTHS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 3, mobile: true });
    await send('Page.navigate', { url: PROBE_URL });
    await sleep(1400);
    const started = await evaluate(SETUP);
    if (!(started > 0)) { problems.push(w + 'px: no session started (' + started + ')'); bad++; }
    await sleep(200);

    const r = await evaluate(`(function(){
      var out={vw:window.innerWidth,docScroll:document.documentElement.scrollWidth,rows:[]};
      out.errors=(window.__err||[]).slice(0,4);
      out.cards=document.querySelectorAll('.xcard').length;
      var first=document.querySelector('.xcard');
      out.firstCard=first?Math.round(first.getBoundingClientRect().width):-1;
      var bars=document.querySelectorAll('.rxbar,.rirstrip,.xfoot,.xfoot2');
      out.groups=[];
      bars.forEach(function(b){
        var rc=b.getBoundingClientRect();
        out.groups.push({cls:b.className,w:Math.round(rc.width),sw:b.scrollWidth,cw:b.clientWidth,
          right:Math.round(rc.right),wrap:Math.round(rc.height)});
      });
      document.querySelectorAll('.xcard').forEach(function(card,ci){
        if(ci>0)return;
        card.querySelectorAll('.setrow').forEach(function(row){
          var rc=row.getBoundingClientRect();
          var cells=[];
          row.querySelectorAll('.chk,.setidx,.stepbox,.deltachip').forEach(function(el){
            var e=el.getBoundingClientRect();
            cells.push({cls:el.className.split(' ')[0],w:Math.round(e.width),right:Math.round(e.right),
              /* the real test: is any content clipped inside its own box? */
              clipped:el.scrollWidth>el.clientWidth+1});
          });
          out.rows.push({w:Math.round(rc.width),sw:row.scrollWidth,cw:row.clientWidth,right:Math.round(rc.right),cells:cells});
        });
      });
      out.clipped=[];
      document.querySelectorAll('.xcard .stepbox,.xcard .stepval,.xcard .setidx').forEach(function(el){
        if(el.scrollWidth>el.clientWidth+1)out.clipped.push({cls:el.className||el.tagName,w:Math.round(el.getBoundingClientRect().width),
          sw:el.scrollWidth,cw:el.clientWidth,txt:(el.textContent||'').trim().slice(0,12),
          kids:[].slice.call(el.children).map(function(c){return (c.className||c.tagName)+':'+Math.round(c.getBoundingClientRect().width)})});
      });
      var pill=document.querySelector('.rxnext');
      out.next=pill?pill.textContent.trim():'-';
      out.why=(document.querySelector('.rxwhy')||{textContent:'-'}).textContent.trim();
      /* the prescription line and the last-session line, because the failure this
         fixes was legibility: a reader could not tell which number was today's */
      out.prog=(document.querySelector('.rxprog')||{textContent:'-'}).textContent.trim();
      var xs=document.querySelector('.xsub');
      out.last=xs?xs.textContent.trim():'-';
      var tgt=document.querySelector('.rxtgt');
      out.target=tgt?tgt.textContent.trim():'-';
      out.rirBtns=document.querySelectorAll('.rirset').length;
      var wv=document.querySelector('.stepval[data-w]');
      out.weightText=wv?wv.textContent.trim():'-';
      out.weightClipped=wv?wv.scrollWidth>wv.clientWidth+1:false;
      return out;
    })()`);

    const overflow = r.docScroll > r.vw + 1 ||
      r.groups.some(g => g.sw > g.cw + 1 || g.right > r.vw + 1) ||
      r.rows.some(x => x.sw > x.cw + 1 || x.right > r.vw + 1) ||
      r.rows.some(x => x.cells.some(c => c.clipped)) || r.weightClipped;
    if (overflow || r.errors.length) bad++;
    console.log('  ' + String(w).padStart(4) + 'px: docScroll=' + r.docScroll + '/' + r.vw
      + ' cellsClipped=' + r.rows.flatMap(x => x.cells).filter(c => c.clipped).map(c => c.cls).join(',') || ''
      + ' target="' + r.target + '" next="' + r.next + '" effortButtons=' + r.rirBtns
      + ' ' + (overflow ? 'OVERFLOW' : 'FITS'));
    console.log('        why: ' + r.why);
    r.groups.forEach(g => console.log('        ' + g.cls + ' w=' + g.w + ' scroll=' + g.sw + '/' + g.cw + ' h=' + g.wrap + (g.sw > g.cw + 1 ? '  <-- OVERFLOW' : '')));
    if (r.errors.length) console.log('        ERRORS: ' + r.errors.join('; '));
    if (r.clipped.length) r.clipped.forEach(c => console.log('        CLIPPED ' + c.cls + ' w=' + c.w + ' scroll=' + c.sw + '/' + c.cw + ' txt="' + c.txt + '" kids=[' + c.kids.join(' ') + ']'));

    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync('_train_' + w + '.png', Buffer.from(shot.data, 'base64'));
  }

  if (BASELINE) {
    console.log('\nBASELINE PASS (' + FILE + '): layout only');
    console.log(bad ? 'BASELINE CHECK FAILED (' + bad + ')' : 'BASELINE CHECK CLEAN');
    chrome.kill();
    await sleep(1200);
    for (let i = 0; i < 5; i++) { try { fs.rmSync(TEMP, { recursive: true, force: true }); break; } catch (e) { await sleep(600); } }
    process.exit(bad ? 1 : 0);
  }

  /* ---- the claim under test: a per-set reading changes the next load ---- */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 3, mobile: true });
  await send('Page.navigate', { url: PROBE_URL });
  await sleep(1400);
  await evaluate(SETUP);
  await sleep(200);
  const before = await evaluate("document.querySelector('.rxnext').textContent.trim()");
  const whyBefore = await evaluate("[].slice.call(document.querySelectorAll('.rxwhy')).map(function(e){return e.textContent.trim()})");
  /* ---- what a reader has to be able to find, once, without asking ----
     The reported failure was legibility, not logic: the card showed last
     session's three per-set loads beside a NEXT pill and nothing said which
     number was today's. So the card must state today's single load, say it
     applies to every working set, name what it is measured against, and present
     last session as a RECORD rather than a plan. */
  const progBefore = await evaluate("(document.querySelector('.rxprog')||{textContent:'-'}).textContent.trim()");
  const lastBefore = await evaluate("(document.querySelector('.xsub')||{textContent:'-'}).textContent.trim()");
  console.log('    the day\'s load, in one line: "' + progBefore + '"');
  console.log('    last session line:            "' + lastBefore + '"');
  if (!/All 3 working sets at 102\.5 kg/.test(progBefore)) {
    bad++; console.log('    FAIL: the card does not state today\'s single load for every set ("' + progBefore + '")');
  }
  if (!/\+2\.5/.test(progBefore) || !/100 kg/.test(progBefore)) {
    bad++; console.log('    FAIL: the prescription line does not show the progression against last session ("' + progBefore + '")');
  }
  if (!/@ 100 kg/.test(lastBefore)) {
    bad++; console.log('    FAIL: last session still reads as a per-set plan, not a record ("' + lastBefore + '")');
  }
  /* open set 1's effort picker from the card, exactly as a thumb would */
  await evaluate("document.querySelectorAll('.rirset')[1].click()");
  await sleep(200);
  const picker = await evaluate(`(function(){
    var b=document.querySelector('.riropts');if(!b)return {open:false};
    return {open:true,opts:b.querySelectorAll('.riropt').length,
      title:(document.querySelector('#ovl h2')||{textContent:''}).textContent.trim(),
      sub:(document.querySelector('#ovl .shsub')||{textContent:''}).textContent.trim()};
  })()`);
  const pick = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_train_effort.png', Buffer.from(pick.data, 'base64'));
  /* choose 5 on set 1, then use the "All" shortcut for the rest */
  const afterSet = await evaluate(`(function(){
    document.querySelectorAll('.riropt')[5].click();
    var e=sess.entries[0];
    return {rir0:e.sets[0].rir, logged:e.sets.filter(function(s){return typeof s.rir==='number'}).length,
      chip:(document.querySelectorAll('.rirset')[1]||{textContent:''}).textContent.trim(),
      hint:(document.querySelector('.rirhint')||{textContent:''}).textContent.trim(),
      sheetStayedOpen: !!document.querySelector('#ovl .riropts')};
  })()`);
  /* the per-set path, one set at a time: 5, then 2, then 0 */
  const mixed = await evaluate(`(function(){
    var btns=document.querySelectorAll('.rirset');
    btns[2].click(); document.querySelectorAll('.riropt')[2].click();   /* set 2 = 2 */
    btns[3].click(); document.querySelectorAll('.riropt')[0].click();   /* set 3 = 0 */
    var e=sess.entries[0];
    return {perSet:e.sets.map(function(s){return s.rir}).join(','),
      hardest:entryRir(e), hint:(document.querySelector('.rirhint')||{textContent:''}).textContent.trim(),
      chips:[].slice.call(document.querySelectorAll('.rirset')).map(function(b){return b.textContent.trim()})};
  })()`);
  const mixedShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_train_mixed.png', Buffer.from(mixedShot.data, 'base64'));
  /* now the whole chain: log the sets, save, and look at what the app prescribes
     for the same session next time — which is the only place in-session effort
     can legitimately change a load */
  const chain = await evaluate(`(function(){
    /* ticking a set rerenders the card, so the box has to be re-queried each time
       or the second click lands on a detached node */
    for(var k=0;k<24;k++){
      var c=document.querySelector('.xcard').querySelectorAll('.chk')[k];
      if(!c)break;
      c.click();
    }
    var live=sess.entries[0];
    var doneCount=live.sets.filter(function(s){return s.done}).length;
    G.save();
    var h=S.hist[S.hist.length-1];
    var saved=h.entries.filter(function(e){return e.id===live.id})[0];
    G.startRepeat();
    var pill=document.querySelector('.rxnext');
    var prefill=document.querySelector('.stepval[data-w]');
    /* The effort term has to be isolated from the DAMPING term, or the comparison
       is vacuous: after two rises in a row the engine damps the increase to 60%
       of a step, which on a 2.5 kg barbell is already under one plate step and so
       already a hold. One controlled exposure at a known load, with and without a
       reading, is the only way to see what the READING did. */
    var mk=function(rir){
      var rec={id:'cf'+rir,date:todayISO(),name:'T',entries:[{id:live.id,
        sets:[{w:100,r:8},{w:100,r:8},{w:100,r:8}]}]};
      if(rir!==null)rec.entries[0].sets.forEach(function(s){s.rir=rir});
      var keep=S.hist;S.hist=[rec];
      var v=nextLoad(live.id).w;
      var note=nextLoad(live.id).note;
      S.hist=keep;return {w:v,note:note};
    };
    var easy=mk(null), hard=mk(0);
    return {next:pill?pill.textContent.trim():'-',
      why:[].slice.call(document.querySelectorAll('.rxwhy')).map(function(e){return e.textContent.trim()}),
      sessions:S.hist.length,doneCount:doneCount,
      hard:hard.w,easy:easy.w,easyNote:easy.note,hardNote:hard.note,
      prefill:prefill?prefill.textContent.trim():'-',
      savedSets:saved?saved.sets.map(function(s){return s.rir}).join(',')+' | e.rir='+saved.rir:'(entry not saved)'};
  })()`);
  console.log('\n  EFFORT FLOW');
  console.log('    next load before logging effort: "' + before + '"');
  console.log('    why before: ' + JSON.stringify(whyBefore));
  console.log('    picker: open=' + picker.open + ' options=' + picker.opts + ' title="' + picker.title + '"');
  console.log('    sub: ' + picker.sub.replace(/\s+/g, ' '));
  console.log('    after set 1 = 5: rir=' + afterSet.rir0 + ' logged=' + afterSet.logged + ' chip="' + afterSet.chip + '" sheetStillOpen=' + afterSet.sheetStayedOpen);
  console.log('    hint: ' + afterSet.hint.replace(/\s+/g, ' '));
  console.log('    three different readings: ' + mixed.perSet + ' -> hardest ' + mixed.hardest + '  chips=' + JSON.stringify(mixed.chips));
  console.log('    hint: ' + mixed.hint.replace(/\s+/g, ' '));
  console.log('    after save, per-set effort in the log: ' + chain.savedSets + '  (sets ticked: ' + chain.doneCount + ', sessions: ' + chain.sessions + ')');
  console.log('    next load for the repeat: "' + chain.next + '", rows prefilled at "' + chain.prefill + '"  (was "' + before + '")');
  console.log('    why now: ' + JSON.stringify(chain.why));
  /* The claim is about the EFFORT, isolated from the damping: the same single
     exposure must prescribe LESS when a set is reported taken to failure. */
  const held = chain.hard < chain.easy;
  console.log('    one exposure at 100 kg: no reading -> ' + chain.easy + ' kg ("' + chain.easyNote + '")');
  console.log('                     set 3 to failure -> ' + chain.hard + ' kg ("' + chain.hardNote + '")');
  if (!picker.open || picker.opts !== 6) { bad++; console.log('    FAIL: the effort picker did not open with six options'); }
  if (afterSet.rir0 !== 5) { bad++; console.log('    FAIL: set 1 did not take the reading'); }
  if (mixed.perSet !== '5,2,0' || mixed.hardest !== 0) { bad++; console.log('    FAIL: three different per-set readings did not stick'); }
  if (!/^5,2,0/.test(chain.savedSets)) { bad++; console.log('    FAIL: per-set effort did not survive the save'); }
  if (!held) { bad++; console.log('    FAIL: a set taken to failure did not hold the next load back (' + chain.hard + ' vs ' + chain.easy + ')'); }
  const num = s => (String(s).match(/\d+(\.\d+)?/) || [''])[0];
  if (num(chain.prefill) !== num(chain.next)) { bad++; console.log('    FAIL: the prefilled row and the NEXT pill disagree (' + chain.prefill + ' vs ' + chain.next + ')'); }

  /* screenshots of the card with effort logged, for the eye */
  const shot2 = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_train_logged.png', Buffer.from(shot2.data, 'base64'));

  /* and the remove sheet, which is the other thing that confused a real user */
  await evaluate("G.removeMenu(0)");
  await sleep(250);
  const sheet = await evaluate("(document.querySelector('#ovl .sheet')||{innerText:''}).innerText");
  const rm = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_train_remove.png', Buffer.from(rm.data, 'base64'));
  console.log('\n  REMOVE SHEET\n' + sheet.split('\n').filter(Boolean).map(l => '    ' + l).join('\n'));

  /* ---- TYPING A WEIGHT, AND LOGGING A BODYWEIGHT LIFT AT ZERO ----
     Two reports, one shape: the steppers walk the exercise's own grid and nothing
     else. A dumbbell rack that steps 2.5 kg, or odd 7/9/11 kg bells, is
     unreachable — and a pull-up was prescribed 5 kg on a dip belt to a lifter who
     could not do one at bodyweight, with no way to enter 0 either. */
  await send('Page.navigate', { url: PROBE_URL });
  await sleep(1400);
  await evaluate(SETUP);
  await sleep(200);
  const typed = await evaluate(`(function(){
    var out={};
    function cell(i,k){
      var r=document.querySelector('[data-row="'+i+'-'+k+'"]');if(!r)return null;
      var v=r.querySelector('[data-w]');
      return {txt:v?v.textContent.trim():'-',edit:v?v.getAttribute('data-wedit'):null,
        clipped:v?v.scrollWidth>v.clientWidth+1:null,sw:v?v.scrollWidth:0,cw:v?v.clientWidth:0};
    }
    function open(i,k){document.querySelector('[data-wedit="'+i+'-'+k+'"]').click();return document.getElementById('wq')}
    var ents=sess.entries;
    var dbi=ents.findIndex(function(e){return EXBY[e.id].db});
    var pui=ents.findIndex(function(e){return e.id==='pullup'});
    var bbi=ents.findIndex(function(e){return !isBwEx(EXBY[e.id])});
    out.dbEx=dbi>=0?EXBY[ents[dbi].id].n:null;
    out.dbGrid=dbi>=0?gridOf(EXBY[ents[dbi].id].def.inc):null;
    out.puEx=pui>=0?EXBY[ents[pui].id].n:null;
    out.dbBefore=cell(dbi,0);
    /* 1. tapping the number opens a field that accepts any value */
    var inp=open(dbi,0);
    out.sheetOpen=!!inp;
    out.sheetTitle=(document.querySelector('#ovl h2')||{textContent:''}).textContent.trim();
    out.inputMode=inp?(inp.getAttribute('inputmode')||''):'';
    out.prefilled=inp?inp.value:'';
    /* 2. 7 kg is NOT on a 2 kg dumbbell grid — that is the point */
    inp.value='7'; G.weightSet(dbi,0);
    out.dbStored=sess.entries[dbi].sets[0].w;
    out.dbAfter=cell(dbi,0);
    open(dbi,1); document.getElementById('wq').value='11'; G.weightSet(dbi,1);
    out.dbStored2=sess.entries[dbi].sets[1].w;
    out.dbAfter2=cell(dbi,1);
    /* 3. a bodyweight lift: 0 is bodyweight and a minus number is assistance */
    out.puBefore=cell(pui,0);
    var pin=open(pui,0);
    out.puHint=([].slice.call(document.querySelectorAll('#ovl .shsub'))[1]||{textContent:''}).textContent.trim();
    pin.value='0'; G.weightSet(pui,0);
    out.puStoredZero=sess.entries[pui].sets[0].w;
    out.puBodyweight=cell(pui,0);
    open(pui,1); document.getElementById('wq').value='-12.5'; G.weightSet(pui,1);
    out.puStoredAssist=sess.entries[pui].sets[1].w;
    out.puAssist=cell(pui,1);
    /* 4. a barbell cannot weigh less than nothing: a minus entry floors at zero */
    open(bbi,0); document.getElementById('wq').value='-30'; G.weightSet(bbi,0);
    out.barStored=sess.entries[bbi].sets[0].w;
    /* 5. junk is refused, and the set is left exactly as it was */
    var keep=sess.entries[bbi].sets[0].w;
    open(bbi,0); document.getElementById('wq').value='abc'; G.weightSet(bbi,0);
    out.junkStored=sess.entries[bbi].sets[0].w; out.junkKept=keep;
    return out;
  })()`);
  const typedShot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync('_train_typed.png', Buffer.from(typedShot.data, 'base64'));
  console.log('\n  TYPING A WEIGHT (' + typed.dbEx + ' on a ' + typed.dbGrid + ' kg grid, ' + typed.puEx + ')');
  console.log('    before: "' + (typed.dbBefore && typed.dbBefore.txt) + '"  tappable=' + (typed.dbBefore && typed.dbBefore.edit));
  console.log('    sheet: open=' + typed.sheetOpen + ' title="' + typed.sheetTitle + '" inputmode=' + typed.inputMode + ' prefilled="' + typed.prefilled + '"');
  console.log('    typed 7  -> stored ' + typed.dbStored + ', cell "' + (typed.dbAfter && typed.dbAfter.txt) + '"');
  console.log('    typed 11 -> stored ' + typed.dbStored2 + ', cell "' + (typed.dbAfter2 && typed.dbAfter2.txt) + '"');
  console.log('    pull-up before: "' + (typed.puBefore && typed.puBefore.txt) + '"');
  console.log('    hint: ' + typed.puHint.replace(/\s+/g, ' '));
  console.log('    typed 0     -> stored ' + typed.puStoredZero + ', cell "' + (typed.puBodyweight && typed.puBodyweight.txt) + '"');
  console.log('    typed -12.5 -> stored ' + typed.puStoredAssist + ', cell "' + (typed.puAssist && typed.puAssist.txt) + '"  clipped=' + (typed.puAssist && typed.puAssist.clipped) + ' (' + (typed.puAssist && typed.puAssist.sw) + '/' + (typed.puAssist && typed.puAssist.cw) + ')');
  console.log('    minus 30 on a barbell -> stored ' + typed.barStored + ' (floors at zero)');
  console.log('    "abc" -> stored ' + typed.junkStored + ', was ' + typed.junkKept);
  if (!typed.sheetOpen || typed.inputMode !== 'decimal') { bad++; console.log('    FAIL: tapping the weight did not open a decimal-entry sheet'); }
  if (typed.dbStored !== 7 || !/^7/.test(typed.dbAfter.txt)) { bad++; console.log('    FAIL: an off-grid 7 kg was not accepted (' + typed.dbStored + ' / "' + typed.dbAfter.txt + '")'); }
  if (typed.dbStored2 !== 11) { bad++; console.log('    FAIL: an off-grid 11 kg was not accepted (' + typed.dbStored2 + ')'); }
  if (typed.puStoredZero !== 0 || !/BW/.test(typed.puBodyweight.txt)) { bad++; console.log('    FAIL: bodyweight could not be entered as 0 ("' + typed.puBodyweight.txt + '")'); }
  if (!/0 is bodyweight/i.test(typed.puHint) || !/assistance/i.test(typed.puHint)) { bad++; console.log('    FAIL: the bodyweight sheet does not explain 0 and assistance ("' + typed.puHint + '")'); }
  if (typed.puStoredAssist !== -12.5 || !/ASSIST/.test(typed.puAssist.txt)) { bad++; console.log('    FAIL: a typed assist was not stored ("' + typed.puAssist.txt + '")'); }
  if (typed.puAssist.clipped) { bad++; console.log('    FAIL: the ASSIST label is clipped inside its own cell (' + typed.puAssist.sw + '/' + typed.puAssist.cw + ')'); }
  if (typed.barStored !== 0) { bad++; console.log('    FAIL: a minus weight survived on a barbell exercise (' + typed.barStored + ')'); }
  if (typed.junkStored !== typed.junkKept) { bad++; console.log('    FAIL: junk input changed the weight (' + typed.junkKept + ' -> ' + typed.junkStored + ')'); }

  console.log(bad ? '\nTRAIN CARD CHECK FAILED (' + bad + ')' : '\nTRAIN CARD CHECK CLEAN');
  chrome.kill();
  await sleep(1200);
  for (let i = 0; i < 5; i++) { try { fs.rmSync(TEMP, { recursive: true, force: true }); break; } catch (e) { await sleep(600); } }
  process.exit(bad ? 1 : 0);
})();
