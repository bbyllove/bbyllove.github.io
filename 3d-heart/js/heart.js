/* ================================================================
 * 爱心：几何体（经典/饱满/圆润立体/宝石/纤薄/钻石）+ 材质风格
 *      + 形状/圆润/钻石参数/材质风格 面板控制
 * ================================================================ */
import * as THREE from 'three';
import { MarchingCubes } from '../vendor/MarchingCubes.js';
import { $ } from './dom.js';
import { scene } from './core.js';
import { saveConfig, registerConfig } from './config.js';

/* ================================================================
 * 爱心几何体：多种形状
 * ================================================================ */

// 经典 2D 心形参数曲线轮廓
// x = 16 sin^3(t),  y = 13 cos(t) - 5 cos(2t) - 2 cos(3t) - cos(4t)
function heartOutlinePoints(segments = 160) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    points.push(new THREE.Vector2(x, y));
  }
  return points;
}

// 归一化到统一尺寸
function normalizeGeometry(geometry, targetRadius = 1.55) {
  geometry.center();
  geometry.computeBoundingSphere();
  const scale = targetRadius / geometry.boundingSphere.radius;
  geometry.scale(scale, scale, scale);
  return geometry;
}

// 挤出型爱心（前后平面的经典造型，可微调厚度/倒角）
function createExtrudedHeartGeometry(options) {
  const shape = new THREE.Shape(heartOutlinePoints());
  const geometry = new THREE.ExtrudeGeometry(
    shape,
    Object.assign(
      {
        depth: 7,
        steps: 1,
        bevelEnabled: true,
        bevelThickness: 4.5,
        bevelSize: 4.5,
        bevelSegments: 12,
        curveSegments: 32,
      },
      options
    )
  );
  geometry.computeVertexNormals();
  return normalizeGeometry(geometry);
}

// 饱满圆润的参数化立体爱心（气球/软糖质感，加厚加圆版）
// x = sin(u)^p · outlineX(v)
// y = sin(u)^p · outlineY(v)
// z = Z_SCALE · cos(u)
// 截面用 sin(u)^0.72 让侧面更接近球形；心形轮廓再向同参数椭圆
// 混合 25%，柔化顶部凹口与底部尖角，整体更圆鼓
let plumpRoundness = 0.5;

function createPlumpHeartGeometry() {
  const U = 110; // 沿厚度方向分段
  const V = 140; // 沿心形轮廓分段
  // 圆润程度 plumpRoundness ∈ [0,1]：越大越圆鼓（0.5 = 推荐形态）
  const r = plumpRoundness;
  const Z_SCALE = 7 + 8 * r;     // 前后鼓起的厚度
  const FULLNESS = 1 - 0.56 * r; // 截面饱满指数（越小越接近球体）
  const ROUND_BLEND = 0.5 * r;   // 轮廓向椭圆柔化的比例

  const positions = new Float32Array((U + 1) * (V + 1) * 3);
  const indices = [];

  let p = 0;
  for (let i = 0; i <= U; i++) {
    const u = (i / U) * Math.PI;
    const su = Math.pow(Math.sin(u), FULLNESS);
    const cu = Math.cos(u);
    for (let j = 0; j <= V; j++) {
      const v = (j / V) * Math.PI * 2;
      // 经典心形轮廓
      const hx = 15 * Math.sin(v) - 4 * Math.sin(3 * v);
      const hy =
        15 * Math.cos(v) -
        5 * Math.cos(2 * v) -
        2 * Math.cos(3 * v) -
        Math.cos(4 * v);
      // 同参数椭圆（极点与心形大致重合）
      const ex = 19 * Math.sin(v);
      const ey = -3.5 + 15.5 * Math.cos(v);
      // 向椭圆混合 → 凹口变浅、尖角变圆
      const ox = hx + (ex - hx) * ROUND_BLEND;
      const oy = hy + (ey - hy) * ROUND_BLEND;
      positions[p++] = su * ox;
      positions[p++] = su * oy;
      positions[p++] = Z_SCALE * cu;
    }
  }

  // 注意绕序：保证法线朝外
  for (let i = 0; i < U; i++) {
    for (let j = 0; j < V; j++) {
      const a = i * (V + 1) + j;
      const b = a + V + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return normalizeGeometry(geometry);
}

// 璀璨钻石（经典明亮式切割：八边形台面朝上 + 冠部 + 腰围 + 亭部收尖到底）
// 钻石可调参数：刻面数量 / 上下比例（冠部:亭部）/ 透明度 / 最大切面（台面）半径
const diamondParams = {
  facets: 16, ratio: 0.36, transparency: 1.0, table: 0.58, color: '#ffffff',
  dispersion: 0.05, envMap: 1.9, specular: 1.3, attenuation: 6, iridescence: 0.12,
};

function createDiamondGeometry() {
  const N = diamondParams.facets; // 主刻面数量
  const R = 1.0;                  // 腰围半径
  const TABLE_R = R * diamondParams.table; // 台面（最大切面）半径，占腰围半径比例
  const CROWN_H = 0.95 * diamondParams.ratio; // 冠部高度 = 上下比例 × 亭部深度
  const GIRDLE_H = 0.06;          // 腰围厚度
  const PAVILION_H = 0.95;        // 亭部深度（收尖）

  const positions = [];
  const tri = (a, b, c) =>
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);

  // 绕 Y 轴的 N 边形环（错开半格，让正面是一块完整刻面）
  const ring = (radius, y) => {
    const pts = [];
    for (let i = 0; i < N; i++) {
      const a = ((i + 0.5) / N) * Math.PI * 2;
      pts.push([Math.cos(a) * radius, y, Math.sin(a) * radius]);
    }
    return pts;
  };

  const girdleTop = ring(R, 0);
  const girdleLow = ring(R, -GIRDLE_H);
  const table = ring(TABLE_R, CROWN_H);
  const tableCenter = [0, CROWN_H, 0];
  const culet = [0, -GIRDLE_H - PAVILION_H, 0];

  for (let i = 0; i < N; i++) {
    const j = (i + 1) % N;
    // 冠部切面（腰围顶 → 台面边缘）
    tri(girdleTop[i], girdleTop[j], table[j]);
    tri(girdleTop[i], table[j], table[i]);
    // 腰围竖带
    tri(girdleTop[i], girdleLow[j], girdleTop[j]);
    tri(girdleTop[i], girdleLow[i], girdleLow[j]);
    // 亭部切面（腰围底 → 底尖）
    tri(girdleLow[i], girdleLow[j], culet);
    // 台面（扇形）
    tri(tableCenter, table[j], table[i]);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(positions), 3)
  );
  geometry.computeVertexNormals();
  return normalizeGeometry(geometry);
}

// 圆润立体（隐式曲面爱心）：心形隐式方程 (x²+9/4·y²+z²-1)³ - x²z³ - 9/80·y²z³ = 0
// 经 Marching Cubes 提取 + 焊接/拉普拉斯平滑/梯度投影/绕向修正，得前后饱满、全曲面封闭的爱心。
// 坐标：X 左右(瓣)、Z 上下(心尖朝下)、Y 厚度。移植自参考工程 3d_heart。
const MC_AX = 0.62, MC_AY = 0.58, MC_AZ = 0.72; // 世界←公式 各轴缩放（厚度调大更饱满）
function mcHeartField(x, y, z) {
  const a = x * x + 2.25 * y * y + z * z - 1;
  return a * a * a - x * x * z * z * z - 0.1125 * y * y * z * z * z;
}
function mcHeartGrad(x, y, z) {
  const a = x * x + 2.25 * y * y + z * z - 1;
  const a2 = 3 * a * a;
  return [
    a2 * 2 * x - 2 * x * z * z * z,
    a2 * 4.5 * y - 0.225 * y * z * z * z,
    a2 * 2 * z - 3 * x * x * z * z - 0.3375 * y * y * z * z,
  ];
}
function createMcHeartGeometry() {
  const res = 100;
  const mc = new MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 300000);
  const field = mc.field;
  const half = res / 2;
  for (let iz = 0; iz < res; iz++) {
    const fz = (iz - half) / half;
    for (let iy = 0; iy < res; iy++) {
      const fy = (iy - half) / half;
      const row = iz * res * res + iy * res;
      for (let ix = 0; ix < res; ix++) {
        const fx = (ix - half) / half;
        field[row + ix] = mcHeartField(fx / MC_AX, fz / MC_AZ, fy / MC_AY);
      }
    }
  }
  mc.isolation = 0;
  mc.update();
  if (mc.count === 0) throw new Error('心形曲面提取失败');
  // 焊接逐三角形重复顶点 → 索引几何，保证法线连续
  const n = mc.count, src = mc.positionArray;
  const weldMap = new Map(), posArr = [];
  const indexArr = new Uint32Array(n);
  const SCALE = 4096;
  for (let i = 0; i < n; i++) {
    const wx = src[i * 3], wy = src[i * 3 + 1], wz = src[i * 3 + 2];
    const key = Math.round(wx * SCALE) + ',' + Math.round(wy * SCALE) + ',' + Math.round(wz * SCALE);
    let idx = weldMap.get(key);
    if (idx === undefined) { idx = posArr.length / 3; weldMap.set(key, idx); posArr.push(wx, wy, wz); }
    indexArr[i] = idx;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(posArr), 3));
  geo.setIndex(new THREE.BufferAttribute(indexArr, 1));
  // 拉普拉斯平滑：消除 MC 台阶与薄片三角（随后投影会吸回曲面）
  const pArr = geo.attributes.position.array;
  const vertCount = posArr.length / 3;
  const adj = new Array(vertCount);
  for (let a = 0; a < vertCount; a++) adj[a] = [];
  for (let ti = 0; ti < indexArr.length; ti += 3) {
    const i0 = indexArr[ti], i1 = indexArr[ti + 1], i2 = indexArr[ti + 2];
    adj[i0].push(i1, i2); adj[i1].push(i0, i2); adj[i2].push(i0, i1);
  }
  const LAMBDA = 0.5;
  for (let sit = 0; sit < 2; sit++) {
    const newPos = new Float32Array(pArr);
    for (let va = 0; va < vertCount; va++) {
      const nbrs = adj[va];
      if (!nbrs.length) continue;
      let sx = 0, sy = 0, sz = 0;
      for (let nb = 0; nb < nbrs.length; nb++) { const j = nbrs[nb]; sx += pArr[j * 3]; sy += pArr[j * 3 + 1]; sz += pArr[j * 3 + 2]; }
      const inv = 1 / nbrs.length;
      newPos[va * 3] = pArr[va * 3] + LAMBDA * (sx * inv - pArr[va * 3]);
      newPos[va * 3 + 1] = pArr[va * 3 + 1] + LAMBDA * (sy * inv - pArr[va * 3 + 1]);
      newPos[va * 3 + 2] = pArr[va * 3 + 2] + LAMBDA * (sz * inv - pArr[va * 3 + 2]);
    }
    pArr.set(newPos);
  }
  // 曲面投影精修：沿解析梯度牛顿迭代，把顶点吸回隐式曲面
  const MAX_STEP = 1.2 / res;
  for (let v = 0; v < pArr.length; v += 3) {
    let hx = pArr[v] / MC_AX, hz = pArr[v + 1] / MC_AY, hy = pArr[v + 2] / MC_AZ;
    let bx = hx, by = hy, bz = hz;
    let bestF = Math.abs(mcHeartField(hx, hy, hz));
    for (let it = 0; it < 8; it++) {
      const fv = mcHeartField(hx, hy, hz);
      const gv = mcHeartGrad(hx, hy, hz);
      const g2 = gv[0] * gv[0] + gv[1] * gv[1] + gv[2] * gv[2];
      if (g2 < 1e-12) break;
      let step = fv / g2;
      const slen = Math.abs(step) * Math.sqrt(g2);
      if (slen > MAX_STEP) step = step * (MAX_STEP / slen);
      hx -= step * gv[0]; hy -= step * gv[1]; hz -= step * gv[2];
      const af = Math.abs(mcHeartField(hx, hy, hz));
      if (af < bestF) { bestF = af; bx = hx; by = hy; bz = hz; }
    }
    pArr[v] = bx * MC_AX;
    pArr[v + 1] = bz * MC_AY;
    pArr[v + 2] = by * MC_AZ;
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeVertexNormals();
  // 修正绕向：赤道折痕处偶有反向三角形（MC 歧义单元）呈黑斑；检测并翻转
  const pA = geo.attributes.position, nA = geo.attributes.normal, idxA = geo.index.array;
  let flipped = 0;
  for (let tf = 0; tf < idxA.length; tf += 3) {
    const ia2 = idxA[tf], ib2 = idxA[tf + 1], ic2 = idxA[tf + 2];
    const ax2 = pA.getX(ia2), ay2 = pA.getY(ia2), az2 = pA.getZ(ia2);
    const ex2 = pA.getX(ib2) - ax2, ey2 = pA.getY(ib2) - ay2, ez2 = pA.getZ(ib2) - az2;
    const fx2 = pA.getX(ic2) - ax2, fy2 = pA.getY(ic2) - ay2, fz2 = pA.getZ(ic2) - az2;
    const gnx = ey2 * fz2 - ez2 * fy2, gny = ez2 * fx2 - ex2 * fz2, gnz = ex2 * fy2 - ey2 * fx2;
    const gl = Math.sqrt(gnx * gnx + gny * gny + gnz * gnz);
    if (gl < 1e-12) continue;
    const snx = (nA.getX(ia2) + nA.getX(ib2) + nA.getX(ic2)) / 3;
    const sny = (nA.getY(ia2) + nA.getY(ib2) + nA.getY(ic2)) / 3;
    const snz = (nA.getZ(ia2) + nA.getZ(ib2) + nA.getZ(ic2)) / 3;
    if ((gnx * snx + gny * sny + gnz * snz) / gl < 0.2) { idxA[tf + 1] = ic2; idxA[tf + 2] = ib2; flipped++; }
  }
  if (flipped > 0) geo.index.needsUpdate = true;
  geo.computeVertexNormals();
  return normalizeGeometry(geo);
}

const HEART_SHAPES = {
  classic: {
    build: () => createExtrudedHeartGeometry(),
    flatShading: false,
  },
  plump: {
    build: () => createPlumpHeartGeometry(),
    flatShading: false,
  },
  mc: {
    build: () => createMcHeartGeometry(),
    flatShading: false,
  },
  gem: {
    build: () =>
      createExtrudedHeartGeometry({
        depth: 5,
        bevelThickness: 3,
        bevelSize: 3.2,
        bevelSegments: 2,
        curveSegments: 8,
      }),
    flatShading: true,
  },
  slim: {
    build: () =>
      createExtrudedHeartGeometry({
        depth: 2.2,
        bevelThickness: 1.5,
        bevelSize: 1.5,
        bevelSegments: 4,
        curveSegments: 24,
      }),
    flatShading: false,
  },
  diamond: {
    build: () => createDiamondGeometry(),
    flatShading: true,
    material: 'diamond', // 使用专用钻石材质（白色透明折射）
  },
};

const heartMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xff2d55,
  metalness: 0.05,
  roughness: 0.2,
  clearcoat: 1.0,
  clearcoatRoughness: 0.15,
  sheen: 0.5,
  sheenColor: 0xff8fab,
  envMapIntensity: 1.1,
});

// 爱心材质风格：柔软光泽 / 玻璃水晶 / 金属 / 陶瓷 / 果冻 / 荧光霓虹 / 磨砂哑光
let heartMaterialStyle = 'default';
const HEART_MATERIAL_STYLES = {
  default: { metalness: 0.05, roughness: 0.2, clearcoat: 1.0, clearcoatRoughness: 0.15, sheen: 0.5, envMapIntensity: 1.1, transmission: 0, ior: 1.5, thickness: 0, neon: false },
  glass:   { metalness: 0, roughness: 0.05, clearcoat: 1.0, clearcoatRoughness: 0.0, sheen: 0.2, envMapIntensity: 1.5, transmission: 0.9, ior: 1.5, thickness: 1.2, neon: false },
  metal:   { metalness: 1.0, roughness: 0.25, clearcoat: 0.6, clearcoatRoughness: 0.3, sheen: 0.0, envMapIntensity: 1.4, transmission: 0, ior: 1.5, thickness: 0, neon: false },
  ceramic: { metalness: 0.0, roughness: 0.35, clearcoat: 0.8, clearcoatRoughness: 0.2, sheen: 0.4, envMapIntensity: 0.9, transmission: 0, ior: 1.5, thickness: 0, neon: false },
  jelly:   { metalness: 0.0, roughness: 0.15, clearcoat: 1.0, clearcoatRoughness: 0.1, sheen: 0.9, envMapIntensity: 1.0, transmission: 0.45, ior: 1.33, thickness: 1.0, neon: false },
  neon:    { metalness: 0.0, roughness: 0.3, clearcoat: 0.4, clearcoatRoughness: 0.25, sheen: 0.3, envMapIntensity: 0.8, transmission: 0, ior: 1.5, thickness: 0, neon: true },
  matte:   { metalness: 0.0, roughness: 0.9, clearcoat: 0.0, clearcoatRoughness: 0.5, sheen: 0.2, envMapIntensity: 0.5, transmission: 0, ior: 1.5, thickness: 0, neon: false },
};

function applyHeartMaterialStyle(style) {
  const cfg = HEART_MATERIAL_STYLES[style] || HEART_MATERIAL_STYLES.default;
  heartMaterialStyle = style;
  heartMaterial.metalness = cfg.metalness;
  heartMaterial.roughness = cfg.roughness;
  heartMaterial.clearcoat = cfg.clearcoat;
  heartMaterial.clearcoatRoughness = cfg.clearcoatRoughness;
  heartMaterial.sheen = cfg.sheen;
  heartMaterial.envMapIntensity = cfg.envMapIntensity;
  heartMaterial.transmission = cfg.transmission;
  heartMaterial.ior = cfg.ior;
  heartMaterial.thickness = cfg.thickness;
  heartMaterial.transparent = cfg.transmission > 0;
  // 霓虹材质使用爱心颜色作为自发光；其他材质关闭自发光
  if (cfg.neon) {
    heartMaterial.emissive.copy(heartMaterial.color);
    heartMaterial.emissiveIntensity = 0.8;
  } else {
    heartMaterial.emissive.set(0x000000);
    heartMaterial.emissiveIntensity = 0;
  }
  heartMaterial.needsUpdate = true;
  document.querySelectorAll('#heartMaterialGrid button').forEach((b) =>
    b.classList.toggle('active', b.dataset.material === style)
  );
}

// 钻石材质：透明、强折射、色散火彩 + 微弱虹彩薄膜，晶莹剔透
const diamondMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0,
  roughness: 0,
  transmission: diamondParams.transparency, // 透射程度（透明度滑杆同步）
  ior: 2.33,             // 钻石折射率
  thickness: 1.4,        // 折射体积厚度
  dispersion: diamondParams.dispersion,   // 色散火彩（滑杆可调）
  attenuationColor: 0xffffff,
  attenuationDistance: diamondParams.attenuation, // 吸收距离（滑杆可调）
  clearcoat: 1.0,
  clearcoatRoughness: 0,
  envMapIntensity: diamondParams.envMap,    // 反光强度（滑杆可调）
  specularIntensity: diamondParams.specular, // 强光强度（滑杆可调）
  iridescence: diamondParams.iridescence,   // 虹彩薄膜（滑杆可调）
  iridescenceIOR: 1.6,
  flatShading: true,     // 切面平直着色
  side: THREE.DoubleSide,
});

// 应用钻石材质：颜色（基色向白色混合保持晶莹透亮，吸收色呈现彩钻深度渐变）
// + 色散 / 反光 / 强光 / 吸收距离 / 虹彩薄膜，全部由滑杆实时驱动
function applyDiamondMaterial() {
  const tint = new THREE.Color(diamondParams.color);
  diamondMaterial.color.copy(tint).lerp(new THREE.Color(0xffffff), 0.55);
  diamondMaterial.attenuationColor.copy(tint);
  diamondMaterial.dispersion = diamondParams.dispersion;
  diamondMaterial.envMapIntensity = diamondParams.envMap;
  diamondMaterial.specularIntensity = diamondParams.specular;
  diamondMaterial.attenuationDistance = diamondParams.attenuation;
  diamondMaterial.iridescence = diamondParams.iridescence;
  diamondMaterial.needsUpdate = true;
}

const heart = new THREE.Mesh(ensurePlanarUV(HEART_SHAPES.classic.build()), heartMaterial); // 初始形状也使用正面平面投影 UV，默认贴图 / 上传贴图都按同一口径贴满
heart.castShadow = true;

// 爱心 + 上下文字都挂在这个组里：心跳、摇摆、旋转视角时作为一个整体运动
const heartGroup = new THREE.Group();
heartGroup.add(heart);
scene.add(heartGroup);

let currentShape = 'classic';

/* ---------- 贴图用平面投影 UV：把 x/y 归一到 [0,1]，所有形状通用 ----------
 * （Extrude 原生 UV 是原始坐标、MarchingCubes 无 UV，统一重写保证贴图可用） */
function ensurePlanarUV(geometry) {
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const sx = bb.max.x - bb.min.x || 1;
  const sy = bb.max.y - bb.min.y || 1;
  const pos = geometry.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - bb.min.x) / sx;
    uv[i * 2 + 1] = (pos.getY(i) - bb.min.y) / sy;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

function setHeartShape(key) {
  const def = HEART_SHAPES[key];
  if (!def) return;
  currentShape = key;
  const oldGeometry = heart.geometry;
  heart.geometry = ensurePlanarUV(def.build());
  oldGeometry.dispose();
  if (def.material === 'diamond') {
    heart.material = diamondMaterial;
  } else {
    heart.material = heartMaterial;
    heartMaterial.flatShading = def.flatShading;
    heartMaterial.needsUpdate = true;
  }
  // 同步形状按钮的高亮状态
  document
    .querySelectorAll('#shapeGrid button')
    .forEach((b) => b.classList.toggle('active', b.dataset.shape === key));
  // 钻石固定为白色透明，切换形状时禁用/恢复爱心颜色选择
  const heartColorInput = document.getElementById('heartColor');
  if (heartColorInput) heartColorInput.disabled = def.material === 'diamond';
  shapeChangeListeners.forEach((fn) => fn(key));
  syncDiamondGroup();
  syncRoundnessRow();
}

/* 形状切换监听钩子（colors 模块据此同步跟随文字颜色，避免循环依赖） */
const shapeChangeListeners = [];
function onShapeChange(fn) {
  shapeChangeListeners.push(fn);
}

/* ================================================================
 * 地面阴影
 * ================================================================ */
const shadowPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(24, 24),
  new THREE.ShadowMaterial({ opacity: 0.32, color: 0x1a0510 })
);
shadowPlane.rotation.x = -Math.PI / 2;
shadowPlane.position.y = -3.4;
shadowPlane.receiveShadow = true;
scene.add(shadowPlane);


/* ---------- 面板控制：形状 / 颜色入口 / 圆润 / 钻石 / 材质风格 ---------- */
// 形状按钮
$('shapeGrid').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-shape]');
  if (!button) return;
  setHeartShape(button.dataset.shape);
  document
    .querySelectorAll('#shapeGrid button')
    .forEach((b) => b.classList.toggle('active', b === button));
  saveConfig();
});


// 圆润程度（仅“饱满圆润”形状生效）
function syncRoundnessRow() {
  const disabled = currentShape !== 'plump';
  $('roundnessRow').classList.toggle('disabled', disabled);
  $('roundness').disabled = disabled;
}

function syncRoundnessUI() {
  $('roundness').value = plumpRoundness;
  $('roundnessVal').textContent = Math.round(plumpRoundness * 100) + '%';
  syncRoundnessRow();
}

let roundnessTimer = 0;
$('roundnessRow').addEventListener('pointerdown', () => {
  if (currentShape !== 'plump') {
    setHeartShape('plump');
    saveConfig();
  }
});

$('roundness').addEventListener('input', (e) => {
  if (currentShape !== 'plump') {
    setHeartShape('plump');
  }
  plumpRoundness = Number(e.target.value);
  $('roundnessVal').textContent = Math.round(plumpRoundness * 100) + '%';
  clearTimeout(roundnessTimer);
  roundnessTimer = setTimeout(() => {
    if (currentShape === 'plump') setHeartShape('plump'); // 重建几何体
    saveConfig();
  }, 80);
});

// 钻石参数（仅“璀璨钻石”形状生效）
function syncDiamondGroup() {
  const disabled = currentShape !== 'diamond';
  $('diamondGroup').classList.toggle('disabled', disabled);
  // 切到钻石时自动展开该折叠组，方便直接调参
  if (!disabled && $('diamondGroup') && !$('diamondGroup').open) $('diamondGroup').open = true;
  // 钻石参数组紧跟「爱心形状与材质」组，选中钻石时把宿主组一并展开
  if (!disabled) {
    const hostGroup = document.querySelector('details[data-group="heartShape"]');
    if (hostGroup) hostGroup.open = true;
  }
  $('diamondFacets').disabled = disabled;
  $('diamondRatio').disabled = disabled;
  $('diamondTable').disabled = disabled;
  $('diamondTransparency').disabled = disabled;
  $('diamondColor').disabled = disabled;
  $('diamondDispersion').disabled = disabled;
  $('diamondEnv').disabled = disabled;
  $('diamondSpecular').disabled = disabled;
  $('diamondAttenuation').disabled = disabled;
  $('diamondIridescence').disabled = disabled;
  document
    .querySelectorAll('#diamondPresets button')
    .forEach((b) => (b.disabled = disabled));
}

function syncDiamondUI() {
  $('diamondFacets').value = diamondParams.facets;
  $('diamondFacetsVal').textContent = diamondParams.facets;
  $('diamondRatio').value = diamondParams.ratio;
  $('diamondRatioVal').textContent = diamondParams.ratio.toFixed(2);
  $('diamondTable').value = diamondParams.table;
  $('diamondTableVal').textContent = Math.round(diamondParams.table * 100) + '%';
  $('diamondColor').value = diamondParams.color;
  $('diamondDispersion').value = diamondParams.dispersion;
  $('diamondDispersionVal').textContent = diamondParams.dispersion.toFixed(3);
  $('diamondEnv').value = diamondParams.envMap;
  $('diamondEnvVal').textContent = diamondParams.envMap.toFixed(1);
  $('diamondSpecular').value = diamondParams.specular;
  $('diamondSpecularVal').textContent = diamondParams.specular.toFixed(2);
  $('diamondAttenuation').value = diamondParams.attenuation;
  $('diamondAttenuationVal').textContent = diamondParams.attenuation.toFixed(1);
  $('diamondIridescence').value = diamondParams.iridescence;
  $('diamondIridescenceVal').textContent =
    Math.round(diamondParams.iridescence * 100) + '%';
  applyDiamondMaterial();
  syncDiamondPresetUI();
  $('diamondTransparency').value = diamondParams.transparency;
  $('diamondTransparencyVal').textContent =
    Math.round(diamondParams.transparency * 100) + '%';
  diamondMaterial.transmission = diamondParams.transparency;
  diamondMaterial.needsUpdate = true;
  syncDiamondGroup();
}

let diamondGeomTimer = 0;
function scheduleDiamondRebuild() {
  clearTimeout(diamondGeomTimer);
  diamondGeomTimer = setTimeout(() => {
    if (currentShape === 'diamond') setHeartShape('diamond'); // 重建几何体
    saveConfig();
  }, 80);
}

$('diamondFacets').addEventListener('input', (e) => {
  diamondParams.facets = Number(e.target.value);
  $('diamondFacetsVal').textContent = diamondParams.facets;
  scheduleDiamondRebuild();
});
$('diamondRatio').addEventListener('input', (e) => {
  diamondParams.ratio = Number(e.target.value);
  $('diamondRatioVal').textContent = diamondParams.ratio.toFixed(2);
  scheduleDiamondRebuild();
});
$('diamondTable').addEventListener('input', (e) => {
  diamondParams.table = Number(e.target.value);
  $('diamondTableVal').textContent =
    Math.round(diamondParams.table * 100) + '%';
  scheduleDiamondRebuild();
});
$('diamondColor').addEventListener('input', (e) => {
  diamondParams.color = e.target.value;
  applyDiamondMaterial();
  syncDiamondPresetUI();
  saveConfig();
});

// 预设颜色按钮：纯白（冰透）/ 粉钻 / 蓝钻
function syncDiamondPresetUI() {
  document.querySelectorAll('#diamondPresets button').forEach((b) => {
    b.classList.toggle(
      'active',
      b.dataset.dcolor.toLowerCase() === diamondParams.color.toLowerCase()
    );
  });
}

// 爱心材质风格切换
if ($('heartMaterialGrid')) {
  $('heartMaterialGrid').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-material]');
    if (!button) return;
    applyHeartMaterialStyle(button.dataset.material);
    saveConfig();
  });
}

// 预设主题：一键切换形状 / 颜色 / 背景 / 粒子 / 烟花 / 材质 / 字体风格

$('diamondGroup').addEventListener('pointerdown', () => {
  if (currentShape !== 'diamond') {
    setHeartShape('diamond');
    saveConfig();
  }
});

$('diamondPresets').addEventListener('click', (e) => {
  const button = e.target.closest('button[data-dcolor]');
  if (!button) return;
  if (currentShape !== 'diamond') {
    setHeartShape('diamond');
  }
  diamondParams.color = button.dataset.dcolor;
  $('diamondColor').value = diamondParams.color;
  applyDiamondMaterial();
  syncDiamondPresetUI();
  saveConfig();
});

// 材质效果滑杆
$('diamondDispersion').addEventListener('input', (e) => {
  diamondParams.dispersion = Number(e.target.value);
  $('diamondDispersionVal').textContent = diamondParams.dispersion.toFixed(3);
  applyDiamondMaterial();
  saveConfig();
});
$('diamondEnv').addEventListener('input', (e) => {
  diamondParams.envMap = Number(e.target.value);
  $('diamondEnvVal').textContent = diamondParams.envMap.toFixed(1);
  applyDiamondMaterial();
  saveConfig();
});
$('diamondSpecular').addEventListener('input', (e) => {
  diamondParams.specular = Number(e.target.value);
  $('diamondSpecularVal').textContent = diamondParams.specular.toFixed(2);
  applyDiamondMaterial();
  saveConfig();
});
$('diamondAttenuation').addEventListener('input', (e) => {
  diamondParams.attenuation = Number(e.target.value);
  $('diamondAttenuationVal').textContent = diamondParams.attenuation.toFixed(1);
  applyDiamondMaterial();
  saveConfig();
});
$('diamondIridescence').addEventListener('input', (e) => {
  diamondParams.iridescence = Number(e.target.value);
  $('diamondIridescenceVal').textContent =
    Math.round(diamondParams.iridescence * 100) + '%';
  applyDiamondMaterial();
  saveConfig();
});
$('diamondTransparency').addEventListener('input', (e) => {
  diamondParams.transparency = Number(e.target.value);
  $('diamondTransparencyVal').textContent =
    Math.round(diamondParams.transparency * 100) + '%';
  diamondMaterial.transmission = diamondParams.transparency;
  diamondMaterial.needsUpdate = true;
  saveConfig();
});


registerConfig({
  save: () => ({
    shape: currentShape,
    heartMaterialStyle: heartMaterialStyle,
    roundness: plumpRoundness,
    diamond: diamondParams,
  }),
  load: (cfg) => {
    if (typeof cfg.roundness === 'number') {
      plumpRoundness = Math.min(1, Math.max(0, cfg.roundness));
    }
    if (cfg.diamond) {
      if (typeof cfg.diamond.facets === 'number') {
        diamondParams.facets = Math.min(32, Math.max(6, Math.round(cfg.diamond.facets)));
      }
      if (typeof cfg.diamond.ratio === 'number') {
        diamondParams.ratio = Math.min(1.2, Math.max(0.15, cfg.diamond.ratio));
      }
      if (typeof cfg.diamond.table === 'number') {
        diamondParams.table = Math.min(0.85, Math.max(0.2, cfg.diamond.table));
      }
      if (typeof cfg.diamond.color === 'string' &&
          /^#[0-9a-fA-F]{6}$/.test(cfg.diamond.color)) {
        diamondParams.color = cfg.diamond.color;
      }
      if (typeof cfg.diamond.dispersion === 'number') {
        diamondParams.dispersion = Math.min(0.15, Math.max(0, cfg.diamond.dispersion));
      }
      if (typeof cfg.diamond.envMap === 'number') {
        diamondParams.envMap = Math.min(4, Math.max(0, cfg.diamond.envMap));
      }
      if (typeof cfg.diamond.specular === 'number') {
        diamondParams.specular = Math.min(3, Math.max(0, cfg.diamond.specular));
      }
      if (typeof cfg.diamond.attenuation === 'number') {
        diamondParams.attenuation = Math.min(10, Math.max(0.5, cfg.diamond.attenuation));
      }
      if (typeof cfg.diamond.iridescence === 'number') {
        diamondParams.iridescence = Math.min(1, Math.max(0, cfg.diamond.iridescence));
      }
      if (typeof cfg.diamond.transparency === 'number') {
        diamondParams.transparency = Math.min(1, Math.max(0, cfg.diamond.transparency));
      }
    }
    if (cfg.heartMaterialStyle && HEART_MATERIAL_STYLES[cfg.heartMaterialStyle]) {
      applyHeartMaterialStyle(cfg.heartMaterialStyle);
    }
    if (cfg.shape && HEART_SHAPES[cfg.shape]) {
      setHeartShape(cfg.shape);
      document
        .querySelectorAll('#shapeGrid button')
        .forEach((b) =>
          b.classList.toggle('active', b.dataset.shape === cfg.shape)
        );
    }
  },
});

export { createExtrudedHeartGeometry, createDiamondGeometry, onShapeChange, HEART_SHAPES, HEART_MATERIAL_STYLES, heartMaterial, heartMaterialStyle,
  heart, heartGroup, currentShape, setHeartShape, applyHeartMaterialStyle,
  diamondParams, diamondMaterial, applyDiamondMaterial, plumpRoundness,
  syncRoundnessUI, syncDiamondUI, syncDiamondPresetUI };
