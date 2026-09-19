/* ================================================================
 * 点击烟花：2D 叠加层（圆点 / 形状粒子 + 闪光 + 冲击环）+ 连点彩蛋
 * （3D 小爱心 / 小钻石 / 小文字形状烟花见 fx3d.js）
 * ================================================================ */
import { $ } from './dom.js';
import { saveConfig, registerConfig } from './config.js';
import { sfxFirework } from './sfx.js';

// 连点爱心奖励：必须在 1.8 秒内连续命中，避免缓慢点击也误触发
let heartClickStreak = 0, heartClickAt = 0, easterEggCooldown = 0;
function triggerHeartEasterEgg(cx, cy) {
  sfxFirework();
  while (fxParts.length > FX_MAX_PT - 650) fxParts.shift();
  for (let wave = 0; wave < 4; wave++) {
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 90 + Math.random() * 330;
      const dx = Math.cos(a) * speed;
      const dy = -80 - Math.random() * 230;
      const life = 0.7 + Math.random() * 0.75;
      const hue = (45 + wave * 70 + Math.random() * 35) % 360;
      fxParts.push({
        x: cx + (Math.random() - 0.5) * 24, y: cy + (Math.random() - 0.5) * 18,
        vx: dx * (0.7 + Math.random() * 0.6), vy: dy / 2 + Math.random() * 90,
        life, max: life, hue: hue + (Math.random() - 0.5) * 18,
        size: 1.4 + Math.random() * 2.1, trail: [],
      });
    }
  }
  addFxFlashRing(cx, cy, 45);
  addFxFlashRing(cx + fxW / 2, cy + fxH / 2, 45);
  addFxFlashRing(cx / 2, cy * 2, 45);
}

function recordHeartHit(cx, cy) {
  const now = performance.now();
  if (now - easterEggCooldown < 2200) return;
  heartClickStreak = now - heartClickAt < 1800 ? heartClickStreak + 1 : 1;
  heartClickAt = now;
  if (heartClickStreak >= 6) {
    triggerHeartEasterEgg(cx, cy);
    heartClickStreak = 0;
    easterEggCooldown = now;
  }
}

let fxEnabled = true;
let fxHeartSize = 1.0;   // 点击爱心 → 小爱心大小倍率
let fxDiamondSize = 1.0; // 点击钻石 → 小钻石大小倍率
let fxTextSize = 1.0;    // 点击文字 → 小文字大小倍率
const FX_SHAPE_MIN = 0.4, FX_SHAPE_MAX = 2.4;
// 按 kind 取对应的大小倍率（飞行中的粒子每帧实时跟随各自滑杆）
function fxKindSize(kind) {
  return kind === 'heart' ? fxHeartSize : kind === 'diamond' ? fxDiamondSize : kind === 'text' ? fxTextSize : 1.0;
}
// 散开幅度（出射速度倍率）与密度（粒子数量），每种形状各自独立，滑杆实时生效
let fxHeartSpread = 1.0, fxDiamondSpread = 1.0, fxTextSpread = 1.0;
let fxHeartDensity = 30, fxDiamondDensity = 30, fxTextDensity = 20;
const FX_SPREAD_MIN = 0.3, FX_SPREAD_MAX = 3.0;
const FX_DENSITY_MIN = 6, FX_DENSITY_MAX = 60;
function fxKindSpread(kind) {
  return kind === 'heart' ? fxHeartSpread : kind === 'diamond' ? fxDiamondSpread : kind === 'text' ? fxTextSpread : 1.0;
}
function fxKindDensity(kind) {
  return kind === 'heart' ? fxHeartDensity : kind === 'diamond' ? fxDiamondDensity : kind === 'text' ? fxTextDensity : 24;
}

// 点击空白处烟花的粒子形状：圆点 / 星星 / 花瓣 / 光环 / 蝴蝶 / 爱心 / 文字
let fxShape = 'random';
// 「随机」档：每次点击爆发从全部形状里随机抽一种（整朵同形状，观感更整）
const FX_SHAPE_LIST = ['round', 'star', 'petal', 'ring', 'butterfly', 'heart', 'char'];
function resolveFxShape() {
  return fxShape === 'random'
    ? FX_SHAPE_LIST[(Math.random() * FX_SHAPE_LIST.length) | 0]
    : fxShape;
}
// 「文字」形状的粒子内容：字母 / emoji / 自定义单字（最多 4 字符）
let fxChar = '❤';
function fxParticleRotSpeed() { return (Math.random() - 0.5) * 5; }

/* ---------- 2D 叠加层 圆点烟花 + 闪光 + 冲击环 ---------- */
const fxCanvas = document.createElement('canvas');
fxCanvas.id = 'fxLayer';
fxCanvas.style.cssText =
  'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:16;';
document.body.appendChild(fxCanvas);
const fctx = fxCanvas.getContext('2d');
let fxDpr = 1, fxW = 0, fxH = 0;
function fxResize() {
  fxDpr = Math.min(window.devicePixelRatio || 1, 2);
  fxW = window.innerWidth; fxH = window.innerHeight;
  fxCanvas.width = Math.floor(fxW * fxDpr); fxCanvas.height = Math.floor(fxH * fxDpr);
}
fxResize();
window.addEventListener('resize', fxResize);

const FX_G = 250, FX_DRAG = 0.7, FX_TRAIL = 7, FX_MAX_PT = 1800;
let fxParts = []; let fxRings = []; let fxFlashes = [];
let fxLast = performance.now();

function addFxFlashRing(cx, cy, hue) {
  fxFlashes.push({ x: cx, y: cy, max: 0.3, life: 0.3, hue });
  fxRings.push({ x: cx, y: cy, r: 6, maxR: 190, max: 0.6, life: 0.6, hue });
}
let fxBurstTotal = 0;
function spawn2DBurst(cx, cy) {
  fxBurstTotal++;
  const hue = Math.random() * 360;
  const shape = resolveFxShape();
  const burst = (n, sMin, sMax, lMin, lMax, spread) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = sMin + Math.random() * (sMax - sMin);
      const life = lMin + Math.random() * (lMax - lMin);
      fxParts.push({
        x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life, max: life, hue: hue + (Math.random() - 0.5) * spread,
        size: 1.6 + Math.random() * 1.8, trail: [],
        shape,
        char: fxChar,
        rot: Math.random() * Math.PI * 2,
        rotSpeed: fxParticleRotSpeed(),
      });
    }
  };
  burst(56, 150, 360, 0.8, 1.6, 42);
  burst(30, 55, 165, 0.7, 1.25, 26);
  if (fxParts.length > FX_MAX_PT) fxParts.splice(0, fxParts.length - FX_MAX_PT);
  addFxFlashRing(cx, cy, hue);
}

function drawFxParticle(p, lr) {
  const x = p.x, y = p.y;
  const sz = p.size * lr + 0.7;
  const hue = p.hue;
  fctx.fillStyle = `hsla(${hue},100%,72%,${lr})`;
  fctx.strokeStyle = `hsla(${hue},100%,72%,${lr})`;
  switch (p.shape) {
    case 'star': {
      const spikes = 5, outer = sz * 1.9, inner = sz * 0.8;
      fctx.beginPath();
      for (let i = 0; i < spikes * 2; i++) {
        const r = i % 2 === 0 ? outer : inner;
        const a = p.rot + (i * Math.PI) / spikes;
        const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        if (i === 0) fctx.moveTo(px, py); else fctx.lineTo(px, py);
      }
      fctx.closePath(); fctx.fill();
      break;
    }
    case 'petal': {
      fctx.save();
      fctx.translate(x, y); fctx.rotate(p.rot);
      fctx.beginPath();
      fctx.ellipse(0, 0, sz * 1.8, sz * 0.7, 0, 0, Math.PI * 2);
      fctx.fill();
      fctx.restore();
      break;
    }
    case 'ring': {
      fctx.beginPath();
      fctx.arc(x, y, sz * 1.5, 0, Math.PI * 2);
      fctx.lineWidth = Math.max(0.6, sz * 0.7);
      fctx.stroke();
      break;
    }
    case 'butterfly': {
      fctx.save();
      fctx.translate(x, y); fctx.rotate(p.rot);
      fctx.beginPath();
      fctx.ellipse(-sz * 0.8, 0, sz * 1.2, sz * 0.7, -0.5, 0, Math.PI * 2);
      fctx.ellipse(sz * 0.8, 0, sz * 1.2, sz * 0.7, 0.5, 0, Math.PI * 2);
      fctx.fill();
      fctx.restore();
      break;
    }
    case 'heart': {
      const r = sz * 1.4;
      fctx.save();
      fctx.translate(x, y); fctx.rotate(Math.PI); // 心尖朝下
      fctx.beginPath();
      fctx.moveTo(0, r * 0.55);
      fctx.bezierCurveTo(-r * 1.1, -r * 0.45, -r * 0.45, -r * 1.15, 0, -r * 0.35);
      fctx.bezierCurveTo(r * 0.45, -r * 1.15, r * 1.1, -r * 0.45, 0, r * 0.55);
      fctx.closePath(); fctx.fill();
      fctx.restore();
      break;
    }
    case 'char': {
      // 字母 / emoji / 自定义单字：直接 fillText（emoji 用系统彩色字形，
      // 普通字符用当前粒子色）
      const text = p.char || '❤';
      fctx.save();
      fctx.translate(x, y); fctx.rotate(p.rot * 0.35); // 轻微摆动，不乱翻
      fctx.font = `700 ${Math.max(10, sz * 4.6)}px ui-rounded, 'PingFang SC', 'Segoe UI Emoji', sans-serif`;
      fctx.textAlign = 'center';
      fctx.textBaseline = 'middle';
      fctx.globalAlpha = lr;
      fctx.fillText(text, 0, 0);
      fctx.restore();
      break;
    }
    default: {
      fctx.beginPath();
      fctx.arc(x, y, sz, 0, Math.PI * 2);
      fctx.fill();
    }
  }
}

function fxTick(now) {
  const dt = Math.min(0.05, (now - fxLast) / 1000);
  fxLast = now;
  fctx.setTransform(fxDpr, 0, 0, fxDpr, 0, 0);
  fctx.clearRect(0, 0, fxW, fxH);
  fctx.globalCompositeOperation = 'lighter';
  for (let i = fxRings.length - 1; i >= 0; i--) {
    const r = fxRings[i]; r.life -= dt;
    if (r.life <= 0) { fxRings.splice(i, 1); continue; }
    r.r += (r.maxR - 6) * (dt / r.max);
    const k = r.life / r.max;
    fctx.strokeStyle = `hsla(${r.hue},100%,62%,${0.5 * k})`;
    fctx.lineWidth = 1.4 * k + 0.3;
    fctx.beginPath(); fctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); fctx.stroke();
  }
  for (let i = fxFlashes.length - 1; i >= 0; i--) {
    const f = fxFlashes[i]; f.life -= dt;
    if (f.life <= 0) { fxFlashes.splice(i, 1); continue; }
    const k = f.life / f.max, rr = 18 + (1 - k) * 70;
    const g = fctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, rr);
    g.addColorStop(0, `hsla(${f.hue},100%,92%,${0.9 * k})`);
    g.addColorStop(0.4, `hsla(${f.hue},100%,66%,${0.5 * k})`);
    g.addColorStop(1, `hsla(${f.hue},100%,55%,0)`);
    fctx.fillStyle = g; fctx.beginPath(); fctx.arc(f.x, f.y, rr, 0, Math.PI * 2); fctx.fill();
  }
  for (let i = fxParts.length - 1; i >= 0; i--) {
    const p = fxParts[i];
    p.life -= dt; p.vy += FX_G * dt;
    const dr = 1 - FX_DRAG * dt; p.vx *= dr; p.vy *= dr;
    p.x += p.vx * dt; p.y += p.vy * dt;
    if (p.life <= 0 || p.y > fxH + 40) { fxParts.splice(i, 1); continue; }
    p.trail.push(p.x, p.y);
    if (p.trail.length > FX_TRAIL * 2) p.trail.splice(0, 2);
    const lr = p.life / p.max;
    if (p.trail.length >= 4) {
      fctx.strokeStyle = `hsla(${p.hue},100%,62%,${0.7 * lr})`;
      fctx.lineWidth = p.size * lr + 0.4; fctx.lineCap = 'round';
      fctx.beginPath(); fctx.moveTo(p.trail[0], p.trail[1]);
      for (let j = 2; j < p.trail.length; j += 2) fctx.lineTo(p.trail[j], p.trail[j + 1]);
      fctx.stroke();
    }
    p.rot += p.rotSpeed * dt;
    drawFxParticle(p, lr);
  }
  requestAnimationFrame(fxTick);
}
requestAnimationFrame(fxTick);


function syncFxCharRow() {
  const row = $('fxCharRow');
  if (row) row.hidden = !(fxShape === 'char' || fxShape === 'random');
  if ($('fxCharInput')) $('fxCharInput').value = fxChar;
}

function setFxShape(shape) {
  fxShape = shape;
  if ($('fxShapeGrid')) {
    document.querySelectorAll('#fxShapeGrid button').forEach((b) =>
      b.classList.toggle('active', b.dataset.fxshape === fxShape)
    );
  }
  syncFxCharRow();
}

function syncFxUI() {
  $('fxEnabled').checked = fxEnabled;
  const set = (id, v, dec) => { const el = $(id); if (el) { el.value = String(v); const lab = $(id + 'Val'); if (lab) lab.textContent = (+v).toFixed(dec == null ? 2 : dec); } };
  set('fxHeartSize', fxHeartSize, 2);
  set('fxDiamondSize', fxDiamondSize, 2);
  set('fxTextSize', fxTextSize, 2);
  set('fxHeartSpread', fxHeartSpread, 2);
  set('fxDiamondSpread', fxDiamondSpread, 2);
  set('fxTextSpread', fxTextSpread, 2);
  set('fxHeartDensity', fxHeartDensity, 0);
  set('fxDiamondDensity', fxDiamondDensity, 0);
  set('fxTextDensity', fxTextDensity, 0);
  syncFxCharRow();
}


/* ---------- 面板控制：烟花开关 / 大小 / 散开 / 密度 ---------- */
// 烟花形状切换
if ($('fxShapeGrid')) {
  $('fxShapeGrid').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-fxshape]');
    if (!button) return;
    fxShape = button.dataset.fxshape;
    document.querySelectorAll('#fxShapeGrid button').forEach((b) =>
      b.classList.toggle('active', b === button)
    );
    syncFxCharRow();
    saveConfig();
  });
}
if ($('fxCharInput')) {
  $('fxCharInput').addEventListener('input', (e) => {
    const v = e.target.value.slice(0, 4);
    e.target.value = v;
    fxChar = v.trim() || '❤';
    saveConfig();
  });
}


$('fxEnabled').addEventListener('change', (e) => {
  fxEnabled = e.target.checked;
  if (!fxEnabled) { fxParts = []; fxRings = []; fxFlashes = []; }
  saveConfig();
});
const bindFxNum = (id, setter, min, max, dec) => {
  const el = $(id);
  if (!el) return; // 元素缺失（如缓存了旧版 HTML）时跳过，避免拖垮整个脚本
  el.addEventListener('input', (e) => {
    const v = Math.min(max, Math.max(min, Number(e.target.value)));
    setter(v);
    const lab = $(id + 'Val'); if (lab) lab.textContent = (+v).toFixed(dec);
    saveConfig();
  });
};
bindFxNum('fxHeartSize', (v) => { fxHeartSize = v; }, FX_SHAPE_MIN, FX_SHAPE_MAX, 2);
bindFxNum('fxDiamondSize', (v) => { fxDiamondSize = v; }, FX_SHAPE_MIN, FX_SHAPE_MAX, 2);
bindFxNum('fxTextSize', (v) => { fxTextSize = v; }, FX_SHAPE_MIN, FX_SHAPE_MAX, 2);
bindFxNum('fxHeartSpread', (v) => { fxHeartSpread = v; }, FX_SPREAD_MIN, FX_SPREAD_MAX, 2);
bindFxNum('fxDiamondSpread', (v) => { fxDiamondSpread = v; }, FX_SPREAD_MIN, FX_SPREAD_MAX, 2);
bindFxNum('fxTextSpread', (v) => { fxTextSpread = v; }, FX_SPREAD_MIN, FX_SPREAD_MAX, 2);
bindFxNum('fxHeartDensity', (v) => { fxHeartDensity = Math.round(v); }, FX_DENSITY_MIN, FX_DENSITY_MAX, 0);
bindFxNum('fxDiamondDensity', (v) => { fxDiamondDensity = Math.round(v); }, FX_DENSITY_MIN, FX_DENSITY_MAX, 0);
bindFxNum('fxTextDensity', (v) => { fxTextDensity = Math.round(v); }, FX_DENSITY_MIN, FX_DENSITY_MAX, 0);

registerConfig({
  save: () => ({
    fireworks: fxEnabled,
    fxShape: fxShape,
    fxChar: fxChar,
    fxHeartSize: fxHeartSize,
    fxDiamondSize: fxDiamondSize,
    fxTextSize: fxTextSize,
    fxHeartSpread: fxHeartSpread,
    fxDiamondSpread: fxDiamondSpread,
    fxTextSpread: fxTextSpread,
    fxHeartDensity: fxHeartDensity,
    fxDiamondDensity: fxDiamondDensity,
    fxTextDensity: fxTextDensity,
  }),
  load: (cfg) => {
    if (cfg.fxShape) fxShape = cfg.fxShape;
    if (typeof cfg.fxChar === 'string' && cfg.fxChar.trim()) fxChar = cfg.fxChar.slice(0, 4);
    if (typeof cfg.fireworks === 'boolean') fxEnabled = cfg.fireworks;
    // 迁移旧版单一 fxShapeSize：存在且无新版分项时，作为三种形状的统一初始值
    if (typeof cfg.fxShapeSize === 'number' && cfg.fxHeartSize === undefined && cfg.fxDiamondSize === undefined && cfg.fxTextSize === undefined) {
      const v = Math.min(FX_SHAPE_MAX, Math.max(FX_SHAPE_MIN, cfg.fxShapeSize));
      fxHeartSize = fxDiamondSize = fxTextSize = v;
    }
    if (typeof cfg.fxHeartSize === 'number')
      fxHeartSize = Math.min(FX_SHAPE_MAX, Math.max(FX_SHAPE_MIN, cfg.fxHeartSize));
    if (typeof cfg.fxDiamondSize === 'number')
      fxDiamondSize = Math.min(FX_SHAPE_MAX, Math.max(FX_SHAPE_MIN, cfg.fxDiamondSize));
    if (typeof cfg.fxTextSize === 'number')
      fxTextSize = Math.min(FX_SHAPE_MAX, Math.max(FX_SHAPE_MIN, cfg.fxTextSize));
    if (typeof cfg.fxHeartSpread === 'number')
      fxHeartSpread = Math.min(FX_SPREAD_MAX, Math.max(FX_SPREAD_MIN, cfg.fxHeartSpread));
    if (typeof cfg.fxDiamondSpread === 'number')
      fxDiamondSpread = Math.min(FX_SPREAD_MAX, Math.max(FX_SPREAD_MIN, cfg.fxDiamondSpread));
    if (typeof cfg.fxTextSpread === 'number')
      fxTextSpread = Math.min(FX_SPREAD_MAX, Math.max(FX_SPREAD_MIN, cfg.fxTextSpread));
    if (typeof cfg.fxHeartDensity === 'number')
      fxHeartDensity = Math.round(Math.min(FX_DENSITY_MAX, Math.max(FX_DENSITY_MIN, cfg.fxHeartDensity)));
    if (typeof cfg.fxDiamondDensity === 'number')
      fxDiamondDensity = Math.round(Math.min(FX_DENSITY_MAX, Math.max(FX_DENSITY_MIN, cfg.fxDiamondDensity)));
    if (typeof cfg.fxTextDensity === 'number')
      fxTextDensity = Math.round(Math.min(FX_DENSITY_MAX, Math.max(FX_DENSITY_MIN, cfg.fxTextDensity)));
  },
});

window.__fxDebug = { getShape: () => fxShape, roll: resolveFxShape, bursts: () => fxBurstTotal };

export { fxEnabled, fxShape, fxChar, setFxShape, syncFxCharRow, FX_SHAPE_MIN, FX_SHAPE_MAX,
  FX_SPREAD_MIN, FX_SPREAD_MAX, FX_DENSITY_MIN, FX_DENSITY_MAX,
  fxKindSize, fxKindSpread, fxKindDensity, fxParticleRotSpeed,
  fxParts, fxRings, fxFlashes, fxW, fxH, FX_MAX_PT,
  addFxFlashRing, spawn2DBurst, syncFxUI, recordHeartHit };
