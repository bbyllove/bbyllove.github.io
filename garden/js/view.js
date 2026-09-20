/* ================================================================
 * 视角控制（自实现轨道控制）
 *   - 方向键 ← → ↑ ↓ ：旋转视角（爱心与文字作为整体一起转）
 *   - 触控板双指捏合 / 滚动：缩放（爱心与文字一起变大变小）
 *   - 鼠标拖拽 / 触摸拖拽：旋转；双指捏合：缩放
 *   - 底部缩放控制条（对数映射）
 * ================================================================ */
import { $, isFormTarget } from './dom.js';
import { panel } from './panel.js';
import { canvas } from './core.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// 相册陈列室侧栏（台词文本框 / 缩略图列表）：滚轮滚动交还原生
const galleryPanel = $('galleryPanel');

const view = {
  theta: 0.5,
  phi: 1.2,
  radius: 7.4,
  thetaTarget: 0.5,
  phiTarget: 1.2,
  radiusTarget: 7.4,
};

const MIN_RADIUS = 0.8; // 最近：极限贴面特写（各形状正面表面均在相机之外）
const MAX_RADIUS = 120; // 最远：太空远眺，星空全览
const MIN_PHI = 0.15;
const MAX_PHI = Math.PI - 0.15;
const KEY_ROTATE_SPEED = 1.7; // rad/s

/* ---------- 方向键 ---------- */
const pressedKeys = new Set();
const ARROW_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];

window.addEventListener('keydown', (e) => {
  /* 焦点在表单控件上一律不劫持方向键：
     之前只挡了 input / select，textarea 被漏掉 —— 相册陈列室「台词轮播」的
     多行文本框里按 ← / → / ↑ / ↓ 移光标会被吞成转视角，光标动不了 */
  if (isFormTarget(e.target)) return;
  if (ARROW_KEYS.includes(e.key)) {
    e.preventDefault();
    pressedKeys.add(e.key);
  }
});
window.addEventListener('keyup', (e) => pressedKeys.delete(e.key));
window.addEventListener('blur', () => pressedKeys.clear());

/* ---------- 触控板缩放（wheel：滚动 & 双指捏合都会触发） ---------- */
window.addEventListener(
  'wheel',
  (e) => {
    // 触控板双指捏合（ctrlKey）始终视为画布缩放；
    // 普通滚动发生在设置面板 / 相册陈列室侧栏内时，交还原生上下滚动
    // （侧栏 overflow-y:auto：台词文本框、缩略图网格都要能用滚轮翻）
    if (!e.ctrlKey && e.target instanceof Node
      && (panel.contains(e.target) || (galleryPanel && galleryPanel.contains(e.target)))) {
      return;
    }
    e.preventDefault();
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;
    if (e.deltaMode === 2) delta *= 120;
    const factor = e.ctrlKey ? 0.011 : 0.0016;
    view.radiusTarget = clamp(
      view.radiusTarget * Math.exp(delta * factor),
      MIN_RADIUS,
      MAX_RADIUS
    );
  },
  { passive: false }
);

/* ---------- Safari 触控板捏合（gesture 事件） ---------- */
let lastGestureScale = 1;
window.addEventListener('gesturestart', (e) => {
  e.preventDefault();
  lastGestureScale = e.scale;
});
window.addEventListener('gesturechange', (e) => {
  e.preventDefault();
  view.radiusTarget = clamp(
    view.radiusTarget * (lastGestureScale / e.scale),
    MIN_RADIUS,
    MAX_RADIUS
  );
  lastGestureScale = e.scale;
});

/* ---------- 指针拖拽旋转 + 触屏双指捏合 ---------- */
const activePointers = new Map();
let lastPinchDistance = 0;

canvas.addEventListener('pointerdown', (e) => {
  // 合成指针事件 / 指针已释放时 setPointerCapture 可能抛 InvalidPointerId，防御一下
  try { canvas.setPointerCapture(e.pointerId); } catch { /* noop */ }
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (activePointers.size === 2) {
    const [a, b] = [...activePointers.values()];
    lastPinchDistance = Math.hypot(a.x - b.x, a.y - b.y);
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!activePointers.has(e.pointerId)) return;
  const prev = activePointers.get(e.pointerId);
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size === 1) {
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    view.thetaTarget -= dx * 0.005;
    view.phiTarget = clamp(view.phiTarget - dy * 0.005, MIN_PHI, MAX_PHI);
  } else if (activePointers.size === 2) {
    const [a, b] = [...activePointers.values()];
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    if (lastPinchDistance > 0) {
      view.radiusTarget = clamp(
        view.radiusTarget * (lastPinchDistance / distance),
        MIN_RADIUS,
        MAX_RADIUS
      );
    }
    lastPinchDistance = distance;
  }
});

const releasePointer = (e) => {
  activePointers.delete(e.pointerId);
  if (activePointers.size < 2) lastPinchDistance = 0;
};
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

document.addEventListener('dblclick', (e) => e.preventDefault());

// 双击画布快速复位到默认视角
canvas.addEventListener('dblclick', () => resetView());


// 底部缩放控制条（对数映射：滑杆行程均匀对应变焦倍数）
const zoomSlider = $('zoomSlider');
const zoomLabel = $('zoomLabel');
const DEFAULT_RADIUS = 7.4;
const radiusToSlider = (r) =>
  Math.log(r / MIN_RADIUS) / Math.log(MAX_RADIUS / MIN_RADIUS);
const sliderToRadius = (s) =>
  MIN_RADIUS * Math.pow(MAX_RADIUS / MIN_RADIUS, s);

zoomSlider.addEventListener('input', () => {
  view.radiusTarget = sliderToRadius(Number(zoomSlider.value));
});
$('zoomInBtn').addEventListener('click', () => {
  view.radiusTarget = clamp(view.radiusTarget / 1.4, MIN_RADIUS, MAX_RADIUS);
});
$('zoomOutBtn').addEventListener('click', () => {
  view.radiusTarget = clamp(view.radiusTarget * 1.4, MIN_RADIUS, MAX_RADIUS);
});


// 复位视角（快捷键 R / 双击画布 / 「复位」按钮）：回到默认机位，阻尼平滑过渡
function resetView() {
  view.thetaTarget = 0.5;
  view.phiTarget = 1.2;
  view.radiusTarget = DEFAULT_RADIUS;
}

/* ---------- 相机预设机位：一键切换视角（不持久化，属于瞬时操作） ---------- */
const CAMERA_PRESETS = {
  front: { theta: 0, phi: 1.2 },                          // 正面
  side: { theta: Math.PI / 4, phi: 1.2 },                 // 45° 侧面
  top: { theta: 0.5, phi: 0.35, radius: 10 },             // 俯视
  close: { theta: 0.3, phi: 1.35, radius: 3.4 },          // 特写
};
function applyCameraPreset(key) {
  if (key === 'default') {
    resetView();
    return;
  }
  const preset = CAMERA_PRESETS[key];
  if (!preset) return;
  view.thetaTarget = preset.theta;
  view.phiTarget = clamp(preset.phi === undefined ? 1.2 : preset.phi, MIN_PHI, MAX_PHI);
  view.radiusTarget = clamp(
    preset.radius === undefined ? DEFAULT_RADIUS : preset.radius,
    MIN_RADIUS,
    MAX_RADIUS
  );
}
const cameraPresetGrid = $('cameraPresetGrid');
if (cameraPresetGrid) {
  cameraPresetGrid.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-preset]');
    if (!button) return;
    applyCameraPreset(button.dataset.preset);
  });
}

export { clamp, view, MIN_RADIUS, MAX_RADIUS, MIN_PHI, MAX_PHI, KEY_ROTATE_SPEED, resetView,
  applyCameraPreset, pressedKeys, activePointers, zoomSlider, zoomLabel, DEFAULT_RADIUS, radiusToSlider };
