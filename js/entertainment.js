// Entertainment tab.
// Controls the Fusion stereo over NMEA 2000 (via the signalk-fusion-stereo
// plugin): shows the current source, now-playing info, play state and volume,
// and lets you switch sources (AM / FM / Bluetooth / CD / AUX / DVD) and control
// playback. Works with simulated data in demo mode.

import { store } from './state.js';
import {
  SOURCES, readFusion, onFusionChange,
  setSource, setState, setVolume, toggleMute, nextTrack, prevTrack,
} from './fusion.js';

let built = false;
let root = null;

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
        '<button class="ent-btn" id="ent-mute" title="Mute">&#128266;</button>' +
      '</div>' +
      '<div class="ent-volume">' +
        '<span class="ent-vol-icon">&#128264;</span>' +
        '<input type="range" id="ent-vol" min="0" max="100" value="0" class="ent-vol-slider" />' +
        '<span class="ent-vol-val" id="ent-vol-val">--%</span>' +
      '</div>' +
      '<div class="ent-sources" id="ent-sources"></div>' +
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
  el('ent-mute').addEventListener('click', () => toggleMute());

  const vol = el('ent-vol');
  vol.addEventListener('input', () => { el('ent-vol-val').textContent = vol.value + '%'; });
  vol.addEventListener('change', () => setVolume(parseInt(vol.value, 10) / 100));
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
  const hasData = s.state != null || s.name != null || s.volume != null;
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

  const volPct = s.volume == null ? null : Math.round(s.volume * 100);
  el('ent-vol-val').textContent = volPct == null ? '--%' : (s.muted ? 'Muted' : volPct + '%');
  const vol = el('ent-vol');
  if (document.activeElement !== vol && volPct != null) vol.value = String(volPct);
  el('ent-mute').innerHTML = s.muted ? '&#128263;' : '&#128266;';

  root.querySelectorAll('.ent-source').forEach((b) =>
    b.classList.toggle('active', b.dataset.source === active));
}
