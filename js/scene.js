import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let renderer, scene, camera, controls;
let animCallbacks = [];
let spotLights = {};
let turntableModel = null;
let turntableRotation = 0;
let isTurntableDrag = false;
let prevPointerX = 0;
const TURNTABLE_SENSITIVITY = 0.008;
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.6;

  // 场景
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x12122a);
  scene.fog = new THREE.FogExp2(0x12122a, 0.06);

  // 相机
  camera = new THREE.PerspectiveCamera(
    45,
    container.clientWidth / container.clientHeight,
    0.1,
    100
  );
  camera.position.copy(DEFAULT_CAMERA_POS);

  // 控制器 — 锁定水平旋转，仅保留垂直俯仰和缩放
  controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.copy(DEFAULT_CAMERA_TARGET);
  controls.minDistance = 2;
  controls.maxDistance = 15;
  controls.update();

  // 锁定水平轨道角
  const initAz = controls.getAzimuthalAngle();
  controls.minAzimuthAngle = initAz;
  controls.maxAzimuthAngle = initAz;

  // 转盘旋转：水平拖拽旋转模型（事件加在 canvas 上以配合 pointer capture）
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) {
      isTurntableDrag = true;
      prevPointerX = e.clientX;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!isTurntableDrag || !turntableModel) return;
    const dx = e.clientX - prevPointerX;
    turntableRotation += dx * TURNTABLE_SENSITIVITY;
    turntableModel.rotation.y = turntableRotation;
    prevPointerX = e.clientX;
  });
  canvas.addEventListener('pointerup', () => {
    isTurntableDrag = false;
  });
  canvas.addEventListener('pointercancel', () => {
    isTurntableDrag = false;
  });

  // 灯光 — 半球光环境 + 主方向光 + 六向聚光灯
  const hemiLight = new THREE.HemisphereLight(0x6699cc, 0x222244, 0.8);
  scene.add(hemiLight);

  const mainLight = new THREE.DirectionalLight(0xffeedd, 3.0);
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

  // 六向聚光灯 — 围绕模型上下前后左右照射
  const spotTarget = new THREE.Object3D();
  spotTarget.position.set(0, 1.2, 0);
  scene.add(spotTarget);

  const spotConfigs = [
    { key: 'top',    pos: [0, 6, 0],   color: 0xffeedd, intensity: 40 },
    { key: 'bottom', pos: [0, -1, 0],  color: 0x334466, intensity: 15 },
    { key: 'front',  pos: [0, 2, 5],   color: 0xffeedd, intensity: 30 },
    { key: 'back',   pos: [0, 2, -5],  color: 0x6688bb, intensity: 25 },
    { key: 'right',  pos: [5, 2, 0],   color: 0xffeedd, intensity: 30 },
    { key: 'left',   pos: [-5, 2, 0],  color: 0x6688bb, intensity: 25 },
  ];

  for (const cfg of spotConfigs) {
    const spot = new THREE.SpotLight(cfg.color, cfg.intensity, 15, Math.PI / 5, 0.5, 1);
    spot.position.set(...cfg.pos);
    spot.target = spotTarget;
    scene.add(spot);
    spotLights[cfg.key] = spot;
  }

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
  turntableRotation = 0;
  if (turntableModel) turntableModel.rotation.y = 0;
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

export function setTurntableModel(model) {
  turntableModel = model;
  turntableRotation = 0;
}

// 聚光灯模式 — 按模型 ID 控制各方向聚光灯开关
// patroller/suppressor/sapper: 全关
// headhunter: 全开
// sentinel: 上+前关，其余开
// 其他: 全开
export function setSpotlightMode(modelId) {
  const noSpot = ['patroller', 'suppressor', 'sapper'];
  const all = () => Object.values(spotLights).forEach(s => s.visible = true);
  const none = () => Object.values(spotLights).forEach(s => s.visible = false);

  if (noSpot.includes(modelId)) {
    none();
  } else if (modelId === 'headhunter') {
    all();
  } else if (modelId === 'sentinel') {
    all();
    spotLights.top.visible = false;
    spotLights.front.visible = false;
  } else {
    all();
  }
}

export function rotateModelLeft() {
  turntableRotation -= ROTATE_SPEED;
  if (turntableModel) turntableModel.rotation.y = turntableRotation;
}

export function rotateModelRight() {
  turntableRotation += ROTATE_SPEED;
  if (turntableModel) turntableModel.rotation.y = turntableRotation;
}
