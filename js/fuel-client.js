import { addTokens } from './game-state.js';
import { playConnected, playDisconnected } from './sound-system.js';

const DEFAULT_PORT = 3001;
const MAX_PORT = 3010;
const HTTPS_PORT_OFFSET = 10;  // HTTPS on 3011-3020
const RECONNECT_DELAY = 5000;
const CONNECT_TIMEOUT = 2000;
const HTTP_PROBE_TIMEOUT = 500;
const PING_INTERVAL = 30000;
const PONG_TIMEOUT = 60000;

const isSecurePage = window.location.protocol === 'https:';

let ws = null;
let wsUrl = '';
let discoveredPort = null;
let reconnectTimer = null;
let tokenHistory = [];
let lastFuelPulseTime = 0;
let hasEverConnected = false;
let manuallyDisconnected = false;
let pingInterval = null;
let lastMessageTime = 0;
let isDiscovering = false;

export function init() {
  discoverAndConnect();
  setInterval(updateRateDisplay, 1000);

  // Browser console test: window.__testTokens(5000)
  window.__testTokens = (count = 5000) => {
    console.log('[TokenSyber] Manual test: injecting', count, 'tokens');
    onTokenConsumed(count);
  };
}

// ========== Port Discovery ==========

// HTTP 探测：仅 HTTP 页面可用（HTTPS 页面 fetch http:// 会被混合内容阻断）
async function httpProbe(port) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HTTP_PROBE_TIMEOUT);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/fuel-port`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      if (typeof data.port === 'number' && data.server === 'tokensyber') return data;
    }
    return null;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function discoverPortViaHttp() {
  const probes = [];
  for (let p = DEFAULT_PORT; p <= MAX_PORT; p++) {
    probes.push(
      httpProbe(p).then(data => {
        if (data !== null) return data;
        throw new Error('not found');
      })
    );
  }
  try {
    return await Promise.any(probes);
  } catch {
    return null;
  }
}

// ========== Main Discovery Flow ==========

async function discoverAndConnect() {
  if (isDiscovering) return;
  isDiscovering = true;

  // Try cached port first
  if (discoveredPort) {
    tryWsConnect(discoveredPort,
      () => { isDiscovering = false; },
      () => { discoveredPort = null; discoverAndConnect(); }
    );
    return;
  }

  // HTTP 页面：用 HTTP 探测（快，并行）
  if (!isSecurePage) {
    const data = await discoverPortViaHttp();
    if (data !== null) {
      console.log(`[TokenSyber] HTTP probe found port ${data.port}`);
      discoveredPort = data.port;
      tryWsConnect(data.port,
        () => { isDiscovering = false; },
        () => { discoverPortViaWsScan(); }
      );
      return;
    }
    // HTTP 探测没找到，也走 WS 扫描兜底
    discoverPortViaWsScan();
    return;
  }

  // HTTPS 页面：直接走 WSS 并行扫描
  discoverPortViaWsScan();
}

// ========== WS/WSS Scanning ==========

function buildWsUrl(port) {
  if (isSecurePage) {
    // HTTPS 页面 → wss://127.0.0.1:HTTPS_PORT (自签名证书)
    return `wss://127.0.0.1:${port + HTTPS_PORT_OFFSET}`;
  }
  return `ws://127.0.0.1:${port}`;
}

// 并行扫描所有端口，谁先连上用谁
function discoverPortViaWsScan() {
  let settled = false;
  const ports = [];
  for (let p = DEFAULT_PORT; p <= MAX_PORT; p++) ports.push(p);

  for (const port of ports) {
    tryWsConnect(port,
      () => {
        if (settled) return;
        settled = true;
        discoveredPort = port;
        isDiscovering = false;
      },
      () => {
        // 个别端口失败不影响其他端口
      }
    );
  }

  // 兜底：所有端口超时后标记断线
  setTimeout(() => {
    if (!settled) {
      settled = true;
      updateStatus('disconnected');
      isDiscovering = false;
      scheduleReconnect();
    }
  }, CONNECT_TIMEOUT + 1000);
}

function tryWsConnect(port, onSuccess, onFail) {
  let settled = false;
  const url = buildWsUrl(port);
  let socket;
  try {
    socket = new WebSocket(url);
  } catch {
    onFail();
    return;
  }

  const timer = setTimeout(() => {
    if (!settled) {
      settled = true;
      socket.close();
      console.warn(`[TokenSyber] WebSocket to ${url} timed out`);
      onFail();
    }
  }, CONNECT_TIMEOUT);

  socket.onopen = () => {
    if (settled) { socket.close(); return; }
    settled = true;
    clearTimeout(timer);
    ws = socket;
    wsUrl = url;
    isDiscovering = false;
    updateStatus('connected');
    if (!hasEverConnected) {
      hasEverConnected = true;
      showConnectedToast();
    }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    wireSocketHandlers(socket);
    startPing();
    onSuccess();
  };

  socket.onerror = (event) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    console.warn(`[TokenSyber] WebSocket to ${url} failed`);
    onFail();
  };
}

// ========== Socket Handlers ==========

function wireSocketHandlers(socket) {
  lastMessageTime = Date.now();

  socket.onmessage = (event) => {
    lastMessageTime = Date.now();
    try {
      const data = JSON.parse(event.data);
      console.log('[TokenSyber] WS message:', data.type, data.tokens !== undefined ? `tokens=${data.tokens}` : '');
      if (data.type === 'token-consumed') {
        onTokenConsumed(data.tokens);
      } else if (data.type === 'process-metrics') {
        onProcessMetrics(data);
      } else if (data.type === 'pong') {
        // heartbeat response, already updated lastMessageTime
      } else if (data.type === 'connected') {
        updateStatus('connected');
        if (!hasEverConnected) {
          hasEverConnected = true;
          showConnectedToast();
        }
      }
    } catch (e) { /* skip invalid messages */ }
  };

  socket.onclose = (event) => {
    console.log(`[TokenSyber] WebSocket closed: code=${event.code} reason=${event.reason || 'none'}`);
    stopPing();
    if (manuallyDisconnected) {
      updateStatus('disconnected');
    } else {
      updateStatus(hasEverConnected ? 'reconnecting' : 'disconnected');
      scheduleReconnect();
    }
  };

  socket.onerror = () => {
    stopPing();
    if (manuallyDisconnected) {
      updateStatus('disconnected');
    } else {
      updateStatus(hasEverConnected ? 'reconnecting' : 'disconnected');
    }
  };
}

function startPing() {
  stopPing();
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
    // Check pong timeout
    if (Date.now() - lastMessageTime > PONG_TIMEOUT) {
      console.warn('[TokenSyber] No message received for', PONG_TIMEOUT / 1000, 'seconds, reconnecting');
      stopPing();
      if (ws) { ws.close(); ws = null; }
      discoveredPort = null;
      scheduleReconnect();
    }
  }, PING_INTERVAL);
}

function stopPing() {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    discoverAndConnect();
  }, RECONNECT_DELAY);
}

// ========== Token Handling ==========

function onTokenConsumed(count) {
  console.log('[TokenSyber] Token consumed:', count);
  addTokens(count);
  tokenHistory.push({ timestamp: Date.now(), count });
  const cutoff = Date.now() - 3600000;
  tokenHistory = tokenHistory.filter(h => h.timestamp > cutoff);
  lastFuelPulseTime = Date.now();
  triggerFuelPulse(count);
}

function onProcessMetrics(data) {
  const httpsConns = data.httpsConns || 0;
  const httpsNewConns = data.httpsNewConns || 0;
  const bytesDelta = data.networkBytesDelta || 0;
  const KB = Math.round(bytesDelta / 1024);
  console.log(`[TokenSyber] Process metrics: https=${httpsConns}, httpsNew=${httpsNewConns}, netBytes=${bytesDelta} (${KB}KB)`);
}

function triggerFuelPulse(tokens) {
  const floater = document.createElement('div');
  floater.className = 'token-float-text';
  floater.textContent = `+${tokens.toLocaleString()} 算力`;
  document.body.appendChild(floater);
  setTimeout(() => floater.remove(), 1500);

  // token 流入储液罐的视觉脉冲
  const tankBar = document.getElementById('tank-bar-fill');
  if (tankBar) {
    tankBar.classList.add('fuel-pulse');
    setTimeout(() => tankBar.classList.remove('fuel-pulse'), 600);
  }
}

// ========== UI Updates ==========

function updateStatus(status) {
  const indicator = document.getElementById('fuel-connection');
  const setupPanel = document.getElementById('fuel-setup');
  const toggleBtn = document.getElementById('btn-fuel-toggle');
  const reconnectBtn = document.getElementById('btn-reconnect-fuel');
  const diagnosticsBtn = document.getElementById('btn-fuel-diagnostics');
  const diagResult = document.getElementById('fuel-diagnostics-result');
  const qualityHint = document.getElementById('fuel-quality-hint');
  if (!indicator) return;
  if (status === 'connected') {
    playConnected();
    indicator.className = 'fuel-indicator connected';
    indicator.textContent = '●';
    indicator.title = '燃料泵已连接';
    if (setupPanel) setupPanel.classList.add('hidden');
    if (toggleBtn) { toggleBtn.classList.remove('hidden'); toggleBtn.title = '断开燃料泵'; toggleBtn.innerHTML = '&#10005;'; }
    if (diagnosticsBtn) diagnosticsBtn.classList.add('hidden');
    if (diagResult) diagResult.classList.add('hidden');
    if (qualityHint) { qualityHint.classList.remove('hidden'); qualityHint.className = 'fuel-quality-hint quality-idle'; }
  } else if (status === 'reconnecting') {
    indicator.className = 'fuel-indicator reconnecting';
    indicator.textContent = '●';
    indicator.title = '燃料泵连接中断 — 正在重连...';
    if (toggleBtn) toggleBtn.classList.add('hidden');
    if (qualityHint) qualityHint.classList.add('hidden');
  } else {
    playDisconnected();
    indicator.className = 'fuel-indicator disconnected';
    indicator.textContent = '●';
    indicator.title = '燃料泵未连接';
    if (setupPanel) setupPanel.classList.remove('hidden');
    if (toggleBtn) toggleBtn.classList.add('hidden');
    if (diagnosticsBtn) diagnosticsBtn.classList.remove('hidden');
    if (qualityHint) qualityHint.classList.add('hidden');
    if (manuallyDisconnected) {
      if (reconnectBtn) reconnectBtn.classList.remove('hidden');
    } else {
      if (reconnectBtn) reconnectBtn.classList.add('hidden');
    }
  }
}

function showConnectedToast() {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast-success';
  toast.textContent = '燃料泵已连接！深度使用 AI 产生优质算力，方可驱动模型生产';
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('toast-fade-out'), 3000);
  setTimeout(() => toast.remove(), 3500);
}

function updateRateDisplay() {
  const rateEl = document.getElementById('fuel-rate');
  if (!rateEl) return;
  const rate = getTokensPerMinute();
  if (rate > 0) {
    rateEl.textContent = `${formatTokenCount(rate)}/min`;
    rateEl.classList.remove('hidden');
  } else {
    rateEl.classList.add('hidden');
  }
}

export function getTokensPerMinute() {
  const now = Date.now();
  const recent = tokenHistory.filter(h => h.timestamp > now - 60000);
  return recent.reduce((sum, h) => sum + h.count, 0);
}

export function isFuelActive() {
  return Date.now() - lastFuelPulseTime < 3000;
}

export async function runDiagnostics() {
  const resultEl = document.getElementById('fuel-diagnostics-result');
  if (!resultEl) return;
  resultEl.classList.remove('hidden');
  resultEl.textContent = '正在诊断...';

  const results = [];
  let serverFound = false;
  let firewallSuspected = false;

  // HTTPS 页面不能 fetch http://，跳过 HTTP 诊断，只给提示
  if (isSecurePage) {
    results.push('当前为 HTTPS 页面，无法直接探测本地服务器。');
    results.push('请确认：');
    results.push('1. 已安装 TokenSyber 插件并重启 Claude Code');
    results.push('2. 浏览器已信任本地证书（访问下方链接并点击"继续"）');
    const httpsPort = DEFAULT_PORT + HTTPS_PORT_OFFSET;
    results.push(`<a href="https://127.0.0.1:${httpsPort}/fuel-port" target="_blank" style="color:var(--cyan,#00f0ff)">点击测试：https://127.0.0.1:${httpsPort}/fuel-port</a>`);
    results.push('3. 如看到证书警告，点击"高级"→"继续前往"');

    let html = results.join('<br>');
    resultEl.innerHTML = html;
    return;
  }

  for (let p = DEFAULT_PORT; p <= MAX_PORT; p++) {
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`http://127.0.0.1:${p}/fuel-port`, { signal: controller.signal });
      clearTimeout(timer);
      const elapsed = Date.now() - start;
      if (res.ok) {
        const data = await res.json();
        results.push(`端口 ${p}: 服务器响应正常 (${elapsed}ms) — port=${data.port}`);
        serverFound = true;
        break;
      }
    } catch (err) {
      const elapsed = Date.now() - start;
      if (err.name === 'AbortError' && elapsed >= 2800) {
        results.push(`端口 ${p}: 连接超时 (${elapsed}ms) — 可能被防火墙阻断`);
        if (p <= 3002) firewallSuspected = true;
      } else {
        results.push(`端口 ${p}: 无服务 (${err.name || err.message})`);
      }
    }
  }

  let html = results.join('<br>');
  if (firewallSuspected) {
    html += '<br><br><strong style="color:#f0c040">⚠ 检测到防火墙问题</strong><br>Windows 防火墙可能阻断了 WebSocket 连接。请尝试：<br>1. 打开 Windows 设置 → 防火墙 → 允许应用通过防火墙<br>2. 找到 Node.js 或 Claude Code，勾选"专用"和"公用"网络<br>3. 或在 Windows 防火墙弹窗中选择"允许访问"';
  } else if (!serverFound) {
    html += '<br><br><strong style="color:#f06060">✗ 未找到 TokenSyber 服务器</strong><br>请在 Claude Code 中安装 TokenSyber 插件（参照游戏页面引导）。';
  } else {
    html += '<br><br><strong style="color:#40f080">✓ 服务器可达</strong>';
  }
  resultEl.innerHTML = html;
}

function formatTokenCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

export function disconnect() {
  manuallyDisconnected = true;
  stopPing();
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  updateStatus('disconnected');
}

export function reconnect() {
  manuallyDisconnected = false;
  discoveredPort = null;
  isDiscovering = false;
  discoverAndConnect();
}
