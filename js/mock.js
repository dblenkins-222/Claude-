// Mock data generator.
// Produces realistic, gently-wandering values in Signal K SI units and pushes
// them into the same store the live client uses. This lets the whole dashboard
// be developed and demonstrated with no hardware attached.

import { store } from './state.js';
import { settings } from './config.js';

let timer = null;

// Internal simulation state (SI units).
const sim = {
  sog: 3.2,            // m/s (~6.2 kn)
  heading: 1.9,        // rad (~109°)
  cog: 1.95,           // rad
  depth: 8.4,          // m
  lat: 43.6532,        // Toronto-ish
  lon: -79.3832,
  windSpeedApp: 6.0,   // m/s
  windAngleApp: 0.6,   // rad (starboard)
  windSpeedTrue: 7.5,  // m/s
  windAngleTrue: 0.9,  // rad
  waterTemp: 291.15,   // K (18 °C)
  airTemp: 294.15,     // K (21 °C)
  // Victron / electrical
  battSoc: 0.86,       // ratio
  battVoltage: 13.2,   // V
  battCurrent: -8.5,   // A (negative = discharge)
  solarPower: 240,     // W
  acLoad: 320,         // W
  // Tanks (ratio)
  fuel: 0.62,
  freshWater: 0.48,
  blackWater: 0.31,
};

// Per-engine simulation state, keyed by Signal K instance id, so each engine
// (port / starboard) wanders independently.
const engineSim = {};
function ensureEngine(id, seed = 0) {
  if (!engineSim[id]) {
    engineSim[id] = {
      rpmHz: 30 + seed * 0.4,   // Hz (~1800 rpm)
      temp: 358.15 + seed,      // K (~85 °C)
      oil: 400000 - seed * 4000, // Pa (~4 bar)
      load: 0.55,               // ratio
    };
  }
  return engineSim[id];
}

// Generator simulation state.
const genSim = {
  runTimeS: 1284.6 * 3600,   // total hours -> seconds
  load: 0.42,                // ratio
  temp: 361.15,              // K (~88 °C)
  oil: 300000,               // Pa (~3 bar)
  capacityW: 8000,           // 8 kW genset
};

// A few AIS targets, positioned relative to own vessel and drifting about.
const aisTargets = [
  { ctx: 'vessels.urn:mrn:imo:mmsi:316001234', name: 'PACIFIC VOYAGER', type: 70, dLat: 0.012, dLon: 0.008, sog: 5.1, cog: 3.4 },
  { ctx: 'vessels.urn:mrn:imo:mmsi:247008888', name: 'BLUE HORIZON', type: 36, dLat: -0.006, dLon: 0.011, sog: 2.3, cog: 1.1 },
  { ctx: 'vessels.urn:mrn:imo:mmsi:366123456', name: 'HARBOR PILOT 3', type: 50, dLat: 0.004, dLon: -0.009, sog: 0.2, cog: 0.0 },
  { ctx: 'vessels.urn:mrn:imo:mmsi:271000555', name: 'SEA BREEZE', type: 37, dLat: -0.014, dLon: -0.005, sog: 6.8, cog: 4.9 },
];

function wander(value, delta, min, max) {
  let v = value + (Math.random() - 0.5) * delta;
  if (v < min) v = min;
  if (v > max) v = max;
  return v;
}

function tick() {
  const now = Date.now();
  const meta = { timestamp: now, source: 'demo' };

  sim.sog = wander(sim.sog, 0.3, 0, 9);
  sim.heading = wander(sim.heading, 0.04, 0, Math.PI * 2);
  sim.cog = sim.heading + (Math.random() - 0.5) * 0.1;
  sim.depth = wander(sim.depth, 0.6, 1.5, 40);
  sim.lat = wander(sim.lat, 0.0002, 43.0, 44.0);
  sim.lon = wander(sim.lon, 0.0002, -80.0, -79.0);
  sim.windSpeedApp = wander(sim.windSpeedApp, 0.5, 0, 20);
  sim.windAngleApp = wander(sim.windAngleApp, 0.08, -Math.PI, Math.PI);
  sim.windSpeedTrue = wander(sim.windSpeedTrue, 0.5, 0, 22);
  sim.windAngleTrue = wander(sim.windAngleTrue, 0.08, -Math.PI, Math.PI);
  sim.waterTemp = wander(sim.waterTemp, 0.05, 283, 300);
  sim.airTemp = wander(sim.airTemp, 0.05, 283, 305);

  // Battery slowly discharges then a bit of solar tops it up.
  sim.battCurrent = wander(sim.battCurrent, 2, -30, 15);
  sim.battSoc = Math.min(1, Math.max(0.1, sim.battSoc + sim.battCurrent * 0.000002));
  sim.battVoltage = 12.4 + sim.battSoc * 1.4 + (Math.random() - 0.5) * 0.05;
  sim.solarPower = wander(sim.solarPower, 40, 0, 600);
  sim.acLoad = wander(sim.acLoad, 30, 0, 1500);
  sim.fuel = Math.max(0, sim.fuel - 0.00002);
  sim.freshWater = Math.max(0, sim.freshWater - 0.00003);
  sim.blackWater = Math.min(1, sim.blackWater + 0.00002);

  const set = (path, value) => store.set(path, value, meta);

  set('navigation.speedOverGround', sim.sog);
  set('navigation.headingTrue', sim.heading);
  set('navigation.courseOverGroundTrue', sim.cog);
  set('navigation.position.latitude', sim.lat);
  set('navigation.position.longitude', sim.lon);
  set('environment.depth.belowTransducer', sim.depth);

  set('environment.wind.speedApparent', sim.windSpeedApp);
  set('environment.wind.angleApparent', sim.windAngleApp);
  set('environment.wind.speedTrue', sim.windSpeedTrue);
  set('environment.wind.angleTrueWater', sim.windAngleTrue);

  set('environment.water.temperature', sim.waterTemp);
  set('environment.outside.temperature', sim.airTemp);

  set('electrical.batteries.house.stateOfCharge', sim.battSoc);
  set('electrical.batteries.house.voltage', sim.battVoltage);
  set('electrical.batteries.house.current', sim.battCurrent);
  set('electrical.batteries.house.power', sim.battVoltage * sim.battCurrent);
  set('electrical.solar.pv.panelPower', sim.solarPower);
  set('electrical.ac.consumption.power', sim.acLoad);

  set('tanks.fuel.main.currentLevel', sim.fuel);
  set('tanks.freshWater.main.currentLevel', sim.freshWater);
  set('tanks.blackWater.main.currentLevel', sim.blackWater);

  // Engines — each configured engine wanders independently.
  settings.engines.forEach((engine, i) => {
    const e = ensureEngine(engine.id, i * 6);
    e.rpmHz = wander(e.rpmHz, 1.2, 12, 55);        // ~720..3300 rpm
    e.temp = wander(e.temp, 0.4, 340, 372);         // ~67..99 °C
    e.oil = wander(e.oil, 8000, 250000, 520000);    // ~2.5..5.2 bar
    e.load = wander(e.load, 0.05, 0.05, 1);
    set(`propulsion.${engine.id}.revolutions`, e.rpmHz);
    set(`propulsion.${engine.id}.temperature`, e.temp);
    set(`propulsion.${engine.id}.oilPressure`, e.oil);
    set(`propulsion.${engine.id}.engineLoad`, e.load);
  });

  // Generator — simulate a running genset.
  const gen = settings.generator;
  if (gen && gen.id) {
    genSim.load = wander(genSim.load, 0.06, 0.15, 1.0);
    genSim.temp = wander(genSim.temp, 0.4, 350, 372);
    genSim.oil = wander(genSim.oil, 6000, 220000, 380000);
    genSim.runTimeS += 1;
    const voltage = gen.nominalVoltage + (Math.random() - 0.5) * 3;
    const frequency = gen.nominalFrequency + (Math.random() - 0.5) * 0.3;
    // 60 Hz gensets spin ~1800 rpm (30 Hz); 50 Hz ~1500 rpm (25 Hz).
    const rpmHz = (gen.nominalFrequency === 50 ? 25 : 30) + (Math.random() - 0.5) * 0.4;
    const power = genSim.load * genSim.capacityW;
    const g = (suffix, value) => set(`electrical.generators.${gen.id}.${suffix}`, value);
    g('state', 'running');
    g('revolutions', rpmHz);
    g('runTime', genSim.runTimeS);
    g('temperature', genSim.temp);
    g('oilPressure', genSim.oil);
    g('voltage', voltage);
    g('frequency', frequency);
    g('power', power);
    g('current', power / voltage);
    g('load', genSim.load);
  }

  // AIS targets drift around, offset from our own position.
  for (const t of aisTargets) {
    t.dLat = wander(t.dLat, 0.0004, -0.03, 0.03);
    t.dLon = wander(t.dLon, 0.0004, -0.03, 0.03);
    t.sog = wander(t.sog, 0.4, 0, 12);
    t.cog = wander(t.cog, 0.1, 0, Math.PI * 2);
    store.setVesselValue(t.ctx, 'name', t.name, meta);
    store.setVesselValue(t.ctx, 'design.aisShipType', { id: t.type }, meta);
    store.setVesselValue(t.ctx, 'navigation.position',
      { latitude: sim.lat + t.dLat, longitude: sim.lon + t.dLon }, meta);
    store.setVesselValue(t.ctx, 'navigation.speedOverGround', t.sog, meta);
    store.setVesselValue(t.ctx, 'navigation.courseOverGroundTrue', t.cog, meta);
  }
}

export function startMock() {
  stopMock();
  store.setConnection('demo');
  tick(); // immediate first paint
  timer = setInterval(tick, 1000);
}

export function stopMock() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
