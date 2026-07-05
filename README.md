# Boat Monitor

A tablet-friendly HTML dashboard for monitoring boat systems while underway.
It reads live data from a **Signal K server**, which aggregates both
**NMEA 2000** instruments and a **Victron Cerbo GX**, and presents it in a
glanceable helm display. A built-in **demo mode** runs with simulated data so
you can use the dashboard with no hardware attached.

## Architecture

```
NMEA 2000 ─┐
           ├─► Signal K server ──(WebSocket + REST)──► Boat Monitor (this app)
Cerbo GX  ─┘   (on Cerbo or Pi)      SI-unit data model
```

- **NMEA 2000** is transformed into the Signal K data model (via the Cerbo's
  VE.Can port or a CAN gateway such as an Actisense NGT-1 / Yacht Devices).
- **Victron Cerbo GX** data is read into Signal K via the
  [`signalk-venus-plugin`](https://www.npmjs.com/package/signalk-venus-plugin)
  over the Cerbo's MQTT/D-Bus interface.
- The Cerbo GX can also run Signal K **directly** if you install
  [Venus OS Large](https://www.victronenergy.com/live/venus-os:large), so in
  many setups no extra Raspberry Pi is required.

This app is a pure client: it only speaks the Signal K WebSocket/REST API, so
all hardware plumbing lives on the server side.

> **Don't have a Signal K server yet?** There are two setup guides, depending on
> where you want to run Signal K:
>
> - [docs/signalk-venus-os-cerbo-setup.md](docs/signalk-venus-os-cerbo-setup.md)
>   — run Signal K **directly on your Cerbo GX** via Venus OS Large (simplest,
>   no extra hardware; Victron data is pre-integrated).
> - [docs/signalk-raspberry-pi-setup.md](docs/signalk-raspberry-pi-setup.md)
>   — run Signal K on a **dedicated Raspberry Pi** (more flexible; easy to add
>   Grafana/InfluxDB and other components).
>
> Both connect to your NMEA 2000 network and Victron Cerbo GX. See the top of
> the Cerbo guide for a side-by-side comparison to help you choose.

## Features

- Navigation: speed (SOG), heading with live compass, course (COG), depth, GPS position
- Engine: RPM tachometer gauge, engine temperature, oil pressure, engine load (with red-line / over-temp / low-oil warnings)
- Wind: apparent wind dial plus apparent/true speed and angle
- **AIS targets**: north-up radar plot of nearby vessels plus a ranged list (name, distance, bearing, speed); close contacts are highlighted
- **Anchor watch**: drop/weigh anchor, adjustable alarm radius, live drift distance and bearing, with an audible + full-screen visual **drag alarm**
- Environment: water and air temperature
- Electrical (Victron): battery state of charge, voltage, current, solar (PV), AC load
- Tanks: fuel, fresh water, black water with low/high level warnings
- Demo mode with realistic simulated data (including AIS traffic and engine data)
- Day / night themes and configurable units (knots/kmh, °C/°F, m/ft)
- Stale-data indicators when a sensor stops updating

## Running

It's a buildless static site (ES modules), so serve the folder with any static
web server and open it on the tablet's browser:

```bash
# from the project root
python3 -m http.server 8080
# then browse to http://<this-machine-ip>:8080
```

You can also host the folder directly from the Signal K server as a webapp.

### Connecting to live data

1. Open **Settings** (gear icon).
2. Enter your Signal K server **Host/IP** and **Port** (default `3000`).
3. Save, then tap **Live**.

The **Demo** button switches back to simulated data at any time.

## Signal K paths consumed

| Display            | Signal K path                                  |
|--------------------|------------------------------------------------|
| Speed (SOG)        | `navigation.speedOverGround`                   |
| Heading            | `navigation.headingTrue` / `headingMagnetic`   |
| Course (COG)       | `navigation.courseOverGroundTrue`              |
| Position           | `navigation.position`                          |
| Depth              | `environment.depth.belowTransducer`            |
| Apparent wind      | `environment.wind.speedApparent` / `angleApparent` |
| True wind          | `environment.wind.speedTrue` / `angleTrueWater`|
| Water / air temp   | `environment.water.temperature` / `environment.outside.temperature` |
| Engine RPM         | `propulsion.<id>.revolutions` (Hz → RPM)       |
| Engine temp        | `propulsion.<id>.temperature`                  |
| Oil pressure       | `propulsion.<id>.oilPressure`                  |
| Engine load        | `propulsion.<id>.engineLoad`                   |
| Battery            | `electrical.batteries.house.*`                 |
| Solar              | `electrical.solar.pv.panelPower`               |
| AC load            | `electrical.ac.consumption.power`              |
| Tanks              | `tanks.fuel.main` / `tanks.freshWater.main` / `tanks.blackWater.main` |
| AIS targets        | `vessels.*` (position, SOG, COG, name, MMSI)   |

Battery and tank path IDs (e.g. `house`, `main`) may differ on your boat —
adjust them in `js/dashboard.js` and `js/mock.js` to match your Signal K server.
Engines are configurable in **Settings → Engines** (name + Signal K instance
id per engine). The app ships configured for twin engines — **Caterpillar C9
Port** (`propulsion.port`) and **Caterpillar C9 Starboard**
(`propulsion.starboard`) — each rendered as its own panel. Leave an engine's id
blank to hide it, or rename either to match your vessel.

### AIS & the anchor watch

- **AIS** targets are read from the Signal K delta stream's per-vessel contexts
  (any `vessels.*` other than your own). Ranges and bearings are computed
  on-device from your GPS position, so AIS needs a valid own position to plot.
- The **anchor watch** is computed entirely in the app: it captures your current
  position when you tap *Drop Anchor*, stores it (and the radius) locally, and
  alarms if the great-circle distance exceeds the radius. It works in demo mode
  too. The audible alarm uses the Web Audio API — tap *Drop Anchor* (a user
  gesture) so the browser allows sound.
