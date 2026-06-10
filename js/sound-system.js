// TokenSyber 音效系统 — Web Audio API 合成赛博朋克风格音效
// 零外部音频文件，所有声音实时合成
// - UI 音效：click, success, error, coin, lock, unlock, collect
// - 游戏音效：reveal (按稀有度), regenerate, print-complete
// - 背景音乐：轻松空灵 ambient (C major 系大调色彩)
//   和弦进行：Cmaj9 → Fmaj9 → Am11 → Em9 → Dm9 → Gmaj7 → Em9 → Fmaj9
//   去掉低频 bass，仅中频开阔和弦 + 高频钟铃泛音闪烁
//   慢呼吸节奏 (24s/和弦) + 稀疏泛音 (5s 间隔)

let audioCtx = null;
let masterGain = null;
let enabled = true;
let bgmEnabled = true;
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

function osc(ctx, type, freq, start, end, gainVal = 0.3) {
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

// ========== 背景音乐：轻松空灵 ambient (C major) ==========

// 和弦进行 — C major 系开阔色彩和弦
// 仅中频开阔位 + 高频泛音，不含低频 bass，更轻盈空灵
// 每和弦：pad (中频开阔三和弦/九和弦) + color (高频钟铃泛音)
const BGM_CHORDS = [
  { name: 'Cmaj9', pad: [262, 330, 392, 494, 587], color: [1047, 1319] }, // C E G B D
  { name: 'Fmaj9', pad: [262, 349, 440, 523, 659], color: [1175, 1397] }, // C F A C E
  { name: 'Am11',  pad: [294, 330, 440, 523, 659], color: [988,  1175] }, // D E A C E
  { name: 'Em9',   pad: [294, 330, 392, 494, 587], color: [988,  1319] }, // D E G B D
  { name: 'Dm9',   pad: [294, 349, 440, 523, 659], color: [1047, 1397] }, // D F A C E
  { name: 'Gmaj7', pad: [294, 392, 494, 587, 698], color: [1175, 1568] }, // D G B D F#
  { name: 'Em9b',  pad: [330, 392, 494, 587, 740], color: [988,  1319] }, // E G B D F#
  { name: 'Fmaj7', pad: [262, 349, 440, 523, 659], color: [1047, 1397] }, // C F A C E
];

const BGM_CHORD_DURATION = 24; // 每和弦 24 秒，慢呼吸
const BGM_SHIMMER_INTERVAL = 5000; // 泛音闪烁更稀疏
// 高频钟铃泛音池 — C major 七声音阶高八度，营造星空空灵感
const BGM_SHIMMER_NOTES = [880, 988, 1047, 1175, 1319, 1397, 1568, 1760, 1976, 2349];

let bgmChordIndex = 0;
let bgmChordTimer = null;
let bgmShimmerTimer = null;
let bgmPadOscs = [];

export function startBgm() {
  if (!bgmEnabled || !enabled) return;
  const ctx = ensureCtx(); if (!ctx) return;
  if (bgmNodes) return;

  // 总增益 — 比之前更轻，作为纯背景 ambient
  bgmGain = ctx.createGain();
  bgmGain.gain.value = 0;
  bgmGain.gain.linearRampToValueAtTime(0.05, ctx.currentTime + 6);
  bgmGain.connect(masterGain);

  bgmNodes = {};

  bgmChordIndex = 0;
  playBgmChord();
  bgmChordTimer = setInterval(playBgmChord, BGM_CHORD_DURATION * 1000);

  bgmShimmerTimer = setInterval(playBgmShimmer, BGM_SHIMMER_INTERVAL);
  setTimeout(playBgmShimmer, 2500);
}

function playBgmChord() {
  const ctx = ensureCtx();
  if (!ctx || !bgmGain || !bgmEnabled) return;

  // 淡出旧 pad — 更长的交叉淡入淡出 (8 秒)
  for (const nodes of bgmPadOscs) {
    try { nodes.gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 8); } catch {}
    setTimeout(() => {
      try { nodes.osc1.stop(); } catch {}
      try { nodes.osc2.stop(); } catch {}
      try { nodes.lfo.stop(); } catch {}
    }, 9000);
  }
  bgmPadOscs = [];

  const chord = BGM_CHORDS[bgmChordIndex % BGM_CHORDS.length];
  bgmChordIndex++;

  // === 中频开阔和弦 pad ===
  // 每个音用正弦波 + 微失谐 + 缓慢 LFO，呈现温柔呼吸
  for (const freq of chord.pad) {
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq + 0.4; // 微微失谐增加宽度

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.03 + Math.random() * 0.03; // 更慢的呼吸 0.03-0.06Hz
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.005;
    lfo.connect(lfoG);

    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.012, ctx.currentTime + 7); // 缓慢淡入
    lfoG.connect(g.gain);

    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200 + Math.random() * 400; // 更宽的高频通过，更明亮
    f.Q.value = 0.3;

    o1.connect(f);
    o2.connect(f);
    f.connect(g);
    g.connect(bgmGain);
    o1.start(); o2.start(); lfo.start();

    bgmPadOscs.push({ osc1: o1, osc2: o2, lfo, gain: g });
  }

  // === 高频色彩泛音（持续层）===
  // 三角波营造钟铃般空灵质感
  for (const freq of chord.color) {
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;

    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.02 + Math.random() * 0.02;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.003;
    lfo.connect(lfoG);

    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.linearRampToValueAtTime(0.006, ctx.currentTime + 8);
    lfoG.connect(g.gain);

    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 3500;
    f.Q.value = 0.4;

    o.connect(f);
    f.connect(g);
    g.connect(bgmGain);
    o.start(); lfo.start();

    bgmPadOscs.push({ osc1: o, osc2: o, lfo, gain: g });
  }
}

function playBgmShimmer() {
  if (!bgmEnabled || !enabled) return;
  const ctx = ensureCtx();
  if (!ctx || !bgmGain) return;

  // 随机 1-2 个高频钟铃泛音闪烁，模拟星光闪烁
  const count = Math.random() > 0.5 ? 2 : 1;
  for (let i = 0; i < count; i++) {
    const freq = BGM_SHIMMER_NOTES[Math.floor(Math.random() * BGM_SHIMMER_NOTES.length)];
    const duration = 5 + Math.random() * 7; // 更长的钟铃尾音 5-12 秒

    const o = ctx.createOscillator();
    o.type = Math.random() > 0.5 ? 'triangle' : 'sine';
    o.frequency.value = freq;

    // 钟铃般的快速起音 + 缓慢衰减
    const g = ctx.createGain();
    const startTime = ctx.currentTime + Math.random() * 2.5;
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(0.004 + Math.random() * 0.004, startTime + 0.8);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration); // 指数衰减更自然

    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 4000;
    f.Q.value = 0.5;

    o.connect(f);
    f.connect(g);
    g.connect(bgmGain);
    o.start(startTime);
    o.stop(startTime + duration + 0.1);
  }
}

export function stopBgm() {
  if (!bgmNodes) return;
  const ctx = ensureCtx();

  if (bgmChordTimer) { clearInterval(bgmChordTimer); bgmChordTimer = null; }
  if (bgmShimmerTimer) { clearInterval(bgmShimmerTimer); bgmShimmerTimer = null; }

  if (bgmGain && ctx) {
    bgmGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 3);
  }

  const pads = [...bgmPadOscs];
  setTimeout(() => {
    for (const p of pads) {
      try { p.osc1.stop(); } catch {}
      try { p.osc2.stop(); } catch {}
      try { p.lfo.stop(); } catch {}
    }
  }, 4000);

  bgmNodes = null;
  bgmGain = null;
  bgmPadOscs = [];
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
