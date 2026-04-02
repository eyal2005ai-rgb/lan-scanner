'use strict';

// ─── Ports Config ─────────────────────────────────────────────────────────────
const PORT_LIST = [
  { port: 21, service: 'FTP' },
  { port: 22, service: 'SSH' },
  { port: 23, service: 'Telnet' },
  { port: 25, service: 'SMTP' },
  { port: 53, service: 'DNS' },
  { port: 80, service: 'HTTP' },
  { port: 81, service: 'HTTP-Alt' },
  { port: 110, service: 'POP3' },
  { port: 135, service: 'RPC' },
  { port: 139, service: 'NetBIOS' },
  { port: 143, service: 'IMAP' },
  { port: 443, service: 'HTTPS' },
  { port: 445, service: 'SMB' },
  { port: 3306, service: 'MySQL' },
  { port: 3389, service: 'RDP' },
  { port: 4433, service: 'HTTPS-Alt' },
  { port: 5900, service: 'VNC' },
  { port: 8080, service: 'HTTP-Proxy' },
  { port: 8443, service: 'HTTPS-Alt' },
  { port: 8888, service: 'HTTP-Alt' },
];

// ─── State ─────────────────────────────────────────────────────────────────────
let scanResults = [];
let filteredResults = [];
let networks = [];
let isScanning = false;
let sortCol = 'ip';
let sortDir = 1;
let activePorts = new Set(PORT_LIST.map(p => p.port));
let currentView = 'table';

// ─── DOM Refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const networkSelect = $('network-select');
const localIpDisplay = $('local-ip-display');
const customRangeInput = $('custom-range');
const portScanToggle = $('port-scan-toggle');
const portListContainer = $('port-list-container');
const portGrid = $('port-grid');
const btnScan = $('btn-scan');
const btnCancel = $('btn-cancel');
const btnExportJson = $('btn-export-json');
const btnExportCsv = $('btn-export-csv');
const searchInput = $('search-input');
const progressWrap = $('progress-wrap');
const progressFill = $('progress-fill');
const progressLabel = $('progress-label');
const resultsBody = $('results-tbody');
const cardsGrid = $('cards-grid');
const tableView = $('table-view');
const cardsView = $('cards-view');
const scanStatus = $('scan-status');
const terminalOutput = $('terminal-output');

// Stats
const statTotal = $('stat-total');
const statOnline = $('stat-online');
const statPorts = $('stat-ports');
const statVendors = $('stat-vendors');

// ─── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  buildPortGrid();
  await loadNetworkInfo();
  setupListeners();
}

// ─── Network Info ──────────────────────────────────────────────────────────────
async function loadNetworkInfo() {
  try {
    networks = await window.api.getLocalInfo();
    networkSelect.innerHTML = '';
    if (networks.length === 0) {
      networkSelect.innerHTML = '<option>No interfaces found</option>';
      return;
    }
    networks.forEach((net, i) => {
      const opt = document.createElement('option');
      opt.value = i;
      opt.textContent = `${net.interface} — ${net.ip}`;
      networkSelect.appendChild(opt);
    });
    updateLocalIpDisplay(0);
    log(`Detected ${networks.length} network interface(s)`, 'system');
    networks.forEach(n => log(`  ${n.interface}: ${n.ip} / ${n.netmask}`, 'info'));
  } catch (e) {
    log('Failed to load network info: ' + e.message, 'error');
  }
}

function updateLocalIpDisplay(idx) {
  const net = networks[idx];
  if (net) {
    localIpDisplay.textContent = `${net.ip}  ${net.cidr}`;
  }
}

// ─── Port Grid ─────────────────────────────────────────────────────────────────
function buildPortGrid() {
  portGrid.innerHTML = '';
  PORT_LIST.forEach(({ port, service }) => {
    const tag = document.createElement('div');
    tag.className = 'port-tag active';
    tag.dataset.port = port;
    tag.title = service;
    tag.textContent = port;
    tag.addEventListener('click', () => {
      const p = parseInt(tag.dataset.port);
      if (activePorts.has(p)) {
        activePorts.delete(p);
        tag.classList.remove('active');
      } else {
        activePorts.add(p);
        tag.classList.add('active');
      }
    });
    portGrid.appendChild(tag);
  });
}

// ─── Event Listeners ───────────────────────────────────────────────────────────
function setupListeners() {
  // Window controls
  $('btn-minimize').onclick = () => window.api.minimize();
  $('btn-maximize').onclick = () => window.api.maximize();
  $('btn-close').onclick = () => window.api.close();

  // Network select
  networkSelect.onchange = () => updateLocalIpDisplay(parseInt(networkSelect.value));

  // Target radio
  document.querySelectorAll('input[name="target"]').forEach(radio => {
    radio.addEventListener('change', () => {
      customRangeInput.classList.toggle('hidden', radio.value !== 'custom');
    });
  });

  // Port scan toggle
  portScanToggle.onchange = () => {
    portListContainer.style.opacity = portScanToggle.checked ? '1' : '0.3';
    portListContainer.style.pointerEvents = portScanToggle.checked ? 'auto' : 'none';
  };

  // Scan / Cancel
  btnScan.onclick = startScan;
  btnCancel.onclick = () => {
    window.api.cancelScan();
    log('Scan cancelled by user', 'error');
    setScanningState(false);
  };

  // Export
  btnExportJson.onclick = () => exportResults('json');
  btnExportCsv.onclick = () => exportResults('csv');

  // Search
  searchInput.addEventListener('input', () => {
    applyFilter();
    renderResults();
  });

  // View toggle
  $('view-table').onclick = () => switchView('table');
  $('view-cards').onclick = () => switchView('cards');

  // Sort
  document.querySelectorAll('.sortable').forEach(th => {
    th.onclick = () => {
      const col = th.dataset.col;
      if (sortCol === col) sortDir *= -1;
      else { sortCol = col; sortDir = 1; }
      document.querySelectorAll('.sortable').forEach(t => t.classList.remove('sorted'));
      th.classList.add('sorted');
      applyFilter();
      renderResults();
    };
  });

  // Terminal clear
  $('terminal-clear').onclick = () => {
    terminalOutput.innerHTML = '<div class="log-line system">Log cleared</div>';
  };
}

// ─── Scan ──────────────────────────────────────────────────────────────────────
async function startScan() {
  if (isScanning) return;
  setScanningState(true);
  scanResults = [];
  filteredResults = [];
  renderResults();
  updateStats();

  const targetMode = document.querySelector('input[name="target"]:checked').value;
  const options = {
    networkIndex: parseInt(networkSelect.value) || 0,
    customRange: targetMode === 'custom' ? customRangeInput.value.trim() : null,
    scanPorts: portScanToggle.checked,
    ports: Array.from(activePorts),
  };

  log(`Starting scan on ${networks[options.networkIndex]?.cidr || 'subnet'}`, 'system');
  showProgress(true);

  // Register progress handler
  window.api.removeScanListeners();
  window.api.onScanProgress((data) => {
    progressFill.style.width = data.percent + '%';
    progressLabel.textContent = `${data.message} (${data.completed}/${data.total})`;
    if (data.device) {
      const d = data.device;
      scanResults.push(d);
      log(`FOUND ${d.ip}  ${d.mac || ''}  ${d.vendor}  Ports: ${d.ports.map(p => p.port).join(', ') || 'none'}`, 'found');
      applyFilter();
      renderResults();
      updateStats();
    }
  });

  try {
    const result = await window.api.startScan(options);
    if (result.error) {
      log('Scan error: ' + result.error, 'error');
    } else {
      log(`Scan complete. ${result.results.length} device(s) found out of ${result.scanned} hosts scanned.`, 'system');
      scanResults = result.results;
      applyFilter();
      renderResults();
      updateStats();
    }
  } catch (e) {
    log('Scan failed: ' + e.message, 'error');
  }

  setScanningState(false);
  showProgress(false);
  enableExport();
}

function setScanningState(scanning) {
  isScanning = scanning;
  btnScan.classList.toggle('scanning', scanning);
  btnScan.querySelector('.scan-label').textContent = scanning ? 'SCANNING...' : 'START SCAN';
  btnScan.querySelector('.scan-icon').textContent = scanning ? '⏳' : '▶';
  btnCancel.classList.toggle('hidden', !scanning);
  scanStatus.className = 'scan-status ' + (scanning ? 'scanning' : 'done');
  scanStatus.textContent = scanning ? 'SCANNING' : (scanResults.length > 0 ? 'COMPLETE' : 'IDLE');
}

function showProgress(show) {
  progressWrap.style.display = show ? 'block' : 'none';
  if (show) { progressFill.style.width = '0%'; progressLabel.textContent = 'Initializing...'; }
}

// ─── Filter & Sort ─────────────────────────────────────────────────────────────
function applyFilter() {
  const q = searchInput.value.toLowerCase();
  filteredResults = scanResults.filter(d =>
    !q ||
    d.ip.includes(q) ||
    d.hostname.toLowerCase().includes(q) ||
    d.mac.toLowerCase().includes(q) ||
    d.vendor.toLowerCase().includes(q)
  );
  filteredResults.sort((a, b) => {
    let va = a[sortCol] ?? '';
    let vb = b[sortCol] ?? '';
    if (sortCol === 'ip') {
      va = va.split('.').map(n => n.padStart(3, '0')).join('');
      vb = vb.split('.').map(n => n.padStart(3, '0')).join('');
    }
    if (sortCol === 'pingTime') { va = va ?? 9999; vb = vb ?? 9999; }
    return va < vb ? -sortDir : va > vb ? sortDir : 0;
  });
}

// ─── Render ────────────────────────────────────────────────────────────────────
function renderResults() {
  if (currentView === 'table') renderTable();
  else renderCards();
}

function renderTable() {
  if (filteredResults.length === 0) {
    resultsBody.innerHTML = `<tr class="empty-row"><td colspan="7">
      <div class="empty-state">
        <div class="empty-icon">◈</div>
        <div class="empty-text">${isScanning ? 'SCANNING...' : 'NO DEVICES FOUND'}</div>
        <div class="empty-sub">${isScanning ? 'Discovering devices on your network' : 'Start a scan to discover devices on your network'}</div>
      </div></td></tr>`;
    return;
  }
  resultsBody.innerHTML = filteredResults.map(d => `
    <tr>
      <td><span class="status-dot ${d.ping ? 'online' : 'offline'}"></span></td>
      <td class="ip-cell">${d.ip}</td>
      <td class="hostname-cell">${d.hostname || '<span style="color:var(--text-3)">—</span>'}</td>
      <td class="mac-cell">${d.mac || '<span style="color:var(--text-3)">—</span>'}</td>
      <td class="vendor-cell">${d.vendor !== 'Unknown' ? d.vendor : '<span style="color:var(--text-3)">—</span>'}</td>
      <td class="${pingClass(d.pingTime)}">${d.pingTime != null ? d.pingTime + ' ms' : '<span style="color:var(--text-3)">—</span>'}</td>
      <td><div class="ports-cell">${renderPortBadges(d.ports)}</div></td>
    </tr>
  `).join('');
}

function renderCards() {
  if (filteredResults.length === 0) {
    cardsGrid.innerHTML = `<div class="empty-state" style="grid-column:1/-1; padding:60px 20px; text-align:center">
      <div class="empty-icon">◈</div>
      <div class="empty-text">${isScanning ? 'SCANNING...' : 'NO DEVICES FOUND'}</div>
    </div>`;
    return;
  }
  cardsGrid.innerHTML = filteredResults.map(d => `
    <div class="device-card">
      <div class="card-header">
        <span class="card-ip">${d.ip}</span>
        <div class="card-status">
          <span class="status-dot ${d.ping ? 'online' : 'offline'}"></span>
          <span style="color:var(--text-3);font-size:10px;font-family:var(--font-display);letter-spacing:1px">${d.ping ? 'ONLINE' : 'OFFLINE'}</span>
        </div>
      </div>
      <div class="card-body">
        <div class="card-row"><label>HOSTNAME</label><span>${d.hostname || '—'}</span></div>
        <div class="card-row"><label>MAC</label><span>${d.mac || '—'}</span></div>
        <div class="card-row"><label>VENDOR</label><span>${d.vendor !== 'Unknown' ? d.vendor : '—'}</span></div>
        <div class="card-row"><label>PING</label><span class="${pingClass(d.pingTime)}">${d.pingTime != null ? d.pingTime + ' ms' : '—'}</span></div>
      </div>
      ${d.ports.length ? `<div class="card-ports">${renderPortBadges(d.ports)}</div>` : ''}
    </div>
  `).join('');
}

function pingClass(time) {
  if (time == null) return 'ping-cell none';
  if (time > 100) return 'ping-cell slow';
  return 'ping-cell';
}

function renderPortBadges(ports) {
  if (!ports || ports.length === 0) return '<span style="color:var(--text-3);font-size:11px">none</span>';
  return ports.map(p => {
    let cls = 'port-badge';
    if ([80,81,8080,8443,8888,443,4433].includes(p.port)) cls += ' http';
    else if (p.port === 22) cls += ' ssh';
    else if (p.port === 3389) cls += ' rdp';
    return `<span class="${cls}" title="${p.service}">${p.port}</span>`;
  }).join('');
}

// ─── Stats ─────────────────────────────────────────────────────────────────────
function updateStats() {
  const online = scanResults.filter(d => d.ping).length;
  const totalPorts = scanResults.reduce((acc, d) => acc + d.ports.length, 0);
  const vendors = new Set(scanResults.map(d => d.vendor).filter(v => v && v !== 'Unknown')).size;
  statTotal.textContent = scanResults.length;
  statOnline.textContent = online;
  statPorts.textContent = totalPorts;
  statVendors.textContent = vendors;
}

// ─── View Switch ───────────────────────────────────────────────────────────────
function switchView(view) {
  currentView = view;
  tableView.classList.toggle('hidden', view !== 'table');
  cardsView.classList.toggle('hidden', view !== 'cards');
  $('view-table').classList.toggle('active', view === 'table');
  $('view-cards').classList.toggle('active', view === 'cards');
  renderResults();
}

// ─── Export ────────────────────────────────────────────────────────────────────
function enableExport() {
  btnExportJson.disabled = scanResults.length === 0;
  btnExportCsv.disabled = scanResults.length === 0;
}

async function exportResults(format) {
  const result = await window.api.exportResults({ results: scanResults, format });
  if (result.success) {
    log(`Exported ${format.toUpperCase()} to: ${result.filePath}`, 'system');
  } else if (result.reason !== 'cancelled') {
    log(`Export failed: ${result.reason}`, 'error');
  }
}

// ─── Terminal Log ──────────────────────────────────────────────────────────────
function log(msg, type = 'info') {
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  const ts = new Date().toLocaleTimeString('en-GB', { hour12: false });
  line.textContent = `[${ts}] ${msg}`;
  terminalOutput.appendChild(line);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

// ─── Start ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
