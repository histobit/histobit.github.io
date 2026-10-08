const $ = id => document.getElementById(id);
const money = n => new Intl.NumberFormat('ru-RU', {style:'currency',currency:'USD',maximumFractionDigits:0}).format(n);
const price = n => new Intl.NumberFormat('ru-RU', {style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2}).format(n);
const pct = n => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(2)}%`;
const dateText = s => new Date(`${s}T00:00:00Z`).toLocaleDateString('ru-RU', {day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'});
const files = {BTCUSDT:'candles.json', ETHUSDT:'eth-candles.json'};
const datasets = {};
let candles = [], trades = [], openTrade = null, page = 0, loadVersion = 0;
const pageSize = 10;

$('login-form').addEventListener('submit', async e => {
  e.preventDefault();
  if ($('client').value.trim() !== '123' || $('password').value !== '123') {
    $('login-error').textContent = 'Неверный клиент или пароль'; return;
  }
  $('login-error').textContent = '';
  $('login').hidden = true;
  $('dashboard').hidden = false;
  await loadData();
});
$('logout').addEventListener('click', () => { $('dashboard').hidden = true; $('login').hidden = false; $('password').value = ''; });
$('recalc').addEventListener('click', calculate);
$('pair').addEventListener('change', () => loadData(candles.at(-1)?.[0]));
$('prev-page').addEventListener('click', () => {page--; renderTrades();});
$('next-page').addEventListener('click', () => {page++; renderTrades();});
for(const eventName of ['pointerover','click','focusin']){
  $('equity-chart').addEventListener(eventName,event=>{
    const marker=event.target.closest?.('circle[data-label]');
    if(marker) set('chart-trade-detail',marker.dataset.label);
  });
}

async function loadData(previousMax){
  const pair = $('pair').value, version = ++loadVersion;
  set('data-status', `Загружаем ${pair}…`);
  try {
    if (!datasets[pair]) {
      const response = await fetch(files[pair], {cache:'no-store'});
      if (!response.ok) throw new Error(`Не удалось получить данные ${pair}`);
      datasets[pair] = await response.json();
    }
    if (version !== loadVersion) return;
    candles = datasets[pair];
    if (!Array.isArray(candles) || candles.length < 22) throw new Error(`Недостаточно дневных свечей ${pair}`);
    applyPair(pair);
    updateDates(previousMax);
    $('data-error').hidden = true;
    set('data-status', `Данные до ${dateText(candles.at(-1)[0])} · проверяем новые свечи…`);
    calculate();
    await refreshLive(pair, version);
  } catch (err) {
    if (version !== loadVersion) return;
    showError(err.message);
    set('data-status', 'Данные недоступны');
  }
}

function applyPair(pair){
  set('market-symbol', pair);
  set('benchmark-title', `Удержание ${pair.slice(0,3)}`);
  set('comparison-title', `Сравнение с ${pair.slice(0,3)}`);
  set('footer-symbol', pair);
  $('source-link').href = `https://data.binance.vision/?prefix=data/spot/daily/klines/${pair}/1d/`;
  $('equity-chart').setAttribute('aria-label', `График капитала стратегии и удержания ${pair.slice(0,3)}`);
  document.title = `${pair} · SMA 20`;
}

function updateDates(previousMax){
  const latest = candles.at(-1)[0];
  $('to').max = latest;
  $('from').max = latest;
  if (!$('from').value) $('from').value = '2022-01-01';
  if (!$('to').value || $('to').value === previousMax || $('to').value > latest) $('to').value = latest;
}

async function refreshLive(pair, version){
  const today = new Date().toISOString().slice(0,10);
  const cutoff = Date.parse(`${today}T00:00:00Z`);
  const base = datasets[pair];
  let cursor = Date.parse(`${base.at(-1)[0]}T00:00:00Z`) - 2 * 86400000;
  const updates = new Map();
  try {
    while (cursor < cutoff) {
      const query = new URLSearchParams({symbol:pair, interval:'1d', startTime:String(cursor), endTime:String(cutoff-1), limit:'1000'});
      const response = await fetch(`https://data-api.binance.vision/api/v3/klines?${query}`, {cache:'no-store'});
      if (!response.ok) throw new Error('Источник новых свечей временно недоступен');
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('Некорректный ответ источника свечей');
      if (!rows.length) break;
      for (const row of rows) {
        const opened = Number(row[0]);
        const values = [1,2,3,4].map(index => Number(row[index]));
        if (!Number.isFinite(opened) || opened >= cutoff || values.some(value => !Number.isFinite(value) || value <= 0)) continue;
        updates.set(new Date(opened).toISOString().slice(0,10), [new Date(opened).toISOString().slice(0,10), ...values]);
      }
      const next = Number(rows.at(-1)[0]) + 86400000;
      if (next <= cursor) throw new Error('Не удалось продолжить загрузку свечей');
      cursor = next;
    }
    if (version !== loadVersion || $('pair').value !== pair) return;
    const previousMax = base.at(-1)[0];
    const merged = new Map(base.map(row => [row[0],row]));
    for (const [date,row] of updates) merged.set(date,row);
    datasets[pair] = [...merged.values()].filter(row => row[0] < today).sort((a,b) => a[0].localeCompare(b[0]));
    candles = datasets[pair];
    updateDates(previousMax);
    calculate();
    set('data-status', `Обновлено до ${dateText(candles.at(-1)[0])} · закрытые дни UTC`);
  } catch (err) {
    if (version === loadVersion && $('pair').value === pair) set('data-status', `Данные до ${dateText(base.at(-1)[0])} · новые свечи пока недоступны`);
  }
}

setInterval(() => {
  if (!$('dashboard').hidden && candles.length) refreshLive($('pair').value, loadVersion);
}, 60 * 60 * 1000);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !$('dashboard').hidden && candles.length) refreshLive($('pair').value, loadVersion);
});

function calculate(){
  if (!candles.length) return;
  const from = $('from').value, to = $('to').value;
  if (!from || !to || from > to) { showError('Выберите корректный период теста.'); return; }
  const numbers = [
    ['deposit', 'депозит', 0, Infinity, false],
    ['trade-size', 'сумму сделки', 0, Infinity, false],
    ['take-profit', 'TP', 0, 500, false],
    ['stop-loss', 'SL', 0, 100, false],
    ['max-candles', 'число свечей', 0, 10000, true],
    ['fee-rate', 'комиссию', 0, 10, true]
  ];
  const values = {};
  for (const [id, label, min, max, allowZero] of numbers) {
    const input = $(id), value = Number(input.value);
    if (input.value === '' || !Number.isFinite(value) || (allowZero ? value < min : value <= min) || value > max || (id === 'stop-loss' && value >= 100) || (id === 'max-candles' && !Number.isInteger(value))) {
      showError(`Проверьте поле «${label}».`); input.focus(); return;
    }
    values[id] = value;
  }
  const deposit = values.deposit, tradeSize = values['trade-size'];
  const tpRate = values['take-profit']/100, slRate = values['stop-loss']/100;
  const maxCandles = values['max-candles'], feeRate = values['fee-rate']/100;
  const first = candles.findIndex(c => c[0] >= from);
  const last = candles.findLastIndex(c => c[0] <= to);
  if (first < 21 || last <= first) { showError('Для периода нужны хотя бы два дня и 21 предыдущая свеча.'); return; }
  $('data-error').hidden = true;
  const sma = candles.map((_,i) => i < 20 ? null : candles.slice(i-20,i).reduce((sum,c)=>sum+c[4],0)/20);
  const result = runStrategy(candles, sma, first, last, {deposit, tradeSize, tpRate, slRate, maxCandles, feeRate});
  trades = result.trades; openTrade = result.openTrade;
  const equity = result.equity, finalEquity = equity.at(-1);
  const startClose=candles[first][4], endClose=candles[last][4];
  const holdNotional=deposit/(1+feeRate);
  const hold=candles.slice(first,last+1).map(c=>{
    const liquidationValue=holdNotional*c[4]/startClose;
    return liquidationValue*(1-feeRate);
  });
  let peak=deposit, drawdown=0;
  for(const value of hold){peak=Math.max(peak,value);drawdown=Math.min(drawdown,value/peak-1);}
  const holdFinal=hold.at(-1);
  const wins=trades.filter(t=>t.pnl>0).length, losses=trades.filter(t=>t.pnl<0).length;
  const avg=trades.length ? trades.reduce((s,t)=>s+t.ret,0)/trades.length : 0;
  const totalFees=trades.reduce((s,t)=>s+t.fees,0)+(openTrade?.fees||0);
  set('final-equity',money(finalEquity));
  set('strategy-return',`${pct(finalEquity/deposit-1)} · ${money(finalEquity-deposit)}`);
  $('strategy-return').classList.toggle('negative',finalEquity<deposit);
  set('equity-note',`Старт ${money(deposit)}${openTrade?' · 1 открытая позиция':''}`);
  set('trade-count',String(trades.length));
  set('win-loss',`${wins} прибыльных / ${losses} убыточных${openTrade?' · 1 открыта':''}`);
  set('avg-return',trades.length?pct(avg):'—'); $('avg-return').classList.toggle('negative',avg<0);
  set('hold-equity',money(holdFinal));
  set('hold-return',pct(holdFinal/deposit-1)); $('hold-return').classList.toggle('negative',holdFinal<deposit);
  set('buy-price',price(startClose)); set('end-price',price(endClose));
  set('hold-pnl',money(holdFinal-deposit)); $('hold-pnl').classList.toggle('negative',holdFinal<deposit);
  set('hold-dd',`${(drawdown*100).toFixed(2)}%`); $('hold-dd').classList.add('negative');
  const strategyReturn = finalEquity/deposit-1;
  const holdReturn = holdFinal/deposit-1;
  const gap = strategyReturn-holdReturn;
  set('conclusion-strategy', `Капитал изменился на ${pct(strategyReturn)}: с ${money(deposit)} до ${money(finalEquity)}. Завершенных сделок: ${trades.length}; уплачено комиссий: ${money(totalFees)}.${openTrade?' Одна позиция остается открытой и оценена по последнему закрытию.':''}`);
  const comparison = gap > 0
    ? `Стратегия опередила покупку и удержание ${$('pair').value.slice(0,3)} на ${Math.abs(gap*100).toFixed(2)} п.п. (${money(Math.abs(finalEquity-holdFinal))}).`
    : gap < 0
      ? `Стратегия уступила покупке и удержанию ${$('pair').value.slice(0,3)} на ${Math.abs(gap*100).toFixed(2)} п.п. (${money(Math.abs(finalEquity-holdFinal))}).`
      : `Стратегия и удержание ${$('pair').value.slice(0,3)} дали одинаковый результат.`;
  set('conclusion-benchmark', `${comparison} Результат удержания — ${pct(holdReturn)}.`);
  set('conclusion-risk', trades.length
    ? `Прибыльных сделок — ${wins} из ${trades.length} (${(wins/trades.length*100).toFixed(1)}%), средняя доходность сделки — ${pct(avg)}. Максимальная просадка удержания ${$('pair').value.slice(0,3)} — ${Math.abs(drawdown*100).toFixed(2)}%.`
    : `Доля прибыльных сделок пока не определяется. Максимальная просадка удержания ${$('pair').value.slice(0,3)} за период — ${Math.abs(drawdown*100).toFixed(2)}%.`);
  set('chart-start',dateText(candles[first][0])); set('chart-end',dateText(candles[last][0]));
  set('trades-summary',`${trades.length} завершено${openTrade?' · 1 открыта':''} · ${wins} прибыльных · ${losses} убыточных · комиссии ${money(totalFees)}`);
  renderChart(equity,hold,trades,openTrade,first,tradeSize);
  set('chart-trade-detail','Наведите или нажмите на отметку сделки, чтобы увидеть детали.');
  page=0; renderTrades();
}

function runStrategy(candles, sma, first, last, params){
  const {deposit, tradeSize, tpRate, slRate, maxCandles, feeRate}=params;
  const equity=[], completed=[];
  let cash=deposit, position=null;
  for(let i=first;i<=last;i++){
    const candle=candles[i];
    let closedToday=false;
    if(position && i>position.entryIndex){
      const take=position.entry*(1+position.sign*tpRate);
      const stop=position.entry*(1-position.sign*slRate);
      const hitStop=position.sign===1 ? candle[3]<=stop : candle[2]>=stop;
      const hitTake=position.sign===1 ? candle[2]>=take : candle[3]<=take;
      const timedOut=maxCandles>0 && i-position.entryIndex>=maxCandles;
      if(hitStop || hitTake || timedOut){
        const exitPrice=hitStop?stop:hitTake?take:candle[4];
        const reason=hitStop?'Стоп':hitTake?'Тейк':'По времени';
        const exitFee=tradeSize*(exitPrice/position.entry)*feeRate;
        const grossPnl=tradeSize*position.sign*(exitPrice/position.entry-1);
        const fees=position.entryFee+exitFee;
        const pnl=grossPnl-fees;
        cash+=grossPnl-exitFee;
        completed.push({...position,exitIndex:i,exitDate:candle[0],exitPrice,reason,fees,pnl,ret:pnl/tradeSize});
        position=null; closedToday=true;
      }
    }
    if(!position && !closedToday && i>=21){
      const previous=candles[i-1][4]-sma[i-1];
      const current=candle[4]-sma[i];
      const direction=previous<0 && current>0?'long':previous>0 && current<0?'short':null;
      if(direction){
        const entryFee=tradeSize*feeRate;
        cash-=entryFee;
        position={direction,sign:direction==='long'?1:-1,entryIndex:i,entryDate:candle[0],entry:candle[4],entryFee};
      }
    }
    equity.push(position?cash+tradeSize*position.sign*(candle[4]/position.entry-1):cash);
  }
  const lastClose=candles[last][4];
  const openTrade=position?{...position,fees:position.entryFee,pnl:tradeSize*position.sign*(lastClose/position.entry-1)-position.entryFee,ret:position.sign*(lastClose/position.entry-1)-feeRate}:null;
  return {equity,trades:completed,openTrade};
}

function set(id,value){$(id).textContent=value;}
function showError(message){$('data-error').hidden=false;$('data-error').textContent=message;}
function renderTrades(){
  const all=openTrade?[...trades,openTrade]:trades;
  const shown=all.slice(page*pageSize,(page+1)*pageSize);
  $('trades-body').innerHTML=shown.length ? shown.map((t,k)=>`<tr><td>${page*pageSize+k+1}</td><td><span class="direction ${t.direction}">${t.direction==='long'?'ЛОНГ':'ШОРТ'}</span></td><td>${dateText(t.entryDate)}</td><td>${price(t.entry)}</td><td>${t.exitDate?dateText(t.exitDate):'—'}</td><td>${t.exitPrice?price(t.exitPrice):'—'}</td><td>${t.reason||'Открыта'}</td><td>${price(t.fees)}</td><td class="${t.pnl>=0?'profit':'loss'}">${t.exitDate?'':'Оценка · '}${pct(t.ret)}<br>${money(t.pnl)}</td></tr>`).join('') : '<tr><td colspan="9" class="empty-row">В выбранном периоде нет сделок</td></tr>';
  $('page-label').textContent=`${Math.min(page+1,Math.max(1,Math.ceil(all.length/pageSize)))} / ${Math.max(1,Math.ceil(all.length/pageSize))}`;
  $('prev-page').disabled=page===0; $('next-page').disabled=(page+1)*pageSize>=all.length;
}
function renderChart(strategy,hold,completed,open,first,tradeSize){
  const svg=$('equity-chart'), all=[...strategy,...hold], min=Math.min(...all), max=Math.max(...all), range=Math.max(1,max-min);
  const y=v=>270-(v-min)/range*235;
  const x=i=>45+i/(strategy.length-1)*840;
  const path=arr=>arr.map((v,i)=>`${i?'L':'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  let grid='';
  for(let i=0;i<5;i++){const yy=35+i*58.75, val=max-i*range/4;grid+=`<line x1="45" y1="${yy}" x2="885" y2="${yy}" stroke="#e9eef0"/><text x="0" y="${yy+4}" fill="#97a5ac" font-size="11">${Math.round(val/1000)}k</text>`;}
  const escapeXml=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const marker=(index,value,color,label,offset)=>`<line x1="${x(index-first).toFixed(2)}" x2="${x(index-first).toFixed(2)}" y1="${y(value).toFixed(2)}" y2="${(y(value)+offset).toFixed(2)}" stroke="${color}" stroke-width="1"/><circle cx="${x(index-first).toFixed(2)}" cy="${(y(value)+offset).toFixed(2)}" r="5.5" fill="${color}" stroke="#fff" stroke-width="1.2" tabindex="0" data-label="${escapeXml(label)}" aria-label="${escapeXml(label)}"><title>${escapeXml(label)}</title></circle>`;
  let markers='';
  for(const trade of completed){
    const direction=trade.direction==='long'?'Лонг':'Шорт';
    markers+=marker(trade.entryIndex,strategy[trade.entryIndex-first],'#1f846d',`${direction}: вход ${dateText(trade.entryDate)} по ${price(trade.entry)}`,-8);
    markers+=marker(trade.exitIndex,strategy[trade.exitIndex-first],'#d9804d',`${direction}: выход ${dateText(trade.exitDate)} по ${price(trade.exitPrice)}, результат ${money(trade.pnl)}`,8);
  }
  if(open){
    markers+=marker(open.entryIndex,strategy[open.entryIndex-first],'#1f846d',`${open.direction==='long'?'Лонг':'Шорт'}: вход ${dateText(open.entryDate)} по ${price(open.entry)}, позиция открыта`,-8);
    markers+=marker(first+strategy.length-1,strategy.at(-1),'#e3af4e',`Открытая позиция: текущая оценка ${money(open.pnl)} при номинале ${money(tradeSize)}`,8);
  }
  svg.innerHTML=`${grid}<path d="${path(hold)}" fill="none" stroke="#7eabc1" stroke-width="2.5" vector-effect="non-scaling-stroke"/><path d="${path(strategy)}" fill="none" stroke="#2fbb88" stroke-width="3" vector-effect="non-scaling-stroke"/>${markers}`;
}

if (document.modelContext?.registerTool) {
  try {
    Promise.resolve(document.modelContext.registerTool({
      name:'set_backtest_period',
      title:'Выбрать период теста',
      description:'Установить даты начала и завершения и пересчитать видимый отчет стратегии SMA 20.',
      inputSchema:{type:'object',properties:{from:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'},to:{type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}$'}},required:['from','to'],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      async execute(input){
        if (!input || typeof input.from!=='string' || typeof input.to!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.from) || !/^\d{4}-\d{2}-\d{2}$/.test(input.to) || input.from>input.to || input.from<'2022-01-01' || input.to>candles.at(-1)?.[0]) throw new Error('Некорректный период');
        if ($('dashboard').hidden) throw new Error('Сначала войдите в прототип');
        $('from').value=input.from; $('to').value=input.to; calculate();
        if (!$('data-error').hidden) throw new Error($('data-error').textContent);
        return {from:input.from,to:input.to,trades:trades.length,deposit:$('final-equity').textContent};
      }
    })).catch(()=>{});
  } catch (_) {}
}
