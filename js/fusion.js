// Fusion stereo control + state.
// Reads/controls a Fusion marine stereo over NMEA 2000 via the
// signalk-fusion-stereo plugin, which exposes entertainment.device.<id>.* paths.
// In demo mode the state is simulated locally (and mirrored into the store so the
// Entertainment tab reads it the same way as live data). In live mode, controls
// send Signal K PUT requests.

import { store } from './state.js';
import { settings, signalkHttpBase } from './config.js';

// Audio sources offered on the Entertainment tab.
export const SOURCES = ['AM', 'FM', 'Bluetooth', 'CD', 'AUX', 'DVD'];

// Demo "now playing" content per source.
const TRACKS = {
  AM: { name: 'ABC Radio', artist: '693 kHz', album: '' },
  FM: { name: 'Triple J', artist: '107.7 MHz', album: '' },
  Bluetooth: { name: 'Ocean Eyes', artist: 'Billie Eilish', album: 'When We All Fall Asleep' },
  CD: { name: 'Dreams', artist: 'Fleetwood Mac', album: 'Rumours' },
  AUX: { name: 'Aux Input', artist: 'Line-in', album: '' },
  DVD: { name: 'Now Playing', artist: 'DVD', album: '' },
};

const demo = { state: 'playing', source: 'FM', volume: 0.35, muted: false };
const listeners = new Set();

export function onFusionChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  for (const cb of listeners) { try { cb(); } catch (e) { console.error(e); } }
}

function base() { return `entertainment.device.${settings.fusion?.deviceId || 'fusion1'}`; }
function zone() { return settings.fusion?.zone || 'zone1'; }

// Mirror the demo state into the store (called by the mock each tick and on any
// control action, so the UI updates instantly).
export function applyFusionDemo() {
  const b = base();
  const z = zone();
  const t = TRACKS[demo.source] || { name: '', artist: '', album: '' };
  const meta = { timestamp: Date.now(), source: 'demo' };
  store.set(`${b}.state`, demo.state, meta);
  store.set(`${b}.avsource`, demo.source, meta);
  store.set(`${b}.output.${z}.volume.master`, demo.volume, meta);
  store.set(`${b}.output.${z}.isMuted`, demo.muted, meta);
  store.set(`${b}.track.name`, t.name, meta);
  store.set(`${b}.track.artist`, t.artist, meta);
  store.set(`${b}.track.album`, t.album, meta);
}

// Read current state (works for both demo and live — both land in the store).
export function readFusion() {
  const b = base();
  const z = zone();
  let source = store.get(`${b}.avsource`);
  // Live avsource can be a source path; resolve to its friendly name if present.
  if (typeof source === 'string' && source.includes('.source.')) {
    const nm = store.get(`${source}.name`);
    if (nm) source = nm;
  }
  return {
    state: store.get(`${b}.state`),
    source,
    volume: store.get(`${b}.output.${z}.volume.master`),
    muted: store.get(`${b}.output.${z}.isMuted`),
    name: store.get(`${b}.track.name`),
    artist: store.get(`${b}.track.artist`),
    album: store.get(`${b}.track.album`),
  };
}

async function put(pathSuffix, value) {
  const root = base().replace(/\./g, '/');
  const url = `${signalkHttpBase()}/signalk/v1/api/vessels/self/${root}/${pathSuffix}`;
  const r = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value }),
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
}

export async function setSource(src) {
  if (settings.demoMode) {
    demo.source = src;
    demo.state = 'playing';
    applyFusionDemo();
    emit();
    return { ok: true };
  }
  try { await put('avsource', src); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e) }; }
}

export async function setState(playing) {
  if (settings.demoMode) {
    demo.state = playing ? 'playing' : 'paused';
    applyFusionDemo();
    emit();
    return { ok: true };
  }
  try { await put('state', playing ? 'playing' : 'paused'); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e) }; }
}

export async function setVolume(v) {
  v = Math.max(0, Math.min(1, v));
  if (settings.demoMode) {
    demo.volume = v;
    demo.muted = false;
    applyFusionDemo();
    emit();
    return { ok: true };
  }
  try { await put(`output/${zone()}/volume/master`, v); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e) }; }
}

export async function toggleMute() {
  if (settings.demoMode) {
    demo.muted = !demo.muted;
    applyFusionDemo();
    emit();
    return { ok: true };
  }
  const cur = store.get(`${base()}.output.${zone()}.isMuted`);
  try { await put(`output/${zone()}/isMuted`, !cur); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e) }; }
}

export async function nextTrack() { return sendCmd('next'); }
export async function prevTrack() { return sendCmd('prev'); }

async function sendCmd(cmd) {
  if (settings.demoMode) { applyFusionDemo(); emit(); return { ok: true }; }
  try { await put(cmd, 1); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e) }; }
}
