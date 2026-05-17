import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

let manifest = [];
const modelCache = new Map();
const loader = new GLTFLoader();

export async function loadManifest() {
  try {
    const resp = await fetch('models/manifest.json');
    manifest = await resp.json();
  } catch (e) {
    console.warn('Failed to load manifest, using defaults:', e);
    manifest = getDefaultManifest();
  }
  return manifest;
}

function getDefaultManifest() {
  return [
    { id: 'default_cube', name: '赛博方块人', rarity: 'common', description: '初始型号的数字居民' },
    { id: 'robot_01', name: '工业机器人', rarity: 'common', description: '基础型号的工业机器人' },
    { id: 'crystal_01', name: '水晶生命体', rarity: 'rare', description: '来自数字深渊的结晶体' }
  ];
}

export function getManifest() {
  return manifest;
}

export function getRandomModel() {
  if (manifest.length === 0) return null;
  // 按稀有度加权
  const weights = { common: 60, rare: 25, epic: 12, legendary: 3 };
  const totalWeight = manifest.reduce((sum, m) => sum + (weights[m.rarity] || 10), 0);
  let rand = Math.random() * totalWeight;
  for (const model of manifest) {
    rand -= (weights[model.rarity] || 10);
    if (rand <= 0) return model;
  }
  return manifest[0];
}

export function getModelById(id) {
  return manifest.find(m => m.id === id) || null;
}

export async function loadModel(modelEntry) {
  if (modelCache.has(modelEntry.id)) {
    const cached = modelCache.get(modelEntry.id);
    return cached.clone();
  }

  // 程序化模型
  if (modelEntry.id === 'default_cube') {
    return createDefaultCubeModel();
  }
  if (modelEntry.id === 'robot_01') {
    return createProceduralModel('robot');
  }
  if (modelEntry.id === 'crystal_01') {
    return createProceduralModel('crystal');
  }

  // 尝试加载GLB文件
  if (!modelEntry.file) {
    return createDefaultCubeModel();
  }

  return new Promise((resolve, reject) => {
    loader.load(
      modelEntry.file,
      (gltf) => {
        const model = gltf.scene;
        modelCache.set(modelEntry.id, model);
        resolve(model.clone());
      },
      undefined,
      (err) => {
        console.warn(`Failed to load model ${modelEntry.id}, using fallback:`, err);
        resolve(createDefaultCubeModel());
      }
    );
  });
}

function createDefaultCubeModel() {
  const group = new THREE.Group();

  // 简单的方块人
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x4488ff,
    metalness: 0.3,
    roughness: 0.7,
  });
  const headMat = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    metalness: 0.5,
    roughness: 0.5,
  });
  const limbMat = new THREE.MeshStandardMaterial({
    color: 0x3366cc,
    metalness: 0.2,
    roughness: 0.8,
  });

  // 头
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), headMat);
  head.position.y = 2.25;
  head.castShadow = true;
  group.add(head);

  // 身体
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.9, 0.4), bodyMat);
  body.position.y = 1.55;
  body.castShadow = true;
  group.add(body);

  // 左臂
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.8, 0.25), limbMat);
  leftArm.position.set(-0.475, 1.6, 0);
  leftArm.castShadow = true;
  group.add(leftArm);

  // 右臂
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.8, 0.25), limbMat);
  rightArm.position.set(0.475, 1.6, 0);
  rightArm.castShadow = true;
  group.add(rightArm);

  // 左腿
  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), limbMat);
  leftLeg.position.set(-0.2, 0.65, 0);
  leftLeg.castShadow = true;
  group.add(leftLeg);

  // 右腿
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.9, 0.3), limbMat);
  rightLeg.position.set(0.2, 0.65, 0);
  rightLeg.castShadow = true;
  group.add(rightLeg);

  // 眼睛（发光）
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0x00ff88 });
  const leftEye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eyeMat);
  leftEye.position.set(-0.12, 2.3, 0.26);
  group.add(leftEye);
  const rightEye = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.05), eyeMat);
  rightEye.position.set(0.12, 2.3, 0.26);
  group.add(rightEye);

  group.userData.modelId = 'default_cube';
  return group;
}

// 创建更多程序化模型
export function createProceduralModel(type) {
  const group = new THREE.Group();
  const colors = [0xff4444, 0x44ff44, 0xff8800, 0xaa44ff, 0x00ff88, 0xff00ff];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const mainMat = new THREE.MeshStandardMaterial({
    color,
    metalness: 0.4,
    roughness: 0.6,
  });
  const accentMat = new THREE.MeshStandardMaterial({
    color: 0x00f0ff,
    metalness: 0.6,
    roughness: 0.4,
  });

  switch (type) {
    case 'robot': {
      // 圆柱形机器人
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 1.0, 8), mainMat);
      torso.position.y = 1.4;
      torso.castShadow = true;
      group.add(torso);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 8, 8), accentMat);
      head.position.y = 2.2;
      head.castShadow = true;
      group.add(head);
      const eye = new THREE.Mesh(
        new THREE.BoxGeometry(0.3, 0.08, 0.05),
        new THREE.MeshBasicMaterial({ color: 0xff0000 })
      );
      eye.position.set(0, 2.25, 0.28);
      group.add(eye);
      const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.8, 6), mainMat);
      leg1.position.set(-0.15, 0.5, 0);
      leg1.castShadow = true;
      group.add(leg1);
      const leg2 = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.8, 6), mainMat);
      leg2.position.set(0.15, 0.5, 0);
      leg2.castShadow = true;
      group.add(leg2);
      break;
    }
    case 'crystal': {
      // 水晶生物
      const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), mainMat);
      body.position.y = 1.5;
      body.scale.set(1, 1.5, 1);
      body.castShadow = true;
      group.add(body);
      const head = new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), accentMat);
      head.position.y = 2.4;
      head.castShadow = true;
      group.add(head);
      for (let i = 0; i < 4; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.4, 4), mainMat);
        const angle = (i / 4) * Math.PI * 2;
        spike.position.set(Math.cos(angle) * 0.4, 1.2, Math.sin(angle) * 0.4);
        spike.rotation.z = Math.cos(angle) * 0.5;
        spike.rotation.x = Math.sin(angle) * 0.5;
        group.add(spike);
      }
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.15, 0.9, 5), accentMat);
      leg.position.y = 0.55;
      leg.castShadow = true;
      group.add(leg);
      break;
    }
    default: {
      return createDefaultCubeModel();
    }
  }

  return group;
}

export function normalizeModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  if (maxDim > 0) {
    const scale = 2.5 / maxDim;
    model.scale.multiplyScalar(scale);
  }
  // 重新计算边界并居中
  const newBox = new THREE.Box3().setFromObject(model);
  const center = newBox.getCenter(new THREE.Vector3());
  model.position.sub(center);
  model.position.y += (newBox.max.y - newBox.min.y) / 2;
  return model;
}
