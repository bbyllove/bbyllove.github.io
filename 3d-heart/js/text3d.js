/* ================================================================
 * 真·3D 立体文字：Canvas 绘制 → Marching Squares → 挤出几何
 * 含文字特效（发光/描边/浮动/入场）与文字面板控制
 * ================================================================ */
import * as THREE from 'three';
import { $ } from './dom.js';
import { heartGroup } from './heart.js';
import { saveConfig, registerConfig } from './config.js';
import { FONT_LIST } from './fonts.js';

/* 字体表已抽到 js/fonts.js 共用（相册台词轮播同样要用），此处再导出 */

/* ---------- Marching Squares 轮廓提取 ---------- */

// 在标量场上提取等值线闭环（含线性插值）
function extractLoops(field, gw, gh, iso) {
  const VOFF = gw * gh; // 垂直边 id 偏移
  const pointOf = new Map(); // 网格边 id -> 插值点 [x, y]
  const segments = [];       // [edgeIdA, edgeIdB]

  const getEdgePoint = (id) => {
    let pt = pointOf.get(id);
    if (pt) return pt;
    if (id < VOFF) {
      // 水平边：(x,y) -> (x+1,y)
      const y = Math.floor(id / gw);
      const x = id % gw;
      const v0 = field[y * gw + x];
      const v1 = field[y * gw + x + 1];
      const t = v1 === v0 ? 0.5 : (iso - v0) / (v1 - v0);
      pt = [x + t, y];
    } else {
      // 垂直边：(x,y) -> (x,y+1)
      const k = id - VOFF;
      const y = Math.floor(k / gw);
      const x = k % gw;
      const v0 = field[y * gw + x];
      const v1 = field[(y + 1) * gw + x];
      const t = v1 === v0 ? 0.5 : (iso - v0) / (v1 - v0);
      pt = [x, y + t];
    }
    pointOf.set(id, pt);
    return pt;
  };

  for (let y = 0; y < gh - 1; y++) {
    for (let x = 0; x < gw - 1; x++) {
      const v00 = field[y * gw + x];           // 左上
      const v10 = field[y * gw + x + 1];       // 右上
      const v11 = field[(y + 1) * gw + x + 1]; // 右下
      const v01 = field[(y + 1) * gw + x];     // 左下

      let idx = 0;
      if (v00 >= iso) idx |= 8;
      if (v10 >= iso) idx |= 4;
      if (v11 >= iso) idx |= 2;
      if (v01 >= iso) idx |= 1;
      if (idx === 0 || idx === 15) continue;

      // 四条边的 id：上 / 右 / 下 / 左
      const TOP = y * gw + x;
      const RIGHT = VOFF + y * gw + (x + 1);
      const BOTTOM = (y + 1) * gw + x;
      const LEFT = VOFF + y * gw + x;

      switch (idx) {
        case 1: case 14: segments.push([LEFT, BOTTOM]); break;
        case 2: case 13: segments.push([BOTTOM, RIGHT]); break;
        case 3: case 12: segments.push([LEFT, RIGHT]); break;
        case 4: case 11: segments.push([TOP, RIGHT]); break;
        case 6: case 9:  segments.push([TOP, BOTTOM]); break;
        case 7: case 8:  segments.push([TOP, LEFT]); break;
        case 5: { // 鞍点（TR + BL）
          const center = (v00 + v10 + v11 + v01) / 4;
          if (center >= iso) segments.push([TOP, LEFT], [RIGHT, BOTTOM]);
          else segments.push([TOP, RIGHT], [LEFT, BOTTOM]);
          break;
        }
        case 10: { // 鞍点（TL + BR）
          const center = (v00 + v10 + v11 + v01) / 4;
          if (center >= iso) segments.push([TOP, RIGHT], [LEFT, BOTTOM]);
          else segments.push([TOP, LEFT], [RIGHT, BOTTOM]);
          break;
        }
      }
    }
  }

  // 每个网格边恰好被两条线段共享 → 沿邻接关系串成闭环
  const adjacency = new Map();
  for (const [a, b] of segments) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }

  const used = new Set();
  const loops = [];
  for (const [a0, b0] of segments) {
    if (used.has(a0)) continue;
    const loop = [];
    let prev = a0;
    let cur = b0;
    used.add(a0);
    loop.push(a0);
    while (true) {
      loop.push(cur);
      used.add(cur);
      const neighbors = adjacency.get(cur);
      if (!neighbors || neighbors.length < 2) break;
      const next = neighbors[0] === prev ? neighbors[1] : neighbors[0];
      prev = cur;
      cur = next;
      if (cur === loop[0]) break;
      if (loop.length > segments.length + 2) break; // 保险
    }
    if (loop.length >= 3) {
      loops.push(loop.map((id) => getEdgePoint(id)));
    }
  }
  return loops;
}

/* ---------- 多边形工具 ---------- */

function signedArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  }
  return a / 2;
}

function pointInPolygon(pt, poly) {
  const [x, y] = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

// Douglas-Peucker 简化（闭环 → 以最右点为锚点转成开链）
function simplifyClosedLoop(points, tolerance) {
  const n = points.length;
  if (n < 8) return points;
  let anchor = 0;
  for (let i = 1; i < n; i++) {
    if (points[i][0] > points[anchor][0]) anchor = i;
  }
  const chain = points.slice(anchor).concat(points.slice(0, anchor));
  chain.push(chain[0]);

  const keep = new Uint8Array(chain.length);
  keep[0] = keep[chain.length - 1] = 1;
  const stack = [[0, chain.length - 1]];

  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = chain[a];
    const [bx, by] = chain[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let maxDist = 0;
    let index = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = chain[i];
      let dist;
      if (len2 === 0) {
        dist = Math.hypot(px - ax, py - ay);
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
        dist = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      }
      if (dist > maxDist) {
        maxDist = dist;
        index = i;
      }
    }
    if (maxDist > tolerance && index > 0) {
      keep[index] = 1;
      stack.push([a, index], [index, b]);
    }
  }

  const out = [];
  for (let i = 0; i < chain.length - 1; i++) {
    if (keep[i]) out.push(chain[i]);
  }
  return out;
}

// 把闭环数组组织成 THREE.Shape（外轮廓）+ holes（孔洞）
function loopsToShapes(loops) {
  const items = loops.map((pts) => ({
    pts,
    area: Math.abs(signedArea(pts)),
    depth: 0,
    shape: null,
  }));
  items.sort((p, q) => q.area - p.area);

  // 计算每个环被多少更大的环包含（深度）：偶数=实体，奇数=孔洞
  for (let i = 0; i < items.length; i++) {
    for (let j = 0; j < i; j++) {
      if (pointInPolygon(items[i].pts[0], items[j].pts)) items[i].depth++;
    }
  }

  const shapes = [];
  for (const item of items) {
    if (item.depth % 2 === 0) {
      const shape = new THREE.Shape(
        item.pts.map(([x, y]) => new THREE.Vector2(x, -y)) // canvas y 向下 → 翻转为 y 向上
      );
      item.shape = shape;
      shapes.push(shape);
    } else {
      // 挂在最小的直接父轮廓（深度小 1）下
      let parent = null;
      for (const cand of items) {
        if (cand === item || cand.depth !== item.depth - 1) continue;
        if (cand.area <= item.area) continue;
        if (!pointInPolygon(item.pts[0], cand.pts)) continue;
        if (!parent || cand.area < parent.area) parent = cand;
      }
      if (parent && parent.shape) {
        parent.shape.holes.push(
          new THREE.Path(item.pts.map(([x, y]) => new THREE.Vector2(x, -y)))
        );
      }
    }
  }
  return shapes;
}

/* ---------- 文字 → 三维几何体 ---------- */
// 文字描迹：canvas 栅格化 → 标量场 → 轮廓提取/简化 → shapes + 墨水包围盒（像素坐标，y 向下）
function traceTextShapes(text, fontStack) {
  const BASE = 160; // 追踪用字号（px）
  const measurer = document.createElement('canvas').getContext('2d');
  measurer.font = `700 ${BASE}px ${fontStack}`;
  const textWidth = Math.ceil(measurer.measureText(text).width);
  if (textWidth <= 0) return null;

  const pad = Math.ceil(BASE * 0.3);
  const w = textWidth + pad * 2;
  const h = Math.ceil(BASE * 1.5);

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.font = `700 ${BASE}px ${fontStack}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(text, w / 2, h / 2 + BASE * 0.03);

  const img = ctx.getImageData(0, 0, w, h);

  // 标量场（四周加 1px 零边界，保证闭环）
  const gw = w + 2;
  const gh = h + 2;
  const field = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      field[(y + 1) * gw + (x + 1)] = img.data[(y * w + x) * 4 + 3];
    }
  }

  const rawLoops = extractLoops(field, gw, gh, 128);
  if (!rawLoops.length) return null;

  // 简化 + 统计墨水包围盒
  const loops = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const loop of rawLoops) {
    const simplified = simplifyClosedLoop(loop, 0.8);
    if (simplified.length < 3) continue;
    if (Math.abs(signedArea(simplified)) < 6) continue; // 噪点小环
    loops.push(simplified);
    for (const [x, y] of simplified) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (!loops.length) return null;

  const shapes = loopsToShapes(loops);
  return { shapes, BASE, w, h, widthPx: textWidth, ink: { minX, minY, maxX, maxY } };
}

function extrudeShapes(shapes, heightPx) {
  return new THREE.ExtrudeGeometry(shapes, {
    depth: Math.max(heightPx * 0.35, 8), // 厚度 ≈ 字高的 35%
    steps: 1,
    bevelEnabled: true,
    bevelThickness: heightPx * 0.035,
    bevelSize: heightPx * 0.03,
    bevelSegments: 2,
    curveSegments: 1,
  });
}

function buildTextGeometry(text, fontStack, size) {
  const traced = traceTextShapes(text, fontStack);
  if (!traced) return null;
  const heightPx = Math.max(traced.ink.maxY - traced.ink.minY, 1);
  const geometry = extrudeShapes(traced.shapes, heightPx);
  geometry.center();
  const scale = size / heightPx; // 世界高度 = 用户设定值
  geometry.scale(scale, scale, scale);
  geometry.computeVertexNormals();
  return geometry;
}

// 逐字入场用：每个字符独立描迹挤出，按 advance 排版（整体布局与整行挤出一致）
// 返回 [{ geometry, x, y, ch }]，x/y 为字符墨水中心相对整行中心的偏移（已缩放到世界单位）
function buildCharGeometries(text, fontStack, size) {
  const chars = Array.from(text);
  if (!chars.length) return null;
  const BASE = 160;
  const measurer = document.createElement('canvas').getContext('2d');
  measurer.font = `700 ${BASE}px ${fontStack}`;
  const items = chars.map((ch) => ({
    ch,
    adv: measurer.measureText(ch).width,
    traced: ch.trim() ? traceTextShapes(ch, fontStack) : null,
  }));
  const totalAdv = items.reduce((sum, it) => sum + it.adv, 0);
  if (totalAdv <= 0) return null;

  let rowH = 0;
  for (const it of items) {
    if (it.traced) rowH = Math.max(rowH, it.traced.ink.maxY - it.traced.ink.minY);
  }
  if (rowH <= 0) return null;

  const scale = size / rowH;
  const depth = Math.max(rowH * 0.35, 8);
  const out = [];
  let cum = 0;
  for (const it of items) {
    if (it.traced && it.traced.shapes.length) {
      const { shapes, ink, w, h } = it.traced;
      const geometry = extrudeShapes(shapes, rowH);
      // 墨水中心（canvas 坐标；标量场带 1px 边界，故减 1）
      const cx = (ink.minX + ink.maxX) / 2 - 1;
      const cy = (ink.minY + ink.maxY) / 2 - 1;
      geometry.translate(-cx, cy, -depth / 2); // 平移为以墨水中心为原点
      geometry.scale(scale, scale, scale);
      geometry.computeVertexNormals();
      // 画笔锚点：textAlign=center / textBaseline=middle（+0.03em 微调）
      const penX = w / 2 - it.adv / 2;
      const baselineY = h / 2 + BASE * 0.03;
      const x = (cum + cx - penX - totalAdv / 2) * scale;
      const y = (baselineY - cy) * scale;
      out.push({ geometry, x, y, ch: it.ch, mesh: null, outlineMesh: null });
    }
    cum += it.adv;
  }
  return out.length ? out : null;
}

const textState = {
  top: { text: 'Sn', fontIndex: 8, size: 0.85 },
  bottom: { text: 'Dirk', fontIndex: 8, size: 0.6 },
  color: '#ff2d55',
};

const textMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xff2d55,
  emissive: 0xff2d55,
  emissiveIntensity: 0.28,
  metalness: 0.05,
  roughness: 0.32,
  clearcoat: 0.9,
  clearcoatRoughness: 0.25,
  envMapIntensity: 0.9,
});

/* ---------- 文字双色渐变（顶点色） ---------- */
const textGradient = {
  enabled: false,
  colorA: '#ff9ad5', // 起始色
  colorB: '#66d9ff', // 结束色
  direction: 'x',    // 'x' 横向 | 'y' 纵向
};
const gradientChangeListeners = [];
function onTextGradientChange(fn) {
  gradientChangeListeners.push(fn);
}
function isTextGradientEnabled() {
  return textGradient.enabled;
}

// 沿包围盒 x / y 轴在 colorA → colorB 之间插值，写入顶点色
function applyGradientAttribute(geometry) {
  if (!geometry || !geometry.attributes.position) return;
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const pos = geometry.attributes.position;
  const yAxis = textGradient.direction === 'y';
  const min = yAxis ? bb.min.y : bb.min.x;
  const span = Math.max(1e-6, (yAxis ? bb.max.y : bb.max.x) - min);
  const cA = new THREE.Color(textGradient.colorA);
  const cB = new THREE.Color(textGradient.colorB);
  const tmp = new THREE.Color();
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const v = yAxis ? pos.getY(i) : pos.getX(i);
    tmp.copy(cA).lerp(cB, (v - min) / span);
    colors[i * 3] = tmp.r;
    colors[i * 3 + 1] = tmp.g;
    colors[i * 3 + 2] = tmp.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// 渐变开 → 材质走顶点色（本色置白、自发光取中点）；关 → 还原单色
function applyTextGradientMaterial() {
  if (textGradient.enabled) {
    if (!textMaterial.vertexColors) {
      textMaterial.vertexColors = true;
      textMaterial.needsUpdate = true;
    }
    textMaterial.color.set(0xffffff);
    textMaterial.emissive
      .set(textGradient.colorA)
      .lerp(new THREE.Color(textGradient.colorB), 0.5);
  } else {
    if (textMaterial.vertexColors) {
      textMaterial.vertexColors = false;
      textMaterial.needsUpdate = true;
    }
    textMaterial.color.set(textState.color);
    textMaterial.emissive.set(textState.color);
  }
}

// 逐字模式：渐变沿整行包围盒展开（把每个字符的世界偏移计入坐标）
function applyRowGradientAttribute(chars) {
  if (!chars.length) return;
  const yAxis = textGradient.direction === 'y';
  let min = Infinity, max = -Infinity;
  for (const c of chars) {
    c.geometry.computeBoundingBox();
    const bb = c.geometry.boundingBox;
    if (yAxis) {
      min = Math.min(min, c.y + bb.min.y);
      max = Math.max(max, c.y + bb.max.y);
    } else {
      min = Math.min(min, c.x + bb.min.x);
      max = Math.max(max, c.x + bb.max.x);
    }
  }
  const span = Math.max(1e-6, max - min);
  const cA = new THREE.Color(textGradient.colorA);
  const cB = new THREE.Color(textGradient.colorB);
  const tmp = new THREE.Color();
  for (const c of chars) {
    const pos = c.geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const v = yAxis ? c.y + pos.getY(i) : c.x + pos.getX(i);
      tmp.copy(cA).lerp(cB, (v - min) / span);
      colors[i * 3] = tmp.r;
      colors[i * 3 + 1] = tmp.g;
      colors[i * 3 + 2] = tmp.b;
    }
    c.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }
}

// 重新给现有几何体上/卸渐变色 + 切材质 + 通知（颜色模块同步禁用态）
function refreshTextGradient() {
  if (textGradient.enabled) {
    for (const slot of ['top', 'bottom']) {
      const mesh = slot === 'top' ? topTextMesh : bottomTextMesh;
      if (slotCharData[slot].length) applyRowGradientAttribute(slotCharData[slot]);
      else if (mesh.geometry.attributes.position) applyGradientAttribute(mesh.geometry);
    }
  } else {
    if (topTextMesh.geometry.attributes.color) topTextMesh.geometry.deleteAttribute('color');
    if (bottomTextMesh.geometry.attributes.color) bottomTextMesh.geometry.deleteAttribute('color');
    for (const slot of ['top', 'bottom']) {
      for (const c of slotCharData[slot]) {
        if (c.geometry.attributes.color) c.geometry.deleteAttribute('color');
      }
    }
  }
  applyTextGradientMaterial();
  gradientChangeListeners.forEach((fn) => fn());
}

function syncTextGradientUI() {
  if ($('textGradientEnabled')) $('textGradientEnabled').checked = textGradient.enabled;
  if ($('textGradientA')) $('textGradientA').value = textGradient.colorA;
  if ($('textGradientB')) $('textGradientB').value = textGradient.colorB;
  if ($('textGradientDir')) {
    document.querySelectorAll('#textGradientDir button').forEach((b) =>
      b.classList.toggle('active', b.dataset.gdir === textGradient.direction)
    );
  }
}

// 文字特效参数：发光强度 / 描边强度 / 浮动幅度 / 入场动画
const textEffectParams = {
  glow: 0.28,
  outline: 0,
  float: 0,
  enter: true,
  gap: 1,          // 上下文字与爱心间距的倍率（行距）
  charEnter: false, // 逐字错峰入场
};
let topTextBaseY = 0, bottomTextBaseY = 0;
let topTextEnterAt = 0, bottomTextEnterAt = 0;

/* ---------- 文字网格（挂在 heartGroup，与爱心一起旋转/缩放/心跳） ---------- */
const topTextMesh = new THREE.Mesh(new THREE.BufferGeometry(), textMaterial);
const bottomTextMesh = new THREE.Mesh(new THREE.BufferGeometry(), textMaterial);
const outlineMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  transparent: true,
  opacity: 0,
  side: THREE.BackSide,
  depthWrite: false,
});
const topOutlineMesh = new THREE.Mesh(new THREE.BufferGeometry(), outlineMaterial);
const bottomOutlineMesh = new THREE.Mesh(new THREE.BufferGeometry(), outlineMaterial);
topOutlineMesh.renderOrder = -1;
bottomOutlineMesh.renderOrder = -1;
topTextMesh.add(topOutlineMesh);
bottomTextMesh.add(bottomOutlineMesh);
topTextMesh.castShadow = true;
bottomTextMesh.castShadow = true;
topTextMesh.visible = false;
bottomTextMesh.visible = false;
heartGroup.add(topTextMesh, bottomTextMesh);

/* ---------- 逐字模式管理（逐字入场开关打开时，文字拆成逐字子网格） ---------- */
const slotCharData = { top: [], bottom: [] }; // [{ geometry, x, y, mesh, outlineMesh }]
function clearCharMeshes(slot) {
  const parent = slot === 'top' ? topTextMesh : bottomTextMesh;
  for (const c of slotCharData[slot]) {
    parent.remove(c.mesh);
    c.geometry.dispose(); // 描边子网格共享同一份几何体，一并释放
  }
  slotCharData[slot] = [];
}

function applyTextOutline() {
  const o = textEffectParams.outline || 0;
  const outlineScale = 1 + o * 0.12;
  const show = o > 0;
  topOutlineMesh.scale.setScalar(outlineScale);
  bottomOutlineMesh.scale.setScalar(outlineScale);
  // 逐字模式下整行描边网格隐藏，改用逐字描边子网格
  topOutlineMesh.visible = show && slotCharData.top.length === 0;
  bottomOutlineMesh.visible = show && slotCharData.bottom.length === 0;
  outlineMaterial.opacity = o * 0.9;
  for (const slot of ['top', 'bottom']) {
    for (const c of slotCharData[slot]) {
      c.outlineMesh.scale.setScalar(outlineScale);
      c.outlineMesh.visible = show;
    }
  }
}

function syncTextEffectUI() {
  if ($('textGlow')) {
    $('textGlow').value = String(textEffectParams.glow);
    $('textGlowVal').textContent = textEffectParams.glow.toFixed(2);
  }
  if ($('textOutline')) {
    $('textOutline').value = String(textEffectParams.outline);
    $('textOutlineVal').textContent = Math.round(textEffectParams.outline * 100) + '%';
  }
  if ($('textFloat')) {
    $('textFloat').value = String(textEffectParams.float);
    $('textFloatVal').textContent = Math.round(textEffectParams.float * 100) + '%';
  }
  if ($('textEnter')) $('textEnter').checked = !!textEffectParams.enter;
  if ($('textGap')) {
    $('textGap').value = String(textEffectParams.gap);
    $('textGapVal').textContent = Math.round(textEffectParams.gap * 100) + '%';
  }
  if ($('textCharEnter')) $('textCharEnter').checked = !!textEffectParams.charEnter;
}

function rebuildText(slot) {
  const cfg = slot === 'top' ? textState.top : textState.bottom;
  const mesh = slot === 'top' ? topTextMesh : bottomTextMesh;
  const text = cfg.text.trim();
  clearCharMeshes(slot);
  if (!text) {
    mesh.visible = false;
    return;
  }
  if (textEffectParams.charEnter) {
    // 逐字模式：父网格保留为空锚点（供点击判定 / 烟花定位），文字拆成逐字子网格
    const chars = buildCharGeometries(text, FONT_LIST[cfg.fontIndex].stack, cfg.size);
    if (!chars) {
      mesh.visible = false;
      return;
    }
    mesh.geometry.dispose();
    mesh.geometry = new THREE.BufferGeometry();
    for (const c of chars) {
      const charMesh = new THREE.Mesh(c.geometry, textMaterial);
      charMesh.position.set(c.x, c.y, 0);
      charMesh.castShadow = true;
      // 描边使用同一份几何体，稍大并反向法线，渲染在文字背后作为轮廓
      const charOutline = new THREE.Mesh(c.geometry, outlineMaterial);
      charOutline.renderOrder = -1;
      charMesh.add(charOutline);
      mesh.add(charMesh);
      c.mesh = charMesh;
      c.outlineMesh = charOutline;
    }
    slotCharData[slot] = chars;
    if (textGradient.enabled) applyRowGradientAttribute(chars);
  } else {
    const geometry = buildTextGeometry(text, FONT_LIST[cfg.fontIndex].stack, cfg.size);
    if (!geometry) {
      mesh.visible = false;
      return;
    }
    mesh.geometry.dispose();
    mesh.geometry = geometry;
    if (textGradient.enabled) applyGradientAttribute(geometry);
    slotCharData[slot] = [];
  }
  // 描边网格始终与文字网格共用几何体（逐字模式下隐藏，见 applyTextOutline）
  topOutlineMesh.geometry = topTextMesh.geometry;
  bottomOutlineMesh.geometry = bottomTextMesh.geometry;
  // 随文字大小自动保持与爱心的间距，行距滑杆整体缩放
  const offset = (1.55 + cfg.size * 0.5) * textEffectParams.gap;
  if (slot === 'top') topTextBaseY = offset; else bottomTextBaseY = -offset;
  mesh.position.set(0, slot === 'top' ? offset : -offset, 0);
  mesh.visible = true;
  applyTextOutline();
  if (textEffectParams.enter) {
    const now = performance.now();
    if (slot === 'top') topTextEnterAt = now; else bottomTextEnterAt = now;
  } else if (slot === 'top') {
    topTextEnterAt = 0;
  } else {
    bottomTextEnterAt = 0;
  }
  // 大字变了，通知监听者（fx3d 会清掉小字烟花的几何缓存，下次点击时用新文字重建）
  textRebuildListeners.forEach((fn) => fn());
}

// 行距滑杆：不重建几何体，仅按当前文字大小重算上下基准高度（下一帧动画自动应用）
function applyTextOffsets() {
  const gap = textEffectParams.gap;
  if (textState.top.text.trim()) topTextBaseY = (1.55 + textState.top.size * 0.5) * gap;
  if (textState.bottom.text.trim()) bottomTextBaseY = -(1.55 + textState.bottom.size * 0.5) * gap;
}

/* 文字重建监听钩子（避免与 fx3d 循环依赖） */
const textRebuildListeners = [];
function onTextRebuild(fn) {
  textRebuildListeners.push(fn);
}

// 重建有开销（轮廓提取 + 挤出），输入时做防抖
const rebuildTimers = { top: 0, bottom: 0 };
function scheduleRebuild(slot, delay = 140) {
  clearTimeout(rebuildTimers[slot]);
  rebuildTimers[slot] = setTimeout(() => rebuildText(slot), delay);
}


/* ---------- 每帧文字动画：入场缩放淡入（含逐字错峰）+ 上下浮动 ---------- */
const CHAR_ENTER_STAGGER = 90; // 逐字入场：相邻字符间隔（ms）
// 计算某一行当前入场进度：逐字模式返回所有字符中最小进度并逐字缩放；整行模式返回整行进度
function slotEnterProgress(slot) {
  const enterAt = slot === 'top' ? topTextEnterAt : bottomTextEnterAt;
  const chars = slotCharData[slot];
  if (!textEffectParams.enter || !enterAt) {
    if (chars.length) {
      for (const c of chars) { c.mesh.scale.setScalar(1); c.mesh.visible = true; }
    }
    return 1;
  }
  const nowMs = performance.now();
  if (chars.length) {
    let min = 1;
    for (let i = 0; i < chars.length; i++) {
      const p = Math.min(1, Math.max(0, (nowMs - enterAt - i * CHAR_ENTER_STAGGER) / 800));
      chars[i].mesh.scale.setScalar(p);
      chars[i].mesh.visible = p > 0;
      if (p < min) min = p;
    }
    return min;
  }
  return Math.min(1, Math.max(0, (nowMs - enterAt) / 800));
}
function updateTextAnimation(animPhase) {
  const topChars = slotCharData.top.length > 0;
  const bottomChars = slotCharData.bottom.length > 0;
  const topEnter = slotEnterProgress('top');
  const bottomEnter = slotEnterProgress('bottom');
  // 逐字模式下由逐字子网格各自缩放，父网格保持 1
  topTextMesh.scale.setScalar(topChars ? 1 : topEnter);
  bottomTextMesh.scale.setScalar(bottomChars ? 1 : bottomEnter);
  const textOpacity = Math.min(topEnter, bottomEnter);
  textMaterial.transparent = textOpacity < 1 || textEffectParams.outline > 0;
  textMaterial.opacity = textOpacity;
  const floatAmp = textEffectParams.float * 0.35;
  if (floatAmp > 0) {
    topTextMesh.position.y = topTextBaseY + Math.sin(animPhase * 1.6) * floatAmp;
    bottomTextMesh.position.y = bottomTextBaseY + Math.sin(animPhase * 1.6 + Math.PI) * floatAmp;
  } else {
    topTextMesh.position.y = topTextBaseY;
    bottomTextMesh.position.y = bottomTextBaseY;
  }
}

/* ---------- 字体下拉框填充 + 文字控件绑定 ---------- */
function fillFontSelect(selectEl) {
  FONT_LIST.forEach((font, index) => {
    const option = document.createElement('option');
    option.value = index;
    option.textContent = font.name;
    option.style.fontFamily = font.stack;
    selectEl.appendChild(option);
  });
}
fillFontSelect($('topFont'));
fillFontSelect($('bottomFont'));

// 绑定文字控件
function bindTextControls(prefix, cfg, slot) {
  const textInput = $(`${prefix}Text`);
  const fontSelect = $(`${prefix}Font`);
  const sizeInput = $(`${prefix}Size`);
  const sizeVal = $(`${prefix}SizeVal`);

  textInput.value = cfg.text;
  fontSelect.value = cfg.fontIndex;
  sizeInput.value = cfg.size;
  sizeVal.textContent = Number(cfg.size).toFixed(2).replace(/0$/, '');

  textInput.addEventListener('input', () => {
    cfg.text = textInput.value;
    scheduleRebuild(slot);
    saveConfig();
  });
  fontSelect.addEventListener('change', () => {
    cfg.fontIndex = Number(fontSelect.value);
    scheduleRebuild(slot, 0);
    saveConfig();
  });
  sizeInput.addEventListener('input', () => {
    cfg.size = Number(sizeInput.value);
    sizeVal.textContent = cfg.size.toFixed(2).replace(/0$/, '');
    scheduleRebuild(slot, 60);
    saveConfig();
  });
}


/* ---------- 文字特效面板控制 ---------- */
// 文字特效控件
if ($('textGlow')) {
  $('textGlow').addEventListener('input', (e) => {
    textEffectParams.glow = Number(e.target.value);
    $('textGlowVal').textContent = textEffectParams.glow.toFixed(2);
    textMaterial.emissiveIntensity = textEffectParams.glow;
    saveConfig();
  });
}
if ($('textOutline')) {
  $('textOutline').addEventListener('input', (e) => {
    textEffectParams.outline = Number(e.target.value);
    $('textOutlineVal').textContent = Math.round(textEffectParams.outline * 100) + '%';
    applyTextOutline();
    saveConfig();
  });
}
if ($('textFloat')) {
  $('textFloat').addEventListener('input', (e) => {
    textEffectParams.float = Number(e.target.value);
    $('textFloatVal').textContent = Math.round(textEffectParams.float * 100) + '%';
    saveConfig();
  });
}
if ($('textEnter')) {
  $('textEnter').addEventListener('change', (e) => {
    textEffectParams.enter = e.target.checked;
    if (textEffectParams.enter) {
      rebuildText('top');
      rebuildText('bottom');
    }
    saveConfig();
  });
}
if ($('textGap')) {
  $('textGap').addEventListener('input', (e) => {
    textEffectParams.gap = Math.min(1.3, Math.max(0.7, Number(e.target.value)));
    $('textGapVal').textContent = Math.round(textEffectParams.gap * 100) + '%';
    applyTextOffsets();
    saveConfig();
  });
}
if ($('textCharEnter')) {
  $('textCharEnter').addEventListener('change', (e) => {
    textEffectParams.charEnter = e.target.checked;
    rebuildText('top');
    rebuildText('bottom');
    saveConfig();
  });
}

// 文字渐变色控件
if ($('textGradientEnabled')) {
  $('textGradientEnabled').addEventListener('change', (e) => {
    textGradient.enabled = e.target.checked;
    refreshTextGradient();
    saveConfig();
  });
}
if ($('textGradientA')) {
  $('textGradientA').addEventListener('input', (e) => {
    textGradient.colorA = e.target.value;
    refreshTextGradient();
    saveConfig();
  });
}
if ($('textGradientB')) {
  $('textGradientB').addEventListener('input', (e) => {
    textGradient.colorB = e.target.value;
    refreshTextGradient();
    saveConfig();
  });
}
if ($('textGradientDir')) {
  $('textGradientDir').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-gdir]');
    if (!button) return;
    textGradient.direction = button.dataset.gdir;
    refreshTextGradient();
    syncTextGradientUI();
    saveConfig();
  });
}


registerConfig({
  save: () => ({
    top: textState.top,
    bottom: textState.bottom,
    textEffect: textEffectParams,
    textGradient,
  }),
  load: (cfg) => {
    if (cfg.top) Object.assign(textState.top, cfg.top);
    if (cfg.bottom) Object.assign(textState.bottom, cfg.bottom);
    if (cfg.textGradient) {
      if (typeof cfg.textGradient.enabled === 'boolean') textGradient.enabled = cfg.textGradient.enabled;
      if (typeof cfg.textGradient.colorA === 'string') textGradient.colorA = cfg.textGradient.colorA;
      if (typeof cfg.textGradient.colorB === 'string') textGradient.colorB = cfg.textGradient.colorB;
      if (cfg.textGradient.direction === 'x' || cfg.textGradient.direction === 'y') {
        textGradient.direction = cfg.textGradient.direction;
      }
      // 几何体尚未生成（main 稍后才 rebuild），这里只切材质 + 通知监听者
      applyTextGradientMaterial();
      gradientChangeListeners.forEach((fn) => fn());
    }
    if (cfg.textEffect) {
      if (typeof cfg.textEffect.glow === 'number')
        textEffectParams.glow = Math.min(1.5, Math.max(0, cfg.textEffect.glow));
      if (typeof cfg.textEffect.outline === 'number')
        textEffectParams.outline = Math.min(1, Math.max(0, cfg.textEffect.outline));
      if (typeof cfg.textEffect.float === 'number')
        textEffectParams.float = Math.min(1, Math.max(0, cfg.textEffect.float));
      if (typeof cfg.textEffect.enter === 'boolean')
        textEffectParams.enter = cfg.textEffect.enter;
      if (typeof cfg.textEffect.gap === 'number')
        textEffectParams.gap = Math.min(1.3, Math.max(0.7, cfg.textEffect.gap));
      if (typeof cfg.textEffect.charEnter === 'boolean')
        textEffectParams.charEnter = cfg.textEffect.charEnter;
      textMaterial.emissiveIntensity = textEffectParams.glow;
    }
  },
});

export { onTextRebuild, FONT_LIST, buildTextGeometry, textState, textMaterial, textEffectParams,
  topTextMesh, bottomTextMesh, applyTextOutline, syncTextEffectUI,
  rebuildText, scheduleRebuild, bindTextControls, updateTextAnimation,
  textGradient, isTextGradientEnabled, onTextGradientChange,
  refreshTextGradient, syncTextGradientUI };
