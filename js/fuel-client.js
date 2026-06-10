import { addTokens } from './game-state.js';
import { playConnected, playDisconnected } from './sound-system.js';

const API_BASE = '';
const PLAYER_KEY = 'tokensyber_player_id';
const POLL_INTERVAL = 2000;

let pollTimer = null;
let lastKnownTotalTokens = 0;
let totalTokensReceived = 0;
let tokenHistory = [];
let lastFuelPulseTime = 0;
let hasEverConnected = false;
let manuallyDisconnected = false;

export function init() {
  const playerId = getPlayerId();
  if (playerId) {
    connect(playerId);
  } else {
    showPlayerIdInput();
  }
  setInterval(updateRateDisplay, 1000);

  // 更换 Player ID 按钮
  const changeBtn = document.getElementById('btn-change-player');
  if (changeBtn) {
    changeBtn.addEventListener('click', () => changePlayerId());
  }

  // Browser console test: window.__testTokens(5000)
  window.__testTokens = (count = 5000) => {
    console.log('[TokenSyber] Manual test: injecting', count, 'tokens');
    onTokenConsumed(count);
  };
}

// ========== Player ID ==========

export function getPlayerId() {
  return localStorage.getItem(PLAYER_KEY) || '';
}

export function setPlayerId(id) {
  if (id && id.length >= 8) {
    localStorage.setItem(PLAYER_KEY, id.trim());
    connect(id.trim());
  }
}

function showPlayerIdInput() {
  const input = document.getElementById('player-id-input');
  const btn = document.getElementById('btn-connect-player');
  const section = document.getElementById('player-id-section');
  // 确保 "连接 Claude Code" 标签页是激活的
  const guideConnect = document.getElementById('guide-connect');
  const guideHowto = document.getElementById('guide-howto');
  if (guideConnect) guideConnect.classList.remove('hidden');
  if (guideHowto) guideHowto.classList.add('hidden');
  if (section) section.classList.remove('hidden');
  if (input) input.focus();
  if (btn) {
    btn.onclick = () => {
      const val = input ? input.value.trim() : '';
      if (val) setPlayerId(val);
    };
  }
  // Enter key
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const val = input.value.trim();
        if (val) setPlayerId(val);
      }
    });
  }
  updateStatus('disconnected');
}

// ========== Polling Connection ==========

function connect(playerId) {
  if (manuallyDisconnected) return;
  stopPolling();
  lastKnownTotalTokens = 0; // reset on fresh connect

  // Immediate first fetch to get baseline
  fetchStats(playerId).then(total => {
    lastKnownTotalTokens = total;
    updateStatus('connected');
    if (!hasEverConnected) {
      hasEverConnected = true;
      showConnectedToast();
    }
    const section = document.getElementById('player-id-section');
    if (section) section.classList.add('hidden');
  }).catch(() => {
    updateStatus('disconnected');
  });

  // Start polling
  startPolling(playerId);
}

async function startPolling(playerId) {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const total = await fetchStats(playerId);
      if (total > lastKnownTotalTokens) {
        const delta = total - lastKnownTotalTokens;
        lastKnownTotalTokens = total;
        onTokenConsumed(delta);
      }
      updateStatus('connected');
    } catch {
      if (!manuallyDisconnected) {
        updateStatus(hasEverConnected ? 'reconnecting' : 'disconnected');
      }
    }
  }, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

async function fetchStats(playerId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${API_BASE}/fuel-stats?player=${encodeURIComponent(playerId)}`, {
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.totalTokens || 0;
  } finally {
    clearTimeout(timeout);
  }
}

// ========== Token Processing ==========

function onTokenConsumed(tokens) {
  const now = Date.now();
  tokenHistory.push({ tokens, time: now });
  if (tokenHistory.length > 60) tokenHistory.shift();

  addTokens(tokens);
  totalTokensReceived += tokens;

  if (now - lastFuelPulseTime > 2000) {
    lastFuelPulseTime = now;
    triggerFuelPulse(tokens);
  }
}

// ========== Rate Display ==========

function updateRateDisplay() {
  const rateEl = document.getElementById('fuel-rate');
  if (!rateEl) return;
  const now = Date.now();
  tokenHistory = tokenHistory.filter(t => now - t.time < 60_000);
  const recentTokens = tokenHistory.reduce((s, t) => s + t.tokens, 0);
  const rate = tokenHistory.length > 0 ? Math.round(recentTokens / 60) : 0;
  rateEl.textContent = `${formatTokenCount(rate)}/min`;
  if (rate > 0) {
    rateEl.classList.remove('hidden');
  } else {
    rateEl.classList.add('hidden');
  }
}

function triggerFuelPulse(tokens) {
  const floater = document.createElement('div');
  floater.className = 'token-float-text';
  floater.textContent = `+${tokens.toLocaleString()} 算力`;
  document.body.appendChild(floater);
  setTimeout(() => floater.remove(), 1500);

  const tankBar = document.getElementById('tank-bar-fill');
  if (tankBar) {
    tankBar.classList.add('fuel-pulse');
    setTimeout(() => tankBar.classList.remove('fuel-pulse'), 600);
  }
}

// ========== UI ==========

function updateStatus(status) {
  const indicator = document.getElementById('fuel-connection');
  const setupPanel = document.getElementById('fuel-setup');
  const toggleBtn = document.getElementById('btn-fuel-toggle');
  const reconnectBtn = document.getElementById('btn-reconnect-fuel');
  const diagnosticsBtn = document.getElementById('btn-fuel-diagnostics');
  const diagResult = document.getElementById('fuel-diagnostics-result');
  const qualityHint = document.getElementById('fuel-quality-hint');
  const changePlayerBtn = document.getElementById('btn-change-player');
  const hasPlayerId = !!getPlayerId();
  if (!indicator) return;
  if (status === 'connected') {
    playConnected();
    indicator.className = 'fuel-indicator connected';
    indicator.textContent = '●';
    indicator.title = '燃料泵已连接（轮询模式）';
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
    indicator.title = hasPlayerId ? '燃料泵未连接 — 可以更换 Player ID' : '燃料泵未连接';
    if (setupPanel) setupPanel.classList.remove('hidden');
    if (toggleBtn) toggleBtn.classList.add('hidden');
    if (diagnosticsBtn) diagnosticsBtn.classList.remove('hidden');
    if (qualityHint) qualityHint.classList.add('hidden');
    if (manuallyDisconnected) {
      if (reconnectBtn) reconnectBtn.classList.remove('hidden');
    } else {
      if (reconnectBtn) reconnectBtn.classList.add('hidden');
    }
    // 显示 Player ID 输入区
    const playerSection = document.getElementById('player-id-section');
    const guideConnect = document.getElementById('guide-connect');
    const guideHowto = document.getElementById('guide-howto');
    if (guideConnect) guideConnect.classList.remove('hidden');
    if (guideHowto) guideHowto.classList.add('hidden');
    if (playerSection) playerSection.classList.remove('hidden');
  }
  // 有存储的 playerId 时才显示更换按钮
  if (changePlayerBtn) {
    changePlayerBtn.style.display = hasPlayerId ? '' : 'none';
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

function formatTokenCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

// ========== Public API ==========

export function disconnect() {
  manuallyDisconnected = true;
  stopPolling();
  updateStatus('disconnected');
}

export function reconnect() {
  manuallyDisconnected = false;
  const playerId = getPlayerId();
  if (playerId) connect(playerId);
}

export function changePlayerId() {
  disconnect();
  localStorage.removeItem(PLAYER_KEY);
  showPlayerIdInput();
  const input = document.getElementById('player-id-input');
  if (input) setTimeout(() => input.focus(), 100);
}

// ========== Diagnostics ==========

export async function runDiagnostics() {
  const resultEl = document.getElementById('fuel-diagnostics-result');
  if (!resultEl) return;
  resultEl.classList.remove('hidden');
  resultEl.innerHTML = '<em>检测中…</em>';

  const playerId = getPlayerId();
  if (!playerId) {
    resultEl.innerHTML = '<strong style="color:#f06060">✗ 未配置 Player ID</strong><br>请在上方输入你的 Player ID';
    return;
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${API_BASE}/fuel-stats?player=${encodeURIComponent(playerId)}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    resultEl.innerHTML = [
      '<strong style="color:var(--glitch-cyan)">✓ 诊断结果</strong>',
      `累计算力: ${data.totalTokens?.toLocaleString('en-US') || '0'}`,
      `注入次数: ${data.totalRequests || 0}`,
      `连接状态: ${data.connected ? '已连接' : '未连接'}`,
      `客户端数: ${data.clients || 0}`,
    ].join('<br>');
  } catch (e) {
    resultEl.innerHTML = `<strong style="color:#f06060">✗ 连接失败</strong><br>${e.message || '无法访问 API'}`;
  }
}
