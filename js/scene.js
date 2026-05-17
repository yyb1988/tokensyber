import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let renderer, scene, camera, controls;
let animCallbacks = [];
const DEFAULT_CAMERA_POS = new THREE.Vector3(3, 3, 5);
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 1.2, 0);

export function init() {
  const container = document.getElementById('viewport-container');
  const canvas = document.getElementById('three-canvas');

  // 渲染器
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    preserveDrawingBuffer: true
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;

  // 场景
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0a1a);
  scene.fog = new THREE.FogExp2(0x0a0a1a, 0.08);

  // 相机
  camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.copy(DEFAULT_CAMERA_POS);

  // 控制器 - 360度旋转
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.copy(DEFAULT_CAMERA_TARGET);
  controls.minDistance = 2;
  controls.maxDistance = 15;
  controls.update();

  // 灯光 — 仅保留微弱环境光 + 一盏主方向光，旋转时明暗变化极其明显
  const ambientLight = new THREE.AmbientLight(0x111122, 0.06);
  scene.add(ambientLight);

  const mainLight = new THREE.DirectionalLight(0xffffff, 3.5);
  mainLight.position.set(5, 8, 5);
  mainLight.castShadow = true;
  mainLight.shadow.mapSize.set(1024, 1024);
  mainLight.shadow.camera.near = 0.5;
  mainLight.shadow.camera.far = 20;
  mainLight.shadow.camera.left = -5;
  mainLight.shadow.camera.right = 5;
  mainLight.shadow.camera.top = 5;
  mainLight.shadow.camera.bottom = -5;
  scene.add(mainLight);

  // 光源位置指示球（方便观察光源方向）
  const lightMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffff00 })
  );
  lightMarker.position.copy(mainLight.position);
  scene.add(lightMarker);

  // 地面网格
  const gridHelper = new THREE.GridHelper(10, 20, 0x222244, 0x111133);
  gridHelper.position.y = -0.01;
  scene.add(gridHelper);

  // 响应窗口大小
  window.addEventListener('resize', onResize);
}

function onResize() {
  const container = document.getElementById('viewport-container');
  if (!container) return;
  const w = container.clientWidth;
  const h = container.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

export function addAnimateCallback(cb) {
  animCallbacks.push(cb);
}

export function removeAnimateCallback(cb) {
  animCallbacks = animCallbacks.filter(c => c !== cb);
}

export function animate() {
  requestAnimationFrame(animate);
  for (const cb of animCallbacks) {
    try { cb(); } catch (e) { console.error(e); }
  }
  controls.update();
  renderer.render(scene, camera);
}

export function getScene() { return scene; }
export function getCamera() { return camera; }
export function getRenderer() { return renderer; }
export function getControls() { return controls; }

// 重置相机到默认位置
export function resetCamera() {
  camera.position.copy(DEFAULT_CAMERA_POS);
  controls.target.copy(DEFAULT_CAMERA_TARGET);
  controls.update();
}

// 编程式旋转和缩放（用于键盘控制）
const ROTATE_SPEED = 0.08;
const ZOOM_SPEED = 0.15;
const MIN_PHI = 0.05;
const MAX_PHI = Math.PI - 0.05;

function applySphericalRotation(deltaPhi, deltaTheta) {
  const offset = new THREE.Vector3().subVectors(camera.position, controls.target);
  const spherical = new THREE.Spherical().setFromVector3(offset);
  spherical.phi = Math.max(MIN_PHI, Math.min(MAX_PHI, spherical.phi + deltaPhi));
  spherical.theta += deltaTheta;
  offset.setFromSpherical(spherical);
  camera.position.copy(controls.target).add(offset);
}

export function rotateLeft() {
  applySphericalRotation(0, ROTATE_SPEED);
}
export function rotateRight() {
  applySphericalRotation(0, -ROTATE_SPEED);
}
export function rotateUp() {
  applySphericalRotation(-ROTATE_SPEED, 0);
}
export function rotateDown() {
  applySphericalRotation(ROTATE_SPEED, 0);
}
export function zoomIn() {
  const dist = camera.position.distanceTo(controls.target);
  if (dist > controls.minDistance) {
    const dir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
    camera.position.addScaledVector(dir, ZOOM_SPEED);
  }
}
export function zoomOut() {
  const dist = camera.position.distanceTo(controls.target);
  if (dist < controls.maxDistance) {
    const dir = new THREE.Vector3().subVectors(controls.target, camera.position).normalize();
    camera.position.addScaledVector(dir, -ZOOM_SPEED);
  }
}
