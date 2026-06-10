import { addTokens } from './game-state.js';
import { playConnected, playDisconnected } from './sound-system.js';

const API_BASE = '';
const WS_BASE = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`;
const PLAYER_KEY = 'tokensyber_player_id';
const RECONNECT_DELAY = 5000;
const PING_INTERVAL = 30000;
const PONG_TIMEOUT = 60000;

let ws = null;
let tokenHistory = [];
let lastFuelPulseTime = 0;
let hasEverConnected = false;
let manuallyDisconnected = false;
let pingInterval = null;
let lastMessageTime = 0;

export function init() {
  const playerId = getPlayerId();
  if (playerId) {
    connect(playerId);
  } else {
    // 显示 Player ID 输入界面
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
  // 确保 \"连接 Claude Code\" 标签页是激活的
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

// ========== WebSocket Connection ==========

function connect(playerId) {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  const url = `${WS_BASE}/ws?player=${encodeURIComponent(playerId)}`;
  console.log('[TokenSyber] Connecting to', url);

  try {
    ws = new WebSocket(url);
  } catch (e) {
    console.warn('[TokenSyber] WebSocket creation failed:', e);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    console.log('[TokenSyber] WebSocket connected');
    lastMessageTime = Date.now();
    updateStatus('connected');
    if (!hasEverConnected) {
      hasEverConnected = true;
      showConnectedToast();
    }
    // 注册 HMAC key（让 DO 后续验证 stop hook 的签名）
    const hmacKey = getHmacKey();
    if (hmacKey && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'register-key', key: hmacKey }));
    }
    startPing();
    // 隐藏 Player ID 输入区，显示已连接状态
    const section = document.getElementById('player-id-section');
    if (section) section.classList.add('hidden');
  };

  ws.onmessage = (event) => {
    lastMessageTime = Date.now();
    try {
      const data = JSON.parse(event.data);
      if (data.type === 'token-consumed') {
        onTokenConsumed(data.tokens);
      } else if (data.type === 'pong') {
        // heartbeat response
      } else if (data.type === 'connected') {
        updateStatus('connected');
        if (!hasEverConnected) {
          hasEverConnected = true;
          showConnectedToast();
        }
      }
    } catch (e) { /* skip invalid messages */ }
  };

  ws.onclose = (event) => {
    console.log(`[TokenSyber] WebSocket closed: code=${event.code}`);
    stopPing();
    if (manuallyDisconnected) {
      updateStatus('disconnected');
    } else {
      updateStatus(hasEverConnected ? 'reconnecting' : 'disconnected');
      scheduleReconnect();
    }
  };

  ws.onerror = () => {
    stopPing();
    if (manuallyDisconnected) {
      updateStatus('disconnected');
    } else {
      updateStatus(hasEverConnected ? 'reconnecting' : 'disconnected');
    }
  };
}

// ========== HMAC Key ==========

// 从 Player ID 输入区域的隐藏字段读取 hmacKey（可选）
function getHmacKey() {
  const el = document.getElementById('hmac-key-input');
  return el ? el.value.trim() : '';
}

// ========== Heartbeat ==========

function startPing() {
  stopPing();
  pingInterval = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
    if (Date.now() - lastMessageTime > PONG_TIMEOUT) {
      console.warn('[TokenSyber] No message for', PONG_TIMEOUT / 1000, 'seconds, reconnecting');
      stopPing();
      if (ws) { ws.close(); ws = null; }
      scheduleReconnect();
    }
  }, PING_INTERVAL);
}

function stopPing() {
  if (pingInterval) { clearInterval(pingInterval); pingInterval = null; }
}

function scheduleReconnect() {
  setTimeout(() => {
    const playerId = getPlayerId();
    if (playerId && !manuallyDisconnected) {
      connect(playerId);
    }
  }, RECONNECT_DELAY);
}

// ========== Token Handling ==========

function onTokenConsumed(count) {
  addTokens(count);
  tokenHistory.push({ timestamp: Date.now(), count });
  const cutoff = Date.now() - 3600000;
  tokenHistory = tokenHistory.filter(h => h.timestamp > cutoff);
  lastFuelPulseTime = Date.now();
  triggerFuelPulse(count);
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
    // 显示 Player ID 输入区（让用户能看到输入框并更换 ID）
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

  const playerId = getPlayerId();
  if (!playerId) {
    resultEl.innerHTML = '<strong style="color:#f06060">✗ 未配置 Player ID</strong><br>请在上方输入你的 Player ID';
    return;
  }

  resultEl.textContent = '正在诊断...';

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${API_BASE}/fuel-stats?player=${encodeURIComponent(playerId)}`, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      if (data.connected) {
        resultEl.innerHTML = '<strong style="color:#40f080">✓ 已连接到 TokenSyber 服务器</strong><br>游戏客户端在线，算力正在注入';
      } else {
        resultEl.innerHTML = '<strong style="color:#f0c040">⚠ 服务器可达，但游戏客户端未连接</strong><br>服务器正常，但未检测到游戏页面连接。请刷新页面重试。';
      }
    } else {
      resultEl.innerHTML = '<strong style="color:#f06060">✗ 服务器响应异常</strong><br>HTTP ' + res.status;
    }
  } catch (err) {
    resultEl.innerHTML = '<strong style="color:#f06060">✗ 无法连接 TokenSyber 服务器</strong><br>请检查网络连接。错误: ' + (err.name || err.message);
  }
}

function formatTokenCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

export function disconnect() {
  manuallyDisconnected = true;
  stopPing();
  if (ws) { ws.close(); ws = null; }
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
  // 焦点到输入框
  const input = document.getElementById('player-id-input');
  if (input) setTimeout(() => input.focus(), 100);
}
