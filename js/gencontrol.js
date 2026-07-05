// Generator start/stop control.
// In demo mode this just toggles a simulated commanded state that mock.js
// reads. In live mode it sends a Signal K PUT request to the generator's state
// path. Whether that actually starts the genset depends on your Signal K server
// having a PUT handler wired to the Cerbo GX / relay (e.g. via a plugin or
// Node-RED flow) — starting an engine remotely is deliberately left to your
// own, verified server-side automation.

import { settings, signalkHttpBase } from './config.js';

// null = unknown / auto (mock defaults to running), true = commanded ON,
// false = commanded OFF. Only used to drive the demo simulation.
let commanded = null;
let lastMessage = '';
const listeners = new Set();

export function getCommanded() {
  return commanded;
}

export function getLastMessage() {
  return lastMessage;
}

export function onGenControlChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  for (const cb of listeners) {
    try { cb({ commanded, message: lastMessage }); } catch (e) { console.error(e); }
  }
}

// on = true to start, false to stop.
export async function commandGenerator(on) {
  if (settings.demoMode) {
    commanded = on;
    lastMessage = on ? 'Demo: generator started.' : 'Demo: generator stopped.';
    emit();
    return { ok: true, demo: true };
  }

  const gid = (settings.generator && settings.generator.id) || 'onan';
  const url = `${signalkHttpBase()}/signalk/v1/api/vessels/self/electrical/generators/${gid}/state`;
  lastMessage = on ? 'Sending start command…' : 'Sending stop command…';
  emit();
  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: on ? 'start' : 'stop' }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    lastMessage = on ? 'Start command sent.' : 'Stop command sent.';
    emit();
    return { ok: true };
  } catch (err) {
    lastMessage = 'Command failed: ' + err.message + ' (server may not support generator control).';
    emit();
    return { ok: false, error: String(err) };
  }
}
