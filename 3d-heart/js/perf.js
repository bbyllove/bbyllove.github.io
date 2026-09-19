/* ================================================================
 * 性能画质（11）+ 低帧率建议（44）
 *
 * 手动三档画质：低 / 中 / 高。只提供选项、由用户决定，绝不自动降档；
 * FPS 连续 2 秒低于 30 时仅弹出「建议提示条」，是否切换由用户点击选择。
 *
 * 各档差异（越高越好看、越吃性能）：
 *   高：渲染像素比 ≤2、阴影开、Bloom 按面板配置、粒子/流星/星空 100%
 *   中：渲染像素比 ≤1.5、阴影开、Bloom 按面板配置、粒子/流星/星空约 70%
 *   低：渲染像素比 ≤1、阴影关、Bloom 强制关、粒子/流星/星空约 40–50%
 *
 * 联动方式：本模块不 import 任何业务模块，切换后派发
 * 'heart-perf-change' 自定义事件，bloom / particles / background
 * 各自监听并刷新（避免循环依赖）。
 * ================================================================ */
import { $ } from './dom.js';
import { renderer, scene, keyLight } from './core.js';
import { saveConfig, registerConfig } from './config.js';

const PERF_LEVELS = {
  low:    { dpr: 1,   shadows: false, bloom: false, particle: 0.4,  meteor: 0.5,  star: 0.4 },
  medium: { dpr: 1.5, shadows: true,  bloom: true,  particle: 0.7,  meteor: 0.75, star: 0.7 },
  high:   { dpr: 2,   shadows: true,  bloom: true,  particle: 1,    meteor: 1,    star: 1 },
};
let perfLevel = 'high';

function getPerfLevel() { return perfLevel; }
function getPerfParticleScale() { return PERF_LEVELS[perfLevel].particle; }
function getPerfMeteorScale() { return PERF_LEVELS[perfLevel].meteor; }
function getPerfStarScale() { return PERF_LEVELS[perfLevel].star; }
function perfBloomAllowed() { return PERF_LEVELS[perfLevel].bloom; }

/* ---------- 低帧率建议（44）：只提示、不自动切换 ---------- */
let perfPrompt = true;      // 「低帧率提醒」开关
let fpsAcc = 0, fpsFrames = 0;
let lowTime = 0;            // 连续 FPS<30 的采样窗口累计秒数
let lastAvg = 60;
let noticeVisible = false;
let noticeTimer = 0;
let dismissed = false;      // 本次低帧周期内已处理过（关闭/切换/自动隐藏）
let recovered = true;       // 滞回：恢复到 ≥45 后才允许再次提醒
const startedAt = performance.now();

function showPerfNotice() {
  const el = $('perfNotice');
  if (!el || noticeVisible) return;
  noticeVisible = true;
  el.hidden = false;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => hidePerfNotice(true), 12000);
}
function hidePerfNotice(markDismissed) {
  const el = $('perfNotice');
  if (el) el.hidden = true;
  noticeVisible = false;
  lowTime = 0;
  if (markDismissed) dismissed = true;
}

function syncPerfUI() {
  document.querySelectorAll('#perfLevelGrid button').forEach((b) =>
    b.classList.toggle('active', b.dataset.perf === perfLevel));
  if ($('perfPrompt')) $('perfPrompt').checked = perfPrompt;
}

function applyPerfLevel(level, save = true) {
  if (!PERF_LEVELS[level]) return;
  const changed = level !== perfLevel;
  perfLevel = level;
  const spec = PERF_LEVELS[level];
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, spec.dpr));
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (keyLight.castShadow !== spec.shadows) {
    keyLight.castShadow = spec.shadows;
    renderer.shadowMap.enabled = spec.shadows;
    scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; });
  }
  if (changed) { lowTime = 0; }        // 切换后重新评估帧率
  if (level !== 'low') recovered = true;
  syncPerfUI();
  window.dispatchEvent(new CustomEvent('heart-perf-change'));
  if (save) saveConfig();
}

/* ---------- UI 绑定 ---------- */
document.querySelectorAll('#perfLevelGrid button').forEach((b) =>
  b.addEventListener('click', () => applyPerfLevel(b.dataset.perf)));
if ($('perfPrompt')) $('perfPrompt').addEventListener('change', (e) => {
  perfPrompt = e.target.checked;
  saveConfig();
});
if ($('perfNoticeYes')) $('perfNoticeYes').addEventListener('click', () => {
  hidePerfNotice(true);
  applyPerfLevel('low');
});
if ($('perfNoticeNo')) $('perfNoticeNo').addEventListener('click', () => hidePerfNotice(true));
window.addEventListener('resize', () => {
  // 像素比上限随窗口变化时保持生效（setSize 内部会乘 pixelRatio）
  renderer.setSize(window.innerWidth, window.innerHeight);
});

/* ---------- 主循环采样：独立于 FPS 角标，始终运行 ---------- */
function perfTick(dt) {
  fpsAcc += dt;
  fpsFrames += 1;
  if (fpsAcc < 0.5) return;
  lastAvg = fpsFrames / fpsAcc;
  fpsAcc = 0;
  fpsFrames = 0;
  if (performance.now() - startedAt < 4000) return; // 跳过启动编译/加载抖动
  if (lastAvg >= 45) { recovered = true; dismissed = false; return; }
  if (!perfPrompt || noticeVisible || perfLevel === 'low' || dismissed) return;
  if (lastAvg < 30) {
    lowTime += 0.5;
    if (lowTime >= 2) showPerfNotice();
  } else {
    lowTime = 0;
  }
}

registerConfig({
  save: () => ({ perf: { level: perfLevel, prompt: perfPrompt } }),
  load: (cfg) => {
    if (cfg.perf) {
      if (typeof cfg.perf.prompt === 'boolean') perfPrompt = cfg.perf.prompt;
      if (PERF_LEVELS[cfg.perf.level]) { applyPerfLevel(cfg.perf.level, false); return; }
    }
    syncPerfUI();
  },
});

/* 调试 / 测试钩子：用于 CDP 验证提示条（生产 UI 不使用） */
window.__perfDebug = {
  showNotice: showPerfNotice,
  hideNotice: () => hidePerfNotice(true),
  getLevel: () => perfLevel,
  getLastAvg: () => lastAvg,
  snapshot: () => ({
    level: perfLevel,
    pixelRatio: renderer.getPixelRatio(),
    shadows: renderer.shadowMap.enabled,
    bloomAllowed: PERF_LEVELS[perfLevel].bloom,
    particle: PERF_LEVELS[perfLevel].particle,
    meteor: PERF_LEVELS[perfLevel].meteor,
    star: PERF_LEVELS[perfLevel].star,
  }),
};

export {
  getPerfLevel, getPerfParticleScale, getPerfMeteorScale, getPerfStarScale,
  perfBloomAllowed, applyPerfLevel, perfTick, syncPerfUI,
};
