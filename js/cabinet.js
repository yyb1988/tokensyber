import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { showModal } from './modal.js';
import { getStock, getCap } from './stock.js';
import {
  getCabinet,
  removeFromCabinet,
  isCabinetLocked,
  getCabinetLockHash,
  lockCabinet,
  unlockCabinet,
} from './game-state.js';
import { loadModel, normalizeModel, getModelById, getModelDisplayImage, getManifest } from './model-manager.js';
import { showLockModal, showUnlockModal, hashPassword } from './lock-system.js';

let detailRenderer, detailScene, detailCamera, detailControls;
let detailAnimId = null;
let detailModel = null;
let currentDetailRecord = null;
let detailTurntableRotation = 0;
let detailIsDrag = false;
let detailPrevPointerX = 0;
const DETAIL_TURNTABLE_SENSITIVITY = 0.008;

// 展示柜过滤/视图/排序偏好 — 持久化到 localStorage
const CABINET_PREFS_KEY = 'timecyber_cabinet_prefs';
const DEFAULT_PREFS = { category: 'all', view: 'grid', sort: 'desc' };
const RARITY_ORDER = { common: 0, rare: 1, epic: 2, legendary: 3 };
const CATEGORY_LABEL = {
  hm: '人形兵装', art: '节肢机兽', ser: '蛇形机体', aer: '飞行器',
  aq: '水生机体', bio: '生化融合体', mega: '巨构体',
};
let prefs = loadPrefs();

function loadPrefs() {
  try {
    const raw = localStorage.getItem(CABINET_PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    return { ...DEFAULT_PREFS, ...JSON.parse(raw) };
  } catch (e) {
    return { ...DEFAULT_PREFS };
  }
}

function savePrefs() {
  try { localStorage.setItem(CABINET_PREFS_KEY, JSON.stringify(prefs)); } catch (e) {}
}

export function getDetailControls() { return detailControls; }
export function getDetailCamera() { return detailCamera; }

export function rotateDetailModelLeft() {
  if (!detailModel) return;
  detailTurntableRotation -= 0.08;
  detailModel.rotation.y = detailTurntableRotation;
}

export function rotateDetailModelRight() {
  if (!detailModel) return;
  detailTurntableRotation += 0.08;
  detailModel.rotation.y = detailTurntableRotation;
}

export function init() {
  // 展示柜按钮
  document.getElementById('btn-cabinet').addEventListener('click', showCabinet);
  document.getElementById('btn-cabinet-close').addEventListener('click', hideCabinet);
  document.getElementById('btn-detail-back').addEventListener('click', hideDetail);

  // 展示柜卡片复制
  document.getElementById('btn-detail-copy').addEventListener('click', () => {
    const code = document.getElementById('detail-code').textContent;
    copyToClipboard(code);
  });

  // 删除模型
  document.getElementById('btn-detail-delete').addEventListener('click', onDeleteDetail);

  // 锁定/解锁展示柜
  document.getElementById('btn-cabinet-lock').addEventListener('click', onToggleCabinetLock);

  // 工具栏：分类切换
  document.querySelectorAll('#cabinet-category-tabs .cabinet-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      prefs.category = btn.dataset.category;
      savePrefs();
      syncToolbarUI();
      renderCabinet();
    });
  });

  // 工具栏：视图模式切换
  document.querySelectorAll('#cabinet-view-tabs .cabinet-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      prefs.view = btn.dataset.view;
      savePrefs();
      syncToolbarUI();
      renderCabinet();
    });
  });

  // 工具栏：稀有度排序切换
  const sortBtn = document.getElementById('cabinet-sort-btn');
  sortBtn.addEventListener('click', () => {
    prefs.sort = prefs.sort === 'desc' ? 'asc' : 'desc';
    savePrefs();
    syncToolbarUI();
    renderCabinet();
  });

  syncToolbarUI();
  fillCategoryCounts();
}

// 在每个分类标签后追加该分类的模型种类总数（"全部"显示总数）
// 例：人形兵装 7 / 全部 29 / 巨构体 3
function fillCategoryCounts() {
  const manifest = getManifest();
  const counts = { all: manifest.length };
  for (const m of manifest) {
    counts[m.category] = (counts[m.category] || 0) + 1;
  }
  document.querySelectorAll('#cabinet-category-tabs .cabinet-chip').forEach(btn => {
    const cat = btn.dataset.category;
    const n = counts[cat] || 0;
    // 移除旧的 count span 再追加，幂等
    btn.querySelector('.cabinet-chip-count')?.remove();
    const span = document.createElement('span');
    span.className = 'cabinet-chip-count';
    span.textContent = n;
    btn.appendChild(span);
  });
}

function syncToolbarUI() {
  document.querySelectorAll('#cabinet-category-tabs .cabinet-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.category === prefs.category);
  });
  document.querySelectorAll('#cabinet-view-tabs .cabinet-chip').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === prefs.view);
  });
  const sortBtn = document.getElementById('cabinet-sort-btn');
  if (sortBtn) {
    sortBtn.dataset.sort = prefs.sort;
    sortBtn.classList.add('active');
    sortBtn.querySelector('.cabinet-sort-arrow').textContent = prefs.sort === 'desc' ? '↓' : '↑';
    sortBtn.title = prefs.sort === 'desc'
      ? '稀有度降序（高→低），点击切换升序'
      : '稀有度升序（低→高），点击切换降序';
  }
}

// === 世界库存看板 ===

function renderWorldStatus() {
  const barsEl = document.getElementById('world-status-bars');
  const summaryEl = document.getElementById('world-status-summary');
  if (!barsEl || !summaryEl) return;

  const manifest = getManifest();
  if (!manifest.length) {
    barsEl.innerHTML = '';
    summaryEl.textContent = '';
    return;
  }

  // 按稀有度降序排列，同稀有度按库存比例升序（濒危在前）
  const models = manifest.map(m => {
    const cap = getCap(m.id);
    const remaining = getStock(m.id);
    return { ...m, cap, remaining, ratio: cap > 0 ? remaining / cap : 0 };
  }).sort((a, b) => {
    const ra = RARITY_ORDER[a.rarity] ?? 0;
    const rb = RARITY_ORDER[b.rarity] ?? 0;
    if (ra !== rb) return rb - ra; // 稀有度高的在前
    return a.ratio - b.ratio; // 濒危的在前
  });

  // 统计
  let soldOut = 0, danger = 0, healthy = 0;

  let html = '';
  for (const m of models) {
    if (m.cap === 0) continue; // 无库存概念的模型跳过
    const pct = (m.ratio * 100).toFixed(0);
    let cls, valCls;
    if (m.remaining === 0) {
      cls = 'sold-out';
      valCls = 'sold-out';
      soldOut++;
    } else if (m.ratio <= 0.2) {
      cls = 'danger';
      valCls = 'danger';
      danger++;
    } else {
      cls = 'healthy';
      valCls = 'healthy';
      healthy++;
    }
    html += `<div class="world-status-row">
      <span class="world-status-name" title="${m.name}">${m.name}</span>
      <div class="world-status-bar"><div class="world-status-bar-fill ${cls}" style="width:${pct}%"></div></div>
      <span class="world-status-val ${valCls}">${m.remaining}/${m.cap}</span>
    </div>`;
  }
  barsEl.innerHTML = html;

  // 汇总行
  summaryEl.innerHTML =
    (soldOut > 0 ? `<span class="tag-sold-out">已售罄 ${soldOut}</span> · ` : '') +
    (danger > 0 ? `<span class="tag-danger">濒危 ${danger}</span> · ` : '') +
    `<span class="tag-healthy">健康 ${healthy}</span> · ` +
    `共 ${models.filter(m => m.cap > 0).length} 种`;
}

export function renderCabinet() {
  const grid = document.getElementById('cabinet-grid');
  const cabinet = getCabinet();

  // 渲染世界库存看板
  renderWorldStatus();

  if (cabinet.length === 0) {
    grid.className = 'cabinet-grid';
    grid.innerHTML = '<div class="cabinet-empty">还没有完成的模型</div>';
    return;
  }

  if (cabinet.length === 0) {
    grid.className = 'cabinet-grid';
    grid.innerHTML = '<div class="cabinet-empty">还没有完成的模型</div>';
    return;
  }

  // 按分类过滤（用记录里的 modelId 查 manifest 拿 category）
  let filtered = cabinet;
  if (prefs.category !== 'all') {
    filtered = cabinet.filter(r => {
      const entry = getModelById(r.modelId);
      return entry && entry.category === prefs.category;
    });
  }

  // 稀有度排序：同稀有度按完成时间倒序（保持稳定与新鲜感）
  const dir = prefs.sort === 'asc' ? 1 : -1;
  filtered = filtered.slice().sort((a, b) => {
    const ra = RARITY_ORDER[a.rarity] ?? 0;
    const rb = RARITY_ORDER[b.rarity] ?? 0;
    if (ra !== rb) return (ra - rb) * dir;
    return (b.completedAt || 0) - (a.completedAt || 0);
  });

  // 切换网格类
  grid.className = 'cabinet-grid' + (prefs.view === 'compact' ? ' view-compact' : '');

  if (filtered.length === 0) {
    const label = CATEGORY_LABEL[prefs.category] || prefs.category;
    grid.innerHTML = `<div class="cabinet-filter-empty">该分类下还没有模型（${label}）</div>`;
    return;
  }

  grid.innerHTML = '';
  for (const record of filtered) {
    const card = document.createElement('div');
    card.className = 'cabinet-card' + (prefs.view === 'compact' ? ' compact' : '');

    // 简介：优先用历史快照里的 description，找不到则回退到 manifest
    const modelEntry = getModelById(record.modelId);
    const description = record.description || (modelEntry && modelEntry.description) || '';

    // 大图模式才创建图片节点（紧凑模式不渲染减少内存）
    if (prefs.view !== 'compact') {
      const displayImage = record.displayImage || getModelDisplayImage(modelEntry);
      const img = document.createElement('img');
      img.src = displayImage || record.thumbnail || '';
      img.alt = record.name;
      if (!displayImage && !record.thumbnail) {
        img.style.background = 'var(--bg-tertiary)';
      }
      img.onerror = () => {
        if (record.thumbnail && img.src !== record.thumbnail) {
          img.src = record.thumbnail;
        } else {
          img.style.background = 'var(--bg-tertiary)';
        }
      };
      card.appendChild(img);
    }

    const info = document.createElement('div');
    info.className = 'cabinet-card-info';
    const rarity = record.rarity || 'common';
    // 序号显示：#N/CAP（老记录没有 serialNumber 则不显示）
    const serial = record.serialNumber && record.seriesCap
      ? `<span class="cabinet-card-serial">#${record.serialNumber}/${record.seriesCap}</span>`
      : '';
    // 简介行 HTML：紧凑模式不显示
    const descHtml = description
      ? `<div class="cabinet-card-desc" title="${escapeAttr(description)}">${escapeHtml(description)}</div>`
      : '';
    if (prefs.view === 'compact') {
      // 紧凑：只显示名称 + 编号（稀有度作为右侧小色标）
      info.innerHTML = `
        <div class="cabinet-card-name">${record.name || '未知模型'}${serial}</div>
        <span class="model-rarity rarity-${rarity} cabinet-card-rarity-tag">${rarity}</span>
        <div class="cabinet-card-code">${record.uniqueCode || ''}</div>
      `;
    } else {
      info.innerHTML = `
        <div class="cabinet-card-name">${record.name || '未知模型'}</div>
        <div class="cabinet-card-meta">
          <span class="model-rarity rarity-${rarity}">${rarity}</span>
          ${serial}
        </div>
        ${descHtml}
        <div class="cabinet-card-code">${record.uniqueCode || ''}</div>
      `;
    }

    card.appendChild(info);
    card.addEventListener('click', () => showDetail(record));
    grid.appendChild(card);
  }
}

function showCabinet() {
  renderCabinet();
  updateCabinetLockButton();
  document.getElementById('cabinet-view').classList.remove('hidden');
}

function hideCabinet() {
  document.getElementById('cabinet-view').classList.add('hidden');
}

function updateCabinetLockButton() {
  const btn = document.getElementById('btn-cabinet-lock');
  if (!btn) return;
  if (isCabinetLocked()) {
    btn.textContent = '🔒 解锁展示柜';
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');
    btn.title = '展示柜已锁定 — 点击输入密码解锁';
  } else {
    btn.textContent = '🔓 锁定展示柜';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
    btn.title = '锁定展示柜后无法删除模型';
  }
}

function onToggleCabinetLock() {
  if (isCabinetLocked()) {
    // 解锁
    showUnlockModal(async (hash) => {
      if (hash === getCabinetLockHash()) {
        unlockCabinet();
        updateCabinetLockButton();
        // 详情页若打开，同步删除按钮状态
        updateDetailDeleteButton();
        showToast('展示柜已解锁', 'success');
        return true;
      } else {
        showToast('密码错误', 'error');
        return false;
      }
    }, {
      title: '解锁展示柜',
      desc: '请输入密码以解锁展示柜（解锁后可删除模型）',
    });
  } else {
    // 锁定
    showLockModal((hash) => {
      lockCabinet(hash);
      updateCabinetLockButton();
      updateDetailDeleteButton();
      showToast('展示柜已锁定', 'success');
    }, {
      title: '锁定展示柜',
      desc: '设置密码后，删除模型需要输入密码解锁',
    });
  }
}

function updateDetailDeleteButton() {
  const btn = document.getElementById('btn-detail-delete');
  if (!btn) return;
  if (isCabinetLocked()) {
    btn.textContent = '🔒 展示柜已锁定（先解锁）';
    btn.disabled = true;
    btn.classList.add('btn-disabled');
  } else {
    btn.textContent = '删除模型';
    btn.disabled = false;
    btn.classList.remove('btn-disabled');
  }
}

async function showDetail(record) {
  currentDetailRecord = record;
  document.getElementById('cabinet-detail').classList.remove('hidden');

  // 同步删除按钮状态（展示柜锁定时禁用）
  updateDetailDeleteButton();

  // 更新信息
  document.getElementById('detail-name').textContent = record.name || '未知模型';
  const rarityEl = document.getElementById('detail-rarity');
  rarityEl.textContent = record.rarity || 'common';
  rarityEl.className = `model-rarity rarity-${record.rarity || 'common'}`;

  // 序号 #N/CAP
  const serialEl = document.getElementById('detail-serial');
  if (record.serialNumber && record.seriesCap) {
    serialEl.innerHTML = `<span class="detail-serial-label">序号</span> <span class="detail-serial-num">#${record.serialNumber}</span> <span class="detail-serial-cap">/ ${record.seriesCap}</span>`;
    serialEl.style.display = '';
  } else {
    serialEl.style.display = 'none';
  }

  document.getElementById('detail-code').textContent = record.uniqueCode || '';
  document.getElementById('detail-date').textContent =
    `完成时间: ${new Date(record.completedAt).toLocaleString('zh-CN')}`;
  document.getElementById('detail-duration').textContent =
    `消耗算力: ${formatTokenCount(record.printDuration || 0)}`;

  // 简介：优先用历史快照，回退到 manifest（兼容旧记录）
  const modelEntry = getModelById(record.modelId);
  const description = record.description || (modelEntry && modelEntry.description) || '';
  document.getElementById('detail-description').textContent = description;

  // 当前型号库存（实时）
  const stockEl = document.getElementById('detail-stock');
  if (record.modelId) {
    const remaining = getStock(record.modelId);
    const cap = getCap(record.modelId);
    if (cap > 0) {
      stockEl.innerHTML = `模型库剩余: <strong>${remaining}</strong> / ${cap}`;
      stockEl.style.display = '';
    } else {
      stockEl.style.display = 'none';
    }
  } else {
    stockEl.style.display = 'none';
  }

  // 初始化详情3D视图
  const container = document.getElementById('detail-canvas-container');
  container.innerHTML = '';

  detailScene = new THREE.Scene();
  detailScene.background = new THREE.Color(0x12122a);

  detailCamera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  detailCamera.position.set(3, 3, 5);

  detailRenderer = new THREE.WebGLRenderer({ antialias: true });
  detailRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  detailRenderer.setSize(container.clientWidth, container.clientHeight);
  detailRenderer.toneMapping = THREE.ACESFilmicToneMapping;
  detailRenderer.toneMappingExposure = 1.6;
  container.appendChild(detailRenderer.domElement);

  detailControls = new OrbitControls(detailCamera, detailRenderer.domElement);
  detailControls.enableDamping = true;
  detailControls.dampingFactor = 0.08;
  detailControls.target.set(0, 1.2, 0);
  detailControls.update();

  // 锁定水平轨道角
  const initAz = detailControls.getAzimuthalAngle();
  detailControls.minAzimuthAngle = initAz;
  detailControls.maxAzimuthAngle = initAz;

  // 重置转盘状态
  detailModel = null;
  detailTurntableRotation = 0;
  detailIsDrag = false;

  // 转盘旋转：水平拖拽旋转模型（事件加在 canvas 上以配合 pointer capture）
  const detailCanvas = detailRenderer.domElement;
  detailCanvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) {
      detailIsDrag = true;
      detailPrevPointerX = e.clientX;
    }
  });
  detailCanvas.addEventListener('pointermove', (e) => {
    if (!detailIsDrag || !detailModel) return;
    const dx = e.clientX - detailPrevPointerX;
    detailTurntableRotation += dx * DETAIL_TURNTABLE_SENSITIVITY;
    detailModel.rotation.y = detailTurntableRotation;
    detailPrevPointerX = e.clientX;
  });
  detailCanvas.addEventListener('pointerup', () => {
    detailIsDrag = false;
  });
  detailCanvas.addEventListener('pointercancel', () => {
    detailIsDrag = false;
  });

  // 灯光 — 与主场景一致的多光源设置
  detailScene.add(new THREE.HemisphereLight(0x6699cc, 0x222244, 0.8));
  const mainLight = new THREE.DirectionalLight(0xffeedd, 3.0);
  mainLight.position.set(5, 8, 5);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.set(1024, 1024);
  mainLight.shadow.camera.near = 0.5;
  mainLight.shadow.camera.far = 20;
  detailScene.add(mainLight);

  // 六向聚光灯
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, 1.2, 0);
  detailScene.add(spotTarget);

  const spotConfigs = [
    { key: 'top',    pos: [0, 6, 0],   color: 0xffeedd, intensity: 40 },
    { key: 'bottom', pos: [0, -1, 0],  color: 0x334466, intensity: 15 },
    { key: 'front',  pos: [0, 2, 5],   color: 0xffeedd, intensity: 30 },
    { key: 'back',   pos: [0, 2, -5],  color: 0x6688bb, intensity: 25 },
    { key: 'right',  pos: [5, 2, 0],   color: 0xffeedd, intensity: 30 },
    { key: 'left',   pos: [-5, 2, 0],  color: 0x6688bb, intensity: 25 },
  ];

  const detailSpotLights = {};
  for (const cfg of spotConfigs) {
    const spot = new THREE.SpotLight(cfg.color, cfg.intensity, 15, Math.PI / 5, 0.5, 1);
    spot.position.set(...cfg.pos);
    spot.target = spotTarget;
    detailScene.add(spot);
    detailSpotLights[cfg.key] = spot;
  }

  // 按模型 ID 控制聚光灯
  function applyDetailSpotlightMode(modelId) {
    const noSpot = ['patroller', 'suppressor', 'sapper'];
    const all = () => Object.values(detailSpotLights).forEach(s => s.visible = true);
    const none = () => Object.values(detailSpotLights).forEach(s => s.visible = false);

    if (noSpot.includes(modelId)) {
      none();
    } else if (modelId === 'headhunter') {
      all();
    } else if (modelId === 'sentinel') {
      all();
      detailSpotLights.top.visible = false;
      detailSpotLights.front.visible = false;
    } else {
      all();
    }
  }

  applyDetailSpotlightMode(record.modelId || '');

  // 加载模型（modelEntry 已在上方查询过）
  if (modelEntry) {
    try {
      const model = await loadModel(modelEntry);
      normalizeModel(model);
      detailScene.add(model);
      detailModel = model;
    } catch (e) {
      console.warn('Failed to load detail model:', e);
    }
  }

  // 渲染循环
  function animateDetail() {
    detailAnimId = requestAnimationFrame(animateDetail);
    detailControls.update();
    detailRenderer.render(detailScene, detailCamera);
  }
  animateDetail();

  // 响应窗口大小
  const resizeHandler = () => {
    if (!container.clientWidth) return;
    detailCamera.aspect = container.clientWidth / container.clientHeight;
    detailCamera.updateProjectionMatrix();
    detailRenderer.setSize(container.clientWidth, container.clientHeight);
  };
  window.addEventListener('resize', resizeHandler);
  container._resizeHandler = resizeHandler;
}

function hideDetail() {
  document.getElementById('cabinet-detail').classList.add('hidden');
  if (detailAnimId) cancelAnimationFrame(detailAnimId);
  detailAnimId = null;
  if (detailRenderer) {
    detailRenderer.dispose();
    detailRenderer = null;
  }
  const container = document.getElementById('detail-canvas-container');
  if (container._resizeHandler) {
    window.removeEventListener('resize', container._resizeHandler);
    container._resizeHandler = null;
  }
  container.innerHTML = '';
}

function onDeleteDetail() {
  if (!currentDetailRecord) return;

  // 展示柜锁定时禁止删除
  if (isCabinetLocked()) {
    showToast('展示柜已锁定，请先解锁', 'error');
    return;
  }

  const record = currentDetailRecord;
  showModal({
    title: '删除模型',
    desc: `确定要从展示柜删除 <strong style="color:var(--neon-cyan)">${record.name || '未知模型'}</strong> 吗？<br><span style="color:#ff4444">此操作不可撤销</span><br><span style="color:#ffb84d;font-size:0.85rem">⚠ 模型库存不会返还，世上将永远少一只</span>`,
    buttons: [
      { id: 'cancel', text: '取消 (Esc)', style: 'outline', escape: true },
      { id: 'ok', text: '确认删除', style: 'primary', enter: true },
    ],
  }).then((result) => {
    if (result === 'ok') {
      removeFromCabinet(record.uniqueCode);
      showToast('模型已删除', 'success');
      hideDetail();
      renderCabinet();
      currentDetailRecord = null;
      window.dispatchEvent(new CustomEvent('cabinet-changed'));
    }
  });
}

let sceneCaptureFns = null;

export function setSceneCaptureFns(fns) {
  sceneCaptureFns = fns;
}

export function captureThumbnail() {
  if (!sceneCaptureFns) return '';
  const renderer = sceneCaptureFns.getRenderer();
  const scene = sceneCaptureFns.getScene();
  const camera = sceneCaptureFns.getCamera();

  renderer.render(scene, camera);
  try {
    return renderer.domElement.toDataURL('image/jpeg', 0.5);
  } catch (e) {
    return '';
  }
}

function formatTokenCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(str) {
  return str.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('已复制到剪贴板', 'success');
  }).catch(() => {
    // 降级
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('已复制到剪贴板', 'success');
  });
}

function showToast(msg, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}
