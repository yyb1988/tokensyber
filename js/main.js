import { init as sceneInit, animate, addAnimateCallback } from './scene.js';
import { init as gameStateInit } from './game-state.js';
import { init as printerInit } from './printer.js';
import { init as lockInit } from './lock-system.js';
import { loadManifest } from './model-manager.js';
import { init as uiInit, processKeyboardInput } from './ui.js';
import { updateCoinAnimations } from './coin-system.js';
import { init as fuelClientInit } from './fuel-client.js';

async function main() {
  sceneInit();
  gameStateInit();
  printerInit();
  lockInit();

  await loadManifest();

  uiInit();
  fuelClientInit();

  // 每帧更新金币动画
  addAnimateCallback(() => updateCoinAnimations());
  // 每帧处理键盘输入（WASD/QE持续旋转/缩放）
  addAnimateCallback(() => processKeyboardInput());

  animate();
}

main().catch(err => {
  console.error('Game initialization failed:', err);
  document.getElementById('loading-overlay').innerHTML =
    '<div class="loading-text" style="color:#ff4444">初始化失败，请刷新页面重试</div>';
});

// 调试模式提示
if (new URLSearchParams(window.location.search).has('debug')) {
  console.log('[DEBUG] 调试模式已开启，完成目标 = 5,000 tokens');
}
