import * as THREE from 'three';
import { getScene, getCamera, getRenderer } from './scene.js';

let coins = [];
let pendingCount = 0;
let scene, camera;
let spawnTimer = null;
const MAX_VISIBLE = 3;
const SPAWN_INTERVAL_MIN = 60000;  // 1分钟
const SPAWN_INTERVAL_MAX = 60000;  // 1分钟
const coinGeometry = new THREE.CylinderGeometry(0.15, 0.15, 0.05, 32);
const coinMaterial = new THREE.MeshStandardMaterial({
  color: 0xffd700,
  metalness: 0.9,
  roughness: 0.1,
  emissive: 0x332200,
});
let onCollectCallback = null;

export function init(onCollect) {
  scene = getScene();
  camera = getCamera();
  onCollectCallback = onCollect;

  const canvas = getRenderer().domElement;
  canvas.addEventListener('pointerdown', onPointerDown);

  scheduleNextSpawn();
}

function scheduleNextSpawn() {
  const delay = SPAWN_INTERVAL_MIN + Math.random() * (SPAWN_INTERVAL_MAX - SPAWN_INTERVAL_MIN);
  spawnTimer = setTimeout(() => {
    spawnCoin();
    scheduleNextSpawn();
  }, delay);
}

function spawnCoin() {
  pendingCount++;
  if (coins.length < MAX_VISIBLE) {
    showCoin();
  }
}

function showCoin() {
  if (pendingCount <= 0) return;
  pendingCount--;

  const mesh = new THREE.Mesh(coinGeometry, coinMaterial.clone());
  mesh.castShadow = true;

  const angle = Math.random() * Math.PI * 2;
  const radius = 0.3 + Math.random() * 1.0;
  mesh.position.set(
    Math.cos(angle) * radius,
    2.5 + Math.random() * 1.5,
    Math.sin(angle) * radius
  );

  const light = new THREE.PointLight(0xffd700, 0.5, 3);
  mesh.add(light);

  scene.add(mesh);

  const coin = {
    mesh,
    baseY: mesh.position.y,
    spawnTime: Date.now(),
    collecting: false,
  };
  coins.push(coin);
}

function showPendingCoins() {
  while (coins.length < MAX_VISIBLE && pendingCount > 0) {
    showCoin();
  }
}

// 将金币动画集成到主渲染循环
let animBound = false;
export function updateCoinAnimations() {
  const time = Date.now() * 0.001;
  for (const coin of coins) {
    if (coin.collecting) continue;
    coin.mesh.rotation.y = time * 2;
    coin.mesh.position.y = coin.baseY + Math.sin(time * 1.5 + coin.spawnTime) * 0.1;
  }
}

export function bindToRenderLoop() {
  if (animBound) return;
  animBound = true;
  // 由 main.js 统一注册
}

function onPointerDown(event) {
  const rect = event.target.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, camera);

  for (let i = coins.length - 1; i >= 0; i--) {
    const coin = coins[i];
    if (coin.collecting) continue;
    const intersects = raycaster.intersectObject(coin.mesh);
    if (intersects.length > 0) {
      collectAllCoins(event);
      break;
    }
  }
}

function collectAllCoins(event) {
  const toCollect = coins.filter(c => !c.collecting);
  const visibleCount = toCollect.length;
  const total = visibleCount + pendingCount;
  if (total === 0) return;
  pendingCount = 0;

  for (const coin of toCollect) {
    coin.collecting = true;
    const startTime = Date.now();
    const duration = 400;
    const startScale = coin.mesh.scale.x;
    const startPos = coin.mesh.position.clone();

    function animateCollect() {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);

      coin.mesh.scale.setScalar(startScale * (1 - ease));
      coin.mesh.rotation.y += 0.3;
      coin.mesh.position.y = startPos.y + ease * 0.5;

      if (t < 1) {
        requestAnimationFrame(animateCollect);
      } else {
        scene.remove(coin.mesh);
        coins = coins.filter(c => c !== coin);
        showPendingCoins();
      }
    }
    animateCollect();
  }

  // 如果没有可见金币但有积攒的，直接补发
  if (visibleCount === 0) showPendingCoins();

  // 浮动文字显示总收集数
  const floater = document.createElement('div');
  floater.className = 'coin-float-text';
  floater.textContent = `+${total}`;
  floater.style.left = event.clientX + 'px';
  floater.style.top = event.clientY + 'px';
  document.body.appendChild(floater);
  setTimeout(() => floater.remove(), 1000);

  if (onCollectCallback) onCollectCallback(total);
}

export function stop() {
  if (spawnTimer) clearTimeout(spawnTimer);
  spawnTimer = null;
  for (const coin of coins) {
    scene.remove(coin.mesh);
  }
  coins = [];
  pendingCount = 0;
}

export function restart(onCollect) {
  stop();
  onCollectCallback = onCollect;
  scheduleNextSpawn();
}

// 自动收集所有场上金币（键盘/打印完成时调用）
export function collectAll() {
  const toCollect = coins.filter(c => !c.collecting);
  const visibleCount = toCollect.length;
  const total = visibleCount + pendingCount;
  if (total === 0) return;
  pendingCount = 0;

  for (const coin of toCollect) {
    coin.collecting = true;
    const startTime = Date.now();
    const duration = 300;
    const startPos = coin.mesh.position.clone();
    const startScale = coin.mesh.scale.x;

    function animateQuickCollect() {
      const elapsed = Date.now() - startTime;
      const t = Math.min(elapsed / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      coin.mesh.scale.setScalar(startScale * (1 - ease));
      coin.mesh.rotation.y += 0.5;
      coin.mesh.position.y = startPos.y + ease * 1.0;

      if (t < 1) {
        requestAnimationFrame(animateQuickCollect);
      } else {
        scene.remove(coin.mesh);
        coins = coins.filter(c => c !== coin);
        showPendingCoins();
      }
    }
    animateQuickCollect();
  }

  if (visibleCount === 0) showPendingCoins();

  if (onCollectCallback) onCollectCallback(total);
}
