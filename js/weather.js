// Weather radar view.
// Renders a Leaflet map centered on the boat's position and animates precipitation
// radar from RainViewer's free public API (no key required). Also overlays
// OpenSeaMap nautical seamarks. Uses the Signal K GPS position (falling back to
// browser geolocation) so it always shows "here".
//
// Data & libraries (attribution):
//   - Map:    Leaflet (https://leafletjs.com)
//   - Tiles:  OpenStreetMap contributors, CARTO basemaps
//   - Radar:  RainViewer (https://www.rainviewer.com) — free public API, which
//             aggregates national radar including Australia's BOM
//   - Marine: OpenSeaMap (https://www.openseamap.org)
//   - Forecast: Open-Meteo (https://open-meteo.com) — prefers the Australian
//             Bureau of Meteorology ACCESS-G model, falling back to the best
//             available model when ACCESS-G data is unavailable

import { store } from './state.js';
import { settings } from './config.js';
import { degToCompassPoint } from './units.js';

const RAINVIEWER_API = 'https://api.rainviewer.com/public/weather-maps.json';
const COLOR_SCHEME = 4;    // RainViewer palette (4 = "The Weather Channel")
const TILE_SIZE = 256;
const SMOOTH = 1;          // smooth the radar image
const SNOW = 1;            // show snow separately
const RADAR_OPACITY = 0.75;
const FRAME_MS = 650;      // time between animation frames
const END_PAUSE_MS = 1400; // pause on the newest frame before looping
const REFRESH_MS = 5 * 60 * 1000; // re-fetch radar frames every 5 min
const FORECAST_REFRESH_MS = 15 * 60 * 1000; // re-fetch forecast every 15 min
const OM_FORECAST = 'https://api.open-meteo.com/v1/forecast';
const OM_BOM = 'https://api.open-meteo.com/v1/bom'; // Australian BOM ACCESS-G model
const DEFAULT_CENTER = [43.6532, -79.3832];
const DEFAULT_ZOOM = 8;
let lastForecastCenter = null;

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
    today: document.getElementById('wx-today'),
    extended: document.getElementById('wx-extended'),
    place: document.getElementById('wx-fc-place'),
    source: document.getElementById('wx-fc-source'),
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

  // Forecast for the current position, refreshed periodically.
  loadForecast(center[0], center[1]);
  setInterval(() => {
    const c = boatLatLon() || lastForecastCenter;
    if (c) loadForecast(c[0], c[1]);
  }, FORECAST_REFRESH_MS);

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
    loadForecast(c[0], c[1]); // refresh forecast for the new location
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


// ---- Forecast (Open-Meteo, preferring the Australian BOM ACCESS-G model) ---
const DAILY_VARS = [
  'weather_code', 'temperature_2m_max', 'temperature_2m_min', 'precipitation_sum',
  'precipitation_probability_max', 'wind_speed_10m_max', 'wind_gusts_10m_max',
  'wind_direction_10m_dominant', 'uv_index_max', 'sunrise', 'sunset',
].join(',');
const CURRENT_VARS = [
  'temperature_2m', 'relative_humidity_2m', 'apparent_temperature', 'weather_code',
  'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m',
].join(',');

function buildForecastUrl(base, lat, lon) {
  const p = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    timezone: 'auto',
    forecast_days: '7',
    temperature_unit: settings.tempUnit === 'F' ? 'fahrenheit' : 'celsius',
    wind_speed_unit: settings.speedUnit === 'kmh' ? 'kmh' : 'kn',
    precipitation_unit: 'mm',
    current: CURRENT_VARS,
    daily: DAILY_VARS,
  });
  return `${base}?${p.toString()}`;
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

async function loadForecast(lat, lon) {
  lastForecastCenter = [lat, lon];
  if (ui.source) ui.source.textContent = 'Loading forecast…';

  // Reliable base: Open-Meteo best-available model (works worldwide).
  let data;
  try {
    data = await fetchJson(buildForecastUrl(OM_FORECAST, lat, lon));
  } catch (err) {
    console.error('Forecast load failed', err);
    if (ui.today) ui.today.innerHTML = '<div class="wx-fc-empty">Forecast unavailable (offline?).</div>';
    if (ui.extended) ui.extended.innerHTML = '';
    if (ui.source) ui.source.textContent = '';
    return;
  }
  let source = 'Open-Meteo · best available model';

  // Prefer the Australian BOM ACCESS-G model when it has data for this location.
  try {
    const bom = await fetchJson(buildForecastUrl(OM_BOM, lat, lon));
    if (bom && bom.daily && bom.daily.temperature_2m_max
        && bom.daily.temperature_2m_max[0] != null) {
      data.daily = bom.daily;
      data.daily_units = bom.daily_units;
      if (bom.current && bom.current.temperature_2m != null) {
        data.current = bom.current;
        data.current_units = bom.current_units;
      }
      source = 'BOM ACCESS-G (Australia) · via Open-Meteo';
    }
  } catch { /* BOM optional; keep the base forecast */ }

  renderPlace(lat, lon, data);
  renderToday(data);
  renderExtended(data);
  if (ui.source) ui.source.textContent = 'Source: ' + source;
}

function renderPlace(lat, lon, data) {
  if (!ui.place) return;
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'E' : 'W';
  const tz = data.timezone ? ` · ${data.timezone}` : '';
  ui.place.textContent = `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lon).toFixed(2)}°${ew}${tz}`;
}

function renderToday(data) {
  if (!ui.today) return;
  const d = data.daily;
  const du = data.daily_units || {};
  const cur = data.current || {};
  const cu = data.current_units || {};
  const tU = du.temperature_2m_max || '°C';
  const wU = du.wind_speed_10m_max || 'kn';

  const code = cur.weather_code != null ? cur.weather_code : (d.weather_code ? d.weather_code[0] : null);
  const [emoji, desc] = wxInfo(code);
  const nowTemp = cur.temperature_2m != null ? Math.round(cur.temperature_2m) + (cu.temperature_2m || tU)
    : (d.temperature_2m_max ? Math.round(d.temperature_2m_max[0]) + tU : '--');

  const val = (arr, i, dp = 0) => (arr && arr[i] != null ? Number(arr[i]).toFixed(dp) : '--');
  const windDir = d.wind_direction_10m_dominant ? degToCompassPoint(d.wind_direction_10m_dominant[0]) : '';

  ui.today.innerHTML =
    `<div class="wx-now">
       <span class="wx-now-emoji">${emoji}</span>
       <span class="wx-now-temp">${nowTemp}</span>
       <span class="wx-now-desc">${desc}</span>
     </div>
     <div class="wx-fc-grid">
       ${fcCell('High', val(d.temperature_2m_max, 0) + tU)}
       ${fcCell('Low', val(d.temperature_2m_min, 0) + tU)}
       ${fcCell('Feels like', cur.apparent_temperature != null ? Math.round(cur.apparent_temperature) + tU : '--')}
       ${fcCell('Humidity', cur.relative_humidity_2m != null ? Math.round(cur.relative_humidity_2m) + '%' : '--')}
       ${fcCell('Rain', val(d.precipitation_sum, 0, 1) + ' mm')}
       ${fcCell('Chance of rain', val(d.precipitation_probability_max, 0) + '%')}
       ${fcCell('Wind', `${val(d.wind_speed_10m_max, 0)} ${wU} ${windDir}`)}
       ${fcCell('Gusts', val(d.wind_gusts_10m_max, 0) + ' ' + wU)}
       ${fcCell('UV index', val(d.uv_index_max, 0))}
       ${fcCell('Sun', `${fmtTime(d.sunrise && d.sunrise[0])} – ${fmtTime(d.sunset && d.sunset[0])}`)}
     </div>`;
}

function fcCell(label, value) {
  return `<div class="wx-fc-cell"><span class="wx-fc-cell-v">${value}</span><span class="wx-fc-cell-l">${label}</span></div>`;
}

function renderExtended(data) {
  if (!ui.extended) return;
  const d = data.daily;
  const du = data.daily_units || {};
  const tU = du.temperature_2m_max || '°C';
  if (!d || !d.time) { ui.extended.innerHTML = ''; return; }

  let rows = '';
  for (let i = 0; i < d.time.length; i++) {
    const [emoji, desc] = wxInfo(d.weather_code ? d.weather_code[i] : null);
    const day = i === 0 ? 'Today' : new Date(d.time[i] + 'T00:00').toLocaleDateString([], { weekday: 'short' });
    const hi = d.temperature_2m_max && d.temperature_2m_max[i] != null ? Math.round(d.temperature_2m_max[i]) + '°' : '--';
    const lo = d.temperature_2m_min && d.temperature_2m_min[i] != null ? Math.round(d.temperature_2m_min[i]) + '°' : '--';
    const pop = d.precipitation_probability_max && d.precipitation_probability_max[i] != null
      ? d.precipitation_probability_max[i] + '%' : '';
    rows +=
      `<div class="wx-day">
         <span class="wx-day-name">${day}</span>
         <span class="wx-day-emoji" title="${desc}">${emoji}</span>
         <span class="wx-day-pop">${pop}</span>
         <span class="wx-day-temps"><b>${hi}</b> / ${lo}</span>
       </div>`;
  }
  ui.extended.innerHTML = rows;
}

function fmtTime(iso) {
  if (!iso) return '--';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// WMO weather-code -> emoji + description.
function wxInfo(code) {
  const m = {
    0: ['☀️', 'Clear'], 1: ['🌤️', 'Mainly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
    45: ['🌫️', 'Fog'], 48: ['🌫️', 'Rime fog'],
    51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'],
    56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'],
    61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
    66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'],
    71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['❄️', 'Snow grains'],
    80: ['🌦️', 'Light showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Violent showers'],
    85: ['🌨️', 'Snow showers'], 86: ['🌨️', 'Snow showers'],
    95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'Thunderstorm, hail'], 99: ['⛈️', 'Severe thunderstorm'],
  };
  return m[code] || ['🌡️', '—'];
}
