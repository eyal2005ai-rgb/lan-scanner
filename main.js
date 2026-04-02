const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const net = require('net');
const dns = require('dns').promises;
const { execSync, exec } = require('child_process');

let mainWindow;
let scanCancelled = false;

// ─── Window Setup ────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: '#0a0e1a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
  });
  mainWindow.loadFile('renderer/index.html');
}

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── Window Controls ─────────────────────────────────────────────────────────
ipcMain.on('window-minimize', () => mainWindow.minimize());
ipcMain.on('window-maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow.close());

// ─── Network Utilities ───────────────────────────────────────────────────────
function getLocalNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const results = [];
  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        results.push({
          interface: name,
          ip: addr.address,
          netmask: addr.netmask,
          cidr: addr.cidr,
          mac: addr.mac,
        });
      }
    }
  }
  return results;
}

function ipToLong(ip) {
  return ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
}

function longToIp(num) {
  return [
    (num >>> 24) & 255,
    (num >>> 16) & 255,
    (num >>> 8) & 255,
    num & 255,
  ].join('.');
}

function getSubnetRange(ip, netmask) {
  const ipLong = ipToLong(ip);
  const maskLong = ipToLong(netmask);
  const network = ipLong & maskLong;
  const broadcast = network | (~maskLong >>> 0);
  const hosts = [];
  for (let i = network + 1; i < broadcast; i++) {
    hosts.push(longToIp(i));
  }
  return hosts;
}

// ─── Ping ─────────────────────────────────────────────────────────────────────
function pingHost(ip) {
  return new Promise((resolve) => {
    const platform = process.platform;
    let cmd;
    if (platform === 'win32') {
      cmd = `ping -n 1 -w 500 ${ip}`;
    } else {
      cmd = `ping -c 1 -W 1 ${ip}`;
    }
    exec(cmd, { timeout: 3000 }, (error, stdout) => {
      if (error) {
        resolve({ alive: false, time: null });
        return;
      }
      // Extract time from ping output
      const timeMatch = stdout.match(/time[<=]([\d.]+)\s*ms/i);
      const time = timeMatch ? parseFloat(timeMatch[1]) : null;
      resolve({ alive: !error, time });
    });
  });
}

// ─── MAC Address ──────────────────────────────────────────────────────────────
function getMacFromArp(ip) {
  return new Promise((resolve) => {
    try {
      const platform = process.platform;
      let cmd = platform === 'win32' ? `arp -a ${ip}` : `arp -n ${ip}`;
      exec(cmd, { timeout: 2000 }, (error, stdout) => {
        if (error) { resolve(null); return; }
        const macMatch = stdout.match(/([0-9a-fA-F]{2}[:\-]){5}[0-9a-fA-F]{2}/);
        resolve(macMatch ? macMatch[0].replace(/-/g, ':').toLowerCase() : null);
      });
    } catch (e) {
      resolve(null);
    }
  });
}

// ─── MAC Vendor ───────────────────────────────────────────────────────────────
const vendorCache = new Map();

async function getMacVendor(mac) {
  if (!mac) return 'Unknown';
  const prefix = mac.replace(/:/g, '').substring(0, 6).toUpperCase();
  if (vendorCache.has(prefix)) return vendorCache.get(prefix);
  try {
    const axios = require('axios');
    const response = await axios.get(`https://api.macvendors.com/${mac}`, {
      timeout: 3000,
    });
    const vendor = response.data || 'Unknown';
    vendorCache.set(prefix, vendor);
    return vendor;
  } catch {
    vendorCache.set(prefix, 'Unknown');
    return 'Unknown';
  }
}

// ─── Hostname ──────────────────────────────────────────────────────────────────
async function getHostname(ip) {
  try {
    const hostnames = await dns.reverse(ip);
    return hostnames[0] || ip;
  } catch {
    return ip;
  }
}

// ─── Port Scanner ─────────────────────────────────────────────────────────────
const PORT_SERVICES = {
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  81: 'HTTP-Alt',
  110: 'POP3',
  135: 'RPC',
  139: 'NetBIOS',
  143: 'IMAP',
  443: 'HTTPS',
  445: 'SMB',
  3306: 'MySQL',
  3389: 'RDP',
  4433: 'HTTPS-Alt',
  5900: 'VNC',
  8080: 'HTTP-Proxy',
  8443: 'HTTPS-Alt',
  8888: 'HTTP-Alt',
};

const DEFAULT_PORTS = Object.keys(PORT_SERVICES).map(Number);

function scanPort(ip, port, timeout = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let open = false;
    socket.setTimeout(timeout);
    socket.on('connect', () => {
      open = true;
      socket.destroy();
      resolve({ port, service: PORT_SERVICES[port] || 'Unknown', open: true });
    });
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ port, service: PORT_SERVICES[port] || 'Unknown', open: false });
    });
    socket.on('error', () => {
      resolve({ port, service: PORT_SERVICES[port] || 'Unknown', open: false });
    });
    socket.connect(port, ip);
  });
}

async function scanPorts(ip, ports = DEFAULT_PORTS) {
  const results = await Promise.all(ports.map((p) => scanPort(ip, p)));
  return results.filter((r) => r.open);
}

// ─── Main Scan ────────────────────────────────────────────────────────────────
ipcMain.handle('get-local-info', () => getLocalNetworkInfo());

ipcMain.handle('start-scan', async (event, options) => {
  scanCancelled = false;
  const { networkIndex = 0, customRange, scanPorts: doPortScan = true, ports } = options || {};

  const networks = getLocalNetworkInfo();
  if (networks.length === 0) {
    return { error: 'No network interfaces found' };
  }

  const network = networks[networkIndex] || networks[0];
  let ipList;

  if (customRange) {
    // Custom CIDR or range provided
    ipList = expandRange(customRange);
  } else {
    ipList = getSubnetRange(network.ip, network.netmask);
  }

  // Limit to 254 hosts max for safety
  if (ipList.length > 254) ipList = ipList.slice(0, 254);

  const total = ipList.length;
  let completed = 0;
  const results = [];

  // Send progress updates
  const sendProgress = (msg, device) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('scan-progress', {
        completed,
        total,
        percent: Math.round((completed / total) * 100),
        message: msg,
        device,
      });
    }
  };

  sendProgress('Starting scan...', null);

  // Batch ping sweep (50 at a time)
  const batchSize = 50;
  for (let i = 0; i < ipList.length; i += batchSize) {
    if (scanCancelled) break;
    const batch = ipList.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (ip) => {
        if (scanCancelled) return;
        const pingResult = await pingHost(ip);
        completed++;
        if (pingResult.alive) {
          sendProgress(`Found: ${ip}`, null);
          // Parallel: hostname + MAC
          const [hostname, mac] = await Promise.all([
            getHostname(ip),
            getMacFromArp(ip),
          ]);
          const vendor = await getMacVendor(mac);
          let openPorts = [];
          if (doPortScan) {
            sendProgress(`Scanning ports: ${ip}`, null);
            openPorts = await scanPorts(ip, ports || DEFAULT_PORTS);
          }
          const device = {
            ip,
            hostname: hostname !== ip ? hostname : '',
            mac: mac || '',
            vendor,
            ping: pingResult.alive,
            pingTime: pingResult.time,
            ports: openPorts,
            status: 'online',
          };
          results.push(device);
          sendProgress(`Scanned: ${ip}`, device);
        } else {
          sendProgress(`No response: ${ip}`, null);
        }
      })
    );
  }

  return { results, network, total, scanned: completed };
});

ipcMain.on('cancel-scan', () => {
  scanCancelled = true;
});

// ─── Export ───────────────────────────────────────────────────────────────────
ipcMain.handle('export-results', async (event, { results, format }) => {
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Scan Results',
    defaultPath: `lan-scan-${Date.now()}.${format}`,
    filters: [
      format === 'csv'
        ? { name: 'CSV', extensions: ['csv'] }
        : { name: 'JSON', extensions: ['json'] },
    ],
  });

  if (!filePath) return { success: false, reason: 'cancelled' };

  try {
    let content;
    if (format === 'json') {
      content = JSON.stringify(results, null, 2);
    } else {
      // CSV
      const header = 'IP,Hostname,MAC,Vendor,Ping,Ping Time (ms),Open Ports\n';
      const rows = results.map((r) => {
        const ports = r.ports.map((p) => `${p.port}/${p.service}`).join(' | ');
        return `"${r.ip}","${r.hostname}","${r.mac}","${r.vendor}",${r.ping},${r.pingTime ?? ''},"${ports}"`;
      });
      content = header + rows.join('\n');
    }
    fs.writeFileSync(filePath, content, 'utf-8');
    shell.showItemInFolder(filePath);
    return { success: true, filePath };
  } catch (err) {
    return { success: false, reason: err.message };
  }
});
