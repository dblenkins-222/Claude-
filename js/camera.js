// IP camera view.
// Shows up to 4 camera streams in an adaptive grid. Streams are played with
// browser-native technology wherever possible:
//   - mjpeg / snapshot : an <img> element (MJPEG keeps a multipart stream open;
//                        snapshot polls a JPEG URL on an interval)
//   - hls (.m3u8)      : a <video> element, native on iOS/Safari, hls.js
//                        (loaded on demand) elsewhere
//   - video            : a <video> element (mp4/webm/ogg)
//   - rtsp             : NOT playable in a browser — we show guidance to route
//                        it through a gateway (go2rtc / MediaMTX / Frigate)
//
// Streams are started when the tab is shown and stopped when hidden to save
// bandwidth and CPU.

import { settings } from './config.js';

// A public, widely-used test stream so the tab shows something in demo mode
// before real cameras are configured.
const DEMO_HLS = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';

const SNAPSHOT_INTERVAL_MS = 1000;

let grid = null;
let cells = [];       // { def, media, overlay, type, timer, hls }
let initialized = false;
let visible = false;
let hlsLoading = null;

// Resolve the list of cameras to show: configured ones, or a demo stream.
function activeCameras() {
  const configured = (settings.cameras || []).filter((c) => c && c.url && c.url.trim());
  if (configured.length) return configured.slice(0, 4);
  if (settings.demoMode) {
    return [{ name: 'Demo Stream (HLS)', url: DEMO_HLS, type: 'hls' }];
  }
  return [];
}

function detectType(url, type) {
  if (type && type !== 'auto') return type;
  const u = url.toLowerCase();
  if (u.startsWith('rtsp://')) return 'rtsp';
  if (u.includes('.m3u8')) return 'hls';
  if (/\.(mp4|webm|ogg)(\?|$)/.test(u)) return 'video';
  if (u.includes('mjpg') || u.includes('mjpeg')) return 'mjpeg';
  if (/\.(jpg|jpeg)(\?|$)/.test(u) || u.includes('snapshot') || u.includes('/jpg/')) return 'snapshot';
  return 'mjpeg';
}

export function initCameras() {
  if (initialized) return;
  initialized = true;
  grid = document.getElementById('camera-grid');
  buildGrid();
}

// Rebuild the grid from current settings (called after settings change).
export function rebuildCameras() {
  if (!initialized) return;
  stopAll();
  buildGrid();
  if (visible) startAll();
}

export function onCamerasShown() {
  visible = true;
  startAll();
}

export function onCamerasHidden() {
  visible = false;
  stopAll();
}

function buildGrid() {
  cells = [];
  grid.innerHTML = '';
  const cams = activeCameras();
  grid.dataset.count = String(cams.length);
  grid.classList.remove('has-expanded');

  if (!cams.length) {
    const empty = document.createElement('div');
    empty.className = 'cam-empty';
    empty.innerHTML =
      '<div>No cameras configured.</div>' +
      '<div class="cam-empty-sub">Add up to 4 camera URLs in ⚙ Settings → Cameras.</div>';
    grid.appendChild(empty);
    return;
  }

  cams.forEach((def, i) => {
    const type = detectType(def.url, def.type);
    const cell = document.createElement('div');
    cell.className = 'cam-cell';

    const head = document.createElement('div');
    head.className = 'cam-head';
    head.textContent = def.name || `Camera ${i + 1}`;
    cell.appendChild(head);

    let media = null;
    if (type === 'mjpeg' || type === 'snapshot') {
      media = document.createElement('img');
      media.className = 'cam-media';
      media.alt = def.name || 'camera';
    } else if (type === 'hls' || type === 'video') {
      media = document.createElement('video');
      media.className = 'cam-media';
      media.muted = true;
      media.autoplay = true;
      media.playsInline = true;
      media.setAttribute('playsinline', '');
    }
    if (media) cell.appendChild(media);

    const overlay = document.createElement('div');
    overlay.className = 'cam-overlay';
    cell.appendChild(overlay);

    // Tap to expand a single camera to fill the grid; tap again to restore.
    cell.addEventListener('click', () => {
      const expanded = cell.classList.toggle('expanded');
      grid.classList.toggle('has-expanded', expanded);
      if (!expanded) {
        // collapsing this one — make sure no others remain expanded
        grid.querySelectorAll('.cam-cell.expanded').forEach((c) => c.classList.remove('expanded'));
      } else {
        grid.querySelectorAll('.cam-cell.expanded').forEach((c) => {
          if (c !== cell) c.classList.remove('expanded');
        });
      }
    });

    grid.appendChild(cell);
    cells.push({ def, type, media, overlay, timer: null, hls: null });
  });
}

function setOverlay(cell, msg) {
  cell.overlay.textContent = msg || '';
  cell.overlay.classList.toggle('hidden', !msg);
}

function startAll() {
  for (const cell of cells) startCell(cell);
}

function stopAll() {
  for (const cell of cells) stopCell(cell);
}

function startCell(cell) {
  const { def, type, media } = cell;
  setOverlay(cell, 'Connecting…');

  if (type === 'rtsp') {
    setOverlay(cell,
      'RTSP can’t play directly in a browser. Route this camera through a ' +
      'gateway (go2rtc / MediaMTX / Frigate) that outputs HLS or MJPEG, then ' +
      'use that URL.');
    return;
  }

  if (type === 'mjpeg') {
    media.onload = () => setOverlay(cell, '');
    media.onerror = () => setOverlay(cell, 'Stream unavailable — check the URL / network.');
    media.src = def.url;
    return;
  }

  if (type === 'snapshot') {
    const tick = () => {
      const sep = def.url.includes('?') ? '&' : '?';
      media.src = def.url + sep + '_t=' + Date.now();
    };
    media.onload = () => setOverlay(cell, '');
    media.onerror = () => setOverlay(cell, 'Snapshot unavailable — check the URL / network.');
    tick();
    cell.timer = setInterval(tick, SNAPSHOT_INTERVAL_MS);
    return;
  }

  if (type === 'video') {
    media.onloadeddata = () => setOverlay(cell, '');
    media.onerror = () => setOverlay(cell, 'Video unavailable — check the URL / network.');
    media.src = def.url;
    media.play().catch(() => {});
    return;
  }

  if (type === 'hls') {
    startHls(cell);
  }
}

async function startHls(cell) {
  const { def, media } = cell;
  media.onloadeddata = () => setOverlay(cell, '');
  // Safari / iOS can play HLS natively.
  if (media.canPlayType('application/vnd.apple.mpegurl')) {
    media.src = def.url;
    media.play().catch(() => {});
    return;
  }
  try {
    const Hls = await loadHlsLib();
    if (Hls && Hls.isSupported()) {
      const hls = new Hls({ liveDurationInfinity: true, lowLatencyMode: true });
      hls.loadSource(def.url);
      hls.attachMedia(media);
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data && data.fatal) setOverlay(cell, 'Stream error — check the URL / network.');
      });
      cell.hls = hls;
    } else {
      setOverlay(cell, 'HLS not supported on this browser.');
    }
  } catch {
    setOverlay(cell, 'Could not load the HLS player (offline?).');
  }
}

function stopCell(cell) {
  if (cell.timer) { clearInterval(cell.timer); cell.timer = null; }
  if (cell.hls) { try { cell.hls.destroy(); } catch { /* ignore */ } cell.hls = null; }
  const m = cell.media;
  if (!m) return;
  if (m.tagName === 'IMG') {
    m.removeAttribute('src');
  } else {
    try { m.pause(); } catch { /* ignore */ }
    m.removeAttribute('src');
    try { m.load(); } catch { /* ignore */ }
  }
}

// Load hls.js from CDN only when an HLS stream actually needs it.
function loadHlsLib() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (hlsLoading) return hlsLoading;
  hlsLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js';
    s.onload = () => resolve(window.Hls);
    s.onerror = () => reject(new Error('hls.js load failed'));
    document.head.appendChild(s);
  });
  return hlsLoading;
}
