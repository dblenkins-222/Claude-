// Weather radar view.
// Renders a Leaflet map centered on the boat's position and animates precipitation
// radar from RainViewer's free public API (no key required). Also overlays
// OpenSeaMap nautical seamarks. Uses the Signal K GPS position (falling back to
// browser geolocation) so it always shows "here".
//
// Data & libraries (attribution):
//   - Map:    Leaflet (https://leafletjs.com)
//   - Tiles:  OpenStreetMap contributors, CARTO basemaps
//   - Radar:  RainViewer (https://www.rainviewer.com) — free public API
//   - Marine: OpenSeaMap (https://www.openseamap.org)

import { store } from './state.js';
import { settings } from './config.js';

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const COLOR_SCHEME = 4;    // RainViewer palette (4 = "The Weather Channel")
const TILE_SIZE = 256;
const SMOOTH = 1;          // smooth the radar image
const SNOW = 1;            // show snow separately
const RADAR_OPACITY = 0.75;
const FRAME_MS = 650;      // time between animation frames
const END_PAUSE_MS = 1400; // pause on the newest frame before looping
const REFRESH_MS = 5 * 60 * 1000; // re-fetch radar frames every 5 min
const DEFAULT_CENTER = [43.6532, -79.3832];
const DEFAULT_ZOOM = 8;

let map = null;
let boatMarker = null;
let radarHost = '';
let frames = [];
let layers = {};           // frame path -> Leaflet tile layer
let idx = 0;
let playing = true;
let animTimer = null;
let followBoat = true;
let initialized = false;
let ui = {};

function boatLatLon() {
  const lat = store.get('navigation.position.latitude');
  const lon = store.get('navigation.position.longitude');
  if (lat == null || lon == null || Number.isNaN(lat) || Number.isNaN(lon)) return null;
  return [lat, lon];
}

function setStatus(msg) {
  if (ui.status) ui.status.textContent = msg || '';
}

// Called the first time the Weather tab is opened.
export async function initWeather() {
  if (initialized) return;
  initialized = true;

  ui = {
    map: document.getElementById('weather-map'),
    play: document.getElementById('wx-play'),
    slider: document.getElementById('wx-slider'),
    time: document.getElementById('wx-time'),
    recenter: document.getElementById('wx-recenter'),
    status: document.getElementById('wx-status'),
  };

  if (typeof L === 'undefined') {
    setStatus('Map library did not load — check the internet connection.');
    return;
  }

  const center = boatLatLon() || (await tryGeolocation()) || DEFAULT_CENTER;
  map = L.map(ui.map, { zoomControl: true, attributionControl: true }).setView(center, DEFAULT_ZOOM);

  // Base map (dark for the night helm, voyager for daylight).
  const dark = settings.theme !== 'light';
  L.tileLayer(`https://{s}.basemaps.cartocdn.com/${dark ? 'dark_all' : 'voyager'}/{z}/{x}/{y}{r}.png`, {
    subdomains: 'abcd',
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
  }).addTo(map);

  // Nautical seamarks overlay.
  L.tileLayer('https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png', {
    maxZoom: 18,
    opacity: 0.9,
    zIndex: 3,
    attribution: '&copy; OpenSeaMap',
  }).addTo(map);

  // Boat marker.
  boatMarker = L.circleMarker(center, {
    radius: 7,
    color: '#38bdf8',
    weight: 3,
    fillColor: '#38bdf8',
    fillOpacity: 0.9,
  }).addTo(map).bindTooltip('Your boat', { direction: 'top', offset: [0, -6] });

  // Manual panning turns off auto-follow until "Center on boat" is tapped.
  map.on('dragstart', () => { followBoat = false; });

  wireControls();
  await loadFrames();
  play();

  store.subscribe((path) => {
    if (path === 'navigation.position.latitude' || path === 'navigation.position.longitude') {
      updateBoat();
    }
  });

  setInterval(refreshFrames, REFRESH_MS);
  map.invalidateSize();
}

// Called every time the Weather tab becomes visible (fixes map sizing and
// re-centers if we're following the boat).
export function onWeatherShown() {
  if (!map) return;
  map.invalidateSize();
  if (followBoat) {
    const c = boatLatLon();
    if (c) map.panTo(c);
  }
}

function frameUrl(f) {
  return `${radarHost}${f.path}/${TILE_SIZE}/{z}/{x}/{y}/${COLOR_SCHEME}/${SMOOTH}_${SNOW}.png`;
}

async function loadFrames() {
  try {
    setStatus('Loading radar…');
    const res = await fetch(RAINVIEWER_API, { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    radarHost = data.host;
    const past = (data.radar && data.radar.past) || [];
    const nowcast = (data.radar && data.radar.nowcast) || [];
    frames = [...past, ...nowcast];

    // Drop any previously created layers.
    for (const k in layers) map.removeLayer(layers[k]);
    layers = {};

    if (!frames.length) {
      setStatus('No radar frames available right now.');
      return;
    }
    ui.slider.max = String(frames.length - 1);
    idx = Math.max(0, past.length - 1); // start on the most recent observed frame
    showFrame(idx);
    setStatus('');
  } catch (err) {
    console.error('RainViewer load failed', err);
    setStatus('Radar unavailable (offline?).');
  }
}

// Refresh keeps the current view; just pulls newer frames.
async function refreshFrames() {
  await loadFrames();
  if (playing) play();
}

function showFrame(i) {
  if (!frames.length) return;
  idx = ((i % frames.length) + frames.length) % frames.length;
  const f = frames[idx];
  if (!layers[f.path]) {
    layers[f.path] = L.tileLayer(frameUrl(f), { opacity: 0, zIndex: 5, tileSize: TILE_SIZE });
    layers[f.path].addTo(map);
  }
  // Show only the active frame; keep the rest loaded but transparent.
  for (const k in layers) layers[k].setOpacity(k === f.path ? RADAR_OPACITY : 0);

  ui.slider.value = String(idx);
  const d = new Date(f.time * 1000);
  const hhmm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const now = Date.now() / 1000;
  const rel = f.time > now + 60 ? ' (forecast)' : (idx === lastPastIndex() ? ' (latest)' : '');
  ui.time.textContent = hhmm + rel;
}

function lastPastIndex() {
  const now = Date.now() / 1000;
  let last = 0;
  frames.forEach((f, i) => { if (f.time <= now + 60) last = i; });
  return last;
}

function scheduleNext() {
  if (!playing) return;
  const atEnd = idx >= frames.length - 1;
  animTimer = setTimeout(() => {
    showFrame(atEnd ? 0 : idx + 1);
    scheduleNext();
  }, atEnd ? END_PAUSE_MS : FRAME_MS);
}

function play() {
  playing = true;
  if (ui.play) ui.play.textContent = '⏸';
  clearTimeout(animTimer);
  scheduleNext();
}

function pause() {
  playing = false;
  if (ui.play) ui.play.textContent = '▶';
  clearTimeout(animTimer);
}

function wireControls() {
  ui.play.addEventListener('click', () => (playing ? pause() : play()));
  ui.slider.addEventListener('input', () => {
    pause();
    showFrame(parseInt(ui.slider.value, 10));
  });
  ui.recenter.addEventListener('click', () => {
    followBoat = true;
    const c = boatLatLon() || DEFAULT_CENTER;
    map.setView(c, Math.max(map.getZoom(), DEFAULT_ZOOM));
  });
}

function updateBoat() {
  const c = boatLatLon();
  if (!c || !boatMarker) return;
  boatMarker.setLatLng(c);
  if (followBoat) map.panTo(c, { animate: true });
}

function tryGeolocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.latitude, pos.coords.longitude]),
      () => resolve(null),
      { timeout: 4000, maximumAge: 60000 },
    );
  });
}
