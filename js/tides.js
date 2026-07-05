// Tide graph view.
// Plots the tidal curve (sea level relative to mean sea level) for the vessel's
// position using Open-Meteo's free Marine API (no key, CORS-enabled). Shows the
// current height, the next high and low tides, and a smooth curve with high/low
// markers and a "now" indicator. Falls back to a coastal demo location when the
// vessel is inland (where there is no tide).
//
// Data: Open-Meteo Marine API (https://open-meteo.com) — sea_level_height_msl.

import { store } from './state.js';
import { settings } from './config.js';
import * as U from './units.js';

const MARINE_API = 'https://marine-api.open-meteo.com/v1/marine';
const REFRESH_MS = 30 * 60 * 1000;
const FALLBACK = { lat: -27.8520, lon: 153.3360, name: 'The Boat Works, Coomera' };
const NS = 'http://www.w3.org/2000/svg';

let initialized = false;
let ui = {};
let series = [];      // [{ t: Date, h: meters }]
let extrema = [];     // [{ t: Date, h: meters, type: 'H' | 'L' }]
let usingFallback = false;
let lastCenter = null;

function boatLatLon() {
  const lat = store.get('navigation.position.latitude');
  const lon = store.get('navigation.position.longitude');
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return [lat, lon];
}

export function initTides() {
  if (initialized) return;
  initialized = true;
  ui = {
    graphWrap: document.getElementById('tide-graph-wrap'),
    svg: document.getElementById('tide-graph'),
    current: document.getElementById('tide-current'),
    nextHigh: document.getElementById('tide-next-high'),
    nextLow: document.getElementById('tide-next-low'),
    note: document.getElementById('tide-note'),
  };
  const c = boatLatLon() || [FALLBACK.lat, FALLBACK.lon];
  loadTides(c[0], c[1]);
  setInterval(() => {
    const cc = boatLatLon() || lastCenter || [FALLBACK.lat, FALLBACK.lon];
    loadTides(cc[0], cc[1]);
  }, REFRESH_MS);
  window.addEventListener('resize', renderGraph);
}

export function onTidesShown() {
  renderGraph();
}

function hUnit() { return settings.depthUnit === 'ft' ? 'ft' : 'm'; }
function toDisp(m) { return m == null ? null : (settings.depthUnit === 'ft' ? U.mToFeet(m) : m); }

async function loadTides(lat, lon) {
  lastCenter = [lat, lon];
  usingFallback = false;
  try {
    let data = await fetchTide(lat, lon);
    if (!data.some((p) => p.h != null)) {
      usingFallback = true;
      data = await fetchTide(FALLBACK.lat, FALLBACK.lon);
    }
    series = data.filter((p) => p.h != null);
    extrema = findExtrema(series);
    if (ui.note) {
      const ns = lat >= 0 ? 'N' : 'S';
      const ew = lon >= 0 ? 'E' : 'W';
      ui.note.textContent = usingFallback
        ? `No tidal data at the vessel position — showing ${FALLBACK.name}. · Open-Meteo Marine`
        : `Tide at ${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew} · Open-Meteo Marine`;
    }
    renderInfo();
    renderGraph();
  } catch (err) {
    console.error('Tide load failed', err);
    if (ui.note) ui.note.textContent = 'Tide data unavailable (offline?).';
  }
}

async function fetchTide(lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    hourly: 'sea_level_height_msl',
    timezone: 'auto',
    past_days: '1',
    forecast_days: '2',
  });
  const r = await fetch(`${MARINE_API}?${p.toString()}`);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const d = await r.json();
  const t = (d.hourly && d.hourly.time) || [];
  const v = (d.hourly && d.hourly.sea_level_height_msl) || [];
  return t.map((iso, i) => ({ t: new Date(iso), h: v[i] }));
}

// Local maxima/minima with quadratic vertex refinement for nicer peak times.
function findExtrema(s) {
  const out = [];
  for (let i = 1; i < s.length - 1; i++) {
    const a = s[i - 1].h, b = s[i].h, c = s[i + 1].h;
    if (a == null || b == null || c == null) continue;
    const isMax = b > a && b >= c;
    const isMin = b < a && b <= c;
    if (!isMax && !isMin) continue;
    const denom = a - 2 * b + c;
    let off = denom !== 0 ? 0.5 * (a - c) / denom : 0;
    off = Math.max(-0.5, Math.min(0.5, off));
    const dt = s[i + 1].t.getTime() - s[i].t.getTime();
    const t = new Date(s[i].t.getTime() + off * dt);
    const h = b - 0.25 * (a - c) * off;
    out.push({ t, h, type: isMax ? 'H' : 'L' });
  }
  return out;
}

function heightAt(date) {
  if (!series.length) return null;
  const ms = date.getTime();
  if (ms <= series[0].t.getTime()) return series[0].h;
  for (let i = 1; i < series.length; i++) {
    if (ms <= series[i].t.getTime()) {
      const t0 = series[i - 1].t.getTime();
      const t1 = series[i].t.getTime();
      const f = (ms - t0) / (t1 - t0);
      return series[i - 1].h + f * (series[i].h - series[i - 1].h);
    }
  }
  return series[series.length - 1].h;
}

function rising(now) {
  const a = heightAt(now);
  const b = heightAt(new Date(now.getTime() + 10 * 60000));
  return a != null && b != null && b >= a;
}

function fmtClock(d) { return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }

function fmtIn(d) {
  const mins = Math.round((d.getTime() - Date.now()) / 60000);
  if (mins < 0) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
}

function card(label, value, sub) {
  return `<span class="tide-card-l">${label}</span>` +
    `<span class="tide-card-v">${value}</span>` +
    `<span class="tide-card-s">${sub || ''}</span>`;
}

function renderInfo() {
  if (!ui.current) return;
  const now = new Date();
  const cur = heightAt(now);
  ui.current.innerHTML = card('Current Height',
    cur == null ? '--' : U.fmt(toDisp(cur), 2) + ' ' + hUnit(),
    cur == null ? '' : (rising(now) ? '▲ rising' : '▼ falling'));

  const nh = extrema.find((e) => e.type === 'H' && e.t.getTime() > now.getTime());
  const nl = extrema.find((e) => e.type === 'L' && e.t.getTime() > now.getTime());
  ui.nextHigh.innerHTML = card('Next High',
    nh ? U.fmt(toDisp(nh.h), 2) + ' ' + hUnit() : '--',
    nh ? `${fmtClock(nh.t)} · ${fmtIn(nh.t)}` : '');
  ui.nextLow.innerHTML = card('Next Low',
    nl ? U.fmt(toDisp(nl.h), 2) + ' ' + hUnit() : '--',
    nl ? `${fmtClock(nl.t)} · ${fmtIn(nl.t)}` : '');
}

function smoothPath(pts) {
  if (pts.length < 2) return '';
  let d = `M ${pts[0][0]} ${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

function renderGraph() {
  const svg = ui.svg;
  const wrap = ui.graphWrap;
  if (!svg || !wrap) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  if (!series.length) return;

  const W = Math.max(320, wrap.clientWidth || 640);
  const H = Math.max(200, wrap.clientHeight || 300);
  const padL = 46, padR = 14, padT = 18, padB = 30;

  const t0 = series[0].t.getTime();
  const tN = series[series.length - 1].t.getTime();
  const hs = series.map((p) => p.h);
  let hMin = Math.min(...hs);
  let hMax = Math.max(...hs);
  const span = (hMax - hMin) || 1;
  hMin -= span * 0.12;
  hMax += span * 0.12;

  const X = (ms) => padL + (ms - t0) / (tN - t0) * (W - padL - padR);
  const Y = (h) => padT + (hMax - h) / (hMax - hMin) * (H - padT - padB);

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

  // Horizontal gridlines + height labels
  const yticks = 4;
  for (let i = 0; i <= yticks; i++) {
    const h = hMin + (hMax - hMin) * i / yticks;
    const y = Y(h);
    add('line', { x1: padL, y1: y, x2: W - padR, y2: y, class: 'tide-grid' });
    add('text', { x: padL - 6, y: y + 4, class: 'tide-ylabel', 'text-anchor': 'end' }, U.fmt(toDisp(h), 1));
  }
  // MSL zero line
  if (0 > hMin && 0 < hMax) {
    add('line', { x1: padL, y1: Y(0), x2: W - padR, y2: Y(0), class: 'tide-zero' });
    add('text', { x: W - padR, y: Y(0) - 4, class: 'tide-zero-label', 'text-anchor': 'end' }, 'MSL');
  }

  // Vertical gridlines every 6h (weekday label at midnight)
  for (let ms = Math.ceil(t0 / 3.6e6) * 3.6e6; ms <= tN; ms += 3.6e6) {
    const d = new Date(ms);
    if (d.getHours() % 6 !== 0) continue;
    const x = X(ms);
    add('line', { x1: x, y1: padT, x2: x, y2: H - padB, class: 'tide-vgrid' });
    const lbl = d.getHours() === 0 ? d.toLocaleDateString([], { weekday: 'short' }) : d.getHours() + ':00';
    add('text', { x: x, y: H - padB + 16, class: 'tide-xlabel', 'text-anchor': 'middle' }, lbl);
  }

  // Curve (area fill + line)
  const pts = series.map((p) => [X(p.t.getTime()), Y(p.h)]);
  const line = smoothPath(pts);
  add('path', { d: `${line} L ${pts[pts.length - 1][0]} ${H - padB} L ${pts[0][0]} ${H - padB} Z`, class: 'tide-area' });
  add('path', { d: line, class: 'tide-line' });

  // High / low markers
  for (const e of extrema) {
    const ms = e.t.getTime();
    if (ms < t0 || ms > tN) continue;
    const x = X(ms);
    const y = Y(e.h);
    add('circle', { cx: x, cy: y, r: 3.5, class: e.type === 'H' ? 'tide-hi' : 'tide-lo' });
    add('text', { x: x, y: e.type === 'H' ? y - 9 : y + 17, class: 'tide-mark', 'text-anchor': 'middle' },
      `${e.type} ${U.fmt(toDisp(e.h), 1)}`);
    add('text', { x: x, y: e.type === 'H' ? y - 21 : y + 29, class: 'tide-mark-t', 'text-anchor': 'middle' },
      fmtClock(e.t));
  }

  // Now line + marker
  const now = Date.now();
  if (now >= t0 && now <= tN) {
    const x = X(now);
    const cur = heightAt(new Date(now));
    add('line', { x1: x, y1: padT, x2: x, y2: H - padB, class: 'tide-now' });
    add('text', { x: x, y: padT - 4, class: 'tide-now-label', 'text-anchor': 'middle' }, 'NOW');
    if (cur != null) add('circle', { cx: x, cy: Y(cur), r: 5, class: 'tide-now-dot' });
  }
}
