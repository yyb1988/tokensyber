const STORAGE_KEY = 'timecyber_state';
const CABINET_KEY = 'timecyber_cabinet';

// 按稀有度的算力消耗（token）
const RARITY_COST = {
  common:    20_000_000,    // 2000万
  rare:      50_000_000,    // 5000万
  epic:     100_000_000,    // 1亿
  legendary: 200_000_000,   // 2亿
};
const DEFAULT_COST = RARITY_COST.common;
const TOKENS_FOR_COMPLETION_DEBUG = 5_000;
// 公网安全：?debug/?test 仅在本地开发环境生效，公网强制关闭
const isLocal = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const DEBUG_MODE = isLocal && new URLSearchParams(window.location.search).has('debug');
const TEST_MODE = isLocal && new URLSearchParams(window.location.search).has('test');

// 测试模式：极低消耗 + 无限燃料，便于快速验证游戏逻辑
const TEST_RARITY_COST = {
  common:    100,
  rare:      200,
  epic:      500,
  legendary: 1000,
};

const DAILY_REGENERATION_LIMIT = 3;
const INJECTION_RATE_LIMIT = TEST_MODE ? 100_000 : 10_000; // 测试模式 10 倍速率
const TEST_TANK_REFILL = 10_000_000; // 测试模式储液罐自动补满到此值

const DEFAULT_STATE = {
  version: 8,
  currentPrint: {
    modelId: null,
    rarity: null,  // 用于计算 completion target
    accumulatedTokens: 0,
    isLocked: false,
    lockPasswordHash: null,
  },
  tank: {
    balance: 0,
    flowMode: 'auto', // 'auto' | 'manual'
  },
  totalInjected: 0, // 累计注入到游戏的历史 token 总量
  coins: {
    balance: 0,
    totalEarned: 0,
  },
  cabinetLock: {
    isLocked: false,
    passwordHash: null,
  },
  regeneration: {
    dailyCount: 0,
    lastResetDate: null,
  },
  extraction: {
    dailyCount: 0,
    lastResetDate: null,
  },
  settings: {
    soundEnabled: true,
    bgmEnabled: false,
    quality: 'high',
  }
};

let state = null;
let autoSaveInterval = null;
let isInjecting = false; // 运行时状态，不持久化

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

    // v2 → v3 迁移：添加 tank
    if (!parsed.tank) {
      parsed.tank = { balance: 0, flowMode: 'auto' };
      parsed.version = 3;
    }

    // v3 → v4 迁移：添加 extraction
    if (!parsed.extraction) {
      parsed.extraction = { dailyCount: 0, lastResetDate: null };
      parsed.version = 4;
    }

    // v4 → v5 迁移：添加 totalInjected
    // 已有玩家：从已收取模型 + 当前进度 + 储液罐 估算历史注入量作为起点
    if (parsed.totalInjected === undefined) {
      let estimate = 0;
      try {
        const cabinetRaw = localStorage.getItem(CABINET_KEY);
        if (cabinetRaw) {
          const cabinet = JSON.parse(cabinetRaw);
          for (const r of cabinet) estimate += (r.printDuration || 0);
        }
      } catch (e) {}
      estimate += (parsed.currentPrint && parsed.currentPrint.accumulatedTokens) || 0;
      estimate += (parsed.tank && parsed.tank.balance) || 0;
      parsed.totalInjected = estimate;
      parsed.version = 5;
    }

    // v5 → v6 迁移：添加 cabinetLock
    if (!parsed.cabinetLock) {
      parsed.cabinetLock = { isLocked: false, passwordHash: null };
      parsed.version = 6;
    }

    // v6 → v7 迁移：currentPrint 增加 rarity 字段；老进度按 common 处理
    // （旧 500K 成本玩家继续打这个老进度时，按 common 2000万 计算 — 进度会显得很低，但避免数据丢失）
    if (parsed.currentPrint && parsed.currentPrint.rarity === undefined) {
      parsed.currentPrint.rarity = parsed.currentPrint.modelId ? 'common' : null;
      parsed.version = 7;
    }

    // v7 → v8 迁移：BGM 改为默认关闭（opt-in），移除旧默认 true
    if (parsed.version < 8 && parsed.settings) {
      delete parsed.settings.bgmEnabled;
      parsed.version = 8;
    }

    // 深合并，确保嵌套对象也有默认值
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      currentPrint: { ...structuredClone(DEFAULT_STATE.currentPrint), ...(parsed.currentPrint || {}) },
      tank: { ...structuredClone(DEFAULT_STATE.tank), ...(parsed.tank || {}) },
      totalInjected: parsed.totalInjected || 0,
      coins: { ...structuredClone(DEFAULT_STATE.coins), ...(parsed.coins || {}) },
      cabinetLock: { ...structuredClone(DEFAULT_STATE.cabinetLock), ...(parsed.cabinetLock || {}) },
      regeneration: { ...structuredClone(DEFAULT_STATE.regeneration), ...(parsed.regeneration || {}) },
      extraction: { ...structuredClone(DEFAULT_STATE.extraction), ...(parsed.extraction || {}) },
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

let lastIncrement = 0;
let lastIncrementTick = 0; // 每次 lastIncrement 写入自增，供 UI 判定"新事件"

export function addTokens(count) {
  state.tank.balance += count;
  state.totalInjected += count;
  lastIncrement = count;
  lastIncrementTick++;
  console.log('[TokenSyber] Tank received:', count, 'tank balance:', state.tank.balance, 'total injected:', state.totalInjected);
}

export function getTotalInjected() {
  return state.totalInjected || 0;
}

export function getLastIncrement() {
  return lastIncrement;
}

export function getLastIncrementTick() {
  return lastIncrementTick;
}

export function getProgress() {
  if (!state.currentPrint.modelId) return 0;
  const target = getCompletionTarget();
  if (target <= 0) return 0;
  return Math.min(state.currentPrint.accumulatedTokens / target, 1);
}

export function getAccumulatedTokens() {
  return state.currentPrint.accumulatedTokens;
}

// 当前模型的算力消耗目标：调试模式 5K；否则按稀有度查表
export function getCompletionTarget() {
  if (TEST_MODE) return TEST_RARITY_COST[state.currentPrint.rarity] ?? TEST_RARITY_COST.common;
  if (DEBUG_MODE) return TOKENS_FOR_COMPLETION_DEBUG;
  const rarity = state.currentPrint.rarity;
  return RARITY_COST[rarity] ?? DEFAULT_COST;
}

// 给定稀有度的固定消耗（供 UI 在抽到模型前先展示）
export function getCostForRarity(rarity) {
  if (TEST_MODE) return TEST_RARITY_COST[rarity] ?? TEST_RARITY_COST.common;
  if (DEBUG_MODE) return TOKENS_FOR_COMPLETION_DEBUG;
  return RARITY_COST[rarity] ?? DEFAULT_COST;
}

export function getRemainingTokens() {
  return Math.max(getCompletionTarget() - state.currentPrint.accumulatedTokens, 0);
}

export function getCurrentPrint() {
  return state.currentPrint;
}

export function startPrint(modelId, rarity = null) {
  state.currentPrint = {
    modelId,
    rarity,
    accumulatedTokens: 0,
    isLocked: false,
    lockPasswordHash: null,
  };
  isInjecting = false;
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

export function removeFromCabinet(uniqueCode) {
  const cabinet = getCabinet();
  const idx = cabinet.findIndex(r => r.uniqueCode === uniqueCode);
  if (idx === -1) return false;
  cabinet.splice(idx, 1);
  try {
    localStorage.setItem(CABINET_KEY, JSON.stringify(cabinet));
  } catch (e) {
    console.warn('Cabinet save failed:', e);
  }
  return true;
}

export function spendCoins(amount) {
  if (state.coins.balance < amount) return false;
  state.coins.balance -= amount;
  save();
  return true;
}

// 重新生成次数管理
function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function checkDailyReset() {
  const today = getTodayStr();
  if (state.regeneration.lastResetDate !== today) {
    state.regeneration.dailyCount = 0;
    state.regeneration.lastResetDate = today;
    save();
  }
}

export function getRegenerationsLeft() {
  checkDailyReset();
  return Math.max(DAILY_REGENERATION_LIMIT - state.regeneration.dailyCount, 0);
}

export function canRegenerateFree() {
  return getRegenerationsLeft() > 0;
}

export function useRegeneration() {
  checkDailyReset();
  if (state.regeneration.dailyCount >= DAILY_REGENERATION_LIMIT) return false;
  state.regeneration.dailyCount++;
  save();
  return true;
}

// 储液罐
export function getTankBalance() {
  // 测试模式：储液罐自动补满，无限燃料
  if (TEST_MODE && state.tank.balance < TEST_TANK_REFILL / 2) {
    state.tank.balance = TEST_TANK_REFILL;
  }
  return state.tank.balance;
}

export function getFlowMode() {
  return state.tank.flowMode;
}

export function setFlowMode(mode) {
  state.tank.flowMode = mode;
  save();
}

export function getIsInjecting() {
  return isInjecting;
}

export function startInjection() {
  if (!state.currentPrint.modelId || isComplete()) return;
  isInjecting = true;
}

export function stopInjection() {
  isInjecting = false;
}

// 每帧调用：将储液罐中的 token 注入到当前打印，返回本次注入量
export function injectTokens(dt) {
  if (!isInjecting || !state.currentPrint.modelId || isComplete()) {
    if (isInjecting) isInjecting = false;
    return 0;
  }
  if (state.tank.balance <= 0) return 0;

  // 余额 < 10K 时以 10K/s 速率抽（约1秒清空），>= 10K 时以 10K/s 速率
  const amount = Math.min(INJECTION_RATE_LIMIT * dt, state.tank.balance);
  // 不超过完成目标
  const target = getCompletionTarget();
  const remaining = target - state.currentPrint.accumulatedTokens;
  const actual = Math.min(amount, remaining);

  state.tank.balance -= actual;
  // 极小余量直接归零，避免指数衰减永不归零
  if (state.tank.balance < 1) state.tank.balance = 0;
  state.currentPrint.accumulatedTokens += actual;

  if (isComplete()) {
    isInjecting = false;
  }

  return actual;
}

export function getState() {
  return state;
}

// === 展示柜锁定 ===
export function isCabinetLocked() {
  return !!(state.cabinetLock && state.cabinetLock.isLocked);
}

export function getCabinetLockHash() {
  return state.cabinetLock ? state.cabinetLock.passwordHash : null;
}

export function lockCabinet(passwordHash) {
  state.cabinetLock = { isLocked: true, passwordHash };
  save();
}

export function unlockCabinet() {
  state.cabinetLock = { isLocked: false, passwordHash: null };
  save();
}
