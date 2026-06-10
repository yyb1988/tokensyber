// Ban 系统：3 个 ban 槽位，分别在收集 1/5/10 个不同模型时解锁
// - 槽位 1、2：ban 单个模型（不再被随机生成）
// - 槽位 3：ban 整个分类（该 category 下所有模型都不被随机生成）
// - Ban 可重新选择，可清空（什么都不 ban）
// - 收集口径：展示柜里当前存在的不同 modelId 数量

import { getCabinet } from './game-state.js';

const BAN_KEY = 'timecyber_bans';

export const SLOT_UNLOCK_THRESHOLDS = [1, 5, 10]; // 解锁所需的不同模型数
export const SLOT_COUNT = 3;
export const CATEGORY_SLOT_INDEX = 2; // 第三个槽位（索引 2）ban 分类

const DEFAULT_BANS = {
  modelBans: [null, null], // 槽位 1、2 各自 ban 的 modelId（null = 未 ban）
  categoryBan: null,       // 槽位 3 ban 的分类（null = 未 ban）
};

let bans = loadBans();

function loadBans() {
  try {
    const raw = localStorage.getItem(BAN_KEY);
    if (!raw) return structuredClone(DEFAULT_BANS);
    const parsed = JSON.parse(raw);
    return {
      modelBans: Array.isArray(parsed.modelBans) && parsed.modelBans.length === 2
        ? parsed.modelBans
        : [null, null],
      categoryBan: parsed.categoryBan || null,
    };
  } catch {
    return structuredClone(DEFAULT_BANS);
  }
}

function saveBans() {
  try {
    localStorage.setItem(BAN_KEY, JSON.stringify(bans));
  } catch (e) {
    console.warn('saveBans failed:', e);
  }
}

// 不同收集数（按展示柜当前不同 modelId 计数）
export function getUniqueCollectedCount() {
  const cabinet = getCabinet();
  const ids = new Set();
  for (const r of cabinet) {
    if (r.modelId) ids.add(r.modelId);
  }
  return ids.size;
}

// 槽位是否已解锁（slotIndex: 0-2）
export function isSlotUnlocked(slotIndex) {
  const threshold = SLOT_UNLOCK_THRESHOLDS[slotIndex];
  if (threshold === undefined) return false;
  return getUniqueCollectedCount() >= threshold;
}

// 槽位距离解锁还差几个
export function getSlotProgress(slotIndex) {
  const threshold = SLOT_UNLOCK_THRESHOLDS[slotIndex];
  const current = getUniqueCollectedCount();
  return {
    current,
    threshold,
    unlocked: current >= threshold,
    remaining: Math.max(threshold - current, 0),
  };
}

// 获取槽位当前 ban 的内容
// 模型槽返回 modelId 或 null；分类槽返回 categoryCode 或 null
export function getSlotBan(slotIndex) {
  if (slotIndex === CATEGORY_SLOT_INDEX) return bans.categoryBan;
  return bans.modelBans[slotIndex] || null;
}

// 设置槽位 ban（value 为 null 时清空）
// 模型槽：value 必须是有效的 modelId
// 分类槽：value 必须是有效的 categoryCode
export function setSlotBan(slotIndex, value) {
  if (!isSlotUnlocked(slotIndex)) return false;

  if (slotIndex === CATEGORY_SLOT_INDEX) {
    bans.categoryBan = value || null;
  } else {
    // 不允许两个模型槽 ban 同一个模型
    if (value) {
      for (let i = 0; i < bans.modelBans.length; i++) {
        if (i !== slotIndex && bans.modelBans[i] === value) {
          return false;
        }
      }
    }
    bans.modelBans[slotIndex] = value || null;
  }
  saveBans();
  return true;
}

// 检查某个模型是否被 ban
export function isModelBanned(modelEntry) {
  if (!modelEntry) return false;
  if (bans.modelBans.includes(modelEntry.id)) return true;
  if (bans.categoryBan && modelEntry.category === bans.categoryBan) return true;
  return false;
}

// 获取所有分类（去重，调用方传入 manifest）
export function getAllCategories(manifest) {
  const set = new Map(); // code -> 模型数
  for (const m of (manifest || [])) {
    set.set(m.category, (set.get(m.category) || 0) + 1);
  }
  return Array.from(set.entries()).map(([code, count]) => ({ code, count }));
}

// 分类显示名（与 cabinet.js 保持一致，最好将来抽取共享）
const CATEGORY_NAMES = {
  hm:   '人形兵装',
  art:  '节肢机兽',
  ser:  '蛇形机体',
  aer:  '飞行器',
  aq:   '水生机体',
  bio:  '生化融合体',
  mega: '巨构体',
};

export function getCategoryName(code) {
  return CATEGORY_NAMES[code] || code;
}
