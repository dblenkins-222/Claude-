// App bootstrap: wires the header/settings controls, connection status, and
// switches between live Signal K and demo data.

import { store } from './state.js';
import { settings, saveSettings } from './config.js';
import { connectSignalK, disconnectSignalK } from './signalk.js';
import { startMock, stopMock } from './mock.js';
import { buildDashboard } from './dashboard.js';
import { startAnchorWatch, onAnchorChange, acknowledgeAlarm } from './anchor.js';

const el = (id) => document.getElementById(id);

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
  reflectMode();
}

function goLive() {
  stopMock();
  settings.demoMode = false;
  saveSettings();
  connectSignalK();
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
  const engines = settings.engines || [];
  el('engine1-label').value = engines[0]?.label || '';
  el('engine1-id').value = engines[0]?.id || '';
  el('engine2-label').value = engines[1]?.label || '';
  el('engine2-id').value = engines[1]?.id || '';
  el('settings-modal').classList.add('open');
}

function saveSettingsForm() {
  settings.host = el('host-input').value.trim() || 'localhost';
  settings.port = parseInt(el('port-input').value, 10) || 3000;
  settings.useTLS = el('tls-input').checked;
  settings.speedUnit = el('speed-unit').value;
  settings.tempUnit = el('temp-unit').value;
  settings.depthUnit = el('depth-unit').value;
  const prevEngines = JSON.stringify(settings.engines);
  const engines = [];
  const e1id = el('engine1-id').value.trim();
  if (e1id) engines.push({ id: e1id, label: el('engine1-label').value.trim() || e1id });
  const e2id = el('engine2-id').value.trim();
  if (e2id) engines.push({ id: e2id, label: el('engine2-label').value.trim() || e2id });
  settings.engines = engines;
  const enginesChanged = JSON.stringify(settings.engines) !== prevEngines;
  saveSettings();
  el('settings-modal').classList.remove('open');
  // Rebuild if the engine config changed so the panels reflect it.
  if (enginesChanged) buildDashboard(el('dashboard'));
  // If we're live, reconnect with the new host.
  if (!settings.demoMode) goLive();
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
