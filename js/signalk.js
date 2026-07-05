// Signal K WebSocket client.
// Connects to a Signal K server's delta stream and pushes every value into the
// shared store. Signal K delta messages look like:
// {
//   "context": "vessels.self",
//   "updates": [
//     {
//       "source": { "label": "N2K", ... },
//       "timestamp": "2025-01-01T00:00:00.000Z",
//       "values": [ { "path": "navigation.speedOverGround", "value": 3.4 } ]
//     }
//   ]
// }

import { store } from './state.js';
import { signalkStreamUrl } from './config.js';

let ws = null;
let reconnectTimer = null;
let manualClose = false;

export function connectSignalK() {
  disconnectSignalK(); // ensure clean slate
  manualClose = false;
  store.setConnection('connecting');

  const url = signalkStreamUrl();
  try {
    ws = new WebSocket(url);
  } catch (err) {
    console.error('Failed to open WebSocket', err);
    store.setConnection('error');
    scheduleReconnect();
    return;
  }

  ws.addEventListener('open', () => {
    store.setConnection('connected');
  });

  ws.addEventListener('message', (event) => {
    handleMessage(event.data);
  });

  ws.addEventListener('close', () => {
    if (!manualClose) {
      store.setConnection('error');
      scheduleReconnect();
    } else {
      store.setConnection('disconnected');
    }
  });

  ws.addEventListener('error', () => {
    // 'close' will fire next and handle reconnection.
    store.setConnection('error');
  });
}

export function disconnectSignalK() {
  manualClose = true;
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    try {
      ws.close();
    } catch { /* ignore */ }
    ws = null;
  }
}

function scheduleReconnect() {
  if (manualClose) return;
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    if (!manualClose) connectSignalK();
  }, 4000);
}

function handleMessage(data) {
  let msg;
  try {
    msg = JSON.parse(data);
  } catch {
    return;
  }

  // The first message is a "hello" that tells us our own vessel context.
  if (msg.self && !msg.updates) {
    store.selfContext = msg.self.startsWith('vessels.') ? msg.self : `vessels.${msg.self}`;
    return;
  }
  if (!msg.updates) return;

  // A delta without a context, or explicitly vessels.self / our own id, is us.
  const context = msg.context || 'vessels.self';
  const isSelf = context === 'vessels.self' ||
    (store.selfContext && context === store.selfContext) ||
    !context.startsWith('vessels.');

  for (const update of msg.updates) {
    const ts = update.timestamp ? Date.parse(update.timestamp) : Date.now();
    const source = update.source?.label || update.$source || null;
    if (!update.values) continue;
    for (const item of update.values) {
      if (!item || item.path == null) continue;
      if (isSelf) {
        applySelfValue(item.path, item.value, { timestamp: ts, source });
      } else {
        applyVesselValue(context, item.path, item.value, { timestamp: ts });
      }
    }
  }
}

// Position arrives as an object { latitude, longitude }; flatten it into
// dedicated paths so tiles can read them directly.
function applySelfValue(path, value, meta) {
  if (path === 'navigation.position' && value && typeof value === 'object') {
    store.set('navigation.position.latitude', value.latitude, meta);
    store.set('navigation.position.longitude', value.longitude, meta);
    return;
  }
  store.set(path, value, meta);
}

function applyVesselValue(context, path, value, meta) {
  // Static data (name, mmsi, ...) sometimes arrives as an object under an empty
  // path; spread it into individual keys.
  if ((path === '' || path == null) && value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      store.setVesselValue(context, k, v, meta);
    }
    return;
  }
  store.setVesselValue(context, path, value, meta);

  // Derive MMSI from the context urn if the server didn't send it explicitly.
  const m = /mmsi:(\d+)/.exec(context);
  if (m) store.setVesselValue(context, 'mmsi', m[1], meta);
}
