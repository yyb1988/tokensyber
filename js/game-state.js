const STORAGE_KEY = 'timecyber_state';
const CABINET_KEY = 'timecyber_cabinet';
const TOKENS_FOR_COMPLETION = 500_000;
const TOKENS_FOR_COMPLETION_DEBUG = 5_000;
const DEBUG_MODE = new URLSearchParams(window.location.search).has('debug');
const COMPLETION_TARGET = DEBUG_MODE ? TOKENS_FOR_COMPLETION_DEBUG : TOKENS_FOR_COMPLETION;

const DEFAULT_STATE = {
  version: 2,
  currentPrint: {
    modelId: null,
    accumulatedTokens: 0,
    isLocked: false,
    lockPasswordHash: null,
  },
  coins: {
    balance: 0,
    totalEarned: 0,
  },
  settings: {
    soundEnabled: true,
    quality: 'high',
  }
};

let state = null;
let autoSaveInterval = null;

export function init() {
  state = load();
  // 自动保存每30秒
  autoSaveInterval = setInterval(save, 30000);
  // 页面关闭时保存
  window.addEventListener('beforeunload', save);
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);

    // v1 → v2 迁移：accumulatedMs → accumulatedTokens
    if (parsed.currentPrint && parsed.currentPrint.accumulatedMs !== undefined) {
      delete parsed.currentPrint.accumulatedMs;
      parsed.currentPrint.accumulatedTokens = 0;
      parsed.version = 2;
    }

    // 深合并，确保嵌套对象也有默认值
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      currentPrint: { ...structuredClone(DEFAULT_STATE.currentPrint), ...(parsed.currentPrint || {}) },
      coins: { ...structuredClone(DEFAULT_STATE.coins), ...(parsed.coins || {}) },
      settings: { ...structuredClone(DEFAULT_STATE.settings), ...(parsed.settings || {}) },
    };
  } catch (e) {
    console.warn('State load failed, using defaults:', e);
    return structuredClone(DEFAULT_STATE);
  }
}

export function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('State save failed:', e);
  }
}

export function addTokens(count) {
  if (!state.currentPrint.modelId) return;
  state.currentPrint.accumulatedTokens += count;
  if (getProgress() >= 1) {
    window.dispatchEvent(new CustomEvent('print-complete'));
  }
}

export function getProgress() {
  if (!state.currentPrint.modelId) return 0;
  return Math.min(state.currentPrint.accumulatedTokens / COMPLETION_TARGET, 1);
}

export function getAccumulatedTokens() {
  return state.currentPrint.accumulatedTokens;
}

export function getCompletionTarget() {
  return COMPLETION_TARGET;
}

export function getRemainingTokens() {
  return Math.max(COMPLETION_TARGET - state.currentPrint.accumulatedTokens, 0);
}

export function getCurrentPrint() {
  return state.currentPrint;
}

export function startPrint(modelId) {
  state.currentPrint = {
    modelId,
    accumulatedTokens: 0,
    isLocked: false,
    lockPasswordHash: null,
  };
  save();
}

export function isLocked() {
  return state.currentPrint.isLocked;
}

export function getLockHash() {
  return state.currentPrint.lockPasswordHash;
}

export function setLock(passwordHash) {
  state.currentPrint.isLocked = true;
  state.currentPrint.lockPasswordHash = passwordHash;
  save();
}

export function unlock() {
  state.currentPrint.isLocked = false;
  state.currentPrint.lockPasswordHash = null;
  save();
}

export function isComplete() {
  return getProgress() >= 1;
}

export function getCoins() {
  return state.coins.balance;
}

export function getTotalEarned() {
  return state.coins.totalEarned;
}

export function addCoins(amount) {
  state.coins.balance += amount;
  state.coins.totalEarned += amount;
  save();
}

// 展示柜
export function getCabinet() {
  try {
    const raw = localStorage.getItem(CABINET_KEY);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

export function addToCabinet(record) {
  const cabinet = getCabinet();
  cabinet.unshift(record);
  // 限制20条
  if (cabinet.length > 20) cabinet.pop();
  try {
    localStorage.setItem(CABINET_KEY, JSON.stringify(cabinet));
  } catch (e) {
    console.warn('Cabinet save failed:', e);
  }
}

export function getState() {
  return state;
}
