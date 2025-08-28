// ====== Yardımcılar + Kalıcı Hafıza ======
const $ = (s) => document.querySelector(s);
const LS = {
  get(key, def){ try{ const v = localStorage.getItem(key); return v==null ? def : JSON.parse(v);}catch{ return def; } },
  set(key, val){ try{ localStorage.setItem(key, JSON.stringify(val)); }catch{} }
};

function norm(sym){
  if(!sym) return '';
  return sym.trim().toUpperCase()
    .replace(/İ/g,'I').replace(/İ/g,'I')
    .replace(/Ç/g,'C').replace(/Ğ/g,'G').replace(/Ö/g,'O').replace(/Ş/g,'S').replace(/Ü/g,'U');
}
function fmtFixedTR(n, d=2){
  if(n==null || !isFinite(n)) return '—';
  return Number(n).toLocaleString('tr-TR',{minimumFractionDigits:d, maximumFractionDigits:d});
}
function fmtPctTR(n, d=2){
  if(n==null || !isFinite(n)) return '—';
  return '%'+Number(n).toLocaleString('tr-TR',{minimumFractionDigits:d, maximumFractionDigits:d});
}
function fmt4(n){ return (n==null||!isFinite(n)) ? '—' : Number(n).toFixed(4); }
function nowStr(){ return new Date().toLocaleTimeString('tr-TR'); }

// ====== Durum ======
let watched = new Set(LS.get('okxbin:watched', []));
let refreshMs = Number(LS.get('okxbin:interval', 1000));
let minPctFilter = Number(LS.get('okxbin:minpct', 0.00));
let themeMode = LS.get('okxbin:theme', 'dark');
let hiOn = LS.get('okxbin:hiOn', true);

const UI_DEFAULTS = {
  tableFont: 18, padY: 12, padX: 10, rowGap: 6, radius: 12, maxW: 1100,
  col: { coin:28, al:27, sat:27, pct:18 },
  cardFont: 22, hiPos: 'top', showBTC: true
};
let UI = Object.assign({}, UI_DEFAULTS, LS.get('okxbin:UI', UI_DEFAULTS));
if(!UI.col) UI.col = { coin:28, al:27, sat:27, pct:18 };

let timer = null, updating = false, errors = 0;

// Els
const elLast = $('#last'), elCnt = $('#cnt'), elErr = $('#err'),
      elBody = $('#tbody'), elRngLbl = $('#rngLbl'), elRng = $('#rng'), elMin = $('#minPct'),
      elThemeSel = $('#themeSel'), elBtc = $('#btc'), elBtcBox = $('#btcBox'),
      elHiWrap = $('#hiWrap'), elHiCoin = $('#hiCoin'), elHiAct = $('#hiAct'),
      elHiPrice = $('#hiPrice'), elHiPct = $('#hiPct'), elHiToggle = $('#toggleHi'),
      elCustomWrap = $('#customWrap'), elCustomToggle = $('#toggleCustom');

// ====== Ağ ======
function okxTicker(sym){ return `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(sym)}-USDT`; }
function binanceBook(sym){ return `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(sym)}USDT`; }
const BINANCE_BTC_PRICE = 'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT';

async function jget(url){
  const res = await fetch(url, {cache:'no-store'});
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}
function parseOkxTicker(json){
  if(!json || !json.data || !json.data[0]) return {bid:NaN, ask:NaN};
  const d = json.data[0];
  return {bid: parseFloat(d.bidPx), ask: parseFloat(d.askPx)};
}

// ====== Mantık (OKX↔Binance USDT) ======
async function tick(){
  if(updating) return;
  updating = true;
  try{
    if(UI.showBTC){
      try{
        const btc = await jget(BINANCE_BTC_PRICE);
        const p = parseFloat(btc.price);
        if(isFinite(p)) elBtc.textContent = fmtFixedTR(p, 2);
      }catch(e){}
    }

    if(watched.size===0){
      elBody.innerHTML = '';
      updateHighlight([]);
      elLast.textContent = nowStr();
      updating = false;
      return;
    }

    const syms = Array.from(watched);
    const jobs = syms.map(async (sym)=>{
      const s = norm(sym);
      const okxJson = await jget(okxTicker(s));
      const okxBest = parseOkxTicker(okxJson);

      const bJson = await jget(binanceBook(s));
      const bBid = parseFloat(bJson.bidPrice);
      const bAsk = parseFloat(bJson.askPrice);

      // diff1 = OKX_bid - Binance_ask  (Binance'den al, OKX'te sat)
      // diff2 = Binance_bid - OKX_ask  (OKX'ten al, Binance'de sat)
      const diff1 = okxBest.bid - bAsk;
      const diff2 = bBid - okxBest.ask;

      let show=false, low=0, high=0, pct=0, lowSrc='', highSrc='';
      let okxAction=null, okxPrice=null;

      if((diff1>0 || diff2>0) && isFinite(okxBest.bid) && isFinite(okxBest.ask) && isFinite(bBid) && isFinite(bAsk)){
        show = true;
        if(diff1 > diff2){
          pct = (diff1 / bAsk) * 100;
          low = bAsk; high = okxBest.bid; lowSrc='Binance'; highSrc='OKX';
          okxAction = 'SAT'; okxPrice = okxBest.bid;
        }else{
          pct = (diff2 / okxBest.ask) * 100;
          low = okxBest.ask; high = bBid; lowSrc='OKX'; highSrc='Binance';
          okxAction = 'AL'; okxPrice = okxBest.ask;
        }
      }
      return {sym: s, show, low, high, pct, lowSrc, highSrc, okxAction, okxPrice};
    });

    let rows = await Promise.all(jobs);
    rows = rows.filter(r => r && r.show && isFinite(r.pct) && r.pct >= (Number(minPctFilter)||0));
    rows.sort((a,b)=> b.pct - a.pct);
    draw(rows);
    updateHighlight(rows);

    elLast.textContent = nowStr();
  }catch(e){
    errors++; elErr.textContent = String(errors);
  }finally{
    updating = false;
  }
}

// ====== Çizim ======
function draw(rows){
  const frag = document.createDocumentFragment();
  rows.forEach(r=>{
    const tr = document.createElement('tr');

    // Coin
    const tdCoin = document.createElement('td');
    tdCoin.className = 'coinCell';
    const sym = document.createElement('span'); sym.className='coinSym'; sym.textContent = r.sym;
    tdCoin.appendChild(sym);
    tr.appendChild(tdCoin);

    // AL
    const tdL = document.createElement('td'); tdL.className='mono alCell';
    tdL.textContent = fmt4(r.low);
    tdL.classList.add(r.lowSrc==='Binance' ? 'src-binance' : 'src-okx');
    tr.appendChild(tdL);

    // SAT
    const tdH = document.createElement('td'); tdH.className='mono satCell';
    tdH.textContent = fmt4(r.high);
    tdH.classList.add(r.highSrc==='OKX' ? 'src-okx' : 'src-binance');
    tr.appendChild(tdH);

    // % Fark
    const tdP = document.createElement('td'); tdP.className='mono pctCell';
    tdP.textContent = fmtPctTR(r.pct, 2);
    tr.appendChild(tdP);

    frag.appendChild(tr);
  });
  elBody.innerHTML = '';
  elBody.appendChild(frag);
}

// ====== En Yüksek Fark (yalnız OKX bilgisi) ======
function updateHighlight(rows){
  if(!hiOn || UI.hiPos==='hidden'){ elHiWrap.classList.add('hidden'); return; }
  elHiWrap.classList.remove('hidden');
  placeHi(UI.hiPos);

  if(!rows.length){
    elHiCoin.textContent='—'; elHiAct.textContent='OKX • —'; elHiPrice.textContent='—'; elHiPct.textContent='—';
    return;
  }
  const r = rows[0];
  elHiCoin.textContent = r.sym;
  elHiAct.textContent = `OKX • ${r.okxAction==='AL'?'AL':'SAT'}`;
  elHiPrice.textContent = `${fmtFixedTR(r.okxPrice, 4)} USDT`;
  elHiPct.textContent = fmtPctTR(r.pct, 2);
}

// ====== Tema ======
function applyTheme(mode){
  const html = document.documentElement;
  html.classList.remove('theme-dark','theme-light');
  html.classList.add(mode==='light' ? 'theme-light' : 'theme-dark');
  elThemeSel.value = (mode==='light' ? 'light' : 'dark');
  LS.set('okxbin:theme', (mode==='light' ? 'light' : 'dark'));
}

// ====== Kişiselleştirme ======
function applyUI(u){
  const root = document.documentElement.style;
  root.setProperty('--table-font', u.tableFont+'px');
  root.setProperty('--cell-pad-y', u.padY+'px');
  root.setProperty('--cell-pad-x', u.padX+'px');
  root.setProperty('--row-gap', u.rowGap+'px');
  root.setProperty('--cell-radius', u.radius+'px');
  root.setProperty('--container-max', u.maxW+'px');
  root.setProperty('--col-coin', (u.col.coin||28)+'%');
  root.setProperty('--col-al',   (u.col.al||27)+'%');
  root.setProperty('--col-sat',  (u.col.sat||27)+'%');
  root.setProperty('--col-pct',  (u.col.pct||18)+'%');
  root.setProperty('--card-font', u.cardFont+'px');

  $('#btcBox').style.display = u.showBTC ? '' : 'none';

  placeHi(u.hiPos);

  // Panel metinleri
  $('#ui_tableFont_val').textContent = u.tableFont+'px';
  $('#ui_padY_val').textContent = u.padY+'px';
  $('#ui_padX_val').textContent = u.padX+'px';
  $('#ui_rowGap_val').textContent = u.rowGap+'px';
  $('#ui_radius_val').textContent = u.radius+'px';
  $('#ui_maxW_val').textContent = u.maxW+'px';
  $('#ui_cardFont_val').textContent = u.cardFont+'px';

  // Inputs
  $('#ui_tableFont').value = u.tableFont;
  $('#ui_padY').value = u.padY;
  $('#ui_padX').value = u.padX;
  $('#ui_rowGap').value = u.rowGap;
  $('#ui_radius').value = u.radius;
  $('#ui_maxW').value = u.maxW;
  $('#ui_cardFont').value = u.cardFont;
  $('#ui_colCoin').value = u.col.coin;
  $('#ui_colAl').value = u.col.al;
  $('#ui_colSat').value = u.col.sat;
  $('#ui_colPct').value = u.col.pct;
  $('#ui_hiPos').value = u.hiPos;
  $('#ui_showBTC').checked = !!u.showBTC;

  const sum = (+u.col.coin)+(+u.col.al)+(+u.col.sat)+(+u.col.pct);
  const ok = Math.round(sum)===100;
  $('#ui_colSum').textContent = 'Toplam: '+sum.toFixed(0)+'% ' + (ok?'✓':'(100 olmalı — otomatik normalize edilir)');
}
function saveUI(){ LS.set('okxbin:UI', UI); }
function normalizeCols(){
  let {coin,al,sat,pct} = UI.col;
  let sum = coin+al+sat+pct;
  if(sum<=0) { UI.col={coin:28,al:27,sat:27,pct:18}; return; }
  UI.col.coin = +(coin*100/sum).toFixed(0);
  UI.col.al   = +(al*100/sum).toFixed(0);
  UI.col.sat  = +(sat*100/sum).toFixed(0);
  UI.col.pct  = 100 - UI.col.coin - UI.col.al - UI.col.sat;
}
function placeHi(pos){
  const wrap = elHiWrap;
  if(pos==='hidden'){ wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');
  if(pos==='top')                $('#anchorTop').after(wrap);
  else if(pos==='afterControls') $('#anchorAfterControls').after(wrap);
  else if(pos==='afterTable')    $('#anchorAfterTable').after(wrap);
}

// ====== UI / Kontroller ======
function renderChips(){
  const wrap = $('#chips'); wrap.innerHTML='';
  Array.from(watched).sort().forEach(sym=>{
    const d = document.createElement('div'); d.className='chip';
    const s = document.createElement('span'); s.textContent = sym;
    const b = document.createElement('button'); b.type='button'; b.setAttribute('aria-label', sym+' sil'); b.textContent='×';
    b.addEventListener('click', ()=>{
      watched.delete(sym);
      LS.set('okxbin:watched', Array.from(watched));
      $('#cnt').textContent = String(watched.size);
      renderChips();
    });
    d.appendChild(s); d.appendChild(b); wrap.appendChild(d);
  });
  $('#cnt').textContent = String(watched.size);
}
function schedule(ms){
  refreshMs = Math.max(100, Math.min(4000, ms|0));
  elRng.value = refreshMs;
  elRngLbl.textContent = (refreshMs/1000).toFixed(1)+' sn';
  LS.set('okxbin:interval', refreshMs);
  if(timer) clearInterval(timer);
  timer = setInterval(tick, refreshMs);
}

// ====== Eventler ======
$('#add').addEventListener('click', ()=>{
  const raw = $('#coinIn').value;
  const sym = norm(raw);
  if(sym){
    watched.add(sym);
    LS.set('okxbin:watched', Array.from(watched));
    renderChips();
  }
  $('#coinIn').value='';
});
$('#coinIn').addEventListener('keydown',(e)=>{ if(e.key==='Enter') $('#add').click(); });

$('#clear').addEventListener('click', ()=>{
  watched.clear();
  LS.set('okxbin:watched', []);
  renderChips(); elBody.innerHTML='';
});

elRng.addEventListener('input', e=> schedule(Number(e.target.value)));
elMin.addEventListener('input', e=>{
  minPctFilter = Number(e.target.value)||0;
  LS.set('okxbin:minpct', minPctFilter);
});
$('#themeSel').addEventListener('change', (e)=> applyTheme(e.target.value));

elHiToggle.addEventListener('click', ()=>{
  hiOn = !hiOn;
  LS.set('okxbin:hiOn', hiOn);
  elHiToggle.textContent = 'En Yüksek Fark: ' + (hiOn ? 'Açık' : 'Kapalı');
  elHiToggle.setAttribute('aria-pressed', hiOn ? 'true':'false');
  updateHighlight([]);
});
elCustomToggle.addEventListener('click', ()=>{
  const nowOpen = elCustomWrap.classList.toggle('hidden') ? false : true;
  elCustomToggle.textContent = 'Kişiselleştir: ' + (nowOpen ? 'Açık' : 'Kapalı');
  elCustomToggle.setAttribute('aria-expanded', nowOpen ? 'true':'false');
});

// Kişiselleştirme inputları
$('#ui_tableFont').addEventListener('input', (e)=>{ UI.tableFont=+e.target.value; applyUI(UI); saveUI(); });
$('#ui_padY').addEventListener('input', (e)=>{ UI.padY=+e.target.value; applyUI(UI); saveUI(); });
$('#ui_padX').addEventListener('input', (e)=>{ UI.padX=+e.target.value; applyUI(UI); saveUI(); });
$('#ui_rowGap').addEventListener('input', (e)=>{ UI.rowGap=+e.target.value; applyUI(UI); saveUI(); });
$('#ui_radius').addEventListener('input', (e)=>{ UI.radius=+e.target.value; applyUI(UI); saveUI(); });
$('#ui_maxW').addEventListener('input', (e)=>{ UI.maxW=+e.target.value; applyUI(UI); saveUI(); });
$('#ui_cardFont').addEventListener('input', (e)=>{ UI.cardFont=+e.target.value; applyUI(UI); saveUI(); });
$('#ui_hiPos').addEventListener('change', (e)=>{ UI.hiPos=e.target.value; applyUI(UI); saveUI(); });
$('#ui_showBTC').addEventListener('change', (e)=>{ UI.showBTC=e.target.checked; applyUI(UI); saveUI(); });
['ui_colCoin','ui_colAl','ui_colSat','ui_colPct'].forEach(id=>{
  $('#'+id).addEventListener('input',(e)
