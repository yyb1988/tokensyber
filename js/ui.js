import * as THREE from 'three';
import * as gameState from './game-state.js';
import { getRandomModel, loadModel, normalizeModel, getModelById, getManifest } from './model-manager.js';
import { startPrint, startPrintDirect, stopPrint } from './printer.js';
import { showLockModal, showUnlockModal, hashPassword } from './lock-system.js';
import { generateUniqueCode } from './unique-code.js';
import { init as coinInit, stop as coinStop, restart as coinRestart, collectAll as coinCollectAll } from './coin-system.js';
import { init as cabinetInit, renderCabinet, captureThumbnail, setSceneCaptureFns, getDetailControls, getDetailCamera } from './cabinet.js';
import { getScene, getCamera, getRenderer, resetCamera, rotateLeft, rotateRight, rotateUp, rotateDown, zoomIn, zoomOut } from './scene.js';

let uiUpdateInterval = null;
let currentModelEntry = null;

// 按键状态追踪（WASD/QE持续按住）
const keysDown = new Set();

export function init() {
  // UI按钮事件
  document.getElementById('btn-regenerate').addEventListener('click', onRegenerate);
  document.getElementById('btn-lock').addEventListener('click', onLock);
  document.getElementById('btn-copy-code').addEventListener('click', onCopyCode);

  // 初始化子模块
  coinInit(onCoinCollect);
  cabinetInit();
  setSceneCaptureFns({ getRenderer, getScene, getCamera });

  // 打印完成事件
  window.addEventListener('print-complete', onPrintComplete);

  // 快捷键系统
  initKeyboardShortcuts();

  // 初始化UI状态
  const print = gameState.getCurrentPrint();
  if (print.modelId) {
    // 有进行中的打印，恢复
    resumePrint(print.modelId);
  } else {
    // 自动开始新的打印
    startNewPrint();
  }

  // UI更新循环（每秒更新一次进度和时间显示）
  uiUpdateInterval = setInterval(updateUI, 1000);
  updateUI();
}

async function startNewPrint() {
  try {
    const modelEntry = getRandomModel();
    if (!modelEntry) {
      console.error('startNewPrint: getRandomModel returned null, manifest:', getManifest());
      return;
    }

    currentModelEntry = modelEntry;
    const model = await loadModel(modelEntry);
    normalizeModel(model);

    gameState.startPrint(modelEntry.id);
    startPrint(model);

    document.getElementById('current-model-name').textContent = modelEntry.name;
    const rarityEl = document.getElementById('current-model-rarity');
    rarityEl.textContent = modelEntry.rarity;
    rarityEl.className = `model-rarity rarity-${modelEntry.rarity}`;
    document.getElementById('completion-section').classList.add('hidden');

    document.getElementById('loading-overlay').classList.add('hidden');

    updateLockButton();
  } catch (e) {
    console.error('startNewPrint failed:', e);
    document.getElementById('loading-overlay').innerHTML =
      `<div class="loading-text" style="color:#ff4444">初始化失败: ${e.message}</div>`;
  }
}

async function resumePrint(modelId) {
  const modelEntry = getModelById(modelId);
  if (!modelEntry) {
    startNewPrint();
    return;
  }

  currentModelEntry = modelEntry;
  const model = await loadModel(modelEntry);
  normalizeModel(model);

  if (gameState.isComplete()) {
    // 已完成的打印，直接展示完整模型
    startPrintCompleted(model);
    document.getElementById('completion-section').classList.remove('hidden');
    // 3秒后自动开始下一个模型
    setTimeout(() => {
      doRegenerate();
    }, 3000);
    return;
  } else {
    startPrint(model);
  }

  document.getElementById('current-model-name').textContent = modelEntry.name;
  const rarityEl = document.getElementById('current-model-rarity');
  rarityEl.textContent = modelEntry.rarity;
  rarityEl.className = `model-rarity rarity-${modelEntry.rarity}`;

  document.getElementById('loading-overlay').classList.add('hidden');
  updateLockButton();
}

function startPrintCompleted(model) {
  startPrintDirect(model);
}

function onRegenerate() {
  if (gameState.isLocked()) {
    showUnlockModal((hash) => {
      if (hash === gameState.getLockHash()) {
        gameState.unlock();
        showRegenerateConfirm();
        return true;
      } else {
        showToast('密码错误', 'error');
        const input = document.getElementById('lock-password');
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 400);
        return false;
      }
    });
  } else {
    showRegenerateConfirm();
  }
}

async function doRegenerate() {
  coinStop();
  stopPrint();
  startNewPrint();
  coinRestart(onCoinCollect);
}

// 重新生成二次确认
function showRegenerateConfirm() {
  const modal = document.getElementById('confirm-modal');
  const title = document.getElementById('confirm-modal-title');
  const desc = document.getElementById('confirm-modal-desc');
  const btnCancel = document.getElementById('btn-confirm-cancel');
  const btnOk = document.getElementById('btn-confirm-ok');
  const backdrop = modal.querySelector('.modal-backdrop');

  title.textContent = '重新生成';
  desc.textContent = '确定要重新生成吗？当前进度将丢失。';

  modal.classList.remove('hidden');

  const cleanup = () => {
    modal.classList.add('hidden');
    btnCancel.removeEventListener('click', onCancel);
    btnOk.removeEventListener('click', onOk);
    backdrop.removeEventListener('click', onCancel);
  };

  const onCancel = () => cleanup();
  const onOk = () => { cleanup(); doRegenerate(); };

  btnCancel.addEventListener('click', onCancel);
  btnOk.addEventListener('click', onOk);
  backdrop.addEventListener('click', onCancel);
}

function onLock() {
  if (gameState.isLocked()) {
    showUnlockModal((hash) => {
      if (hash === gameState.getLockHash()) {
        gameState.unlock();
        updateLockButton();
        showToast('模型已解锁', 'success');
        return true;
      } else {
        showToast('密码错误', 'error');
        return false;
      }
    });
  } else {
    showLockModal((hash) => {
      gameState.setLock(hash);
      updateLockButton();
      showToast('模型已锁定', 'success');
    });
  }
}

function updateLockButton() {
  const btn = document.getElementById('btn-lock');
  if (gameState.isLocked()) {
    btn.textContent = '解锁 (L)';
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-primary');
  } else {
    btn.textContent = '锁定 (L)';
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
  }
}

function onCoinCollect(amount) {
  gameState.addCoins(amount);
  document.getElementById('coin-count').textContent = gameState.getCoins();
  // 金币计数脉冲动画
  const el = document.getElementById('coin-count');
  el.style.transform = 'scale(1.3)';
  setTimeout(() => el.style.transform = 'scale(1)', 200);
}

let isCompleting = false;

async function onPrintComplete() {
  if (isCompleting) return;
  isCompleting = true;

  // 模型完成后自动收集所有场上金币
  coinCollectAll();

  const modelId = gameState.getCurrentPrint().modelId;
  const code = await generateUniqueCode(modelId, Date.now());
  const thumbnail = captureThumbnail();

  // 保存到展示柜
  gameState.addToCabinet({
    modelId,
    uniqueCode: code,
    completedAt: Date.now(),
    thumbnail,
    printDuration: gameState.getAccumulatedTokens(),
    name: currentModelEntry?.name || '未知模型',
    rarity: currentModelEntry?.rarity || 'common',
  });

  // 显示完成区域
  document.getElementById('unique-code').textContent = code;
  document.getElementById('completion-section').classList.remove('hidden');

  showToast('模型生成完毕!', 'success');

  // 3秒后自动开始下一个模型
  setTimeout(() => {
    isCompleting = false;
    doRegenerate();
  }, 3000);
}

function onCopyCode() {
  const code = document.getElementById('unique-code').textContent;
  copyToClipboard(code);
}

function updateUI() {
  const progress = gameState.getProgress();
  const accumulated = gameState.getAccumulatedTokens();
  const target = gameState.getCompletionTarget();

  // 进度条
  document.getElementById('progress-bar-fill').style.width = `${(progress * 100).toFixed(2)}%`;
  document.getElementById('progress-percent').textContent = `${(progress * 100).toFixed(1)}%`;

  // 算力进度
  document.getElementById('remaining-time').textContent =
    `算力: ${formatTokenCount(accumulated)} / ${formatTokenCount(target)}`;

  // 金币
  document.getElementById('coin-count').textContent = gameState.getCoins();

  // 完成检测
  if (progress >= 1 && document.getElementById('completion-section').classList.contains('hidden')) {
    // 完成但还没触发事件（可能在帧更新之前）
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
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('已复制到剪贴板', 'success');
  });
}

export function showToast(msg, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// === 快捷键系统 ===

function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    const inInput = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

    // 持续按住的键（WASD/QE）— 输入框内不拦截
    if (!inInput && 'wasdqe'.includes(key)) {
      keysDown.add(key);
      e.preventDefault();
      return;
    }

    // Enter/Escape 在任何情况下都响应（弹窗内输入框也需要）
    if (key === 'enter') {
      e.preventDefault();
      handleEnterKey();
      return;
    }
    if (key === 'escape') {
      e.preventDefault();
      handleEscapeKey();
      return;
    }

    // 其他快捷键 — 输入框内不拦截
    if (inInput) return;

    switch (key) {
      case 'r':
        e.preventDefault();
        onRegenerate();
        break;
      case 'l':
        e.preventDefault();
        onLock();
        break;
      case 'c':
        e.preventDefault();
        toggleCabinet();
        break;
      case ' ':
        e.preventDefault();
        coinCollectAll();
        showToast('收集所有金币', 'coin');
        break;
      case 'f':
        e.preventDefault();
        resetCamera();
        showToast('视角已重置', 'success');
        break;
    }
  });

  document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    keysDown.delete(key);
  });
}

const ROTATE_SPEED = 0.08;
const MIN_PHI = 0.05;
const MAX_PHI = Math.PI - 0.05;

function rotateCameraSpherical(cam, target, deltaPhi, deltaTheta) {
  const offset = new THREE.Vector3().subVectors(cam.position, target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.phi = Math.max(MIN_PHI, Math.min(MAX_PHI, spherical.phi + deltaPhi));
  spherical.theta += deltaTheta;
  offset.setFromSpherical(spherical);
  cam.position.copy(target).add(offset);
}

// 每帧处理持续按键（WASD/QE 旋转/缩放）
export function processKeyboardInput() {
  const detailEl = document.getElementById('cabinet-detail');
  const inDetail = detailEl && !detailEl.classList.contains('hidden');

  if (inDetail) {
    const cam = getDetailCamera();
    const ctrl = getDetailControls();
    if (!cam || !ctrl) return;
    const target = ctrl.target;
    if (keysDown.has('a')) rotateCameraSpherical(cam, target, 0, ROTATE_SPEED);
    if (keysDown.has('d')) rotateCameraSpherical(cam, target, 0, -ROTATE_SPEED);
    if (keysDown.has('w')) rotateCameraSpherical(cam, target, -ROTATE_SPEED, 0);
    if (keysDown.has('s')) rotateCameraSpherical(cam, target, ROTATE_SPEED, 0);
    return;
  }

  if (keysDown.has('a')) rotateLeft();
  if (keysDown.has('d')) rotateRight();
  if (keysDown.has('w')) rotateUp();
  if (keysDown.has('s')) rotateDown();
  if (keysDown.has('q')) zoomIn();
  if (keysDown.has('e')) zoomOut();
}

function toggleCabinet() {
  const cabinetView = document.getElementById('cabinet-view');
  if (cabinetView.classList.contains('hidden')) {
    renderCabinet();
    cabinetView.classList.remove('hidden');
  } else {
    cabinetView.classList.add('hidden');
  }
}

function handleEscapeKey() {
  const lockModal = document.getElementById('lock-modal');
  const confirmModal = document.getElementById('confirm-modal');
  const cabinetDetail = document.getElementById('cabinet-detail');
  const cabinetView = document.getElementById('cabinet-view');

  if (lockModal && !lockModal.classList.contains('hidden')) {
    document.getElementById('btn-lock-cancel').click();
    return;
  }
  if (confirmModal && !confirmModal.classList.contains('hidden')) {
    document.getElementById('btn-confirm-cancel').click();
    return;
  }
  if (cabinetDetail && !cabinetDetail.classList.contains('hidden')) {
    document.getElementById('btn-detail-back').click();
    return;
  }
  if (cabinetView && !cabinetView.classList.contains('hidden')) {
    document.getElementById('btn-cabinet-close').click();
    return;
  }
}

function handleEnterKey() {
  const lockModal = document.getElementById('lock-modal');
  const confirmModal = document.getElementById('confirm-modal');

  if (lockModal && !lockModal.classList.contains('hidden')) {
    document.getElementById('btn-lock-confirm').click();
    return;
  }
  if (confirmModal && !confirmModal.classList.contains('hidden')) {
    document.getElementById('btn-confirm-ok').click();
    return;
  }
}

