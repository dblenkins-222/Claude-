# Running Signal K on a Raspberry Pi

This guide sets up a Raspberry Pi as the Signal K server that feeds the Boat
Monitor dashboard. Once it's running, you'll connect your **NMEA 2000** network
and **Victron Cerbo GX** to it, then point the dashboard at the Pi's address.

> These steps follow the official Signal K installation guide. See the
> [Signal K Raspberry Pi installation docs](https://demo.signalk.org/documentation/installation/raspberry_pi_installation.html)
> for the authoritative, always-current version.
> *Content was rephrased for compliance with licensing restrictions.*

## 1. Hardware you'll need

- **Raspberry Pi 3, 4, or 5** (a Pi 4 with 2GB+ is a comfortable choice).
  Node.js 24 needs a **64-bit** OS, so these models are required.
- A quality microSD card (32GB+) or, ideally, an SSD for reliability afloat.
- A way to get marine data onto the Pi:
  - **NMEA 2000:** a CAN interface such as a **PICAN-M HAT** (powers the Pi
    from the N2K bus) or a USB gateway like an **Actisense NGT-1** /
    **Yacht Devices YDNU-02**.
  - **NMEA 0183:** a USB-to-serial adapter.
- Network: Wi-Fi or Ethernet on the same network as your tablet.

## 2. Install the operating system

1. Flash **Raspberry Pi OS (64-bit)** using the Raspberry Pi Imager. The Lite
   image is fine — Signal K's interface is browser-based, so no desktop is
   needed (a "headless" install).
2. In the Imager's advanced settings, set the hostname (e.g. `signalk`), enable
   SSH, and configure Wi-Fi so you can reach it without a monitor.
3. Boot the Pi and connect via SSH: `ssh pi@signalk.local`.

## 3. Install dependencies

Update the package list:

```bash
sudo apt update
```

Install **Node.js 24** and npm. Follow the Debian/Ubuntu instructions at
[NodeSource](https://github.com/nodesource/distributions), for example:

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g npm@latest
```

Verify the versions (Node should be >= 24, npm >= 11):

```bash
node -v && npm -v
```

Install **Avahi** (mDNS/Bonjour) so apps and devices can discover the server by
name on the network:

```bash
sudo apt install -y libnss-mdns avahi-utils libavahi-compat-libdnssd-dev
```

## 4. Install Signal K Server

```bash
sudo npm install -g signalk-server
```

Test it with the built-in sample data:

```bash
signalk-server --sample-nmea0183-data
```

You should see output indicating the server is running at `0.0.0.0:3000`. Open a
browser on any device on the same network and go to `http://signalk.local:3000`
(or `http://<pi-ip>:3000`). Press `Ctrl+C` in the terminal to stop the sample.

## 5. Run the setup script (auto-start on boot)

To have Signal K run as a service that starts automatically when the Pi powers
up, run the setup script:

```bash
sudo signalk-server-setup
```

It will prompt for a few options (admin user, port, whether to enable SSL) and
install a systemd service. After it finishes, Signal K starts on boot. Useful
service commands:

```bash
sudo systemctl status signalk.service
sudo systemctl restart signalk.service
sudo journalctl -u signalk.service -f      # live logs
```

## 6. Secure the admin UI

Open `http://<pi-ip>:3000`, go to **Security**, and create an admin account.
This protects configuration while still allowing read-only data access for the
dashboard (you can tune this under Security → Access Requests / Users).

## 7. Connect your NMEA 2000 network

In the admin UI go to **Server → Data Connections → Add**.

- **PICAN-M / SocketCAN HAT:** first enable the CAN interface on the Pi (add
  `dtoverlay=mcp2515-can0,oscillator=16000000,interrupt=25` to
  `/boot/firmware/config.txt` per your HAT's docs, reboot, then `sudo ip link
  set can0 up type can bitrate 250000`). In Signal K add a connection of type
  **NMEA 2000 (canboat)** using the `canbus-canboatjs` option on interface
  `can0`.
- **USB gateway (Actisense NGT-1, etc.):** add an **NMEA 2000** connection using
  the appropriate driver and the device path (e.g. `/dev/ttyUSB0`).

Signal K transforms the N2K PGNs into its data model automatically, so paths
like `navigation.speedOverGround` and `environment.depth.belowTransducer` start
populating. Watch them live under **Data Browser** in the admin UI.

## 8. Connect the Victron Cerbo GX

1. On the Cerbo: **Settings → Services → MQTT** and enable **MQTT on LAN
   (plaintext)** so Signal K can read it over the network.
2. In the Signal K admin UI go to **Appstore → Available**, search for
   **`signalk-venus-plugin`**, and install it.
3. After restart, open **Server → Plugin Config → Victron Venus**, enable it,
   and set the connection to the Cerbo (choose the MQTT option and enter the
   Cerbo's IP address).
4. Victron data now appears under `electrical.batteries.*`, `electrical.solar.*`,
   `tanks.*`, etc. — the same paths the dashboard reads.

> Tip: If your Cerbo runs **Venus OS Large**, it can run Signal K itself and you
> may not need the Pi at all. The Pi route is the more flexible option and keeps
> Signal K independent of Victron firmware updates.

## 9. Point the dashboard at the Pi

On the tablet, open the Boat Monitor, tap **⚙ Settings**, and enter:

- **Host/IP:** `signalk.local` (or the Pi's IP address, e.g. `192.168.1.50`)
- **Port:** `3000`

Save, then tap **Live**. The connection light turns green when data is flowing.

### Optional: host the dashboard from Signal K

You can serve this dashboard from the Pi itself so there's a single address to
remember. Copy the project folder into Signal K's public directory (commonly
`~/.signalk/public/` — check your install) and it will be served alongside the
admin UI.

## Troubleshooting

| Symptom | Check |
|---|---|
| Dashboard stuck on "Connecting…" | Confirm the Pi's IP/port; ensure tablet and Pi are on the same network; verify `signalk.local` resolves (Avahi installed). |
| Tiles show `--` / dimmed ⚠ | The path isn't being produced. Confirm the source in the admin **Data Browser**; battery/tank IDs may differ from the defaults (see the mapping table in the main README). |
| No N2K data | `sudo ip link show can0` should show the interface UP; check bus bitrate (usually 250000) and termination. |
| No Victron data | Confirm MQTT on LAN is enabled on the Cerbo and the plugin points at the correct IP. |
