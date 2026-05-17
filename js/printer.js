import * as THREE from 'three';
import { getScene, addAnimateCallback, removeAnimateCallback } from './scene.js';
import { getProgress } from './game-state.js';

let clipPlane;
let printerRing;
let printerGlow;
let particleSystem;
let basePlatform;
let currentModel = null;
let modelBoundingBox = null;
let isPrinting = false;
let fuelPulseIntensity = 0;

const PARTICLE_COUNT = 150;
const RING_SEGMENTS = 64;

export function init() {
  // 裁切面 - 裁切Y > currentHeight的部分
  clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);

  // 打印平台底座
  const platformGeo = new THREE.CylinderGeometry(1.5, 1.6, 0.1, 32);
  const platformMat = new THREE.MeshStandardMaterial({
    color: 0x1a1a3a,
    metalness: 0.8,
    roughness: 0.3,
  });
  basePlatform = new THREE.Mesh(platformGeo, platformMat);
  basePlatform.position.y = -0.05;
  basePlatform.receiveShadow = true;

  // 平台边缘发光环
  const ringGeo = new THREE.TorusGeometry(1.55, 0.02, 8, 64);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.6 });
  const platformRing = new THREE.Mesh(ringGeo, ringMat);
  platformRing.rotation.x = -Math.PI / 2;
  platformRing.position.y = 0.01;
  basePlatform.add(platformRing);

  // 打印头光环
  const printerRingGeo = new THREE.TorusGeometry(0.8, 0.02, 8, RING_SEGMENTS);
  const printerRingMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.7,
  });
  printerRing = new THREE.Mesh(printerRingGeo, printerRingMat);
  printerRing.rotation.x = -Math.PI / 2;
  printerRing.visible = false;

  // 发光线
  const glowGeo = new THREE.PlaneGeometry(2, 0.05);
  const glowMat = new THREE.MeshBasicMaterial({
    color: 0x00f0ff,
    transparent: true,
    opacity: 0.4,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  });
  printerGlow = new THREE.Mesh(glowGeo, glowMat);
  printerGlow.visible = false;

  // 粒子系统
  const particleGeo = new THREE.BufferGeometry();
  const positions = new Float32Array(PARTICLE_COUNT * 3);
  const velocities = new Float32Array(PARTICLE_COUNT * 3);
  const ages = new Float32Array(PARTICLE_COUNT);
  const maxAges = new Float32Array(PARTICLE_COUNT);

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    resetParticle(i, positions, velocities, ages, maxAges);
  }

  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  particleGeo.userData = { velocities, ages, maxAges };

  const particleMat = new THREE.PointsMaterial({
    color: 0x00f0ff,
    size: 0.04,
    transparent: true,
    opacity: 0.6,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  particleSystem = new THREE.Points(particleGeo, particleMat);
  particleSystem.visible = false;

  // 监听算力脉冲
  window.addEventListener('fuel-pulse', onFuelPulse);
}

function resetParticle(i, positions, velocities, ages, maxAges) {
  const angle = Math.random() * Math.PI * 2;
  const radius = 0.3 + Math.random() * 0.5;
  positions[i * 3] = Math.cos(angle) * radius;
  positions[i * 3 + 1] = 0;
  positions[i * 3 + 2] = Math.sin(angle) * radius;
  velocities[i * 3] = (Math.random() - 0.5) * 0.02;
  velocities[i * 3 + 1] = 0.01 + Math.random() * 0.03;
  velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
  ages[i] = 0;
  maxAges[i] = 0.5 + Math.random() * 1.5;
}

function onFuelPulse() {
  fuelPulseIntensity = 1.0;
}

export function startPrint(model) {
  const scene = getScene();

  // 清除之前的模型
  if (currentModel) {
    scene.remove(currentModel);
  }

  currentModel = model;
  scene.add(model);
  if (!basePlatform.parent) scene.add(basePlatform);

  // 计算模型边界
  modelBoundingBox = new THREE.Box3().setFromObject(model);

  // 给所有网格应用裁切面
  applyClipping(model, clipPlane);

  // 添加打印头和粒子
  if (!printerRing.parent) scene.add(printerRing);
  if (!printerGlow.parent) scene.add(printerGlow);
  if (!particleSystem.parent) scene.add(particleSystem);

  printerRing.visible = true;
  printerGlow.visible = true;
  particleSystem.visible = true;
  isPrinting = true;

  addAnimateCallback(updatePrintEffect);
}

// 直接展示完整模型（用于恢复已完成的打印）
export function startPrintDirect(model) {
  const scene = getScene();

  if (currentModel) {
    scene.remove(currentModel);
  }

  currentModel = model;
  scene.add(model);
  if (!basePlatform.parent) scene.add(basePlatform);

  isPrinting = false;
  printerRing.visible = false;
  printerGlow.visible = false;
  particleSystem.visible = false;

  removeAnimateCallback(updatePrintEffect);
}

function applyClipping(object, plane) {
  object.traverse((child) => {
    if (child.isMesh) {
      // 克隆材质避免影响缓存中的原始对象
      if (Array.isArray(child.material)) {
        child.material = child.material.map(mat => {
          const cloned = mat.clone();
          cloned.clippingPlanes = [plane];
          cloned.side = THREE.DoubleSide;
          cloned.clipShadows = true;
          return cloned;
        });
      } else {
        child.material = child.material.clone();
        child.material.clippingPlanes = [plane];
        child.material.side = THREE.DoubleSide;
        child.material.clipShadows = true;
      }
    }
  });
}

function removeClipping(object) {
  object.traverse((child) => {
    if (child.isMesh) {
      if (Array.isArray(child.material)) {
        child.material.forEach(mat => {
          mat.clippingPlanes = [];
          mat.side = THREE.FrontSide;
        });
      } else {
        child.material.clippingPlanes = [];
        child.material.side = THREE.FrontSide;
      }
    }
  });
}

function updatePrintEffect() {
  if (!isPrinting || !modelBoundingBox) return;

  const progress = getProgress();

  if (progress >= 1) {
    completePrint();
    return;
  }

  const minY = modelBoundingBox.min.y;
  const maxY = modelBoundingBox.max.y;
  const currentHeight = minY + progress * (maxY - minY);

  // 更新裁切面
  clipPlane.constant = currentHeight;

  // 更新打印头位置
  printerRing.position.y = currentHeight;
  printerGlow.position.y = currentHeight + 0.01;

  // 打印头脉冲（算力注入时增强）
  const time = Date.now() * 0.001;
  const baseRing = fuelPulseIntensity > 0 ? 0.8 : 0.5;
  const speedBoost = fuelPulseIntensity > 0 ? 5 : 3;
  printerRing.material.opacity = baseRing + Math.sin(time * speedBoost) * 0.2;
  printerGlow.material.opacity = (fuelPulseIntensity > 0 ? 0.5 : 0.3) + Math.sin(time * (speedBoost + 1)) * 0.15;

  // 算力脉冲衰减
  if (fuelPulseIntensity > 0) {
    fuelPulseIntensity = Math.max(0, fuelPulseIntensity - 0.016);
    // 脉冲时粒子颜色偏绿
    particleSystem.material.color.lerp(new THREE.Color(0x00ff88), 0.1);
  } else {
    particleSystem.material.color.lerp(new THREE.Color(0x00f0ff), 0.05);
  }

  // 打印头随时间旋转
  printerRing.rotation.z = time * 0.5;

  // 更新粒子
  updateParticles(currentHeight);
}

function updateParticles(currentHeight) {
  const positions = particleSystem.geometry.attributes.position.array;
  const { velocities, ages, maxAges } = particleSystem.geometry.userData;
  const dt = 0.016;

  for (let i = 0; i < PARTICLE_COUNT; i++) {
    ages[i] += dt;
    if (ages[i] > maxAges[i]) {
      resetParticle(i, positions, velocities, ages, maxAges);
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.2 + Math.random() * 0.5;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = currentHeight;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
    }
    positions[i * 3] += velocities[i * 3];
    positions[i * 3 + 1] += velocities[i * 3 + 1];
    positions[i * 3 + 2] += velocities[i * 3 + 2];
  }
  particleSystem.geometry.attributes.position.needsUpdate = true;
}

function completePrint() {
  isPrinting = false;
  removeClipping(currentModel);
  printerRing.visible = false;
  printerGlow.visible = false;
  particleSystem.visible = false;
  removeAnimateCallback(updatePrintEffect);

  // 完成闪光
  const flash = document.createElement('div');
  flash.className = 'flash-overlay';
  document.body.appendChild(flash);
  setTimeout(() => flash.remove(), 600);

  // 触发完成事件
  window.dispatchEvent(new CustomEvent('print-complete'));
}

export function stopPrint() {
  isPrinting = false;
  const scene = getScene();

  if (currentModel) {
    removeClipping(currentModel);
    scene.remove(currentModel);
    currentModel = null;
  }
  scene.remove(basePlatform);

  // 清理场景中的打印组件（它们可能已添加也可能未添加）
  if (printerRing.parent) scene.remove(printerRing);
  if (printerGlow.parent) scene.remove(printerGlow);
  if (particleSystem.parent) scene.remove(particleSystem);

  printerRing.visible = false;
  printerGlow.visible = false;
  particleSystem.visible = false;

  removeAnimateCallback(updatePrintEffect);
}

export function getCurrentModel() {
  return currentModel;
}

export function getModelBoundingBox() {
  return modelBoundingBox;
}
