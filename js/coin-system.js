// Token 驱动的金币系统（取代随机掉落机制）
// - 模型打印过程中，每消耗 5,000,000 token 产生 1 金币（积攒到该模型）
// - 模型完成、玩家收取时一次性全部到账
// - 全服金币池上限 12,400 — 池中无币时新模型不产金币
// - 中途放弃模型（重新生成）将丢弃该模型已积攒的金币（回到池中）

const COIN_POOL_KEY = 'timecyber_coin_pool';
export const COIN_POOL_CAP = 12_400;
export const TOKENS_PER_COIN = 5_000_000;

let onMintCallback = null;       // (coin) => void，每次新积攒一枚金币时触发（UI 显示用）
let onTransferCallback = null;   // (amount) => void，模型收取时金币入账

// 当前模型积攒的金币（运行时状态，不持久化 — 模型放弃即丢失，符合"必须完成才能领"）
let pendingCoins = 0;
// 已为当前模型按 token 算过的"上次结算点"，避免重复计数
let lastCheckpointTokens = 0;

function loadPool() {
  try {
    const raw = localStorage.getItem(COIN_POOL_KEY);
    if (raw === null) return COIN_POOL_CAP;
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) return COIN_POOL_CAP;
    return Math.min(n, COIN_POOL_CAP);
  } catch (e) {
    return COIN_POOL_CAP;
  }
}

function savePool(n) {
  try { localStorage.setItem(COIN_POOL_KEY, String(n)); } catch (e) {}
}

let poolRemaining = null;

export function init({ onMint, onTransfer } = {}) {
  onMintCallback = onMint || null;
  onTransferCallback = onTransfer || null;
  if (poolRemaining === null) poolRemaining = loadPool();
}

export function getPoolRemaining() {
  if (poolRemaining === null) poolRemaining = loadPool();
  return poolRemaining;
}

export function getPendingCoins() {
  return pendingCoins;
}

// 当前打印模型重置：开始新模型 / resume 已存在模型
// 已收取的旧模型不应残留 pending，需要先 transferPending 处理
export function resetForNewPrint() {
  pendingCoins = 0;
  lastCheckpointTokens = 0;
}

// 由 UI 注入循环每帧调用，传入"当前模型累计算力"
// 内部用 checkpoint 差量计算应该铸造的金币数
export function tickAccumulated(accumulatedTokens) {
  if (accumulatedTokens <= lastCheckpointTokens) return;
  const newCoinsTotal = Math.floor(accumulatedTokens / TOKENS_PER_COIN);
  const oldCoinsTotal = Math.floor(lastCheckpointTokens / TOKENS_PER_COIN);
  const delta = newCoinsTotal - oldCoinsTotal;
  lastCheckpointTokens = accumulatedTokens;
  if (delta <= 0) return;

  // 池中剩余币决定能铸造多少
  if (poolRemaining === null) poolRemaining = loadPool();
  const mintable = Math.min(delta, poolRemaining);
  if (mintable <= 0) return;

  poolRemaining -= mintable;
  savePool(poolRemaining);
  pendingCoins += mintable;
  if (onMintCallback) onMintCallback(mintable);
}

// 模型收取时：把 pending 金币转给玩家，清空 pending
// 返回实际转入数量（即原 pending）
export function transferPendingToPlayer() {
  const amount = pendingCoins;
  if (amount > 0) {
    pendingCoins = 0;
    lastCheckpointTokens = 0;
    if (onTransferCallback) onTransferCallback(amount);
  }
  return amount;
}

// 模型放弃（重新生成）：金币归还到池
export function returnPendingToPool() {
  if (pendingCoins <= 0) {
    lastCheckpointTokens = 0;
    return;
  }
  if (poolRemaining === null) poolRemaining = loadPool();
  poolRemaining = Math.min(COIN_POOL_CAP, poolRemaining + pendingCoins);
  savePool(poolRemaining);
  pendingCoins = 0;
  lastCheckpointTokens = 0;
}

// 给 resume 用：玩家重启游戏时，当前进度的 pending 需要按 accumulatedTokens 重新计算
// 但池可能已被扣过 — 没法重新扣。简化处理：
// resume 不补 pending，玩家拿到的金币只算"本次游戏会话内产出的"
// （存档迁移：把累计 token / 5M 作为已发金币基线，避免重复发）
export function resumeFromAccumulated(accumulatedTokens) {
  pendingCoins = 0;
  lastCheckpointTokens = accumulatedTokens;
}

// 调试：重置金币池（仅 ?debug）
export function debugResetPool() {
  poolRemaining = COIN_POOL_CAP;
  savePool(poolRemaining);
}
