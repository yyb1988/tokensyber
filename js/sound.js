// TokenSyber 音效系统 — Web Audio API 合成赛博朋克风格音效
// 零外部音频文件，所有声音实时合成
// - UI 音效：click, success, error, coin, lock, unlock, collect
// - 游戏音效：reveal (按稀有度), regenerate, print-complete
// - 背景音乐：已移除程序化合成，按钮/接口保留，待接入音频文件
//   和弦进行：Cmaj9 → Fmaj9 → Am11 → Em9 → Dm9 → Gmaj7 → Em9 → Fmaj9
//   去掉低频 bass，仅中频开阔和弦 + 高频钟铃泛音闪烁
//   慢呼吸节奏 (24s/和弦) + 稀疏泛音 (5s 间隔)

let audioCtx = null;
let masterGain = null;
let enabled = true;
let bgmEnabled = false;
let userActivated = false; // 用户是否已交互（浏览器自动播放策略）

// 背景音乐节点
let bgmNodes = null;
let bgmGain = null;

function ensureCtx() {
  if (!userActivated) return null; // 用户未交互前不创建 AudioContext
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = 0.5;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}

export function isEnabled() { return enabled; }

export function setEnabled(v) {
  enabled = v;
  if (!v) stopBgm();
}

export function isBgmEnabled() { return bgmEnabled; }

export function setBgmEnabled(v) {
  bgmEnabled = v;
  if (v && userActivated) startBgm();
  else stopBgm();
}

export function init() {
  // 首次用户交互时激活音频系统（浏览器自动播放策略）
  const activate = () => {
    userActivated = true;
    if (bgmEnabled) startBgm();
    document.removeEventListener('click', activate);
    document.removeEventListener('keydown', activate);
  };
  document.addEventListener('click', activate);
  document.addEventListener('keydown', activate);
}

// ========== 工具函数 ==========

// TEMPORARY DIAGNOSTIC: remove after sound source identified
function _logSound(type, freq) {
  const stack = new Error().stack;
  const caller = stack?.split('\n')[3]?.trim() || 'unknown';
  console.warn(`[AUDIO] ${type} ${freq}Hz | ${caller}`);
}

function osc(ctx, type, freq, start, end, gainVal = 0.3) {
  _logSound(type, freq);
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  g.gain.setValueAtTime(gainVal, start);
  g.gain.linearRampToValueAtTime(0, end);
  o.connect(g);
  g.connect(masterGain);
  o.start(start);
  o.stop(end + 0.01);
  return o;
}

function noise(ctx, start, end, gainVal = 0.15) {
  _logSound('noise', 0);
  const bufferSize = ctx.sampleRate * (end - start + 0.1);
  const buffer = ctx.createBuffer(1, Math.max(bufferSize, 1), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gainVal, start);
  g.gain.linearRampToValueAtTime(0, end);
  src.connect(g);
  g.connect(masterGain);
  src.start(start);
  src.stop(end + 0.01);
  return src;
}

function filteredNoise(ctx, start, end, freq, Q, gainVal = 0.15) {
  _logSound('filteredNoise', freq);
  const bufferSize = ctx.sampleRate * (end - start + 0.1);
  const buffer = ctx.createBuffer(1, Math.max(bufferSize, 1), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = freq;
  filter.Q.value = Q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gainVal, start);
  g.gain.linearRampToValueAtTime(0, end);
  src.connect(filter);
  filter.connect(g);
  g.connect(masterGain);
  src.start(start);
  src.stop(end + 0.01);
}

// ========== 背景音乐（已移除程序化合成，保留接口供后续接入音频文件）==========

export function startBgm() {
  // 待接入音频文件后实现
  if (!bgmEnabled || !enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  if (bgmNodes) return;
  bgmGain = ctx.createGain();
  bgmGain.gain.value = 0;
  bgmGain.connect(masterGain);
  bgmNodes = {};
}

function playBgmChord() { /* 已移除程序化合成 */ }
function playBgmShimmer() { /* 已移除程序化合成 */ }

export function stopBgm() {
  if (!bgmNodes) return;
  if (bgmGain) {
    const ctx = ensureCtx();
    if (ctx) bgmGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.5);
  }
  bgmNodes = null;
  bgmGain = null;
}

// ========== UI 音效 ==========

export function playClick() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  osc(ctx, 'sine', 1200, t, t + 0.06, 0.15);
}

export function playSuccess() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  osc(ctx, 'sine', 880, t, t + 0.15, 0.2);
  osc(ctx, 'sine', 1100, t + 0.1, t + 0.3, 0.2);
}

export function playError() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  osc(ctx, 'sawtooth', 200, t, t + 0.2, 0.15);
  osc(ctx, 'square', 150, t + 0.05, t + 0.25, 0.08);
}

export function playCoin() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  osc(ctx, 'sine', 2400, t, t + 0.08, 0.2);
  osc(ctx, 'sine', 3600, t + 0.01, t + 0.06, 0.1);
  osc(ctx, 'sine', 4800, t + 0.02, t + 0.05, 0.06);
  osc(ctx, 'sine', 2400, t + 0.06, t + 0.35, 0.12);
}

export function playLock() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  filteredNoise(ctx, t, t + 0.15, 3000, 5, 0.25);
  osc(ctx, 'sine', 180, t, t + 0.1, 0.2);
}

export function playUnlock() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  filteredNoise(ctx, t, t + 0.08, 5000, 8, 0.2);
  osc(ctx, 'sine', 600, t + 0.04, t + 0.2, 0.15);
  osc(ctx, 'sine', 900, t + 0.1, t + 0.3, 0.1);
}

// ========== 游戏音效 ==========

export function playCollect() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => {
    osc(ctx, 'sine', f, t + i * 0.08, t + i * 0.08 + 0.4, 0.18);
    osc(ctx, 'triangle', f * 2, t + i * 0.08, t + i * 0.08 + 0.2, 0.06);
  });
  osc(ctx, 'sine', 3136, t + 0.32, t + 0.7, 0.08);
}

export function playRevealCommon() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  osc(ctx, 'triangle', 440, t, t + 0.3, 0.15);
  osc(ctx, 'sine', 660, t + 0.05, t + 0.25, 0.08);
  filteredNoise(ctx, t, t + 0.1, 2000, 3, 0.1);
}

export function playRevealRare() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  osc(ctx, 'sine', 523, t, t + 0.4, 0.18);
  osc(ctx, 'sine', 784, t, t + 0.4, 0.12);
  osc(ctx, 'triangle', 1047, t + 0.05, t + 0.5, 0.1);
  filteredNoise(ctx, t, t + 0.08, 4000, 4, 0.12);
}

export function playRevealEpic() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  const chord = [440, 554, 659, 880];
  chord.forEach((f, i) => {
    osc(ctx, 'sine', f, t + i * 0.04, t + 0.6, 0.14);
  });
  const sweep = ctx.createOscillator();
  const sweepG = ctx.createGain();
  sweep.type = 'sawtooth';
  sweep.frequency.setValueAtTime(200, t);
  sweep.frequency.exponentialRampToValueAtTime(2000, t + 0.4);
  sweepG.gain.setValueAtTime(0.08, t);
  sweepG.gain.linearRampToValueAtTime(0, t + 0.5);
  sweep.connect(sweepG);
  sweepG.connect(masterGain);
  sweep.start(t);
  sweep.stop(t + 0.55);
}

export function playRevealLegendary() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  osc(ctx, 'sine', 55, t, t + 0.4, 0.3);
  osc(ctx, 'sine', 110, t, t + 0.3, 0.15);
  noise(ctx, t, t + 0.15, 0.12);
  const chord = [330, 440, 554, 659, 880];
  chord.forEach((f, i) => {
    osc(ctx, 'sine', f, t + 0.15 + i * 0.06, t + 0.9, 0.13);
  });
  osc(ctx, 'sine', 2093, t + 0.4, t + 1.0, 0.06);
  osc(ctx, 'sine', 2637, t + 0.5, t + 1.1, 0.04);
  const sweep = ctx.createOscillator();
  const sweepG = ctx.createGain();
  sweep.type = 'sawtooth';
  sweep.frequency.setValueAtTime(100, t);
  sweep.frequency.exponentialRampToValueAtTime(4000, t + 0.5);
  sweepG.gain.setValueAtTime(0.06, t);
  sweepG.gain.linearRampToValueAtTime(0, t + 0.6);
  sweep.connect(sweepG);
  sweepG.connect(masterGain);
  sweep.start(t);
  sweep.stop(t + 0.65);
}

export function playReveal(rarity) {
  switch (rarity) {
    case 'legendary': playRevealLegendary(); break;
    case 'epic': playRevealEpic(); break;
    case 'rare': playRevealRare(); break;
    default: playRevealCommon();
  }
}

export function playRegenerate() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  const sweep = ctx.createOscillator();
  const sweepG = ctx.createGain();
  sweep.type = 'sawtooth';
  sweep.frequency.setValueAtTime(1200, t);
  sweep.frequency.exponentialRampToValueAtTime(80, t + 0.5);
  sweepG.gain.setValueAtTime(0.15, t);
  sweepG.gain.linearRampToValueAtTime(0, t + 0.6);
  sweep.connect(sweepG);
  sweepG.connect(masterGain);
  sweep.start(t);
  sweep.stop(t + 0.65);
  noise(ctx, t + 0.2, t + 0.5, 0.1);
}

export function playExtract() {
  // 提取功能已移除，保留空函数以兼容外部调用
}

export function playPrintComplete() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  const notes = [330, 440, 554, 659, 880, 1047];
  notes.forEach((f, i) => {
    const delay = i * 0.07;
    osc(ctx, 'sine', f, t + delay, t + delay + 0.6, 0.14);
  });
  osc(ctx, 'sine', 2093, t + 0.4, t + 1.2, 0.06);
  osc(ctx, 'sine', 2637, t + 0.5, t + 1.3, 0.04);
  osc(ctx, 'sine', 165, t, t + 1.0, 0.12);
}

export function playFuelPulse() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  osc(ctx, 'sine', 100, t, t + 0.05, 0.06);
  osc(ctx, 'sine', 200, t, t + 0.03, 0.03);
}

// ========== 连接音效 ==========

export function playConnected() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  osc(ctx, 'sine', 440, t, t + 0.15, 0.15);
  osc(ctx, 'sine', 660, t + 0.1, t + 0.3, 0.15);
  osc(ctx, 'sine', 880, t + 0.2, t + 0.5, 0.1);
}

export function playDisconnected() {
  if (!enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  const t = ctx.currentTime;
  osc(ctx, 'sine', 440, t, t + 0.2, 0.12);
  osc(ctx, 'sine', 220, t + 0.15, t + 0.4, 0.1);
}
