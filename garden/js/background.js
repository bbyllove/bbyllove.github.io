/* ================================================================
 * 背景：暮光渐变 / 浩瀚星空（星点 + 银河带 + 星云）/ 自定义图片
 * + 流星效果
 * ================================================================ */
import * as THREE from 'three';
import { $ } from './dom.js';
import { scene, renderer, camera } from './core.js';
import { saveConfig, registerConfig } from './config.js';
import { getPerfMeteorScale, getPerfStarScale } from './perf.js';
import { createGlowTexture } from './particles.js';

const bgState = {
  style: 'twilight', // 'twilight' 暮光渐变 | 'star' 浩瀚星空 | 'image' 自定义图片
  twilight: { base: '#170818', accent: '#ff3d6e' },
  star: { base: '#05070f', accent: '#8fb8ff' },
  image: { dataUrl: '', url: '', name: '', blur: 4, darken: 0.35, accent: '#ffd7e6' },
};

// 自定义图片背景的 dataUrl 上限（字符数）：超过则只在内存生效、不落盘
// （localStorage 约 5MB，留出其余配置的余量）
const MAX_BG_IMAGE_CHARS = 3200000;

// 图片背景层：DOM div 铺在 WebGL 画布之后，Canvas 透明（alpha:true）透出
const bgImageLayer = document.createElement('div');
bgImageLayer.id = 'bgImageLayer';
document.body.insertBefore(bgImageLayer, document.body.firstChild);

const starVertexShader = `
  attribute float aSize;
  attribute float aPhase;
  attribute float aSpeed;
  attribute float aMix;
  uniform float uTime;
  uniform float uPixelRatio;
  varying float vMix;
  varying float vTwinkle;
  void main() {
    vMix = aMix;
    vTwinkle = 0.55 + 0.45 * sin(uTime * aSpeed + aPhase);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio * (150.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const starFragmentShader = `
  uniform vec3 uTint;
  varying float vMix;
  varying float vTwinkle;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float alpha = smoothstep(0.5, 0.08, d);
    vec3 color = mix(vec3(1.0), uTint, vMix * 0.55);
    gl_FragColor = vec4(color, alpha * vTwinkle);
  }
`;

const starMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
    uTint: { value: new THREE.Color(bgState.star.accent) },
  },
  vertexShader: starVertexShader,
  fragmentShader: starFragmentShader,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
});

// 生成星空点云：band=false 均匀球面；band=true 沿倾斜银道面聚集
function createStarPoints(count, band) {
  const positions = new Float32Array(count * 3);
  const aSize = new Float32Array(count);
  const aPhase = new Float32Array(count);
  const aSpeed = new Float32Array(count);
  const aMix = new Float32Array(count);

  const bandNormal = new THREE.Vector3(0.35, 0.75, 0.55).normalize();
  const t1 = new THREE.Vector3(0, 1, 0).cross(bandNormal).normalize();
  const t2 = new THREE.Vector3().crossVectors(bandNormal, t1).normalize();

  for (let i = 0; i < count; i++) {
    const dir = new THREE.Vector3();
    if (band) {
      const theta = Math.random() * Math.PI * 2;
      const spread = (Math.random() + Math.random() + Math.random() - 1.5) * 0.3;
      dir.addScaledVector(t1, Math.cos(theta))
        .addScaledVector(t2, Math.sin(theta))
        .addScaledVector(bandNormal, spread)
        .normalize();
    } else {
      const y = Math.random() * 2 - 1;
      const phi = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.max(0, 1 - y * y));
      dir.set(rr * Math.cos(phi), y, rr * Math.sin(phi));
    }
    const dist = band ? 28 + Math.random() * 16 : 26 + Math.random() * 18;
    positions[i * 3] = dir.x * dist;
    positions[i * 3 + 1] = dir.y * dist;
    positions[i * 3 + 2] = dir.z * dist;
    aSize[i] = band ? 0.5 + Math.random() * 1.0 : 0.7 + Math.random() * 1.6;
    aPhase[i] = Math.random() * Math.PI * 2;
    aSpeed[i] = 0.4 + Math.random() * 1.6;
    aMix[i] = Math.random();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
  geometry.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
  geometry.setAttribute('aMix', new THREE.BufferAttribute(aMix, 1));
  const points = new THREE.Points(geometry, starMaterial);
  points.userData.count = count;
  return points;
}

const starGroup = new THREE.Group();
starGroup.add(createStarPoints(1500, false)); // 漫天散星
starGroup.add(createStarPoints(1300, true));  // 银河带

// 远处星云（大面积柔光团）
const nebulaSprites = [];
const nebulaGlowTex = createGlowTexture();
for (const [x, y, z, s, o] of [
  [-18, 8, -34, 46, 0.12],
  [22, -6, -30, 38, 0.09],
  [4, 16, -40, 54, 0.08],
]) {
  const spr = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: nebulaGlowTex,
      color: bgState.star.accent,
      transparent: true,
      opacity: o,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })
  );
  spr.position.set(x, y, z);
  spr.scale.set(s, s, 1);
  nebulaSprites.push(spr);
  starGroup.add(spr);
}

starGroup.visible = false;
scene.add(starGroup);

/* ---------- 画质联动：按当前档位数缩减星空点数（setDrawRange，无需重建） ---------- */
function applyStarDrawRange() {
  const s = getPerfStarScale();
  starGroup.children.forEach((c) => {
    if (c.isPoints && c.userData.count)
      c.geometry.setDrawRange(0, Math.floor(c.userData.count * s));
  });
}
window.addEventListener('heart-perf-change', applyStarDrawRange);
applyStarDrawRange();

/* ================================================================
 * 流星效果（发光拖尾面片 + 加色混合 + 轴朝向相机）—— 背景增强
 * 可调：密度 / 速度 / 长度 / 亮度
 * 渲染原理：每颗流星 = 一张沿运动方向拉伸、尽量面向相机的发光条带
 *   （轴 billboard：长边严格沿世界运动方向，面片法线尽量指向相机）；
 *   贴图为「头部高光 → 尾部透明」的柔边渐隐，配合 AdditiveBlending，
 *   比 1px 线条（WebGL 忽略 linewidth）更清晰、更接近真实流星拖尾。
 * ================================================================ */
const meteorParams = {
  density: 6,      // 同屏目标流星数（0 = 关闭）
  speed: 60,       // 移动速度（场景单位/秒）
  length: 16,      // 拖尾长度（场景单位）
  brightness: 1.0, // 亮度
};
const MAX_METEORS = 60;

const meteorGroup = new THREE.Group();
meteorGroup.visible = false;
scene.add(meteorGroup);
const _meteorColor = new THREE.Color();
const _meteorWhite = new THREE.Color(1, 1, 1);

// 流星拖尾贴图：水平 尾(透明)→头(高光)，垂直柔边高斯渐隐（白色，靠材质颜色着色）
function createMeteorTexture() {
  const W = 256, H = 32;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const data = img.data;
  const cy = (H - 1) * 0.5;
  for (let y = 0; y < H; y++) {
    const vy = (y - cy) / cy; // -1..1
    const vFall = Math.exp(-(vy * vy) * 2.2);
    for (let x = 0; x < W; x++) {
      const u = x / (W - 1); // 0(尾) .. 1(头)
      const along = Math.pow(u, 2.0); // 拖尾整体渐亮
      const headGlow = Math.exp(-Math.pow((u - 0.92) / 0.08, 2)); // 头部高光团
      const a = Math.min(1, along * 0.7 + headGlow * 0.85) * vFall;
      const i = (y * W + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const meteorTex = createMeteorTexture();
const meteorGeometry = new THREE.PlaneGeometry(1, 1); // 共享几何，按流星缩放/旋转
meteorGeometry.computeBoundingSphere();

const meteors = [];
for (let i = 0; i < MAX_METEORS; i++) {
  const mat = new THREE.MeshBasicMaterial({
    map: meteorTex,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    opacity: 0,
    color: 0xffffff,
    toneMapped: false, // 不走 ACES 调色，保持高光明亮
  });
  const mesh = new THREE.Mesh(meteorGeometry, mat);
  mesh.visible = false;
  mesh.frustumCulled = false; // 拖尾横跨视锥，按面片裁剪易闪烁，交给距离/寿命回收
  meteorGroup.add(mesh);
  meteors.push({
    mesh,
    material: mat,
    active: false,
    head: new THREE.Vector3(),
    dir: new THREE.Vector3(),
    life: 0,
    life0: 0,
    thickness: 0.6,
  });
}
let meteorSpawnAccum = 0;
const _tmpUp = new THREE.Vector3(0, 1, 0);
const _tmpTangent = new THREE.Vector3();
const _mDir = new THREE.Vector3();
const _mView = new THREE.Vector3();
const _mZ = new THREE.Vector3();
const _mY = new THREE.Vector3();
const _mBasis = new THREE.Matrix4();
const _mQuat = new THREE.Quaternion();

function spawnMeteor(m) {
  // 出生点：相机远侧上空的宽锥（约 75°，偏向锥心）内采样，确保多出现在可见天区
  const axis = new THREE.Vector3().copy(camera.position).normalize().negate();
  axis.y += 0.85; // 上抬，免得贴地平线
  axis.normalize();
  const bi = new THREE.Vector3();
  if (Math.abs(axis.y) < 0.99) bi.set(0, 1, 0).cross(axis).normalize();
  else bi.set(1, 0, 0).cross(axis).normalize();
  const ci = new THREE.Vector3().crossVectors(axis, bi).normalize();
  const maxAng = (75 * Math.PI) / 180;
  const cosT = 1 - Math.random() * (1 - Math.cos(maxAng));
  const sinT = Math.sqrt(Math.max(0, 1 - cosT * cosT));
  const ph = Math.random() * Math.PI * 2;
  const spawnDir = new THREE.Vector3()
    .copy(axis).multiplyScalar(cosT)
    .addScaledVector(bi, sinT * Math.cos(ph))
    .addScaledVector(ci, sinT * Math.sin(ph))
    .normalize();
  const R = 44 + Math.random() * 12; // 44~56
  m.head.copy(spawnDir).multiplyScalar(R);
  // 运动：位置的切线方向（沿天穹滑过）+ 下落偏置，使其像流星划落
  _tmpTangent.crossVectors(m.head, _tmpUp).normalize();
  if (_tmpTangent.lengthSq() < 0.001) _tmpTangent.set(1, 0, 0);
  m.dir.copy(_tmpTangent);
  if (Math.random() < 0.5) m.dir.negate(); // 左右随机
  m.dir.y -= 0.55 + Math.random() * 0.8;
  m.dir.normalize();
  m.life0 = 1.6 + Math.random() * 2.2;
  m.life = m.life0;
  m.thickness = 0.55 + Math.random() * 0.35;
  m.active = true;
  m.mesh.visible = true;
}

// 轴 billboard：长边(局部+X=头部)严格对齐世界运动方向；面片法线尽量朝相机
function orientMeteor(m, len, halfLen) {
  _mDir.copy(m.dir); // 单位
  _mView.copy(camera.position).sub(m.head).normalize(); // 头部→相机
  const dDotV = _mView.dot(_mDir);
  _mZ.copy(_mView).addScaledVector(_mDir, -dDotV); // 视线投到「⊥ dir」平面 = 面片法线
  if (_mZ.lengthSq() < 1e-4) {
    // 视线几乎平行于运动方向：取任意正交基兜底
    _mZ.set(_mDir.y, _mDir.z, _mDir.x).cross(_mDir).normalize();
  } else {
    _mZ.normalize();
  }
  _mY.crossVectors(_mZ, _mDir); // 右手系：x=dir, y, z
  _mBasis.makeBasis(_mDir, _mY, _mZ);
  _mQuat.setFromRotationMatrix(_mBasis);
  m.mesh.quaternion.copy(_mQuat);
  // 头部贴在几何 +X 端：网格中心 = head - dir*halfLen
  m.mesh.position.copy(m.head).addScaledVector(_mDir, -halfLen);
  m.mesh.scale.set(len, m.thickness, 1);
}

function updateMeteors(dt) {
  const activeTarget = Math.round(meteorParams.density * getPerfMeteorScale());

  // 流星颜色 = 当前背景点缀色，略偏白更像流星（亮度通过 opacity 控制）
  const accent = (bgState[bgState.style] && bgState[bgState.style].accent) || '#ffffff';
  _meteorColor.set(accent).lerp(_meteorWhite, 0.35);
  const tintR = _meteorColor.r, tintG = _meteorColor.g, tintB = _meteorColor.b;

  let active = 0;
  for (const m of meteors) if (m.active) active++;
  meteorGroup.visible = activeTarget > 0 || active > 0;

  // 投放节奏：density 越大越快补满；累计器避免一帧扎堆出现
  meteorSpawnAccum += dt * (activeTarget * 1.8);
  while (meteorSpawnAccum >= 1 && active < activeTarget) {
    meteorSpawnAccum -= 1;
    const m = meteors.find((x) => !x.active);
    if (!m) break;
    spawnMeteor(m);
    active++;
  }
  if (activeTarget === 0) meteorSpawnAccum = 0;

  const speed = meteorParams.speed;
  const len = Math.max(1, meteorParams.length);
  const halfLen = len * 0.5;
  const bright = meteorParams.brightness;

  for (const m of meteors) {
    if (!m.active) continue;
    m.head.addScaledVector(m.dir, speed * dt);
    m.life -= dt;
    const fadeIn = Math.min(1, (m.life0 - m.life) / 0.2); // 头部 0.2s 淡入
    const fadeOut = m.life < 0.6 ? Math.max(0, m.life / 0.6) : 1; // 末段淡出
    const burnFade = Math.min(fadeIn, fadeOut);
    orientMeteor(m, len, halfLen);
    m.material.opacity = bright * burnFade;
    m.material.color.setRGB(tintR, tintG, tintB);
    // 回收：飞出天穹范围（离中心过远/过近）或寿命耗尽
    const dist2 = m.head.lengthSq();
    if (dist2 > 78 * 78 || dist2 < 18 * 18 || m.life <= 0) {
      m.active = false;
      m.mesh.visible = false;
      m.material.opacity = 0;
    }
  }
}


/* ---------- 背景样式应用 ---------- */
function mixCssColor(hexA, hexB, t, alpha = 1) {
  const c = new THREE.Color(hexA).lerp(new THREE.Color(hexB), t);
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${alpha})`;
}

function buildBodyBackground(style, base, accent) {
  if (style === 'star') {
    return `radial-gradient(110% 75% at 50% 20%, ${mixCssColor(base, accent, 0.1)} 0%, ${base} 55%, ${mixCssColor(base, '#000000', 0.4)} 100%)`;
  }
  // 暮光渐变（默认，与原样式一致）
  return `radial-gradient(90% 60% at 50% 0%, ${mixCssColor(accent, accent, 0, 0.14)} 0%, transparent 60%), radial-gradient(120% 90% at 50% 30%, ${mixCssColor(base, accent, 0.1)} 0%, ${base} 48%, ${mixCssColor(base, '#000000', 0.5)} 100%)`;
}

function applyBackground() {
  const style = bgState.style;
  const isImage = style === 'image';

  // 自定义图片层
  const img = bgState.image;
  const imgSrc = img.dataUrl || img.url;
  const showImage = isImage && !!imgSrc;
  bgImageLayer.style.display = showImage ? 'block' : 'none';
  if (showImage) {
    bgImageLayer.style.backgroundImage = `url("${imgSrc}")`;
    bgImageLayer.style.filter =
      `blur(${img.blur}px) brightness(${Math.max(0.1, 1 - img.darken).toFixed(3)})`;
  }

  if (isImage) {
    // 有图时画布背景垫纯黑；未选图时退回暮光渐变避免白屏
    document.body.style.background = showImage
      ? '#000000'
      : buildBodyBackground('twilight', bgState.twilight.base, bgState.twilight.accent);
    starGroup.visible = false;
  } else {
    const cfg = bgState[style];
    document.body.style.background = buildBodyBackground(style, cfg.base, cfg.accent);
    starGroup.visible = style === 'star';
    starMaterial.uniforms.uTint.value.set(cfg.accent);
    for (const spr of nebulaSprites) spr.material.color.set(cfg.accent);
  }

  // 同步面板控件
  document
    .querySelectorAll('#bgStyleGrid button')
    .forEach((b) => b.classList.toggle('active', b.dataset.bg === style));
  if (isImage) {
    $('bgImageSub') && ($('bgImageSub').hidden = false);
    $('bgColorRows') && ($('bgColorRows').hidden = true);
  } else {
    $('bgImageSub') && ($('bgImageSub').hidden = true);
    $('bgColorRows') && ($('bgColorRows').hidden = false);
    const cfg = bgState[style];
    $('bgBase').value = cfg.base;
    $('bgAccent').value = cfg.accent;
    $('bgAccentLabel').textContent = style === 'star' ? '星光 / 星云色' : '点缀色';
  }
}


/* ---------- 星空 / 流星每帧更新 ---------- */
function updateStarfield(t) {
  if (starGroup.visible) {
    starMaterial.uniforms.uTime.value = t;
    starGroup.rotation.y = t * 0.004;
  }
}
function resetMeteorSpawn() {
  meteorSpawnAccum = 0;
}

/* ---------- 面板控制：背景风格 / 颜色 / 流星 ---------- */
// 背景风格与颜色
$('bgStyleGrid').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-bg]');
  if (!button) return;
  bgState.style = button.dataset.bg;
  applyBackground();
  saveConfig();
  // 点「自定义图片」且还没有图：自动弹出系统文件选择窗，选图即用
  if (button.dataset.bg === 'image' && !bgState.image.dataUrl) {
    $('bgImageFile') && $('bgImageFile').click();
  }
});
$('bgBase').addEventListener('input', (e) => {
  const cfg = bgState[bgState.style];
  if (!cfg || !('base' in cfg)) return;
  cfg.base = e.target.value;
  applyBackground();
  saveConfig();
});
$('bgAccent').addEventListener('input', (e) => {
  const cfg = bgState[bgState.style];
  if (!cfg || !('accent' in cfg)) return;
  cfg.accent = e.target.value;
  applyBackground();
  saveConfig();
});

/* ---------- 自定义图片背景：上传 / URL 导入压缩 / 清除 / 模糊 / 压暗 ---------- */
// 把已加载的 Image 元素压缩成 JPEG dataURL（上传 / URL 复用；跨域被污染时 toDataURL 抛 SecurityError）
function compressImageElement(img, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; // 透明图填黑，避免 JPEG 透明区变黑块突兀
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', quality);
}

// 逐级降采样压缩，直到 base64 长度可安全写入 localStorage
async function compressImageFile(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      try {
        resolve(compressImageElement(img, maxSide, quality));
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片加载失败'));
    };
    img.src = url;
  });
}

/* ---------- 直链模式：屏幕显示走 CSS（无需 CORS）；导出合成用 CORS 预载图，失败自动回退渐变 ---------- */
let bgCorsImage = null;
function tryPreloadCorsImage(url) {
  bgCorsImage = null;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => { if (bgState.image.url === url && !bgState.image.dataUrl) bgCorsImage = img; };
  img.onerror = () => { if (bgCorsImage === img) bgCorsImage = null; };
  img.src = url;
}
export function getBgCorsImage() { return bgCorsImage; }

/* ---------- 图片链接导入：优先 CORS 读取转存 dataURL；失败回退直链模式 ---------- */
function loadImageElement(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => {
      img.src = '';
      reject(new Error('加载超时'));
    }, timeoutMs || 12000);
    img.crossOrigin = 'anonymous'; // 需要服务器允许跨域，否则 onerror
    img.onload = () => { clearTimeout(timer); resolve(img); };
    img.onerror = () => { clearTimeout(timer); reject(new Error('链接加载失败或服务器拒绝跨域')); };
    img.src = url;
  });
}
async function handleBgImageUrl(urlText) {
  const hint = $('bgUrlHint');
  const setMsg = (msg) => { if (hint) hint.textContent = msg; };
  let url;
  try {
    const parsed = new URL(String(urlText).trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('scheme');
    url = parsed.href;
  } catch {
    setMsg('链接格式无效，请输入完整的 http(s) 地址');
    return;
  }
  setMsg('正在加载图片…');
  const prettyName = String(urlText).trim().slice(0, 40) || 'URL 图片';
  let img = null;
  try {
    img = await loadImageElement(url);
  } catch (err) {
    img = null; // 继续走直链模式兜底
  }
  let dataUrl = '';
  if (img) {
    try {
      for (const [maxSide, quality] of [[1920, 0.85], [1280, 0.8], [960, 0.72]]) {
        dataUrl = compressImageElement(img, maxSide, quality);
        if (dataUrl.length <= MAX_BG_IMAGE_CHARS) break;
      }
    } catch (err) {
      dataUrl = ''; // canvas 被跨域污染
    }
  }
  if (dataUrl) {
    // CORS 成功：转存 dataURL，导出 / 持久化全能力可用
    bgState.image.dataUrl = dataUrl;
    bgState.image.url = '';
    setMsg('已应用 ✓（已转存，导出与刷新均保留）');
  } else {
    // 直链模式：CSS 背景无需 CORS，屏幕显示正常；导出合成依赖 CORS 预载，失败自动回退渐变
    bgState.image.dataUrl = '';
    bgState.image.url = url;
    tryPreloadCorsImage(url);
    setMsg('已应用 ✓（直链模式：该链接不支持跨域转存，导出时若仍不允许 CORS 将自动回退渐变背景）');
  }
  bgState.image.name = prettyName;
  if (bgState.style !== 'image') bgState.style = 'image'; // 应用后自动切到图片背景
  applyBackground();
  syncBgImageUI();
  saveConfig();
}

async function handleBgImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  let dataUrl = '';
  try {
    for (const [maxSide, quality] of [[1920, 0.85], [1280, 0.8], [960, 0.72]]) {
      dataUrl = await compressImageFile(file, maxSide, quality);
      if (dataUrl.length <= MAX_BG_IMAGE_CHARS) break;
    }
  } catch (err) {
    console.warn('背景图片处理失败:', err);
    return;
  }
  bgState.image.dataUrl = dataUrl;
  bgState.image.url = '';
  bgCorsImage = null;
  bgState.image.name = file.name || '自定义图片';
  if (bgState.style !== 'image') bgState.style = 'image'; // 选图后自动切到图片背景
  applyBackground();
  syncBgImageUI();
  saveConfig();
}

function syncBgImageUI() {
  if (!$('bgImageSub')) return;
  const img = bgState.image;
  const nameEl = $('bgImageName');
  if (nameEl) {
    nameEl.textContent = img.dataUrl ? (img.name || '自定义图片') : (img.url ? (img.name || '链接图片') : '未选择');
    nameEl.title = img.name || '';
  }
  if ($('bgImageClear')) $('bgImageClear').disabled = !(img.dataUrl || img.url);
  if ($('bgImageBlur')) {
    $('bgImageBlur').value = img.blur;
    $('bgImageBlurVal').textContent = img.blur;
  }
  if ($('bgImageDarken')) {
    $('bgImageDarken').value = Math.round(img.darken * 100);
    $('bgImageDarkenVal').textContent = Math.round(img.darken * 100) + '%';
  }
}

if ($('bgImageFile')) {
  $('bgImageFile').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // 允许重选同一文件
    if (file) handleBgImageFile(file);
  });
}
if ($('bgUrlApply')) {
  const applyUrl = () => {
    const input = $('bgImageUrl');
    if (input && input.value.trim()) handleBgImageUrl(input.value);
  };
  $('bgUrlApply').addEventListener('click', applyUrl);
  if ($('bgImageUrl')) {
    $('bgImageUrl').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); applyUrl(); }
    });
  }
}
// 子面板里的「选择背景图…」按钮：弹系统文件选择窗
if ($('bgImagePick')) {
  $('bgImagePick').addEventListener('click', () => {
    if ($('bgImageFile')) $('bgImageFile').click();
  });
}
if ($('bgImageClear')) {
  $('bgImageClear').addEventListener('click', () => {
    bgState.image.dataUrl = '';
    bgState.image.url = '';
    bgCorsImage = null;
    bgState.image.name = '';
    applyBackground();
    syncBgImageUI();
    saveConfig();
  });
}
if ($('bgImageBlur')) {
  $('bgImageBlur').addEventListener('input', (e) => {
    bgState.image.blur = Number(e.target.value);
    $('bgImageBlurVal').textContent = bgState.image.blur;
    applyBackground();
    saveConfig();
  });
}
if ($('bgImageDarken')) {
  $('bgImageDarken').addEventListener('input', (e) => {
    bgState.image.darken = Number(e.target.value) / 100;
    $('bgImageDarkenVal').textContent = e.target.value + '%';
    applyBackground();
    saveConfig();
  });
}

// 流星效果控件（密度 / 速度 / 长度 / 亮度）
function syncMeteorUI() {
  $('meteorDensity').value = meteorParams.density;
  $('meteorDensityVal').textContent = meteorParams.density;
  $('meteorSpeed').value = meteorParams.speed;
  $('meteorSpeedVal').textContent = meteorParams.speed.toFixed(0);
  $('meteorLength').value = meteorParams.length;
  $('meteorLengthVal').textContent = meteorParams.length.toFixed(0);
  $('meteorBrightness').value = meteorParams.brightness;
  $('meteorBrightnessVal').textContent = meteorParams.brightness.toFixed(2);
}
$('meteorDensity').addEventListener('input', (e) => {
  meteorParams.density = Number(e.target.value);
  $('meteorDensityVal').textContent = meteorParams.density;
  if (meteorParams.density === 0) meteorSpawnAccum = 0;
  saveConfig();
});
$('meteorSpeed').addEventListener('input', (e) => {
  meteorParams.speed = Number(e.target.value);
  $('meteorSpeedVal').textContent = meteorParams.speed.toFixed(0);
  saveConfig();
});
$('meteorLength').addEventListener('input', (e) => {
  meteorParams.length = Number(e.target.value);
  $('meteorLengthVal').textContent = meteorParams.length.toFixed(0);
  saveConfig();
});
$('meteorBrightness').addEventListener('input', (e) => {
  meteorParams.brightness = Number(e.target.value);
  $('meteorBrightnessVal').textContent = meteorParams.brightness.toFixed(2);
  saveConfig();
});


registerConfig({
  save: () => {
    // 图片 dataUrl 超大则不落盘（只在当前会话生效），避免撑爆 localStorage
    const image = { ...bgState.image };
    if (image.dataUrl.length > MAX_BG_IMAGE_CHARS) image.dataUrl = '';
    if (typeof image.url !== 'string' || image.url.length > 2048) image.url = '';
    return {
      background: {
        style: bgState.style,
        twilight: bgState.twilight,
        star: bgState.star,
        image,
      },
      meteor: meteorParams,
    };
  },
  load: (cfg) => {
    if (cfg.background) {
      if (cfg.background.twilight) Object.assign(bgState.twilight, cfg.background.twilight);
      if (cfg.background.star) Object.assign(bgState.star, cfg.background.star);
      if (cfg.background.image) {
        const img = cfg.background.image;
        if (typeof img.blur === 'number') bgState.image.blur = Math.min(20, Math.max(0, img.blur));
        if (typeof img.darken === 'number') bgState.image.darken = Math.min(0.8, Math.max(0, img.darken));
        if (typeof img.name === 'string') bgState.image.name = img.name;
        if (typeof img.dataUrl === 'string' && img.dataUrl.startsWith('data:image/')) {
          bgState.image.dataUrl = img.dataUrl;
        }
        if (typeof img.url === 'string' && /^https?:\/\//.test(img.url)) {
          bgState.image.url = img.url;
          if (!bgState.image.dataUrl) tryPreloadCorsImage(img.url);
        }
      }
      if (['twilight', 'star', 'image'].includes(cfg.background.style)) {
        bgState.style = cfg.background.style;
      }
    }
    if (cfg.meteor) {
      if (typeof cfg.meteor.density === 'number')
        meteorParams.density = Math.min(40, Math.max(0, Math.round(cfg.meteor.density)));
      if (typeof cfg.meteor.speed === 'number')
        meteorParams.speed = Math.min(140, Math.max(10, cfg.meteor.speed));
      if (typeof cfg.meteor.length === 'number')
        meteorParams.length = Math.min(40, Math.max(3, cfg.meteor.length));
      if (typeof cfg.meteor.brightness === 'number')
        meteorParams.brightness = Math.min(2, Math.max(0.2, cfg.meteor.brightness));
    }
  },
});

export { bgState, applyBackground, meteorParams, syncMeteorUI, syncBgImageUI,
  updateMeteors, updateStarfield, resetMeteorSpawn };
