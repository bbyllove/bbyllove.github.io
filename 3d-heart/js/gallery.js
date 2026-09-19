/* ================================================================
 * 相册陈列室：点击左上角「BBYL」进入
 *
 * - 双陈列模式：「环视」相机立于圆心、照片环绕前后重叠；「圆环」全部照片
 *   首尾相连围成整圈、相机在环外俯看、整圈自适应收入画面（参考圆环照片墙）
 * - 每张装进圆角「塑封壳」卡片：
 *   四周透明留白 + 壳下柔边阴影 + 覆膜反光，整体悬浮轻摆；相机立于圆心，
 *   ← / → 切换、空格 = 下一张、ESC 或「退出」按钮返回主页面
 * - 右侧相册侧栏支持多选图片 / 整文件夹导入，压缩后存入
 *   IndexedDB（heart3d-gallery），刷新自动恢复；缩略图可点击
 *   跳转、单张删除或清空全部
 * - 打开期间主场景循环暂停（main.js 通过 isGalleryOpen 门控），
 *   复用同一 WebGL 画布渲染相册场景
 * - 点照片进「聚焦灯箱」时，除了放大这张，还会打出**这张自己的那句台词**
 *   （照片级台词，js/photoquotes.js）：聚焦自适应的底栏让位量因此会抬高，
 *   照片永远压不到那句话上
 * ================================================================ */
import * as THREE from 'three';
import { $, isFormTarget } from './dom.js';
import { renderer } from './core.js';
import { saveConfig, registerConfig } from './config.js';
import {
  startQuotes, stopQuotes, updateQuotes, quoteDebug,
  setQuoteClearance, relayoutQuotes, quoteSpanHalfPx,
} from './galleryquotes.js';
import {
  fetchSeedPhotos, markSeedDeleted, markSeedDeletedMany, clearSeedDeleted,
} from './seedphotos.js';
import {
  configurePhotoQuotes, hasPhotoQuote, photoQuoteText, dropPhotoQuote, prunePhotoQuotes,
  setPhotoQuote, resetPhotoQuote as photoquotesReset, autoFillAll,
  showPhotoQuote, hidePhotoQuote, syncPhotoQuoteZoom,
  photoQuoteReservePx, syncPhotoQuoteEditor, photoQuoteDebug,
} from './photoquotes.js';

const RING_RADIUS = 4.6;      // 照片环半径
const PHOTO_H = 2.1;          // 照片高度（世界单位）
const MAX_PHOTOS = 80;        // 相册上限
const MAX_TEX_SIDE = 1280;    // 压缩最长边

let galleryOpen = false;
let photos = [];              // { id, name, dataUrl, group, tex, aspect, angle }
let index = 0;
let camYaw = 0, camYawTarget = 0;
let rafId = 0;
let focusIndex = -1;  // 聚焦模式：-1 关闭；否则为聚焦照片下标
let focusZoom = 1;    // 聚焦模式滚轮缩放
const SPIN_SPEED = (Math.PI * 2) / 0.9; // 聚焦入场：0.9 秒绕 Y 轴转满一圈
let lastT = 0;
let lastFit = 1; // 聚焦自适应最大不裁切倍数
let layoutMode = 'circle';  // 陈列模式：'ring' 环视 | 'circle' 全景圆环（默认） | 'fan' 扑克扇形
let openedAt = 0;         // 进入陈列室的时刻（吃掉「开门那一次点击」顺带触发的聚焦）
let lastFanD = 8;         // 扇形模式相机距离（聚焦舞台定位用）
let circleRot = 0;        // 圆环模式整体旋转角（把选中张转到正前方）
const _scaleV = new THREE.Vector3();
const _posV = new THREE.Vector3();
const _lookV = new THREE.Vector3();
const _camPosV = new THREE.Vector3();
const _camLookV = new THREE.Vector3();
const _qA = new THREE.Quaternion();
const _qB = new THREE.Quaternion();
const _eul = new THREE.Euler();
const _rightV = new THREE.Vector3();
const _upV = new THREE.Vector3();
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _projV = new THREE.Vector3();
const _cA = new THREE.Vector3();      // 台词让位：照片上沿的左端点（世界坐标 → NDC）
const _cB = new THREE.Vector3();      // 台词让位：照片上沿的右端点
const _viewV = new THREE.Vector3();   // 台词让位：视图空间深度（判断点在相机前 / 后）

const galleryScene = new THREE.Scene();
const galleryCamera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
galleryCamera.position.set(0, 0.15, 0);

/* ---------- IndexedDB 持久化 ---------- */
const DB_NAME = 'heart3d-gallery', STORE = 'photos';
let db = null;
function idbReady() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open(DB_NAME, 1);
    rq.onupgradeneeded = () => { rq.result.createObjectStore(STORE, { keyPath: 'id' }); };
    rq.onsuccess = () => { db = rq.result; res(db); };
    rq.onerror = () => rej(rq.error);
  });
}
function idbRun(mode, fn) {
  return new Promise((res, rej) => {
    if (!db) return res(undefined);
    const tx = db.transaction(STORE, mode);
    const st = tx.objectStore(STORE);
    const out = fn(st);
    tx.oncomplete = () => res(out && out.result);
    tx.onerror = () => rej(tx.error);
  });
}
// 内置照片不写字节进 IndexedDB（它们活在仓库文件里）：IDB 体积与内置张数无关，
// 且刷新时内置相册永远以最新 manifest 为准 → 加图 / 删图对所有访客立即生效。
const idbSaveAll = (list) => idbRun('readwrite', (st) => {
  st.clear();
  list.filter((p) => !p.builtin).forEach((p) => { st.put({ id: p.id, name: p.name, dataUrl: p.dataUrl }); });
});
const idbRemove = (id) => idbRun('readwrite', (st) => st.delete(id));
const idbClear = () => idbRun('readwrite', (st) => st.clear());
const idbLoadAll = () => idbRun('readonly', (st) => st.getAll());

/* ---------- 工具 ---------- */
function loadImageEl(src) {
  return new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => rej(new Error('图片解码失败'));
    i.src = src;
  });
}
async function compressImageFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImageEl(url);
    for (const [maxSide, quality] of [[MAX_TEX_SIDE, 0.85], [960, 0.8], [640, 0.75]]) {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(2, Math.round(img.width * scale));
      const h = Math.max(2, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = c.toDataURL('image/jpeg', quality);
      if (dataUrl.length <= 700000 || maxSide === 640) return dataUrl;
    }
    return '';
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ---------- 场景搭建 ---------- */
/* 塑封壳卡片：把「投影 + 圆角塑封壳 + 圆角照片 + 塑封反光」一次画进
   一张带透明通道的 Canvas，壳子四周是透明留白，整体作为一个面片悬浮展示。
   结构（由外到内）：透明留白 → 壳下柔边阴影 → 半透明塑料壳（圆角+高光边）
   → 圆角裁切的照片 → 斜向塑封反光带 */
const CARD_H = PHOTO_H * 1.3; // 卡片整体世界高度（含壳边与阴影余地）
function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function buildCardTexture(imageEl) {
  const maxSide = 1000;
  const scale = Math.min(1, maxSide / Math.max(imageEl.width, imageEl.height));
  const pw = Math.max(2, Math.round(imageEl.width * scale));
  const ph = Math.max(2, Math.round(imageEl.height * scale));
  const border = Math.max(14, Math.round(Math.min(pw, ph) * 0.055)); // 塑封边宽
  const shadowPad = Math.round(border * 2.8);                        // 阴影模糊余地
  const W = pw + border * 2 + shadowPad * 2;
  const H = ph + border * 2 + shadowPad * 2 + Math.round(shadowPad * 0.7);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const sx = shadowPad, sy = shadowPad;
  const sw = pw + border * 2, sh = ph + border * 2;
  const rShell = Math.max(10, Math.round(Math.min(sw, sh) * 0.075));
  const rPhoto = Math.round(rShell * 0.55);
  // 1) 壳下柔边投影：先带阴影画壳形，再擦除壳体本身，
  //    只保留壳外的投影 —— 壳边区域保持透明、能透出背景色
  g.save();
  roundRectPath(g, sx, sy, sw, sh, rShell);
  g.shadowColor = 'rgba(0, 0, 0, 0.8)';
  g.shadowBlur = shadowPad * 0.85;
  g.shadowOffsetY = shadowPad * 0.5;
  g.fillStyle = 'rgba(0, 0, 0, 1)';
  g.fill();
  g.shadowColor = 'transparent';
  g.shadowBlur = 0;
  g.shadowOffsetY = 0;
  g.globalCompositeOperation = 'destination-out';
  roundRectPath(g, sx, sy, sw, sh, rShell);
  g.fill(); // 擦除壳体内像素，只留外部柔边投影
  g.restore();
  // 2) 半透明塑料壳 + 边缘高光
  g.save();
  roundRectPath(g, sx, sy, sw, sh, rShell);
  const pg = g.createLinearGradient(sx, sy, sx + sw, sy + sh);
  pg.addColorStop(0, 'rgba(255, 255, 255, 0.06)');
  pg.addColorStop(0.5, 'rgba(255, 255, 255, 0.018)');
  pg.addColorStop(1, 'rgba(255, 255, 255, 0.045)');
  g.fillStyle = pg;
  g.fill();
  g.lineWidth = Math.max(1.5, border * 0.1);
  g.strokeStyle = 'rgba(255, 255, 255, 0.6)';
  g.stroke();
  // 内圈半透明高光，强化「塑料膜」通透质感
  g.lineWidth = Math.max(1, border * 0.06);
  g.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  roundRectPath(g, sx + g.lineWidth * 2, sy + g.lineWidth * 2, sw - g.lineWidth * 4, sh - g.lineWidth * 4, Math.max(6, rShell - 6));
  g.stroke();
  g.restore();
  // 3) 圆角裁切的照片
  g.save();
  roundRectPath(g, sx + border, sy + border, pw, ph, rPhoto);
  g.clip();
  g.drawImage(imageEl, sx + border, sy + border, pw, ph);
  // 4) 塑封反光：斜向高光带，模拟覆膜光泽
  const gl = g.createLinearGradient(sx, sy, sx + sw, sy + sh * 0.75);
  gl.addColorStop(0, 'rgba(255, 255, 255, 0.22)');
  gl.addColorStop(0.35, 'rgba(255, 255, 255, 0.03)');
  gl.addColorStop(0.62, 'rgba(255, 255, 255, 0.12)');
  gl.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = gl;
  g.fillRect(sx + border, sy + border, pw, ph);
  g.restore();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: W / H };
}

function buildPhotoMesh(photo) {
  const group = new THREE.Group();
  const { tex, aspect } = buildCardTexture(photo.imageEl);
  photo.tex = tex;
  photo.aspect = aspect;
  const h = CARD_H;
  const w = h * aspect;
  // 单面片：透明通道承载留白 / 圆角 / 阴影；关闭 depthWrite 让重叠正确混色
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  group.add(mesh);
  photo.group = group;
  galleryScene.add(group);
}

function relayoutRing() {
  const n = photos.length;
  // 间距限幅：少图时收紧到 85% 照片宽（保证前后重叠），多图时不少于 50% 宽（防叠死）
  const even = (Math.PI * 2) / Math.max(1, n);
  const lo = (CARD_H * 0.5) / RING_RADIUS;
  const hi = (CARD_H * 0.85) / RING_RADIUS;
  const step = Math.min(Math.max(even, lo), hi);
  photos.forEach((p, i) => { p.angle = i * step; });
  syncGalleryMeta();
}
function circleStep() { return (Math.PI * 2) / Math.max(1, photos.length); }
/* 圆环半径：按平均卡宽让相邻卡片首尾相接、略微重叠 */
function circleRadius() {
  const n = photos.length;
  if (n <= 1) return 3.4;
  let s = 0;
  photos.forEach((p) => { s += p.aspect || 1; });
  const wAvg = CARD_H * (s / n);
  const r = (wAvg * 0.86) / (2 * Math.sin(Math.PI / n));
  return Math.min(26, Math.max(3.4, r));
}
/* 圆环模式相机：环外上方俯看圆心；距离按 fov 自适应，保证整圈入画 */
function circleCameraPose() {
  const R = circleRadius();
  const fovR = (galleryCamera.fov * Math.PI) / 180;
  const tanV = Math.tan(fovR / 2);
  const tanH = tanV * Math.max(0.4, galleryCamera.aspect);
  let s = 0;
  photos.forEach((p) => { s += p.aspect || 1; });
  const wAvg = photos.length ? CARD_H * (s / photos.length) : CARD_H;
  const elev = 0.42; // 俯视角
  const halfW = R + wAvg * 0.65;
  const halfH = R * Math.sin(elev) + CARD_H * 1.1;
  let depth = Math.max((1.06 * halfW) / tanH, (1.08 * halfH) / tanV, R * 1.5);
  depth = Math.min(depth, 78);
  _camPosV.set(0, depth * Math.sin(elev), depth * Math.cos(elev));
  _camLookV.set(0, -0.25, 0); // 视点略降，让整圈落在画面视觉中心
  return R;
}
/* 扇形（扑克牌）参数：所有卡绕屏幕下方支点放射排布、大幅重叠成扇面 */
function fanParams() {
  const n = photos.length;
  let s = 0;
  photos.forEach((p) => { s += p.aspect || 1; });
  const wAvg = n ? CARD_H * (s / n) : CARD_H;
  const R = CARD_H * 2.3;                 // 支点半径
  let step = (wAvg * 0.38) / R;           // 相邻卡重叠如手牌
  if (n > 1) step = Math.min(step, ((55 * Math.PI) / 180) * 2 / (n - 1)); // 总张角限幅
  return { R, step, Py: R - 0.2 };
}
/* 扇形相机：正对扇面，距离按 fov 自适应保证整扇入画 */
function fanCameraPose() {
  const { R, step, Py } = fanParams();
  const n = photos.length;
  const phiMax = n > 1 ? (step * (n - 1)) / 2 : 0;
  let s = 0;
  photos.forEach((p) => { s += p.aspect || 1; });
  const wAvg = n ? CARD_H * (s / n) : CARD_H;
  const halfW = R * Math.sin(phiMax) + wAvg * 0.75;
  const yTop = -Py + R + CARD_H * 0.75;
  const yBot = -Py + R * Math.cos(phiMax) - CARD_H * 0.75;
  const centerY = (yTop + yBot) / 2;
  const halfH = (yTop - yBot) / 2;
  const fovR = (galleryCamera.fov * Math.PI) / 180;
  const tanV = Math.tan(fovR / 2);
  const tanH = tanV * Math.max(0.4, galleryCamera.aspect);
  let D = Math.max((1.12 * halfW) / tanH, (1.12 * halfH) / tanV, R * 0.9);
  D = Math.min(D, 78);
  lastFanD = D;
  _camPosV.set(0, centerY, D);
  _camLookV.set(0, centerY, 0);
  return D;
}
function applyTransforms(time) {
  const dt = Math.min(0.05, Math.max(0.001, time - lastT));
  lastT = time;
  const circle = layoutMode === 'circle';
  const fan = layoutMode === 'fan';
  const n = photos.length;
  const R = circle ? circleRadius() : RING_RADIUS;
  if (circle && n) {
    // 整环最短路径旋转，把选中张送到正前方
    let diff = (-index * circleStep() - circleRot) % (Math.PI * 2);
    if (diff > Math.PI) diff -= Math.PI * 2;
    if (diff < -Math.PI) diff += Math.PI * 2;
    circleRot += diff * 0.1;
  }
  photos.forEach((p, i) => {
    if (!p.group) return;
    const g = p.group;
    const focused = focusIndex === i;
    const dimmed = focusIndex !== -1 && !focused;
    let tx, ty, tz, face, phiNow = 0; // face: center=朝圆心 | out=朝环外 | fan=扇面放射 | cam=朝相机
    if (fan) {
      const fp = fanParams();
      const mid = (n - 1) / 2;
      phiNow = (i - mid) * fp.step;
      if (focused) {
        tx = 0; ty = p.focusYOff || 0; tz = lastFanD * 0.45; face = 'cam'; // 弹出舞台：扇面与相机之间
      } else {
        const rad = fp.R + (i === index ? 0.35 : 0); // 选中张微微抽出手牌
        tx = Math.sin(phiNow) * rad;
        ty = -fp.Py + Math.cos(phiNow) * rad + Math.sin(time * 0.8 + i * 1.3) * 0.02;
        tz = (i - mid) * 0.06; // 扑克牌叠放次序
        face = 'fan';
      }
    } else if (circle) {
      const th = i * circleStep() + circleRot;
      if (focused) {
        tx = 0; ty = 0.12 + (p.focusYOff || 0); tz = R * 0.45; face = 'cam'; // 聚焦舞台：环与相机之间
      } else {
        tx = Math.sin(th) * R;
        tz = Math.cos(th) * R;
        ty = Math.sin(time * 0.8 + i * 1.3) * 0.03 + (i === index ? 0.14 : 0);
        // 朝向永远纯径向：正面朝环外、反面朝环内，转环过程中不做任何自身翻转
        face = 'out';
      }
    } else {
      const a = p.angle;
      // 聚焦张向圆心（相机）拉近，产生放大临场感
      const targetR = focused ? RING_RADIUS - 1.5 : RING_RADIUS;
      p.curR = p.curR === undefined ? RING_RADIUS : p.curR + (targetR - p.curR) * 0.14;
      tx = Math.sin(a) * p.curR;
      tz = Math.cos(a) * p.curR;
      ty = Math.sin(time * 0.9 + i * 1.7) * 0.03 + (focused ? (p.focusYOff || 0) : 0);
      face = 'center';
    }
    _posV.set(tx, ty, tz);
    g.position.lerp(_posV, 0.14);
    // 朝向：环视朝圆心、圆环朝环外、聚焦朝相机（lookAt 后取回再 slerp，切换模式时平滑过渡）
    if (face === 'center') _lookV.set(0, g.position.y, 0);
    else if (face === 'out') _lookV.set(g.position.x * 2, g.position.y, g.position.z * 2);
    else _lookV.copy(galleryCamera.position);
    // 朝向：圆环非聚焦 = 纯径向（正面朝环外 / 反面朝环内），由卡片实际位置角
    // 直接得出，转环过程中零自身旋转；仅在切入圆环 / 退出聚焦时用 orientBlend
    // 做一次性过渡。其余情况走基底 qBase slerp；spin / 轻摆作为纯偏移叠加，
    // 保证聚焦入场正好绕 Y 轴转一整圈（2π→0），不会逐帧累加多转
    if (!focused && (circle || fan)) {
      if (fan) {
        _qB.setFromEuler(_eul.set(0, 0, -phiNow)); // 扇形：卡面绕支点放射，如扑克牌
      } else {
        const psi = Math.atan2(g.position.x, g.position.z);
        _qB.setFromEuler(_eul.set(0, psi, 0));
      }
      if (p.orientBlend === undefined) { p.orientBlend = 0; p.qFrom = g.quaternion.clone(); }
      if (p.orientBlend < 1) {
        p.orientBlend = Math.min(1, p.orientBlend + dt * 2.2);
        const t = p.orientBlend * p.orientBlend * (3 - 2 * p.orientBlend);
        g.quaternion.copy(p.qFrom).slerp(_qB, t);
      } else {
        g.quaternion.copy(_qB);
      }
      if (!p.qBase) p.qBase = new THREE.Quaternion();
      p.qBase.copy(g.quaternion);
    } else {
      if (!p.qBase) p.qBase = new THREE.Quaternion();
      _qA.copy(p.qBase);
      g.lookAt(_lookV);
      _qB.copy(g.quaternion);
      p.qBase.copy(_qA).slerp(_qB, 0.16);
      g.quaternion.copy(p.qBase);
    }
    if (focused) {
      // 入场绕 Y 轴转满一圈（spin 2π→0），结束后保持正面
      if (p.spin > 0) {
        p.spin = Math.max(0, p.spin - dt * SPIN_SPEED);
        g.rotateY(p.spin);
      }
    } else {
      p.spin = 0;
      p.focusYOff = 0;
      if (!circle && !fan) g.rotateZ(Math.sin(time * 0.6 + i * 2.1) * 0.008); // 悬浮轻摆（已减弱）
    }
    let targetScale = i === index ? (circle ? 1.1 : 1.07) : 1.0;
    if (focused) {
      // 自适应放大：按屏幕可用区域计算「完整显示不裁切」的基准倍数 lastFit：
      // targetScale = lastFit * focusZoom，focusZoom = 1 即整屏自适应完整显示，
      // 继续放大（最多 4×）允许超出画幅裁切以查看细节
      const d = Math.max(0.5, galleryCamera.position.distanceTo(g.position));
      const fovR = (galleryCamera.fov * Math.PI) / 180;
      const tanV = Math.tan(fovR / 2);
      const Hvis = 2 * d * tanV;
      const Wvis = Hvis * galleryCamera.aspect;
      const vw = window.innerWidth, vh = window.innerHeight;
      // 聚焦时管理栏隐藏（灯箱模式）：可用区域 = 顶栏 70px / 底栏 / 左右 24px（NDC）。
      // 底栏本来留 120px（图注 + 提示条）；**这张照片配了专属台词**时还要多让出
      // 「药丸下沿 104 + 药丸实高 + 10px 呼吸」（见 js/photoquotes.js 的
      // photoQuoteReservePx）→ 照片的可见区恒在那句话之上，于是聚焦模式下的
      // 「台词不压照片」跟常态的空白带一样，也是构造性成立的（放大另说，见下）
      const botRes = Math.max(120, photoQuoteReservePx());
      const ndcT = 1 - 2 * (70 / vh), ndcB = -1 + 2 * (botRes / vh);
      const ndcL = (24 / vw) * 2 - 1, ndcR = ((vw - 24) / vw) * 2 - 1;
      const availH = (Hvis * (ndcT - ndcB)) / 2;
      const availW = (Wvis * (ndcR - ndcL)) / 2;
      const hCard = CARD_H, wCard = CARD_H * (p.aspect || 1);
      lastFit = Math.min(availH / hCard, availW / wCard) * 0.9;
      targetScale = lastFit * focusZoom;
      // 放大本来就是「允许超出画幅裁切看细节」：这时把这句台词淡出，把画面还给照片；
      // 让位量不撤（zoom 一变就重排照片会边滚边抖）
      syncPhotoQuoteZoom(focusZoom);
      // 垂直重居中：把聚焦卡投影中心收敛到可用区中心（上下栏不对称）
      _projV.copy(g.position).project(galleryCamera);
      p.focusYOff = (p.focusYOff || 0) - (_projV.y - (ndcT + ndcB) / 2) * d * tanV * 0.35;
    }
    g.scale.lerp(_scaleV.set(targetScale, targetScale, targetScale), 0.15);
    // 两侧照片淡出 / 恢复
    const targetOp = dimmed ? 0 : 1;
    p.curOp = p.curOp === undefined ? 1 : p.curOp + (targetOp - p.curOp) * 0.12;
    const mat = g.children[0].material;
    mat.opacity = p.curOp;
    g.visible = p.curOp > 0.02;
  });
}

/* ---------- 当前照片「可见区」的屏幕最高点（px）——调试对照用 ----------
   用可见照片高度 PHOTO_H 而不是 CARD_H：塑封壳四周是透明留白 + 柔边阴影，
   按壳算会白白吃掉台词的空间。返回 0 = 没有照片可让位（空相册）。 */
function photoTopPx() {
  const p = photos[index];
  if (!p || !p.group || !p.group.visible) return 0;
  const half = PHOTO_H / 2;
  const hw = half * (p.aspect || 1);
  p.group.updateMatrixWorld();          // applyTransforms 刚改过位置，这里取最新矩阵
  const vh = window.innerHeight || 1;
  let best = -Infinity;                 // ndc.y 越大 = 屏幕上越靠上
  for (const sx of [-1, 0, 1]) {
    _posV.set(sx * hw, half, 0).applyMatrix4(p.group.matrixWorld).project(galleryCamera);
    if (Number.isFinite(_posV.y) && _posV.y > best) best = _posV.y;
  }
  if (!Number.isFinite(best)) return 0;
  return Math.max(0, Math.round(((1 - best) / 2) * vh));
}
/* 点是否在相机前方：相机背后的点投影会被 w<0 翻折，数值不可信，直接跳过 */
function frontOfCamera(v) {
  _viewV.copy(v).applyMatrix4(galleryCamera.matrixWorldInverse);
  return _viewV.z <= -galleryCamera.near;
}
/* ---------- 台词真正要让的位置：所有可见照片的屏幕上沿（px）----------
   只让「当前张」是不够的：环视模式两侧邻张因为绕 Y 轴转过去，靠相机的那个上角
   会比当前张更高；圆环模式相机在环外俯看，远端照片整排挂在画面上方
   （实测 n=2..80、1000×640…2560×1440 都比当前张高 110–190px）；扇形模式
   照片多于十几张时两侧手牌翘得比抽出来的当前张高一大截。所以这里扫一遍所有
   可见照片，每张取上沿（PHOTO_H，不含壳的透明留白）两个上角投影后的最高点，
   并只在「台词块可能占据的水平窗口」内取值（窗口 = 屏宽 − 2×侧栏让位量，
   由 galleryquotes 直接读 CSS 的 max-width 得到，js / css 不各算一份）：
   窗宽外的照片顶不构成约束，窗宽被照片上沿跨过时用边界处的插值高度。
   返回窗口内最高的屏幕 y（px）；0 = 没有可让位的照片（空相册 / 全在相机背后）。 */
function quoteClearanceTopPx() {
  if (!photos.length) return 0;
  const vw = window.innerWidth || 1;
  const vh = window.innerHeight || 1;
  galleryCamera.updateMatrixWorld();
  const halfWin = quoteSpanHalfPx();
  const left = vw / 2 - halfWin;
  const right = vw / 2 + halfWin;
  let best = Infinity;      // 屏幕 y 越小 = 越靠上
  let seen = 0;
  for (const p of photos) {
    const g = p.group;
    if (!g || !g.visible) continue;                       // 聚焦时其余张已淡出隐藏
    const half = (PHOTO_H / 2) * g.scale.y;
    const hw = half * (p.aspect || 1);
    g.updateMatrixWorld();                                 // applyTransforms 刚改过位姿
    _cA.set(-hw, half, 0).applyMatrix4(g.matrixWorld);
    _cB.set(hw, half, 0).applyMatrix4(g.matrixWorld);
    if (!frontOfCamera(_cA) || !frontOfCamera(_cB)) continue;
    seen++;
    _cA.project(galleryCamera);
    _cB.project(galleryCamera);
    const ax = ((_cA.x + 1) / 2) * vw, ay = ((1 - _cA.y) / 2) * vh;
    const bx = ((_cB.x + 1) / 2) * vw, by = ((1 - _cB.y) / 2) * vh;
    if (ax >= left && ax <= right && ay < best) best = ay;
    if (bx >= left && bx <= right && by < best) best = by;
    const dx = bx - ax;
    if (Math.abs(dx) > 1e-6) {              // 上沿横跨窗口边界：用边界处的插值高度
      for (let k = 0; k < 2; k++) {
        const edge = k ? right : left;
        const t = (edge - ax) / dx;
        if (t > 0 && t < 1) {
          const y = ay + (by - ay) * t;
          if (y < best) best = y;
        }
      }
    }
  }
  return seen && Number.isFinite(best) ? Math.max(0, Math.round(best)) : 0;
}

/* ---------- 主循环（仅打开时运行）---------- */
function galleryLoop() {
  rafId = requestAnimationFrame(galleryLoop);
  const time = performance.now() / 1000;
  updateQuotes(time);           // 台词轮播：每 N 秒（默认 5 秒）切一句
  if (layoutMode === 'circle') {
    circleCameraPose();
    galleryCamera.position.lerp(_camPosV, 0.1);
    galleryCamera.lookAt(_camLookV);
  } else if (layoutMode === 'fan') {
    fanCameraPose();
    galleryCamera.position.lerp(_camPosV, 0.1);
    galleryCamera.lookAt(_camLookV);
  } else {
    camYaw += (camYawTarget - camYaw) * 0.12;
    _posV.set(0, 0.15, 0);
    galleryCamera.position.lerp(_posV, 0.14);
    _qA.setFromEuler(_eul.set(0, camYaw, 0));
    galleryCamera.quaternion.slerp(_qA, 0.3);
  }
  applyTransforms(time);
  setQuoteClearance(quoteClearanceTopPx());  // 台词带紧跟「所有可见照片」的上沿：居中、上移、不压照片
  renderer.render(galleryScene, galleryCamera);
}

/* ---------- 陈列模式切换 ---------- */
function setPanelHidden(hidden) {
  document.body.classList.toggle('gallery-panel-hidden', !!hidden);
  const open = $('galleryPanelOpen');
  if (open) open.hidden = !hidden;
  // 侧栏开合改的是台词块的可用宽度（--gq-side）：长句会重新折行、变高，
  // 空白带高度却可能没变 → 每帧那条重排路径不会触发，这里必须强制重算一次字号
  relayoutQuotes();
}
function setLayoutMode(mode) {
  if (mode !== 'ring' && mode !== 'circle' && mode !== 'fan') return;
  if (mode === layoutMode) return;
  layoutMode = mode;
  photos.forEach((q) => { if (q.group) { q.orientBlend = 0; q.qFrom = q.group.quaternion.clone(); } });
  const bR = $('galleryModeRing'), bC = $('galleryModeCircle'), bF = $('galleryModeFan');
  if (bR) bR.classList.toggle('active', mode === 'ring');
  if (bC) bC.classList.toggle('active', mode === 'circle');
  if (bF) bF.classList.toggle('active', mode === 'fan');
  if (focusIndex !== -1) setFocus(false);
  relayoutQuotes();   // 三种陈列模式的照片高低差很大，切完立即重算台词带
  syncGalleryMeta();
}

function syncGalleryMeta() {
  const count = $('galleryCount');
  if (count) count.textContent = photos.length ? `${index + 1} / ${photos.length}` : '0 / 0';
  const empty = $('galleryEmpty');
  if (empty) empty.hidden = photos.length > 0;
  const cap = $('galleryCaption');
  if (cap) cap.textContent = photos.length ? `${index + 1}. ${photos[index].name}` : '—';
  document.querySelectorAll('#galleryThumbs .gallery-thumb').forEach((el, i) =>
    el.classList.toggle('active', i === index));
  syncPhotoQuoteEditor();   // 侧栏那个「本张台词」编辑框跟着当前选中的照片走
}

function setFocus(on) {
  focusIndex = on ? index : -1;
  if (!on) photos.forEach((q) => { if (q.group) { q.orientBlend = 0; q.qFrom = q.group.quaternion.clone(); } });
  focusZoom = 1;
  document.body.classList.toggle('gallery-focus', on); // 聚焦时隐藏右侧管理栏
  /* 照片级台词（46 尾补）：聚焦就打这张自己的那句（没配就底部什么都不出），
     退出聚焦淡出让位。必须在上面那句 classList.toggle 之后调 —— CSS 里那条
     body:not(.gallery-focus) 的兜底规则要靠它才让药丸显示出来 */
  if (on) showPhotoQuote(photos[index] || null);
  else hidePhotoQuote();
  if (on && photos[index]) photos[index].spin = Math.PI * 2; // 入场转一整圈
}

function setIndex(i, wrap = true) {
  if (!photos.length) return;
  const n = photos.length;
  if (focusIndex !== -1) setFocus(false);
  index = ((i % n) + n) % n;
  camYawTarget = photos[index].angle + Math.PI;
  syncGalleryMeta();
}

/* ---------- 增删 ---------- */
function removePhoto(i) {
  const p = photos[i];
  if (!p) return;
  if (p.builtin && p.seedId) markSeedDeleted(p.seedId); // 内置图删过不复活：刷新后仍删着，用「恢复内置相册」找回
  if (p.group) {
    galleryScene.remove(p.group);
    p.group.children.forEach((m) => { m.geometry.dispose(); m.material.dispose(); });
    if (p.tex) p.tex.dispose();
  }
  photos.splice(i, 1);
  dropPhotoQuote(p);          // 导入图删了就没有找回来的路，它的台词条目一并删掉
  if (focusIndex >= photos.length) focusIndex = -1;
  if (index >= photos.length) index = Math.max(0, photos.length - 1);
  relayoutRing();
  if (photos.length) { camYawTarget = photos[index].angle + Math.PI; }
  renderThumbs();
  idbSaveAll(photos).catch(() => {});
  const h = $('galleryHint');
  if (h) h.textContent = defaultGalleryHint();   // 删完一句提示跟上，别留着过期的「已导入 N 张」
}

async function addFiles(files) {
  const list = Array.from(files).filter((f) => f.type && f.type.startsWith('image/'));
  if (!list.length) return;
  const hint = $('galleryHint');
  let added = 0;
  for (let i = 0; i < list.length; i++) {
    if (photos.length >= MAX_PHOTOS) { if (hint) hint.textContent = `已达上限 ${MAX_PHOTOS} 张，超出部分未导入`; break; }
    if (hint) hint.textContent = `正在导入 ${i + 1} / ${list.length} …`;
    try {
      const dataUrl = await compressImageFile(list[i]);
      if (!dataUrl) continue;
      const imageEl = await loadImageEl(dataUrl);
      const photo = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: list[i].name || `照片 ${photos.length + 1}`, dataUrl, imageEl };
      buildPhotoMesh(photo);
      photos.push(photo);
      added++;
    } catch (err) {
      console.warn('相册导入失败:', list[i].name, err);
    }
  }
  if (hint) hint.textContent = added ? `已导入 ${added} 张，保存在浏览器本地（IndexedDB）` : '导入失败：没有可用的图片文件';
  relayoutRing();
  renderThumbs();
  if (added) {
    if (photos.length === added) index = 0; // 首次导入对准第一张
    camYawTarget = photos[index].angle + Math.PI;
    syncGalleryMeta();
  }
  idbSaveAll(photos).catch(() => {});
}

function renderThumbs() {
  const box = $('galleryThumbs');
  if (!box) return;
  box.innerHTML = '';
  photos.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gallery-thumb';
    btn.title = p.name;
    const img = document.createElement('img');
    img.src = p.dataUrl || p.src || '';  // 访客导入走压缩 dataUrl；内置照片走仓库同源 URL
    img.alt = p.name;
    const del = document.createElement('span');
    del.className = 'gallery-thumb-del';
    del.textContent = '✕';
    del.addEventListener('click', (e) => { e.stopPropagation(); removePhoto(i); });
    btn.append(img, del);
    if (p.builtin) {
      btn.classList.add('gallery-thumb-builtin');
      const tag = document.createElement('span');
      tag.className = 'gallery-thumb-tag';
      tag.textContent = '内置';
      btn.appendChild(tag);
    }
    if (hasPhotoQuote(p)) {                       // 这张配了专属台词（聚焦时逐字打出来）
      const qm = document.createElement('span');
      qm.className = 'gallery-thumb-quote';
      qm.textContent = '❝';
      qm.title = '这张配了专属台词，点进聚焦就能看到';
      btn.appendChild(qm);
    }
    btn.addEventListener('click', () => setIndex(i));
    box.appendChild(btn);
  });
  syncGalleryMeta();
}

/* ---------- 开关 ---------- */
function onResize() {
  galleryCamera.aspect = window.innerWidth / window.innerHeight;
  galleryCamera.updateProjectionMatrix();
}
function openGallery() {
  if (galleryOpen) return;
  galleryOpen = true;
  openedAt = performance.now();
  document.body.classList.add('gallery-open');
  const ov = $('galleryOverlay');
  if (ov) ov.hidden = false;
  onResize();
  if (photos.length) camYawTarget = photos[index].angle + Math.PI;
  camYaw = camYawTarget; // 进入时直接对准当前张
  if (layoutMode === 'circle') {
    circleCameraPose();
    galleryCamera.position.copy(_camPosV);
    galleryCamera.lookAt(_camLookV);
  } else if (layoutMode === 'fan') {
    fanCameraPose();
    galleryCamera.position.copy(_camPosV);
    galleryCamera.lookAt(_camLookV);
  } else {
    galleryCamera.position.set(0, 0.15, 0);
    galleryCamera.rotation.set(0, 0, 0);
    galleryCamera.rotateY(camYaw);
  }
  setFocus(false); // 同步默认提示条文案
  syncGalleryMeta();
  setQuoteClearance(quoteClearanceTopPx());  // 先把照片上沿告诉台词模块，第一帧就摆对位置
  startQuotes();  // 台词从第一句重新开始轮播
  cancelAnimationFrame(rafId);
  galleryLoop();
}
function closeGallery() {
  if (!galleryOpen) return;
  galleryOpen = false;
  document.body.classList.remove('gallery-open');
  const ov = $('galleryOverlay');
  if (ov) ov.hidden = true;
  cancelAnimationFrame(rafId);
  stopQuotes();   // 台词停走、叠层收起
  setFocus(false);
}
function isGalleryOpen() { return galleryOpen; }

/* ---------- 事件绑定 ---------- */
const header = document.querySelector('header.title');
if (header) {
  header.style.cursor = 'pointer';
  header.title = '进入相册陈列室';
  header.addEventListener('click', openGallery);
}
if ($('galleryExit')) $('galleryExit').addEventListener('click', closeGallery);
if ($('galleryModeRing')) $('galleryModeRing').addEventListener('click', () => setLayoutMode('ring'));
if ($('galleryModeCircle')) $('galleryModeCircle').addEventListener('click', () => setLayoutMode('circle'));
if ($('galleryModeFan')) $('galleryModeFan').addEventListener('click', () => setLayoutMode('fan'));
if ($('galleryPanelClose')) $('galleryPanelClose').addEventListener('click', () => setPanelHidden(true));
if ($('galleryPanelOpen')) $('galleryPanelOpen').addEventListener('click', () => setPanelHidden(false));
if ($('galleryAddFiles')) $('galleryAddFiles').addEventListener('click', () => $('galleryFile') && $('galleryFile').click());
if ($('galleryAddFolder')) $('galleryAddFolder').addEventListener('click', () => $('galleryFolder') && $('galleryFolder').click());
if ($('galleryFile')) $('galleryFile').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
if ($('galleryFolder')) $('galleryFolder').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
if ($('galleryClearAll')) $('galleryClearAll').addEventListener('click', () => {
  const builtinIds = photos.filter((p) => p.builtin && p.seedId).map((p) => p.seedId);
  while (photos.length) {
    const p = photos.pop();
    if (p.group) {
      galleryScene.remove(p.group);
      p.group.children.forEach((m) => { m.geometry.dispose(); m.material.dispose(); });
      if (p.tex) p.tex.dispose();
    }
  }
  index = 0;
  focusIndex = -1;
  relayoutRing();
  renderThumbs();
  idbClear().catch(() => {});
  prunePhotoQuotes();         // 清掉「已经不存在的导入图」的台词条目（内置图的留着：恢复即回）
  if (builtinIds.length) {
    markSeedDeletedMany(builtinIds);   // 记下「这次是主动清掉内置的」，刷新不自动复活
    const hint = $('galleryHint');
    if (hint) hint.textContent = `已清空相册（含 ${builtinIds.length} 张内置照片）；刷新后不会自动回来，点「恢复内置相册」可找回。`;
  }
});
if ($('galleryRestoreSeeds')) $('galleryRestoreSeeds').addEventListener('click', () => {
  clearSeedDeleted();
  seedBuiltins(true).then(() => {
    relayoutRing();
    renderThumbs();
    syncGalleryMeta();
    const hint = $('galleryHint');
    if (hint) hint.textContent = defaultGalleryHint();
  });
});
/* ---------- 聚焦模式：点击当前照片 / 滚轮缩放 ---------- */
function pickPhoto(x, y) {
  _ndc.set((x / window.innerWidth) * 2 - 1, -(y / window.innerHeight) * 2 + 1);
  _raycaster.setFromCamera(_ndc, galleryCamera);
  const meshes = [];
  photos.forEach((p, i) => { if (p.group && p.group.visible) meshes.push([i, p.group.children[0]]); });
  const hits = _raycaster.intersectObjects(meshes.map((m) => m[1]), false);
  if (!hits.length) return -1;
  const found = meshes.find((m) => m[1] === hits[0].object);
  return found ? found[0] : -1;
}
window.addEventListener('click', (e) => {
  if (!galleryOpen) return;
  /* 开门的那次点击不算「点照片」：点击标题（BBYL）会一边打开陈列室、一边冒泡到这里，
     而此刻照片矩阵还停在原点（位置要等第一帧 applyTransforms 才写进去），
     射线必然命中 → 一进陈列室就莫名进了聚焦灯箱。加两道闸：入口元素豁免 + 300ms 冷却 */
  if (performance.now() - openedAt < 300) return;
  if (e.target && e.target.closest
    && e.target.closest('header.title, #galleryPanel, #galleryExit, button, input')) return;
  const hit = pickPhoto(e.clientX, e.clientY);
  if (focusIndex !== -1) {
    setFocus(false); // 聚焦中：点照片 / 点空白都退出聚焦
    return;
  }
  if (layoutMode === 'fan' && hit >= 0) {  // 扇形：点任意一张 → 弹出居中
    setIndex(hit);
    setFocus(true);
    return;
  }
  if (hit === index) setFocus(true);       // 点当前照片 → 聚焦
  else if (hit >= 0) setIndex(hit);        // 点两侧照片 → 切过去
});
window.addEventListener('wheel', (e) => {
  if (!galleryOpen || focusIndex === -1) return;
  e.preventDefault();
  focusZoom = Math.min(4, Math.max(0.5, focusZoom * (e.deltaY < 0 ? 1.1 : 0.9)));
}, { passive: false });

window.addEventListener('keydown', (e) => {
  if (!galleryOpen) return;
  /* 侧栏里有文本框 / 字体字号下拉：焦点在这些控件上时一律不劫持按键 ——
     ← / → 要留给下拉换选项、空格要留给文本框打空格，ESC 也不打断编辑 */
  if (isFormTarget(e.target)) return;
  switch (e.key) {
    case 'ArrowRight': e.preventDefault(); setIndex(index + 1); break; // setIndex 内部会退焦
    case 'ArrowLeft': e.preventDefault(); setIndex(index - 1); break;
    case ' ': e.preventDefault(); setIndex(index + 1); break;
    case 'Escape':
      e.preventDefault();
      if (focusIndex !== -1) setFocus(false);
      else closeGallery();
      break;
  }
});
window.addEventListener('resize', onResize);

/* ---------- 内置相册注入（manifest 驱动，张数可变）----------
 * 分批建：先建一小批让陈列室立刻能开门，其余逐帧补齐，
 * 避免几十次 canvas 重编码 + 纹理上传一次性卡住主线程。
 * 顺序约定：内置照片在最前，访客自己导入的追加在后面。 */
let seedPromise = null;
/* 内置照片永远在最前、访客导入的追加在后。启动时天然满足（先种内置再拼访客），
   但「恢复内置相册」路径上照片数组里已有内容，新种的内置图会被 push 到尾部 ——
   这里稳定排序摆回最前，并保持当前正在看的那张身份与 index 不变。 */
function ensureBuiltinsFirst() {
  if (!photos.length) return;
  const b = photos.filter((p) => p.builtin);
  if (!b.length || b.length === photos.length) return;
  const cur = photos[index] || null;
  photos = b.concat(photos.filter((p) => !p.builtin));
  index = cur ? Math.max(0, photos.indexOf(cur)) : 0;
  relayoutRing();
  renderThumbs();
}
function seedBuiltins(force = false) {
  if (seedPromise && !force) return seedPromise;
  seedPromise = (async () => {
    const items = await fetchSeedPhotos();
    if (!items.length) return 0;
    const have = new Set(photos.filter((p) => p.builtin).map((p) => p.seedId));
    const todo = items.filter((it) => !have.has(it.seedId));
    if (!todo.length) return 0;
    const hint = $('galleryHint');
    const BATCH = 6;
    let added = 0;
    for (let s = 0; s < todo.length; s += BATCH) {
      for (const it of todo.slice(s, s + BATCH)) {
        try {
          const imageEl = await loadImageEl(it.src);
          const photo = {
            id: 'seed:' + it.seedId, name: it.name, src: it.src,
            builtin: true, seedId: it.seedId, imageEl,
            quote: it.quote || '',   // 内置层照片台词（assets/gallery/quotes.txt → manifest）
          };
          buildPhotoMesh(photo);
          photos.push(photo);
          added++;
        } catch (err) {
          console.warn('[内置相册] 跳过无法解码/缺失的图片:', it.name, err);
        }
      }
      if (hint) hint.textContent = `正在准备内置相册 ${added} / ${todo.length} …`;
      relayoutRing();
      await new Promise((r) => setTimeout(r, 0));   // 让出一拍给渲染 / 交互
    }
    if (added) ensureBuiltinsFirst();   // 恢复路径下内置图被追加到尾部：稳定排回最前
    return added;
  })();
  return seedPromise;
}
function defaultGalleryHint() {
  const n = photos.filter((p) => p.builtin).length;
  if (!n) return '支持多选与整文件夹导入；压缩后保存在浏览器本地（IndexedDB），刷新自动恢复。点缩略图跳转，✕ 删除单张。';
  return `已内置 ${n} 张照片；自己添加的图片会排在后面，保存在浏览器本地（IndexedDB）。内置图 ✕ 可删、点「恢复内置相册」找回。`;
}

/* ---------- 启动：从 IndexedDB 恢复相册 ---------- */
(async () => {
  try {
    await idbReady();
    const list = (await idbLoadAll()) || [];
    const userPhotos = [];
    for (const rec of list) {
      try {
        const imageEl = await loadImageEl(rec.dataUrl);
        const photo = { id: rec.id, name: rec.name || '照片', dataUrl: rec.dataUrl, imageEl };
        buildPhotoMesh(photo);
        userPhotos.push(photo);
      } catch (err) { /* 单张损坏跳过 */ }
    }
    // 内置照片在前、访客导入的在后：先收着访客的，种完内置再拼回去
    await seedBuiltins();
    photos.push(...userPhotos);
    relayoutRing();
    renderThumbs();
    const hint = $('galleryHint');
    if (hint && photos.length) hint.textContent = defaultGalleryHint();
  } catch (err) {
    console.warn('相册恢复失败:', err);
  }
})();

/* ---------- 照片级台词模块：把它要的三样东西给它 ----------
   list / current 直接给相册数组与当前张；rerender 用来在改完台词后重画缩略图角标。
   用钩子而不是让 photoquotes 反向 import gallery.js —— 那边已经 import 本模块了，
   再反向依赖就成环（与 config.js 的注册表同理）。 */
configurePhotoQuotes({
  list: () => photos,
  current: () => photos[index] || null,
  rerender: renderThumbs,
});

/* ---------- 侧栏模块（台词轮播 / 相册管理）展开收起状态随配置保存 ---------- */
const galleryGroups = Array.from(
  document.querySelectorAll('#galleryPanel details.gallery-group[data-ggroup]')
);
galleryGroups.forEach((d) => d.addEventListener('toggle', () => saveConfig()));
registerConfig({
  save: () => ({
    galleryGroups: Object.fromEntries(galleryGroups.map((d) => [d.dataset.ggroup, d.open])),
  }),
  load: (cfg) => {
    const g = cfg && cfg.galleryGroups;
    if (!g) return;
    galleryGroups.forEach((d) => {
      if (typeof g[d.dataset.ggroup] === 'boolean') d.open = g[d.dataset.ggroup];
    });
  },
});

window.__galleryDebug = {
  isOpen: () => galleryOpen,
  count: () => photos.length,
  index: () => index,
  focus: () => focusIndex,
  zoom: () => focusZoom,
  spin: () => (focusIndex >= 0 && photos[focusIndex] ? photos[focusIndex].spin : 0),
  fit: () => lastFit,
  center: () => {
    if (focusIndex < 0 || !photos[focusIndex] || !photos[focusIndex].group) return null;
    const v = new THREE.Vector3().copy(photos[focusIndex].group.position).project(galleryCamera);
    return { x: v.x, y: v.y };
  },
  pick: (x, y) => pickPhoto(x, y),
  bounds: () => {
    if (focusIndex < 0 || !photos[focusIndex] || !photos[focusIndex].group) return null;
    const g = photos[focusIndex].group;
    const w = (CARD_H * (photos[focusIndex].aspect || 1)) / 2;
    const h = CARD_H / 2;
    const v = new THREE.Vector3();
    let minX = 9, maxX = -9, minY = 9, maxY = -9;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      v.set(sx * w, sy * h, 0).applyMatrix4(g.matrixWorld).project(galleryCamera);
      minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
      minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
    }
    return { minX, maxX, minY, maxY };
  },
  mode: () => layoutMode,
  panelHidden: () => document.body.classList.contains('gallery-panel-hidden'),
  groups: () => galleryGroups.map((d) => [d.dataset.ggroup, d.open]),
  photoTop: () => photoTopPx(),              // 当前张的上沿（对照用）
  clearTop: () => quoteClearanceTopPx(),     // 台词真正让位的值（所有可见照片）
  spanHalf: () => quoteSpanHalfPx(),         // 台词块最大半宽（让位水平窗口）
  quotes: () => quoteDebug(),
  photoQuotes: () => photoQuoteDebug(),           // 照片级台词：状态 / 让位量 / 实测矩形
  pqReserve: () => photoQuoteReservePx(),
  pqText: (i) => photoQuoteText(photos[i === undefined ? index : i]),
  pqSet: (i, text) => { setPhotoQuote(photos[i === undefined ? index : i], text); return photoQuoteDebug(); },
  pqReset: (i) => { photoquotesReset(photos[i === undefined ? index : i]); return photoQuoteDebug(); },
  pqAuto: () => { autoFillAll(); return photoQuoteDebug(); },
  quoteTick: (t) => { updateQuotes(t); return quoteDebug(); },
  ops: () => photos.map((p) => (p.group ? +p.group.children[0].material.opacity.toFixed(2) : -1)),
  radialDot: () => photos.map((p) => {
    if (!p.group || !p.group.visible) return null;
    _posV.copy(p.group.position);
    _posV.y = 0;
    if (_posV.lengthSq() < 1e-6) return null;
    _posV.normalize();
    _lookV.set(0, 0, 1).applyQuaternion(p.group.quaternion);
    return +_lookV.dot(_posV).toFixed(3);
  }),
  yawOff: (i) => {
    const p = photos[i === undefined ? index : i];
    if (!p || !p.group || !p.qBase) return 0;
    _qB.copy(p.qBase).invert().multiply(p.group.quaternion);
    _eul.setFromQuaternion(_qB, 'YXZ');
    return _eul.y;
  },
  fstate: () => {
    const p = photos[focusIndex];
    if (!p || !p.group) return null;
    return {
      s: p.group.scale.x,
      pos: p.group.position.toArray().map((v) => +v.toFixed(2)),
      d: +galleryCamera.position.distanceTo(p.group.position).toFixed(2),
      fit: +lastFit.toFixed(3),
      aspect: +(p.aspect || 1).toFixed(2),
    };
  },
  setMode: setLayoutMode,
  cam: () => ({ x: galleryCamera.position.x, y: galleryCamera.position.y, z: galleryCamera.position.z }),
  depths: () => photos.map((p) => (p.group ? p.group.position.distanceTo(galleryCamera.position) : -1)),
  screen: (i) => {
    const p = photos[i];
    if (!p || !p.group) return null;
    const v = new THREE.Vector3().copy(p.group.position).project(galleryCamera);
    return { x: v.x, y: v.y };
  },
  allBounds: () => {
    const v = new THREE.Vector3();
    let minX = 9, maxX = -9, minY = 9, maxY = -9;
    photos.forEach((p) => {
      if (!p.group || !p.group.visible) return;
      const w = (CARD_H * (p.aspect || 1)) / 2;
      const h = CARD_H / 2;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        v.set(sx * w, sy * h, 0).applyMatrix4(p.group.matrixWorld).project(galleryCamera);
        minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x);
        minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y);
      }
    });
    return { minX, maxX, minY, maxY };
  },
  open: openGallery,
  close: closeGallery,
};

export { openGallery, closeGallery, isGalleryOpen };

/* 调试 / 验收：内置相册与整体状态一眼看清（与 galleryquotes 的 quoteDebug 同一风格） */
export function galleryDebug() {
  const builtins = photos.filter((p) => p.builtin);
  return {
    total: photos.length,
    builtin: builtins.length,
    user: photos.length - builtins.length,
    index,
    layoutMode,
    focusIndex,
    open: galleryOpen,
    names: photos.map((p) => p.name),
  };
}
