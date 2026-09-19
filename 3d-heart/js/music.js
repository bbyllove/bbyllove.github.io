/* ================================================================
 * 音乐同步：内置浪漫纯音乐 / 上传本地音乐 → Web Audio 频谱分析
 *          → 心跳 / 粒子 / 烟花律动
 * ================================================================ */
import { $ } from './dom.js';
import { saveConfig, registerConfig } from './config.js';
import { spawnFirework } from './fx3d.js';
import { fxW, fxH, fxEnabled } from './fx2d.js';
import { particles, particleParams } from './particles.js';
import { DEFAULT_MUSIC_NAME, createDefaultRomanticMusic } from './default-music.js';

// 音乐同步参数（提前声明，便于配置保存/读取）
const musicParams = {
  volume: 0.8,
  sensitivity: 1.0,
  fireworks: true,
};

let musicAudio = null;
let musicContext = null;
let musicAnalyser = null;
let musicData = null;
let musicSource = null;
let musicEnergy = 0;
let musicBeat = 0;
let musicLastBeat = 0;
let musicPlaying = false;
let defaultMusicUrl = '';
let localMusicUrl = '';

function ensureMusicAudio() {
  if (!musicAudio) {
    musicAudio = new Audio();
    musicAudio.loop = true;
    musicAudio.volume = musicParams.volume;
  }
  return musicAudio;
}

function ensureMusicContext() {
  const audio = ensureMusicAudio();
  if (!musicContext) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    musicContext = new Ctx();
    musicAnalyser = musicContext.createAnalyser();
    musicAnalyser.fftSize = 1024;
    musicAnalyser.smoothingTimeConstant = 0.8;
    musicData = new Uint8Array(musicAnalyser.frequencyBinCount);
    musicSource = musicContext.createMediaElementSource(audio);
    musicSource.connect(musicAnalyser);
    musicAnalyser.connect(musicContext.destination);
  }
  return musicContext;
}

function ensureDefaultMusicUrl() {
  if (!defaultMusicUrl) {
    defaultMusicUrl = URL.createObjectURL(
      new Blob([createDefaultRomanticMusic()], { type: 'audio/wav' })
    );
  }
  return defaultMusicUrl;
}

function setMusicTrackName(name, title) {
  const nameEl = $('musicName');
  if (nameEl) {
    nameEl.textContent = name;
    nameEl.title = title || name;
  }
}

function setMusicPlayButton(playing) {
  const btn = $('musicPlay');
  if (btn) {
    btn.textContent = playing ? '停止' : '播放';
    btn.disabled = !musicAudio || !musicAudio.src;
  }
}

function stopMusic() {
  if (musicAudio && !musicAudio.paused) musicAudio.pause();
  musicPlaying = false;
  musicBeat = 0;
  musicEnergy = 0;
  setMusicPlayButton(false);
}

function toggleMusic() {
  if (!musicAudio || !musicAudio.src) return;
  if (!musicPlaying) {
    const ctx = ensureMusicContext();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    musicAudio.play().then(() => {
      musicPlaying = true;
      setMusicPlayButton(true);
    }).catch((err) => {
      console.warn('音乐播放失败：', err);
      stopMusic();
    });
  } else {
    stopMusic();
  }
}

function loadDefaultMusic() {
  const audio = ensureMusicAudio();
  const url = ensureDefaultMusicUrl();
  const shouldResume = musicPlaying;
  if (audio.src !== url) {
    stopMusic();
    if (localMusicUrl) URL.revokeObjectURL(localMusicUrl);
    localMusicUrl = '';
    audio.src = url;
  }
  audio.volume = musicParams.volume;
  setMusicTrackName(DEFAULT_MUSIC_NAME, '内置浪漫纯音乐：本地实时合成，无外置音频与版权依赖');
  musicEnergy = 0;
  musicBeat = 0;
  musicPlaying = false;
  setMusicPlayButton(false);
  if (shouldResume) toggleMusic();
}

function loadMusicFile(file) {
  if (!file) return;
  const audio = ensureMusicAudio();
  const shouldResume = musicPlaying;
  stopMusic();
  if (localMusicUrl) URL.revokeObjectURL(localMusicUrl);
  localMusicUrl = URL.createObjectURL(file);
  audio.src = localMusicUrl;
  audio.volume = musicParams.volume;
  const name = file.name || '本地音乐';
  setMusicTrackName(
    name.length > 28 ? name.slice(0, 25) + '…' : name,
    file.name || ''
  );
  // 重置分析器（同一 audio 元素可继续使用已连接的 source）
  musicEnergy = 0;
  musicBeat = 0;
  musicPlaying = false;
  setMusicPlayButton(false);
  if (shouldResume) toggleMusic();
}

if ($('musicFile')) {
  $('musicFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) loadMusicFile(file);
    e.target.value = ''; // 允许再次选择同一个本地文件
  });
}
if ($('musicDefault')) {
  $('musicDefault').addEventListener('click', () => loadDefaultMusic());
}
if ($('musicPlay')) {
  $('musicPlay').addEventListener('click', toggleMusic);
}
if ($('musicVolume')) {
  $('musicVolume').addEventListener('input', (e) => {
    musicParams.volume = Number(e.target.value);
    $('musicVolumeVal').textContent = Math.round(musicParams.volume * 100) + '%';
    if (musicAudio) musicAudio.volume = musicParams.volume;
    saveConfig();
  });
}
if ($('musicSensitivity')) {
  $('musicSensitivity').addEventListener('input', (e) => {
    musicParams.sensitivity = Number(e.target.value);
    $('musicSensitivityVal').textContent = musicParams.sensitivity.toFixed(1);
    saveConfig();
  });
}
if ($('musicFireworks')) {
  $('musicFireworks').addEventListener('change', (e) => {
    musicParams.fireworks = e.target.checked;
    saveConfig();
  });
}

function updateMusicSync(t, dt) {
  if (!musicPlaying || !musicAnalyser || !musicData) {
    musicBeat *= 0.9;
    musicEnergy *= 0.9;
    if (particles && particles.material && particles.material.opacity !== particleParams.opacity) {
      particles.material.opacity = particleParams.opacity;
    }
    return;
  }
  musicAnalyser.getByteFrequencyData(musicData);
  // 低频段代表鼓点 / 节奏
  const bassBins = Math.max(8, Math.floor(musicData.length * 0.12));
  let sum = 0;
  for (let i = 0; i < bassBins; i++) sum += musicData[i];
  const beatEnergy = sum / (bassBins * 255);

  musicEnergy = musicEnergy * 0.86 + beatEnergy * 0.14;

  const threshold = Math.min(0.8, Math.max(0.12, 0.6 / musicParams.sensitivity));
  if (beatEnergy > threshold && beatEnergy > musicEnergy * 1.08 && t - musicLastBeat > 0.18) {
    musicBeat = 1;
    musicLastBeat = t;
    if (musicParams.fireworks && fxEnabled && fxW > 0 && fxH > 0) {
      const cx = fxW * 0.3 + Math.random() * fxW * 0.4;
      const cy = fxH * 0.3 + Math.random() * fxH * 0.4;
      spawnFirework(cx, cy, { kind: 'round' });
    }
  }
  musicBeat *= 1 - Math.min(1, dt * 6);
}

function syncMusicUI() {
  if (musicAudio) musicAudio.volume = musicParams.volume;
  if ($('musicVolume')) {
    $('musicVolume').value = String(musicParams.volume);
    $('musicVolumeVal').textContent = Math.round(musicParams.volume * 100) + '%';
  }
  if ($('musicSensitivity')) {
    $('musicSensitivity').value = String(musicParams.sensitivity);
    $('musicSensitivityVal').textContent = musicParams.sensitivity.toFixed(1);
  }
  if ($('musicFireworks')) $('musicFireworks').checked = !!musicParams.fireworks;
}


registerConfig({
  save: () => ({ music: musicParams }),
  load: (cfg) => {
    if (cfg.music) {
      if (typeof cfg.music.volume === 'number')
        musicParams.volume = Math.min(1, Math.max(0, cfg.music.volume));
      if (typeof cfg.music.sensitivity === 'number')
        musicParams.sensitivity = Math.min(3, Math.max(0.2, cfg.music.sensitivity));
      if (typeof cfg.music.fireworks === 'boolean')
        musicParams.fireworks = cfg.music.fireworks;
    }
  },
});

// 预置默认曲目；浏览器会等用户点击播放 / 空格后才真正出声。
loadDefaultMusic();

export { musicParams, musicEnergy, musicBeat, musicPlaying, updateMusicSync, syncMusicUI, toggleMusic };
