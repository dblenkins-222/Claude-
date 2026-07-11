// Fusion stereo control + state.
// Reads/controls a Fusion marine stereo over NMEA 2000 via the
// signalk-fusion-stereo plugin, which exposes entertainment.device.<id>.* paths
// including per-zone outputs (output.zone1..zone4). In demo mode the state is
// simulated locally (and mirrored into the store so the Entertainment tab reads
// it the same way as live data). In live mode, controls send Signal K PUTs.

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

const DEMO_SEED_VOL = { zone1: 0.4, zone2: 0.55, zone3: 0.25, zone4: 0.3 };

const demo = { state: 'playing', source: 'FM', zones: {} };
const listeners = new Set();

export function onFusionChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  for (const cb of listeners) { try { cb(); } catch (e) { console.error(e); } }
}

function deviceId() { return settings.fusion?.deviceId || 'fusion1'; }
function base() { return `entertainment.device.${deviceId()}`; }

// Configured zones (those with a non-empty label). Falls back to a single zone
// so older single-zone configs keep working.
export function getZones() {
  const f = settings.fusion || {};
  if (Array.isArray(f.zones)) {
    const z = f.zones.filter((x) => x && x.id && x.label && x.label.trim());
    if (z.length) return z.map((x) => ({ id: x.id, label: x.label.trim() }));
  }
  return [{ id: f.zone || 'zone1', label: 'Main' }];
}

function demoZone(id) {
  if (!demo.zones[id]) demo.zones[id] = { volume: DEMO_SEED_VOL[id] ?? 0.3, muted: false };
  return demo.zones[id];
}

// Mirror the demo state into the store (called by the mock each tick and on any
// control action, so the UI updates instantly).
export function applyFusionDemo() {
  const b = base();
  const t = TRACKS[demo.source] || { name: '', artist: '', album: '' };
  const meta = { timestamp: Date.now(), source: 'demo' };
  store.set(`${b}.state`, demo.state, meta);
  store.set(`${b}.avsource`, demo.source, meta);
  store.set(`${b}.track.name`, t.name, meta);
  store.set(`${b}.track.artist`, t.artist, meta);
  store.set(`${b}.track.album`, t.album, meta);
  for (const z of getZones()) {
    const dz = demoZone(z.id);
    store.set(`${b}.output.${z.id}.volume.master`, dz.volume, meta);
    store.set(`${b}.output.${z.id}.isMuted`, dz.muted, meta);
    store.set(`${b}.output.${z.id}.name`, z.label, meta);
  }
}

// Read current state (works for both demo and live — both land in the store).
export function readFusion() {
  const b = base();
  let source = store.get(`${b}.avsource`);
  if (typeof source === 'string' && source.includes('.source.')) {
    const nm = store.get(`${source}.name`);
    if (nm) source = nm;
  }
  const zones = getZones().map((z) => ({
    id: z.id,
    label: store.get(`${b}.output.${z.id}.name`) || z.label,
    volume: store.get(`${b}.output.${z.id}.volume.master`),
    muted: store.get(`${b}.output.${z.id}.isMuted`),
  }));
  return {
    state: store.get(`${b}.state`),
    source,
    name: store.get(`${b}.track.name`),
    artist: store.get(`${b}.track.artist`),
    album: store.get(`${b}.track.album`),
    zones,
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

export async function setVolume(zoneId, v) {
  v = Math.max(0, Math.min(1, v));
  if (settings.demoMode) {
    const dz = demoZone(zoneId);
    dz.volume = v;
    dz.muted = false;
    applyFusionDemo();
    emit();
    return { ok: true };
  }
  try { await put(`output/${zoneId}/volume/master`, v); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e) }; }
}

export async function toggleMute(zoneId) {
  if (settings.demoMode) {
    const dz = demoZone(zoneId);
    dz.muted = !dz.muted;
    applyFusionDemo();
    emit();
    return { ok: true };
  }
  const cur = store.get(`${base()}.output.${zoneId}.isMuted`);
  try { await put(`output/${zoneId}/isMuted`, !cur); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e) }; }
}

export async function nextTrack() { return sendCmd('next'); }
export async function prevTrack() { return sendCmd('prev'); }

async function sendCmd(cmd) {
  if (settings.demoMode) { applyFusionDemo(); emit(); return { ok: true }; }
  try { await put(cmd, 1); return { ok: true }; }
  catch (e) { return { ok: false, error: String(e) }; }
}
