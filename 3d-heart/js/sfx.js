/* ================================================================
 * 音效系统：WebAudio 实时合成（不依赖任何外部音频文件）
 *   - 点击音：点击爱心 / 钻石 / 文字时的柔和「啵」声
 *   - 烟花声：闷响 + 噪声爆裂的烟花炸开声
 *   - 心跳声：与心跳周期同步的低频「怦—怦」双跳
 * 浏览器要求 AudioContext 必须在用户手势后创建/恢复，
 * 因此会在首次点按屏幕时预创建；未交互前音效保持静默。
 * ================================================================ */
import { $ } from './dom.js';
import { saveConfig, registerConfig } from './config.js';

const soundParams = {
  enabled: true, click: true, firework: true, heartbeat: true, volume: 0.6,
};

let soundCtx = null;
let soundMaster = null;
let soundNoiseBuf = null;
let lastFireworkSfxAt = 0;

function ensureSoundCtx() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!soundCtx) {
    soundCtx = new Ctx();
    soundMaster = soundCtx.createGain();
    soundMaster.gain.value = soundParams.volume;
    soundMaster.connect(soundCtx.destination);
    const len = Math.floor(soundCtx.sampleRate * 0.6);
    soundNoiseBuf = soundCtx.createBuffer(1, len, soundCtx.sampleRate);
    const data = soundNoiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4);
    }
  }
  if (soundCtx.state === 'suspended') soundCtx.resume().catch(() => {});
  return soundCtx;
}

function sfxClick() {
  if (!soundParams.enabled || !soundParams.click) return;
  const ctx = ensureSoundCtx();
  if (!ctx) return;
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(660, t0);
  osc.frequency.exponentialRampToValueAtTime(190, t0 + 0.09);
  gain.gain.setValueAtTime(0.5, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.13);
  osc.connect(gain); gain.connect(soundMaster);
  osc.start(t0); osc.stop(t0 + 0.15);
}

function sfxFirework() {
  if (!soundParams.enabled || !soundParams.firework) return;
  const ctx = ensureSoundCtx();
  if (!ctx) return;
  const now = performance.now();
  if (now - lastFireworkSfxAt < 90) return; // 同帧密集爆炸只响一声
  lastFireworkSfxAt = now;
  const t0 = ctx.currentTime + 0.02;
  const osc = ctx.createOscillator();
  const oscGain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, t0);
  osc.frequency.exponentialRampToValueAtTime(46, t0 + 0.28);
  oscGain.gain.setValueAtTime(0.42, t0);
  oscGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.3);
  osc.connect(oscGain); oscGain.connect(soundMaster);
  osc.start(t0); osc.stop(t0 + 0.32);
  if (soundNoiseBuf) {
    const noise = ctx.createBufferSource();
    noise.buffer = soundNoiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2600;
    bp.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.5, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.5);
    noise.connect(bp); bp.connect(noiseGain); noiseGain.connect(soundMaster);
    noise.start(t0);
  }
}

function sfxHeartbeat(strong) {
  if (!soundParams.enabled || !soundParams.heartbeat) return;
  const ctx = ensureSoundCtx();
  if (!ctx || ctx.state !== 'running') return; // 无用户手势前不发声
  const t0 = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(strong ? 64 : 56, t0);
  osc.frequency.exponentialRampToValueAtTime(38, t0 + 0.11);
  gain.gain.setValueAtTime(strong ? 0.5 : 0.3, t0);
  gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.16);
  osc.connect(gain); gain.connect(soundMaster);
  osc.start(t0); osc.stop(t0 + 0.18);
}


/* ---------- UI 同步与事件 ---------- */
function syncSoundUI() {
  if ($('soundEnabled')) $('soundEnabled').checked = !!soundParams.enabled;
  if ($('soundClick')) $('soundClick').checked = !!soundParams.click;
  if ($('soundFirework')) $('soundFirework').checked = !!soundParams.firework;
  if ($('soundHeartbeat')) $('soundHeartbeat').checked = !!soundParams.heartbeat;
  if ($('soundVolume')) {
    $('soundVolume').value = String(soundParams.volume);
    $('soundVolumeVal').textContent = Math.round(soundParams.volume * 100) + '%';
  }
}
if ($('soundEnabled'))
  $('soundEnabled').addEventListener('change', (e) => {
    soundParams.enabled = e.target.checked;
    if (e.target.checked) ensureSoundCtx();
    saveConfig();
  });
if ($('soundClick'))
  $('soundClick').addEventListener('change', (e) => {
    soundParams.click = e.target.checked;
    saveConfig();
  });
if ($('soundFirework'))
  $('soundFirework').addEventListener('change', (e) => {
    soundParams.firework = e.target.checked;
    saveConfig();
  });
if ($('soundHeartbeat'))
  $('soundHeartbeat').addEventListener('change', (e) => {
    soundParams.heartbeat = e.target.checked;
    saveConfig();
  });
if ($('soundVolume'))
  $('soundVolume').addEventListener('input', (e) => {
    soundParams.volume = Number(e.target.value);
    $('soundVolumeVal').textContent = Math.round(soundParams.volume * 100) + '%';
    if (soundMaster) soundMaster.gain.value = soundParams.volume;
    saveConfig();
  });

registerConfig({
  save: () => ({ sound: soundParams }),
  load: (cfg) => {
    if (cfg.sound) {
      if (typeof cfg.sound.enabled === 'boolean') soundParams.enabled = cfg.sound.enabled;
      if (typeof cfg.sound.click === 'boolean') soundParams.click = cfg.sound.click;
      if (typeof cfg.sound.firework === 'boolean') soundParams.firework = cfg.sound.firework;
      if (typeof cfg.sound.heartbeat === 'boolean') soundParams.heartbeat = cfg.sound.heartbeat;
      if (typeof cfg.sound.volume === 'number')
        soundParams.volume = Math.min(1, Math.max(0, cfg.sound.volume));
    }
  },
});

export { soundParams, ensureSoundCtx, sfxClick, sfxFirework, sfxHeartbeat, syncSoundUI };
