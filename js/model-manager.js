import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getStock } from './stock.js';
import { isModelBanned } from './ban-system.js';

// CDN 切换：本地开发走相对路径，公网走 R2 CDN
const CDN_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ? ''
  : '';  // TODO: 上线后改为 R2 公网 URL，如 'https://cdn.tokensyber.com'

let manifest = [];
const modelCache = new Map();
const loader = new GLTFLoader();

// 为资源路径加 CDN 前缀（导出供 ui.js 等模块使用）
export function assetUrl(path) {
  if (!path) return path;
  if (CDN_BASE && !path.startsWith('http')) return `${CDN_BASE}/${path}`;
  return path;
}

export async function loadManifest() {
  try {
    const resp = await fetch(assetUrl('models/manifest.json'));
    manifest = await resp.json();
  } catch (e) {
    console.warn('Failed to load manifest:', e);
    manifest = [];
  }
  return manifest;
}

export function getManifest() {
  return manifest;
}

export function getRandomModel() {
  if (manifest.length === 0) return null;
  const weights = { common: 60, rare: 25, epic: 12, legendary: 3 };
  // 仅在有库存且未被 ban 的模型中按权重抽取
  const pool = manifest.filter(m => getStock(m.id) > 0 && !isModelBanned(m));
  if (pool.length === 0) {
    console.warn('[ModelStock] No pickable models (sold out or all banned)');
    return null;
  }
  const totalWeight = pool.reduce((sum, m) => sum + (weights[m.rarity] || 10), 0);
  let rand = Math.random() * totalWeight;
  for (const model of pool) {
    rand -= (weights[model.rarity] || 10);
    if (rand <= 0) return model;
  }
  return pool[0];
}

// 仍有可抽取（=有库存 && 未被 ban）的模型
export function hasPickableModel() {
  return manifest.some(m => getStock(m.id) > 0 && !isModelBanned(m));
}

export function getModelById(id) {
  return manifest.find(m => m.id === id) || null;
}

export function getModelDisplayImage(modelEntry) {
  if (!modelEntry) return '';
  if (modelEntry.displayImage) return assetUrl(modelEntry.displayImage);
  if (!modelEntry.file) return '';
  const slashIndex = modelEntry.file.lastIndexOf('/');
  if (slashIndex === -1) return '';
  return assetUrl(`${modelEntry.file.slice(0, slashIndex)}/display image-${modelEntry.id}.jpg`);
}

export async function loadModel(modelEntry) {
  if (modelCache.has(modelEntry.id)) {
    const cached = modelCache.get(modelEntry.id);
    return cached.clone();
  }

  if (!modelEntry.file) {
    console.warn(`Model ${modelEntry.id} has no file path`);
    return createFallbackModel();
  }

  updateLoadingText(`加载模型: ${modelEntry.name}...`);

  return new Promise((resolve) => {
    loader.load(
      assetUrl(modelEntry.file),
      (gltf) => {
        const model = gltf.scene;
        model.userData.modelId = modelEntry.id;
        modelCache.set(modelEntry.id, model);
        const cloned = model.clone();
        cloned.userData.modelId = modelEntry.id;
        resolve(cloned);
      },
      (progress) => {
        if (progress.total > 0) {
          const pct = Math.round((progress.loaded / progress.total) * 100);
          updateLoadingText(`加载模型: ${modelEntry.name} ${pct}%`);
        } else {
          const mb = (progress.loaded / 1024 / 1024).toFixed(1);
          updateLoadingText(`加载模型: ${modelEntry.name} ${mb}MB...`);
        }
      },
      (err) => {
        console.error(`Failed to load model ${modelEntry.id}:`, err);
        resolve(createFallbackModel(modelEntry.id));
      }
    );
  });
}

function updateLoadingText(text) {
  const el = document.querySelector('#loading-overlay .loading-text');
  if (el) el.textContent = text;
}

function createFallbackModel(modelId) {
  const group = new THREE.Group();
  group.userData.modelId = modelId || 'fallback';
  const mat = new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.3, roughness: 0.7 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat);
  mesh.position.y = 1.5;
  group.add(mesh);
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
  const newBox = new THREE.Box3().setFromObject(model);
  const center = newBox.getCenter(new THREE.Vector3());
  model.position.sub(center);
  model.position.y += (newBox.max.y - newBox.min.y) / 2;
  return model;
}
