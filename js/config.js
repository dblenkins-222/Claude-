// User-facing settings, persisted to localStorage so the tablet remembers
// the boat's setup between sessions.

const STORAGE_KEY = 'boatmonitor.settings.v1';

const DEFAULTS = {
  // Signal K server host:port. On the Cerbo GX running Venus OS Large this is
  // usually <cerbo-ip>:3000. On an OpenPlotter / Raspberry Pi likewise :3000.
  host: window.location.hostname || 'localhost',
  port: 3000,
  useTLS: false,
  // Start in demo mode so the dashboard shows something on first launch.
  demoMode: true,
  // 'dark' (night helm) or 'light' (daylight).
  theme: 'dark',
  // Speed display unit: 'kn' | 'kmh'
  speedUnit: 'kn',
  // Temperature display unit: 'C' | 'F'
  tempUnit: 'C',
  // Depth display unit: 'm' | 'ft'
  depthUnit: 'm',

  // Engines shown on the dashboard. `id` is the Signal K instance in the path
  // propulsion.<id>.*; `label` is the display name. Twin-engine boats commonly
  // use the instances 'port' and 'starboard'.
  engines: [
    { id: 'port', label: 'Caterpillar C9 Port' },
    { id: 'starboard', label: 'Caterpillar C9 Starboard' },
  ],

  // Anchor watch. When set, the app alarms if the boat drifts beyond radius.
  anchor: {
    set: false,       // true once an anchor position is dropped
    latitude: null,
    longitude: null,
    radius: 30,       // alarm radius in meters
    sound: true,      // audible alarm on drift
  },
};

export const settings = load();

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Could not persist settings', err);
  }
}

// Build the Signal K stream WebSocket URL from current settings.
export function signalkStreamUrl() {
  const proto = settings.useTLS ? 'wss' : 'ws';
  return `${proto}://${settings.host}:${settings.port}/signalk/v1/stream?subscribe=all`;
}

export function signalkHttpBase() {
  const proto = settings.useTLS ? 'https' : 'http';
  return `${proto}://${settings.host}:${settings.port}`;
}
