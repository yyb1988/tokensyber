import { addTokens } from './game-state.js';

const FUEL_PUMP_URL = 'ws://localhost:3001';
const RECONNECT_DELAY = 5000;

let ws = null;
let reconnectTimer = null;
let tokenHistory = [];
let lastFuelPulseTime = 0;
let hasEverConnected = false;
let manuallyDisconnected = false;

export function init() {
  connect();
  // 每秒更新 token 速率显示
  setInterval(updateRateDisplay, 1000);
}

function connect() {
  try {
    ws = new WebSocket(FUEL_PUMP_URL);
  } catch (e) {
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    updateStatus('connected');
    if (!hasEverConnected) {
      hasEverConnected = true;
      showConnectedToast();
    }
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'token-consumed') {
        onTokenConsumed(data.tokens);
      } else if (data.type === 'connected') {
        updateStatus('connected');
        if (!hasEverConnected) {
          hasEverConnected = true;
          showConnectedToast();
        }
      }
    } catch (e) { /* skip invalid messages */ }
  };

  ws.onclose = () => {
    if (manuallyDisconnected) {
      updateStatus('disconnected');
    } else {
      updateStatus(hasEverConnected ? 'reconnecting' : 'disconnected');
      scheduleReconnect();
    }
  };

  ws.onerror = () => {
    if (manuallyDisconnected) {
      updateStatus('disconnected');
    } else {
      updateStatus(hasEverConnected ? 'reconnecting' : 'disconnected');
    }
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, RECONNECT_DELAY);
}

function onTokenConsumed(count) {
  addTokens(count);
  tokenHistory.push({ timestamp: Date.now(), count });
  // 保留最近60分钟
  const cutoff = Date.now() - 3600000;
  tokenHistory = tokenHistory.filter(h => h.timestamp > cutoff);
  lastFuelPulseTime = Date.now();
  triggerFuelPulse(count);
}

function triggerFuelPulse(tokens) {
  // 浮动算力文字
  const floater = document.createElement('div');
  floater.className = 'token-float-text';
  floater.textContent = `+${tokens.toLocaleString()} 算力`;
  document.body.appendChild(floater);
  setTimeout(() => floater.remove(), 1500);

  // 进度条脉冲
  const bar = document.getElementById('progress-bar-fill');
  if (bar) {
    bar.classList.add('fuel-pulse');
    setTimeout(() => bar.classList.remove('fuel-pulse'), 600);
  }

  // 打印机视觉脉冲
  window.dispatchEvent(new CustomEvent('fuel-pulse', { detail: { tokens } }));
}

function updateStatus(status) {
  const indicator = document.getElementById('fuel-connection');
  const setupPanel = document.getElementById('fuel-setup');
  const toggleBtn = document.getElementById('btn-fuel-toggle');
  const reconnectBtn = document.getElementById('btn-reconnect-fuel');
  const downloadBtn = document.getElementById('btn-download-extension');
  const stepsEl = setupPanel?.querySelector('.fuel-setup-steps');
  if (!indicator) return;
  if (status === 'connected') {
    indicator.className = 'fuel-indicator connected';
    indicator.textContent = '●';
    indicator.title = '燃料泵已连接';
    if (setupPanel) setupPanel.classList.add('hidden');
    if (toggleBtn) { toggleBtn.classList.remove('hidden'); toggleBtn.title = '断开燃料泵'; toggleBtn.innerHTML = '&#10005;'; }
  } else if (status === 'reconnecting') {
    indicator.className = 'fuel-indicator reconnecting';
    indicator.textContent = '●';
    indicator.title = '燃料泵连接中断 — 正在重连...';
    if (toggleBtn) toggleBtn.classList.add('hidden');
  } else {
    indicator.className = 'fuel-indicator disconnected';
    indicator.textContent = '●';
    indicator.title = '燃料泵未连接';
    if (setupPanel) setupPanel.classList.remove('hidden');
    if (toggleBtn) toggleBtn.classList.add('hidden');
    if (manuallyDisconnected) {
      if (reconnectBtn) reconnectBtn.classList.remove('hidden');
      if (downloadBtn) downloadBtn.classList.add('hidden');
      if (stepsEl) stepsEl.classList.add('hidden');
    } else {
      if (reconnectBtn) reconnectBtn.classList.add('hidden');
      if (downloadBtn) downloadBtn.classList.remove('hidden');
      if (stepsEl) stepsEl.classList.remove('hidden');
    }
  }
}

function showConnectedToast() {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast toast-success';
  toast.textContent = '燃料泵已连接，你的算力正在燃烧！';
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('toast-fade-out'), 3000);
  setTimeout(() => toast.remove(), 3500);
}

function updateRateDisplay() {
  const rateEl = document.getElementById('fuel-rate');
  if (!rateEl) return;
  const rate = getTokensPerMinute();
  rateEl.textContent = rate > 0 ? `${formatTokenCount(rate)}/min` : '0/min';
}

export function getTokensPerMinute() {
  const now = Date.now();
  const recent = tokenHistory.filter(h => h.timestamp > now - 60000);
  return recent.reduce((sum, h) => sum + h.count, 0);
}

export function isFuelActive() {
  return Date.now() - lastFuelPulseTime < 3000;
}

function formatTokenCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

// 主动断开燃料泵连接
export function disconnect() {
  manuallyDisconnected = true;
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

// 重新连接燃料泵
export function reconnect() {
  manuallyDisconnected = false;
  connect();
}
