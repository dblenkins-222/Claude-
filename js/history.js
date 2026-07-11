// Power history recorder.
// Samples 12 VDC and 240 VAC consumption/production once a minute into rolling
// 24-hour buffers, so the Electrical tab can draw last-24h line graphs.
//   - Live mode: real samples, persisted to localStorage (survives reloads).
//   - Demo mode: a realistic 24h is pre-seeded so the graphs look populated,
//     then live demo samples are appended (not persisted).
//
// Metrics (watts):
//   dcCons  12 VDC consumption  = battery discharge power
//   dcProd  12 VDC production   = battery charge power (from charger/alternator)
//   acCons  240 VAC consumption = electrical.ac.consumption.power
//   acProd  240 VAC production  = electrical.ac.input.power (shore / generator)

import { store } from './state.js';
import { settings } from './config.js';

const SAMPLE_MS = 60 * 1000;
const WINDOW_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = 'boatmonitor.history.v1';
const METRICS = ['dcCons', 'dcProd', 'acCons', 'acProd'];

let buffers = emptyBuffers();
let timer = null;
let started = false;
const listeners = new Set();

function emptyBuffers() {
  return { dcCons: [], dcProd: [], acCons: [], acProd: [] };
}

export function onHistoryChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  for (const cb of listeners) { try { cb(); } catch (e) { console.error(e); } }
}

export function getSeries(metric) {
  return buffers[metric] || [];
}

// Signed DC power (W): positive = charging (production), negative = discharge.
function dcPower() {
  const id = settings.dcSystem?.shuntId || 'house';
  let p = store.get(`electrical.batteries.${id}.power`);
  if (p == null) {
    const v = store.get(`electrical.batteries.${id}.voltage`);
    const i = store.get(`electrical.batteries.${id}.current`);
    if (v != null && i != null) p = v * i;
  }
  return p;
}

function readMetric(m) {
  const dischargeNeg = settings.dcSystem?.dischargeNegative !== false;
  if (m === 'dcCons') { const p = dcPower(); return p == null ? null : (dischargeNeg ? Math.max(0, -p) : Math.max(0, p)); }
  if (m === 'dcProd') { const p = dcPower(); return p == null ? null : (dischargeNeg ? Math.max(0, p) : Math.max(0, -p)); }
  if (m === 'acCons') { const v = store.get('electrical.ac.consumption.power'); return v == null ? null : Math.max(0, v); }
  if (m === 'acProd') { const v = store.get('electrical.ac.input.power'); return v == null ? null : Math.max(0, v); }
  return null;
}

function prune(now) {
  const cutoff = now - WINDOW_MS;
  for (const m of METRICS) {
    const b = buffers[m];
    let i = 0;
    while (i < b.length && b[i][0] < cutoff) i++;
    if (i > 0) buffers[m] = b.slice(i);
  }
}

function sample() {
  const now = Date.now();
  for (const m of METRICS) {
    const v = readMetric(m);
    if (v != null) buffers[m].push([now, Math.round(v)]);
  }
  prune(now);
  if (!settings.demoMode) save();
  emit();
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(buffers)); } catch { /* ignore */ }
}

function load() {
  buffers = emptyBuffers();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const o = JSON.parse(raw);
      for (const m of METRICS) if (Array.isArray(o[m])) buffers[m] = o[m];
      prune(Date.now());
    }
  } catch { buffers = emptyBuffers(); }
}

// Synthetic but plausible 24h backfill for demo mode.
function seed() {
  buffers = emptyBuffers();
  const now = Date.now();
  for (let t = now - WINDOW_MS; t <= now; t += SAMPLE_MS) {
    const d = new Date(t);
    const h = d.getHours() + d.getMinutes() / 60;
    const day = 0.5 + 0.5 * Math.sin((h - 8) / 24 * 2 * Math.PI);
    const rnd = (a) => (Math.random() - 0.5) * a;
    const genset = (h > 6 && h < 9) || (h > 17 && h < 20);
    const dcCons = Math.max(0, 220 + 160 * day + rnd(80));
    const dcProd = Math.max(0, genset ? 480 + rnd(220) : (Math.random() < 0.12 ? 120 + rnd(120) : 0));
    const acCons = Math.max(0, 400 + 750 * day + rnd(300));
    const acProd = (h > 6 && h < 22) ? Math.max(0, acCons + 160 + rnd(180)) : Math.max(0, rnd(60));
    buffers.dcCons.push([t, Math.round(dcCons)]);
    buffers.dcProd.push([t, Math.round(dcProd)]);
    buffers.acCons.push([t, Math.round(acCons)]);
    buffers.acProd.push([t, Math.round(acProd)]);
  }
}

// Load persisted (live) or seed synthetic (demo) for the current mode.
export function configureForMode() {
  if (settings.demoMode) seed(); else load();
  emit();
}

export function startHistory() {
  if (started) return;
  started = true;
  configureForMode();
  timer = setInterval(sample, SAMPLE_MS);
}

export function resetHistoryForMode() {
  configureForMode();
}
