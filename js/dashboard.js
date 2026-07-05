// Builds the dashboard DOM and keeps it in sync with the store.

import { store } from './state.js';
import { settings } from './config.js';
import * as U from './units.js';
import {
  createCompass, createWindDial, createLevelBar, createRpmGauge, createAisRadar,
} from './widgets.js';
import {
  onAnchorChange, getAnchorStatus, dropAnchor, weighAnchor, setRadius, setSound,
  acknowledgeAlarm,
} from './anchor.js';

const STALE_MS = 8000; // values older than this are shown dimmed

// Registered render callbacks; each runs on every store update (rAF-throttled).
const renderers = [];

export function buildDashboard(root) {
  root.innerHTML = '';
  renderers.length = 0;

  root.appendChild(buildNavSection());
  for (const engine of settings.engines) {
    root.appendChild(buildEngineSection(engine));
  }
  root.appendChild(buildWindSection());
  root.appendChild(buildAisSection());
  root.appendChild(buildAnchorSection());
  root.appendChild(buildEnvironmentSection());
  root.appendChild(buildTankSection());

  // Re-render on any store change, throttled to one paint per frame.
  let queued = false;
  store.subscribe(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      renderAll();
    });
  });
  renderAll();
}

function renderAll() {
  for (const r of renderers) r();
}

// ---- Section + tile builders ----------------------------------------------
function section(title, className = '') {
  const sec = document.createElement('section');
  sec.className = 'panel ' + className;
  const h = document.createElement('h2');
  h.textContent = title;
  sec.appendChild(h);
  const body = document.createElement('div');
  body.className = 'panel-body';
  sec.appendChild(body);
  return { sec, body };
}

// Create a numeric readout tile. valueFn returns { text, unit, tone?, path }.
function tile(body, label, valueFn, paths) {
  const el = document.createElement('div');
  el.className = 'tile';
  const val = document.createElement('div');
  val.className = 'tile-value';
  const unit = document.createElement('div');
  unit.className = 'tile-unit';
  const lab = document.createElement('div');
  lab.className = 'tile-label';
  lab.textContent = label;
  el.appendChild(val);
  el.appendChild(unit);
  el.appendChild(lab);
  body.appendChild(el);

  renderers.push(() => {
    const out = valueFn();
    val.textContent = out.text;
    unit.textContent = out.unit || '';
    el.classList.toggle('tone-warn', out.tone === 'warn');
    el.classList.toggle('tone-crit', out.tone === 'crit');
    // Stale check across the tile's source paths.
    const stale = (paths || []).length > 0 &&
      (paths || []).every((p) => store.ageMs(p) > STALE_MS);
    el.classList.toggle('stale', stale);
  });
  return el;
}

// ---- Navigation ------------------------------------------------------------
function buildNavSection() {
  const { sec, body } = section('Navigation', 'nav');

  const compass = createCompass();
  const cwrap = document.createElement('div');
  cwrap.className = 'widget-wrap';
  cwrap.appendChild(compass.el);
  body.appendChild(cwrap);
  renderers.push(() => {
    const hdg = U.radToDeg(store.get('navigation.headingTrue'))
      ?? U.radToDeg(store.get('navigation.headingMagnetic'));
    const cog = U.radToDeg(store.get('navigation.courseOverGroundTrue'));
    compass.update(hdg, cog);
  });

  const grid = document.createElement('div');
  grid.className = 'tile-grid';
  body.appendChild(grid);

  tile(grid, 'Speed (SOG)', () => {
    const ms = store.get('navigation.speedOverGround');
    const v = settings.speedUnit === 'kmh' ? U.msToKmh(ms) : U.msToKnots(ms);
    return { text: U.fmt(v, 1), unit: settings.speedUnit === 'kmh' ? 'km/h' : 'kn' };
  }, ['navigation.speedOverGround']);

  tile(grid, 'Heading', () => {
    const deg = U.radToDeg(store.get('navigation.headingTrue'))
      ?? U.radToDeg(store.get('navigation.headingMagnetic'));
    return { text: deg == null ? '--' : Math.round(deg) + '°', unit: U.degToCompassPoint(deg) };
  }, ['navigation.headingTrue', 'navigation.headingMagnetic']);

  tile(grid, 'Course (COG)', () => {
    const deg = U.radToDeg(store.get('navigation.courseOverGroundTrue'));
    return { text: deg == null ? '--' : Math.round(deg) + '°', unit: U.degToCompassPoint(deg) };
  }, ['navigation.courseOverGroundTrue']);

  tile(grid, 'Depth', () => {
    const m = store.get('environment.depth.belowTransducer');
    const v = settings.depthUnit === 'ft' ? U.mToFeet(m) : m;
    const tone = m != null && m < 2 ? 'crit' : (m != null && m < 4 ? 'warn' : null);
    return { text: U.fmt(v, 1), unit: settings.depthUnit === 'ft' ? 'ft' : 'm', tone };
  }, ['environment.depth.belowTransducer']);

  const pos = document.createElement('div');
  pos.className = 'position-readout';
  body.appendChild(pos);
  renderers.push(() => {
    const lat = store.get('navigation.position.latitude');
    const lon = store.get('navigation.position.longitude');
    pos.innerHTML = `<span>${U.formatLatitude(lat)}</span><span>${U.formatLongitude(lon)}</span>`;
  });

  return sec;
}

// ---- Wind ------------------------------------------------------------------
function buildWindSection() {
  const { sec, body } = section('Wind', 'wind');

  const dial = createWindDial();
  const wrap = document.createElement('div');
  wrap.className = 'widget-wrap';
  wrap.appendChild(dial.el);
  body.appendChild(wrap);
  renderers.push(() => {
    const angle = U.radToSignedDeg(store.get('environment.wind.angleApparent'));
    const ms = store.get('environment.wind.speedApparent');
    const spd = settings.speedUnit === 'kmh' ? U.msToKmh(ms) : U.msToKnots(ms);
    dial.update(angle, U.fmt(spd, 1), (settings.speedUnit === 'kmh' ? 'km/h' : 'kn') + ' AWS');
  });

  const grid = document.createElement('div');
  grid.className = 'tile-grid';
  body.appendChild(grid);

  tile(grid, 'App. Wind Speed', () => {
    const ms = store.get('environment.wind.speedApparent');
    const v = settings.speedUnit === 'kmh' ? U.msToKmh(ms) : U.msToKnots(ms);
    return { text: U.fmt(v, 1), unit: settings.speedUnit === 'kmh' ? 'km/h' : 'kn' };
  }, ['environment.wind.speedApparent']);

  tile(grid, 'App. Wind Angle', () => {
    const deg = U.radToSignedDeg(store.get('environment.wind.angleApparent'));
    if (deg == null) return { text: '--', unit: '' };
    const side = deg < 0 ? 'P' : 'S';
    return { text: Math.abs(Math.round(deg)) + '°', unit: side };
  }, ['environment.wind.angleApparent']);

  tile(grid, 'True Wind Speed', () => {
    const ms = store.get('environment.wind.speedTrue');
    const v = settings.speedUnit === 'kmh' ? U.msToKmh(ms) : U.msToKnots(ms);
    return { text: U.fmt(v, 1), unit: settings.speedUnit === 'kmh' ? 'km/h' : 'kn' };
  }, ['environment.wind.speedTrue']);

  tile(grid, 'True Wind Angle', () => {
    const deg = U.radToSignedDeg(store.get('environment.wind.angleTrueWater'));
    if (deg == null) return { text: '--', unit: '' };
    const side = deg < 0 ? 'P' : 'S';
    return { text: Math.abs(Math.round(deg)) + '°', unit: side };
  }, ['environment.wind.angleTrueWater']);

  return sec;
}

// ---- Environment -----------------------------------------------------------
function buildEnvironmentSection() {
  const { sec, body } = section('Environment', 'env');
  const grid = document.createElement('div');
  grid.className = 'tile-grid';
  body.appendChild(grid);

  const tempConv = (k) => settings.tempUnit === 'F' ? U.kelvinToFahrenheit(k) : U.kelvinToCelsius(k);
  const tempUnit = () => '°' + settings.tempUnit;

  tile(grid, 'Water Temp', () => {
    const k = store.get('environment.water.temperature');
    return { text: U.fmt(tempConv(k), 1), unit: tempUnit() };
  }, ['environment.water.temperature']);

  tile(grid, 'Air Temp', () => {
    const k = store.get('environment.outside.temperature');
    return { text: U.fmt(tempConv(k), 1), unit: tempUnit() };
  }, ['environment.outside.temperature']);

  return sec;
}

// The Electrical panel now lives on its own Electrical tab (see js/electrical.js).

// ---- Tanks -----------------------------------------------------------------
function buildTankSection() {
  const { sec, body } = section('Tanks', 'tanks');

  const tanks = [
    { label: 'Fuel', path: 'tanks.fuel.main.currentLevel', invert: false },
    { label: 'Fresh Water', path: 'tanks.freshWater.main.currentLevel', invert: false },
    { label: 'Black Water', path: 'tanks.blackWater.main.currentLevel', invert: true },
  ];

  for (const t of tanks) {
    const row = document.createElement('div');
    row.className = 'tank-row';
    const label = document.createElement('div');
    label.className = 'tank-label';
    label.textContent = t.label;
    const pct = document.createElement('div');
    pct.className = 'tank-pct';
    pct.textContent = '--%';
    const bar = createLevelBar();
    row.appendChild(label);
    row.appendChild(bar.el);
    row.appendChild(pct);
    body.appendChild(row);

    renderers.push(() => {
      const p = U.ratioToPercent(store.get(t.path));
      pct.textContent = p == null ? '--%' : Math.round(p) + '%';
      // For waste tanks a high level is bad; for supply tanks a low level is bad.
      let tone = 'good';
      if (p != null) {
        if (t.invert) tone = p > 80 ? 'crit' : p > 60 ? 'warn' : 'good';
        else tone = p < 15 ? 'crit' : p < 30 ? 'warn' : 'good';
      }
      bar.update(p, tone);
    });
  }

  return sec;
}


// ---- Engine ----------------------------------------------------------------
function buildEngineSection(engine) {
  const { sec, body } = section(engine.label, 'engine');
  const eid = engine.id;
  const P = (suffix) => `propulsion.${eid}.${suffix}`;

  const gauge = createRpmGauge(4000, 3500);
  const wrap = document.createElement('div');
  wrap.className = 'widget-wrap';
  wrap.appendChild(gauge.el);
  body.appendChild(wrap);
  renderers.push(() => {
    gauge.update(U.hzToRpm(store.get(P('revolutions'))));
  });

  const grid = document.createElement('div');
  grid.className = 'tile-grid';
  body.appendChild(grid);

  tile(grid, 'Engine Temp', () => {
    const k = store.get(P('temperature'));
    const c = U.kelvinToCelsius(k);
    const v = settings.tempUnit === 'F' ? U.kelvinToFahrenheit(k) : c;
    const tone = c == null ? null : (c > 98 ? 'crit' : c > 92 ? 'warn' : null);
    return { text: U.fmt(v, 0), unit: '°' + settings.tempUnit, tone };
  }, [P('temperature')]);

  tile(grid, 'Oil Pressure', () => {
    const pa = store.get(P('oilPressure'));
    const bar = U.paToBar(pa);
    const tone = bar == null ? null : (bar < 1.0 ? 'crit' : bar < 1.8 ? 'warn' : null);
    return { text: U.fmt(bar, 1), unit: 'bar', tone };
  }, [P('oilPressure')]);

  tile(grid, 'Engine Load', () => {
    const load = U.ratioToPercent(store.get(P('engineLoad')));
    return { text: U.fmt(load, 0), unit: '%' };
  }, [P('engineLoad')]);

  tile(grid, 'RPM', () => {
    const rpm = U.hzToRpm(store.get(P('revolutions')));
    const tone = rpm != null && rpm >= 3500 ? 'crit' : null;
    return { text: rpm == null ? '--' : Math.round(rpm), unit: 'rpm', tone };
  }, [P('revolutions')]);

  return sec;
}

// ---- AIS targets -----------------------------------------------------------
function buildAisSection() {
  const { sec, body } = section('AIS Targets', 'ais');

  const count = document.createElement('span');
  count.className = 'ais-count';
  sec.querySelector('h2').appendChild(count);

  const radar = createAisRadar();
  const wrap = document.createElement('div');
  wrap.className = 'widget-wrap';
  wrap.appendChild(radar.el);
  body.appendChild(wrap);

  const list = document.createElement('div');
  list.className = 'ais-list';
  body.appendChild(list);

  // Drop targets we stopped hearing from.
  setInterval(() => store.pruneVessels(300000), 30000);

  renderers.push(() => {
    const lat = store.get('navigation.position.latitude');
    const lon = store.get('navigation.position.longitude');
    const vessels = store.getVessels().map((v) => {
      const range = U.haversineMeters(lat, lon, v.latitude, v.longitude);
      const brg = U.bearingDeg(lat, lon, v.latitude, v.longitude);
      return { ...v, range, brg };
    }).filter((v) => v.range != null)
      .sort((a, b) => a.range - b.range);

    count.textContent = vessels.length ? `${vessels.length} in range` : 'none';

    // Radar: scale to the farthest target (min 1 NM).
    const farthest = vessels.length ? vessels[vessels.length - 1].range : 1852;
    const maxRange = Math.max(1852, farthest * 1.1);
    radar.update(vessels.map((v) => ({
      bearingDeg: v.brg,
      rangeMeters: v.range,
      cogDeg: U.radToDeg(v.cog),
      alarm: v.range < 500,
    })), maxRange);

    // List (nearest first, cap to keep it glanceable).
    list.innerHTML = '';
    if (!vessels.length) {
      const empty = document.createElement('div');
      empty.className = 'ais-empty';
      empty.textContent = 'No AIS targets received.';
      list.appendChild(empty);
      return;
    }
    for (const v of vessels.slice(0, 6)) {
      const row = document.createElement('div');
      row.className = 'ais-row' + (v.range < 500 ? ' alarm' : '');
      const spd = settings.speedUnit === 'kmh' ? U.msToKmh(v.sog) : U.msToKnots(v.sog);
      const name = v.name || (v.mmsi ? `MMSI ${v.mmsi}` : 'Unknown');
      row.innerHTML =
        `<span class="ais-name">${escapeHtml(name)}</span>` +
        `<span class="ais-range">${U.formatRange(v.range)}</span>` +
        `<span class="ais-brg">${v.brg == null ? '--' : Math.round(v.brg) + '°'}</span>` +
        `<span class="ais-sog">${U.fmt(spd, 1)} ${settings.speedUnit === 'kmh' ? 'km/h' : 'kn'}</span>`;
      list.appendChild(row);
    }
  });

  return sec;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

// ---- Anchor watch ----------------------------------------------------------
function buildAnchorSection() {
  const { sec, body } = section('Anchor Watch', 'anchor');

  const statusEl = document.createElement('div');
  statusEl.className = 'anchor-status';
  body.appendChild(statusEl);

  // Distance / radius readout
  const readout = document.createElement('div');
  readout.className = 'anchor-readout';
  readout.innerHTML =
    '<div class="anchor-metric"><span class="v" id="anc-dist">--</span><span class="l">Drift</span></div>' +
    '<div class="anchor-metric"><span class="v" id="anc-radius">--</span><span class="l">Radius</span></div>' +
    '<div class="anchor-metric"><span class="v" id="anc-brg">--</span><span class="l">Bearing</span></div>';
  body.appendChild(readout);

  // Radius adjustment
  const radiusRow = document.createElement('div');
  radiusRow.className = 'anchor-radius-row';
  radiusRow.innerHTML =
    '<button class="btn ghost" id="anc-minus">− 5 m</button>' +
    '<span id="anc-radius-val" class="anchor-radius-val"></span>' +
    '<button class="btn ghost" id="anc-plus">+ 5 m</button>';
  body.appendChild(radiusRow);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'anchor-actions';
  const dropBtn = document.createElement('button');
  dropBtn.className = 'btn primary';
  const soundBtn = document.createElement('button');
  soundBtn.className = 'btn ghost';
  actions.appendChild(dropBtn);
  actions.appendChild(soundBtn);
  body.appendChild(actions);

  const msg = document.createElement('div');
  msg.className = 'anchor-msg';
  body.appendChild(msg);

  // Wire controls
  dropBtn.addEventListener('click', () => {
    const s = getAnchorStatus();
    if (s.set) {
      weighAnchor();
    } else {
      const res = dropAnchor();
      msg.textContent = res.ok ? '' : (res.reason || '');
    }
  });
  radiusRow.querySelector('#anc-minus').addEventListener('click', () => {
    setRadius(getAnchorStatus().radius - 5);
  });
  radiusRow.querySelector('#anc-plus').addEventListener('click', () => {
    setRadius(getAnchorStatus().radius + 5);
  });
  soundBtn.addEventListener('click', () => {
    setSound(!settings.anchor.sound);
    render(getAnchorStatus());
  });

  function render(s) {
    sec.classList.toggle('alarm', s.alarm);
    statusEl.textContent = !s.set ? 'Not set'
      : (s.alarm ? 'DRAGGING — outside radius!' : 'Anchored — holding');
    statusEl.className = 'anchor-status ' + (!s.set ? 'idle' : s.alarm ? 'crit' : 'ok');

    readout.querySelector('#anc-dist').textContent = s.set ? U.formatRange(s.distance) : '--';
    readout.querySelector('#anc-radius').textContent = `${s.radius} m`;
    readout.querySelector('#anc-brg').textContent =
      s.set && s.bearing != null ? Math.round(s.bearing) + '°' : '--';
    radiusRow.querySelector('#anc-radius-val').textContent = `${s.radius} m`;

    dropBtn.textContent = s.set ? 'Weigh Anchor' : 'Drop Anchor';
    dropBtn.classList.toggle('danger', s.set);
    soundBtn.textContent = settings.anchor.sound ? '🔔 Alarm On' : '🔕 Alarm Off';
    if (s.alarm) {
      // Tapping the status silences the beep but keeps the visual alarm.
      statusEl.onclick = () => acknowledgeAlarm();
      statusEl.classList.add('tappable');
    } else {
      statusEl.onclick = null;
    }
  }

  onAnchorChange(render);
  render(getAnchorStatus());

  return sec;
}


// The Generator panel now lives on the Electrical tab (see js/electrical.js).
