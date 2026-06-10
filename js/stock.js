// 模型库存系统：限制每个模型的产出数量，打造稀缺性
// - common 100 / rare 50 / epic 20 / legendary 5
// - 玩家放入展示柜时库存 -1（consumeStock）
// - 删除展示柜模型不返还库存：个数永久减一，强化"世上少一只"的稀缺叙事
// - restoreStock 保留用于未来潜在的"回收"/"重铸"机制
// - 库存归零的模型不再被 getRandomModel 抽到

import { getManifest } from './model-manager.js';

const STOCK_KEY = 'timecyber_stock';

export const STOCK_CAPS = {
  common: 100,
  rare: 50,
  epic: 20,
  legendary: 5,
};

let stockMap = null; // { [modelId]: remainingCount }

function loadStock() {
  try {
    const raw = localStorage.getItem(STOCK_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn('Stock load failed:', e);
  }
  return {};
}

function saveStock() {
  try {
    localStorage.setItem(STOCK_KEY, JSON.stringify(stockMap));
  } catch (e) {
    console.warn('Stock save failed:', e);
  }
}

// 调用时机：manifest 加载完成后，初始化所有未记录的模型库存为上限值
// 若 manifest 更新（新增模型），新模型按上限初始化；已存在的不动
export function initStock() {
  if (stockMap === null) stockMap = loadStock();
  const manifest = getManifest();
  let dirty = false;
  for (const entry of manifest) {
    if (stockMap[entry.id] === undefined) {
      stockMap[entry.id] = STOCK_CAPS[entry.rarity] ?? 100;
      dirty = true;
    }
  }
  if (dirty) saveStock();
}

export function getStock(modelId) {
  if (stockMap === null) stockMap = loadStock();
  const v = stockMap[modelId];
  if (v === undefined) {
    // manifest 中存在但未初始化（init 之前调用）— 兜底返回 cap
    const entry = getManifest().find(m => m.id === modelId);
    return entry ? (STOCK_CAPS[entry.rarity] ?? 100) : 0;
  }
  return v;
}

export function getCap(modelId) {
  const entry = getManifest().find(m => m.id === modelId);
  return entry ? (STOCK_CAPS[entry.rarity] ?? 100) : 0;
}

// 玩家收取模型到展示柜：库存 -1
// 返回 true 表示扣减成功，false 表示已无库存（理论上不应发生 — 但容错）
export function consumeStock(modelId) {
  if (stockMap === null) stockMap = loadStock();
  const current = getStock(modelId);
  if (current <= 0) return false;
  stockMap[modelId] = current - 1;
  saveStock();
  return true;
}

// 玩家从展示柜删除模型：库存 +1（不超过上限）
export function restoreStock(modelId) {
  if (stockMap === null) stockMap = loadStock();
  const cap = getCap(modelId);
  const current = getStock(modelId);
  if (current >= cap) return;
  stockMap[modelId] = current + 1;
  saveStock();
}

// 返回还有库存的模型列表（getRandomModel 用）
export function getAvailableModels() {
  return getManifest().filter(m => getStock(m.id) > 0);
}

// 所有模型库存是否归零（用于"全部售罄"提示）
export function isAllSoldOut() {
  return getAvailableModels().length === 0;
}

// 获取所有模型库存汇总（调试/展示用）
export function getStockSummary() {
  return getManifest().map(m => ({
    id: m.id,
    name: m.name,
    rarity: m.rarity,
    remaining: getStock(m.id),
    cap: getCap(m.id),
  }));
}
