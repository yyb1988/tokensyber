// 市场系统 — 阶段 1 MVP：NPC 黑市求购台
//
// 核心机制：
// - NPC 商人定时刷新求购单（每个 NPC 1-3 张单）
// - 玩家从展示柜匹配模型卖出 → 模型移除展示柜（不返还 stock）+ 金币入账
// - 求购单按时段刷新（默认 30 分钟全部重新生成）
// - 历史记录最近 50 笔
//
// API 形状向阶段 2 云端对齐：所有函数命名 = 未来 HTTP 端点
// 当前实现：localStorage；未来实现：fetch
// 调用方应只通过本模块的导出函数访问市场数据，不要直接读 localStorage

import { NPCS, calculatePrice, getNpcById } from './npc-data.js';
import { getManifest } from './model-manager.js';
import { getCabinet, addCoins, removeFromCabinet } from './game-state.js';

const STORAGE_KEY = 'timecyber_market';
const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 分钟刷新一次
const DEMANDS_PER_NPC_MIN = 1;
const DEMANDS_PER_NPC_MAX = 3;
const HISTORY_LIMIT = 50;

const DEFAULT_STATE = {
  version: 1,
  npc_demands: [],
  history: [],
  last_refresh: 0,
  next_id: 1,
};

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(DEFAULT_STATE),
      ...parsed,
      npc_demands: Array.isArray(parsed.npc_demands) ? parsed.npc_demands : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('market saveState failed:', e);
  }
}

// 生成下一个 id（保证求购单/交易记录有唯一 id）
function nextId() {
  return state.next_id++;
}

// === 求购单生成 ===

// 为单个 NPC 生成 1-3 张求购单
function generateDemandsForNpc(npc, manifest) {
  const count = DEMANDS_PER_NPC_MIN + Math.floor(Math.random() * (DEMANDS_PER_NPC_MAX - DEMANDS_PER_NPC_MIN + 1));
  const demands = [];
  // 候选池：该 NPC 能接受稀有度的模型
  const candidates = manifest.filter(m => {
    if (npc.rarity_filter && !npc.rarity_filter.includes(m.rarity)) return false;
    return true;
  });
  if (candidates.length === 0) return demands;

  // 偏好分类的模型权重高一些
  const weighted = [];
  for (const m of candidates) {
    const weight = npc.preferred_categories.includes(m.category) ? 3 : 1;
    for (let i = 0; i < weight; i++) weighted.push(m);
  }

  // 随机抽 count 张不重复的求购单
  const picked = new Set();
  let attempts = 0;
  while (demands.length < count && attempts < count * 5) {
    attempts++;
    const m = weighted[Math.floor(Math.random() * weighted.length)];
    if (picked.has(m.id)) continue;
    picked.add(m.id);
    const price = calculatePrice(npc, m);
    if (price <= 0) continue;
    demands.push({
      id: nextId(),
      npcId: npc.id,
      modelId: m.id,
      price,
      expiresAt: state.last_refresh + REFRESH_INTERVAL_MS,
    });
  }
  return demands;
}

function regenerateAllDemands() {
  state.last_refresh = Date.now();
  state.npc_demands = [];
  const manifest = getManifest();
  if (manifest.length === 0) return;
  for (const npc of NPCS) {
    const demands = generateDemandsForNpc(npc, manifest);
    state.npc_demands.push(...demands);
  }
  saveState();
}

// 检查是否需要刷新（首次加载或上次刷新过期）
function maybeRefresh() {
  const now = Date.now();
  if (state.npc_demands.length === 0 || (now - state.last_refresh) > REFRESH_INTERVAL_MS) {
    regenerateAllDemands();
  }
}

// === 公开 API（阶段 2 直接换为 fetch）===

// 获取所有当前求购单（按 NPC 分组返回）
// 未来：GET /market/demands
export function getNpcDemands() {
  maybeRefresh();
  // 按 NPC 分组
  const grouped = {};
  for (const npc of NPCS) {
    grouped[npc.id] = { npc, demands: [] };
  }
  for (const d of state.npc_demands) {
    if (grouped[d.npcId]) {
      grouped[d.npcId].demands.push(d);
    }
  }
  return Object.values(grouped);
}

// 距离下次刷新还有多少毫秒
export function getNextRefreshIn() {
  maybeRefresh();
  return Math.max(0, (state.last_refresh + REFRESH_INTERVAL_MS) - Date.now());
}

// 玩家手动触发刷新（带冷却，避免滥用）
// 阶段 1：无成本，仅展示用；阶段 2：可能需要消耗金币/算力
export function forceRefresh() {
  regenerateAllDemands();
}

// 卖出模型给 NPC（按求购单 id + 展示柜模型 uniqueCode）
// 返回 { ok: boolean, error?: string, price?: number }
// 未来：POST /market/orders { demandId, modelUniqueCode }
export function sellToNpc(demandId, uniqueCode) {
  maybeRefresh();
  const demand = state.npc_demands.find(d => d.id === demandId);
  if (!demand) return { ok: false, error: '求购单已不存在' };

  const cabinet = getCabinet();
  const cabinetEntry = cabinet.find(r => r.uniqueCode === uniqueCode);
  if (!cabinetEntry) return { ok: false, error: '展示柜中找不到该模型' };

  if (cabinetEntry.modelId !== demand.modelId) {
    return { ok: false, error: '模型不匹配求购单要求' };
  }

  // 执行交易
  const price = demand.price;
  // 1. 从展示柜移除（已有函数；删除模型不返还 stock，与 cabinet 删除规则一致）
  if (!removeFromCabinet(uniqueCode)) {
    return { ok: false, error: '从展示柜移除模型失败' };
  }
  // 2. 金币入账
  addCoins(price);
  // 3. 移除该求购单
  state.npc_demands = state.npc_demands.filter(d => d.id !== demandId);
  // 4. 写历史
  state.history.unshift({
    id: nextId(),
    type: 'sell-to-npc',
    npcId: demand.npcId,
    modelId: demand.modelId,
    modelName: cabinetEntry.name,
    rarity: cabinetEntry.rarity,
    uniqueCode,
    price,
    timestamp: Date.now(),
  });
  if (state.history.length > HISTORY_LIMIT) {
    state.history = state.history.slice(0, HISTORY_LIMIT);
  }
  saveState();

  // 派发事件让 UI 刷新（展示柜、ban 槽位、金币显示等）
  window.dispatchEvent(new CustomEvent('cabinet-changed'));
  window.dispatchEvent(new CustomEvent('market-changed'));

  return { ok: true, price };
}

// 获取我的交易历史
// 未来：GET /market/history?player=me
export function getMyHistory() {
  return [...state.history];
}

// 玩家展示柜中匹配某 modelId 的所有副本（用于"卖哪一只"选择）
export function getMatchingFromCabinet(modelId) {
  const cabinet = getCabinet();
  return cabinet.filter(r => r.modelId === modelId);
}

// 工具：获取所有 NPC（给 UI 用）
export { NPCS, getNpcById };
