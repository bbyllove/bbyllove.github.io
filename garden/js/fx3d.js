/* ================================================================
 * 点击烟花：3D 形状粒子（小爱心 / 小钻石 / 小文字）
 * + 点击判定（命中分类 → 对应烟花）+ 点击音 / 音效预创建
 * ================================================================ */
import * as THREE from 'three';
import { $ } from './dom.js';
import { scene, camera } from './core.js';
import { heart, currentShape, createExtrudedHeartGeometry, createDiamondGeometry } from './heart.js';
import { topTextMesh, bottomTextMesh, buildTextGeometry, FONT_LIST, onTextRebuild, textState } from './text3d.js';
import {
  fxEnabled, fxKindSize, fxKindSpread, fxKindDensity, fxParticleRotSpeed,
  addFxFlashRing, spawn2DBurst, recordHeartHit, fxW, fxH,
} from './fx2d.js';
import { ensureSoundCtx, soundParams, sfxClick, sfxFirework } from './sfx.js';

/* ---------- 命中分类：把点击点映射到 爱心/钻石 / 上文字 / 下文字 / 背景 ---------- */
const _fxBox = new THREE.Box3();
const _fxV = new THREE.Vector3();
function fxScreenBox(obj) {
  if (!obj || !obj.geometry) return null;
  if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
  obj.updateWorldMatrix(true, false);
  _fxBox.setFromObject(obj);
  if (_fxBox.isEmpty()) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < 8; i++) {
    _fxV.set(i & 1 ? _fxBox.max.x : _fxBox.min.x, i & 2 ? _fxBox.max.y : _fxBox.min.y, i & 4 ? _fxBox.max.z : _fxBox.min.z);
    _fxV.project(camera);
    const sx = (_fxV.x * 0.5 + 0.5) * fxW;
    const sy = (-_fxV.y * 0.5 + 0.5) * fxH;
    if (sx < minX) minX = sx; if (sx > maxX) maxX = sx;
    if (sy < minY) minY = sy; if (sy > maxY) maxY = sy;
  }
  return { minX, minY, maxX, maxY };
}
function _inFxBox(cx, cy, b, pad) {
  return cx >= b.minX - pad && cx <= b.maxX + pad && cy >= b.minY - pad && cy <= b.maxY + pad;
}
function fxClassify(cx, cy) {
  const pad = 16;
  if (textState && textState.top && textState.top.text && topTextMesh) {
    const b = fxScreenBox(topTextMesh);
    if (b && _inFxBox(cx, cy, b, pad)) return { kind: 'text', text: textState.top.text, slot: 'top' };
  }
  if (textState && textState.bottom && textState.bottom.text && bottomTextMesh) {
    const b = fxScreenBox(bottomTextMesh);
    if (b && _inFxBox(cx, cy, b, pad)) return { kind: 'text', text: textState.bottom.text, slot: 'bottom' };
  }
  if (heart) {
    const b = fxScreenBox(heart);
    if (b && _inFxBox(cx, cy, b, pad)) return { kind: currentShape === 'diamond' ? 'diamond' : 'heart' };
  }
  return { kind: 'round' };
}

/* ---------- 3D 形状烟花：小爱心 / 小钻石 / 小文字 ---------- */
const fx3DGroup = new THREE.Group();
fx3DGroup.visible = false;
scene.add(fx3DGroup);
let _fxHeartGeo = null;
let _fxDiamondGeo = null;
const _fxTextGeoCache = new Map();
// 大字重建时清掉小字烟花几何缓存（经钩子订阅，避免循环依赖）
onTextRebuild(() => _fxTextGeoCache.clear());
const FX3D_UNIT = { heart: 1.55, diamond: 1.55, text: 1.0 };
const FX3D_BASE = { heart: 0.18, diamond: 0.18, text: 0.55 };
function fxGetGeo(kind, text, fontIndex) {
  if (kind === 'heart') { if (!_fxHeartGeo) _fxHeartGeo = createExtrudedHeartGeometry(); return _fxHeartGeo; }
  if (kind === 'diamond') { if (!_fxDiamondGeo) _fxDiamondGeo = createDiamondGeometry(); return _fxDiamondGeo; }
  if (kind === 'text') {
    const key = text + '|' + fontIndex;
    if (_fxTextGeoCache.has(key)) return _fxTextGeoCache.get(key);
    let g = null;
    try { g = buildTextGeometry(text, FONT_LIST[fontIndex].stack, 1.0); } catch (e) { g = null; }
    _fxTextGeoCache.set(key, g);
    return g;
  }
  return null;
}
const FX3D_MAX = 240;
const _fx3DPool = [];
function _fxMakeParticle() {
  const mat = new THREE.MeshStandardMaterial({
    transparent: true, metalness: 0.35, roughness: 0.28, emissiveIntensity: 0.9,
  });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.visible = false; mesh.frustumCulled = false;
  fx3DGroup.add(mesh);
  return { mesh, mat, vel: new THREE.Vector3(), angVel: new THREE.Vector3(), rot: new THREE.Euler(), life: 0, max: 0, base: 0, unit: 1, active: false, kind: 'round' };
}
for (let i = 0; i < FX3D_MAX; i++) _fx3DPool.push(_fxMakeParticle());
function _fxAcquire() {
  for (const p of _fx3DPool) if (!p.active) return p;
  let best = _fx3DPool[0];
  for (const p of _fx3DPool) if (p.life < best.life) best = p;
  return best;
}
function fxClear3D() {
  for (const p of _fx3DPool) { if (p.active) { p.active = false; p.mesh.visible = false; p.mat.opacity = 0; } }
  fx3DGroup.visible = false;
}

const _fxRay3 = new THREE.Raycaster();
const _fxPlane3 = new THREE.Plane();
const _fxCamDir = new THREE.Vector3();
const _fxObjPos = new THREE.Vector3();
function fxOriginAt(obj, cx, cy) {
  obj.getWorldPosition(_fxObjPos);
  camera.getWorldDirection(_fxCamDir);
  _fxPlane3.setFromNormalAndCoplanarPoint(_fxCamDir, _fxObjPos);
  _fxRay3.setFromCamera({ x: (cx / window.innerWidth) * 2 - 1, y: -(cy / window.innerHeight) * 2 + 1 }, camera);
  const hit = _fxRay3.ray.intersectPlane(_fxPlane3, new THREE.Vector3());
  return hit ? hit.clone() : _fxObjPos.clone();
}
function _fxRandUnit(out) {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
  return out.set(r * Math.cos(a), u, r * Math.sin(a));
}
const _fxSpawnDir = new THREE.Vector3();
const _fxQuat = new THREE.Quaternion();
function _fxSpawn3D(cls, cx, cy) {
  const kind = cls.kind; const text = cls.text || ''; const slot = cls.slot;
  const fontIndex = kind === 'text' ? (slot === 'top' ? textState.top.fontIndex : textState.bottom.fontIndex) : 0;
  const geo = fxGetGeo(kind, text, fontIndex);
  if (!geo) return;
  const obj = kind === 'text' ? (slot === 'top' ? topTextMesh : bottomTextMesh) : heart;
  const origin = fxOriginAt(obj, cx, cy);
  const hue = Math.random() * 360;
  const hueSpread = kind === 'text' ? 24 : 46;
  const N = Math.max(1, Math.round(fxKindDensity(kind)));
  const spreadMul = fxKindSpread(kind);
  const base = FX3D_BASE[kind], unit = FX3D_UNIT[kind];
  for (let i = 0; i < N; i++) {
    const p = _fxAcquire();
    p.kind = kind; p.active = true; p.mesh.visible = true; p.mesh.geometry = geo;
    _fxRandUnit(_fxSpawnDir);
    const spdBase = kind === 'text' ? (0.6 + Math.random() * 1.4) : (1.2 + Math.random() * 2.6);
    const spd = spdBase * spreadMul;
    p.vel.copy(_fxSpawnDir).multiplyScalar(spd);
    p.life = p.max = kind === 'text' ? (1.4 + Math.random() * 1.1) : (1.3 + Math.random() * 1.6);
    p.mesh.position.copy(origin);
    p.rot.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
    p.angVel.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
    p.base = base; p.unit = unit;
    const h = hue + (Math.random() - 0.5) * hueSpread;
    const col = new THREE.Color().setHSL(h / 360, 1, 0.6);
    p.mat.color.copy(col); p.mat.emissive.copy(col);
  }
}
const FX3D_G = -3.2, FX3D_DRAG = 0.6;
function updateFireworks3D(dt) {
  if (!fxEnabled) { fx3DGroup.visible = false; return; }
  let any = false;
  for (const p of _fx3DPool) {
    if (!p.active) continue;
    any = true;
    p.life -= dt;
    if (p.life <= 0) { p.active = false; p.mesh.visible = false; p.mat.opacity = 0; continue; }
    p.vel.y += FX3D_G * dt;
    p.vel.multiplyScalar(1 - FX3D_DRAG * dt);
    p.mesh.position.addScaledVector(p.vel, dt);
    p.rot.x += p.angVel.x * dt; p.rot.y += p.angVel.y * dt; p.rot.z += p.angVel.z * dt;
    _fxQuat.setFromEuler(p.rot); p.mesh.quaternion.copy(_fxQuat);
    const fadeIn = Math.min(1, (p.max - p.life) / 0.15);
    const fadeOut = p.life < 0.6 ? Math.max(0, p.life / 0.6) : 1;
    const fade = Math.min(fadeIn, fadeOut);
    p.mesh.scale.setScalar((p.base * fxKindSize(p.kind)) / p.unit);
    p.mat.opacity = fade;
  }
  fx3DGroup.visible = any;
}

function spawnFirework(cx, cy, cls) {
  sfxFirework();
  cls = cls || { kind: 'round' };
  if (cls.kind === 'round') { spawn2DBurst(cx, cy); return; }
  // 形状烟花：3D 粒子炸开 + 屏幕闪光 / 冲击环呼应起爆
  _fxSpawn3D(cls, cx, cy);
  addFxFlashRing(cx, cy, Math.random() * 360);
}

/* 触发判定：只对空白处的真正「点击」生效 ——
   拖拽旋转（位移>8px）、长按(>700ms)、点到 UI 控件上均不触发。
   移动端浏览器在屏幕边缘 / 系统手势区有时不会补发 click，
   因此触控/笔触直接在 pointerup 里结算；随后若又收到同点 click 则跳过，避免双爆。 */
let _fxDownX, _fxDownY, _fxDownT, _fxDownTarget = null, _fxTouchFiredAt = 0;
function isFxUITarget(target) {
  return !!(target && target.closest &&
    target.closest('#panel,#panelToggle,.hints,footer,.zoom-bar,header,#introSplash,button,input,select,label,a'));
}
function triggerFireworkAt(x, y, target) {
  if (!fxEnabled) return;
  if (document.body.classList.contains('gallery-open')) return; // 相册陈列室里不触发烟花
  if (isFxUITarget(target) || isFxUITarget(_fxDownTarget)) return;
  const fxKind = fxClassify(x, y);
  if (fxKind.kind === 'heart') recordHeartHit(x, y);
  if (fxKind.kind !== 'round') sfxClick(); // 点中爱心/钻石/文字
  spawnFirework(x, y, fxKind);
}
window.addEventListener(
  'pointerdown',
  (e) => {
    _fxDownX = e.clientX; _fxDownY = e.clientY; _fxDownT = performance.now();
    _fxDownTarget = e.target;
    if (soundParams.enabled) ensureSoundCtx(); // 用户手势内创建/恢复
  },
  { passive: true }
);
window.addEventListener(
  'pointerup',
  (e) => {
    if (e.pointerType === 'mouse' || _fxDownX === undefined) return;
    const moved = Math.hypot(e.clientX - _fxDownX, e.clientY - _fxDownY);
    if (moved > 8 || performance.now() - _fxDownT > 700) return;
    triggerFireworkAt(e.clientX, e.clientY, e.target);
    _fxTouchFiredAt = performance.now();
  },
  { passive: true }
);
window.addEventListener(
  'click',
  (e) => {
    if (_fxDownX === undefined) return;
    // 触控已在 pointerup 结算过：吞掉同点补发的 click，防止一次点击爆两朵。
    if (performance.now() - _fxTouchFiredAt < 500) return;
    if (Math.hypot(e.clientX - _fxDownX, e.clientY - _fxDownY) > 8) return;
    if (performance.now() - _fxDownT > 700) return;
    triggerFireworkAt(e.clientX, e.clientY, e.target);
  },
  { passive: true }
);


// 关闭烟花时同步清理 3D 粒子池（与 fx2d 的 2D 清理监听同一开关）
if ($('fxEnabled')) {
  $('fxEnabled').addEventListener('change', (e) => {
    if (!e.target.checked) fxClear3D();
  });
}

export { updateFireworks3D, spawnFirework, fxClear3D };
