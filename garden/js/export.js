/* ================================================================
 * 导出：PNG 静态图 / WebM 动画录制（可选透明 alpha）/ GIF 动图
 *
 * 透明背景（25）：勾选后 WebM / GIF 走 alpha 通道，方便二次剪辑；
 * 不勾选时录制 / GIF 会合成当前背景（暮光 / 星空 / 自定义图片 + 暗角），
 * 成片与页面观感一致。
 * GIF（26）：零依赖 GIF89a 编码器（js/gifenc.js），逐帧抓取合成画布，
 * 6×6×6 调色板 + 有序抖动，支持帧率 / 宽度 / 时长选项。
 * ================================================================ */
import { $ } from './dom.js';
import { canvas } from './core.js';
import { renderMain } from './bloom.js';
import { bgState, getBgCorsImage } from './background.js';
import { saveConfig, registerConfig } from './config.js';
import { encodeGif, quantizeFrame } from './gifenc.js';

let exportAlpha = false; // 透明背景开关（WebM / GIF 共用）

let motionRecorder = null;
let motionTimer = 0;
let motionRaf = 0;
let gifCapturing = false;

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2200);
}

/* ---------- 背景合成（让录制 / GIF 与页面观感一致） ---------- */
function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mixHex(a, b, t) {
  const ca = hexRgb(a), cb = hexRgb(b);
  return [
    Math.round(ca[0] + (cb[0] - ca[0]) * t),
    Math.round(ca[1] + (cb[1] - ca[1]) * t),
    Math.round(ca[2] + (cb[2] - ca[2]) * t),
  ];
}
const rgba = (c, a = 1) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;

// CSS 椭圆径向渐变的 Canvas 等价：缩放坐标系后画单位圆渐变
function radialEll(ctx, w, h, cx, cy, rx, ry, stops) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(rx, ry);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  for (const [off, col] of stops) g.addColorStop(off, col);
  ctx.fillStyle = g;
  ctx.fillRect(-cx / rx, -cy / ry, w / rx, h / ry);
  ctx.restore();
}

function paintVignette(ctx, w, h) {
  radialEll(ctx, w, h, w * 0.5, h * 0.5, w * 0.9, h * 0.9, [
    [0.55, 'rgba(5, 2, 8, 0)'],
    [1, 'rgba(5, 2, 8, 0.55)'],
  ]);
}

let bgImageEl = null, bgImageKey = '';
function paintBackground(ctx, w, h, blurScale = 1) {
  const bg = bgState;
  ctx.clearRect(0, 0, w, h);
  if (bg.style === 'image' && bg.image) {
    let el = null;
    if (bg.image.dataUrl) {
      if (!bgImageEl || bgImageKey !== bg.image.dataUrl) {
        bgImageEl = new Image();
        bgImageKey = bg.image.dataUrl;
        bgImageEl.src = bgImageKey;
      }
      if (bgImageEl.complete && bgImageEl.naturalWidth) el = bgImageEl;
    } else if (bg.image.url) {
      // 直链模式：屏幕显示无需 CORS；导出合成仅当 CORS 预载成功（画布不污染）
      const cors = getBgCorsImage();
      if (cors && cors.complete && cors.naturalWidth) el = cors;
      // CORS 预载失败时 el 保持 null，自动回退渐变背景
    }
    if (el) {
      ctx.save();
      ctx.filter = `blur(${(bg.image.blur * blurScale).toFixed(1)}px) brightness(${Math.max(0.1, 1 - bg.image.darken).toFixed(2)})`;
      const bleed = 0.08; // 外扩出血，模拟 CSS 层的模糊露边防护
      const cw = w * (1 + bleed * 2), ch = h * (1 + bleed * 2);
      const s = Math.max(cw / el.naturalWidth, ch / el.naturalHeight);
      const dw = el.naturalWidth * s, dh = el.naturalHeight * s;
      ctx.drawImage(el, (w - dw) / 2, (h - dh) / 2, dw, dh);
      ctx.restore();
      paintVignette(ctx, w, h);
      return;
    }
  }
  if (bg.style === 'star') {
    const { base, accent } = bg.star;
    radialEll(ctx, w, h, w * 0.5, h * 0.2, w * 1.1, h * 0.75, [
      [0, rgba(mixHex(base, accent, 0.1))],
      [0.55, rgba(hexRgb(base))],
      [1, rgba(mixHex(base, '#000000', 0.4))],
    ]);
  } else {
    const { base, accent } = bg.twilight;
    radialEll(ctx, w, h, w * 0.5, h * 0.3, w * 1.2, h * 0.9, [
      [0, rgba(mixHex(base, accent, 0.1))],
      [0.48, rgba(hexRgb(base))],
      [1, rgba(mixHex(base, '#000000', 0.5))],
    ]);
    radialEll(ctx, w, h, w * 0.5, 0, w * 0.9, h * 0.6, [
      [0, rgba(hexRgb(accent), 0.14)],
      [0.6, rgba(hexRgb(accent), 0)],
    ]);
  }
  paintVignette(ctx, w, h);
}

/* ---------- 导出期间统一禁用按钮 ---------- */
function setExportBusy(busy) {
  for (const id of ['exportPng', 'exportMotion', 'exportGif']) {
    const el = $(id);
    if (el) el.disabled = busy;
  }
  const durationRow = $('motionDuration') && $('motionDuration').closest('.export-row');
  if (durationRow) durationRow.classList.toggle('disabled', busy);
  const durInput = $('motionDuration');
  if (durInput) durInput.disabled = busy;
}

function setMotionState(isRecording) {
  setExportBusy(isRecording);
  const motionBtn = $('exportMotion');
  if (motionBtn) motionBtn.textContent = isRecording ? '停止录制' : '录制动画';
}

/* ---------- WebM 录制 ---------- */
function stopMotionRecording(cancelled = false) {
  clearTimeout(motionTimer);
  cancelAnimationFrame(motionRaf);
  motionRaf = 0;
  if (!motionRecorder) return;
  const rec = motionRecorder;
  motionRecorder = null;
  setMotionState(false);
  if (cancelled) {
    rec.__heartCancelled = true;
    rec.onstop = null;
    if (rec.state && rec.state !== 'inactive') rec.stop();
    if (rec.stream) rec.stream.getTracks().forEach((track) => track.stop());
  } else if (rec.state && rec.state !== 'inactive') {
    rec.stop();
  }
}

function recordMotion() {
  if (gifCapturing) return;
  if (motionRecorder) {
    stopMotionRecording(false);
    return;
  }
  try {
    let stream;
    if (exportAlpha) {
      // 透明背景：直接录 WebGL 画布（alpha 通道写入 WebM）
      stream = canvas.captureStream(60);
    } else {
      // 默认：合成“背景 + 场景”，成片与页面观感一致
      const comp = document.createElement('canvas');
      comp.width = canvas.width;
      comp.height = canvas.height;
      const cctx = comp.getContext('2d');
      const scale = comp.width / Math.max(1, window.innerWidth);
      const paint = () => {
        motionRaf = requestAnimationFrame(paint);
        paintBackground(cctx, comp.width, comp.height, scale);
        cctx.drawImage(canvas, 0, 0, comp.width, comp.height);
      };
      paint();
      stream = comp.captureStream(60);
    }
    const mimeTypes = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType = mimeTypes.find((type) => MediaRecorder.isTypeSupported(type)) || '';
    const rec = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 9_000_000 } : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    rec.onstop = () => {
      cancelAnimationFrame(motionRaf);
      motionRaf = 0;
      if (rec.__heartCancelled) return;
      const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
      chunks.length = 0;
      stream.getTracks().forEach((track) => track.stop());
      if (blob.size > 0) downloadBlob(blob, `3d-heart-${stamp()}.webm`);
      setMotionState(false);
    };
    rec.start(180);
    motionRecorder = rec;
    setMotionState(true);
    const seconds = Number($('motionDuration').value) || 5;
    motionTimer = setTimeout(() => stopMotionRecording(false), seconds * 1000);
  } catch (err) {
    console.warn('动画导出失败：', err);
    stopMotionRecording(true);
  }
}

/* ---------- GIF 导出 ---------- */
function recordGif() {
  if (gifCapturing || motionRecorder) return;
  gifCapturing = true;
  setExportBusy(true);
  const gifBtn = $('exportGif');
  if (gifBtn) gifBtn.textContent = 'GIF 采样中…';

  const fps = Number($('gifFps') && $('gifFps').value) || 15;
  const w = Number($('gifSize') && $('gifSize').value) || 360;
  const h = Math.max(2, Math.round((w * window.innerHeight) / Math.max(1, window.innerWidth)));
  const seconds = Number($('motionDuration').value) || 5;
  const useAlpha = exportAlpha;
  const blurScale = w / Math.max(1, window.innerWidth);

  const cap = document.createElement('canvas');
  cap.width = w;
  cap.height = h;
  const cctx = cap.getContext('2d', { willReadFrequently: true });

  const frames = [];
  const startAt = performance.now();
  const timer = setInterval(() => {
    paintBackground(cctx, w, h, blurScale);
    renderMain(); // 同步渲染 WebGL 场景后立即取帧
    cctx.drawImage(canvas, 0, 0, w, h);
    frames.push(quantizeFrame(cctx.getImageData(0, 0, w, h), useAlpha));
    if (performance.now() - startAt >= seconds * 1000) {
      clearInterval(timer);
      try {
        const bytes = encodeGif(frames, {
          width: w,
          height: h,
          delay: Math.max(2, Math.round(100 / fps)),
          transparent: useAlpha,
        });
        window.__gifInfo = { width: w, height: h, frames: frames.length, bytes: bytes.length };
        downloadBlob(new Blob([bytes], { type: 'image/gif' }), `3d-heart-${stamp()}.gif`);
      } catch (err) {
        console.warn('GIF 导出失败：', err);
      }
      frames.length = 0;
      gifCapturing = false;
      setExportBusy(false);
      if (gifBtn) gifBtn.textContent = '导出 GIF';
    }
  }, 1000 / fps);
}

/* ---------- PNG 导出 ---------- */
function exportPng() {
  renderMain();
  try {
    // 在 WebGL 渲染后同步取数，避免 preserveDrawingBuffer=false 造成黑图
    canvas.toBlob((blob) => {
      if (!blob) return;
      downloadBlob(blob, `3d-heart-${stamp()}.png`);
    }, 'image/png');
  } catch (err) {
    console.warn('图片导出失败：', err);
  }
}

/* ---------- 面板绑定 ---------- */
if ($('exportPng')) {
  $('exportPng').addEventListener('click', exportPng);
  $('exportMotion').addEventListener('click', recordMotion);
  if ($('exportGif')) $('exportGif').addEventListener('click', recordGif);
  $('motionDuration').addEventListener('input', (e) => {
    $('motionDurationVal').textContent = `${Math.round(Number(e.target.value))}s`;
  });
  if ($('exportAlpha')) {
    $('exportAlpha').addEventListener('change', (e) => {
      exportAlpha = e.target.checked;
      saveConfig();
    });
  }
}

function syncExportUI() {
  if ($('exportAlpha')) $('exportAlpha').checked = exportAlpha;
}

registerConfig({
  save: () => ({ exportAlpha }),
  load: (cfg) => {
    if (typeof cfg.exportAlpha === 'boolean') exportAlpha = cfg.exportAlpha;
    syncExportUI();
  },
});
