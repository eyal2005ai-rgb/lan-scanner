# 🌐 LAN Scanner

A cross-platform desktop app for scanning your local network — built with Electron.

## Features

- **IP Sweep** — Discovers all live hosts on your subnet
- **Hostname Resolution** — DNS reverse lookup for each device
- **MAC Address** — Reads from the system ARP table
- **Vendor Lookup** — Identifies device manufacturers via MAC OUI (requires internet)
- **Ping** — Shows round-trip time for each host
- **Port Scanner** — Checks 20 common ports (HTTP, HTTPS, SSH, RDP, SMB, etc.)
- **Table & Card views** — Switch between detailed table and compact card layout
- **Live Terminal** — Real-time scan log in the bottom panel
- **Export** — Save results as JSON or CSV
- **Cross-platform** — Windows, macOS, Linux

## Requirements

- [Node.js](https://nodejs.org/) v16+
- [npm](https://www.npmjs.com/) (comes with Node.js)
- **Linux**: May need `sudo` for ARP scans, or run as root

## Installation

```bash
# Clone or extract the project
cd lan-scanner

# Install dependencies
npm install

# Start the app
npm start
```

## Building Installers

```bash
# Windows (.exe)
npm run build-win

# macOS (.dmg)
npm run build-mac

# Linux (.AppImage)
npm run build-linux
```

Installers are output to the `dist/` folder.

## How It Works

1. **Network Detection** — Reads your active network interfaces using Node.js `os` module
2. **Subnet Sweep** — Calculates the /24 subnet and pings all 254 possible hosts concurrently (in batches of 50)
3. **MAC Lookup** — After a host responds to ping, it queries the system ARP cache (`arp -a`)
4. **Vendor Lookup** — Sends the MAC prefix to `api.macvendors.com` (requires internet)
5. **Port Scan** — Attempts TCP connections to 20 common ports per host, with 1s timeout

## Ports Scanned

| Port | Service |
|------|---------|
| 21   | FTP     |
| 22   | SSH     |
| 23   | Telnet  |
| 25   | SMTP    |
| 53   | DNS     |
| 80   | HTTP    |
| 81   | HTTP-Alt |
| 443  | HTTPS   |
| 445  | SMB     |
| 3306 | MySQL   |
| 3389 | RDP     |
| 4433 | HTTPS-Alt |
| 5900 | VNC     |
| 8080 | HTTP-Proxy |
| ... and more |

## Notes

- **Scan time**: A full /24 subnet scan with ports takes 2–5 minutes depending on network size
- **Vendor lookup**: Requires internet connection; caches results per session
- **Admin/root**: On some systems, ARP resolution works best with admin privileges
- **Firewall**: Hosts behind firewalls may not respond to ping but could still have open ports

## Project Structure

```
lan-scanner/
├── main.js          # Electron main process + scan logic
├── preload.js       # Secure IPC bridge
├── package.json
├── renderer/
│   ├── index.html   # Main UI
│   ├── styles.css   # Cyberpunk dark theme
│   └── app.js       # UI logic
└── README.md
```
