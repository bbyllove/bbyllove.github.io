/* ================================================================
 * 演示模式（Attract Mode，PROJECT_PLANS 第 39 项）
 * - 侧边栏「演示模式」开关（默认关闭）+「进入idle秒数」滑杆（8–60s）
 * - 无输入达到设定秒数后自动进入：相机缓慢环绕 + 俯仰/距离轻呼吸，
 *   定期自动放烟花（沿用当前烟花形状与音效）、偶发触发彩蛋
 * - 任意输入（点击 / 按键 / 滚轮 / 触摸）立即退出并恢复进入前机位；
 * - 进入时自动收起侧边栏与底部操作提示，退出时恢复进入前展开状态；
 *   相册陈列室打开期间不进入 / 自动退出
 * ================================================================ */
import { $ } from './dom.js';
import { saveConfig, registerConfig } from './config.js';
import { view, clamp, MIN_RADIUS, MAX_RADIUS, MIN_PHI, MAX_PHI } from './view.js';
import { spawnFirework as fxFirework } from './fx3d.js';
import { triggerEaster } from './easter.js';
import { isGalleryOpen } from './gallery.js';
import { setPanelOpen } from './panel.js';

const demoParams = { enabled: false, idleSec: 20, orbitDeg: 7, fireworkSec: 2.6, easterSec: 16 };

let demoActive = false;
let lastInputAt = performance.now();
let nextFireworkAt = 0;
let nextEasterAt = 0;
let savedView = null;
let savedPanelOpen = false;
let fwCount = 0;      // 演示期间自动烟花计数（调试用）
let easterCount = 0;  // 演示期间彩蛋计数（调试用）

/* ---------- 任意输入即退出 ---------- */
function markInput(e) {
  lastInputAt = performance.now();
  if (!demoActive) return;
  const target = e && e.target;
  const isPanelInteraction = !!(target && target.closest &&
    target.closest('#panel,#panelToggle'));
  // 如果这次输入正是在打开/操作侧边栏，不抢先把面板恢复为进入前状态，
  // 避免随后的 click 再把它切换回去。
  exitDemo({ restorePanel: !isPanelInteraction });
}
['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach((ev) =>
  window.addEventListener(ev, markInput, { capture: true, passive: true })
);

function enterDemo() {
  demoActive = true;
  savedPanelOpen = document.body.classList.contains('panel-open');
  if (savedPanelOpen) setPanelOpen(false);
  savedView = { theta: view.thetaTarget, phi: view.phiTarget, radius: view.radiusTarget };
  const now = performance.now();
  nextFireworkAt = now + 900;                 // 进场先给一发
  nextEasterAt = now + demoParams.easterSec * 500; // 首个彩蛋提前
  const n = $('demoNotice');
  if (n) n.hidden = false;
}
function exitDemo({ restorePanel = true } = {}) {
  if (!demoActive) return;
  demoActive = false;
  if (savedPanelOpen && restorePanel) setPanelOpen(true);
  savedPanelOpen = false;
  if (savedView) {
    view.thetaTarget = savedView.theta;
    view.phiTarget = clamp(savedView.phi, MIN_PHI, MAX_PHI);
    view.radiusTarget = clamp(savedView.radius, MIN_RADIUS, MAX_RADIUS);
    savedView = null;
  }
  const n = $('demoNotice');
  if (n) n.hidden = true;
}

/* ---------- 自动烟花：完整复用「点击烟花」管线（音效 + 当前形状设置） ---------- */
function demoFirework() {
  const x = window.innerWidth * (0.15 + Math.random() * 0.7);
  const y = window.innerHeight * (0.12 + Math.random() * 0.5);
  fxFirework(x, y);
  fwCount++;
}

/* ---------- 每帧驱动（main.js 主循环调用） ---------- */
function demoTick(dt, nowMs) {
  if (!demoParams.enabled || isGalleryOpen()) {
    if (demoActive) exitDemo();
    return;
  }
  if (!demoActive) {
    if (nowMs - lastInputAt >= demoParams.idleSec * 1000) enterDemo();
    return;
  }
  // 缓慢环绕 + 俯仰 / 距离轻呼吸（基于进入前机位偏移，退出可完整恢复）
  view.thetaTarget += (demoParams.orbitDeg * Math.PI / 180) * dt;
  view.phiTarget = clamp(savedView.phi + Math.sin(nowMs * 0.00011) * 0.22, MIN_PHI, MAX_PHI);
  view.radiusTarget = clamp(savedView.radius * (1 + Math.sin(nowMs * 0.00007) * 0.12), MIN_RADIUS, MAX_RADIUS);
  if (nowMs >= nextFireworkAt) {
    demoFirework();
    nextFireworkAt = nowMs + demoParams.fireworkSec * 1000 * (0.7 + Math.random() * 0.7);
  }
  if (nowMs >= nextEasterAt) {
    triggerEaster();
    easterCount++;
    nextEasterAt = nowMs + demoParams.easterSec * 1000 * (0.8 + Math.random() * 0.5);
  }
}

/* ---------- UI 与配置 ---------- */
function syncDemoUI() {
  if ($('demoEnabled')) $('demoEnabled').checked = !!demoParams.enabled;
  if ($('demoIdle')) {
    $('demoIdle').value = String(demoParams.idleSec);
    const v = $('demoIdleVal');
    if (v) v.textContent = `${demoParams.idleSec}s`;
  }
}
if ($('demoEnabled'))
  $('demoEnabled').addEventListener('change', (e) => {
    demoParams.enabled = e.target.checked;
    lastInputAt = performance.now();
    if (!demoParams.enabled) exitDemo();
    saveConfig();
  });
if ($('demoIdle'))
  $('demoIdle').addEventListener('input', (e) => {
    demoParams.idleSec = Number(e.target.value);
    const v = $('demoIdleVal');
    if (v) v.textContent = `${demoParams.idleSec}s`;
    saveConfig();
  });

registerConfig({
  save: () => ({ demo: demoParams }),
  load: (cfg) => {
    if (cfg.demo) {
      if (typeof cfg.demo.enabled === 'boolean') demoParams.enabled = cfg.demo.enabled;
      if (typeof cfg.demo.idleSec === 'number') demoParams.idleSec = Math.min(60, Math.max(8, cfg.demo.idleSec));
      if (typeof cfg.demo.orbitDeg === 'number') demoParams.orbitDeg = Math.min(20, Math.max(2, cfg.demo.orbitDeg));
      if (typeof cfg.demo.fireworkSec === 'number') demoParams.fireworkSec = Math.min(8, Math.max(1, cfg.demo.fireworkSec));
      if (typeof cfg.demo.easterSec === 'number') demoParams.easterSec = Math.min(60, Math.max(6, cfg.demo.easterSec));
    }
  },
});

/* ---------- 调试钩子（CDP 测试用） ---------- */
window.__demoDebug = {
  active: () => demoActive,
  params: () => ({ ...demoParams }),
  enter: enterDemo,
  exit: exitDemo,
  forceIdle: (ms) => { lastInputAt = performance.now() - ms; },
  counts: () => ({ fw: fwCount, easter: easterCount }),
  viewTarget: () => ({ theta: view.thetaTarget, phi: view.phiTarget, radius: view.radiusTarget }),
};

export { demoParams, demoTick, syncDemoUI };
