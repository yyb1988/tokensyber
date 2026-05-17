import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getCabinet } from './game-state.js';
import { loadModel, normalizeModel, getModelById } from './model-manager.js';

let detailRenderer, detailScene, detailCamera, detailControls;
let detailAnimId = null;

export function getDetailControls() { return detailControls; }
export function getDetailCamera() { return detailCamera; }

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
}

export function renderCabinet() {
  const grid = document.getElementById('cabinet-grid');
  const cabinet = getCabinet();

  if (cabinet.length === 0) {
    grid.innerHTML = '<div class="cabinet-empty">还没有完成的模型</div>';
    return;
  }

  grid.innerHTML = '';
  for (const record of cabinet) {
    const card = document.createElement('div');
    card.className = 'cabinet-card';

    const img = document.createElement('img');
    img.src = record.thumbnail || '';
    img.alt = record.name;
    if (!record.thumbnail) {
      img.style.background = 'var(--bg-tertiary)';
    }

    const info = document.createElement('div');
    info.className = 'cabinet-card-info';
    info.innerHTML = `
      <div class="cabinet-card-name">${record.name || '未知模型'}</div>
      <span class="model-rarity rarity-${record.rarity || 'common'}">${record.rarity || 'common'}</span>
      <div class="cabinet-card-code">${record.uniqueCode || ''}</div>
    `;

    card.appendChild(img);
    card.appendChild(info);
    card.addEventListener('click', () => showDetail(record));
    grid.appendChild(card);
  }
}

function showCabinet() {
  renderCabinet();
  document.getElementById('cabinet-view').classList.remove('hidden');
}

function hideCabinet() {
  document.getElementById('cabinet-view').classList.add('hidden');
}

async function showDetail(record) {
  document.getElementById('cabinet-detail').classList.remove('hidden');

  // 更新信息
  document.getElementById('detail-name').textContent = record.name || '未知模型';
  const rarityEl = document.getElementById('detail-rarity');
  rarityEl.textContent = record.rarity || 'common';
  rarityEl.className = `model-rarity rarity-${record.rarity || 'common'}`;
  document.getElementById('detail-code').textContent = record.uniqueCode || '';
  document.getElementById('detail-date').textContent =
    `完成时间: ${new Date(record.completedAt).toLocaleString('zh-CN')}`;
  document.getElementById('detail-duration').textContent =
    `消耗算力: ${formatTokenCount(record.printDuration || 0)}`;

  // 初始化详情3D视图
  const container = document.getElementById('detail-canvas-container');
  container.innerHTML = '';

  detailScene = new THREE.Scene();
  detailScene.background = new THREE.Color(0x0a0a1a);

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
  detailRenderer.toneMappingExposure = 1.2;
  container.appendChild(detailRenderer.domElement);

  detailControls = new OrbitControls(detailCamera, detailRenderer.domElement);
  detailControls.enableDamping = true;
  detailControls.dampingFactor = 0.08;
  detailControls.target.set(0, 1.2, 0);

  // 灯光 — 仅保留微弱环境光 + 一盏主方向光，旋转时明暗变化极其明显
  detailScene.add(new THREE.AmbientLight(0x111122, 0.06));
  const dirLight = new THREE.DirectionalLight(0xffffff, 3.5);
  dirLight.position.set(5, 8, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 20;
  detailScene.add(dirLight);

  // 加载模型
  const modelEntry = getModelById(record.modelId);
  if (modelEntry) {
    try {
      const model = await loadModel(modelEntry);
      normalizeModel(model);
      detailScene.add(model);
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
