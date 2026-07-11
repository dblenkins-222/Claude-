// Entertainment tab.
// Controls the Fusion stereo over NMEA 2000 (via the signalk-fusion-stereo
// plugin): current source, now-playing info and play state (unit-wide), plus
// per-zone volume and mute for each speaker zone (Saloon / Cockpit / Flybridge…).
// Works with simulated data in demo mode.

import { store } from './state.js';
import {
  SOURCES, getZones, readFusion, onFusionChange,
  setSource, setState, setVolume, toggleMute, nextTrack, prevTrack,
} from './fusion.js';

let built = false;
let root = null;
let zoneRefs = {};

export function initEntertainment() {
  if (built) return;
  built = true;
  root = document.getElementById('entertainment-content');
  buildUI();

  let queued = false;
  store.subscribe(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; render(); });
  });
  onFusionChange(render);
  render();
}

export function onEntertainmentShown() { render(); }

// Rebuild the zone rows when the Fusion config (zones) changes.
export function rebuildEntertainment() {
  if (!built) return;
  buildZones();
  render();
}

function el(id) { return root.querySelector('#' + id); }

function buildUI() {
  root.innerHTML =
    '<div class="ent-panel">' +
      '<div class="ent-now">' +
        '<div class="ent-source-badge" id="ent-source-badge">--</div>' +
        '<div class="ent-track" id="ent-track">--</div>' +
        '<div class="ent-artist" id="ent-artist"></div>' +
        '<div class="ent-album" id="ent-album"></div>' +
        '<div class="ent-state" id="ent-state"></div>' +
      '</div>' +
      '<div class="ent-transport">' +
        '<button class="ent-btn" id="ent-prev" title="Previous">&#9198;</button>' +
        '<button class="ent-btn ent-play" id="ent-play" title="Play / pause">&#9654;</button>' +
        '<button class="ent-btn" id="ent-next" title="Next">&#9197;</button>' +
      '</div>' +
      '<div class="ent-sources" id="ent-sources"></div>' +
      '<div class="ent-zones-title">Zones</div>' +
      '<div class="ent-zones" id="ent-zones"></div>' +
      '<div class="ent-note" id="ent-note"></div>' +
    '</div>';

  const src = el('ent-sources');
  for (const s of SOURCES) {
    const b = document.createElement('button');
    b.className = 'ent-source';
    b.dataset.source = s;
    b.textContent = s;
    b.addEventListener('click', () => setSource(s));
    src.appendChild(b);
  }

  el('ent-play').addEventListener('click', () => setState(readFusion().state !== 'playing'));
  el('ent-prev').addEventListener('click', () => prevTrack());
  el('ent-next').addEventListener('click', () => nextTrack());

  buildZones();
}

function buildZones() {
  const wrap = el('ent-zones');
  wrap.innerHTML = '';
  zoneRefs = {};
  for (const z of getZones()) {
    const row = document.createElement('div');
    row.className = 'ent-zone';
    row.innerHTML =
      '<span class="ent-zone-name"></span>' +
      '<button class="ent-zbtn" title="Mute">&#128266;</button>' +
      '<input type="range" min="0" max="100" value="0" class="ent-zvol" />' +
      '<span class="ent-zval">--%</span>';
    const name = row.querySelector('.ent-zone-name');
    const mute = row.querySelector('.ent-zbtn');
    const slider = row.querySelector('.ent-zvol');
    const val = row.querySelector('.ent-zval');
    name.textContent = z.label;
    mute.addEventListener('click', () => toggleMute(z.id));
    slider.addEventListener('input', () => { val.textContent = slider.value + '%'; });
    slider.addEventListener('change', () => setVolume(z.id, parseInt(slider.value, 10) / 100));
    wrap.appendChild(row);
    zoneRefs[z.id] = { name, mute, slider, val };
  }
}

function resolveSource(name) {
  if (name == null) return null;
  const n = String(name).toLowerCase();
  for (const s of SOURCES) if (n === s.toLowerCase()) return s;
  const alias = [
    ['bluetooth', 'Bluetooth'], ['bt', 'Bluetooth'], ['dvd', 'DVD'],
    ['aux', 'AUX'], ['line in', 'AUX'], ['cd', 'CD'], ['disc', 'CD'],
    ['fm', 'FM'], ['am', 'AM'],
  ];
  for (const [k, v] of alias) if (n.includes(k)) return v;
  return null;
}

function render() {
  if (!built) return;
  const s = readFusion();
  const hasData = s.state != null || s.name != null || s.zones.some((z) => z.volume != null);
  el('ent-note').textContent = hasData ? ''
    : 'No Fusion data. Connect the stereo on NMEA 2000 and install the signalk-fusion-stereo plugin (set the device id in Settings).';

  const active = resolveSource(s.source);
  el('ent-source-badge').textContent = active || s.source || '--';
  el('ent-track').textContent = s.name || '--';
  el('ent-artist').textContent = s.artist || '';
  el('ent-album').textContent = s.album || '';

  const playing = s.state === 'playing';
  el('ent-state').textContent = s.state ? (playing ? '\u25B6 Playing' : '\u23F8 Paused') : '';
  el('ent-play').innerHTML = playing ? '&#9208;' : '&#9654;';

  root.querySelectorAll('.ent-source').forEach((b) =>
    b.classList.toggle('active', b.dataset.source === active));

  for (const z of s.zones) {
    const r = zoneRefs[z.id];
    if (!r) continue;
    r.name.textContent = z.label;
    const pct = z.volume == null ? null : Math.round(z.volume * 100);
    r.val.textContent = pct == null ? '--%' : (z.muted ? 'Muted' : pct + '%');
    if (document.activeElement !== r.slider && pct != null) r.slider.value = String(pct);
    r.mute.innerHTML = z.muted ? '&#128263;' : '&#128266;';
    r.mute.classList.toggle('muted', !!z.muted);
  }
}
