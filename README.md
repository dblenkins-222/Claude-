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

> **Wiring it up?** See [docs/wiring-diagram.md](docs/wiring-diagram.md) for the
> system + NMEA 2000 diagrams, **AC/DC power one-line diagrams**, a
> **connection reference** (each device → its app panel), and a **bill of
> materials** — tailored to this vessel (twin CAT C9s + Twin Disc via J1939
> gateways, Onan genset, Simrad NSS evo3 / AP44 / IS42 / RS100-B AIS, Muir
> windlass, Fusion, Cerbo GX, dual SmartShunts, Centaur charger, cameras).

## Features

- Navigation: speed (SOG), heading with live compass, course (COG), depth, GPS position
- Engine: RPM tachometer gauge, engine temperature, oil pressure, engine load (with red-line / over-temp / low-oil warnings)
- **Electrical tab**: a dedicated power page with the **House Battery Bank** and **Crank Battery Bank** (each from a Victron SmartShunt), **12 VDC loads** (calculated from the house SmartShunt), **240 VAC loads**, **24-hour line graphs of 12 VDC and 240 VAC consumption vs. production**, and the **Onan generator** (run status, output power/voltage/frequency, load, coolant temp, oil pressure, RPM, runtime hours) — including a **generator Start / Stop button**
- Wind: apparent wind dial plus apparent/true speed and angle
- **AIS targets**: north-up radar plot of nearby vessels plus a ranged list (name, distance, bearing, speed); close contacts are highlighted
- **Anchor watch**: drop/weigh anchor, adjustable alarm radius, live drift distance and bearing, with an audible + full-screen visual **drag alarm**
- Environment: water and air temperature
- Electrical (Victron): battery state of charge, voltage, current, solar (PV), AC load
- Tanks: fuel, fresh water, black water with low/high level warnings
- **Weather radar tab**: a live map centered on your GPS position with animated precipitation radar (play/pause + timeline), a boat marker that follows you, and a nautical seamark overlay — plus a **Today's Forecast** panel (min/max temp, wind, rain, humidity, UV, sunrise/sunset) and a **7-day extended forecast**
- **Tides tab**: a tide graph for the vessel's position (current height, next high/low, and a smooth 3-day curve with high/low markers and a "now" indicator), built for Australian waters
- **Cameras tab**: up to 4 IP camera streams in an adaptive grid with tap-to-expand (MJPEG, JPEG snapshot, HLS, and plain video)
- **Entertainment tab**: control the Fusion stereo over NMEA 2000 — source selection (AM / FM / Bluetooth / CD / AUX / DVD), now-playing info, play/pause, next/prev, and **per-zone volume + mute** (Saloon / Cockpit / Flybridge…)
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
- Precipitation radar: [RainViewer](https://www.rainviewer.com) public API (no key required), which aggregates national radar **including Australia's Bureau of Meteorology (BOM)**
- Nautical seamarks: [OpenSeaMap](https://www.openseamap.org)
- Forecast: [Open-Meteo](https://open-meteo.com) (no key required)

**Today's Forecast & 7-day extended forecast.** The forecast panel (right of the
map, or below it on narrow screens) shows current conditions, today's high/low,
wind and gusts, rainfall and chance of rain, humidity, UV index, and
sunrise/sunset, followed by a 7-day outlook. It **prefers the Australian BOM
ACCESS-G model** (`/v1/bom`) for the location and automatically falls back to
Open-Meteo's best available model when ACCESS-G has no data — the source in use
is shown at the bottom of the panel.

**A note on Australian radar:** BOM does not publish a public, browser-embeddable
(CORS-enabled) map-tile service — its radar is delivered as per-site loop images.
RainViewer already aggregates BOM radar for Australian coverage, so the radar
layer shows Australian radar when you're in range, without needing to scrape BOM
directly.

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

- **House Battery Bank** — state of charge, voltage, current, power, and time-remaining (from a Victron SmartShunt, `electrical.batteries.<houseShunt>.*`)
- **Crank Battery Bank** — state of charge, voltage, current, power from a second Victron SmartShunt (`electrical.batteries.<crankShunt>.*`)
- **Solar · MPPT** — PV power, PV voltage, charge current, and today's yield (`electrical.solar.<id>.*`)
- **12 VDC loads** — calculated from the house SmartShunt as *bus voltage × discharge current*. Configure the house and crank shunt battery ids, DC nominal voltage, and the discharge-current sign convention in **⚙ Settings → Electrical**.
- The standalone "Electrical · Victron" panel has been removed from the Dashboard; electrical data now lives on this tab.
- **24-hour power graphs** — two line charts show **consumption vs. production** over the last 24 h for **12 VDC** (discharge vs. charge, from the house SmartShunt) and **240 VAC** (`electrical.ac.consumption.power` vs. `electrical.ac.input.power`). Power is sampled once a minute into a rolling 24 h buffer; in **live mode** it's persisted to the browser so a reload keeps the history, and in **demo mode** a realistic 24 h is pre-seeded. (240 VAC production needs an AC source meter / inverter-charger reporting `electrical.ac.input.power`; without one the production line stays flat.)
- **240 VAC loads** — from `electrical.ac.consumption.*` (power, voltage, current)
- **Onan generator** — the full generator panel, moved here from the dashboard

**Generator Start / Stop button:** starting an engine remotely is safety-critical,
so the button asks for confirmation. In **demo mode** it simply toggles the
simulated genset. In **live mode** it sends a Signal K `PUT` to
`electrical/generators/<id>/state` — whether that actually starts the genset
depends on your Signal K server having a PUT handler wired to the Cerbo GX /
generator relay (e.g. via a plugin or Node-RED flow). If the server doesn't
support it, the button reports the failure rather than doing anything unsafe.

### Tides

The **Tides** tab plots the tidal curve (sea level relative to mean sea level)
for the vessel's position, with the current height, the next high and low tides,
and a smooth 3-day graph marking each high/low and a "now" line. It's intended
for **Australian waters** and uses the free [Open-Meteo Marine API](https://open-meteo.com)
(`sea_level_height_msl`, no key required, global coverage). Heights follow your
depth-unit setting (m/ft). The demo location is **The Boat Works, Coomera QLD
4209** (on the tidal Coomera River), so the demo shows real Coomera tides. If a
vessel is ever inland with no tide, the graph falls back to Coomera with a note.

### Onboard hosting & cellular use

The tablet reaches the internet via **cellular or WiFi**. The app needs two
kinds of connection: your **Signal K server** (on the boat's local network) and
a few **HTTPS APIs** (radar, forecast, tides).

- On the boat's **WiFi** (with internet via a cellular router / Starlink),
  everything works: live Signal K + LAN cameras *and* the online weather/tide data.
- On the tablet's **cellular alone** (off the boat network), the online
  weather/forecast/tides still work, but live Signal K data and LAN cameras are
  not reachable — they live on the boat's network (unless exposed remotely via
  VRM/VPN/port-forward).

**For live use, host the app from the boat over `http://`.** Browsers block an
HTTPS page (like the GitHub Pages demo) from connecting to a local `ws://` Signal
K server or `http://` LAN cameras (mixed-content). Serving the app from the
Signal K server — or any local static server on the boat — over `http://` avoids
this: local data works, and the page can still load the external HTTPS
weather/tide APIs. Copy the project into Signal K's public/static directory, or
serve the folder locally. Use the GitHub Pages URL for demos/UI review; use
onboard hosting underway.

**Data usage:** enable **Data saver** in Settings on metered cellular. It pauses
the weather-radar animation and background refresh whenever the Weather tab isn't
open, and shows a single static radar frame instead of looping. The dashboard,
electrical and LAN-camera data use no internet; forecast and tides are only a few
KB per refresh.

### Entertainment (Fusion stereo)

The **Entertainment** tab controls the Fusion stereo over NMEA 2000. It shows the
current **source**, now-playing track/station and play state (unit-wide), and lets
you switch between **AM, FM, Bluetooth, CD, AUX and DVD**, play/pause and skip.
**Volume and mute are per speaker zone** — each configured zone (e.g. Saloon,
Cockpit, Flybridge) gets its own slider and mute. In demo mode it's fully simulated.

For live control it uses the [`signalk-fusion-stereo`](https://www.npmjs.com/package/signalk-fusion-stereo)
plugin on your Signal K server, which reads/writes
`entertainment.device.<id>.output.<zone>.*`. In **⚙ Settings → Entertainment**,
set the **Fusion device id** and **name each speaker zone** you have (zone1–zone4;
leave a zone blank to hide it). Exact source names/indexes vary by unit, so source
switching may need to match your stereo's setup.

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
