// NPC 商人数据 + 求购单生成规则
// 阶段 1 MVP：NPC 求购模型，玩家可从展示柜中卖出匹配的模型
// 数据形状向阶段 2 云端 API 对齐（npcId 未来对应 player_id）

// 基础价（按稀有度），单位：金币
const BASE_PRICE = {
  common: 3,
  rare: 18,
  epic: 60,
  legendary: 250,
};

// NPC 商人池 — 每个 NPC 有自己的喜好（出价系数）和描述
// price_multiplier: NPC 对该交易的出价系数（0.7 = 比基础价低 30%, 1.3 = 高 30%）
// preferred_categories: 该 NPC 偏好的分类，对偏好分类多出 0.2 系数
export const NPCS = [
  {
    id: 'zer0',
    name: 'ZER0',
    title: '残骸商人',
    avatar: '🦾',
    description: '收购废铁堆里能动的玩意。出价不高但来者不拒。',
    price_multiplier: 0.85,
    preferred_categories: ['hm', 'art'],
  },
  {
    id: 'helix',
    name: 'HELIX',
    title: '基因走私贩',
    avatar: '🧬',
    description: '只对融合类设计感兴趣。给生化和蛇形溢价。',
    price_multiplier: 1.0,
    preferred_categories: ['bio', 'ser'],
  },
  {
    id: 'thunder',
    name: 'THUNDER',
    title: '空军黑商',
    avatar: '🛩️',
    description: '飞行器收藏家，对天空有执念。',
    price_multiplier: 1.1,
    preferred_categories: ['aer'],
  },
  {
    id: 'leviathan',
    name: 'LEVIATHAN',
    title: '深海代理',
    avatar: '🌊',
    description: '只在涨潮时出现。对水生和巨构开高价。',
    price_multiplier: 1.25,
    preferred_categories: ['aq', 'mega'],
  },
  {
    id: 'oracle',
    name: 'ORACLE',
    title: '稀有度评估师',
    avatar: '💎',
    description: '只收稀有以上。出价最公道。',
    price_multiplier: 1.4,
    preferred_categories: [],
    rarity_filter: ['rare', 'epic', 'legendary'], // 不收 common
  },
];

// 计算 NPC 对某模型的出价
export function calculatePrice(npc, modelEntry) {
  if (!modelEntry || !modelEntry.rarity) return 0;
  // 稀有度过滤
  if (npc.rarity_filter && !npc.rarity_filter.includes(modelEntry.rarity)) {
    return 0;
  }

  const base = BASE_PRICE[modelEntry.rarity] || 1;
  let price = base * npc.price_multiplier;

  // 分类偏好加成
  if (npc.preferred_categories.includes(modelEntry.category)) {
    price *= 1.2;
  }

  // 加一点 ±10% 随机抖动让每张单都有点差异
  const jitter = 0.9 + Math.random() * 0.2;
  price *= jitter;

  return Math.max(1, Math.round(price));
}

export function getNpcById(id) {
  return NPCS.find(n => n.id === id) || null;
}
