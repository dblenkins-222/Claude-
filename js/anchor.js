// Anchor watch.
// When an anchor position is "dropped", continuously compares the boat's
// current position against it. If the boat drifts beyond the set radius, the
// watch raises an alarm (visual banner + optional audible beep).

import { store } from './state.js';
import { settings, saveSettings } from './config.js';
import { haversineMeters, bearingDeg } from './units.js';

const listeners = new Set();
let alarmActive = false;
let audioCtx = null;
let beepTimer = null;

// Current computed status snapshot.
let status = {
  set: false,
  distance: null,   // meters from anchor
  bearing: null,    // degrees from anchor to boat
  radius: settings.anchor.radius,
  alarm: false,
};

export function onAnchorChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  for (const cb of listeners) {
    try { cb(status); } catch (err) { console.error('Anchor listener error', err); }
  }
}

export function getAnchorStatus() {
  return status;
}

// Capture the current position as the anchor point.
export function dropAnchor() {
  const lat = store.get('navigation.position.latitude');
  const lon = store.get('navigation.position.longitude');
  if (lat == null || lon == null) {
    return { ok: false, reason: 'No GPS position available yet.' };
  }
  settings.anchor.set = true;
  settings.anchor.latitude = lat;
  settings.anchor.longitude = lon;
  saveSettings();
  // A drop is a user gesture — a good moment to unlock audio on tablets.
  ensureAudio();
  recompute();
  return { ok: true };
}

export function weighAnchor() {
  settings.anchor.set = false;
  settings.anchor.latitude = null;
  settings.anchor.longitude = null;
  saveSettings();
  stopAlarm();
  recompute();
}

export function setRadius(meters) {
  const r = Math.max(5, Math.min(500, Math.round(meters)));
  settings.anchor.radius = r;
  saveSettings();
  recompute();
}

export function setSound(on) {
  settings.anchor.sound = !!on;
  saveSettings();
  if (!on) stopBeep();
  else if (alarmActive) startBeep();
}

// Silence the audible part without weighing anchor (alarm banner stays).
export function acknowledgeAlarm() {
  stopBeep();
}

function recompute() {
  const a = settings.anchor;
  if (!a.set) {
    status = { set: false, distance: null, bearing: null, radius: a.radius, alarm: false };
    stopAlarm();
    emit();
    return;
  }
  const lat = store.get('navigation.position.latitude');
  const lon = store.get('navigation.position.longitude');
  const distance = haversineMeters(a.latitude, a.longitude, lat, lon);
  const bearing = bearingDeg(a.latitude, a.longitude, lat, lon);
  const alarm = distance != null && distance > a.radius;

  status = { set: true, distance, bearing, radius: a.radius, alarm };

  if (alarm && !alarmActive) startAlarm();
  else if (!alarm && alarmActive) stopAlarm();

  emit();
}

function startAlarm() {
  alarmActive = true;
  if (settings.anchor.sound) startBeep();
}

function stopAlarm() {
  alarmActive = false;
  stopBeep();
}

// ---- Audio (WebAudio, no external files) -----------------------------------
function ensureAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch {
    audioCtx = null;
  }
}

function beepOnce() {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.value = 880;
  gain.gain.setValueAtTime(0.001, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.4, audioCtx.currentTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.26);
}

function startBeep() {
  ensureAudio();
  if (!audioCtx || beepTimer) return;
  beepOnce();
  beepTimer = setInterval(beepOnce, 1200);
}

function stopBeep() {
  if (beepTimer) {
    clearInterval(beepTimer);
    beepTimer = null;
  }
}

// Recompute whenever our position changes, and re-run on a timer so the alarm
// keeps sounding even if updates pause.
export function startAnchorWatch() {
  store.subscribe((path) => {
    if (path === 'navigation.position.latitude' || path === 'navigation.position.longitude') {
      recompute();
    }
  });
  setInterval(recompute, 3000);
  recompute();
}
