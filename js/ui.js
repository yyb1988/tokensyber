import * as THREE from 'three';
import * as gameState from './game-state.js';
import { getRandomModel, loadModel, normalizeModel, getModelById, getManifest, hasPickableModel, assetUrl } from './model-manager.js';
import { startPrint, startPrintDirect, stopPrint, getCurrentModel } from './printer.js';
import { showLockModal, showUnlockModal, hashPassword } from './lock-system.js';
import { showModal, cancelModal } from './modal.js';
import { generateUniqueCode } from './unique-code.js';
import {
  init as coinInit,
  tickAccumulated as coinTick,
  transferPendingToPlayer as coinTransfer,
  returnPendingToPool as coinReturn,
  resetForNewPrint as coinResetForNewPrint,
  resumeFromAccumulated as coinResumeFromAccumulated,
  getPendingCoins,
  getPoolRemaining,
  COIN_POOL_CAP,
  TOKENS_PER_COIN,
} from './coin-system.js';
import { init as cabinetInit, renderCabinet, captureThumbnail, setSceneCaptureFns, getDetailControls, getDetailCamera, rotateDetailModelLeft, rotateDetailModelRight } from './cabinet.js';
import { getScene, getCamera, getRenderer, resetCamera, rotateModelLeft, rotateModelRight, rotateUp, rotateDown, zoomIn, zoomOut } from './scene.js';
import { disconnect as fuelDisconnect } from './fuel-client.js';
import { consumeStock, getStock, getCap, isAllSoldOut } from './stock.js';
import * as sound from './sound-system.js';
import * as banSystem from './ban-system.js';
import * as market from './market.js';

let uiUpdateInterval = null;
let currentModelEntry = null;
let waitingForClick = false;
let pendingCompletion = false; // true when model needs to be saved to cabinet on click
let isLoadingNewPrint = false; // 防止并发 startNewPrint
const mouseDownPos = { x: 0, y: 0 };
let lastInjectTime = 0;
let lastDisplayedIncrementTick = 0;
let lastDisplayedTotalInjected = -1;

// 注入速率追踪（用于 ETA 计算）
const injectRateSamples = []; // { time, amount } 最近 5 秒
const RATE_WINDOW_MS = 5000;
let lastETA = '';

// 按键状态追踪（WASD/QE持续按住）
const keysDown = new Set();

export function init() {
  // UI按钮事件
  document.getElementById('btn-regenerate').addEventListener('click', onRegenerate);
  document.getElementById('btn-lock').addEventListener('click', onLock);
  document.getElementById('btn-copy-code').addEventListener('click', onCopyCode);
  document.getElementById('btn-fuel-toggle').addEventListener('click', onFuelToggle);

  // 抽屉切换
  document.querySelectorAll('.drawer-head').forEach(head => {
    head.addEventListener('click', () => {
      head.parentElement.classList.toggle('open');
    });
  });

  // 迷你 Ban 槽位点击（事件委托）
  document.getElementById('ban-slot-mini')?.addEventListener('click', (e) => {
    const slot = e.target.closest('[data-slot]');
    if (!slot) return;
    const idx = parseInt(slot.dataset.slot, 10);
    onBanSlotClick(idx);
  });

  // 市场按钮
  document.getElementById('btn-market').addEventListener('click', showMarket);
  document.getElementById('btn-market-close').addEventListener('click', hideMarket);
  document.getElementById('btn-market-history').addEventListener('click', showMarketHistory);
  document.getElementById('btn-history-close').addEventListener('click', hideMarketHistory);

  // 引导标签切换
  document.querySelectorAll('.guide-tab').forEach(tab => {
    tab.addEventListener('click', () => switchGuideTab(tab.dataset.tab));
  });
  // 复制提示词
  document.getElementById('btn-copy-prompt')?.addEventListener('click', onCopyPrompt);

  // 音效开关
  document.getElementById('btn-sound').addEventListener('click', toggleSound);
  updateSoundButton();

  // 背景音乐开关
  document.getElementById('btn-bgm').addEventListener('click', toggleBgm);
  updateBgmButton();

  // 全局按钮点击音效（事件委托）
  document.addEventListener('click', (e) => {
    if (e.target.closest('button') && !e.target.closest('#btn-sound') && !e.target.closest('#btn-bgm')) {
      sound.playClick();
    }
  });

  // 储液罐控制
  document.getElementById('btn-flow-auto').addEventListener('click', () => setFlowMode('auto'));
  document.getElementById('btn-flow-manual').addEventListener('click', () => setFlowMode('manual'));
  document.getElementById('btn-inject').addEventListener('click', onInject);
  document.getElementById('btn-stop-inject').addEventListener('click', onStopInject);

  // 初始化子模块
  coinInit({
    onMint: onCoinMint,       // 每枚新铸造（仅 UI 提示，不入账）
    onTransfer: onCoinTransfer, // 收取模型时转入玩家账户
  });
  cabinetInit();
  setSceneCaptureFns({ getRenderer, getScene, getCamera });

  // 首次渲染 ban 槽位
  renderBanSlots();

  // 展示柜变化时刷新 ban 槽位（删除模型可能让解锁回退）
  window.addEventListener('cabinet-changed', renderBanSlots);

  // 打印完成事件
  window.addEventListener('print-complete', onPrintComplete);

  // 模型点击收取
  initModelClickHandler();

  // 快捷键系统
  initKeyboardShortcuts();

  // 初始化UI状态
  const print = gameState.getCurrentPrint();
  if (print.modelId) {
    // 有进行中的打印，恢复
    const modelEntry = getModelById(print.modelId);
    if (!modelEntry) {
      // 旧模型不在新 manifest 中，清除状态重新开始
      gameState.startPrint(null);
      startNewPrint();
    } else {
      resumePrint(print.modelId);
    }
  } else {
    // 自动开始新的打印
    startNewPrint();
  }

  // 初始化储液罐模式UI
  updateFlowModeUI(gameState.getFlowMode());
  updateTankControls();

  // 恢复音效开关状态
  const savedSound = gameState.getState().settings?.soundEnabled;
  if (savedSound === false) sound.setEnabled(false);
  updateSoundButton();

  // 恢复背景音乐开关状态
  const savedBgm = gameState.getState().settings?.bgmEnabled;
  if (savedBgm === false) sound.setBgmEnabled(false);
  updateBgmButton();

  // UI更新循环（每秒更新一次进度和时间显示）
  uiUpdateInterval = setInterval(updateUI, 1000);
  updateUI();

  // 注入循环
  lastInjectTime = performance.now();
  requestAnimationFrame(injectLoop);
}

async function startNewPrint() {
  if (isLoadingNewPrint) return;
  isLoadingNewPrint = true;
  try {
    const modelEntry = getRandomModel();
    if (!modelEntry) {
      // 没有可抽取模型（全部售罄 或 全部被 ban）
      const allSoldOut = isAllSoldOut();
      if (allSoldOut) {
        document.getElementById('loading-overlay').classList.remove('hidden');
        document.getElementById('loading-overlay').innerHTML =
          '<div class="loading-text" style="color:var(--neon-cyan)">全部模型已售罄<br><span style="font-size:0.8rem;color:var(--text-secondary)">世上每一只模型都已诞生，不再有新的产出</span></div>';
        showToast('模型库已全部售罄', 'error');
      } else {
        // 库存还有，但全被 ban 了 — 提示玩家调整 ban
        document.getElementById('loading-overlay').classList.remove('hidden');
        document.getElementById('loading-overlay').innerHTML =
          '<div class="loading-text" style="color:#ff6666">所有可生成的模型都被 Ban 了<br><span style="font-size:0.8rem;color:var(--text-secondary)">请清空一个 Ban 槽位</span></div>';
        showToast('全部模型已被 Ban，无法生成', 'error');
      }
      return;
    }

    currentModelEntry = modelEntry;
    document.getElementById('current-model-name').textContent = modelEntry.name;
    const rarityEl = document.getElementById('current-model-rarity');
    rarityEl.textContent = modelEntry.rarity;
    rarityEl.className = `model-rarity rarity-${modelEntry.rarity}`;
    updateModelStockDisplay(modelEntry.id);

    const model = await loadModel(modelEntry);
    normalizeModel(model);

    if (currentModelEntry !== modelEntry) return;

    gameState.startPrint(modelEntry.id, modelEntry.rarity);
    coinResetForNewPrint();
    updatePendingCoinDisplay();
    sound.playReveal(modelEntry.rarity);

    if (gameState.isComplete()) {
      startPrintCompleted(model);
      pendingCompletion = true;
      waitingForClick = true;
      showClickHint();
    } else {
      startPrint(model);
      document.getElementById('completion-section').classList.add('hidden');
    }

    document.getElementById('loading-overlay').classList.add('hidden');

    updateLockButton();
    updateTankControls();
  } catch (e) {
    console.error('startNewPrint failed:', e);
    document.getElementById('loading-overlay').innerHTML =
      `<div class="loading-text" style="color:#ff4444">初始化失败: ${e.message}</div>`;
  } finally {
    isLoadingNewPrint = false;
  }
}

async function resumePrint(modelId) {
  try {
    const modelEntry = getModelById(modelId);
    if (!modelEntry) {
      // 旧模型不在新 manifest 中，重新开始
      gameState.startPrint(null);
      await startNewPrint();
      return;
    }

    // 先更新名称显示
    currentModelEntry = modelEntry;
    document.getElementById('current-model-name').textContent = modelEntry.name;
    const rarityEl = document.getElementById('current-model-rarity');
    rarityEl.textContent = modelEntry.rarity;
    rarityEl.className = `model-rarity rarity-${modelEntry.rarity}`;
    updateModelStockDisplay(modelEntry.id);

    // 同步当前 print 的 rarity（处理 manifest 改动或老存档迁移占位）
    const cp = gameState.getCurrentPrint();
    if (cp.rarity !== modelEntry.rarity) {
      cp.rarity = modelEntry.rarity;
    }

    // 恢复金币 checkpoint：已消耗的 token 已经在历史会话中铸过币（或正在重启）
    // resume 时不补发也不重扣，新会话只算新进度产出的金币
    coinResumeFromAccumulated(gameState.getAccumulatedTokens());
    updatePendingCoinDisplay();

    const model = await loadModel(modelEntry);
    normalizeModel(model);

    // 加载完成后确认未被覆盖
    if (currentModelEntry !== modelEntry) return;

    document.getElementById('loading-overlay').classList.add('hidden');

    if (gameState.isComplete()) {
      // 已完成的打印，展示完整模型，等待玩家点击收取
      startPrintCompleted(model);
      // 检查是否已在展示柜中（避免重复保存）
      const cabinet = gameState.getCabinet();
      const alreadySaved = cabinet.some(r => r.modelId === modelId);
      pendingCompletion = !alreadySaved;
      waitingForClick = true;
      showClickHint();
    } else {
      startPrint(model);
    }

    updateLockButton();
  } catch (e) {
    console.error('resumePrint failed:', e);
    // 加载失败，清除旧状态重新开始
    gameState.startPrint(null);
    await startNewPrint();
  }
}

function startPrintCompleted(model) {
  startPrintDirect(model);
}

function onRegenerate() {
  if (gameState.isLocked()) {
    showUnlockModal((hash) => {
      if (hash === gameState.getLockHash()) {
        gameState.unlock();
        // 解锁后如果已完成，直接免费收取并开始新模型
        if (gameState.isComplete()) {
          collectAndContinue();
        } else {
          showRegenerateConfirm();
        }
        return true;
      } else {
        showToast('密码错误', 'error');
        const input = document.getElementById('lock-password');
        input.classList.add('shake');
        setTimeout(() => input.classList.remove('shake'), 400);
        return false;
      }
    });
  } else if (gameState.isComplete()) {
    // 已完成的模型，免费收取并开始新模型（同点击收取）
    collectAndContinue();
  } else {
    showRegenerateConfirm();
  }
  updateRegenerateButton();
}

async function doRegenerate() {
  // 放弃当前模型：积攒的金币归还池
  coinReturn();
  sound.playRegenerate();
  stopPrint();
  waitingForClick = false;
  pendingCompletion = false;
  hideClickHint();
  document.getElementById('completion-section').classList.add('hidden');
  document.getElementById('click-hint').classList.add('hidden');
  gameState.stopInjection();
  gameState.startPrint(null);
  isLoadingNewPrint = false;
  try {
    await startNewPrint();
  } catch (e) {
    console.error('doRegenerate failed:', e);
    isLoadingNewPrint = false;
    showToast('模型加载失败，请重试', 'error');
  }
}

// === 储液罐注入循环 ===

function injectLoop(now) {
  const dt = (now - lastInjectTime) / 1000;
  lastInjectTime = now;

  // 自动模式：有模型且未完成时自动注入
  if (gameState.getFlowMode() === 'auto' && gameState.getCurrentPrint().modelId && !gameState.isComplete()) {
    if (!gameState.getIsInjecting()) {
      gameState.startInjection();
    }
  }

  const injected = gameState.injectTokens(dt);

  // 注入时触发 fuel-pulse 视觉效果 + 推进金币累积 + 速率采样
  if (injected > 0) {
    window.dispatchEvent(new CustomEvent('fuel-pulse', { detail: { tokens: injected } }));
    coinTick(gameState.getAccumulatedTokens());
    injectRateSamples.push({ time: now, amount: injected });
  }
  // 移除窗口外的样本
  const cutoff = now - RATE_WINDOW_MS;
  while (injectRateSamples.length && injectRateSamples[0].time < cutoff) {
    injectRateSamples.shift();
  }

  // 更新储液罐显示
  updateTankDisplay();
  // 更新模型 pending 金币显示
  updatePendingCoinDisplay();

  // 模型完成时自动停止注入，更新按钮状态
  if (gameState.isComplete() && gameState.getIsInjecting()) {
    gameState.stopInjection();
  }
  updateTankControls();

  requestAnimationFrame(injectLoop);
}

function setFlowMode(mode) {
  gameState.setFlowMode(mode);
  updateFlowModeUI(mode);
  if (mode === 'auto') {
    // 切换到自动模式，如果当前在注入则停止手动注入，让自动逻辑接管
    updateTankControls();
  } else {
    // 切换到手动模式，停止注入
    gameState.stopInjection();
    updateTankControls();
  }
}

function onInject() {
  if (!gameState.getCurrentPrint().modelId || gameState.isComplete()) {
    showToast('没有正在进行的模型', 'error');
    return;
  }
  if (gameState.getTankBalance() <= 0) {
    showToast('储液罐为空', 'error');
    return;
  }
  gameState.startInjection();
  updateTankControls();
}

function onStopInject() {
  gameState.stopInjection();
  updateTankControls();
}

function updateFlowModeUI(mode) {
  const btnAuto = document.getElementById('btn-flow-auto');
  const btnManual = document.getElementById('btn-flow-manual');
  if (mode === 'auto') {
    btnAuto.classList.add('active');
    btnManual.classList.remove('active');
  } else {
    btnAuto.classList.remove('active');
    btnManual.classList.add('active');
  }
}

function updateTankControls() {
  const btnInject = document.getElementById('btn-inject');
  const btnStop = document.getElementById('btn-stop-inject');
  const mode = gameState.getFlowMode();
  const injecting = gameState.getIsInjecting();

  if (mode === 'manual') {
    if (injecting) {
      btnInject.classList.add('hidden');
      btnStop.classList.remove('hidden');
    } else {
      btnInject.classList.remove('hidden');
      btnStop.classList.add('hidden');
    }
  } else {
    // 自动模式隐藏手动按钮
    btnInject.classList.add('hidden');
    btnStop.classList.add('hidden');
  }
}

function updateTankDisplay() {
  const balance = gameState.getTankBalance();
  document.getElementById('tank-balance').textContent = formatTokenCount(balance);
  // 储液罐进度条满格 = 1 亿 token（仅视觉刻度，储液罐本身不设上限）
  const TANK_BAR_MAX = 100_000_000;
  const fillPct = Math.min(balance / TANK_BAR_MAX, 1) * 100;
  document.getElementById('tank-bar-fill').style.width = `${fillPct}%`;
  // 最近一次增量（按 tick 判定新事件，确保等值的多次入罐也能各自闪烁）
  const incEl = document.getElementById('tank-increment');
  const tick = gameState.getLastIncrementTick();
  if (tick !== lastDisplayedIncrementTick) {
    lastDisplayedIncrementTick = tick;
    const lastInc = gameState.getLastIncrement();
    if (lastInc > 0) {
      incEl.textContent = '+' + formatTokenCount(lastInc);
      incEl.classList.remove('pulse');
      void incEl.offsetWidth; // 强制重绘以重启动画
      incEl.classList.add('pulse');
    }
  }
  // 累计注入总量
  updateTotalInjectedDisplay();
}

function updateTotalInjectedDisplay() {
  const total = gameState.getTotalInjected();
  if (total === lastDisplayedTotalInjected) return;
  const el = document.getElementById('total-injected-count');
  if (!el) return;
  el.textContent = formatTokenCountFull(total);
  // 仅在确有变化（非首次渲染）时触发脉冲
  if (lastDisplayedTotalInjected >= 0) {
    el.classList.remove('pulse');
    // 强制重绘以重启动画
    void el.offsetWidth;
    el.classList.add('pulse');
  }
  lastDisplayedTotalInjected = total;
}

// 累计算力用更精确的格式（保留更多位以体现"历史总量"语义）
function formatTokenCountFull(n) {
  if (n >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + 'B';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return Math.floor(n).toString();
}

// 重新生成二次确认
function showRegenerateConfirm() {
  const freeLeft = gameState.getRegenerationsLeft();
  const canFree = freeLeft > 0;

  showModal({
    title: '重新生成',
    desc: canFree
      ? `确定要重新生成吗？当前进度将丢失。<br><span style="color:var(--neon-green)">今日剩余次数：${freeLeft}</span>`
      : `今日重新生成次数已用完（每日 3 次）。<br><span style="color:var(--text-secondary)">请等待明日恢复</span>`,
    buttons: [
      { id: 'cancel', text: '取消 (Esc)', style: 'outline', escape: true },
      { id: 'ok', text: '确定', style: 'primary', enter: true, disabled: !canFree },
    ],
  }).then((result) => {
    if (result === 'ok' && gameState.useRegeneration()) {
      doRegenerate();
    }
  });
}

// 提取算力功能已移除

function onLock() {
  if (gameState.isLocked()) {
    showUnlockModal((hash) => {
      if (hash === gameState.getLockHash()) {
        gameState.unlock();
        updateLockButton();
        showToast('模型已解锁', 'success');
        sound.playUnlock();
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
      sound.playLock();
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

function updateRegenerateButton() {
  const btn = document.getElementById('btn-regenerate');
  const left = gameState.getRegenerationsLeft();
  btn.textContent = `重新生成 (${left}) (R)`;
}

// 每枚新铸造 — 仅刷新 pending 金币显示并轻度脉冲（不入账）
function onCoinMint(amount) {
  const el = document.getElementById('pending-coin-count');
  if (el) {
    el.classList.remove('pulse');
    void el.offsetWidth;
    el.classList.add('pulse');
  }
  sound.playCoin();
  updatePendingCoinDisplay();
}

// 模型收取时一次性入账
function onCoinTransfer(amount) {
  gameState.addCoins(amount);
  document.getElementById('coin-count').textContent = gameState.getCoins();
  // 金币计数脉冲动画
  const el = document.getElementById('coin-count');
  el.style.transform = 'scale(1.3)';
  setTimeout(() => el.style.transform = 'scale(1)', 200);
  showToast(`+${amount} 金币到账（模型积攒）`, 'coin');
}

let lastDisplayedPending = -1;
function updatePendingCoinDisplay() {
  const el = document.getElementById('pending-coin-count');
  if (!el) return;
  const pending = getPendingCoins();
  if (pending === lastDisplayedPending) return;
  lastDisplayedPending = pending;
  el.textContent = pending;
  const wrap = document.getElementById('pending-coin-display');
  if (wrap) wrap.classList.toggle('hidden', pending === 0 && !gameState.getCurrentPrint().modelId);
}

let isCompleting = false;

async function onPrintComplete() {
  if (isCompleting) return;
  isCompleting = true;

  // 模型完成，停止注入，储液罐开始存储
  gameState.stopInjection();
  sound.playPrintComplete();
  updateTankControls();

  // 等待玩家点击模型收取
  pendingCompletion = true;
  waitingForClick = true;
  showClickHint();
}

function onCopyCode() {
  const code = document.getElementById('unique-code').textContent;
  copyToClipboard(code);
}

function onFuelToggle() {
  fuelDisconnect();
}

function switchGuideTab(tabName) {
  document.querySelectorAll('.guide-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tabName);
  });
  document.getElementById('guide-connect').classList.toggle('hidden', tabName !== 'connect');
  document.getElementById('guide-howto').classList.toggle('hidden', tabName !== 'howto');
}

function onCopyPrompt() {
  const text = document.getElementById('guide-prompt-text').textContent;
  copyToClipboard(text);
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
    `${formatTokenCount(accumulated)} / ${formatTokenCount(target)}`;

  // ETA 显示
  updateETADisplay(progress, accumulated, target);

  // 金币
  document.getElementById('coin-count').textContent = gameState.getCoins();
  document.getElementById('coin-pool-remaining').textContent = getPoolRemaining();
  updatePendingCoinDisplay();

  // 重新生成按钮
  updateRegenerateButton();

  // 储液罐
  updateTankDisplay();
}

// ETA 计算：基于最近 5 秒的注入速率估算剩余时间
function updateETADisplay(progress, accumulated, target) {
  const el = document.getElementById('eta-time');
  if (!el) return;

  // 已完成 → 待收取
  if (progress >= 1) {
    el.textContent = '✓ 待收取';
    el.className = 'eta-display eta-fast';
    return;
  }

  // 没有打印中
  if (!gameState.getCurrentPrint().modelId) {
    el.textContent = '';
    el.className = 'eta-display';
    return;
  }

  const remaining = target - accumulated;
  // 计算最近窗口内的注入速率 (tokens/sec)
  const samples = injectRateSamples;
  if (samples.length === 0) {
    el.textContent = '⏸ 等待算力';
    el.className = 'eta-display eta-stalled';
    return;
  }
  const totalAmount = samples.reduce((s, x) => s + x.amount, 0);
  const windowDuration = Math.max(1, (samples[samples.length - 1].time - samples[0].time) / 1000) || 1;
  const ratePerSec = totalAmount / windowDuration;

  if (ratePerSec <= 0) {
    el.textContent = '⏸ 等待算力';
    el.className = 'eta-display eta-stalled';
    return;
  }

  const etaSec = remaining / ratePerSec;
  el.textContent = `ETA ${formatDuration(etaSec)}`;

  // 速率分级配色：>= 5K/s 优秀, >= 1K/s 一般, < 1K/s 慢
  el.className = 'eta-display';
  if (ratePerSec >= 5000) el.classList.add('eta-fast');
  else if (ratePerSec < 1000) el.classList.add('eta-slow');
}

function formatDuration(sec) {
  if (!isFinite(sec) || sec < 0) return '--';
  if (sec < 60) return `${Math.ceil(sec)}秒`;
  if (sec < 3600) return `${Math.ceil(sec / 60)}分`;
  if (sec < 86400) {
    const h = Math.floor(sec / 3600);
    const m = Math.ceil((sec % 3600) / 60);
    return m > 0 ? `${h}时${m}分` : `${h}时`;
  }
  return `${Math.ceil(sec / 86400)}天`;
}

function formatTokenCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return n.toString();
}

function updateModelStockDisplay(modelId) {
  const el = document.getElementById('current-model-stock');
  if (!el) return;
  const remaining = getStock(modelId);
  const cap = getCap(modelId);
  if (cap === 0) {
    el.textContent = '';
    el.className = 'model-stock';
    return;
  }
  el.textContent = `库存 ${remaining}/${cap}`;
  // 稀缺度分级着色：< 10% 红色濒危，< 30% 黄色，否则青色
  const ratio = remaining / cap;
  el.className = 'model-stock';
  if (ratio <= 0.1) el.classList.add('stock-critical');
  else if (ratio <= 0.3) el.classList.add('stock-low');
  else el.classList.add('stock-normal');
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

// === Ban 系统 UI ===

function renderBanSlots() {
  const miniEl = document.getElementById('ban-slot-mini');
  const badgeEl = document.getElementById('ban-badge');
  const progressEl = document.getElementById('ban-progress');
  if (!miniEl) return;

  // 统计活跃 ban 数量
  let activeCount = 0;
  let nextUnlockHint = '';

  // 渲染 3 个迷你槽位
  let html = '';
  for (let idx = 0; idx < 3; idx++) {
    const progress = banSystem.getSlotProgress(idx);
    const isCategorySlot = idx === banSystem.CATEGORY_SLOT_INDEX;
    const banned = banSystem.getSlotBan(idx);

    if (!progress.unlocked) {
      html += `<div class="locked" data-slot="${idx}" title="收集 ${progress.threshold} 个不同模型解锁">🔒</div>`;
      if (!nextUnlockHint) {
        nextUnlockHint = `下一解锁: BAN ${idx + 1}${isCategorySlot ? ' (分类)' : ''} — 还需 ${progress.remaining} 个模型`;
      }
    } else if (banned) {
      activeCount++;
      const name = isCategorySlot
        ? banSystem.getCategoryName(banned)
        : (getModelById(banned)?.name || banned);
      html += `<div class="active" data-slot="${idx}" title="已 Ban: ${name} · 点击修改">🚫 ${name}</div>`;
    } else {
      html += `<div data-slot="${idx}" title="${isCategorySlot ? '点击选择分类' : '点击选择模型'}">＋</div>`;
    }
  }
  miniEl.innerHTML = html;

  // 更新 badge
  if (badgeEl) {
    badgeEl.textContent = `${activeCount}/3`;
    badgeEl.classList.toggle('active', activeCount > 0);
  }

  // 更新进度提示
  if (progressEl) {
    progressEl.textContent = nextUnlockHint;
  }
}

function onBanSlotClick(slotIndex) {
  const progress = banSystem.getSlotProgress(slotIndex);
  if (!progress.unlocked) {
    showToast(`还需收集 ${progress.remaining} 个不同模型解锁`, 'error');
    return;
  }
  showBanModal(slotIndex);
}

function showBanModal(slotIndex) {
  const isCategorySlot = slotIndex === banSystem.CATEGORY_SLOT_INDEX;
  const current = banSystem.getSlotBan(slotIndex);

  // 构建 body HTML
  let bodyHtml = '<div class="ban-modal-list">';
  if (isCategorySlot) {
    const cats = banSystem.getAllCategories(getManifest());
    for (const cat of cats) {
      bodyHtml += `<div class="ban-option${cat.code === current ? ' ban-option-selected' : ''}" data-ban-id="${cat.code}" data-ban-type="category">
        <div class="ban-option-name">${banSystem.getCategoryName(cat.code)}</div>
        <div class="ban-option-meta">${cat.count} 个模型</div>
      </div>`;
    }
  } else {
    const manifest = getManifest();
    const otherBans = new Set();
    for (let i = 0; i < 2; i++) {
      if (i !== slotIndex) {
        const v = banSystem.getSlotBan(i);
        if (v) otherBans.add(v);
      }
    }
    for (const m of manifest) {
      const isDisabled = otherBans.has(m.id);
      bodyHtml += `<div class="ban-option${m.id === current ? ' ban-option-selected' : ''}${isDisabled ? ' ban-option-disabled' : ''}" data-ban-id="${m.id}" data-ban-type="model" ${isDisabled ? 'data-disabled="1"' : ''}>
        <div class="ban-option-name">${m.name}</div>
        <div class="ban-option-meta">${m.rarity} · ${banSystem.getCategoryName(m.category)}${isDisabled ? ' · 已被其他槽位 Ban' : ''}</div>
      </div>`;
    }
  }
  bodyHtml += '</div>';

  showModal({
    title: isCategorySlot
      ? `Ban 槽位 ${slotIndex + 1} · 选择要 Ban 的分类`
      : `Ban 槽位 ${slotIndex + 1} · 选择要 Ban 的模型`,
    desc: isCategorySlot
      ? '被 Ban 的整个分类下的所有模型都不会再被随机生成。可随时重新选择或清空。'
      : '被 Ban 的模型不会再被随机生成。可随时重新选择或清空。',
    bodyHtml,
    wide: true,
    buttons: [
      { id: 'clear', text: '清空 Ban', style: 'outline' },
      { id: 'cancel', text: '取消 (Esc)', style: 'outline', escape: true },
    ],
  }).then((result) => {
    if (result === 'cancel') return;
    if (result === 'clear') {
      banSystem.setSlotBan(slotIndex, null);
      renderBanSlots();
      showToast('已清空 Ban', 'success');
      return;
    }
    // 选项点击 — 通过 getActiveModal 追踪
  });

  // 选项点击事件 — 在 showModal 创建的 DOM 上挂载
  const activeModal = getActiveModalEl();
  if (activeModal) {
    activeModal.querySelectorAll('.ban-option:not([data-disabled])').forEach(opt => {
      opt.addEventListener('click', () => {
        const id = opt.dataset.banId;
        banSystem.setSlotBan(slotIndex, id);
        const name = isCategorySlot
          ? banSystem.getCategoryName(id)
          : (getModelById(id)?.name || id);
        cancelModal();
        renderBanSlots();
        showToast(`已 Ban ${isCategorySlot ? '分类' : '模型'}：${name}`, 'success');
      });
    });
  }
}

// 辅助：获取当前活动模态框元素
function getActiveModalEl() {
  // modal.js 挂载到 body 最后一个 .modal 子元素
  return document.body.querySelector('.modal:last-of-type');
}

// === 市场（NPC 黑市求购台）===

let marketRefreshTimer = null;

function showMarket() {
  const view = document.getElementById('market-view');
  view.classList.remove('hidden');
  renderMarket();
  // 每 5 秒刷新一下倒计时
  if (marketRefreshTimer) clearInterval(marketRefreshTimer);
  marketRefreshTimer = setInterval(() => {
    if (!view.classList.contains('hidden')) {
      updateMarketRefreshInfo();
    } else {
      clearInterval(marketRefreshTimer);
      marketRefreshTimer = null;
    }
  }, 5000);
}

function hideMarket() {
  document.getElementById('market-view').classList.add('hidden');
  if (marketRefreshTimer) {
    clearInterval(marketRefreshTimer);
    marketRefreshTimer = null;
  }
}

function showMarketHistory() {
  renderMarketHistory();
  document.getElementById('market-history-view').classList.remove('hidden');
}

function hideMarketHistory() {
  document.getElementById('market-history-view').classList.add('hidden');
}

function updateMarketRefreshInfo() {
  const ms = market.getNextRefreshIn();
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  const el = document.getElementById('market-refresh-info');
  if (el) {
    el.textContent = `下次刷新 ${min}:${String(sec).padStart(2, '0')}`;
  }
}

function renderMarket() {
  const board = document.getElementById('market-board');
  const groups = market.getNpcDemands();
  updateMarketRefreshInfo();

  board.innerHTML = '';
  if (groups.every(g => g.demands.length === 0)) {
    board.innerHTML = '<div class="market-empty">当前没有求购单</div>';
    return;
  }

  for (const group of groups) {
    if (group.demands.length === 0) continue;
    const card = document.createElement('div');
    card.className = 'npc-card';
    const { npc, demands } = group;

    card.innerHTML = `
      <div class="npc-card-header">
        <div class="npc-avatar">${npc.avatar}</div>
        <div class="npc-meta">
          <div class="npc-name">${npc.name}</div>
          <div class="npc-title">${npc.title}</div>
          <div class="npc-description">${npc.description}</div>
        </div>
      </div>
      <div class="npc-demands"></div>
    `;
    const demandsEl = card.querySelector('.npc-demands');

    for (const d of demands) {
      const model = getModelById(d.modelId);
      if (!model) continue;
      const matching = market.getMatchingFromCabinet(d.modelId);
      const canSell = matching.length > 0;

      const row = document.createElement('div');
      row.className = 'demand-row' + (canSell ? ' sellable' : '');
      row.innerHTML = `
        <div class="demand-info">
          <div class="demand-model-name">${model.name}</div>
          <div class="demand-meta">${model.rarity} · ${banSystem.getCategoryName(model.category)} · 你有 ${matching.length} 只</div>
        </div>
        <div class="demand-price">${d.price}</div>
        <button class="btn-sell" ${canSell ? '' : 'disabled'}>${canSell ? '卖出' : '没有'}</button>
      `;
      const btn = row.querySelector('.btn-sell');
      if (canSell) {
        btn.addEventListener('click', () => onSellClick(d, model, matching));
      }
      demandsEl.appendChild(row);
    }

    board.appendChild(card);
  }
}

function onSellClick(demand, model, matching) {
  // 只有一只：直接确认
  if (matching.length === 1) {
    doSell(demand, matching[0]);
    return;
  }
  // 多只：弹模态框让玩家选
  showSellPickModal(demand, model, matching);
}

function showSellPickModal(demand, model, matching) {
  // 按序号升序（#1 是最稀有的最后一只，玩家可能想留）
  const sorted = [...matching].sort((a, b) => (b.serialNumber || 0) - (a.serialNumber || 0));

  let bodyHtml = '<div class="sell-modal-list">';
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i];
    const date = new Date(r.completedAt || 0).toLocaleDateString();
    bodyHtml += `<div class="sell-option" data-sell-idx="${i}">
      <div class="sell-option-info">
        <div class="sell-option-code">${r.uniqueCode || ''}</div>
        <div class="sell-option-meta">#${r.serialNumber || '?'}/${r.seriesCap || '?'} · ${date}</div>
      </div>
      <button class="btn btn-small">选这只</button>
    </div>`;
  }
  bodyHtml += '</div>';

  showModal({
    title: `选择要卖出的 ${model.name}`,
    desc: `你有 ${matching.length} 只匹配的 <strong>${model.name}</strong>，售价 <strong style="color:var(--gold)">★${demand.price}</strong>`,
    bodyHtml,
    wide: true,
    buttons: [
      { id: 'cancel', text: '取消 (Esc)', style: 'outline', escape: true },
    ],
  });

  // 选项点击
  const activeModal = getActiveModalEl();
  if (activeModal) {
    activeModal.querySelectorAll('.sell-option').forEach(opt => {
      const btn = opt.querySelector('button');
      if (btn) {
        btn.addEventListener('click', () => {
          const idx = parseInt(opt.dataset.sellIdx, 10);
          cancelModal();
          doSell(demand, sorted[idx]);
        });
      }
    });
  }
}

function doSell(demand, cabinetEntry) {
  const result = market.sellToNpc(demand.id, cabinetEntry.uniqueCode);
  if (!result.ok) {
    showToast(result.error || '交易失败', 'error');
    return;
  }
  showToast(`已卖出 ${cabinetEntry.name} · +★${result.price}`, 'coin');
  sound.playCoin();
  // 立刻刷新金币显示
  document.getElementById('coin-count').textContent = gameState.getCoins();
  // 重新渲染市场（移除已成交的单 + 更新"你有N只"）
  renderMarket();
}

function renderMarketHistory() {
  const list = document.getElementById('market-history-list');
  const history = market.getMyHistory();
  if (history.length === 0) {
    list.innerHTML = '<div class="market-empty">还没有交易记录</div>';
    return;
  }
  list.innerHTML = '';
  for (const h of history) {
    const npc = market.getNpcById(h.npcId);
    const row = document.createElement('div');
    row.className = 'history-row';
    const date = new Date(h.timestamp || 0).toLocaleString();
    row.innerHTML = `
      <div class="history-row-left">
        <div class="history-action">
          卖给 <span class="history-npc">${npc?.name || h.npcId}</span> ·
          <span class="history-model">${h.modelName || h.modelId}</span>
          <span style="color:var(--text-dim);font-size:0.75rem">(${h.rarity || ''})</span>
        </div>
        <div class="history-meta">${date} · ${h.uniqueCode || ''}</div>
      </div>
      <div class="history-price">${h.price}</div>
    `;
    list.appendChild(row);
  }
}

// 监听市场状态变化（卖出 / 刷新）— 已打开市场视图时重新渲染
window.addEventListener('market-changed', () => {
  if (!document.getElementById('market-view').classList.contains('hidden')) {
    renderMarket();
  }
});

// 展示柜变化也要刷新市场的"你有N只"
window.addEventListener('cabinet-changed', () => {
  if (!document.getElementById('market-view').classList.contains('hidden')) {
    renderMarket();
  }
});

export function showToast(msg, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
  if (type === 'error') sound.playError();
  else if (type === 'success' || type === 'coin') sound.playSuccess();
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
        sound.playClick();
        onRegenerate();
        break;
      case 'l':
        e.preventDefault();
        sound.playClick();
        onLock();
        break;
      case 'c':
        e.preventDefault();
        sound.playClick();
        toggleCabinet();
        break;
      case 'm':
        e.preventDefault();
        sound.playClick();
        toggleMarket();
        break;
      case ' ':
        e.preventDefault();
        sound.playClick();
        // 金币现在随模型收取自动到账，Space 仅作提示
        {
          const pending = getPendingCoins();
          if (pending > 0) {
            showToast(`本模型已积攒 ${pending} 金币，完成后收取自动到账`, 'coin');
          } else {
            showToast('金币每消耗 500 万算力 +1，模型完成时自动到账', 'coin');
          }
        }
        break;
      case 'f':
        e.preventDefault();
        sound.playClick();
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
    if (keysDown.has('a')) rotateDetailModelLeft();
    if (keysDown.has('d')) rotateDetailModelRight();
    if (keysDown.has('w')) {
      const cam = getDetailCamera();
      const ctrl = getDetailControls();
      if (cam && ctrl) rotateCameraSpherical(cam, ctrl.target, -ROTATE_SPEED, 0);
    }
    if (keysDown.has('s')) {
      const cam = getDetailCamera();
      const ctrl = getDetailControls();
      if (cam && ctrl) rotateCameraSpherical(cam, ctrl.target, ROTATE_SPEED, 0);
    }
    return;
  }

  if (keysDown.has('a')) rotateModelLeft();
  if (keysDown.has('d')) rotateModelRight();
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

function toggleMarket() {
  const marketView = document.getElementById('market-view');
  if (marketView.classList.contains('hidden')) {
    showMarket();
  } else {
    hideMarket();
  }
}

function handleEscapeKey() {
  // 模态框 Escape 由 modal.js 内部处理
  // 这里只处理页面级视图
  const cabinetDetail = document.getElementById('cabinet-detail');
  const cabinetView = document.getElementById('cabinet-view');
  const marketView = document.getElementById('market-view');
  const marketHistoryView = document.getElementById('market-history-view');

  if (marketHistoryView && !marketHistoryView.classList.contains('hidden')) {
    document.getElementById('btn-history-close').click();
    return;
  }
  if (marketView && !marketView.classList.contains('hidden')) {
    document.getElementById('btn-market-close').click();
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
  // 模态框 Enter 由 modal.js 内部处理
  // 这里不需要额外逻辑
}

// === 模型点击收取 ===

function initModelClickHandler() {
  const canvas = document.getElementById('three-canvas');
  canvas.addEventListener('mousedown', (e) => {
    mouseDownPos.x = e.clientX;
    mouseDownPos.y = e.clientY;
  });
  canvas.addEventListener('mouseup', (e) => {
    const dx = e.clientX - mouseDownPos.x;
    const dy = e.clientY - mouseDownPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > 5) return; // 拖拽旋转，不算点击
    if (!waitingForClick) return;
    onModelClick(e);
  });
}

function onModelClick(e) {
  const model = getCurrentModel();
  if (!model) return;

  const canvas = document.getElementById('three-canvas');
  const rect = canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, getCamera());

  const intersects = raycaster.intersectObject(model, true);
  if (intersects.length === 0) return;

  waitingForClick = false;
  hideClickHint();
  collectAndContinue();
}

async function collectAndContinue() {
  if (pendingCompletion) {
    // 把模型积攒的金币一次性转入玩家账户（onCoinTransfer 回调会更新 UI 与 toast）
    coinTransfer();
    sound.playCollect();

    const modelId = gameState.getCurrentPrint().modelId;
    const code = await generateUniqueCode(modelId, Date.now());
    const thumbnail = captureThumbnail();

    // 扣减库存（在保存前），并记录"该模型剩余多少"用于展示柜炫耀
    const cap = getCap(modelId);
    consumeStock(modelId);
    const remainingAfter = getStock(modelId);

    gameState.addToCabinet({
      modelId,
      uniqueCode: code,
      completedAt: Date.now(),
      thumbnail,
      displayImage: currentModelEntry?.displayImage ? assetUrl(currentModelEntry.displayImage) : '',
      printDuration: gameState.getAccumulatedTokens(),
      name: currentModelEntry?.name || '未知模型',
      rarity: currentModelEntry?.rarity || 'common',
      description: currentModelEntry?.description || '',
      // 序号：从 1 开始，#1 是最后一只剩下的
      serialNumber: cap - remainingAfter,
      seriesCap: cap,
    });

    document.getElementById('unique-code').textContent = code;
    document.getElementById('completion-section').classList.remove('hidden');
    showToast(`模型已收取! 剩余 ${remainingAfter}/${cap}`, 'success');
    pendingCompletion = false;

    // 立即刷新当前型号库存显示（玩家看着数字降下来）
    updateModelStockDisplay(modelId);

    // 收取可能解锁新 ban 槽位，刷新槽位 UI
    renderBanSlots();
  }

  isCompleting = false;

  // 模型收取后自动重新生成，不消耗次数
  try {
    await doRegenerate();
  } catch (e) {
    console.error('collectAndContinue failed:', e);
    showToast('重新生成失败，请重试', 'error');
  }
}

function showClickHint() {
  document.getElementById('click-hint').classList.remove('hidden');
}

function hideClickHint() {
  document.getElementById('click-hint').classList.add('hidden');
}

// === 音效开关 ===

function toggleSound() {
  const current = sound.isEnabled();
  sound.setEnabled(!current);
  gameState.getState().settings.soundEnabled = !current;
  gameState.save();
  updateSoundButton();
  if (!current) sound.playClick(); // 开启时播放确认音
}

function updateSoundButton() {
  const btn = document.getElementById('btn-sound');
  if (!btn) return;
  if (sound.isEnabled()) {
    btn.textContent = '🔊';
    btn.title = '音效已开启，点击关闭';
    btn.classList.remove('btn-outline');
    btn.classList.add('btn-secondary');
  } else {
    btn.textContent = '🔇';
    btn.title = '音效已关闭，点击开启';
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-outline');
  }
}

function toggleBgm() {
  const current = sound.isBgmEnabled();
  sound.setBgmEnabled(!current);
  gameState.getState().settings.bgmEnabled = !current;
  gameState.save();
  updateBgmButton();
}

function updateBgmButton() {
  const btn = document.getElementById('btn-bgm');
  if (!btn) return;
  if (sound.isBgmEnabled()) {
    btn.textContent = '🎵';
    btn.title = '背景音乐已开启，点击关闭';
    btn.classList.remove('btn-outline');
    btn.classList.add('btn-secondary');
  } else {
    btn.textContent = '🎵';
    btn.title = '背景音乐已关闭，点击开启';
    btn.classList.remove('btn-secondary');
    btn.classList.add('btn-outline');
  }
}

