// App bootstrap: wires the header/settings controls, connection status, and
// switches between live Signal K and demo data.

import { store } from './state.js';
import { settings, saveSettings } from './config.js';
import { connectSignalK, disconnectSignalK } from './signalk.js';
import { startMock, stopMock } from './mock.js';
import { buildDashboard } from './dashboard.js';
import { startAnchorWatch, onAnchorChange, acknowledgeAlarm } from './anchor.js';
import { initWeather, onWeatherShown, onWeatherHidden } from './weather.js';
import { initCameras, onCamerasShown, onCamerasHidden, rebuildCameras } from './camera.js';
import { initElectrical, onElectricalShown, rebuildElectrical } from './electrical.js';
import { initTides, onTidesShown } from './tides.js';
import { initEntertainment, onEntertainmentShown, rebuildEntertainment } from './entertainment.js';
import { startHistory, resetHistoryForMode } from './history.js';

const el = (id) => document.getElementById(id);

// Camera stream types offered in Settings.
const CAMERA_TYPES = [
  ['auto', 'Auto'],
  ['mjpeg', 'MJPEG'],
  ['snapshot', 'Snapshot (JPEG)'],
  ['hls', 'HLS (.m3u8)'],
  ['video', 'Video (mp4/webm)'],
  ['rtsp', 'RTSP (needs gateway)'],
];

function fillCameraTypeSelect(sel, value) {
  sel.innerHTML = '';
  for (const [val, label] of CAMERA_TYPES) {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    sel.appendChild(opt);
  }
  sel.value = value || 'auto';
}

function applyTheme() {
  document.documentElement.dataset.theme = settings.theme;
  el('btn-theme').textContent = settings.theme === 'dark' ? '☀ Day' : '☾ Night';
}

function setStatus(status) {
  const dot = el('status-dot');
  const text = el('status-text');
  const map = {
    connected: ['ok', 'Live'],
    connecting: ['pending', 'Connecting…'],
    demo: ['demo', 'Demo data'],
    error: ['err', 'No connection'],
    disconnected: ['off', 'Disconnected'],
  };
  const [cls, label] = map[status] || ['off', status];
  dot.className = 'status-dot ' + cls;
  text.textContent = label;
}

function goDemo() {
  disconnectSignalK();
  settings.demoMode = true;
  saveSettings();
  startMock();
  resetHistoryForMode();
  reflectMode();
}

function goLive() {
  stopMock();
  settings.demoMode = false;
  saveSettings();
  connectSignalK();
  resetHistoryForMode();
  reflectMode();
}

function reflectMode() {
  el('btn-demo').classList.toggle('active', settings.demoMode);
  el('btn-live').classList.toggle('active', !settings.demoMode);
}

function openSettings() {
  el('host-input').value = settings.host;
  el('port-input').value = settings.port;
  el('tls-input').checked = settings.useTLS;
  el('speed-unit').value = settings.speedUnit;
  el('temp-unit').value = settings.tempUnit;
  el('depth-unit').value = settings.depthUnit;
  el('data-saver').checked = !!settings.dataSaver;
  const engines = settings.engines || [];
  el('engine1-label').value = engines[0]?.label || '';
  el('engine1-id').value = engines[0]?.id || '';
  el('engine2-label').value = engines[1]?.label || '';
  el('engine2-id').value = engines[1]?.id || '';
  const gen = settings.generator || {};
  el('gen-label').value = gen.label || '';
  el('gen-id').value = gen.id || '';
  el('gen-voltage').value = gen.nominalVoltage ?? 120;
  el('gen-frequency').value = String(gen.nominalFrequency ?? 60);
  const dc = settings.dcSystem || {};
  el('elec-shunt-id').value = dc.shuntId || '';
  el('elec-crank-id').value = dc.crankShuntId || '';
  el('elec-solar-id').value = dc.solarId || '';
  el('elec-dc-voltage').value = dc.nominalVoltage ?? 12;
  el('elec-discharge-neg').checked = dc.dischargeNegative !== false;
  el('elec-ac-voltage').value = (settings.acSystem && settings.acSystem.nominalVoltage) ?? 240;
  const fu = settings.fusion || {};
  el('fusion-id').value = fu.deviceId || '';
  const fzones = Array.isArray(fu.zones) ? fu.zones : [];
  const zoneLabel = (id) => (fzones.find((z) => z.id === id) || {}).label || '';
  el('fusion-z1').value = zoneLabel('zone1');
  el('fusion-z2').value = zoneLabel('zone2');
  el('fusion-z3').value = zoneLabel('zone3');
  el('fusion-z4').value = zoneLabel('zone4');
  const cams = settings.cameras || [];
  for (let i = 0; i < 4; i++) {
    const c = cams[i] || {};
    el(`cam${i + 1}-name`).value = c.name || '';
    el(`cam${i + 1}-url`).value = c.url || '';
    fillCameraTypeSelect(el(`cam${i + 1}-type`), c.type);
  }
  el('settings-modal').classList.add('open');
}

function saveSettingsForm() {
  settings.host = el('host-input').value.trim() || 'localhost';
  settings.port = parseInt(el('port-input').value, 10) || 3000;
  settings.useTLS = el('tls-input').checked;
  settings.speedUnit = el('speed-unit').value;
  settings.tempUnit = el('temp-unit').value;
  settings.depthUnit = el('depth-unit').value;
  settings.dataSaver = el('data-saver').checked;
  const prevEngines = JSON.stringify(settings.engines);
  const engines = [];
  const e1id = el('engine1-id').value.trim();
  if (e1id) engines.push({ id: e1id, label: el('engine1-label').value.trim() || e1id });
  const e2id = el('engine2-id').value.trim();
  if (e2id) engines.push({ id: e2id, label: el('engine2-label').value.trim() || e2id });
  settings.engines = engines;
  const enginesChanged = JSON.stringify(settings.engines) !== prevEngines;
  const prevGen = JSON.stringify(settings.generator);
  const genId = el('gen-id').value.trim();
  settings.generator = {
    id: genId,
    label: el('gen-label').value.trim() || 'Generator',
    nominalVoltage: parseFloat(el('gen-voltage').value) || 120,
    nominalFrequency: parseInt(el('gen-frequency').value, 10) || 60,
  };
  const genChanged = JSON.stringify(settings.generator) !== prevGen;
  const prevElec = JSON.stringify([settings.dcSystem, settings.acSystem]);
  settings.dcSystem = {
    shuntId: el('elec-shunt-id').value.trim() || 'house',
    crankShuntId: el('elec-crank-id').value.trim() || 'starter',
    solarId: el('elec-solar-id').value.trim() || 'pv',
    nominalVoltage: parseFloat(el('elec-dc-voltage').value) || 12,
    dischargeNegative: el('elec-discharge-neg').checked,
  };
  settings.acSystem = { nominalVoltage: parseFloat(el('elec-ac-voltage').value) || 240 };
  const elecChanged = JSON.stringify([settings.dcSystem, settings.acSystem]) !== prevElec;
  const prevCams = JSON.stringify(settings.cameras);
  const cameras = [];
  for (let i = 1; i <= 4; i++) {
    cameras.push({
      name: el(`cam${i}-name`).value.trim() || `Camera ${i}`,
      url: el(`cam${i}-url`).value.trim(),
      type: el(`cam${i}-type`).value,
    });
  }
  settings.cameras = cameras;
  const camsChanged = JSON.stringify(settings.cameras) !== prevCams;
  const prevFusion = JSON.stringify(settings.fusion);
  settings.fusion = {
    deviceId: el('fusion-id').value.trim() || 'fusion1',
    zones: [
      { id: 'zone1', label: el('fusion-z1').value.trim() },
      { id: 'zone2', label: el('fusion-z2').value.trim() },
      { id: 'zone3', label: el('fusion-z3').value.trim() },
      { id: 'zone4', label: el('fusion-z4').value.trim() },
    ],
  };
  const fusionChanged = JSON.stringify(settings.fusion) !== prevFusion;
  saveSettings();
  el('settings-modal').classList.remove('open');
  // Rebuild affected views so the panels reflect the new config.
  if (enginesChanged) buildDashboard(el('dashboard'));
  if (genChanged || elecChanged) rebuildElectrical();
  if (camsChanged) rebuildCameras();
  // Re-apply weather radar activity (e.g. data-saver just toggled) if viewing it.
  if (!el('weather-view').hidden) onWeatherShown();
  if (fusionChanged) rebuildEntertainment();
  else if (!el('entertainment-view').hidden) onEntertainmentShown();
  // If we're live, reconnect with the new host.
  if (!settings.demoMode) goLive();
}

// Tab navigation between the Dashboard, Weather Radar and Cameras views.
// Each tab may define onShow / onHide hooks (e.g. lazy-init, start/stop streams).
function initTabs() {
  const tabs = {
    dashboard: { btn: el('tab-dashboard'), view: el('dashboard') },
    electrical: {
      btn: el('tab-electrical'),
      view: el('electrical-view'),
      onShow: () => { initElectrical(); onElectricalShown(); },
    },
    weather: {
      btn: el('tab-weather'),
      view: el('weather-view'),
      // Lazy-init the map on first view (Leaflet needs a visible container).
      onShow: () => { initWeather(); onWeatherShown(); },
      onHide: () => onWeatherHidden(),
    },
    tides: {
      btn: el('tab-tides'),
      view: el('tides-view'),
      onShow: () => { initTides(); onTidesShown(); },
    },
    cameras: {
      btn: el('tab-cameras'),
      view: el('cameras-view'),
      onShow: () => { initCameras(); onCamerasShown(); },
      onHide: () => onCamerasHidden(),
    },
    entertainment: {
      btn: el('tab-entertainment'),
      view: el('entertainment-view'),
      onShow: () => { initEntertainment(); onEntertainmentShown(); },
    },
  };
  function show(name) {
    for (const k of Object.keys(tabs)) {
      const active = k === name;
      const wasVisible = !tabs[k].view.hidden;
      tabs[k].btn.classList.toggle('active', active);
      tabs[k].view.hidden = !active;
      if (!active && wasVisible && tabs[k].onHide) tabs[k].onHide();
    }
    if (tabs[name].onShow) tabs[name].onShow();
  }
  for (const k of Object.keys(tabs)) {
    tabs[k].btn.addEventListener('click', () => show(k));
  }
}

// Show/hide the global anchor-drag banner and wire its silence button.
function initAlarmBanner() {
  const banner = el('alarm-banner');
  onAnchorChange((s) => {
    banner.hidden = !s.alarm;
  });
  el('alarm-ack').addEventListener('click', () => {
    acknowledgeAlarm();
    banner.hidden = true;
  });
}

function initClock() {
  const clock = el('clock');
  const tick = () => {
    const d = new Date();
    clock.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };
  tick();
  setInterval(tick, 10000);
}

function main() {
  applyTheme();
  initClock();
  buildDashboard(el('dashboard'));

  store.onConnectionChange(setStatus);
  setStatus(store.connection);

  startAnchorWatch();
  initAlarmBanner();
  initTabs();
  startHistory();

  // Controls
  el('btn-theme').addEventListener('click', () => {
    settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
    saveSettings();
    applyTheme();
  });
  el('btn-demo').addEventListener('click', goDemo);
  el('btn-live').addEventListener('click', goLive);
  el('btn-settings').addEventListener('click', openSettings);
  el('settings-save').addEventListener('click', saveSettingsForm);
  el('settings-cancel').addEventListener('click', () =>
    el('settings-modal').classList.remove('open'));

  reflectMode();

  // Boot into the saved mode.
  if (settings.demoMode) {
    startMock();
  } else {
    connectSignalK();
  }
}

document.addEventListener('DOMContentLoaded', main);
