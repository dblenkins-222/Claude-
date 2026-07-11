// Electrical tab.
// Consolidates the boat's power systems into one view:
//   - House battery / Victron SmartShunt overview
//   - 12 VDC loads (calculated from the SmartShunt)
//   - 240 VAC loads
//   - Generator (moved here from the dashboard) with a Start / Stop button
//
// Has its own rAF-throttled render loop, mirroring dashboard.js.

import { store } from './state.js';
import { settings } from './config.js';
import * as U from './units.js';
import { createLevelBar } from './widgets.js';
import { commandGenerator, onGenControlChange, getLastMessage } from './gencontrol.js';
import { getSeries, onHistoryChange } from './history.js';

const STALE_MS = 8000;
const NS = 'http://www.w3.org/2000/svg';
const renderers = [];
let built = false;
let chartRefs = {}; // 'dc'|'ac' -> { wrap, svg, consNow, prodNow }
let chartsWired = false;

export function initElectrical() {
  if (built) return;
  built = true;
  const root = document.getElementById('electrical-content');
  buildAll(root);

  let queued = false;
  store.subscribe(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderAll(); });
  });
  onGenControlChange(renderAll);
  // Redraw the 24h charts when new samples arrive, on resize, and on show.
  if (!chartsWired) {
    chartsWired = true;
    onHistoryChange(renderCharts);
    window.addEventListener('resize', renderCharts);
  }
  renderAll();
  renderCharts();
}

// Rebuild when the electrical/generator config changes.
export function rebuildElectrical() {
  if (!built) return;
  renderers.length = 0;
  buildAll(document.getElementById('electrical-content'));
  renderAll();
  renderCharts();
}

export function onElectricalShown() {
  renderAll();
  renderCharts();
}

function renderAll() {
  for (const r of renderers) r();
}

function buildAll(root) {
  root.innerHTML = '';
  root.appendChild(buildBatterySection('House Battery Bank', settings.dcSystem.shuntId || 'house', { timeRemaining: true }));
  root.appendChild(buildBatterySection('Crank Battery Bank', settings.dcSystem.crankShuntId || 'starter', { timeRemaining: false }));
  root.appendChild(buildSolarSection());
  root.appendChild(buildDcLoadsSection());
  root.appendChild(buildPowerChartSection('dc', '12 VDC Power \u2014 last 24 h'));
  root.appendChild(buildAcLoadsSection());
  root.appendChild(buildPowerChartSection('ac', '240 VAC Power \u2014 last 24 h'));
  if (settings.generator && settings.generator.id) {
    root.appendChild(buildGeneratorSection(settings.generator));
  }
}

// ---- local helpers (mirror dashboard.js) ----------------------------------
function section(title, className = '') {
  const sec = document.createElement('section');
  sec.className = 'panel ' + className;
  const h = document.createElement('h2');
  h.textContent = title;
  sec.appendChild(h);
  const body = document.createElement('div');
  body.className = 'panel-body';
  sec.appendChild(body);
  return { sec, body };
}

function tile(body, label, valueFn, paths) {
  const el = document.createElement('div');
  el.className = 'tile';
  const val = document.createElement('div');
  val.className = 'tile-value';
  const unit = document.createElement('div');
  unit.className = 'tile-unit';
  const lab = document.createElement('div');
  lab.className = 'tile-label';
  lab.textContent = label;
  el.appendChild(val);
  el.appendChild(unit);
  el.appendChild(lab);
  body.appendChild(el);

  renderers.push(() => {
    const out = valueFn();
    val.textContent = out.text;
    unit.textContent = out.unit || '';
    el.classList.toggle('tone-warn', out.tone === 'warn');
    el.classList.toggle('tone-crit', out.tone === 'crit');
    const stale = (paths || []).length > 0 &&
      (paths || []).every((p) => store.ageMs(p) > STALE_MS);
    el.classList.toggle('stale', stale);
  });
}

// ---- Battery bank (SmartShunt) — used for both house and crank banks -------
function buildBatterySection(title, shuntId, { timeRemaining = false } = {}) {
  const B = (s) => `electrical.batteries.${shuntId}.${s}`;
  const { sec, body } = section(title, 'elec');

  const socRow = document.createElement('div');
  socRow.className = 'battery-row';
  const socLabel = document.createElement('div');
  socLabel.className = 'battery-soc';
  socLabel.textContent = '--%';
  const bar = createLevelBar();
  socRow.appendChild(socLabel);
  socRow.appendChild(bar.el);
  body.appendChild(socRow);
  renderers.push(() => {
    const soc = U.ratioToPercent(store.get(B('stateOfCharge')));
    socLabel.textContent = soc == null ? '--%' : Math.round(soc) + '%';
    const tone = soc == null ? null : (soc < 20 ? 'crit' : soc < 50 ? 'warn' : 'good');
    bar.update(soc, tone);
  });

  const grid = document.createElement('div');
  grid.className = 'tile-grid';
  body.appendChild(grid);

  tile(grid, 'Voltage', () => ({ text: U.fmt(store.get(B('voltage')), 2), unit: 'V' }), [B('voltage')]);
  tile(grid, 'Current', () => {
    const a = store.get(B('current'));
    return { text: U.fmt(a, 1), unit: 'A' };
  }, [B('current')]);
  tile(grid, 'Power', () => ({ text: U.fmt(store.get(B('power')), 0), unit: 'W' }), [B('power')]);
  if (timeRemaining) {
    tile(grid, 'Time Remaining', () => {
      const s = store.get(B('capacity.timeRemaining'));
      return { text: formatDuration(s), unit: '' };
    }, [B('capacity.timeRemaining')]);
  }

  return sec;
}

// ---- Solar (Victron MPPT) -------------------------------------------------
function buildSolarSection() {
  const sid = settings.dcSystem.solarId || 'pv';
  const S = (s) => `electrical.solar.${sid}.${s}`;
  const { sec, body } = section('Solar · MPPT', 'elec');

  const grid = document.createElement('div');
  grid.className = 'tile-grid';
  body.appendChild(grid);

  tile(grid, 'PV Power', () => ({ text: U.fmt(store.get(S('panelPower')), 0), unit: 'W' }), [S('panelPower')]);
  tile(grid, 'PV Voltage', () => ({ text: U.fmt(store.get(S('panelVoltage')), 1), unit: 'V' }), [S('panelVoltage')]);
  tile(grid, 'Charge Current', () => ({ text: U.fmt(store.get(S('current')), 1), unit: 'A' }), [S('current')]);
  tile(grid, 'Yield Today', () => ({ text: U.fmt(store.get(S('yieldToday')), 2), unit: 'kWh' }), [S('yieldToday')]);

  return sec;
}

// ---- 12 VDC loads (from the SmartShunt) -----------------------------------
function dcLoad() {
  const shuntId = settings.dcSystem.shuntId || 'house';
  const voltage = store.get(`electrical.batteries.${shuntId}.voltage`);
  const current = store.get(`electrical.batteries.${shuntId}.current`);
  if (current == null) return { current: null, power: null, voltage };
  // Discharge (= load) depending on the configured sign convention.
  const discharge = settings.dcSystem.dischargeNegative
    ? Math.max(0, -current)
    : Math.max(0, current);
  const power = voltage != null ? voltage * discharge : null;
  return { current: discharge, power, voltage };
}

function buildDcLoadsSection() {
  const shuntId = settings.dcSystem.shuntId || 'house';
  const { sec, body } = section('12 VDC Loads', 'elec');

  const grid = document.createElement('div');
  grid.className = 'tile-grid';
  body.appendChild(grid);

  tile(grid, 'DC Load', () => ({ text: U.fmt(dcLoad().power, 0), unit: 'W' }),
    [`electrical.batteries.${shuntId}.current`]);
  tile(grid, 'DC Current', () => ({ text: U.fmt(dcLoad().current, 1), unit: 'A' }),
    [`electrical.batteries.${shuntId}.current`]);
  tile(grid, 'Bus Voltage', () => ({ text: U.fmt(dcLoad().voltage, 2), unit: 'V' }),
    [`electrical.batteries.${shuntId}.voltage`]);

  const note = document.createElement('p');
  note.className = 'elec-note';
  note.textContent = 'Load derived from the SmartShunt: bus voltage × discharge current.';
  body.appendChild(note);

  return sec;
}

// ---- 240 VAC loads ---------------------------------------------------------
function buildAcLoadsSection() {
  const AC = (s) => `electrical.ac.consumption.${s}`;
  const nominal = settings.acSystem.nominalVoltage || 240;
  const { sec, body } = section('240 VAC Loads', 'elec');

  const grid = document.createElement('div');
  grid.className = 'tile-grid';
  body.appendChild(grid);

  const acCurrent = () => {
    const c = store.get(AC('current'));
    if (c != null) return c;
    const p = store.get(AC('power'));
    const v = store.get(AC('voltage')) || nominal;
    return p != null && v ? p / v : null;
  };

  tile(grid, 'AC Load', () => ({ text: U.fmt(U.wToKw(store.get(AC('power'))), 2), unit: 'kW' }), [AC('power')]);
  tile(grid, 'AC Voltage', () => {
    const v = store.get(AC('voltage'));
    return { text: U.fmt(v, 0), unit: 'V' };
  }, [AC('voltage')]);
  tile(grid, 'AC Current', () => ({ text: U.fmt(acCurrent(), 1), unit: 'A' }), [AC('current'), AC('power')]);

  return sec;
}

// ---- Generator (moved from dashboard) + Start/Stop -------------------------
function isGenRunning(G) {
  const state = store.get(G('state'));
  if (typeof state === 'string') return /run|on|start/i.test(state);
  if (typeof state === 'boolean') return state;
  const rev = store.get(G('revolutions'));
  if (rev != null) return rev > 1;
  const freq = store.get(G('frequency'));
  return freq != null && freq > 1;
}

function buildGeneratorSection(gen) {
  const gid = gen.id;
  const G = (s) => `electrical.generators.${gid}.${s}`;
  const { sec, body } = section(gen.label || 'Generator', 'generator');
  const isRunning = () => isGenRunning(G);

  // Status + runtime
  const header = document.createElement('div');
  header.className = 'gen-header';
  const pill = document.createElement('span');
  pill.className = 'gen-pill';
  const runtime = document.createElement('div');
  runtime.className = 'gen-runtime';
  header.appendChild(pill);
  header.appendChild(runtime);
  body.appendChild(header);
  renderers.push(() => {
    const running = isRunning();
    pill.textContent = running ? 'RUNNING' : 'STOPPED';
    pill.className = 'gen-pill ' + (running ? 'running' : 'stopped');
    const hrs = U.secondsToHours(store.get(G('runTime')));
    runtime.innerHTML = hrs == null ? ''
      : `<span class="v">${U.fmt(hrs, 1)}</span><span class="l">hrs total</span>`;
  });

  // Load bar
  const loadRow = document.createElement('div');
  loadRow.className = 'gen-load-row';
  const loadLabel = document.createElement('div');
  loadLabel.className = 'gen-load-label';
  loadLabel.textContent = 'Load';
  const loadPct = document.createElement('div');
  loadPct.className = 'gen-load-pct';
  loadPct.textContent = '--%';
  const bar = createLevelBar();
  loadRow.appendChild(loadLabel);
  loadRow.appendChild(bar.el);
  loadRow.appendChild(loadPct);
  body.appendChild(loadRow);
  renderers.push(() => {
    const pct = U.ratioToPercent(store.get(G('load')));
    loadPct.textContent = pct == null ? '--%' : Math.round(pct) + '%';
    const tone = pct == null ? null : (pct > 95 ? 'crit' : pct > 85 ? 'warn' : 'good');
    bar.update(pct, tone);
  });

  const grid = document.createElement('div');
  grid.className = 'tile-grid';
  body.appendChild(grid);

  tile(grid, 'Output Power', () => ({ text: U.fmt(U.wToKw(store.get(G('power'))), 1), unit: 'kW' }), [G('power')]);
  tile(grid, 'AC Voltage', () => {
    const v = store.get(G('voltage'));
    let tone = null;
    if (isRunning() && v != null) {
      const dev = Math.abs(v - gen.nominalVoltage) / gen.nominalVoltage;
      tone = dev > 0.15 ? 'crit' : dev > 0.08 ? 'warn' : null;
    }
    return { text: U.fmt(v, 0), unit: 'V', tone };
  }, [G('voltage')]);
  tile(grid, 'Frequency', () => {
    const f = store.get(G('frequency'));
    let tone = null;
    if (isRunning() && f != null) {
      const dev = Math.abs(f - gen.nominalFrequency);
      tone = dev > 3 ? 'crit' : dev > 1.5 ? 'warn' : null;
    }
    return { text: U.fmt(f, 1), unit: 'Hz', tone };
  }, [G('frequency')]);
  tile(grid, 'Coolant Temp', () => {
    const k = store.get(G('temperature'));
    const c = U.kelvinToCelsius(k);
    const v = settings.tempUnit === 'F' ? U.kelvinToFahrenheit(k) : c;
    const tone = isRunning() && c != null ? (c > 100 ? 'crit' : c > 95 ? 'warn' : null) : null;
    return { text: U.fmt(v, 0), unit: '°' + settings.tempUnit, tone };
  }, [G('temperature')]);
  tile(grid, 'Oil Pressure', () => {
    const b = U.paToBar(store.get(G('oilPressure')));
    const tone = isRunning() && b != null ? (b < 1.0 ? 'crit' : b < 1.5 ? 'warn' : null) : null;
    return { text: U.fmt(b, 1), unit: 'bar', tone };
  }, [G('oilPressure')]);
  tile(grid, 'RPM', () => {
    const rpm = U.hzToRpm(store.get(G('revolutions')));
    return { text: rpm == null ? '--' : Math.round(rpm), unit: 'rpm' };
  }, [G('revolutions')]);

  // Start / Stop control
  const controls = document.createElement('div');
  controls.className = 'gen-controls';
  const btn = document.createElement('button');
  btn.className = 'gen-start-btn';
  const msg = document.createElement('div');
  msg.className = 'gen-control-msg';
  controls.appendChild(btn);
  controls.appendChild(msg);
  body.appendChild(controls);

  btn.addEventListener('click', async () => {
    const running = isRunning();
    const verb = running ? 'STOP' : 'START';
    if (!window.confirm(
      `${verb} ${gen.label}?\n\nMake sure it is safe to ${verb.toLowerCase()} the generator ` +
      `(cooling water, exhaust, and area clear).`)) {
      return;
    }
    btn.disabled = true;
    const res = await commandGenerator(!running);
    btn.disabled = false;
    if (!res.ok) msg.textContent = getLastMessage();
  });

  renderers.push(() => {
    const running = isRunning();
    btn.textContent = running ? '■ Stop Generator' : '▶ Start Generator';
    btn.classList.toggle('running', running);
    const m = getLastMessage();
    if (m) msg.textContent = m;
  });

  return sec;
}

function formatDuration(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '--';
  if (seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h >= 100) return `${h}h`;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}


// ---- 24-hour power line graphs (consumption vs production) ----------------
function buildPowerChartSection(kind, title) {
  const { sec, body } = section(title, 'elec');

  const legend = document.createElement('div');
  legend.className = 'chart-legend';
  legend.innerHTML =
    `<span class="chart-key cons"><i></i>Consumption <b id="chart-${kind}-cons">--</b></span>` +
    `<span class="chart-key prod"><i></i>Production <b id="chart-${kind}-prod">--</b></span>`;
  body.appendChild(legend);

  const wrap = document.createElement('div');
  wrap.className = 'chart-wrap';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'chart-svg');
  wrap.appendChild(svg);
  body.appendChild(wrap);

  chartRefs[kind] = {
    wrap,
    svg,
    consNow: legend.querySelector(`#chart-${kind}-cons`),
    prodNow: legend.querySelector(`#chart-${kind}-prod`),
  };
  return sec;
}

function renderCharts() {
  drawChart('dc', getSeries('dcCons'), getSeries('dcProd'));
  drawChart('ac', getSeries('acCons'), getSeries('acProd'));
}

function linePath(pts) {
  return pts.length ? 'M ' + pts.map((p) => `${p[0]} ${p[1]}`).join(' L ') : '';
}

function fmtW(v) {
  if (v == null) return '--';
  return v >= 1000 ? (v / 1000).toFixed(1) + ' kW' : Math.round(v) + ' W';
}

function drawChart(kind, consSeries, prodSeries) {
  const ref = chartRefs[kind];
  if (!ref) return;
  const { svg, wrap, consNow, prodNow } = ref;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const last = (s) => (s.length ? s[s.length - 1][1] : null);
  consNow.textContent = fmtW(last(consSeries));
  prodNow.textContent = fmtW(last(prodSeries));

  const W = Math.max(320, wrap.clientWidth || 600);
  const H = Math.max(180, wrap.clientHeight || 200);
  const padL = 46, padR = 12, padT = 12, padB = 24;
  const now = Date.now();
  const t0 = now - 24 * 60 * 60 * 1000;

  const vals = [...consSeries, ...prodSeries].filter((p) => p[0] >= t0).map((p) => p[1]);
  let yMax = vals.length ? Math.max(...vals) : 100;
  yMax = Math.max(100, Math.ceil(yMax / 100) * 100);

  const X = (t) => padL + (t - t0) / (now - t0) * (W - padL - padR);
  const Y = (v) => padT + (1 - v / yMax) * (H - padT - padB);

  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);

  const add = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    svg.appendChild(e);
    return e;
  };

  for (let i = 0; i <= 4; i++) {
    const v = yMax * i / 4;
    const y = Y(v);
    add('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'chart-grid' });
    add('text', { x: padL - 6, y: y + 4, class: 'chart-label', 'text-anchor': 'end' }, fmtW(v));
  }

  for (let ms = Math.ceil(t0 / 3.6e6) * 3.6e6; ms <= now; ms += 3.6e6) {
    const d = new Date(ms);
    if (d.getHours() % 6 !== 0) continue;
    const x = X(ms);
    add('line', { x1: x, y1: padT, x2: x, y2: H - padB, class: 'chart-vgrid' });
    add('text', { x, y: H - padB + 15, class: 'chart-label', 'text-anchor': 'middle' },
      String(d.getHours()).padStart(2, '0') + ':00');
  }
  add('text', { x: W - padR, y: padT - 2, class: 'chart-now-label', 'text-anchor': 'end' }, 'now');

  const toPts = (s) => s.filter((p) => p[0] >= t0).map((p) => [X(p[0]), Y(p[1])]);
  const prod = toPts(prodSeries);
  const cons = toPts(consSeries);
  if (prod.length > 1) add('path', { d: linePath(prod), class: 'chart-prod' });
  if (cons.length > 1) add('path', { d: linePath(cons), class: 'chart-cons' });
  if (cons.length < 2 && prod.length < 2) {
    add('text', { x: W / 2, y: H / 2, class: 'chart-empty', 'text-anchor': 'middle' }, 'Building history\u2026');
  }
}
