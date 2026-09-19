/* ================================================================
 * 累计点击彩蛋：累计点屏 N 次后，第 N+1 次点击触发隐藏彩蛋并重新计数
 *   - 彩蛋类型：新烟花（环形连爆 + 3D 爱心雨）/ 隐藏舞台（追光旋转秀）/
 *     自定义字幕 / 自定义图片 / 随机
 *   - 舞台秀期间爱心原地转体两圈并轻微放大（结束精确归位，无跳变）
 *   - 字幕 / 图片为全屏叠层展示，几秒后自动消失
 *   - 参数随配置保存；图片压缩后保存，过大则仅当前会话生效
 * ================================================================ */
import { $ } from './dom.js';
import { saveConfig, registerConfig } from './config.js';
import { spawnFirework } from './fx3d.js';
import { addFxFlashRing, fxW, fxH } from './fx2d.js';

const EASTER_IMAGE_MAX_CHARS = 1500000; // ≈1.1MB 二进制，安全写入 localStorage

const easterParams = {
  enabled: true,
  threshold: 7,                       // 累计 N 次后第 N+1 次触发
  type: 'random',                      // random / firework / stage / subtitle / image
  subtitle: 'BinBin ❤ ChengYan',
  image: '',                           // dataURL（过大时不落盘）
};

let clickCount = 0; // 当前累计（会话内，不持久化）

/* ---------- 点击计数：与烟花判定同一套「真点击」过滤（拖拽/长按/点 UI 不算） ---------- */
let _downX, _downY, _downT;
window.addEventListener(
  'pointerdown',
  (e) => { _downX = e.clientX; _downY = e.clientY; _downT = performance.now(); },
  { passive: true }
);
window.addEventListener(
  'click',
  (e) => {
    if (!easterParams.enabled || _downX === undefined) return;
    if (Math.hypot(e.clientX - _downX, e.clientY - _downY) > 8) return;
    if (performance.now() - _downT > 700) return;
    const t = e.target;
    if (t && t.closest && t.closest('#panel,#panelToggle,.hints,footer,.zoom-bar,button,input,select,label,a')) return;
    clickCount += 1;
    if (clickCount > easterParams.threshold) {
      clickCount = 0;
      triggerEaster();
    }
    updateProgressUI();
  },
  { passive: true }
);

function updateProgressUI() {
  const el = $('easterProgress');
  if (el) el.textContent = `${clickCount} / ${easterParams.threshold}`;
}

/* ---------- 彩蛋一：新烟花秀 —— 中心起爆 + 环形七连爆 + 3D 爱心雨 ---------- */
let _showTimers = [];
function _later(fn, ms) { _showTimers.push(setTimeout(fn, ms)); }
function specialFireworkShow() {
  _showTimers.forEach(clearTimeout);
  _showTimers = [];
  const cx = fxW / 2, cy = fxH / 2;
  spawnFirework(cx, cy, { kind: 'round' }); // 中心起爆
  addFxFlashRing(cx, cy, 300);
  const RING = 7;
  for (let i = 0; i < RING; i++) {
    _later(() => {
      const a = (i / RING) * Math.PI * 2 - Math.PI / 2;
      const r = Math.min(fxW, fxH) * 0.3;
      spawnFirework(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.72, { kind: 'round' });
    }, 300 + i * 240);
  }
  for (let i = 0; i < 5; i++) { // 3D 爱心雨（自上方炸开、受重力飘落）
    _later(() => {
      spawnFirework(fxW * (0.18 + Math.random() * 0.64), fxH * (0.1 + Math.random() * 0.22), { kind: 'heart' });
    }, 620 + i * 380);
  }
  _later(() => { // 收尾：中心一记大爱心 + 全屏闪光
    spawnFirework(cx, cy * 0.82, { kind: 'heart' });
    addFxFlashRing(cx, cy, 320);
  }, 300 + RING * 240 + 320);
}

/* ---------- 彩蛋二：隐藏舞台 —— 追光扫射叠层 + 爱心转体两圈 ---------- */
const STAGE_MS = 4600;
let stageStart = 0, stageUntil = 0, _stageTimer = 0;
function stageShow() {
  stageStart = performance.now();
  stageUntil = stageStart + STAGE_MS;
  const el = $('stageFx');
  if (el) {
    el.hidden = false;
    clearTimeout(_stageTimer);
    _stageTimer = setTimeout(() => { el.hidden = true; }, STAGE_MS);
  }
  spawnFirework(fxW / 2, fxH * 0.22, { kind: 'round' }); // 开场爆点
  _later(() => spawnFirework(fxW / 2, fxH * 0.2, { kind: 'heart' }), STAGE_MS - 900); // 谢幕爱心
}
// 转体角度：smoothstep 缓动转满两圈，p=1 时恰为 2π 整数倍 → 结束后无缝归位
export function easterSpin(nowMs) {
  if (nowMs >= stageUntil) return 0;
  const p = Math.min(1, Math.max(0, (nowMs - stageStart) / STAGE_MS));
  const ease = p * p * (3 - 2 * p);
  return ease * Math.PI * 4;
}
// 轻微放大脉冲：sin 包络，起止均为 0 → 无跳变
export function easterPulse(nowMs) {
  if (nowMs >= stageUntil) return 0;
  const p = Math.min(1, Math.max(0, (nowMs - stageStart) / STAGE_MS));
  return Math.sin(p * Math.PI) * 0.12;
}

/* ---------- 彩蛋三：自定义字幕 ---------- */
let _subTimer = 0;
function subtitleShow(text) {
  const el = $('subtitleFx');
  if (!el) return;
  el.textContent = text || '❤';
  el.hidden = false;
  el.style.animation = 'none';
  void el.offsetWidth; // 重启动画
  el.style.animation = '';
  clearTimeout(_subTimer);
  _subTimer = setTimeout(() => { el.hidden = true; }, 4300);
}

/* ---------- 彩蛋四：自定义图片 ---------- */
let _imgTimer = 0;
function imageShow() {
  const box = $('imageFx');
  const img = $('imageFxImg');
  if (!box || !img || !easterParams.image) {
    subtitleShow(easterParams.subtitle); // 无图时回退字幕
    return;
  }
  img.src = easterParams.image;
  box.hidden = false;
  img.style.animation = 'none';
  void img.offsetWidth;
  img.style.animation = '';
  clearTimeout(_imgTimer);
  _imgTimer = setTimeout(() => { box.hidden = true; }, 5200);
}

/* ---------- 触发调度 ---------- */
function resolveType() {
  const t = easterParams.type;
  if (t === 'image' && !easterParams.image) return easterParams.subtitle.trim() ? 'subtitle' : 'firework';
  if (t === 'subtitle' && !easterParams.subtitle.trim()) return 'firework';
  if (t !== 'random') return t;
  const pool = ['firework', 'stage'];
  if (easterParams.subtitle.trim()) pool.push('subtitle');
  if (easterParams.image) pool.push('image');
  return pool[Math.floor(Math.random() * pool.length)];
}
function triggerEaster() {
  const type = resolveType();
  if (type === 'firework') specialFireworkShow();
  else if (type === 'stage') stageShow();
  else if (type === 'subtitle') subtitleShow(easterParams.subtitle.trim());
  else imageShow();
}

/* ---------- 图片上传压缩 ---------- */
function compressEasterImage(file, maxSide, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, w, h);
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片加载失败')); };
    img.src = url;
  });
}
async function handleEasterImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  let dataUrl = '';
  try {
    for (const [maxSide, quality] of [[960, 0.85], [720, 0.8], [560, 0.72]]) {
      dataUrl = await compressEasterImage(file, maxSide, quality);
      if (dataUrl.length <= EASTER_IMAGE_MAX_CHARS) break;
    }
  } catch (err) {
    console.warn('彩蛋图片处理失败:', err);
    return;
  }
  easterParams.image = dataUrl;
  syncEasterUI();
  saveConfig();
}

/* ---------- 面板 UI ---------- */
function syncEasterUI() {
  if ($('easterEnabled')) $('easterEnabled').checked = !!easterParams.enabled;
  if ($('easterThreshold')) {
    $('easterThreshold').value = String(easterParams.threshold);
    $('easterThresholdVal').textContent = String(easterParams.threshold);
  }
  document.querySelectorAll('#easterTypeGrid button').forEach((b) =>
    b.classList.toggle('active', b.dataset.etype === easterParams.type));
  if ($('easterSubtitle')) $('easterSubtitle').value = easterParams.subtitle;
  const thumb = $('easterImageThumb');
  if (thumb) {
    if (easterParams.image) { thumb.src = easterParams.image; thumb.hidden = false; }
    else { thumb.removeAttribute('src'); thumb.hidden = true; }
  }
  updateProgressUI();
}

if ($('easterEnabled')) {
  $('easterEnabled').addEventListener('change', (e) => {
    easterParams.enabled = e.target.checked;
    saveConfig();
  });
}
if ($('easterThreshold')) {
  $('easterThreshold').addEventListener('input', (e) => {
    easterParams.threshold = Math.min(60, Math.max(3, Math.round(Number(e.target.value))));
    $('easterThresholdVal').textContent = String(easterParams.threshold);
    if (clickCount > easterParams.threshold) clickCount = 0;
    updateProgressUI();
    saveConfig();
  });
}
if ($('easterTypeGrid')) {
  $('easterTypeGrid').addEventListener('click', (e) => {
    const button = e.target.closest('button[data-etype]');
    if (!button) return;
    easterParams.type = button.dataset.etype;
    syncEasterUI();
    saveConfig();
  });
}
if ($('easterSubtitle')) {
  $('easterSubtitle').addEventListener('input', (e) => {
    easterParams.subtitle = e.target.value;
    saveConfig();
  });
}
if ($('easterPick')) {
  $('easterPick').addEventListener('click', () => $('easterImageInput') && $('easterImageInput').click());
}
if ($('easterImageInput')) {
  $('easterImageInput').addEventListener('change', (e) => {
    handleEasterImageFile(e.target.files && e.target.files[0]);
    e.target.value = '';
  });
}
if ($('easterClear')) {
  $('easterClear').addEventListener('click', () => {
    easterParams.image = '';
    syncEasterUI();
    saveConfig();
  });
}
if ($('easterPreview')) {
  $('easterPreview').addEventListener('click', () => triggerEaster());
}

registerConfig({
  save: () => ({
    enabled: easterParams.enabled,
    threshold: easterParams.threshold,
    type: easterParams.type,
    subtitle: easterParams.subtitle,
    image: easterParams.image.length <= EASTER_IMAGE_MAX_CHARS ? easterParams.image : '',
  }),
  load: (cfg) => {
    if (typeof cfg.enabled === 'boolean') easterParams.enabled = cfg.enabled;
    if (typeof cfg.threshold === 'number')
      easterParams.threshold = Math.min(60, Math.max(3, Math.round(cfg.threshold)));
    if (['random', 'firework', 'stage', 'subtitle', 'image'].includes(cfg.type))
      easterParams.type = cfg.type;
    if (typeof cfg.subtitle === 'string') easterParams.subtitle = cfg.subtitle.slice(0, 40);
    if (typeof cfg.image === 'string' && cfg.image.startsWith('data:image') &&
        cfg.image.length <= EASTER_IMAGE_MAX_CHARS) easterParams.image = cfg.image;
  },
});

export { easterParams, syncEasterUI, triggerEaster };
