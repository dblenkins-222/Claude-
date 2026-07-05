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
- **Electrical tab**: a dedicated power page with the house battery / Victron **SmartShunt**, **12 VDC loads** (calculated from the SmartShunt), **240 VAC loads**, and the **Onan generator** (run status, output power/voltage/frequency, load, coolant temp, oil pressure, RPM, runtime hours) — including a **generator Start / Stop button**
- Wind: apparent wind dial plus apparent/true speed and angle
- **AIS targets**: north-up radar plot of nearby vessels plus a ranged list (name, distance, bearing, speed); close contacts are highlighted
- **Anchor watch**: drop/weigh anchor, adjustable alarm radius, live drift distance and bearing, with an audible + full-screen visual **drag alarm**
- Environment: water and air temperature
- Electrical (Victron): battery state of charge, voltage, current, solar (PV), AC load
- Tanks: fuel, fresh water, black water with low/high level warnings
- **Weather radar tab**: a live map centered on your GPS position with animated precipitation radar (play/pause + timeline), a boat marker that follows you, and a nautical seamark overlay
- **Cameras tab**: up to 4 IP camera streams in an adaptive grid with tap-to-expand (MJPEG, JPEG snapshot, HLS, and plain video)
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

### Weather radar

Switch to the **Weather Radar** tab (top of the screen) for an animated
precipitation map centered on the vessel. It reads your position from Signal K
(falling back to the tablet's browser geolocation, then a default), drops a boat
marker that follows you, and loops the most recent radar frames. Drag the map to
look around; tap **⌖ Boat** to recenter and resume following.

The radar and map require an internet connection (it streams map/radar tiles).
External data sources — thank you to these free providers:

- Map library: [Leaflet](https://leafletjs.com)
- Base map tiles: OpenStreetMap contributors & [CARTO](https://carto.com/)
- Precipitation radar: [RainViewer](https://www.rainviewer.com) public API (no key required)
- Nautical seamarks: [OpenSeaMap](https://www.openseamap.org)

### Cameras

The **Cameras** tab shows up to 4 IP camera streams in an adaptive grid — tap
any feed to expand it to full screen, tap again to restore. Streams start when
the tab is open and stop when you leave it to save bandwidth. Configure them in
**⚙ Settings → Cameras** (name, URL, and type). Streams play with the browser's
native capabilities:

| Type | Notes |
|------|-------|
| **MJPEG** | Played in an `<img>`; works out of the box (many cameras expose `.../mjpg/video.mjpg`) |
| **JPEG snapshot** | Polls a still-image URL ~1×/sec |
| **HLS** (`.m3u8`) | Native on iOS/Safari; elsewhere [hls.js](https://github.com/video-dev/hls.js) is loaded on demand |
| **Video** | Plain `mp4` / `webm` over HTTP |
| **RTSP** | **Not playable in a browser.** Route it through a gateway such as [go2rtc](https://github.com/AlexxIT/go2rtc), [MediaMTX](https://github.com/bluenviron/mediamtx), or [Frigate](https://frigate.video/) that re-publishes the camera as HLS or MJPEG, then use that URL. |

*Type* defaults to **Auto**, which infers the format from the URL. In demo mode
with no cameras configured, a public test HLS stream is shown so you can confirm
the tab works.

### Electrical

The **Electrical** tab consolidates the boat's power systems:

- **House battery / SmartShunt** — state of charge, voltage, current, power, and time-remaining (`electrical.batteries.<shunt>.*`)
- **12 VDC loads** — calculated from the SmartShunt as *bus voltage × discharge current*. Configure the shunt battery id, DC nominal voltage, and the discharge-current sign convention in **⚙ Settings → Electrical**.
- **240 VAC loads** — from `electrical.ac.consumption.*` (power, voltage, current)
- **Onan generator** — the full generator panel, moved here from the dashboard

**Generator Start / Stop button:** starting an engine remotely is safety-critical,
so the button asks for confirmation. In **demo mode** it simply toggles the
simulated genset. In **live mode** it sends a Signal K `PUT` to
`electrical/generators/<id>/state` — whether that actually starts the genset
depends on your Signal K server having a PUT handler wired to the Cerbo GX /
generator relay (e.g. via a plugin or Node-RED flow). If the server doesn't
support it, the button reports the failure rather than doing anything unsafe.

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
| Generator status   | `electrical.generators.<id>.state` (or inferred from revolutions/frequency) |
| Generator output   | `electrical.generators.<id>.voltage` / `frequency` / `current` / `power` |
| Generator load     | `electrical.generators.<id>.load`              |
| Generator engine   | `electrical.generators.<id>.revolutions` / `temperature` / `oilPressure` |
| Generator runtime  | `electrical.generators.<id>.runTime` (s → hrs) |
| Battery / SmartShunt | `electrical.batteries.<shunt>.voltage` / `current` / `stateOfCharge` / `power` / `capacity.timeRemaining` |
| 12 VDC loads       | derived: bus voltage × discharge current (from the SmartShunt) |
| Solar              | `electrical.solar.pv.panelPower`               |
| 240 VAC loads      | `electrical.ac.consumption.power` / `voltage` / `current` |
| Tanks              | `tanks.fuel.main` / `tanks.freshWater.main` / `tanks.blackWater.main` |
| AIS targets        | `vessels.*` (position, SOG, COG, name, MMSI)   |

Battery and tank path IDs (e.g. `house`, `main`) may differ on your boat —
adjust them in `js/dashboard.js` and `js/mock.js` to match your Signal K server.
Engines are configurable in **Settings → Engines** (name + Signal K instance
id per engine). The app ships configured for twin engines — **Caterpillar C9
Port** (`propulsion.port`) and **Caterpillar C9 Starboard**
(`propulsion.starboard`) — each rendered as its own panel. Leave an engine's id
blank to hide it, or rename either to match your vessel.

The **generator** is configurable in **Settings → Generator** (name, Signal K
id, and nominal voltage/frequency). It ships as **Onan Generator**
(`electrical.generators.onan`) with 120 V / 60 Hz nominals driving the
out-of-range warnings; set 230 V / 50 Hz for European systems, or clear the id
to hide the panel. Runtime detects "running" from an explicit `state` value if
your gateway provides one, otherwise from engine revolutions or output
frequency. The generator panel (and its **Start / Stop** button) now lives on
the **Electrical** tab.

The **12 VDC / 240 VAC** systems are configurable in **Settings → Electrical**:
the SmartShunt battery id, DC nominal voltage, whether the shunt reports
discharge as negative current, and the AC nominal voltage (240 V by default).

### AIS & the anchor watch

- **AIS** targets are read from the Signal K delta stream's per-vessel contexts
  (any `vessels.*` other than your own). Ranges and bearings are computed
  on-device from your GPS position, so AIS needs a valid own position to plot.
- The **anchor watch** is computed entirely in the app: it captures your current
  position when you tap *Drop Anchor*, stores it (and the radius) locally, and
  alarms if the great-circle distance exceeds the radius. It works in demo mode
  too. The audible alarm uses the Web Audio API — tap *Drop Anchor* (a user
  gesture) so the browser allows sound.
