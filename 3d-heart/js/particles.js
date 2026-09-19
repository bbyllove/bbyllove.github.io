/* ================================================================
 * 周边漂浮粒子：光尘 / 花瓣 / 气泡 / 雪花 / 萤火虫 / 纸屑
 * + 天气模式（定向飘落 + 风力）
 * ================================================================ */
import * as THREE from 'three';
import { $ } from './dom.js';
import { getPerfParticleScale } from './perf.js';
import { scene } from './core.js';
import { saveConfig, registerConfig } from './config.js';

// 天气模式参数（提前声明，便于配置保存/读取）
const weatherParams = { enabled: false, fallSpeed: 1.0, wind: 0.0 };

/* ================================================================
 * 漂浮的粉色光尘粒子
 * ================================================================ */
function createGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255, 235, 244, 1)');
  g.addColorStop(0.35, 'rgba(255, 170, 205, 0.55)');
  g.addColorStop(1, 'rgba(255, 120, 170, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

const PARTICLE_COUNT = 260;
const particlePositions = new Float32Array(PARTICLE_COUNT * 3);
const particleSeeds = [];
for (let i = 0; i < PARTICLE_COUNT; i++) {
  const seed = {
    radius: 3.5 + Math.random() * 9,
    angle: Math.random() * Math.PI * 2,
    y: (Math.random() - 0.5) * 8,
    orbitSpeed: 0.03 + Math.random() * 0.12,
    floatSpeed: 0.4 + Math.random() * 0.8,
    floatAmp: 0.3 + Math.random() * 0.6,
  };
  particleSeeds.push(seed);
  particlePositions[i * 3] = Math.cos(seed.angle) * seed.radius;
  particlePositions[i * 3 + 1] = seed.y;
  particlePositions[i * 3 + 2] = Math.sin(seed.angle) * seed.radius;
}

const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute(
  'position',
  new THREE.BufferAttribute(particlePositions, 3)
);
const particles = new THREE.Points(
  particleGeometry,
  new THREE.PointsMaterial({
    size: 0.14,
    map: createGlowTexture(),
    transparent: true,
    opacity: 0.85,
    color: 0xffb3cd,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  })
);
scene.add(particles);

/* ---------- 周边粒子样式：光尘 / 花瓣 / 气泡 / 雪花 / 萤火虫 / 纸屑 ---------- */
const PARTICLE_STYLES = {
  glow: { name: '光尘', size: 0.14, color: '#ffb3cd', opacity: 0.85, additive: true },
  petal: { name: '花瓣', size: 0.20, color: '#ffc7d9', opacity: 0.88, additive: true },
  bubble: { name: '气泡', size: 0.22, color: '#e9f7ff', opacity: 0.72, additive: true },
  snow: { name: '雪花', size: 0.09, color: '#ffffff', opacity: 0.92, additive: false },
  firefly: { name: '萤火虫', size: 0.17, color: '#ffdc78', opacity: 0.94, additive: true },
  confetti: { name: '纸屑', size: 0.11, color: '#ffffff', opacity: 0.95, additive: false },
};

function createParticleTexture(kind) {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, 96, 96);
  if (kind === 'petal') {
    const layers = [
      { count: 5, radius: 30, size: 12, alpha: 0.16 },
      { count: 5, radius: 22, size: 10, alpha: 0.26 },
      { count: 5, radius: 13, size: 7, alpha: 0.40 },
    ];
    for (const layer of layers) {
      ctx.fillStyle = `rgba(255,255,255,${layer.alpha})`;
      for (let i = 0; i < layer.count; i++) {
        const a = (i / layer.count) * Math.PI * 2;
        ctx.save();
        ctx.translate(48 + Math.cos(a) * layer.radius, 48 + Math.sin(a) * layer.radius);
        ctx.rotate(a + Math.PI / 2);
        ctx.beginPath();
        ctx.ellipse(0, 0, layer.size, layer.size * 0.46, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  } else if (kind === 'bubble') {
    const g = ctx.createRadialGradient(48, 48, 12, 48, 48, 41);
    g.addColorStop(0, 'rgba(255,255,255,0.10)');
    g.addColorStop(0.68, 'rgba(255,255,255,0.14)');
    g.addColorStop(0.88, 'rgba(220,250,255,0.46)');
    g.addColorStop(1, 'rgba(200,240,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(48, 48, 41, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(48, 48, 30, Math.PI * 0.95, Math.PI * 1.42);
    ctx.stroke();
  } else if (kind === 'snow') {
    ctx.strokeStyle = 'rgba(255,255,255,0.94)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = i * Math.PI / 3;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(48, 48);
      ctx.lineTo(48 + Math.cos(a) * 36, 48 + Math.sin(a) * 36);
      ctx.lineWidth = 2.7;
      for (const branchR of [16, 27]) {
        const bx = 48 + Math.cos(a) * branchR, by = 48 + Math.sin(a) * branchR;
        for (const side of [-1, 1]) {
          const ba = a + side * 0.72;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + Math.cos(ba) * 9, by + Math.sin(ba) * 9);
          ctx.stroke();
        }
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath(); ctx.arc(48, 48, 3.6, 0, Math.PI * 2); ctx.fill();
  } else if (kind === 'firefly') {
    const g = ctx.createRadialGradient(48, 48, 0, 48, 48, 45);
    g.addColorStop(0, 'rgba(255,255,220,1)');
    g.addColorStop(0.18, 'rgba(255,230,128,0.80)');
    g.addColorStop(1, 'rgba(255,190,64,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 96, 96);
  } else if (kind === 'confetti') {
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    for (let i = 0; i < 14; i++) {
      const side = Math.random() < .5 ? -1 : 1;
      const x = 48 + side * (6 + Math.random() * 28);
      const y = 48 + side * (6 + Math.random() * 28);
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.random() * Math.PI * 2);
      ctx.fillRect(-6, -2, 12, 4);
      ctx.fillRect(-2, -6, 4, 12);
      ctx.restore();
    }
  } else {
    return createGlowTexture();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const particleTextures = {
  glow: createGlowTexture(),
  petal: createParticleTexture('petal'),
  bubble: createParticleTexture('bubble'),
  snow: createParticleTexture('snow'),
  firefly: createParticleTexture('firefly'),
  confetti: createParticleTexture('confetti'),
};

const particleParams = {
  size: 1,        // 大小倍率（叠加在每种样式的基础尺寸上）
  opacity: 0.85,  // 透明度（0–1，绝对值，所有样式共用）
  density: 1,     // 密度（0–1，控制可见粒子数量占比）
};

function applyParticleStyle(style) {
  ambientParticleStyle = style;
  const cfg = PARTICLE_STYLES[style] || PARTICLE_STYLES.glow;
  const tex = particleTextures[cfg.name ? style : 'glow'] || particleTextures.glow;
  particles.material.map = tex;
  particles.material.size = cfg.size * particleParams.size;
  particles.material.opacity = particleParams.opacity;
  particles.material.color.set(cfg.color);
  particles.material.blending = cfg.additive ? THREE.AdditiveBlending : THREE.NormalBlending;
  particles.material.needsUpdate = true;
  const count = Math.max(0, Math.min(PARTICLE_COUNT, Math.round(particleParams.density * PARTICLE_COUNT * getPerfParticleScale())));
  particleGeometry.setDrawRange(0, count);
  particles.visible = count > 0;
  document.querySelectorAll('#particleStyleGrid button').forEach((btn) =>
    btn.classList.toggle('active', btn.dataset.particle === style)
  );
}
let ambientParticleStyle = 'glow';
window.addEventListener('heart-perf-change', () => applyParticleStyle(ambientParticleStyle));

function syncParticleUI() {
  if ($('particleSize')) {
    $('particleSize').value = String(particleParams.size);
    $('particleSizeVal').textContent = particleParams.size.toFixed(2);
  }
  if ($('particleOpacity')) {
    $('particleOpacity').value = String(particleParams.opacity);
    $('particleOpacityVal').textContent = Math.round(particleParams.opacity * 100) + '%';
  }
  if ($('particleDensity')) {
    $('particleDensity').value = String(particleParams.density);
    $('particleDensityVal').textContent = Math.round(particleParams.density * 100) + '%';
  }
}



/* ---------- 每帧粒子更新：环绕漂浮 / 天气模式定向飘落 ---------- */
function updateParticles(t, dt, aspeed, animPhase, musicEnergy, musicBeat, musicPlaying) {
  const pos = particleGeometry.attributes.position.array;
  const orbitMul = 1 + musicEnergy * 1.4 + musicBeat * 0.8;
  const floatMul = 1 + musicEnergy * 0.8;
  if (weatherParams.enabled) {
    // 天气模式：粒子受重力下落 + 风力水平漂移 + 轻微左右摆动，出界后回到顶部
    const sdt = dt * aspeed;
    const wind = weatherParams.wind;
    const fallBase = weatherParams.fallSpeed;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const s = particleSeeds[i];
      let x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      y -= fallBase * (0.45 + s.floatSpeed * 0.9) * sdt;
      x += (wind + Math.sin(t * 1.7 + s.angle * 5) * 0.4) * sdt;
      z += Math.cos(t * 1.3 + s.angle * 3) * 0.18 * sdt;
      if (y < -5.2) {
        y = 8 + Math.random() * 2.5;
        x = (Math.random() - 0.5) * 26;
        z = (Math.random() - 0.5) * 26;
      }
      if (x > 14) x -= 28; else if (x < -14) x += 28;
      if (z > 14) z -= 28; else if (z < -14) z += 28;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
    }
  } else {
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const s = particleSeeds[i];
      const angle = s.angle + animPhase * s.orbitSpeed * orbitMul;
      pos[i * 3] = Math.cos(angle) * s.radius;
      pos[i * 3 + 1] = s.y + Math.sin(animPhase * s.floatSpeed * floatMul + s.angle * 7) * s.floatAmp;
      pos[i * 3 + 2] = Math.sin(angle) * s.radius;
    }
  }
  particleGeometry.attributes.position.needsUpdate = true;
  if (musicPlaying) {
    particles.material.opacity = Math.min(1, (PARTICLE_STYLES[ambientParticleStyle] ? PARTICLE_STYLES[ambientParticleStyle].opacity : 0.85) * (1 + musicBeat * 0.5));
  }
}

/* ---------- 面板控制：粒子样式 / 大小 / 透明度 / 密度 ---------- */
if ($('particleStyleGrid')) {
  $('particleStyleGrid').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-particle]');
    if (!button) return;
    ambientParticleStyle = button.dataset.particle;
    applyParticleStyle(ambientParticleStyle);
    saveConfig();
  });
}

if ($('particleSize')) {
  $('particleSize').addEventListener('input', (e) => {
    particleParams.size = Number(e.target.value);
    $('particleSizeVal').textContent = particleParams.size.toFixed(2);
    applyParticleStyle(ambientParticleStyle);
    saveConfig();
  });
}
if ($('particleOpacity')) {
  $('particleOpacity').addEventListener('input', (e) => {
    particleParams.opacity = Number(e.target.value);
    $('particleOpacityVal').textContent = Math.round(particleParams.opacity * 100) + '%';
    applyParticleStyle(ambientParticleStyle);
    saveConfig();
  });
}
if ($('particleDensity')) {
  $('particleDensity').addEventListener('input', (e) => {
    particleParams.density = Number(e.target.value);
    $('particleDensityVal').textContent = Math.round(particleParams.density * 100) + '%';
    applyParticleStyle(ambientParticleStyle);
    saveConfig();
  });
}


/* ---------- 天气模式（定向飘落）面板控制 ---------- */
function syncWeatherUI() {
  if ($('weatherEnabled')) $('weatherEnabled').checked = !!weatherParams.enabled;
  if ($('weatherFall')) {
    $('weatherFall').value = String(weatherParams.fallSpeed);
    $('weatherFallVal').textContent = weatherParams.fallSpeed.toFixed(1);
  }
  if ($('weatherWind')) {
    $('weatherWind').value = String(weatherParams.wind);
    $('weatherWindVal').textContent = weatherParams.wind.toFixed(1);
  }
}
if ($('weatherEnabled'))
  $('weatherEnabled').addEventListener('change', (e) => {
    weatherParams.enabled = e.target.checked;
    saveConfig();
  });
if ($('weatherFall'))
  $('weatherFall').addEventListener('input', (e) => {
    weatherParams.fallSpeed = Number(e.target.value);
    $('weatherFallVal').textContent = weatherParams.fallSpeed.toFixed(1);
    saveConfig();
  });
if ($('weatherWind'))
  $('weatherWind').addEventListener('input', (e) => {
    weatherParams.wind = Number(e.target.value);
    $('weatherWindVal').textContent = weatherParams.wind.toFixed(1);
    saveConfig();
  });

registerConfig({
  save: () => ({
    particleStyle: ambientParticleStyle,
    particleParams: particleParams,
    weather: weatherParams,
  }),
  load: (cfg) => {
    if (cfg.particleStyle && PARTICLE_STYLES[cfg.particleStyle]) {
      ambientParticleStyle = cfg.particleStyle;
    }
    if (cfg.particleParams) {
      if (typeof cfg.particleParams.size === 'number')
        particleParams.size = Math.min(3, Math.max(0.3, cfg.particleParams.size));
      if (typeof cfg.particleParams.opacity === 'number')
        particleParams.opacity = Math.min(1, Math.max(0, cfg.particleParams.opacity));
      if (typeof cfg.particleParams.density === 'number')
        particleParams.density = Math.min(1, Math.max(0, cfg.particleParams.density));
    }
    if (cfg.weather) {
      if (typeof cfg.weather.enabled === 'boolean') weatherParams.enabled = cfg.weather.enabled;
      if (typeof cfg.weather.fallSpeed === 'number')
        weatherParams.fallSpeed = Math.min(4, Math.max(0.2, cfg.weather.fallSpeed));
      if (typeof cfg.weather.wind === 'number')
        weatherParams.wind = Math.min(3, Math.max(-3, cfg.weather.wind));
    }
  },
});

function getAmbientParticleStyle() { return ambientParticleStyle; }

export { createGlowTexture, particles, particleGeometry, PARTICLE_COUNT, PARTICLE_STYLES, particleParams,
  weatherParams, applyParticleStyle, syncParticleUI, getAmbientParticleStyle,
  updateParticles, syncWeatherUI };
