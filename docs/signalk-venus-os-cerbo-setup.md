# Running Signal K directly on the Cerbo GX (Venus OS Large)

This is the **alternative** to running a separate Raspberry Pi. Your Cerbo GX
can run the Signal K server itself once you switch it to the **Venus OS Large**
firmware image. In many boats this means the Cerbo becomes your single data hub
for both Victron data and NMEA 2000 — no extra computer to buy, power, or
maintain.

> Steps below follow the official Victron
> [Venus OS Large documentation](https://www.victronenergy.com/live/venus-os:large).
> Refer to it for the authoritative, always-current version.
> *Content was rephrased for compliance with licensing restrictions.*

## Pi vs. Cerbo — which route?

| | **Cerbo GX (Venus OS Large)** | **Raspberry Pi** |
|---|---|---|
| Extra hardware | None — uses the Cerbo you already have | Separate Pi + power + storage |
| Maintenance | Updates come bundled with Venus OS | You maintain Linux + Node + Signal K |
| Victron data | Pre-integrated, zero config | Needs `signalk-venus-plugin` setup |
| Flexibility | Fixed Signal K version per firmware | Any version; easy to add Grafana/InfluxDB |
| Best for | Simplicity, all-in-one box | Power users, heavy add-ons |

Both are valid. The Cerbo route is the simpler, "complete product" option; the
Pi route (see [signalk-raspberry-pi-setup.md](signalk-raspberry-pi-setup.md)) is
more flexible. On a Pi you can even keep two SD cards and try both.

> **Note on resources:** Signal K is fairly CPU/RAM intensive. The Cerbo GX has
> plenty of headroom, but if you also run Node-RED heavily, keep an eye on load.
> (The older Venus GX is not recommended for running both at once.)

## 1. Confirm compatibility

The Cerbo GX and Cerbo-S GX both support Venus OS Large. No special
preparation is required before switching the image type.

## 2. Switch to the Venus OS Large firmware

On the Cerbo (via the touchscreen, a GX Touch, or the **Remote Console**):

1. Go to **Settings → General → Firmware → Online updates**.
2. Set **Image type** to **Large**.
3. Navigate back one level, check for a new version, and install it.

The download depends on your internet speed; the Cerbo then reboots and
installs (usually a couple of minutes).

## 3. Enable Signal K

1. After it reboots, go to the **Settings** menu and confirm the Large image
   installed (a new integrations section appears).
2. Enable **Signal K server**. This requires the **Installer** access level.

> Tip: Node-RED lives in the same menu (**Settings → Venus OS Large Features**).
> You can enable Signal K without Node-RED to save resources.

## 4. Open the Signal K admin panel

From a browser on the same network, go to **`http://venus.local:3000`**
(replace `venus.local` with the Cerbo's IP address if the name doesn't resolve,
e.g. `http://192.168.1.50:3000`).

This is the same port the Boat Monitor dashboard connects to.

## 5. Secure it and set vessel info

1. In the admin panel go to **Security → Users** and create an admin user with a
   strong password.
2. Go to **Settings** and enter basic vessel information (name, etc.).

## 6. NMEA 2000 — connect and confirm

The Cerbo's **VE.Can 1** port (interface `can0`) is **pre-configured** in Signal
K for NMEA 2000, so much of the work is already done:

1. Physically connect your NMEA 2000 backbone to the port labelled **VE.Can 1**
   (a VE.Can-to-NMEA2000 / Micro-C cable does the adapting).
2. In the **Remote Console**, make sure that port stays set as a **250 kbit/s
   VE.Can & NMEA 2000** port — Signal K relies on this.
3. In the Signal K admin panel, open **Server → Connections** and you'll see the
   pre-configured CAN connection. Then open the **Data Browser** to watch N2K
   paths (speed, depth, wind, AIS, engine data, etc.) populate live.

> On the Cerbo GX, `can0` = VE.Can 1 (default-enabled in Signal K). The
> **BMS-Can** port (`can1`) is **not** usable for NMEA 2000.
> On the Cerbo GX MK2 / Ekrano GX the equivalent is `vecan0` (isolated).

## 7. Victron data — already there

This is the big advantage of the Cerbo route: the **`signalk-venus-plugin`
comes pre-installed** and enabled. All your Victron data (battery SOC, voltage,
current, solar/MPPT, tanks, etc.) is already flowing into Signal K under
`electrical.*` and `tanks.*` — no configuration needed. Confirm it in the **Data
Browser**.

> A USB GPS plugged into the Cerbo is likewise picked up automatically by both
> Venus OS and Signal K — no setup required.

## 8. Point the dashboard at the Cerbo

On the tablet, open Boat Monitor → **⚙ Settings**:

- **Host/IP:** `venus.local` (or the Cerbo's IP address)
- **Port:** `3000`

Save, then tap **Live**. The status light turns green when data flows.

## Keeping it updated

Signal K on Venus OS is bundled with the firmware and can't be partially
updated in the normal way — the recommended path is to install a newer **Venus
OS Large** release when Victron ships one. Individual Signal K *plugins* can
still be updated from **Appstore → Installed** in the admin panel (they install
to the writable data partition and take priority over the bundled versions).

## Troubleshooting

| Symptom | Check |
|---|---|
| Can't reach `venus.local:3000` | Use the Cerbo's IP instead; confirm Signal K is enabled in Settings; confirm tablet is on the same network. |
| No NMEA 2000 data | Cabling on **VE.Can 1**; port set to 250 kbit VE.Can/NMEA2000 in Remote Console; check the connection under Server → Connections. |
| No Victron data | Should be automatic via the pre-installed venus plugin — check **Dashboard → Server → Plugin Config → Victron Venus** is enabled. |
| "Data partition full" warning (#46) | Signal K logging can fill `/data`. In Signal K → Server → Settings, ensure "keep only most recent data log files" is enabled. |
| Tiles show `--` / dimmed ⚠ | Path not being produced, or the battery/tank ID differs from the dashboard defaults — see the mapping table in the main README and adjust `js/dashboard.js`. |
