// Reusable SVG widgets: a heading compass and an apparent-wind dial.
// Each returns { el, update } where el is the DOM node to mount and update()
// redraws the moving parts.

// ---- Compass ---------------------------------------------------------------
export function createCompass() {
  const NS = 'http://www.w3.org/2000/svg';
  const size = 200;
  const c = size / 2;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.classList.add('compass');

  // Outer ring
  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('cx', c);
  ring.setAttribute('cy', c);
  ring.setAttribute('r', c - 6);
  ring.setAttribute('class', 'compass-ring');
  svg.appendChild(ring);

  // Tick marks + cardinal labels
  for (let deg = 0; deg < 360; deg += 30) {
    const isCardinal = deg % 90 === 0;
    const a = (deg - 90) * Math.PI / 180;
    const r1 = c - 6;
    const r2 = isCardinal ? c - 22 : c - 14;
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', c + r1 * Math.cos(a));
    line.setAttribute('y1', c + r1 * Math.sin(a));
    line.setAttribute('x2', c + r2 * Math.cos(a));
    line.setAttribute('y2', c + r2 * Math.sin(a));
    line.setAttribute('class', isCardinal ? 'compass-tick major' : 'compass-tick');
    svg.appendChild(line);

    if (isCardinal) {
      const label = document.createElementNS(NS, 'text');
      const rl = c - 34;
      label.setAttribute('x', c + rl * Math.cos(a));
      label.setAttribute('y', c + rl * Math.sin(a) + 5);
      label.setAttribute('class', 'compass-label');
      label.textContent = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }[deg];
      svg.appendChild(label);
    }
  }

  // Heading needle (points up, rotated by heading)
  const needle = document.createElementNS(NS, 'polygon');
  needle.setAttribute('points', `${c},${18} ${c - 10},${c} ${c},${c - 8} ${c + 10},${c}`);
  needle.setAttribute('class', 'compass-needle');
  svg.appendChild(needle);

  // COG marker (thin line)
  const cog = document.createElementNS(NS, 'line');
  cog.setAttribute('x1', c);
  cog.setAttribute('y1', c);
  cog.setAttribute('x2', c);
  cog.setAttribute('y2', 24);
  cog.setAttribute('class', 'compass-cog');
  svg.appendChild(cog);

  // Center readout
  const value = document.createElementNS(NS, 'text');
  value.setAttribute('x', c);
  value.setAttribute('y', c + 6);
  value.setAttribute('class', 'compass-value');
  value.textContent = '---°';
  svg.appendChild(value);

  function update(headingDeg, cogDeg) {
    if (headingDeg != null) {
      needle.setAttribute('transform', `rotate(${headingDeg} ${c} ${c})`);
      value.textContent = `${Math.round(headingDeg)}°`;
    }
    if (cogDeg != null) {
      cog.setAttribute('transform', `rotate(${cogDeg} ${c} ${c})`);
      cog.style.display = '';
    } else {
      cog.style.display = 'none';
    }
  }

  return { el: svg, update };
}

// ---- Wind dial -------------------------------------------------------------
export function createWindDial() {
  const NS = 'http://www.w3.org/2000/svg';
  const size = 200;
  const c = size / 2;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.classList.add('wind-dial');

  const ring = document.createElementNS(NS, 'circle');
  ring.setAttribute('cx', c);
  ring.setAttribute('cy', c);
  ring.setAttribute('r', c - 6);
  ring.setAttribute('class', 'wind-ring');
  svg.appendChild(ring);

  // Bow marker at top
  const bow = document.createElementNS(NS, 'polygon');
  bow.setAttribute('points', `${c},${10} ${c - 8},${26} ${c + 8},${26}`);
  bow.setAttribute('class', 'wind-bow');
  svg.appendChild(bow);

  // Apparent wind arrow (rotates around center)
  const arrow = document.createElementNS(NS, 'g');
  const shaft = document.createElementNS(NS, 'line');
  shaft.setAttribute('x1', c);
  shaft.setAttribute('y1', c);
  shaft.setAttribute('x2', c);
  shaft.setAttribute('y2', 22);
  shaft.setAttribute('class', 'wind-arrow');
  const head = document.createElementNS(NS, 'polygon');
  head.setAttribute('points', `${c},14 ${c - 9},30 ${c + 9},30`);
  head.setAttribute('class', 'wind-arrow-head');
  arrow.appendChild(shaft);
  arrow.appendChild(head);
  svg.appendChild(arrow);

  const speed = document.createElementNS(NS, 'text');
  speed.setAttribute('x', c);
  speed.setAttribute('y', c);
  speed.setAttribute('class', 'wind-speed');
  speed.textContent = '--';
  svg.appendChild(speed);

  const label = document.createElementNS(NS, 'text');
  label.setAttribute('x', c);
  label.setAttribute('y', c + 22);
  label.setAttribute('class', 'wind-unit');
  label.textContent = 'kn AWS';
  svg.appendChild(label);

  // angleSignedDeg: -180..180 (0 = wind from bow, + = starboard)
  function update(angleSignedDeg, speedText, unitText) {
    if (angleSignedDeg != null) {
      arrow.setAttribute('transform', `rotate(${angleSignedDeg} ${c} ${c})`);
    }
    if (speedText != null) speed.textContent = speedText;
    if (unitText != null) label.textContent = unitText;
  }

  return { el: svg, update };
}

// ---- Level bar (battery / tanks) ------------------------------------------
export function createLevelBar() {
  const wrap = document.createElement('div');
  wrap.className = 'levelbar';
  const fill = document.createElement('div');
  fill.className = 'levelbar-fill';
  wrap.appendChild(fill);

  // percent 0..100, tone: 'good' | 'warn' | 'crit'
  function update(percent, tone) {
    const p = percent == null ? 0 : Math.max(0, Math.min(100, percent));
    fill.style.width = p + '%';
    fill.className = 'levelbar-fill' + (tone ? ' ' + tone : '');
  }

  return { el: wrap, update };
}


// ---- RPM gauge (tachometer) -----------------------------------------------
export function createRpmGauge(maxRpm = 4000, redline = 3500) {
  const NS = 'http://www.w3.org/2000/svg';
  const size = 200;
  const c = size / 2;
  const r = c - 16;
  const START = 135;   // degrees (bottom-left)
  const SWEEP = 270;   // total sweep
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.classList.add('rpm-gauge');

  const polar = (deg, radius) => {
    const a = (deg - 90) * Math.PI / 180;
    return [c + radius * Math.cos(a), c + radius * Math.sin(a)];
  };
  const valToDeg = (v) => START + (Math.min(v, maxRpm) / maxRpm) * SWEEP;

  // Arc track (drawn as tick marks so we avoid path-arc math for the base ring)
  for (let v = 0; v <= maxRpm; v += maxRpm / 8) {
    const deg = valToDeg(v);
    const [x1, y1] = polar(deg, r);
    const [x2, y2] = polar(deg, r - 12);
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('class', v >= redline ? 'rpm-tick redline' : 'rpm-tick');
    svg.appendChild(line);

    const [lx, ly] = polar(deg, r - 26);
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', lx); label.setAttribute('y', ly + 4);
    label.setAttribute('class', 'rpm-tick-label');
    label.textContent = Math.round(v / 1000);
    svg.appendChild(label);
  }

  const needle = document.createElementNS(NS, 'line');
  needle.setAttribute('x1', c); needle.setAttribute('y1', c);
  needle.setAttribute('class', 'rpm-needle');
  svg.appendChild(needle);

  const hub = document.createElementNS(NS, 'circle');
  hub.setAttribute('cx', c); hub.setAttribute('cy', c); hub.setAttribute('r', 6);
  hub.setAttribute('class', 'rpm-hub');
  svg.appendChild(hub);

  const value = document.createElementNS(NS, 'text');
  value.setAttribute('x', c); value.setAttribute('y', c + 46);
  value.setAttribute('class', 'rpm-value');
  value.textContent = '----';
  svg.appendChild(value);

  const unit = document.createElementNS(NS, 'text');
  unit.setAttribute('x', c); unit.setAttribute('y', c + 62);
  unit.setAttribute('class', 'rpm-unit');
  unit.textContent = 'RPM';
  svg.appendChild(unit);

  function update(rpm) {
    if (rpm == null) {
      value.textContent = '----';
      needle.setAttribute('x2', c); needle.setAttribute('y2', c - r + 12);
      return;
    }
    const [x2, y2] = polar(valToDeg(rpm), r - 14);
    needle.setAttribute('x2', x2);
    needle.setAttribute('y2', y2);
    needle.classList.toggle('over', rpm >= redline);
    value.textContent = Math.round(rpm);
    value.classList.toggle('over', rpm >= redline);
  }

  return { el: svg, update };
}

// ---- AIS radar (north-up plot of nearby vessels) --------------------------
export function createAisRadar() {
  const NS = 'http://www.w3.org/2000/svg';
  const size = 220;
  const c = size / 2;
  const R = c - 10;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.classList.add('ais-radar');

  // Range rings
  for (const frac of [1, 0.66, 0.33]) {
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', c); ring.setAttribute('cy', c);
    ring.setAttribute('r', R * frac);
    ring.setAttribute('class', 'radar-ring');
    svg.appendChild(ring);
  }
  // Cross hairs
  for (const [x1, y1, x2, y2] of [[c, 6, c, size - 6], [6, c, size - 6, c]]) {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('class', 'radar-cross');
    svg.appendChild(l);
  }
  // North marker
  const north = document.createElementNS(NS, 'text');
  north.setAttribute('x', c); north.setAttribute('y', 16);
  north.setAttribute('class', 'radar-north');
  north.textContent = 'N';
  svg.appendChild(north);

  // Own vessel at center
  const own = document.createElementNS(NS, 'circle');
  own.setAttribute('cx', c); own.setAttribute('cy', c); own.setAttribute('r', 4);
  own.setAttribute('class', 'radar-own');
  svg.appendChild(own);

  // Range label
  const rangeLabel = document.createElementNS(NS, 'text');
  rangeLabel.setAttribute('x', c + 4); rangeLabel.setAttribute('y', size - 8);
  rangeLabel.setAttribute('class', 'radar-range');
  svg.appendChild(rangeLabel);

  // Dynamic layer for targets
  const layer = document.createElementNS(NS, 'g');
  svg.appendChild(layer);

  // targets: [{ bearingDeg, rangeMeters, cogDeg, alarm }], maxRange in meters
  function update(targets, maxRange) {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    rangeLabel.textContent = maxRange >= 1852
      ? `${(maxRange / 1852).toFixed(1)} NM`
      : `${Math.round(maxRange)} m`;

    for (const t of targets) {
      if (t.rangeMeters == null || t.bearingDeg == null) continue;
      const frac = Math.min(t.rangeMeters / maxRange, 1);
      const a = (t.bearingDeg - 90) * Math.PI / 180;
      const x = c + R * frac * Math.cos(a);
      const y = c + R * frac * Math.sin(a);
      const tri = document.createElementNS(NS, 'polygon');
      tri.setAttribute('points', `${x},${y - 6} ${x - 4},${y + 5} ${x + 4},${y + 5}`);
      tri.setAttribute('class', 'radar-target' + (t.alarm ? ' alarm' : ''));
      if (t.cogDeg != null) tri.setAttribute('transform', `rotate(${t.cogDeg} ${x} ${y})`);
      layer.appendChild(tri);
    }
  }

  return { el: svg, update };
}
